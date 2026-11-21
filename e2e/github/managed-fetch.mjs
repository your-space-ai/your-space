// Loaded only by compose.e2e.yaml. The production transport keeps its fixed GitHub origins.
// Synthetic responses cover the device exchange, directory, and file operations.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const realFetch = globalThis.fetch;
const fixture = (repo, path) => readFileSync(new URL("./fixtures/" + repo + "/" + path, import.meta.url), "utf8");
const hash = (value) => createHash("sha1").update(value).digest("hex");
const initial = "0123456789abcdef0123456789abcdef01234567";
const repositories = new Map();
let nextId = 10;
let requestedScope;
let pollCount = 0;
function repo(fullName, privateRepo, files = {}) {
  const id = nextId++;
  const record = {
    metadata: { id, full_name: fullName, default_branch: "main", private: privateRepo },
    files: { ...files },
    head: initial,
  };
  repositories.set(String(id), record);
  return record;
}
const kits = "your-space-ai/your-space-app-kits";
const upstream = "ys-fixtures/whoami";
const kitPath = "apps/ys-fixtures/whoami.yaml";
repo(kits, false, { [kitPath]: fixture(kits, kitPath) });
repo(upstream, false, { "compose.yaml": fixture(upstream, "compose.yaml"), "README.md": "A fixture app.\n" });
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
  const method = options.method ?? "GET";
  const authenticated = new Headers(options.headers).get("Authorization") === "Bearer fixture-authorization";
  if (!authenticated && method !== "GET") return ok({}, 403);
  if (url.pathname === "/user" && authenticated) return ok({ id: 17, login: "fixture-owner" });
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  if (url.pathname === "/user/repos" && method === "POST")
    return ok(repo("fixture-owner/" + body.name, body.private).metadata, 201);
  const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
  const byId = parts[0] === "repositories";
  const target = byId
    ? repositories.get(parts[1])
    : [...repositories.values()].find((r) => r.metadata.full_name === parts[1] + "/" + parts[2]);
  if (!target || (!authenticated && target.metadata.private)) return missing();
  const [operation, ...rest] = parts.slice(byId ? 2 : 3);
  if (!operation) return ok(target.metadata);
  if (operation === "forks" && method === "POST")
    return ok(repo("fixture-owner/" + body.name, target.metadata.private, target.files).metadata, 202);
  if (operation === "commits" && ["main", target.head].includes(rest[0])) return ok({ sha: target.head });
  if (operation === "git" && rest[0] === "trees" && rest[1] === target.head)
    return ok({
      truncated: false,
      tree: Object.keys(target.files).map((path) => ({ path, type: "blob", mode: "100644" })),
    });
  if (operation !== "contents") return missing();
  const path = rest.join("/");
  const contents = Object.hasOwn(target.files, path) ? target.files[path] : undefined;
  if (method === "GET" && contents !== undefined && ["main", target.head].includes(url.searchParams.get("ref"))) {
    return ok({
      type: "file",
      encoding: "base64",
      content: Buffer.from(contents).toString("base64"),
      size: Buffer.byteLength(contents),
      sha: hash(contents),
    });
  }
  if (method === "PUT" && body.branch === "main") {
    if (body.sha !== (contents === undefined ? undefined : hash(contents))) return ok({}, 409);
    const next = Buffer.from(body.content, "base64").toString("utf8");
    target.files[path] = next;
    target.head = hash(target.head + next);
    return ok({ content: { sha: hash(next) }, commit: { sha: target.head } });
  }
  return missing();
};
