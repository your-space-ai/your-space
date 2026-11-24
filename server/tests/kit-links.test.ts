import { createHash } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { startServer, cookieHeader, type TestServer } from "./helpers/server.ts";
import { FakeRuntime, fakeGithub } from "./helpers/runtime.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { OWNER, createOwnerWithPassword } from "./helpers/owner.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { encrypt } from "../src/apps/settings.ts";

// Reviewing an app from its kit's link in the web client (POST /api/kits/preview) and the kit
// directory's listing, read through the owner's GitHub connection (decision 2026-11-23).
let db: TestDatabase, server: TestServer, cookie: string, actor: string;
const commit = "a".repeat(40);
/** An older commit, which kits pin their Compose files to. */
const pinned = "c".repeat(40);
const fixture = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const meta = (id: number, full_name: string, hidden = false) => ({
  id,
  full_name,
  default_branch: "main",
  private: hidden,
});
const file = (s: string) => ({
  type: "file",
  encoding: "base64",
  size: Buffer.byteLength(s),
  content: Buffer.from(s).toString("base64"),
  sha: commit,
});
const call = (path: string, method = "GET", body?: unknown) =>
  server.request(path, {
    method,
    headers: { cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(async () => {
  db = await createTestDatabase();
  await createOwnerWithPassword(db.db);
  actor = (await db.pool.query("select id from actor where kind='human'")).rows[0].id;
  server = await startServer(db.db, { apps: { runtime: new FakeRuntime(), fetch: fakeGithub({}) } });
  cookie = cookieHeader(
    await server.request("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    }),
  );
  await db.pool.query(
    "insert into github_connection(owner_id,github_user_id,login,credential,scope) values($1,'456','owner',$2,'repo')",
    [actor, encrypt(TEST_DATA_KEY, "fixture-private")],
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close();
  await db.destroy();
});

it("returns an empty directory without contacting GitHub on a fresh install", async () => {
  const fetcher = vi.fn<typeof fetch>(() => { throw Error("Unexpected GitHub request"); });
  vi.stubGlobal("fetch", fetcher);
  expect(await (await call("/api/kits/catalog")).json()).toEqual({ kits: [], commit: null });
  expect(fetcher).not.toHaveBeenCalled();
});

it("pins catalog entries and both sources in the ordinary installation preview", async () => {
  const registry = "ys-fixtures/catalog";
  server.apps!.config.kitsRepository = registry;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/repos/" + registry) return fixture({ ...meta(11, registry, true), default_branch: "catalog/stable" });
      if (path.startsWith("/repositories/11/commits/")) {
        expect([commit, "catalog/stable"]).toContain(decodeURIComponent(path.slice("/repositories/11/commits/".length)));
        return fixture({ sha: commit });
      }
      if (path === "/repositories/11/git/trees/" + commit)
        return fixture({
          truncated: false,
          tree: [{ mode: "100644", type: "blob", path: "apps/fixture/dashboard.yaml" }],
        });
      if (path === "/repositories/11/contents/apps/fixture/dashboard.yaml")
        return fixture(file(`kit: 1\nname: morning-board\nsource: { repo: fixture/dashboard, path: compose.yaml, commit: ${pinned} }`));
      if (path === "/repos/fixture/dashboard") {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return fixture(meta(22, "fixture/dashboard"));
      }
      if (path.includes("/commits/")) return fixture({ sha: commit });
      if (path === "/repositories/22/contents/compose.yaml") {
        // At the commit the kit pins, never the head of the repository's default branch.
        expect(new URL(String(url)).searchParams.get("ref")).toBe(pinned);
        return fixture(file("services:\n  web: { image: example/web:1 }"));
      }
      return fixture({}, 404);
    }),
  );
  const listing = (await (await call("/api/kits/catalog")).json()) as { kits: { kitUrl: string }[] };
  expect(listing.kits[0].kitUrl).toBe(
    "https://github.com/" + registry + "/blob/" + commit + "/apps/fixture/dashboard.yaml",
  );
  const response = await call("/api/kits/preview", "POST", { kitUrl: listing.kits[0].kitUrl });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: "morning-board", source: { repo: "fixture/dashboard", commit: pinned } });
  expect((await call("/api/kits/preview", "POST", { kitUrl: "https://unrelated.invalid/kit.yaml" })).status).toBe(400);
});

it("uses direct kit URLs without a directory and trusts only exact evidence from a configured directory", async () => {
  const text = "\uFEFF" + JSON.stringify({
    kit: 2,
    name: "demo",
    source: { repo: "fixture/app", path: "compose.yaml", commit: pinned },
    agentAccess: { credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } }, roles: {}, routes: {} },
  });
  const digest = createHash("sha256").update(text).digest("hex");
  const pin = `https://github.com/fixture/app/blob/${commit}/kit.yaml`;
  const evidence = `reviews/sha256/${digest}.json`;
  const reviewedAt = "b".repeat(40);
  const probe = vi.spyOn(server.apps!, "previewResolved");
  const provider = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === "/repos/fixture/app") return fixture(meta(10, "fixture/app"));
    if (path === "/repositories/10/commits/topic") return fixture({ sha: commit });
    if (path === "/repositories/10/contents/kit.yaml") return fixture(file(text));
    if (path === "/repositories/10/contents/compose.yaml") return fixture(file("services:\n  web: { image: example/web:1 }"));
    if (path === "/repos/fixture/reviews") return fixture({ ...meta(11, "fixture/reviews"), default_branch: "review/stable" });
    if (path === "/repositories/11/commits/review%2Fstable") return fixture({ sha: reviewedAt });
    if (path === "/repositories/11/contents/" + evidence && url.searchParams.get("ref") === reviewedAt)
      return fixture(file(JSON.stringify({ kit: pin, sha256: digest, status: "reviewed" })));
    throw Error("Unexpected GitHub request: " + path);
  });
  vi.stubGlobal("fetch", provider);
  const preview = () => call("/api/kits/preview", "POST", { kitUrl: "https://github.com/fixture/app/blob/topic/kit.yaml" });
  expect((await preview()).status).toBe(200);
  expect(probe.mock.lastCall?.[1]?.kit.agentReview).toBeUndefined();
  expect(provider.mock.calls.some(([url]) => String(url).includes("reviews"))).toBe(false);
  server.apps!.config.kitsRepository = "fixture/reviews";
  expect((await preview()).status).toBe(200);
  expect(probe.mock.lastCall?.[1]?.kit.agentReview?.source).toBe(`https://github.com/fixture/reviews/blob/${reviewedAt}/${evidence}`);
});

it("recognizes a separately committed review when the owner chooses a directory entry", async () => {
  const directory = "fixture/directory";
  server.apps!.config.kitsRepository = directory;
  const kitAt = "a".repeat(40), directoryAt = "b".repeat(40);
  const path = "apps/fixture/app.yaml";
  const kitText = JSON.stringify({
    kit: 2, name: "demo",
    source: { repo: "fixture/app", path: "compose.yaml", commit: pinned },
    agentAccess: { credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } }, roles: {}, routes: {} },
  });
  const digest = createHash("sha256").update(kitText).digest("hex");
  const evidence = "reviews/sha256/" + digest + ".json";
  let oldText = kitText;
  const probe = vi.spyOn(server.apps!, "previewResolved");
  const provider = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const route = decodeURIComponent(url.pathname);
    const ref = url.searchParams.get("ref");
    if (route === "/repos/" + directory) return fixture({ ...meta(11, directory, true), default_branch: "catalog/stable" });
    if (route === "/repos/fixture/app") return fixture(meta(22, "fixture/app"));
    if (route === "/repositories/22/contents/compose.yaml") return fixture(file("services:\n  web: { image: example/web:1 }"));
    if (route === "/repositories/11/commits/catalog/stable" || route === "/repositories/11/commits/" + directoryAt)
      return fixture({ sha: directoryAt });
    if (route === "/repositories/11/git/trees/" + directoryAt)
      return fixture({ truncated: false, tree: [{ mode: "100644", type: "blob", path }] });
    if (route === "/repositories/11/contents/" + path && ref === directoryAt) return fixture(file(kitText));
    if (route === "/repositories/11/contents/" + path && ref === kitAt) return fixture(file(oldText));
    if (route === "/repositories/11/contents/" + evidence && ref === directoryAt)
      return fixture(file(JSON.stringify({ kit: `https://github.com/${directory}/blob/${kitAt}/${path}`, sha256: digest, status: "reviewed" })));
    throw Error("Unexpected GitHub request: " + route);
  });
  vi.stubGlobal("fetch", provider);
  const listing = await (await call("/api/kits/catalog")).json() as { kits: { kitUrl: string }[] };
  const kitUrl = listing.kits[0].kitUrl;
  expect(kitUrl).toBe(`https://github.com/${directory}/blob/${directoryAt}/${path}`);
  const preview = () => call("/api/kits/preview", "POST", { kitUrl });
  expect((await preview()).status).toBe(200);
  expect(probe.mock.lastCall?.[1]?.kit.agentReview?.source).toBe(`https://github.com/${directory}/blob/${directoryAt}/${evidence}`);
  oldText += "\n";
  expect((await preview()).status).toBe(200);
  expect(probe.mock.lastCall?.[1]?.kit.agentReview).toBeUndefined();
});

it("refuses to follow a linked kit to a Compose file in a different private repository", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/repos/owner/kits") return fixture(meta(11, "owner/kits"));
      if (path.includes("/commits/")) return fixture({ sha: commit });
      if (path.endsWith("/contents/kit.yaml"))
        return fixture(file(`kit: 1\nsource: {repo: owner/private, path: compose.yaml, commit: ${pinned}}`));
      if (path === "/repos/owner/private") expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return fixture({}, 404);
    }),
  );
  const refused = await call("/api/kits/preview", "POST", { kitUrl: "https://github.com/owner/kits/blob/main/kit.yaml" });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: "private_source", message: expect.stringMatching(/owner\/private, which isn't a public repository/) });
  expect(calls.some((path) => path.includes("contents/compose.yaml"))).toBe(false);
});

it("reads a linked kit through the connection, refusing a Compose file and naming a kit it can't see", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/repos/owner/app") return fixture(meta(11, "owner/app", true));
      if (path.includes("/commits/")) return fixture({ sha: commit });
      if (path.endsWith("/contents/compose.yaml")) return fixture(file("services:\n  web: { image: example/web:1 }\n"));
      return fixture({}, 404);
    }),
  );
  const compose = await call("/api/kits/preview", "POST", { kitUrl: "https://github.com/owner/app/blob/main/compose.yaml" });
  expect(compose.status).toBe(400);
  expect(await compose.json()).toMatchObject({ error: "kit_required", message: expect.stringMatching(/not a Your Space kit/) });
  const hidden = await call("/api/kits/preview", "POST", { kitUrl: "https://github.com/owner/hidden/blob/main/kit.yaml" });
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toMatchObject({ error: "kit_not_found", message: expect.stringMatching(/connect GitHub with private repositories included/) });
});

it("reviews a kit in a private repository through the connection, at the Compose commit the kit pins", async () => {
  const kits: Record<string, string> = {
    "kit.yaml": `kit: 1\nname: desk\nsource: { repo: owner/desk, path: compose.yaml, commit: ${pinned} }\ninterface: { service: web, port: 80 }\n`,
    "beside.yaml": "kit: 1\nname: desk\ninterface: { service: web, port: 80 }\n",
    "unpinned.yaml": "kit: 1\nname: desk\nsource: { repo: owner/desk, path: compose.yaml }\n",
  };
  const reads: string[] = [];
  const provider = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-private");
    if (u.pathname === "/repos/owner/desk") return fixture(meta(41, "owner/desk", true));
    if (u.pathname === "/repositories/41/commits/main") return fixture({ sha: commit });
    const path = u.pathname.slice("/repositories/41/contents/".length);
    reads.push(path + "@" + u.searchParams.get("ref"));
    if (path === "compose.yaml" && u.searchParams.get("ref") === pinned) return fixture(file("services:\n  web: { image: example/web:1 }\n"));
    if (Object.hasOwn(kits, path) && u.searchParams.get("ref") === commit) return fixture(file(kits[path]!));
    return fixture({}, 404);
  });
  vi.stubGlobal("fetch", provider);
  const preview = (path: string) => call("/api/kits/preview", "POST", { kitUrl: "https://github.com/owner/desk/blob/main/" + path });
  const review = await preview("kit.yaml");
  expect(review.status).toBe(200);
  expect(await review.json()).toMatchObject({
    name: "desk",
    source: { repo: "owner/desk", path: "compose.yaml", commit: pinned },
    kit: { repo: "owner/desk", path: "kit.yaml", commit },
  });
  expect(reads).toEqual(["kit.yaml@" + commit, "compose.yaml@" + pinned]);
  // Without source, or without its commit, the kit doesn't pin the Compose file, so it is refused.
  expect(await (await preview("beside.yaml")).json()).toMatchObject({ error: "invalid_kit", message: expect.stringMatching(/names no Compose file/) });
  expect(await (await preview("unpinned.yaml")).json()).toMatchObject({ error: "invalid_kit", message: expect.stringMatching(/source has no commit\. Add source\.commit/) });
});
