import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { startServer, cookieHeader, type TestServer } from "./helpers/server.ts";
import { FakeRuntime, fakeGithub } from "./helpers/runtime.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { OWNER, createOwnerWithPassword } from "./helpers/owner.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { encrypt } from "../src/apps/settings.ts";
import { transaction } from "../src/agents/store.ts";
import { createAgent, manageKey } from "../src/agents/owner.ts";
import { kitsRepo } from "../src/apps/kits.ts";

let db: TestDatabase, server: TestServer, cookie: string, actor: string, agent: string, authorization: string;
const commit = "a".repeat(40);
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
const repoApi = "/api/repositories",
  agentApi = "/api/agent/repositories";
const call = (path: string, method = "GET", body?: unknown, ag = false) =>
  server.request(path, {
    method,
    headers: ag ? { authorization } : { cookie },
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
  await transaction(db.db, async (c) => {
    agent = (await createAgent(c, actor, "Builder")).id;
    authorization = "Bearer " + (await manageKey(c, actor, agent)).key;
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close();
  await db.destroy();
});

it("limits repository files and forks to owner-granted IDs, with owner-only confirmation and revocable access", async () => {
  const provider = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/repos/owner/dashboard") return fixture(meta(31, "owner/dashboard", true));
    if (u.pathname === "/repositories/31/forks") return fixture(meta(32, "owner/custom-dashboard", true));
    if (u.pathname === "/repositories/32/contents/index.html" && init?.method === "PUT")
      return fixture({ commit: { sha: commit }, content: { sha: commit } });
    if (u.pathname === "/repositories/31/contents/index.html") return fixture(file("only the managed file"));
    throw Error("Unexpected GitHub request");
  });
  vi.stubGlobal("fetch", provider);
  expect((await call(repoApi + "/import", "POST", { fullName: "owner/dashboard" })).status).toBe(200);
  expect((await call(agentApi + "/file?repoId=31&path=index.html", "GET", undefined, true)).status).toBe(403);
  const initial = { revision: 0, canCreate: false, canFork: true, repoIds: ["31"] };
  expect((await call(repoApi + "/grants/" + agent, "PUT", initial)).status).toBe(200);
  expect((await call(repoApi + "/grants/" + agent, "PUT", initial)).status).toBe(409);
  expect((await call(agentApi + "/file?repoId=31&path=index.html", "GET", undefined, true)).status).toBe(200);
  const calls = provider.mock.calls.length;
  expect((await call(agentApi + "/fork", "POST", { fullName: "private/another" }, true)).status).toBe(403);
  expect((await call(agentApi + "/create", "POST", { name: "project", private: false }, true)).status).toBe(403);
  expect(provider).toHaveBeenCalledTimes(calls);
  expect(
    (await call(agentApi + "/fork", "POST", { fullName: "owner/dashboard", name: "custom-dashboard" }, true)).status,
  ).toBe(200);
  const edit = {
    repoId: "32",
    path: "index.html",
    branch: "main",
    message: "Change the header",
    content: "My tasks",
    sha: commit,
  };
  expect((await call(agentApi + "/file", "PUT", edit, true)).status).toBe(200);
  expect((await call(agentApi + "/32/deploy/apply", "POST", {}, true)).status).toBe(404);
  expect((await call(repoApi + "/32/deploy/apply", "POST", {}, true)).status).toBe(401);
  const list = (await (await call(repoApi)).json()) as { grants: { repoIds: string[]; revision: number }[] };
  expect(list.grants[0].repoIds).toEqual(["31", "32"]);
  expect(
    (
      await call(repoApi + "/grants/" + agent, "PUT", {
        ...initial,
        revision: list.grants[0].revision,
        repoIds: [],
        canFork: false,
      })
    ).status,
  ).toBe(200);
  expect((await call(agentApi + "/file", "PUT", edit, true)).status).toBe(403);
  expect(JSON.stringify(list)).not.toContain("fixture-private");
});

it("pins catalog entries and both sources in the ordinary installation preview", async () => {
  const registry = kitsRepo();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/repos/" + registry) return fixture(meta(11, registry, true));
      if (path === "/repositories/11/git/trees/" + commit)
        return fixture({
          truncated: false,
          tree: [{ mode: "100644", type: "blob", path: "apps/fixture/dashboard.yaml" }],
        });
      if (path === "/repositories/11/contents/apps/fixture/dashboard.yaml")
        return fixture(file("kit: 1\nname: morning-board\nsource: { repo: fixture/dashboard, path: compose.yaml }"));
      if (path === "/repos/fixture/dashboard") {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return fixture(meta(22, "fixture/dashboard"));
      }
      if (path.includes("/commits/")) return fixture({ sha: commit });
      if (path === "/repositories/22/contents/compose.yaml") {
        expect(new URL(String(url)).searchParams.get("ref")).toBe(commit);
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
  expect(await response.json()).toMatchObject({ name: "morning-board" });
  expect((await call("/api/kits/preview", "POST", { kitUrl: "https://unrelated.invalid/kit.yaml" })).status).toBe(400);
});

it("requires an explicit import before following a linked kit to a different private source", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/repos/owner/kits") return fixture(meta(11, "owner/kits"));
      if (path.includes("/commits/")) return fixture({ sha: commit });
      if (path.endsWith("/contents/kit.yaml"))
        return fixture(file("kit: 1\nsource: {repo: owner/private, path: compose.yaml}"));
      if (path === "/repos/owner/private") expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return fixture({}, 404);
    }),
  );
  expect(
    (await call("/api/kits/preview", "POST", { kitUrl: "https://github.com/owner/kits/blob/main/kit.yaml" })).status,
  ).toBe(403);
  expect(calls.some((path) => path.includes("contents/compose.yaml"))).toBe(false);
});
