// Fixed-origin GitHub OAuth/REST transport. Public-facing errors never include
// GitHub response bodies, credentials, remote text or the authenticated URL.
import { AppError } from "../apps/service.ts";

export type GithubScope = "public_repo" | "repo";
export interface GithubRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}
type Json = Record<string, unknown>;
const rest = "https://api.github.com";
const limit = 256 * 1024;
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
    if (result.status === 404)
      throw new AppError(
        404,
        "github_not_found",
        "GitHub could not find that repository, revision or file with this connection.",
      );
    if (result.status === 409 || result.status === 422)
      throw new AppError(
        409,
        "github_conflict",
        "GitHub rejected the change. Refresh the repository state before retrying.",
      );
    if (result.status === 401 || result.status === 403)
      throw new AppError(
        403,
        "github_forbidden",
        "GitHub declined this connection or request. Check repository permissions and rate limits.",
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

export function deviceRequest(
  path: "device/code" | "oauth/access_token",
  fields: Record<string, string>,
): Promise<Json> {
  return request("https://github.com/login/" + path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
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

function pathParts(path: string): string {
  if (typeof path !== "string" || path.length > 512 || /[\x00-\x1f\x7f\\]/.test(path)) throw badInput();
  return path
    .split("/")
    .map((p) => {
      if (!p || p === "." || p === ".." || p.toLowerCase() === ".git") throw badInput();
      return encodeURIComponent(p);
    })
    .join("/");
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
  #token: string | null;
  readonly accountId: string;
  readonly scope: GithubScope;

  constructor(token: string | null, accountId: string, scope: GithubScope) {
    this.#token = token;
    this.accountId = accountId;
    this.scope = scope;
  }

  private api(path: string, method = "GET", body?: object) {
    return request(rest + path, {
      method,
      headers: {
        ...(this.#token ? { Authorization: "Bearer " + this.#token } : {}),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "Your-Space",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async account() {
    const data = await this.api("/user");
    if (typeof data.login !== "string") throw badResponse();
    return { id: id(data.id), login: data.login };
  }

  async repo(nameOrNumericId: string) {
    return repository(await this.api(repositoryPath(nameOrNumericId)));
  }

  async create(name: string, privateRepo: boolean) {
    segment(name);
    if (typeof privateRepo !== "boolean" || (privateRepo && this.scope !== "repo")) throw badInput();
    return repository(await this.api("/user/repos", "POST", { name, private: privateRepo, auto_init: true }));
  }

  async fork(id: string, name: string) {
    segment(name);
    return repository(await this.api(repositoryId(id) + "/forks", "POST", { name }));
  }

  async resolve(fullName: string, revision: string) {
    const result = await this.api(repositoryPath(fullName) + "/commits/" + encodeURIComponent(ref(revision)));
    return sha(result.sha);
  }

  async file(fullName: string, path: string, revision: string) {
    const result = await this.api(
      repositoryPath(fullName) + "/contents/" + pathParts(path) + "?ref=" + encodeURIComponent(ref(revision)),
    );
    if (
      result.type !== "file" ||
      result.encoding !== "base64" ||
      result.submodule_git_url ||
      result.target ||
      typeof result.size !== "number" ||
      result.size > limit ||
      typeof result.content !== "string"
    ) {
      throw new AppError(422, "unsupported_repository_file", "Choose a regular UTF-8 file of at most 256 KiB.");
    }
    const data = Buffer.from(result.content, "base64");
    if (data.length !== result.size || data.length > limit) throw badResponse();
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      throw new AppError(422, "unsupported_repository_file", "Choose a UTF-8 text file.");
    }
    return { content, sha: sha(result.sha) };
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

  // Address managed mutations only by GitHub's immutable repository ID. A
  // renamed or transferred repository can never retarget an existing grant.
  async put(id: string, path: string, options: { content: string; message: string; branch: string; sha?: string }) {
    if (
      typeof options.content !== "string" ||
      Buffer.byteLength(options.content) > limit ||
      typeof options.message !== "string" ||
      !options.message.trim() ||
      options.message.length > 512 ||
      (options.sha !== undefined && !/^[0-9a-f]{40}$/i.test(options.sha))
    )
      throw badInput();
    const result = await this.api(repositoryId(id) + "/contents/" + pathParts(path), "PUT", {
      content: Buffer.from(options.content).toString("base64"),
      message: options.message,
      branch: ref(options.branch),
      ...(options.sha !== undefined ? { sha: options.sha } : {}),
    });
    return { commit: sha(object(result.commit).sha), sha: sha(object(result.content).sha) };
  }
}

export function publicGithubClient(): Pick<GithubClient, "repo" | "resolve" | "file" | "kitPaths"> {
  const client = new GithubClient(null, "", "public_repo");
  return {
    repo: (key) => client.repo(key),
    resolve: (key, revision) => client.resolve(key, revision),
    file: (key, path, revision) => client.file(key, path, revision),
    kitPaths: (key, commit) => client.kitPaths(key, commit),
  };
}
