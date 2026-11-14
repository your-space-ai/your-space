// Turns a GitHub link into one file at an exact commit (component C, FR-003, FR-026). Only public
// repositories; GitHub answers 404 for private ones.

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export interface GithubEndpoints {
  /** https://api.github.com, or a stand-in in tests. */
  api: string;
  /** https://raw.githubusercontent.com, or a stand-in in tests. */
  raw: string;
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
}

const NAME = /^[A-Za-z0-9_.-]+$/;
export const MAX_FILE_BYTES = 256 * 1024;

/** `https://github.com/<owner>/<repo>/blob/<ref>/<path>`, or the raw form of it. */
export function parseLink(link: string): FileLink {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new SourceError("That isn't a link. Paste the GitHub link to the app's Compose file.");
  }
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.protocol === "https:" && url.hostname === "github.com") {
    const [owner, name, kind, ...rest] = segments;
    if (owner && name && NAME.test(owner) && NAME.test(name) && (kind === "blob" || kind === "raw") && rest.length >= 2) {
      return { repo: `${owner}/${name}`, rest };
    }
  }
  if (url.protocol === "https:" && url.hostname === "raw.githubusercontent.com") {
    const [owner, name, ...rest] = segments;
    if (owner && name && NAME.test(owner) && NAME.test(name) && rest.length >= 2) return { repo: `${owner}/${name}`, rest };
  }
  throw new SourceError(
    "Your Space installs from a file in a public GitHub repository. Open the app's Compose file on GitHub and paste its link, like https://github.com/owner/repo/blob/main/compose.yaml.",
  );
}

type Fetch = typeof fetch;

async function get(fetcher: Fetch, url: string, accept: string): Promise<Response> {
  try {
    return await fetcher(url, { headers: { Accept: accept, "User-Agent": "your-space" }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new SourceError("GitHub can't be reached right now. Check this machine's internet connection and try again.");
  }
}

function rateLimited(res: Response): boolean {
  return res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
}

/** The commit a ref names. A branch name can contain slashes, so each split is tried in turn. */
async function resolveRef(fetcher: Fetch, endpoints: GithubEndpoints, link: FileLink): Promise<{ ref: string; path: string; commit: string }> {
  for (let i = 1; i < link.rest.length; i++) {
    const ref = link.rest.slice(0, i).join("/");
    const path = link.rest.slice(i).join("/");
    const res = await get(fetcher, `${endpoints.api}/repos/${link.repo}/commits/${encodeURIComponent(ref)}`, "application/vnd.github.sha");
    if (res.ok) {
      const commit = (await res.text()).trim();
      if (/^[0-9a-f]{40}$/.test(commit)) return { ref, path, commit };
      throw new SourceError("GitHub answered with something that isn't a commit.");
    }
    if (rateLimited(res)) throw new SourceError("GitHub is limiting requests from this machine. Try again in a few minutes.");
    if (res.status !== 404 && res.status !== 422) throw new SourceError(`GitHub answered ${res.status}. Try again later.`);
  }
  throw new SourceError(`Your Space can't find that branch, tag or commit in ${link.repo}. The repository must be public.`);
}

export async function fetchSource(link: string, endpoints: GithubEndpoints = githubEndpoints(), fetcher: Fetch = fetch): Promise<SourceFile> {
  const parsed = parseLink(link);
  const { ref, path, commit } = await resolveRef(fetcher, endpoints, parsed);
  const res = await get(fetcher, `${endpoints.raw}/${parsed.repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, "text/plain");
  if (res.status === 404) throw new SourceError(`There is no file ${path} in ${parsed.repo} at ${ref}.`);
  if (!res.ok) throw new SourceError(`GitHub answered ${res.status} for the file. Try again later.`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_BYTES) throw new SourceError("The file is larger than a Compose file should be.");
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new SourceError("The file is larger than a Compose file should be.");
  return { link: link.trim(), repo: parsed.repo, ref, path, commit, text, pinnedLink: `https://github.com/${parsed.repo}/blob/${commit}/${path}` };
}
