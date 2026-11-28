// Turns a GitHub link into one file at an exact commit (component C, FR-003, FR-026): an app's kit,
// and the Compose file the kit names. It reads public repositories anonymously, and a private one
// through the workspace's source credential, the GitHub connection's token (journey 015, R2): only
// GitHub's commits and contents endpoints, and only this adapter knows how the token is sent. It also
// asks GitHub which account a token belongs to, and which scopes a classic one has.

/**
 * Why GitHub gave no file: `not_found`, it shows no such repository, as for a private repository read
 * anonymously; `not_visible`, it doesn't show the repository to the credential; `no_ref`, the
 * repository is there, but not the branch, tag or commit; `no_file`, the repository and commit are
 * there, but not the file.
 */
export type SourceMiss = "not_found" | "not_visible" | "no_ref" | "no_file";

export class SourceError extends Error {
  readonly miss: SourceMiss | null;
  constructor(message: string, miss: SourceMiss | null = null) {
    super(message);
    this.name = "SourceError";
    this.miss = miss;
  }
}

/**
 * A source credential (journey 015): lets Your Space read a file it can't read anonymously. Its first
 * adapter is a fine-grained GitHub token with Contents read, which only this file sends.
 */
export interface SourceCredential {
  /** The GitHub account the token belongs to, as GitHub last said. */
  readonly login: string;
  readonly token: string;
}

/** How Your Space read a kit or a Compose file (R4): anonymously, or through the GitHub connection. */
export type FileRead = { read: "anonymous" } | { read: "connection"; login: string };

export interface GithubEndpoints {
  /** https://api.github.com, or a stand-in in tests. */
  api: string;
  /** https://raw.githubusercontent.com, or a stand-in in tests. */
  raw: string;
}

/**
 * The registry the image token signs the engine in to (journey 015, R9): `ghcr.io`, or in the browser
 * tests a local registry that stands in for it.
 */
export function githubRegistry(env: NodeJS.ProcessEnv = process.env): string {
  return env.YS_E2E_GHCR || "ghcr.io";
}

export function githubEndpoints(env: NodeJS.ProcessEnv = process.env): GithubEndpoints {
  return {
    api: (env.YS_E2E_GITHUB_API || "https://api.github.com").replace(/\/$/, ""),
    raw: (env.YS_E2E_GITHUB_RAW || "https://raw.githubusercontent.com").replace(/\/$/, ""),
  };
}

export interface FileLink {
  /** `owner/name`, as written in the link. */
  repo: string;
  /** Path segments after the repository: the ref and the path, not yet told apart. */
  rest: string[];
}

export interface SourceFile {
  link: string;
  repo: string;
  ref: string;
  path: string;
  commit: string;
  text: string;
  /** The same file at its commit, for the record. */
  pinnedLink: string;
  /** How it was read from GitHub; a file given on this machine wasn't. */
  read?: FileRead;
}

const NAME = /^[A-Za-z0-9_.-]+$/;
export const MAX_FILE_BYTES = 256 * 1024;

/**
 * `https://github.com/<owner>/<repo>/blob/<ref>/<path>`, or the raw form of it. Each part is decoded
 * once, and none may be `.` or `..` or hide a slash, so the ref and the path can't step out of the
 * repository in the URLs built from them.
 */
export function parseLink(link: string): FileLink {
  const input = link.trim();
  // The URL parser drops tabs and newlines, and control characters at the ends, before it resolves
  // `.` and `..` parts. A link has none, so the parts hasDotPart checks are the ones it parses.
  const url = /[\x00-\x1f\x7f]/.test(input) ? null : URL.parse(input);
  if (!url) throw new SourceError("That isn't a link. Paste the GitHub link to the app's kit.");
  const segments = hasDotPart(input) ? null : decodedSegments(url.pathname);
  if (segments && url.protocol === "https:" && url.hostname === "github.com") {
    const [owner, name, kind, ...rest] = segments;
    if (owner && name && NAME.test(owner) && NAME.test(name) && (kind === "blob" || kind === "raw") && rest.length >= 2) {
      return { repo: `${owner}/${name}`, rest };
    }
  }
  if (segments && url.protocol === "https:" && url.hostname === "raw.githubusercontent.com") {
    const [owner, name, ...rest] = segments;
    if (owner && name && NAME.test(owner) && NAME.test(name) && rest.length >= 2) return { repo: `${owner}/${name}`, rest };
  }
  throw new SourceError(
    "Your Space installs an app from its kit, a file in a GitHub repository. Open the kit on GitHub and paste its link, like https://github.com/owner/repo/blob/main/kit.yaml.",
  );
}

/**
 * Whether a link's path, as written, has a `.` or `..` part, `%2e` for a dot included, which the
 * URL parser would resolve away before the parts are checked.
 */
function hasDotPart(link: string): boolean {
  const path = link.replace(/^[^:/?#]*:\/\/[^/\\?#]*/, "").split(/[?#]/)[0]!;
  return path.split(/[/\\]/).some((part) => /^(\.|%2e){1,2}$/i.test(part));
}

/** A link's path parts, decoded, or null when one doesn't decode or isn't a single plain part. */
function decodedSegments(pathname: string): string[] | null {
  try {
    const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return segments.some((part) => part === "." || part === ".." || part.includes("/")) ? null : segments;
  } catch {
    return null;
  }
}

type Fetch = typeof fetch;

const UNREACHABLE = "GitHub can't be reached right now. Check this machine's internet connection and try again.";

/**
 * A GET to GitHub, anonymous or with the credential's token. The token goes only to the API, and a
 * redirect isn't followed with it (refusal says the repository moved), so it never reaches another
 * address.
 */
async function get(fetcher: Fetch, url: string, accept: string, credential?: SourceCredential): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, "User-Agent": "your-space" };
  if (credential) {
    headers.Authorization = `Bearer ${credential.token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  try {
    return await fetcher(url, { headers, signal: AbortSignal.timeout(20_000), ...(credential ? { redirect: "manual" as const } : {}) });
  } catch {
    throw new SourceError(UNREACHABLE);
  }
}

/** GitHub's primary rate limit (no requests remaining) or a secondary one (a 403 or 429 with Retry-After). */
function rateLimited(res: Response): boolean {
  return res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
}

/** GitHub's answer to a request with the credential, when it isn't one the caller reads. */
function refusal(res: Response, repo: string, credential: SourceCredential): Error {
  if (res.status === 401) return new TokenRefusedError();
  // GitHub redirects a renamed or transferred repository's API requests to its new place.
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return new RepositoryMovedError(`GitHub says ${repo} has moved: it was renamed or transferred. Use the link from its new place on GitHub.`);
  }
  if (rateLimited(res)) return new SourceError("GitHub is limiting requests from this machine. Try again in a few minutes.");
  // An organization can require approving a fine-grained token, block such tokens, or require
  // single sign-on; GitHub then refuses the repository to the token.
  if (res.status === 403 || res.status === 404) return notVisible(repo, credential);
  return new SourceError(`GitHub answered ${res.status}. Try again later.`);
}

/** A renamed or transferred repository, which GitHub redirects; the redirect isn't followed with the token. */
class RepositoryMovedError extends SourceError {}

/**
 * GitHub doesn't show the repository to the credential. For a kit, the fix may be the pasted link; for
 * the Compose file a kit pins, it is the kit's `source.repo`.
 */
function notVisible(repo: string, credential: SourceCredential, compose = false): SourceError {
  const [owner, name] = repo.split("/");
  return new SourceError(
    `GitHub doesn't show ${repo}${compose ? ", where the kit's Compose file is," : ""} to your GitHub connection (@${credential.login}). Check ${compose ? "the kit's source.repo" : "the link"}, and that the token can read ${repo}: at GitHub, its resource owner must be ${owner}, and its repositories must include ${name}. An organization may also need to approve the token.`,
    "not_visible",
  );
}

/**
 * The commit a ref names. A branch name can contain slashes, so each split is tried in turn. GitHub
 * answers 422 for a ref a repository doesn't have, 409 for any ref of an empty repository, and 404
 * for a repository it doesn't show.
 */
async function resolveRef(fetcher: Fetch, endpoints: GithubEndpoints, link: FileLink, credential?: SourceCredential): Promise<{ ref: string; path: string; commit: string }> {
  let shown = false;
  for (let i = 1; i < link.rest.length; i++) {
    const ref = link.rest.slice(0, i).join("/");
    const path = link.rest.slice(i).join("/");
    const res = await get(fetcher, `${endpoints.api}/repos/${link.repo}/commits/${encodeURIComponent(ref)}`, "application/vnd.github.sha", credential);
    if (res.ok) {
      const commit = (await res.text()).trim();
      if (/^[0-9a-f]{40}$/.test(commit)) return { ref, path, commit };
      throw new SourceError("GitHub answered with something that isn't a commit.");
    }
    if (res.status === 409 || res.status === 422) shown = true;
    if (res.status === 404 || res.status === 409 || res.status === 422) continue;
    if (credential) throw refusal(res, link.repo, credential);
    if (rateLimited(res)) throw new SourceError("GitHub is limiting requests from this machine. Try again in a few minutes.");
    throw new SourceError(`GitHub answered ${res.status}. Try again later.`);
  }
  const noRef = new SourceError(`Your Space can't find that branch, tag or commit in ${link.repo}.`, "no_ref");
  if (shown) throw noRef;
  if (credential) {
    // Every split answered 404. The repository's latest commit tells a repository GitHub doesn't show
    // the token from a ref it doesn't have; an empty repository answers 409.
    const res = await get(fetcher, `${endpoints.api}/repos/${link.repo}/commits?per_page=1`, "application/vnd.github+json", credential);
    if (!res.ok && res.status !== 409) throw refusal(res, link.repo, credential);
    throw noRef;
  }
  throw new SourceError(`Your Space can't find ${link.repo}, or that branch, tag or commit in it, on public GitHub.`, "not_found");
}

/**
 * Whether a ref is one of the repository's branches, rather than a tag or a commit (journey 019): a
 * kit installed from a commit or a tag follows the default branch for an update. Read anonymously, or
 * with the credential the kit was read with.
 */
export async function isBranch(repo: string, ref: string, endpoints: GithubEndpoints = githubEndpoints(), fetcher: Fetch = fetch, credential?: SourceCredential): Promise<boolean> {
  if (/^[0-9a-f]{40}$/.test(ref)) return false;
  const res = await get(fetcher, `${endpoints.api}/repos/${repo}/branches/${encodeURIComponent(ref)}`, "application/vnd.github+json", credential);
  if (res.ok) return true;
  if (res.status === 404) return false;
  if (credential) throw refusal(res, repo, credential);
  if (rateLimited(res)) throw new SourceError("GitHub is limiting requests from this machine. Try again in a few minutes.");
  throw new SourceError(`GitHub answered ${res.status}. Try again later.`);
}

/** The link to a file on a repository's default branch, which GitHub's API names `HEAD`. */
export function defaultBranchLink(repo: string, path: string): string {
  return `https://github.com/${repo}/blob/HEAD/${encodePath(path)}`;
}

/**
 * The file at a link, read anonymously from public GitHub. A repository GitHub doesn't show without a
 * token, as a private one, fails with the miss `not_found`; only then may the connection be used (R1).
 */
export async function fetchSource(link: string, endpoints: GithubEndpoints = githubEndpoints(), fetcher: Fetch = fetch): Promise<SourceFile> {
  const parsed = parseLink(link);
  const { ref, path, commit } = await resolveRef(fetcher, endpoints, parsed);
  return readResolvedFile(parsed.repo, ref, path, commit, link.trim(), endpoints, fetcher);
}

/**
 * The file at a link, read through the source credential (R2): the ref resolved with the commits API,
 * and the file read at that commit with the contents API, as its raw text. A token GitHub refuses
 * throws TokenRefusedError.
 */
export async function fetchSourceWith(
  credential: SourceCredential,
  link: string,
  endpoints: GithubEndpoints = githubEndpoints(),
  fetcher: Fetch = fetch,
): Promise<SourceFile> {
  const parsed = parseLink(link);
  const { ref, path, commit } = await resolveRef(fetcher, endpoints, parsed, credential);
  return readWith(credential, parsed.repo, ref, path, commit, link.trim(), endpoints, fetcher);
}

/**
 * The Compose file a kit pins, `path` in `repo` at exactly `commit`, read through the source credential
 * (R2), as fetchSourceWith reads a kit: the commits API confirms the commit, and the contents API gives
 * the file at it. A token GitHub refuses throws TokenRefusedError.
 */
export async function fetchPinnedFileWith(
  credential: SourceCredential,
  repo: string,
  path: string,
  commit: string,
  endpoints: GithubEndpoints = githubEndpoints(),
  fetcher: Fetch = fetch,
): Promise<SourceFile> {
  await resolvePinned(fetcher, endpoints, repo, path, commit, credential);
  try {
    return await readWith(credential, repo, commit, path, commit, pinnedLink(repo, path, commit), endpoints, fetcher);
  } catch (error) {
    throw composeMiss(error, repo, commit, credential);
  }
}

/** The file at a commit the credential's token resolved, read with the contents API as raw text. */
async function readWith(
  credential: SourceCredential,
  repo: string,
  ref: string,
  path: string,
  commit: string,
  link: string,
  endpoints: GithubEndpoints,
  fetcher: Fetch,
): Promise<SourceFile> {
  const res = await get(fetcher, `${endpoints.api}/repos/${repo}/contents/${encodePath(path)}?ref=${commit}`, "application/vnd.github.raw+json", credential);
  // The commit resolved through the token, so the repository is visible: a 404 is the file.
  if (res.status === 404) throw new SourceError(`There is no file ${path} in ${repo} at ${ref}.`, "no_file");
  if (!res.ok) throw refusal(res, repo, credential);
  const text = await fileText(res, path);
  return { link, repo, ref, path, commit, text, pinnedLink: pinnedLink(repo, path, commit), read: { read: "connection", login: credential.login } };
}

/**
 * Whether GitHub shows the commit a kit pins, anonymously or to the credential: the commits API is
 * asked for exactly that commit, once. It throws the miss: `not_found` when public GitHub doesn't show
 * the repository, as for a private one; `no_ref` when the repository is there but not the commit; and
 * through the credential, `not_visible` when GitHub doesn't show it the repository.
 */
async function resolvePinned(fetcher: Fetch, endpoints: GithubEndpoints, repo: string, path: string, commit: string, credential?: SourceCredential): Promise<void> {
  let resolved: string;
  try {
    // The path as one part, so the commit is the only ref tried.
    ({ commit: resolved } = await resolveRef(fetcher, endpoints, { repo, rest: [commit, path] }, credential));
  } catch (error) {
    throw composeMiss(error, repo, commit, credential);
  }
  // A branch or tag can be named like a commit; the kit pins the commit itself.
  if (resolved !== commit) throw new SourceError(`GitHub answered ${commit} in ${repo} with another commit, ${resolved}.`);
}

/**
 * A problem reading the Compose file a kit pins, worded for what fixes it: the kit's `source`, not a
 * link the owner pasted.
 */
function composeMiss(error: unknown, repo: string, commit: string, credential?: SourceCredential): unknown {
  if (error instanceof RepositoryMovedError) {
    return new RepositoryMovedError(`GitHub says ${repo}, where the kit's Compose file is, has moved: it was renamed or transferred. Point the kit's source.repo at its new place.`);
  }
  if (!(error instanceof SourceError)) return error;
  if (error.miss === "no_ref") return new SourceError(`Your Space can't find the commit the kit pins, ${commit}, in ${repo}.`, "no_ref");
  if (error.miss === "not_found") return new SourceError(`Your Space can't find ${repo}, where the kit's Compose file is, on public GitHub.`, "not_found");
  if (error.miss === "not_visible" && credential) return notVisible(repo, credential, true);
  return error;
}

/** GitHub doesn't accept a token: it is wrong, expired, deleted or revoked. */
export class TokenRefusedError extends Error {
  constructor() {
    super("GitHub doesn't accept this token.");
    this.name = "TokenRefusedError";
  }
}

/**
 * Whether a token is a fine-grained personal access token, the only kind a contents token may be
 * (decision 1): GitHub starts each one with `github_pat_`, and a classic one, whose scopes reach
 * every repository its account can, with `ghp_`.
 */
export function isFineGrainedToken(token: string): boolean {
  return token.startsWith("github_pat_");
}

/**
 * Whether a token is a personal access token (classic), the only kind GHCR takes (decision 4): GitHub
 * starts each one with `ghp_`.
 */
export function isClassicToken(token: string): boolean {
  return token.startsWith("ghp_");
}

/** The only scope the image token may have (R2): it downloads container images and reads their metadata. */
export const IMAGE_SCOPE = "read:packages";

// A login is only shown, so any short run of letters, digits, hyphens and underscores will do:
// managed users' logins end in `_<shortcode>`.
const LOGIN = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The account a token belongs to (`GET /user`, R2): the one request the connection makes besides
 * reading files. For a classic token, GitHub's `X-OAuth-Scopes` header lists its scopes; `scopes` is
 * null when there is no such header, as for a fine-grained token. Only this adapter knows how a token
 * is sent. Redirects aren't followed, so the token goes only to the API it was meant for.
 */
export async function githubAccount(
  token: string,
  endpoints: GithubEndpoints = githubEndpoints(),
  fetcher: Fetch = fetch,
): Promise<{ login: string; scopes: string[] | null }> {
  let res: Response;
  try {
    res = await fetcher(`${endpoints.api}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "your-space",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SourceError(UNREACHABLE);
  }
  if (res.status === 401) throw new TokenRefusedError();
  if (rateLimited(res)) throw new SourceError("GitHub is limiting requests from this machine. Try again in a few minutes.");
  if (!res.ok) throw new SourceError(`GitHub answered ${res.status}. Try again later.`);
  const body = (await res.json().catch(() => undefined)) as { login?: unknown } | undefined;
  if (typeof body?.login !== "string" || !LOGIN.test(body.login)) throw new SourceError("GitHub answered with something that isn't an account.");
  const header = res.headers.get("x-oauth-scopes");
  const scopes = header === null ? null : header.split(",").map((scope) => scope.trim()).filter(Boolean);
  return { login: body.login, scopes };
}

/** A path's segments, each encoded for a URL. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The link to a file at a commit, as the record keeps it. */
function pinnedLink(repo: string, path: string, commit: string): string {
  return `https://github.com/${repo}/blob/${commit}/${encodePath(path)}`;
}

/**
 * The Compose file a kit pins, read anonymously from public GitHub's raw files. They answer 404 alike
 * for a repository GitHub doesn't show without a token, a commit it doesn't have and a file that isn't
 * there, so a 404 asks the commits API which: only the miss `not_found`, a repository public GitHub
 * doesn't show, may be read again through the connection (R1).
 */
export async function fetchPinnedFile(repo: string, path: string, commit: string, endpoints: GithubEndpoints, fetcher: Fetch): Promise<SourceFile> {
  try {
    return await readResolvedFile(repo, commit, path, commit, pinnedLink(repo, path, commit), endpoints, fetcher);
  } catch (error) {
    if (!(error instanceof SourceError && error.miss === "no_file")) throw error;
    await resolvePinned(fetcher, endpoints, repo, path, commit);
    throw error;
  }
}

async function readResolvedFile(repo: string, ref: string, path: string, commit: string, link: string, endpoints: GithubEndpoints, fetcher: Fetch): Promise<SourceFile> {
  const res = await get(fetcher, `${endpoints.raw}/${repo}/${commit}/${encodePath(path)}`, "text/plain");
  if (res.status === 404) throw new SourceError(`There is no file ${path} in ${repo} at ${ref}.`, "no_file");
  if (!res.ok) throw new SourceError(`GitHub answered ${res.status} for the file. Try again later.`);
  const text = await fileText(res, path);
  return { link, repo, ref, path, commit, text, pinnedLink: pinnedLink(repo, path, commit), read: { read: "anonymous" } };
}

/** A file's text: at most 256 KiB of UTF-8, however it was read. */
async function fileText(res: Response, path: string): Promise<string> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_BYTES) throw new SourceError(`${path} is larger than a kit or Compose file should be.`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new SourceError(`${path} is larger than a kit or Compose file should be.`);
  let text: string;
  try {
    // Preserve a byte-order mark when hashing the exact kit file.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SourceError("Choose a UTF-8 file.");
  }
  return text;
}
