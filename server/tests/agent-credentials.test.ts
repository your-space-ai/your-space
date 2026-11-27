// Spec 017 decision 1: a kit names its app credentials and each route the one it is sent with, so a
// setup role uses an admin credential that no record role carries. The owner binds each separately.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { TEST_DATA_KEY as key } from "./helpers/env.ts";
import { parseAgentAccess, type AgentAccess } from "../src/apps/agent-kit.ts";
import { decrypt } from "../src/apps/settings.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate.ts";
import { app } from "../src/db/schema.ts";
import { dashboard, hash, identity, transaction } from "../src/agents/store.ts";
import { bind, createAgent, grant, manageKey } from "../src/agents/owner.ts";
import { discover, invoke } from "../src/agents/invoke.ts";
import { dispatchAppAction } from "../src/agents/transport.ts";

vi.mock("../src/agents/transport.ts", () => ({ dispatchAppAction: vi.fn() }));
let t: TestDatabase;
let agent: string, installation: string, owner: string, verifier: string;
const bearer = { location: "header", name: "Authorization", scheme: "Bearer" };
const access = parseAgentAccess({
  credentials: { records: { inject: bearer }, setup: { inject: bearer } },
  routes: {
    list: { method: "GET", path: "/items", effect: "read", credential: "records" },
    create: { method: "POST", path: "/items", credential: "records", approval: "allow" },
    fields: { method: "GET", path: "/meta/fields", effect: "read", credential: "setup" },
    "add-field": { method: "POST", path: "/meta/fields", credential: "setup", approval: "allow" },
  },
  roles: {
    editor: { title: "Editor", routes: ["list", "create"] },
    setup: { title: "Setup", routes: ["fields", "add-field"] },
  },
});
const records = "synthetic-record-key";
const admin = "synthetic-admin-key";
async function install(agentAccess: AgentAccess) {
  const [row] = await t.db
    .insert(app)
    .values({
      name: "example",
      title: "Example",
      sourceUrl: "https://example.test/app",
      repo: "sample/app",
      path: "compose.yaml",
      ref: "main",
      commit: "f".repeat(40),
      compose: "{}",
      images: {},
      adaptations: [],
      limits: {},
      installedBy: owner,
      state: "running",
      interface: { service: "app", port: 1234 },
      kit: { kit: 2, agentAccess },
    })
    .returning({ id: app.id });
  return row!.id;
}
const binding = (body: Record<string, unknown>) => transaction(t.db, (c) => bind(c, installation, body, key));
const allow = (roles: string[], revision: number, bindingRevision: number) =>
  transaction(t.db, (c) => grant(c, owner, agent, installation, { revision, bindingRevision, roles, overrides: {} }));
const actions = async () =>
  (await transaction(t.db, async (c) => discover(c, await identity(c, verifier)))).actions.map((a) => a.actionId).sort();

beforeEach(async () => {
  t = await createTestDatabase();
  await createOwnerWithPassword(t.db);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  await transaction(t.db, async (c) => {
    agent = (await createAgent(c, owner, "Builder")).id;
    verifier = hash((await manageKey(c, owner, agent)).key!);
  });
  vi.mocked(dispatchAppAction).mockReset().mockResolvedValue({ status: 201, body: { ok: true }, usable: true });
});
afterEach(async () => {
  await t?.destroy();
});

it("parses named credentials, one per route and per role, and refuses a mix", () => {
  expect(access.credentials).toEqual({ records: { inject: bearer }, setup: { inject: bearer } });
  expect(access.routes["add-field"]!.credential).toBe("setup");
  const base = { credentials: { records: { inject: bearer }, setup: { inject: bearer } } };
  const list = { method: "GET", path: "/items", effect: "read", credential: "records" };
  const meta = { method: "POST", path: "/meta", credential: "setup" };
  for (const kit of [
    { ...base, routes: { list, meta }, roles: { both: { title: "Both", routes: ["list", "meta"] } } },
    { ...base, routes: { list: { ...list, credential: undefined } }, roles: {} },
    { ...base, routes: { list: { ...list, credential: "missing" } }, roles: {} },
    { ...base, credential: { binding: "key", inject: bearer }, routes: { list }, roles: {} },
    { credential: { binding: "key", inject: bearer }, routes: { list }, roles: {} },
    { credentials: {}, routes: {}, roles: {} },
  ]) {
    expect(() => parseAgentAccess(JSON.parse(JSON.stringify(kit)))).toThrow();
  }
});

it("sends each route with only its own credential, and never a route whose credential isn't bound", async () => {
  installation = await install(access);
  await expect(binding({ revision: 0, enabledRoles: ["setup"], credentials: { records } })).rejects.toThrow(
    /Supply the setup credential/,
  );
  await expect(binding({ revision: 0, enabledRoles: [], credential: records })).rejects.toThrow(/supply credentials/);
  const first = await binding({ revision: 0, enabledRoles: ["editor"], credentials: { records } });
  await allow(["editor"], 0, first.revision);
  expect(await actions()).toEqual(["create", "list"]);
  const overview = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(overview.installations[0]).toMatchObject({
    credentials: [
      { name: "records", bound: true },
      { name: "setup", bound: false },
    ],
    roleCredentials: { editor: "records", setup: "setup" },
  });

  // Binding the admin credential later keeps the record grant.
  const second = await binding({ revision: first.revision, enabledRoles: ["editor", "setup"], credentials: { setup: admin } });
  await allow(["editor", "setup"], 1, second.revision);
  expect(await actions()).toEqual(["add-field", "create", "fields", "list"]);
  await invoke(t.db, key, verifier, { installationId: installation, actionId: "create", input: { body: { title: "x" } } });
  await invoke(t.db, key, verifier, { installationId: installation, actionId: "add-field", input: { body: { name: "y" } } });
  const sent = vi.mocked(dispatchAppAction).mock.calls.map(([call]) => call.headers.Authorization);
  expect(sent).toEqual(["Bearer " + records, "Bearer " + admin]);
  const stored = (await t.pool.query("select name, credential from agent_credential order by name")).rows;
  expect(stored.map((row) => row.name)).toEqual(["records", "setup"]);
  expect(JSON.stringify(stored)).not.toContain(admin);
  expect(decrypt(key, stored[1].credential)).toBe(admin);

  // A response that echoes the other bound credential is withheld.
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body: { leaked: admin }, usable: true });
  const read = await invoke(t.db, key, verifier, { installationId: installation, actionId: "list" });
  expect(read).toEqual({ id: read.id, status: "unknown" });

  // Replacing the admin credential withdraws only the setup role from the grant.
  const third = await binding({ revision: second.revision, enabledRoles: ["editor", "setup"], credentials: { setup: admin + "-2" } });
  expect((await t.pool.query("select roles from agent_grant")).rows[0].roles).toEqual(["editor"]);
  expect(await actions()).toEqual(["create", "list"]);
  // Removing it leaves the setup role unbindable until it is supplied again.
  await expect(
    binding({ revision: third.revision, enabledRoles: ["editor", "setup"], credentials: { setup: null } }),
  ).rejects.toThrow(/Supply the setup credential/);
  await binding({ revision: third.revision, enabledRoles: ["editor"], credentials: { setup: null } });
  expect((await t.pool.query("select name from agent_credential")).rows).toEqual([{ name: "records" }]);
});

it("keeps a kit with one credential working as before, and moves named credentials with the data key", async () => {
  const single = parseAgentAccess({
    credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } },
    routes: { list: { method: "GET", path: "/items", effect: "read" } },
    roles: { reader: { title: "Reader", routes: ["list"] } },
  });
  installation = await install(single);
  await expect(binding({ revision: 0, enabledRoles: ["reader"], credentials: { service: records } })).rejects.toThrow(
    /supply credential/,
  );
  const bound = await binding({ revision: 0, enabledRoles: ["reader"], credential: records });
  await allow(["reader"], 0, bound.revision);
  // Replacing a kit's only credential still clears its grants.
  await binding({ revision: bound.revision, enabledRoles: ["reader"], credential: records + "-2" });
  expect((await t.pool.query("select count(*) from agent_grant")).rows[0].count).toBe("0");
  const next = key + "-next";
  await moveSettingsToDataKey(t.db, { dataKey: next, previousDataKey: key });
  const { credential } = (await t.pool.query("select credential from agent_credential")).rows[0];
  expect(decrypt(next, credential)).toBe(records + "-2");
  // A kit change retires its credentials with its grants.
  await t.pool.query("update app set commit=$2 where id=$1", [installation, "e".repeat(40)]);
  expect((await t.pool.query("select count(*) from agent_credential")).rows[0].count).toBe("0");
});

it("moves a credential bound before 0018 to a row named by its kit's binding", async () => {
  await t.destroy();
  t = await createTestDatabase({ migrate: false });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"));
  const before = journal.entries.filter((entry: { tag: string }) => entry.tag < "0018_agent_credentials");
  const folder = mkdtempSync(join(tmpdir(), "ys-before-credentials-"));
  try {
    mkdirSync(join(folder, "meta"));
    for (const { tag } of before) cpSync(join(MIGRATIONS_FOLDER, tag + ".sql"), join(folder, tag + ".sql"));
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: before }));
    await runMigrations(t.pool, folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  await createOwnerWithPassword(t.db);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  const kit = JSON.stringify({ kit: 2, agentAccess: { credential: { binding: "service", inject: bearer }, routes: {}, roles: {} } });
  const id = (
    await t.pool.query(
      `insert into app(name,title,source_url,repo,path,ref,commit,compose,images,adaptations,limits,installed_by,state,kit)
      values ('legacy','Legacy','https://example.test/app','sample/app','compose.yaml','main',$1,'{}','{}','[]','{}',$2,'running',$3) returning id`,
      ["f".repeat(40), owner, kit],
    )
  ).rows[0].id;
  await t.pool.query(
    "insert into agent_binding(app_id,credential,enabled_roles,kit_digest,revision) values ($1,'sealed-value','{}','d',1)",
    [id],
  );
  await runMigrations(t.pool);
  expect((await t.pool.query("select app_id, name, credential from agent_credential")).rows).toEqual([
    { app_id: id, name: "service", credential: "sealed-value" },
  ]);
  expect((await t.pool.query("select credential from agent_binding")).rows).toEqual([{ credential: null }]);
});
