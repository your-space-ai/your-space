import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { app } from "../src/db/schema.ts";
import { parseAgentAccess } from "../src/apps/agent-kit.ts";
import { bind } from "../src/agents/owner.ts";
import { transaction } from "../src/agents/store.ts";
import { dispatchAppAction } from "../src/agents/transport.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";

vi.mock("../src/agents/transport.ts", () => ({ dispatchAppAction: vi.fn() }));
let t: TestDatabase, server: TestServer, cookie: string, owner: string, source: string, dest: string;
const access = parseAgentAccess({
  credential: { binding: "records", inject: { location: "header", name: "X-API-Key" } },
  routes: {
    list: { method: "GET", path: "/items", effect: "read", queryFields: { limit: "integer" }, outputFields: ["id"] },
    ask: { method: "GET", path: "/ask", effect: "read", approval: "ask", outputFields: ["id"] },
    write: {
      method: "POST",
      path: "/items",
      effect: "write",
      operationId: { in: "header", name: "Idempotency-Key" },
      outputFields: ["id"],
    },
  },
  roles: {
    reader: { title: "Reader", routes: ["list", "ask"] },
    editor: { title: "Editor", routes: ["write", "list"] },
  },
});
const secret = "synthetic-app-credential";
function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = { cookie }) {
  return server.request("/api/home" + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
interface View {
  revision: number;
  selectedId: string | null;
  activeHome: { installationId: string } | null;
  candidates: { installationId: string; generation: string; origin: string }[];
  targets: { installationId: string; bindingRevision: number; roles: Record<string, { routes: string[] }> }[];
  grants: { installationId: string; bindingRevision: number; roles: string[] }[];
}
async function view(): Promise<View> {
  const r = await request("");
  expect(r.status).toBe(200);
  return r.json() as Promise<View>;
}
async function choose(roles = ["reader"]) {
  const v = await view();
  return request("", "PUT", {
    revision: v.revision,
    homeId: source,
    homeGeneration: v.candidates.find((c) => c.installationId === source)!.generation,
    grants: roles.length ? [{ installationId: dest, bindingRevision: v.targets[0]!.bindingRevision, roles }] : [],
  });
}
const read = (actionId = "list", revision = 1, input: unknown = { query: { limit: 2 } }) =>
  request("/read", "POST", { homeId: source, revision, installationId: dest, actionId, input });

beforeEach(async () => {
  t = await createTestDatabase();
  await createOwnerWithPassword(t.db);
  server = await startServer(t.db);
  const login = await server.request("/api/auth/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  cookie = cookieHeader(login);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  const base = {
    sourceUrl: "https://example.test/kit",
    repo: "example/catalog",
    path: "compose.yaml",
    ref: "main",
    commit: "a".repeat(40),
    compose: "{}",
    images: {},
    adaptations: [],
    limits: {},
    installedBy: owner,
    state: "running" as const,
    interface: { service: "web", port: 8080 },
  };
  [source, dest] = (
    await t.db
      .insert(app)
      .values([
        { ...base, name: "dashboard", title: "Dashboard", kit: { kit: 1 } },
        { ...base, name: "catalog", title: "Catalog", kit: { kit: 2, agentAccess: access } },
      ])
      .returning({ id: app.id })
  ).map((r) => r.id) as [string, string];
  await transaction(t.db, (c) =>
    bind(c, dest, { revision: 0, enabledRoles: ["reader", "editor"], credential: secret }, TEST_DATA_KEY),
  );
  vi.mocked(dispatchAppAction)
    .mockReset()
    .mockResolvedValue({ status: 200, body: [{ id: "record", private: "hidden" }] });
});
afterEach(async () => {
  await server?.close();
  await t?.destroy();
});

it("keeps Home optional, admitting only an explicitly granted read from the selected source", async () => {
  expect(await view()).toMatchObject({ revision: 0, selectedId: null, activeHome: null, grants: [] });
  expect((await request("", "GET", undefined, {})).status).toBe(401);
  expect(
    (await request("/actions", "POST", { homeId: source, revision: 0 }, { cookie, origin: "https://other.example" }))
      .status,
  ).toBe(403);
  const [target] = (await view()).targets;
  expect(target?.roles).toEqual({ reader: { title: "Reader", routes: ["list"] } });
  expect((await choose(["editor"])).status).toBe(400);
  expect((await choose([])).status).toBe(200);
  expect((await read()).status).toBe(403);
  expect((await choose()).status).toBe(200);
  expect((await read("write", 2)).status).toBe(403);
  expect((await read("ask", 2)).status).toBe(403);
  expect((await read("list", 2, { query: { extra: "field" } })).status).toBe(400);
  expect((await request("/actions", "POST", { homeId: dest, revision: 2 })).status).toBe(403);
  const discover = await request("/actions", "POST", { homeId: source, revision: 2 });
  expect(await discover.json()).toMatchObject({
    actions: [{ installationId: dest, actionId: "list", method: "GET", effect: "read" }],
  });
  const result = await read("list", 2);
  expect(await result.json()).toEqual({ result: [{ id: "record" }] });
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(dispatchAppAction).mock.calls[0]![0]).toMatchObject({
    installation: { id: dest },
    path: "/items?limit=2",
    method: "GET",
    headers: { "X-API-Key": secret },
  });
  const audit = await (await request("/activity")).json();
  expect(audit).toMatchObject({ reads: [{ homeId: source, installationId: dest, actionId: "list" }] });
  expect((await t.pool.query("select count(*)::int as count from agent_request")).rows[0].count).toBe(0);
  expect((await request("", "PUT", { revision: 1, homeId: null, homeGeneration: null, grants: [] })).status).toBe(409);
  expect((await request("", "PUT", { revision: 2, homeId: null, homeGeneration: null, grants: [] })).status).toBe(200);
  expect((await view()).activeHome).toBeNull();
  expect((await read("list", 2)).status).toBe(409);
});

it("checks source framing, retained reinstall and target binding changes before returning data", async () => {
  await choose();
  await t.pool.query("update app set desired='stopped' where id=$1", [dest]);
  expect((await read()).status).toBe(403);
  await t.pool.query("update app set desired='running' where id=$1", [dest]);
  vi.mocked(dispatchAppAction).mockImplementationOnce(async () => {
    await transaction(t.db, (c) =>
      bind(c, dest, { revision: 1, credential: "different-principal", enabledRoles: ["reader"] }, TEST_DATA_KEY),
    );
    return { status: 200, body: { id: "old result" } };
  });
  expect((await read()).status).toBe(403);
  expect((await read()).status).toBe(403);
  expect(await (await request("/activity")).json()).toEqual({ reads: [] });
  await choose();
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body: { id: "prefix-different-principal" } });
  expect((await read("list", 2)).status).toBe(502);
  await t.pool.query("update app set desired='removed' where id=$1", [source]);
  await t.pool.query("update app set desired='running' where id=$1", [source]);
  expect(await view()).toMatchObject({ selectedId: null, activeHome: null, grants: [] });
  expect((await read("list", 2)).status).toBe(409);
  await t.pool.query("update app set pane=false where id=$1", [source]);
  expect((await view()).candidates.some((c) => c.installationId === source)).toBe(false);
  await t.pool.query("update app set pane=true,publish=$2 where id=$1", [
    source,
    JSON.stringify({ link: server.publicUrl, port: 8100, bind: "127.0.0.1" }),
  ]);
  expect((await view()).candidates.some((c) => c.installationId === source)).toBe(false);
});
