import { afterEach, beforeEach, expect, it } from "vitest";
import { builtInThemes, defaultThemeId, type Theme } from "../../shared/appearance/theme.mjs";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

let t: TestDatabase;
let server: TestServer;
let cookie: string;
type Catalog = { revision: number; activeId: string; mode: string; themes: { id: string; theme: Theme }[] };
const base = "/api/appearance";
const starter = builtInThemes.find(item => item.id === defaultThemeId)!.theme;
const personal: Theme = { ...starter, name: "Personal name never shown on sign-in", light: { ...starter.light, accent: "#123456" } };
const look = ({ style, fonts, light, dark }: Theme) => ({ style, fonts, light, dark });

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
async function readPublic() {
  const response = await request("/active", "GET", undefined, {});
  expect(response.status).toBe(200);
  return response.json();
}

it("returns only the active look and mode publicly and keeps personal themes, labels and edits owner-only", async () => {
  const publicDefault = await request("/active", "GET", undefined, {});
  expect(publicDefault.status).toBe(200);
  expect(publicDefault.headers.get("cache-control")).toBe("no-store");
  expect(await publicDefault.json()).toEqual({ mode: "system", ...look(starter) });
  expect((await request("", "GET", undefined, {})).status).toBe(401);
  expect((await request("", "GET", undefined, { authorization: "Bearer ysa_" + "a".repeat(43) })).status).toBe(401);
  const draft = { revision: 0, theme: personal, activate: true };
  expect((await request("/themes", "POST", draft, {})).status).toBe(401);
  expect((await request("/themes", "POST", draft, { cookie, origin: "https://other.example" })).status).toBe(403);
  expect((await request("/themes", "POST", draft, { cookie, "content-type": "text/plain" })).status).toBe(403);
  expect(await readCatalog()).toEqual({ revision: 0, activeId: defaultThemeId, mode: "system", themes: [] });

  const created = await request("/themes", "POST", draft);
  expect(created.status).toBe(200);
  const saved = await created.json() as Catalog;
  expect(saved.activeId).toMatch(/^custom-/);
  expect(saved.themes).toEqual([{ id: saved.activeId, theme: personal }]);
  expect(await readPublic()).toEqual({ mode: "system", ...look(personal) });

  // An owner membership in a separate organization does not authorize the claimed workspace.
  await t.pool.query("update member set role='member' where role='owner'");
  await t.pool.query(`with other as (insert into organization(name,slug,created_at) values('Other','other',now()) returning id)
    insert into member(organization_id,user_id,role,created_at) select other.id,m.user_id,'owner',now() from other cross join member m`);
  expect((await request("")).status).toBe(403);
  expect((await request("/selection", "PUT", { revision: 1, id: "cinder" })).status).toBe(403);
  expect((await request("/mode", "PUT", { revision: 1, mode: "dark" })).status).toBe(403);
  expect(await readPublic()).toEqual({ mode: "system", ...look(personal) });
});

it("saves edits and imports across server restarts, keeping the active choice until an explicit switch", async () => {
  const created = await request("/themes", "POST", { revision: 0, theme: personal });
  const first = (await created.json()) as Catalog;
  const { id } = first.themes[0]!;
  expect(first.activeId).toBe(defaultThemeId);
  expect((await request("/selection", "PUT", { revision: first.revision, id })).status).toBe(200);
  const revised: Theme = { ...personal, name: "Renamed", style: "soft", dark: { ...personal.dark, bg: "#000000" } };
  const edited = await request("/themes/" + id, "PUT", { revision: 2, theme: revised });
  expect(await edited.json()).toEqual({ revision: 3, activeId: id, mode: "system", themes: [{ id, theme: revised }] });
  const denied = await request("/themes/" + id, "DELETE", { revision: 3 });
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ error: "theme_in_use" });

  const origin = server.publicUrl;
  await server.close();
  server = await startServer(t.db, { publicUrl: origin });
  expect(await readCatalog()).toEqual({ revision: 3, activeId: id, mode: "system", themes: [{ id, theme: revised }] });
  expect(await readPublic()).toEqual({ mode: "system", ...look(revised) });
  expect((await request("/selection", "PUT", { revision: 3, id: "fern" })).status).toBe(200);
  const removed = await request("/themes/" + id, "DELETE", { revision: 4 });
  expect(await removed.json()).toEqual({ revision: 5, activeId: "fern", mode: "system", themes: [] });
});

it("stores the mode with the workspace, across restarts, and refuses stale or unknown modes", async () => {
  const dark = await request("/mode", "PUT", { revision: 0, mode: "dark" });
  expect(await dark.json()).toEqual({ revision: 1, activeId: defaultThemeId, mode: "dark", themes: [] });
  expect(await readPublic()).toEqual({ mode: "dark", ...look(starter) });

  // A second browser that read revision 0 can't overwrite the newer mode.
  const stale = await request("/mode", "PUT", { revision: 0, mode: "light" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "conflict" });
  for (const body of [{ revision: 1, mode: "auto" }, { revision: 1, mode: "Dark" }, { revision: 1 },
    { revision: 1, mode: "light", id: "fern" }, { revision: "1", mode: "light" }]) {
    expect((await request("/mode", "PUT", body)).status).toBe(400);
  }
  expect((await request("/mode", "PUT", { revision: 1, mode: "light" }, {})).status).toBe(401);
  expect((await request("/mode", "PUT", { revision: 1, mode: "light" }, { cookie, origin: "https://other.example" })).status).toBe(403);

  // Choosing a theme and changing the mode share one revision.
  expect((await request("/selection", "PUT", { revision: 1, id: "cinder" })).status).toBe(200);
  expect((await request("/mode", "PUT", { revision: 1, mode: "light" })).status).toBe(409);
  const origin = server.publicUrl;
  await server.close();
  server = await startServer(t.db, { publicUrl: origin });
  expect(await readCatalog()).toEqual({ revision: 2, activeId: "cinder", mode: "dark", themes: [] });
  const system = await request("/mode", "PUT", { revision: 2, mode: "system" });
  expect(await system.json()).toMatchObject({ revision: 3, mode: "system" });
  expect(await readPublic()).toEqual({ mode: "system", ...look(builtInThemes[1]!.theme) });
});

it("refuses version 1 files and no longer offers the retired starters", async () => {
  const version1 = { version: 1, name: "Earlier file", scheme: "dark", tokens: { bg: "#21191b", panel: "#302123", fg: "#ffeddb",
    muted: "#d4b5a8", accent: "#ffad74", accentInk: "#301c19", border: "#78564a", danger: "#ff9e97", success: "#a7d1a0",
    fontBody: "system-ui", fontHeading: "ui-monospace" } };
  const refused = await request("/themes", "POST", { revision: 0, theme: version1, activate: true });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: "invalid_theme", message: expect.stringContaining("version 2") });
  for (const id of ["canopy", "tide", "ember"]) {
    expect((await request("/selection", "PUT", { revision: 0, id })).status).toBe(404);
  }
  expect((await request("/themes", "POST", { revision: 0, theme: { ...starter, version: 3 } })).status).toBe(400);
  expect(await readCatalog()).toEqual({ revision: 0, activeId: defaultThemeId, mode: "system", themes: [] });
});

it("rejects conflicting concurrent editors, unsafe imports, and attempts to edit a built-in theme", async () => {
  const saves = await Promise.all(["A", "B"].map(name => request("/themes", "POST", { revision: 0, theme: { ...personal, name } })));
  expect(saves.map(r => r.status).sort()).toEqual([200, 409]);
  const current = await readCatalog();
  expect(current.themes).toHaveLength(1);
  expect(current.revision).toBe(1);
  const id = current.themes[0]!.id;
  const stale = await request("/themes/" + id, "DELETE", { revision: 0 });
  expect(await stale.json()).toMatchObject({ error: "conflict" });
  const invalid = { ...personal, light: { ...personal.light, bg: "url(https://example.test/image)" } };
  expect((await request("/themes/" + id, "PUT", { revision: 1, theme: invalid })).status).toBe(400);
  expect((await request("/themes/" + id, "PUT", { revision: 1, theme: { ...personal, style: "loud" } })).status).toBe(400);
  expect((await request("/themes", "POST", { revision: 1, theme: personal, activate: "true" })).status).toBe(400);
  expect((await request("/themes/cinder", "PUT", { revision: 1, theme: personal })).status).toBe(404);
  expect((await request("/themes/cinder", "DELETE", { revision: 1 })).status).toBe(404);
  expect((await request("/selection", "PUT", { revision: 1, id: "unknown" })).status).toBe(404);
  expect(await readCatalog()).toEqual(current);
});
