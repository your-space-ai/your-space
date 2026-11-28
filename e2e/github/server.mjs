// A stand-in for GitHub in the browser tests (spec Q8): the commits API and raw files, served from
// fixtures/<owner>/<repo>/<path>. Every repository is at one commit on the branch `main`, the git
// tree id of its fixture folder (commits.mjs), and its files are served only at that commit. It also
// answers which account a token belongs to (`GET /user`, journey 015) for the synthetic tokens below,
// and for a classic one, its scopes in the `X-OAuth-Scopes` header, as GitHub does.
// A private repository answers 404 to anyone without a token it was given to, as GitHub does, and
// serves its commits and its files, through the contents API, to one with it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCommit } from "./commits.mjs";

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));

// Synthetic tokens and the accounts they belong to; GitHub refuses any other token.
const CONTENTS_TOKEN = "github_pat_ys_fixture_contents";
// Classic tokens for the image token (slice 4). The browser tests' registry, which stands in for
// ghcr.io, takes the first, as e2e/registry/htpasswd says; it doesn't know the second's account.
const IMAGE_TOKEN = "ghp_ys_fixture_packages";
const OTHER_IMAGE_TOKEN = "ghp_ys_fixture_packages_other";
const WIDE_TOKEN = "ghp_ys_fixture_packages_wide";
const ACCOUNTS = new Map([
  [CONTENTS_TOKEN, "ys-fixture-owner"],
  [IMAGE_TOKEN, "ys-fixture-owner"],
  [OTHER_IMAGE_TOKEN, "ys-fixture-other"],
  [WIDE_TOKEN, "ys-fixture-owner"],
]);
const SCOPES = new Map([
  [IMAGE_TOKEN, "read:packages"],
  [OTHER_IMAGE_TOKEN, "read:packages"],
  [WIDE_TOKEN, "read:packages, write:packages, repo"],
]);
// Private repositories, and the tokens that can read each. Kept here, not in the fixture folders, so
// a fixture's commit stays the tree id of its files.
const PRIVATE = new Map([
  ["ys-fixtures/private-kits", [CONTENTS_TOKEN]],
  ["ys-fixtures/private-app", [CONTENTS_TOKEN]],
  ["ys-fixtures/private-other", []],
]);
// Tokens deleted at the stand-in, as an owner deletes one at GitHub: GitHub refuses them from then on.
const deleted = new Set();
// Journey 019: repositories whose `main` the browser tests move on to another fixture folder's files,
// as a new commit does. The files of both stay served, each at its own commit.
const NEXT = new Map([["ys-fixtures/updates", "ys-fixtures/updates-next"]]);
const advanced = new Set();
/** The fixture folder a repository's files at a commit come from, or null. */
function folderAt(repo, commit) {
  if (commit === fixtureCommit(repo)) return repo;
  if (NEXT.has(repo) && advanced.has(repo) && commit === fixtureCommit(NEXT.get(repo))) return NEXT.get(repo);
  return null;
}
/** The commit a repository's `main`, its default branch, is at. */
const headOf = (repo) => fixtureCommit(advanced.has(repo) ? NEXT.get(repo) : repo);

const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));

createServer(async (req, res) => {
  const url = new URL(req.url, "http://github");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  // Not GitHub's: the browser tests delete a token here, from inside the stack.
  if (req.method === "POST" && url.pathname === "/_stand-in/delete-token") {
    let body = "";
    for await (const chunk of req) body += chunk;
    deleted.add(body.trim());
    return res.writeHead(204).end();
  }
  // Not GitHub's either: moves a repository's `main` on to its next commit (journey 019).
  if (req.method === "POST" && url.pathname === "/_stand-in/advance") {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (!NEXT.has(body.trim())) return res.writeHead(404).end();
    advanced.add(body.trim());
    return res.writeHead(204).end();
  }
  // GitHub refuses a token it doesn't know on every request, even for a public repository.
  const login = token && !deleted.has(token) ? ACCOUNTS.get(token) : undefined;
  if (token && !login) return json(res, 401, { message: "Bad credentials" });
  // GET /user, with the token as a bearer token.
  if (url.pathname === "/user") {
    if (!login) return json(res, 401, { message: "Requires authentication" });
    if (SCOPES.has(token)) res.setHeader("X-OAuth-Scopes", SCOPES.get(token));
    return json(res, 200, { login, type: "User" });
  }
  if (parts[0] === "repos" && parts.length >= 4) {
    const repo = `${parts[1]}/${parts[2]}`;
    const commit = headOf(repo);
    const hidden = PRIVATE.has(repo) && !PRIVATE.get(repo).includes(token);
    if (!commit || hidden) return json(res, 404, { message: "Not Found" });
    // GET /repos/<owner>/<repo>/commits?per_page=1 and /repos/<owner>/<repo>/commits/<ref>
    if (parts[3] === "commits") {
      if (parts.length === 4 && url.searchParams.get("per_page") === "1") return json(res, 200, [{ sha: commit }]);
      const ref = parts.slice(4).join("/");
      // HEAD names the default branch, as GitHub's API takes it (journey 019).
      if (ref === "main" || ref === "HEAD") return res.writeHead(200, { "Content-Type": "text/plain" }).end(commit);
      if (folderAt(repo, ref)) return res.writeHead(200, { "Content-Type": "text/plain" }).end(ref);
      return json(res, 422, { message: `No commit found for SHA: ${ref}` });
    }
    // GET /repos/<owner>/<repo>/branches/<name>: every repository has the one branch, main.
    if (parts[3] === "branches") {
      return parts.slice(4).join("/") === "main" ? json(res, 200, { name: "main", commit: { sha: commit } }) : json(res, 404, { message: "Branch not found" });
    }
    // GET /repos/<owner>/<repo>/contents/<path>?ref=<commit>, as raw text.
    const folder = folderAt(repo, url.searchParams.get("ref"));
    if (parts[3] === "contents" && (req.headers.accept ?? "").includes("application/vnd.github.raw") && folder) {
      return serveFile(res, [...folder.split("/"), ...parts.slice(4)]);
    }
    return json(res, 404, { message: "Not Found" });
  }
  // GET /<owner>/<repo>/<commit>/<path>: raw files of public repositories only.
  const [owner, repo, commit, ...path] = parts;
  const folder = owner && repo ? folderAt(`${owner}/${repo}`, commit) : null;
  if (!folder || path.length === 0 || PRIVATE.has(`${owner}/${repo}`)) return res.writeHead(404).end();
  return serveFile(res, [...folder.split("/"), ...path]);
}).listen(8080);

async function serveFile(res, segments) {
  const file = normalize(join(root, ...segments));
  if (!file.startsWith(root)) return res.writeHead(404).end();
  let body;
  try {
    body = await readFile(file);
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { "Content-Type": "text/plain" }).end(body);
}
