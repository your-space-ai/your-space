// Version 2 themes replace the version 1 starters. A workspace upgraded from 0012 keeps what it
// showed: a retired starter, chosen or by default, becomes the owner's own copy, still selected.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { builtInThemes, retiredStarterThemes, validateTheme, type Theme } from "../../shared/appearance/theme.mjs";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { PUBLIC_URL } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

type Catalog = { revision: number; activeId: string; mode: string; themes: { id: string; theme: Theme }[] };
const JOURNAL = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[];
};
const retired = (id: string) => retiredStarterThemes.find(item => item.id === id)!.theme;

let t: TestDatabase;
let server: TestServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; await t?.destroy(); });

/** A claimed workspace at schema 0012, before version 2 themes. */
async function workspaceBeforeThemes() {
  t = await createTestDatabase({ migrate: false });
  const baseline = mkdtempSync(join(tmpdir(), "ys-before-themes-"));
  const entries = JOURNAL.entries.filter(entry => entry.idx <= 12);
  expect(entries.at(-1)?.tag).toBe("0012_owner_layout");
  try {
    mkdirSync(join(baseline, "meta"));
    for (const { tag } of entries) cpSync(join(MIGRATIONS_FOLDER, tag + ".sql"), join(baseline, tag + ".sql"));
    writeFileSync(join(baseline, "meta", "_journal.json"), JSON.stringify({ ...JOURNAL, entries }));
    await runMigrations(t.pool, baseline);
  } finally {
    rmSync(baseline, { recursive: true, force: true });
  }
  await createOwnerWithPassword(t.db, OWNER, PUBLIC_URL);
  const { rows } = await t.pool.query<{ id: string }>("select workspace_id as id from installation where state = 'claimed'");
  return rows[0]!.id;
}

async function upgrade() {
  await runMigrations(t.pool);
  server = await startServer(t.db, { publicUrl: PUBLIC_URL });
  const login = await server.request("/api/auth/sign-in/username", {
    method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  expect(login.status).toBe(200);
  const cookie = cookieHeader(login);
  const catalog = await server.request("/api/appearance", { headers: { cookie } });
  expect(catalog.status).toBe(200);
  const active = await server.request("/api/appearance/active");
  return { cookie, catalog: await catalog.json() as Catalog, active: await active.json() };
}

it("keeps Canopy for a workspace that never chose a theme", async () => {
  await workspaceBeforeThemes();
  const { catalog, active } = await upgrade();
  const canopy = validateTheme(retired("canopy"));
  expect(catalog).toEqual({ revision: 1, activeId: expect.stringMatching(/^custom-[0-9a-f-]{36}$/), mode: "system",
    themes: [{ id: catalog.activeId, theme: canopy }] });
  const { style, fonts, light, dark } = canopy;
  expect(active).toEqual({ mode: "system", style, fonts, light, dark });
  expect(light).toEqual(dark);
});

it("keeps a chosen retired starter as the owner's copy and converts saved version 1 themes", async () => {
  const workspace = await workspaceBeforeThemes();
  const saved = { ...retired("tide"), name: "Harbor" };
  await t.pool.query("insert into workspace_appearance(workspace_id, revision, active_id, themes) values ($1, 7, 'ember', $2)",
    [workspace, JSON.stringify([{ id: "custom-1", theme: saved }])]);
  const { cookie, catalog, active } = await upgrade();
  const copy = catalog.themes[1]!;
  expect(catalog).toEqual({ revision: 8, activeId: copy.id, mode: "system", themes: [
    { id: "custom-1", theme: validateTheme(saved) }, { id: copy.id, theme: validateTheme(retired("ember")) },
  ] });
  expect(copy.id).toMatch(/^custom-/);
  expect(active).toMatchObject({ light: validateTheme(retired("ember")).light, style: "crisp" });

  // The next change stores the catalog as version 2. The copy is the owner's to keep or delete.
  const choose = await server!.request("/api/appearance/selection", {
    method: "PUT", headers: { cookie }, body: JSON.stringify({ revision: 8, id: "fern" }),
  });
  expect(choose.status).toBe(200);
  const { rows } = await t.pool.query<{ themes: { theme: { version: number } }[] }>("select themes from workspace_appearance");
  expect(rows[0]!.themes.map(entry => entry.theme.version)).toEqual([2, 2]);
  const removed = await server!.request("/api/appearance/themes/" + copy.id, {
    method: "DELETE", headers: { cookie }, body: JSON.stringify({ revision: 9 }),
  });
  expect(await removed.json()).toMatchObject({ activeId: "fern", themes: [{ id: "custom-1" }] });
});

it.each(["canopy", "tide", "ember"])("keeps the chosen %s starter, as the file it was, still selected", async (id) => {
  const workspace = await workspaceBeforeThemes();
  await t.pool.query("insert into workspace_appearance(workspace_id, revision, active_id, themes) values ($1, 3, $2, '[]')", [workspace, id]);
  await runMigrations(t.pool);
  // The migration stores the version 1 file the workspace was showing, not a version 2 lookalike.
  const { rows } = await t.pool.query<{ active_id: string; themes: { id: string; theme: unknown }[] }>(
    "select active_id, themes from workspace_appearance");
  expect(rows).toEqual([{ active_id: expect.stringMatching(/^custom-[0-9a-f-]{36}$/), themes: [{ id: rows[0]!.active_id, theme: retired(id) }] }]);
  const { catalog, active } = await upgrade();
  const copy = validateTheme(retired(id));
  expect(catalog).toEqual({ revision: 4, activeId: rows[0]!.active_id, mode: "system", themes: [{ id: rows[0]!.active_id, theme: copy }] });
  const { style, fonts, light, dark } = copy;
  expect(active).toEqual({ mode: "system", style, fonts, light, dark });
});

it("leaves a workspace on a custom theme as it was, and a new workspace starts on Cerulean", async () => {
  const workspace = await workspaceBeforeThemes();
  const own = { ...retired("canopy"), name: "Reading room" };
  await t.pool.query("insert into workspace_appearance(workspace_id, revision, active_id, themes) values ($1, 2, 'custom-own', $2)",
    [workspace, JSON.stringify([{ id: "custom-own", theme: own }])]);
  const { catalog } = await upgrade();
  expect(catalog).toEqual({ revision: 2, activeId: "custom-own", mode: "system", themes: [{ id: "custom-own", theme: validateTheme(own) }] });
  await expect(t.pool.query("update workspace_appearance set mode = 'auto'")).rejects.toThrow(/workspace_appearance_mode_valid/);

  await server!.close();
  await t.destroy();
  t = await createTestDatabase();
  server = await startServer(t.db, { publicUrl: PUBLIC_URL });
  const fresh = await server.request("/api/appearance/active");
  const { style, fonts, light, dark } = builtInThemes[0]!.theme;
  expect(await fresh.json()).toEqual({ mode: "system", style, fonts, light, dark });
});
