import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseKit } from "../src/apps/kits.ts";
import { app } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

let database: TestDatabase;
let server: TestServer;
let cookie: string;

beforeEach(async () => {
  database = await createTestDatabase();
  await createOwnerWithPassword(database.db);
  server = await startServer(database.db);
  const login = await server.request("/api/auth/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  expect(login.status).toBe(200);
  cookie = cookieHeader(login);
});

afterEach(async () => {
  await server?.close();
  await database?.destroy();
});

function change(path: string, method: string, body: unknown) {
  return server.request(path, { method, headers: { cookie }, body: JSON.stringify(body) });
}

it("lets the owner issue and retire keys while keeping the dashboard free of secrets", async () => {
  const created = await change("/api/agents", "POST", { name: "Assistant" });
  expect(created.status).toBe(200);
  const { id } = (await created.json()) as { id: string };
  const agent = "/api/agents/" + id;
  expect((await change(agent, "PATCH", { name: "Researcher" })).status).toBe(200);
  const issued = await change(agent + "/keys", "POST", {});
  expect(issued.status).toBe(200);
  expect(issued.headers.get("cache-control")).toBe("no-store");
  const first = (await issued.json()) as { id: string; key: string };
  expect(first.key).toMatch(/^ysa_[A-Za-z0-9_-]{43}$/);
  const stored = await database.pool.query("select verifier from agent_key where id=$1", [first.id]);
  expect(stored.rows).toEqual([{ verifier: createHash("sha256").update(first.key).digest("hex") }]);

  expect((await server.request("/api/agents/dashboard")).status).toBe(401);
  const unauthenticated = await server.request(agent + "/keys", {
    method: "POST", headers: { authorization: "Bearer " + first.key }, body: "{}",
  });
  expect(unauthenticated.status).toBe(401);
  const otherOrigin = await server.request(agent + "/keys", {
    method: "POST", headers: { cookie, origin: "https://other.example.test" }, body: "{}",
  });
  expect(otherOrigin.status).toBe(403);

  const rotated = await change(agent + "/keys/" + first.id + "/rotate", "POST", {});
  expect(rotated.status).toBe(200);
  const next = (await rotated.json()) as { id: string; key: string };
  expect(next.key).not.toBe(first.key);
  expect((await change(agent + "/keys/" + next.id + "/revoke", "POST", {})).status).toBe(200);
  const dashboard = await server.request("/api/agents/dashboard", { headers: { cookie } });
  expect(dashboard.status).toBe(200);
  const view = (await dashboard.json()) as { agents: { keys: { id: string; revoked: boolean }[] }[] };
  expect(view.agents).toEqual([{ id, name: "Researcher", disabled: false, grants: [], keys: expect.any(Array) }]);
  expect(view.agents[0]!.keys).toHaveLength(2);
  expect(view.agents[0]!.keys).toEqual(expect.arrayContaining([{ id: first.id, revoked: true }, { id: next.id, revoked: true }]));
  expect((await change(agent, "PATCH", { disabled: true })).status).toBe(200);
  expect((await change(agent + "/keys", "POST", {})).status).toBe(403);

  // Even a signed-in human must hold the workspace's owner role.
  await database.pool.query("update member set role='member' where role='owner'");
  expect((await server.request("/api/agents/dashboard", { headers: { cookie } })).status).toBe(403);
  expect((await change("/api/agents", "POST", { name: "Another" })).status).toBe(403);
});

it("binds an app without granting access and rejects a stale grant or binding revision", async () => {
  const owner = (await database.pool.query("select id from actor where kind='human'")).rows[0].id;
  const kit = parseKit(JSON.stringify({
    kit: 2,
    agentAccess: {
      credential: { binding: "catalog", inject: { location: "header", name: "X-API-Key" } },
      roles: { reader: { title: "Reader", routes: ["list"] } },
      routes: { list: { method: "GET", path: "/items", effect: "read" } },
    },
  }));
  const [installation] = await database.db.insert(app).values({
    name: "catalog", title: "Catalog", sourceUrl: "https://example.test/catalog", repo: "sample/catalog",
    path: "compose.yaml", ref: "main", commit: "a".repeat(40), compose: "{}", images: {}, adaptations: [],
    limits: {}, installedBy: owner, state: "running", interface: { service: "catalog", port: 8080 }, kit,
  }).returning({ id: app.id });
  const install = installation!.id;
  const secret = "synthetic-catalog-key";
  const binding = "/api/agents/installations/" + install;
  const bound = await change(binding, "PUT", { revision: 0, enabledRoles: ["reader"], credential: secret });
  expect(bound.status).toBe(200);
  expect(await bound.json()).toEqual({ revision: 1 });
  const created = await change("/api/agents", "POST", { name: "Reader" });
  expect(created.status).toBe(200);
  const { id } = (await created.json()) as { id: string };
  const overview = await server.request("/api/agents/dashboard", { headers: { cookie } });
  expect(overview.status).toBe(200);
  const view = await overview.text();
  expect(view).not.toContain(secret);
  expect(JSON.parse(view)).toMatchObject({
    agents: [{ id, grants: [] }], installations: [{ id: install, bound: true, enabledRoles: ["reader"] }],
  });

  const path = "/api/agents/" + id + "/grants/" + install;
  const policy = { revision: 0, bindingRevision: 1, roles: ["reader"], overrides: {} };
  const granted = await change(path, "PUT", policy);
  expect(granted.status).toBe(200);
  expect(await granted.json()).toEqual({ revision: 1 });
  expect((await change(path, "PUT", { ...policy, roles: [] })).status).toBe(409);
  expect((await change(binding, "PUT", { revision: 1, enabledRoles: ["reader"] })).status).toBe(200);
  expect((await change(path, "PUT", { ...policy, revision: 1, roles: [] })).status).toBe(409);
  const current = await server.request("/api/agents/dashboard", { headers: { cookie } });
  expect(await current.json()).toMatchObject({
    agents: [{ id, grants: [{ installationId: install, revision: 1, roles: ["reader"] }] }],
  });
  const activity = await server.request("/api/agents/activity", { headers: { cookie } });
  expect(activity.status).toBe(200);
  expect(await activity.json()).toEqual({ events: [], nextCursor: null });
});
