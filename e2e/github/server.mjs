// A stand-in for GitHub in the browser tests (spec Q8): the commits API and raw files, served from
// fixtures/<owner>/<repo>/<path>. Every repository is at one commit on the branch `main`, the git
// tree id of its fixture folder (commits.mjs), and its files are served only at that commit. It also
// answers which account a token belongs to (`GET /user`, journey 015) for the synthetic tokens below.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCommit } from "./commits.mjs";

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));

// Synthetic tokens and the accounts they belong to; GitHub refuses any other token.
const ACCOUNTS = new Map([["github_pat_ys_fixture_contents", "ys-fixture-owner"]]);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://github");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // GET /user, with the token as a bearer token.
  if (url.pathname === "/user") {
    const authorization = req.headers.authorization ?? "";
    const login = authorization.startsWith("Bearer ") ? ACCOUNTS.get(authorization.slice("Bearer ".length)) : undefined;
    if (!login) return res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Bad credentials" }));
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ login, type: "User" }));
  }
  // GET /repos/<owner>/<repo>/commits?per_page=1 and /repos/<owner>/<repo>/commits/<ref>
  if (parts[0] === "repos" && parts[3] === "commits") {
    const commit = fixtureCommit(`${parts[1]}/${parts[2]}`);
    if (!commit) return res.writeHead(404).end();
    if (parts.length === 4 && url.searchParams.get("per_page") === "1")
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify([{ sha: commit }]));
    const ref = parts.slice(4).join("/");
    if (ref === "main" || ref === commit) return res.writeHead(200, { "Content-Type": "text/plain" }).end(commit);
    return res.writeHead(404).end();
  }
  // GET /<owner>/<repo>/<commit>/<path>
  const [owner, repo, commit, ...path] = parts;
  if (!owner || !repo || path.length === 0 || commit !== fixtureCommit(`${owner}/${repo}`)) return res.writeHead(404).end();
  const file = normalize(join(root, owner, repo, ...path));
  if (!file.startsWith(root)) return res.writeHead(404).end();
  let body;
  try {
    body = await readFile(file);
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { "Content-Type": "text/plain" }).end(body);
}).listen(8080);
