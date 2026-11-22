import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { SavedView, WorkspaceLayout } from "../../shared/workspace-layout/model.mjs";
import { app } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

let database: TestDatabase, server: TestServer, cookie: string, ownerId: string;
const base = "/api/workspace-layout";
const preferences = async () => (await (await request("")).json()) as WorkspaceLayout;
const composition = { layout: "columns", apps: ["work", "notes"], sizes: { columns: [35, 65], rows: [100] } };

async function add(name: string, hasInterface = true) {
  await database.db.insert(app).values({
    name,
    title: name,
    sourceUrl: "https://example.test/" + name,
    repo: "sample/" + name,
    path: "compose.yaml",
    ref: "main",
    commit: "a".repeat(40),
    compose: "services: {}",
    kit: { kit: 1 },
    interface: hasInterface ? { service: "web", port: 8000 } : null,
    images: {},
    adaptations: [],
    limits: {},
    installedBy: ownerId,
  });
}
function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return server.request(base + path, {
    method,
    headers: { cookie, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  database = await createTestDatabase();
  await createOwnerWithPassword(database.db);
  server = await startServer(database.db);
  ownerId = (await database.pool.query("select id from actor where kind='human'")).rows[0].id;
  const signin = await server.request("/api/auth/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  cookie = cookieHeader(signin);
  await add("work");
  await add("notes");
  await add("background", false);
});
afterEach(async () => {
  await server.close();
  await database.destroy();
});

it("requires an owner and persists only a complete current app order from the owner's origin", async () => {
  expect((await server.request(base)).status).toBe(401);
  expect(await preferences()).toEqual({ revision: 0, appOrder: ["work", "notes"], views: [] });
  const order = { revision: 0, appOrder: ["notes", "work"] };
  expect((await request("/app-order", "PUT", order, { origin: "https://other.example" })).status).toBe(403);
  expect((await request("/app-order", "PUT", order, { "content-type": "text/plain" })).status).toBe(403);
  expect((await request("/app-order", "PUT", { revision: 0, appOrder: ["notes", "background"] })).status).toBe(409);
  expect(await (await request("/app-order", "PUT", order)).json()).toMatchObject({
    revision: 1,
    appOrder: order.appOrder,
  });
  expect((await request("/app-order", "PUT", order)).status).toBe(409);
  await add("calendar");
  expect((await preferences()).appOrder).toEqual(["notes", "work", "calendar"]);
  await database.db.update(app).set({ state: "removed" }).where(eq(app.name, "notes"));
  expect((await preferences()).appOrder).toEqual(["work", "calendar"]);
});

it("saves exact named compositions, keeps missing panes visible, and rejects stale concurrent edits", async () => {
  const saved = (await (await request("/views", "POST", { name: "Focus", composition })).json()) as SavedView;
  expect(saved).toMatchObject({ name: "Focus", composition, revision: 1 });
  expect((await request("/views", "POST", { name: "focus", composition })).status).toBe(409);
  for (const bad of [
    { ...composition, apps: ["work", "work"] },
    { ...composition, sizes: { columns: [5, 5], rows: [100] } },
    { ...composition, sizes: { columns: [100], rows: [100] } },
    { ...composition, layout: "shell" },
    { ...composition, path: "/invalid" },
  ])
    expect((await request("/views", "POST", { name: "Bad", composition: bad })).status).toBe(400);
  expect(
    (await request("/views", "POST", { name: "Missing", composition: { ...composition, apps: ["work", "unknown"] } }))
      .status,
  ).toBe(409);
  const changed = await Promise.all(
    [1, 2].map((n) => request("/views/" + saved.id, "PUT", { revision: 1, name: "Focus " + n })),
  );
  expect(changed.map((r) => r.status).sort()).toEqual([200, 409]);
  await database.db.update(app).set({ state: "removed" }).where(eq(app.name, "notes"));
  expect((await preferences()).views[0]!.composition).toEqual(composition);
  expect((await request("/views/" + saved.id, "DELETE", { revision: 1 })).status).toBe(409);
  expect((await request("/views/" + saved.id, "DELETE", { revision: 2 })).status).toBe(200);
  expect((await preferences()).views).toEqual([]);
});
