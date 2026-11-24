// The commits of the GitHub stand-ins' fixture repositories (spec Q8). Each fixture repository is at
// one commit: the git tree id of its folder under fixtures/, as `git rev-parse HEAD:<folder>` gives
// it. A kit that pins a fixture's Compose file therefore names exactly the files it was written for,
// and the stand-ins serve nothing at any other commit. `node e2e/github/commits.mjs` lists them.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));

function object(type, body) {
  return createHash("sha1").update(`${type} ${body.length}\0`).update(body).digest("hex");
}

/** A folder's git tree id: its entries in git's order, a folder sorting as if its name ended in /. */
function tree(folder) {
  const entries = readdirSync(folder, { withFileTypes: true })
    .map((entry) => {
      const path = join(folder, entry.name);
      return entry.isDirectory()
        ? { mode: "40000", name: entry.name, key: `${entry.name}/`, id: tree(path) }
        : { mode: "100644", name: entry.name, key: entry.name, id: object("blob", readFileSync(path)) };
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  return object("tree", Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.id, "hex")])));
}

/** The commit the fixture repository `owner/repo` is at, or null when there is no such fixture. */
export function fixtureCommit(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) return null;
  const folder = join(root, repo);
  try {
    if (!statSync(folder).isDirectory()) return null;
  } catch {
    return null;
  }
  return tree(folder);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const owner of readdirSync(root)) {
    for (const repo of readdirSync(join(root, owner))) console.log(`${owner}/${repo} ${fixtureCommit(`${owner}/${repo}`)}`);
  }
}
