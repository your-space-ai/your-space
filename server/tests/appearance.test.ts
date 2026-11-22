import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultThemeId, starterThemes, type Theme } from "../../shared/appearance/theme.mjs";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

let t: TestDatabase;
let server: TestServer;
let cookie: string;
type Catalog = { revision: number; activeId: string; themes: { id: string; theme: Theme }[] };
const base = "/api/appearance";
const starter = starterThemes.find(item => item.id === defaultThemeId)!.theme;
const personal = { ...starter, name: "Personal name never shown on sign-in", tokens: { ...starter.tokens, accent: "#123456" } };

beforeEach(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db);
  await createOwnerWithPassword(t.db);
  const login = await server.request("/api/auth/sign-in/username", {
    method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  expect(login.status).toBe(200);
  cookie = cookieHeader(login);
});
afterEach(async () => { await server?.close(); await t?.destroy(); });

function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = { cookie }) {
  return server.request(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function readCatalog(): Promise<Catalog> {
  const response = await request("");
  expect(response.status).toBe(200);
  return response.json() as Promise<Catalog>;
}

it("returns only the active palette publicly and keeps personal themes, labels and edits owner-only", async () => {
  const publicDefault = await request("/active", "GET", undefined, {});
  expect(publicDefault.status).toBe(200);
  expect(publicDefault.headers.get("cache-control")).toBe("no-store");
  expect(await publicDefault.json()).toEqual({ scheme: starter.scheme, tokens: starter.tokens });
  expect((await request("", "GET", undefined, {})).status).toBe(401);
  expect((await request("", "GET", undefined, { authorization: "Bearer ysa_" + "a".repeat(43) })).status).toBe(401);
  const draft = { revision: 0, theme: personal, activate: true };
  expect((await request("/themes", "POST", draft, {})).status).toBe(401);
  expect((await request("/themes", "POST", draft, { cookie, origin: "https://other.example" })).status).toBe(403);
  expect((await request("/themes", "POST", draft, { cookie, "content-type": "text/plain" })).status).toBe(403);
  expect(await readCatalog()).toEqual({ revision: 0, activeId: defaultThemeId, themes: [] });

  const created = await request("/themes", "POST", draft);
  expect(created.status).toBe(200);
  const saved = await created.json() as Catalog;
  expect(saved.activeId).toMatch(/^custom-/);
  expect(saved.themes).toEqual([{ id: saved.activeId, theme: personal }]);
  const publicActive = await request("/active", "GET", undefined, {});
  expect(await publicActive.json()).toEqual({ scheme: personal.scheme, tokens: personal.tokens });

  // An owner membership in a separate organization does not authorize the claimed workspace.
  await t.pool.query("update member set role='member' where role='owner'");
  await t.pool.query(`with other as (insert into organization(name,slug,created_at) values('Other','other',now()) returning id)
    insert into member(organization_id,user_id,role,created_at) select other.id,m.user_id,'owner',now() from other cross join member m`);
  expect((await request("")).status).toBe(403);
  expect((await request("/selection", "PUT", { revision: 1, id: "tide" })).status).toBe(403);
  const unchanged = await request("/active", "GET", undefined, {});
  expect(await unchanged.json()).toEqual({ scheme: personal.scheme, tokens: personal.tokens });
});

it("saves edits and imports across server restarts, keeping the active choice until an explicit switch", async () => {
  const created = await request("/themes", "POST", { revision: 0, theme: personal });
  const first = (await created.json()) as Catalog;
  const { id } = first.themes[0]!;
  expect(first.activeId).toBe(defaultThemeId);
  expect((await request("/selection", "PUT", { revision: first.revision, id })).status).toBe(200);
  const revised = { ...personal, name: "Renamed", tokens: { ...personal.tokens, bg: "#eeeeee" } };
  const edited = await request("/themes/" + id, "PUT", { revision: 2, theme: revised });
  expect(await edited.json()).toEqual({ revision: 3, activeId: id, themes: [{ id, theme: revised }] });
  const denied = await request("/themes/" + id, "DELETE", { revision: 3 });
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ error: "theme_in_use" });

  const origin = server.publicUrl;
  await server.close();
  server = await startServer(t.db, { publicUrl: origin });
  expect(await readCatalog()).toEqual({ revision: 3, activeId: id, themes: [{ id, theme: revised }] });
  const safe = await request("/active", "GET", undefined, {});
  expect(await safe.json()).toEqual({ scheme: revised.scheme, tokens: revised.tokens });
  expect((await request("/selection", "PUT", { revision: 3, id: "ember" })).status).toBe(200);
  const removed = await request("/themes/" + id, "DELETE", { revision: 4 });
  expect(await removed.json()).toEqual({ revision: 5, activeId: "ember", themes: [] });
});

it("rejects conflicting concurrent editors, unsafe imports, and attempts to edit a starter theme", async () => {
  const saves = await Promise.all(["A", "B"].map(name => request("/themes", "POST", { revision: 0, theme: { ...personal, name } })));
  expect(saves.map(r => r.status).sort()).toEqual([200, 409]);
  const current = await readCatalog();
  expect(current.themes).toHaveLength(1);
  expect(current.revision).toBe(1);
  const id = current.themes[0]!.id;
  const stale = await request("/themes/" + id, "DELETE", { revision: 0 });
  expect(await stale.json()).toMatchObject({ error: "conflict" });
  const invalid = { ...personal, tokens: { ...personal.tokens, bg: "url(https://example.test/image)" } };
  expect((await request("/themes/" + id, "PUT", { revision: 1, theme: invalid })).status).toBe(400);
  expect((await request("/themes", "POST", { revision: 1, theme: personal, activate: "true" })).status).toBe(400);
  expect((await request("/themes/tide", "PUT", { revision: 1, theme: personal })).status).toBe(404);
  expect((await request("/themes/tide", "DELETE", { revision: 1 })).status).toBe(404);
  expect((await request("/selection", "PUT", { revision: 1, id: "unknown" })).status).toBe(404);
  expect(await readCatalog()).toEqual(current);
});
