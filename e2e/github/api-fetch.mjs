// Loaded only by compose.e2e.yaml. The production transport keeps its fixed GitHub origins.
// Synthetic responses cover the device exchange and the reads a GitHub connection makes: the kit
// directory, kits and the Compose files they name. Each repository keeps every commit's files, so a
// kit can pin a Compose file to an earlier commit.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fixtureCommit, PRIVATE_FIXTURE } from "./commits.mjs";

const realFetch = globalThis.fetch;
const fixture = (repo, path) => readFileSync(new URL("./fixtures/" + repo + "/" + path, import.meta.url), "utf8");
const hash = (value) => createHash("sha1").update(value).digest("hex");
const repositories = new Map();
let nextId = 10;
let requestedScope;
let pollCount = 0;
function repo(fullName, privateRepo, files, head, history = new Map([[head, { ...files }]])) {
  const id = nextId++;
  repositories.set(String(id), { metadata: { id, full_name: fullName, default_branch: "main", private: privateRepo }, head, history });
}
const kits = "ys-fixtures/catalog";
const upstream = "ys-fixtures/whoami";
const kitPath = "apps/ys-fixtures/whoami.yaml";
// The fixture repositories are at the commits the other stand-in serves them at.
repo(kits, false, { [kitPath]: fixture(kits, kitPath) }, fixtureCommit(kits));
repo(upstream, false, { "compose.yaml": fixture(upstream, "compose.yaml"), "README.md": "A fixture app.\n" }, fixtureCommit(upstream));
// The private repository: its Compose file first, then the kit that pins it.
const privateCompose = { "compose.yaml": fixture(upstream, "compose.yaml") };
const privateFiles = {
  ...privateCompose,
  "kit.yaml": [
    "kit: 1",
    `source: { repo: ${PRIVATE_FIXTURE.repo}, path: compose.yaml, commit: ${PRIVATE_FIXTURE.compose} }`,
    "name: private-whoami",
    "title: Private Who Am I",
    "interface: { service: web, port: 80 }",
    "",
  ].join("\n"),
};
repo(PRIVATE_FIXTURE.repo, true, privateFiles, PRIVATE_FIXTURE.kit, new Map([
  [PRIVATE_FIXTURE.compose, privateCompose],
  [PRIVATE_FIXTURE.kit, privateFiles],
]));
const ok = (value, status = 200) => Response.json(value, { status });
const missing = () => ok({}, 404);

globalThis.fetch = async function (input, options = {}) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin === "https://github.com") {
    const fields = new URLSearchParams(options.body);
    if (url.pathname === "/login/device/code" && fields.get("client_id") === "your-space-e2e") {
      requestedScope = fields.get("scope");
      pollCount = 0;
      return ok({
        device_code: "fixture-device",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 600,
        interval: 5,
      });
    }
    if (
      url.pathname === "/login/oauth/access_token" &&
      fields.get("device_code") === "fixture-device" &&
      fields.get("client_id") === "your-space-e2e"
    ) {
      return ++pollCount === 1
        ? ok({ error: "authorization_pending" })
        : ok({ access_token: "fixture-authorization", scope: requestedScope, token_type: "bearer" });
    }
    return missing();
  }
  if (url.origin !== "https://api.github.com") return realFetch(input, options);
  // A connection only reads.
  if ((options.method ?? "GET") !== "GET") return ok({}, 405);
  const authenticated = new Headers(options.headers).get("Authorization") === "Bearer fixture-authorization";
  if (url.pathname === "/user" && authenticated) return ok({ id: 17, login: "fixture-owner" });
  const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
  const byId = parts[0] === "repositories";
  const target = byId
    ? repositories.get(parts[1])
    : [...repositories.values()].find((r) => r.metadata.full_name === parts[1] + "/" + parts[2]);
  if (!target || (!authenticated && target.metadata.private)) return missing();
  const [operation, ...rest] = parts.slice(byId ? 2 : 3);
  if (!operation) return ok(target.metadata);
  // `main` is the head; any earlier commit of the repository can be read too.
  const at = (ref) => target.history.get(ref === "main" ? target.head : ref);
  if (operation === "commits" && at(rest[0])) return ok({ sha: rest[0] === "main" ? target.head : rest[0] });
  if (operation === "git" && rest[0] === "trees" && at(rest[1]))
    return ok({
      truncated: false,
      tree: Object.keys(at(rest[1])).map((path) => ({ path, type: "blob", mode: "100644" })),
    });
  if (operation !== "contents") return missing();
  const path = rest.join("/");
  const files = at(url.searchParams.get("ref"));
  if (files && Object.hasOwn(files, path)) {
    const text = files[path];
    return ok({
      type: "file",
      encoding: "base64",
      content: Buffer.from(text).toString("base64"),
      size: Buffer.byteLength(text),
      sha: hash(text),
    });
  }
  return missing();
};
