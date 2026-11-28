// App keys bound per name (spec 017 decision 1, kept by 018), and the migration of 017's grants to
// per-app grants (spec 018 decision 8).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { TEST_DATA_KEY as key } from "./helpers/env.ts";
import { parseAgentAccess } from "../src/apps/agent-kit.ts";
import { decrypt } from "../src/apps/settings.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate.ts";
import { app } from "../src/db/schema.ts";
import { transaction } from "../src/agents/store.ts";
import { bind } from "../src/agents/owner.ts";

let t: TestDatabase;
let owner: string;
const bearer = { location: "header", name: "Authorization", scheme: "Bearer" };
async function install(agentAccess: unknown, name = "example") {
  const [row] = await t.db
    .insert(app)
    .values({
      name,
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
      kit: { kit: 2, agentAccess } as never,
    })
    .returning({ id: app.id });
  return row!.id;
}
beforeEach(async () => {
  t = await createTestDatabase();
  await createOwnerWithPassword(t.db);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
});
afterEach(async () => {
  await t?.destroy();
});

it("binds each named key separately, under the data key, and a kit with one key takes credential", async () => {
  const named = await install(parseAgentAccess({ api: "/rest", credentials: { records: { inject: bearer }, setup: { inject: bearer } } }));
  const bound = (body: Record<string, unknown>) => transaction(t.db, (c) => bind(c, named, body, key));
  await expect(bound({ revision: 0, credential: "x" })).rejects.toThrow(/supply credentials/);
  await expect(bound({ revision: 0, credentials: { other: "x" } })).rejects.toThrow(/only the credentials this kit names/);
  const first = await bound({ revision: 0, credentials: { records: "synthetic-record-key" } });
  await bound({ revision: first.revision, credentials: { setup: "synthetic-admin-key" } });
  const stored = (await t.pool.query("select name, credential from agent_credential order by name")).rows;
  expect(stored.map((row) => row.name)).toEqual(["records", "setup"]);
  expect(JSON.stringify(stored)).not.toContain("synthetic-admin-key");
  const next = key + "-next";
  await moveSettingsToDataKey(t.db, { dataKey: next, previousDataKey: key });
  expect(decrypt(next, (await t.pool.query("select credential from agent_credential where name='setup'")).rows[0].credential)).toBe("synthetic-admin-key");

  const single = await install(parseAgentAccess({ api: "/", credential: { binding: "service", inject: bearer } }), "single");
  await expect(transaction(t.db, (c) => bind(c, single, { revision: 0, credentials: { service: "x" } }, key))).rejects.toThrow(/supply credential/);
  await transaction(t.db, (c) => bind(c, single, { revision: 0, credential: "synthetic-service-key" }, key));
  expect((await t.pool.query("select name from agent_credential where app_id=$1", [single])).rows).toEqual([{ name: "service" }]);
});

it("migrates 017's grants to per-app grants with their key and the routes that asked", async () => {
  await t.destroy();
  t = await createTestDatabase({ migrate: false });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"));
  const before = journal.entries.filter((entry: { tag: string }) => entry.tag < "0019_agent_access_per_app");
  const folder = mkdtempSync(join(tmpdir(), "ys-before-per-app-"));
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
  // A 017 kit: records and setup keys, a reader, an editor, a setup role and a role with no routes.
  const kit = {
    kit: 2,
    agentAccess: {
      credentials: { records: { inject: bearer }, setup: { inject: bearer } },
      roles: {
        reader: { title: "Reader", routes: ["list", "show"] },
        editor: { title: "Editor", routes: ["list", "create", "edit"] },
        setup: { title: "Setup", routes: ["fields"] },
        empty: { title: "Empty", routes: [] },
      },
      routes: {
        list: { method: "GET", path: "/rest/items", effect: "read", credential: "records" },
        show: { method: "GET", path: "/rest/items/{id}", effect: "read", approval: "ask", credential: "records" },
        create: { method: "POST", path: "/rest/items", credential: "records" },
        edit: { method: "PATCH", path: "/rest/items/{id}", credential: "records", approval: "allow" },
        fields: { method: "POST", path: "/rest/metadata/fields", credential: "setup" },
      },
    },
  };
  const id = (
    await t.pool.query(
      `insert into app(name,title,source_url,repo,path,ref,commit,compose,images,adaptations,limits,installed_by,state,kit,interface)
      values ('twin','Twin','https://example.test/app','sample/app','compose.yaml','main',$1,'{}','{}','[]','{}',$2,'running',$3,'{"service":"app","port":1}') returning id`,
      ["f".repeat(40), owner, JSON.stringify(kit)],
    )
  ).rows[0].id;
  await t.pool.query(
    "insert into agent_binding(app_id,credential,enabled_roles,kit_digest,revision) values ($1,null,'{reader,editor,setup,empty}','d',1)",
    [id],
  );
  await t.pool.query("insert into agent_credential(app_id,name,credential) values ($1,'records','sealed-records')", [id]);
  const agents: Record<string, string> = {};
  for (const [name, roles, overrides] of [
    ["reader", "{reader}", {}],
    ["editor", "{editor}", { create: "allow" }],
    ["asker", "{editor}", {}],
    ["both", "{editor,setup}", {}],
    ["empty", "{empty}", {}],
    ["none", "{}", {}],
  ] as const) {
    const agent = (
      await t.pool.query(
        `with a as (insert into actor(kind) values ('agent') returning id)
        insert into external_agent(id,owner_id,workspace_id,name) select a.id,$1,i.workspace_id,$2 from a cross join installation i returning id`,
        [owner, name],
      )
    ).rows[0].id;
    agents[name] = agent;
    await t.pool.query(
      "insert into agent_grant(app_id,agent_id,roles,ask_all_writes,overrides,revision) values ($1,$2,$3,false,$4,1)",
      [id, agent, roles, JSON.stringify(overrides)],
    );
  }
  const key = (await t.pool.query("insert into agent_key(agent_id,verifier) values ($1,'v') returning id", [agents.editor])).rows[0].id;
  await t.pool.query(
    "insert into agent_request(agent_id,key_id,app_id,route,status,input,binding_revision,grant_revision,expires_at) values ($1,$2,$3,'create','pending','sealed',1,1,now()+interval '1 hour')",
    [agents.editor, key, id],
  );
  await runMigrations(t.pool);

  const grants = Object.fromEntries(
    (await t.pool.query("select agent_id, credential, asks from agent_grant")).rows.map((row) => [row.agent_id, row]),
  );
  const asks = (agent: string) => [...grants[agent].asks].sort((a: { path: string; method: string }, b: { path: string; method: string }) => (a.method + a.path).localeCompare(b.method + b.path));
  // A reader keeps its key; its read that asked still asks.
  expect(grants[agents.reader]).toMatchObject({ credential: "records" });
  expect(asks(agents.reader)).toEqual([{ method: "GET", path: "/rest/items/*" }]);
  // An editor's write the owner allowed doesn't ask; a write nobody set does.
  expect(grants[agents.editor]).toMatchObject({ credential: "records", asks: [] });
  expect(asks(agents.asker)).toEqual([{ method: "POST", path: "/rest/items" }]);
  // A grant on two keys waits for the owner to pick one.
  expect(grants[agents.both].credential).toBeNull();
  expect(asks(agents.both)).toEqual([
    { method: "POST", path: "/rest/items" },
    { method: "POST", path: "/rest/metadata/fields" },
  ]);
  // A grant that reached nothing gives nothing.
  expect(grants[agents.empty]).toBeUndefined();
  expect(grants[agents.none]).toBeUndefined();
  // A call pending under 017 names a route ID; it goes stale.
  expect((await t.pool.query("select status, input from agent_request")).rows).toEqual([{ status: "stale", input: null }]);
  // The stored kit is left as it is (spec 018 decision 11).
  expect((await t.pool.query("select kit from app where id=$1", [id])).rows[0].kit).toEqual(kit);
});
