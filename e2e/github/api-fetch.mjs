// Loaded only by compose.e2e.yaml. The production transport keeps its fixed GitHub origins.
// Synthetic responses cover the public reads the kit directory's listing makes on GitHub's REST API:
// the directory repository, the commit its default branch is at and its tree there.
import { readFileSync } from "node:fs";
import { fixtureCommit } from "./commits.mjs";

const realFetch = globalThis.fetch;
const fixture = (repo, path) => readFileSync(new URL("./fixtures/" + repo + "/" + path, import.meta.url), "utf8");
const repositories = new Map();
let nextId = 10;
function repo(fullName, files, head) {
  const id = nextId++;
  repositories.set(String(id), { metadata: { id, full_name: fullName, default_branch: "main", private: false }, files, head });
}
const kits = "ys-fixtures/catalog";
const kitPath = "apps/ys-fixtures/whoami.yaml";
// The directory is at the commit the other stand-in serves it at.
repo(kits, { [kitPath]: fixture(kits, kitPath) }, fixtureCommit(kits));
const ok = (value, status = 200) => Response.json(value, { status });
const missing = () => ok({}, 404);

globalThis.fetch = async function (input, options = {}) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== "https://api.github.com") return realFetch(input, options);
  if ((options.method ?? "GET") !== "GET") return ok({}, 405);
  const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
  const byId = parts[0] === "repositories";
  const target = byId
    ? repositories.get(parts[1])
    : [...repositories.values()].find((r) => r.metadata.full_name === parts[1] + "/" + parts[2]);
  if (!target) return missing();
  const [operation, ...rest] = parts.slice(byId ? 2 : 3);
  if (!operation) return ok(target.metadata);
  const at = (ref) => (ref === "main" || ref === target.head ? target.files : undefined);
  if (operation === "commits" && at(rest[0])) return ok({ sha: target.head });
  if (operation === "git" && rest[0] === "trees" && at(rest[1]))
    return ok({
      truncated: false,
      tree: Object.keys(at(rest[1])).map((path) => ({ path, type: "blob", mode: "100644" })),
    });
  return missing();
};
