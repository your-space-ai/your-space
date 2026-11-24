import { createHash } from "node:crypto";
import { parseLink, type SourceFile } from "../apps/github.ts";
import { composeOf, kitFromFile, KitError, matchesKitReview, NotAKitError, type FoundKit } from "../apps/kits.ts";
import { AppError, type AppsService } from "../apps/service.ts";
import { publicGithubClient, type GithubClient, type GithubRepo } from "./github.ts";

export type Reader = Pick<GithubClient, "repo" | "resolve" | "file" | "kitPaths">;
/** The Compose file a kit names, read at the exact commit the kit pins. */
type Snapshot = { repo: string; ref: string; commit: string; composePath: string; composeText: string };
const invalid = () => new AppError(400, "invalid_kit_source", "Choose a GitHub kit file and a valid Compose path.");
const notKitLink = () =>
  new AppError(400, "invalid_kit_source", "Paste the GitHub link to the app's kit, like https://github.com/owner/repo/blob/main/kit.yaml.");
const link = (repo: string, commit: string, path: string) =>
  "https://github.com/" + repo + "/blob/" + commit + "/" + path.split("/").map(encodeURIComponent).join("/");

function field(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw invalid();
  return value;
}

/** A kit read from GitHub, and the Compose file it names at its exact commit (composeOf). */
function kitFile(text: string): { found: FoundKit; compose: { repo: string; path: string; commit: string } } {
  try {
    const found = kitFromFile(text, null);
    return { found, compose: composeOf(found.kit) };
  } catch (error) {
    if (error instanceof NotAKitError) throw new AppError(400, "kit_required", error.message);
    if (error instanceof KitError) throw new AppError(400, "invalid_kit", error.message);
    throw error;
  }
}

function preview(apps: AppsService, snap: Snapshot, found: FoundKit) {
  const pinnedLink = link(snap.repo, snap.commit, snap.composePath);
  const source: SourceFile = {
    repo: snap.repo,
    path: snap.composePath,
    ref: snap.ref,
    commit: snap.commit,
    link: link(snap.repo, snap.ref, snap.composePath),
    pinnedLink,
    text: snap.composeText,
  };
  return apps.previewResolved(source, found);
}

export async function catalog(reader: Reader, directory?: string) {
  if (!directory) return { commit: null, kits: [] };
  const registry = await reader.repo(directory);
  const commit = await reader.resolve(registry.id, registry.defaultBranch);
  const paths = await reader.kitPaths(registry.id, commit);
  return {
    commit,
    kits: paths.map((path) => {
      const repo = path.slice("apps/".length, -".yaml".length);
      return { title: repo.split("/")[1], repo, path, kitUrl: link(registry.fullName, commit, path) };
    }),
  };
}

async function linkedKit(reader: Reader, input: unknown) {
  let parsed: ReturnType<typeof parseLink>;
  try {
    const url = new URL(field(input, ""));
    if (url.username || url.password || url.port || url.search || url.hash) throw invalid();
    parsed = parseLink(url.href);
  } catch {
    throw notKitLink();
  }
  let repo: GithubRepo;
  try {
    repo = await reader.repo(parsed.repo);
  } catch (error) {
    if (error instanceof AppError && error.code === "github_not_found") {
      throw new AppError(
        404,
        "kit_not_found",
        "GitHub can't find the repository of that kit for your GitHub connection. If it is private, connect GitHub with private repositories included, on the GitHub page, with an account that can read it.",
      );
    }
    throw error;
  }
  for (let i = 1; i < Math.min(parsed.rest.length, 17); i++) {
    const ref = parsed.rest.slice(0, i).join("/");
    let commit: string;
    try {
      commit = await reader.resolve(repo.id, ref);
    } catch (error) {
      if (error instanceof AppError && ["github_conflict", "github_not_found"].includes(error.code)) continue;
      throw error;
    }
    const path = parsed.rest.slice(i).join("/");
    const file = await reader.file(repo.id, path, commit);
    return { repo, ref, commit, path, content: file.content };
  }
  throw notKitLink();
}

/** A kit may name a Compose file in another repository only if that repository is public. Your Space
 * reads a private repository through the owner's GitHub connection only for a kit in that same repository. */
async function targetRepo(fullName: string, publicReader: Reader) {
  try {
    return { repo: await publicReader.repo(fullName), reader: publicReader };
  } catch (error) {
    if (error instanceof AppError && error.code === "github_not_found") {
      throw new AppError(
        403,
        "private_source",
        `The kit names its Compose file in ${fullName}, which isn't a public repository. A kit in a private repository can name a Compose file in that same repository or in a public one.`,
      );
    }
    throw error;
  }
}

async function attachReview(reader: Reader, found: FoundKit, file: Awaited<ReturnType<typeof linkedKit>>, directory?: string) {
  if (!directory || !found.kit.agentAccess) return;
  const digest = createHash("sha256").update(file.content).digest("hex");
  const path = "reviews/sha256/" + digest + ".json";
  try {
    const registry = await reader.repo(directory);
    const commit = await reader.resolve(registry.id, registry.defaultBranch);
    const record = JSON.parse((await reader.file(registry.id, path, commit)).content);
    if (await matchesKitReview(record, digest, { repo: file.repo.fullName, path: file.path, commit: file.commit, text: file.content },
      async (attested) => (await reader.file(file.repo.id, file.path, attested)).content)) {
      found.kit.agentReview = { source: link(registry.fullName, commit, path) };
    }
  } catch (error) {
    if (!(error instanceof AppError || error instanceof SyntaxError)) throw error;
  }
}

export async function previewKitUrl(
  connected: GithubClient | null,
  apps: AppsService,
  url: unknown,
  publicReader = publicGithubClient(),
) {
  return previewKit(connected, apps, await linkedKit(connected ?? publicReader, url), publicReader);
}

/**
 * Reviews an app from its kit, read at an exact commit. The Compose file is the one the kit's source
 * names, read at the commit the kit pins, never at a branch's latest commit.
 */
async function previewKit(
  connected: GithubClient | null,
  apps: AppsService,
  kit: Awaited<ReturnType<typeof linkedKit>>,
  publicReader: Reader,
) {
  const reader = connected ?? publicReader;
  const { found, compose: file } = kitFile(kit.content);
  const same = file.repo.toLowerCase() === kit.repo.fullName.toLowerCase();
  const target = same ? { repo: kit.repo, reader } : await targetRepo(file.repo, publicReader);
  let compose: string;
  try {
    compose = (await target.reader.file(target.repo.id, file.path, file.commit)).content;
  } catch (error) {
    if (error instanceof AppError && error.code === "github_not_found") {
      throw new AppError(400, "source", `There is no file ${file.path} in ${file.repo} at ${file.commit}, the commit the kit names.`);
    }
    throw error;
  }
  found.source = link(kit.repo.fullName, kit.commit, kit.path);
  await attachReview(reader, found, kit, apps.config.kitsRepository);
  return preview(
    apps,
    { repo: target.repo.fullName, ref: file.commit, commit: file.commit, composePath: file.path, composeText: compose },
    found,
  );
}
