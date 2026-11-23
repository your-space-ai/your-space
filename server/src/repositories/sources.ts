import { createHash } from "node:crypto";
import type { Db } from "../db/client.ts";
import { parseLink, type SourceFile } from "../apps/github.ts";
import { composeOf, kitFromFile, KitError, matchesKitReview, NotAKitError, type FoundKit } from "../apps/kits.ts";
import type { ReplacementSnapshot } from "../apps/replacement.ts";
import { AppError, type AppsService } from "../apps/service.ts";
import { publicGithubClient, type GithubClient, type GithubRepo } from "./github.ts";

export type Reader = Pick<GithubClient, "repo" | "resolve" | "file" | "kitPaths">;
type Snapshot = ReplacementSnapshot & { ref: string };
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

export async function loadSnapshot(reader: Reader, id: string, body: Record<string, unknown>): Promise<Snapshot> {
  const repo = await reader.repo(id);
  const ref = field(body.ref, repo.defaultBranch);
  const commit = await reader.resolve(id, ref);
  const composePath = field(body.composePath, "compose.yaml");
  const kitPath = body.kitPath == null ? null : field(body.kitPath, "kit.yaml");
  const [compose, kit] = await Promise.all([
    reader.file(id, composePath, commit),
    kitPath ? reader.file(id, kitPath, commit) : null,
  ]);
  return {
    repo: repo.fullName,
    repoId: repo.id,
    ref,
    commit,
    composePath,
    composeText: compose.content,
    kitPath,
    kitText: kit?.content ?? null,
  };
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

/**
 * An install from a repository the owner manages: its kit, `kit.yaml` unless the owner names another
 * path, read at the commit the branch, tag or commit resolves to now. Every app installs with a kit
 * (decision 2026-11-23), and the kit names the Compose file at its exact commit, as a linked kit does.
 */
export async function previewManagedKit(
  db: Db,
  owner: string,
  connected: GithubClient,
  apps: AppsService,
  id: string,
  body: Record<string, unknown>,
  publicReader = publicGithubClient(),
) {
  const repo = await connected.repo(id);
  const ref = field(body.ref, repo.defaultBranch);
  const kitPath = field(body.kitPath ?? undefined, "kit.yaml");
  const commit = await connected.resolve(id, ref);
  let content: string;
  try {
    content = (await connected.file(id, kitPath, commit)).content;
  } catch (error) {
    if (error instanceof AppError && error.code === "github_not_found") {
      throw new AppError(400, "kit_required", `There is no kit at ${kitPath} in ${repo.fullName} at ${ref}. Give the path of the app's kit in this repository, such as kit.yaml. Every app installs with a kit.`);
    }
    throw error;
  }
  return previewKit(db, owner, connected, apps, { repo, ref, commit, path: kitPath, content }, publicReader);
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
        "GitHub can't find the repository of that kit for your GitHub connection. If it is private, connect GitHub with private access in Repositories, with an account that can read it.",
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

/** A kit may point to a different public upstream. A connected private upstream
 * must already be in this owner's managed repositories before a kit can read it. */
async function targetRepo(
  db: Db,
  owner: string,
  connected: GithubClient | null,
  fullName: string,
  publicReader: Reader,
) {
  try {
    return { repo: await publicReader.repo(fullName), reader: publicReader };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "github_not_found" || !connected) throw error;
    const managed = await db.$client.query(
      "select repo_id from managed_repository where owner_id=$1 and account_id=$2 and lower(full_name)=lower($3)",
      [owner, connected.accountId, fullName],
    );
    if (!managed.rowCount)
      throw new AppError(403, "private_source", "Import the private source repository before installing its kit.");
    return { repo: await connected.repo(managed.rows[0].repo_id), reader: connected };
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
  db: Db,
  owner: string,
  connected: GithubClient | null,
  apps: AppsService,
  url: unknown,
  publicReader = publicGithubClient(),
) {
  return previewKit(db, owner, connected, apps, await linkedKit(connected ?? publicReader, url), publicReader);
}

/**
 * Reviews an app from its kit, read at an exact commit. The Compose file is the one the kit's source
 * names, read at the commit the kit pins, never at a branch's latest commit.
 */
async function previewKit(
  db: Db,
  owner: string,
  connected: GithubClient | null,
  apps: AppsService,
  kit: Awaited<ReturnType<typeof linkedKit>>,
  publicReader: Reader,
) {
  const reader = connected ?? publicReader;
  const { found, compose: file } = kitFile(kit.content);
  const same = file.repo.toLowerCase() === kit.repo.fullName.toLowerCase();
  const target = same ? { repo: kit.repo, reader } : await targetRepo(db, owner, connected, file.repo, publicReader);
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
    {
      repo: target.repo.fullName,
      repoId: target.repo.id,
      ref: file.commit,
      commit: file.commit,
      composePath: file.path,
      composeText: compose,
      kitPath: kit.path,
      kitText: kit.content,
    },
    found,
  );
}
