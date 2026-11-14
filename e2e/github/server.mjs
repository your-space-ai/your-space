// A stand-in for GitHub in the browser tests (spec Q8): the commits API and raw files, served from
// fixtures/<owner>/<repo>/<path>. Every repository is at one commit, on the branch `main`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const root = new URL("./fixtures/", import.meta.url).pathname;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://github");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // GET /repos/<owner>/<repo>/commits/<ref>
  if (parts[0] === "repos" && parts[3] === "commits") {
    const ref = parts.slice(4).join("/");
    if (ref === "main" || ref === COMMIT) return res.writeHead(200, { "Content-Type": "text/plain" }).end(COMMIT);
    return res.writeHead(404).end();
  }
  // GET /<owner>/<repo>/<commit>/<path>
  const [owner, repo, commit, ...path] = parts;
  if (commit !== COMMIT || !owner || !repo || path.length === 0) return res.writeHead(404).end();
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
