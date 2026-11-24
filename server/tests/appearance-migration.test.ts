// Themes have one format, version 2. A workspace upgraded from 0012 held version 1 themes or a
// retired starter's id, so its catalog starts over on Cerulean and both appearance reads still work.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { builtInThemes } from "../../shared/appearance/theme.mjs";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { PUBLIC_URL } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

const JOURNAL = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[];
};
// A theme as 0012 stored it: one palette, its scheme and two fonts.
const version1 = { version: 1, name: "Reading room", scheme: "light", tokens: { bg: "#eff1e4", panel: "#fafbf2", fg: "#182f24",
  muted: "#4a6150", accent: "#235b3f", accentInk: "#ffffff", border: "#b4c4ad", danger: "#923a27", success: "#24583b",
  fontBody: "system-ui", fontHeading: "Georgia" } };

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

it.each([
  ["a retired starter", "ember", []],
  ["a version 1 theme of its own", "custom-own", [{ id: "custom-own", theme: version1 }]],
])("starts a workspace on %s over on Cerulean", async (_label, activeId, themes) => {
  const workspace = await workspaceBeforeThemes();
  await t.pool.query("insert into workspace_appearance(workspace_id, revision, active_id, themes) values ($1, 7, $2, $3)",
    [workspace, activeId, JSON.stringify(themes)]);
  await runMigrations(t.pool);
  server = await startServer(t.db, { publicUrl: PUBLIC_URL });
  const login = await server.request("/api/auth/sign-in/username", {
    method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  expect(login.status).toBe(200);
  const catalog = await server.request("/api/appearance", { headers: { cookie: cookieHeader(login) } });
  expect(await catalog.json()).toEqual({ revision: 8, activeId: "cerulean", mode: "system", themes: [] });
  const active = await server.request("/api/appearance/active");
  const { style, fonts, light, dark } = builtInThemes[0]!.theme;
  expect(await active.json()).toEqual({ mode: "system", style, fonts, light, dark });
  await expect(t.pool.query("update workspace_appearance set mode = 'auto'")).rejects.toThrow(/workspace_appearance_mode_valid/);
});
