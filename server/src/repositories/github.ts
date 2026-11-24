// Fixed-origin, unauthenticated GitHub REST reads for the kit directory's listing. Public-facing
// errors never include GitHub response bodies or remote text.
import { AppError } from "../apps/service.ts";

export interface GithubRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}
type Json = Record<string, unknown>;
const rest = "https://api.github.com";
const badInput = () =>
  new AppError(400, "invalid_repository_input", "Check the repository, path, revision and file size.");
const badResponse = () =>
  new AppError(502, "github_unavailable", "GitHub did not return a usable response. Try again.");

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badResponse();
  return value as Json;
}

async function request(url: string, options: RequestInit): Promise<Json> {
  let result: Response;
  try {
    result = await fetch(url, { ...options, signal: AbortSignal.timeout(10000), redirect: "error" });
  } catch {
    throw badResponse();
  }
  if (!result.ok || !result.body) {
    await result.body?.cancel().catch(() => {});
    if (result.status === 404 || result.status === 422)
      throw new AppError(
        404,
        "github_not_found",
        "GitHub can't find the kit directory's repository or branch. It must be a public repository.",
      );
    if (result.status === 401 || result.status === 403 || result.status === 429)
      throw new AppError(
        403,
        "github_forbidden",
        "GitHub declined the request for the kit directory. It may be limiting requests from this machine; try again in a few minutes.",
      );
    throw badResponse();
  }
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const packet = await reader.read();
      if (packet.done) break;
      bytes += packet.value.byteLength;
      if (bytes > 768 * 1024) throw badResponse();
      chunks.push(packet.value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw badResponse();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function segment(value: string): string {
  if (typeof value !== "string" || !/^[a-z\d_.-]{1,100}$/i.test(value) || value === "." || value === "..")
    throw badInput();
  return encodeURIComponent(value);
}

function repoParts(fullName: string): string {
  const parts = typeof fullName === "string" ? fullName.split("/") : [];
  if (parts.length !== 2) throw badInput();
  return parts.map(segment).join("/");
}

function repositoryId(value: string): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) throw badInput();
  return "/repositories/" + value;
}

function repositoryPath(value: string): string {
  return typeof value === "string" && /^\d+$/.test(value) ? repositoryId(value) : "/repos/" + repoParts(value);
}

function ref(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    /[\x00-\x20\x7f]/.test(value)
  )
    throw badInput();
  return value;
}

function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) throw badResponse();
  return value;
}

function id(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw badResponse();
  return String(value);
}

function repository(data: Json): GithubRepo {
  if (
    typeof data.full_name !== "string" ||
    typeof data.default_branch !== "string" ||
    typeof data.private !== "boolean"
  )
    throw badResponse();
  return { id: id(data.id), fullName: data.full_name, defaultBranch: data.default_branch, private: data.private };
}

export class GithubClient {
  // Your Space only reads public repositories here: the kit directory's default branch and its kits.
  private api(path: string) {
    return request(rest + path, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Your-Space",
      },
    });
  }

  async repo(nameOrNumericId: string) {
    return repository(await this.api(repositoryPath(nameOrNumericId)));
  }

  async resolve(fullName: string, revision: string) {
    const result = await this.api(repositoryPath(fullName) + "/commits/" + encodeURIComponent(ref(revision)));
    return sha(result.sha);
  }

  async kitPaths(nameOrId: string, commit: string): Promise<string[]> {
    if (typeof commit !== "string" || !/^[0-9a-f]{40}$/i.test(commit)) throw badInput();
    const result = await this.api(repositoryPath(nameOrId) + "/git/trees/" + commit + "?recursive=1");
    if (result.truncated !== false || !Array.isArray(result.tree))
      throw new AppError(422, "catalog_incomplete", "The catalog tree is too large or incomplete.");
    const found: string[] = [];
    for (const entry of result.tree) {
      if (
        !entry ||
        typeof entry !== "object" ||
        entry.type !== "blob" ||
        !["100644", "100755"].includes(entry.mode) ||
        typeof entry.path !== "string" ||
        !/^apps\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.yaml$/.test(entry.path)
      )
        continue;
      found.push(entry.path);
      if (found.length > 500)
        throw new AppError(422, "catalog_incomplete", "The catalog exceeds the supported number of kits.");
    }
    return found.sort();
  }
}

export function publicGithubClient(): Pick<GithubClient, "repo" | "resolve" | "kitPaths"> {
  return new GithubClient();
}
