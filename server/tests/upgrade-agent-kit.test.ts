import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { operatorActorId, recordEvent } from "../src/actors.ts";
import { kitFromFile } from "../src/apps/kits.ts";
import { encrypt } from "../src/apps/settings.ts";
import { inspectAgentKit, upgradeAgentKit } from "../src/apps/upgrade-agent-kit.ts";
import { app, appSetting, installJob } from "../src/db/schema.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { createAgent } from "../src/agents/owner.ts";
import { transaction } from "../src/agents/store.ts";

const base = {
  kit: 1,
  title: "Records",
  interface: { service: "ui", port: 8080 },
  env: { APP_SECRET: { generate: {} }, BATCH: 20 },
  limits: { ui: { memory: "128M" } },
  pane: false,
};
const agentAccess = {
  credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } },
  roles: { reader: { title: "Reader", routes: ["list"] } },
  routes: { list: { method: "GET", path: "/items", effect: "read", outputFields: ["id"] } },
};
const oldKit = kitFromFile(JSON.stringify(base), null);
const candidate = { ...base, kit: 2, agentAccess };
const candidateText = JSON.stringify(candidate);
const newKit = kitFromFile(candidateText, null);
let t: TestDatabase, id: string, operator: string, generation: string;

function appValues(name: string) {
  return {
    name,
    title: "Workspace records",
    sourceUrl: "sha256:" + "a".repeat(64),
    repo: "",
    path: "compose.yaml",
    ref: "",
    commit: "",
    compose: "services:\n  ui:\n    image: records\n    volumes: [records-data:/data]\nvolumes:\n  records-data: {}\n",
    images: { records: { digest: "sha256:" + "1".repeat(64) } },
    adaptations: [],
    limits: { ui: { cpus: 0.5, memory: 256 * 1024 * 1024 } },
    installedBy: operator,
    state: "stopped" as const,
    desired: "stopped" as const,
    interface: base.interface,
    pane: false,
    frame: false,
    publish: { port: 49990, bind: "127.0.0.1", link: "https://records.example.test" },
    kit: oldKit.kit,
    kitSource: oldKit.source,
  };
}

beforeEach(async () => {
  t = await createTestDatabase();
  operator = await operatorActorId(t.db);
  const [row] = await t.db.insert(app).values(appValues("records")).returning({ id: app.id });
  id = row!.id;
  await recordEvent(t.db, "app.installed", operator, null, id);
  generation = (await inspectAgentKit(t.db, "records")).installation;
});
afterEach(async () => {
  await t?.destroy();
});

const snapshots = () => t.db.select().from(app).where(eq(app.id, id));
const command = (options: string[], input?: string) =>
  runCommand("upgrade-agent-kit", ["records", ...options, "--json"], {
    databaseUrl: t.url,
    input,
  });
const expected = (pin = oldKit.source) => ["--expect-installation", generation, "--expect-kit", pin];

it("inspects and upgrades a stopped installation through stdin, retaining its identity, data, and publication", async () => {
  const [before] = await snapshots();
  const setting = { appId: id, name: "APP_SECRET", value: encrypt(TEST_DATA_KEY, "example"), generated: true, secret: true };
  await t.db.insert(appSetting).values(setting);
  const [other] = await t.db.insert(app).values(appValues("other")).returning();
  const info = await command(["--inspect"]);
  expect(info.code).toBe(0);
  expect(info.json).toEqual({
    ok: true,
    name: "records",
    appId: id,
    installation: generation,
    kitSource: oldKit.source,
    kitVersion: 1,
  });
  const upgraded = await command(["--kit", "-", ...expected()], candidateText);
  expect(upgraded.code).toBe(0);
  expect(upgraded.json).toEqual({
    ok: true,
    name: "records",
    appId: id,
    installation: generation,
    previousKitSource: oldKit.source,
    kitSource: newKit.source,
    kitVersion: 2,
    runtime: "stopped",
  });
  const [after] = await snapshots();
  expect(after).toEqual({ ...before, kit: newKit.kit, kitSource: newKit.source, updatedAt: expect.any(Date) });
  expect((await t.db.select().from(app).where(eq(app.id, other!.id)))[0]).toEqual(other);
  expect(await t.db.select().from(appSetting)).toEqual([{ ...setting, publishedDefault: null }]);
  expect((await t.pool.query("select actor_id,subject_app_id from event where type='app.agent_kit_upgraded'")).rows).toEqual([
    { actor_id: operator, subject_app_id: id },
  ]);
  expect(
    (
      await t.pool.query(
        "select (select count(*) from agent_grant) as grants, (select count(*) from agent_binding) as bindings, (select count(*) from agent_key) as keys, (select count(*) from install_job) as jobs",
      )
    ).rows[0],
  ).toEqual({ grants: "0", bindings: "0", keys: "0", jobs: "0" });
  expect((await command(["--refresh", ...expected(newKit.source)])).json.runtime).toBe("stopped");
  expect((await command(["--refresh", ...expected()])).json.error).toBe("upgrade_conflict");
  expect((await command(["--kit", "-", ...expected()], candidateText)).code).toBe(2);
});

it("rejects retargeting, nonlocal or stale sources, changed settings, and invalid agent catalogs without changes", async () => {
  const before = await snapshots();
  await expect(
    upgradeAgentKit(t.db, "records", "install:" + "a".repeat(64), oldKit.source, candidateText),
  ).rejects.toMatchObject({ code: "upgrade_conflict" });
  await expect(upgradeAgentKit(t.db, "records", generation, newKit.source, candidateText)).rejects.toMatchObject({
    code: "upgrade_conflict",
  });
  for (const patch of [
    { title: "Changed" },
    { limits: { ui: { memory: "512M" } } },
    { source: { repo: "someone/records", path: "compose.yaml", commit: "c".repeat(40) } },
    { interface: { service: "other", port: 8080 } },
    { env: { APP_SECRET: { generate: {} } } },
    { env: { APP_SECRET: { generate: {} }, BATCH: 20, MORE: "x" } },
    { pane: true },
  ]) {
    await expect(
      upgradeAgentKit(t.db, "records", generation, oldKit.source, JSON.stringify({ ...candidate, ...patch })),
    ).rejects.toMatchObject({ code: "upgrade_conflict" });
  }
  await expect(
    upgradeAgentKit(t.db, "records", generation, oldKit.source, JSON.stringify({ ...candidate, agentAccess: {} })),
  ).rejects.toMatchObject({ name: "KitError" });
  expect(await snapshots()).toEqual(before);
  await t.db.update(app).set({ kitSource: "https://example.test/published/kit.yaml" }).where(eq(app.id, id));
  await expect(
    upgradeAgentKit(t.db, "records", generation, "https://example.test/published/kit.yaml", candidateText),
  ).rejects.toMatchObject({ code: "upgrade_conflict" });
});

it("checks the source for GitHub Compose installs and accepts equivalent normalized kit fields", async () => {
  const source = { repo: "example/records", path: "container/compose.yaml" };
  const pin = { ...source, commit: "c".repeat(40) };
  const original = kitFromFile(JSON.stringify({ ...base, source: pin }), source);
  await t.db
    .update(app)
    .set({ ...source, commit: pin.commit, kit: original.kit, kitSource: original.source })
    .where(eq(app.id, id));
  await expect(upgradeAgentKit(t.db, "records", generation, original.source, candidateText)).rejects.toMatchObject({
    name: "KitError",
  });
  // The kit pins the installed Compose commit; an upgrade can't move it to another.
  await expect(
    upgradeAgentKit(t.db, "records", generation, original.source, JSON.stringify({ ...candidate, source: { ...pin, commit: "d".repeat(40) } })),
  ).rejects.toMatchObject({ code: "upgrade_conflict" });
  const text = JSON.stringify({ ...candidate, source: pin, limits: { ui: { memory: 128 * 1024 * 1024 } }, env: { APP_SECRET: { generate: true }, BATCH: "20" } });
  await expect(upgradeAgentKit(t.db, "records", generation, original.source, text)).resolves.toMatchObject({
    kitSource: kitFromFile(text, source).source,
  });
});

it("upgrades a kit stored before env, whose settings are the same in env", async () => {
  const { env, ...rest } = oldKit.kit;
  const stored = { ...rest, generate: { APP_SECRET: { bytes: 32, encoding: "base64url" as const } }, set: { BATCH: "20" } };
  await t.db.update(app).set({ kit: stored }).where(eq(app.id, id));
  await expect(upgradeAgentKit(t.db, "records", generation, oldKit.source, candidateText)).resolves.toMatchObject({ kitVersion: 2 });
});

it("serializes competing upgrades and retires stale grants and credentials through the persisted kit change", async () => {
  await createOwnerWithPassword(t.db);
  const owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  const agent = await transaction(t.db, (c) => createAgent(c, owner, "Example"));
  await t.pool.query(
    "insert into agent_binding(app_id,credential,enabled_roles,kit_digest,revision) values($1,$2,'{reader}',$3,1)",
    [id, "synthetic-encrypted-placeholder", oldKit.source],
  );
  await t.pool.query(
    "insert into agent_grant(app_id,agent_id,roles,ask_all_writes,overrides,revision) values($1,$2,'{reader}',true,'{}',1)",
    [id, agent.id],
  );
  const competing = await Promise.allSettled(
    [candidateText, candidateText + "\n"].map((text) => upgradeAgentKit(t.db, "records", generation, oldKit.source, text)),
  );
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(competing.find((r) => r.status === "rejected")?.reason).toMatchObject({ code: "upgrade_conflict" });
  expect((await t.pool.query("select * from agent_grant")).rowCount).toBe(0);
  expect(
    (await t.pool.query("select credential,enabled_roles,kit_digest,revision from agent_binding where app_id=$1", [id])).rows,
  ).toEqual([{ credential: null, enabled_roles: [], kit_digest: "", revision: 2 }]);
});

it("refuses active lifecycle operations and removed installations", async () => {
  await t.db.insert(installJob).values({ appId: id, kind: "apply", state: "running" });
  await expect(upgradeAgentKit(t.db, "records", generation, oldKit.source, candidateText)).rejects.toMatchObject({
    code: "upgrade_conflict",
  });
  await t.db.update(app).set({ desired: "removed" }).where(eq(app.id, id));
  expect((await command(["--inspect"])).json.error).toBe("app_not_found");
  await expect(upgradeAgentKit(t.db, "records", generation, oldKit.source, candidateText)).rejects.toMatchObject({
    code: "app_not_found",
  });
});

it("rejects missing preconditions and oversized stdin at the operator boundary", async () => {
  expect((await command(["--kit", "-"], "")).code).toBe(1);
  expect((await command(["--kit", "-", ...expected()], "a".repeat(256 * 1024 + 1))).json.error).toBe("invalid_kit");
  expect((await snapshots())[0]?.kitSource).toBe(oldKit.source);
});

it("invalidates a prior inspection after a retained-data reinstall of the same app ID and kit", async () => {
  await t.db.transaction(async (tx) => {
    await tx.update(app).set({ desired: "removed", state: "removed" }).where(eq(app.id, id));
    await tx.update(app).set({ desired: "stopped", state: "stopped" }).where(eq(app.id, id));
    await recordEvent(tx, "app.installed", operator, null, id);
  });
  const current = await inspectAgentKit(t.db, "records");
  expect(current.installation).not.toBe(generation);
  expect(current).toMatchObject({ appId: id, kitSource: oldKit.source });
  await expect(upgradeAgentKit(t.db, "records", generation, oldKit.source, candidateText)).rejects.toMatchObject({
    code: "upgrade_conflict",
  });
  await expect(upgradeAgentKit(t.db, "records", current.installation, oldKit.source, candidateText)).resolves.toMatchObject({
    appId: id,
  });
});
it("returns precise refresh recovery after a committed upgrade if interface refresh fails", async () => {
  await t.db.update(app).set({ desired: "running", state: "running" }).where(eq(app.id, id));
  // Synthetic unreadable settings stop the refresh before it can reach a runtime.
  await t.db.insert(appSetting).values({ appId: id, name: "APP_SECRET", value: "invalid-test-ciphertext", secret: true });
  const result = await command(["--kit", "-", ...expected()], candidateText);
  expect(result.code).toBe(3);
  expect(result.json).toMatchObject({
    ok: false,
    error: "interface_refresh_failed",
    appId: id,
    installation: generation,
    kitSource: newKit.source,
    kitVersion: 2,
  });
  const [saved] = await snapshots();
  expect(saved).toMatchObject({ id, kitSource: newKit.source, desired: "running" });
  expect(saved?.kit).toEqual(newKit.kit);
  expect((await command(["--refresh", ...expected()])).code).toBe(2);
});

it("pins the exact bytes of a valid local kit file and rejects invalid UTF-8", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ys-kit-"));
  const file = join(directory, "candidate.yaml");
  try {
    await writeFile(file, Buffer.from([0xff]));
    expect((await command(["--kit", file, ...expected()])).json.error).toBe("invalid_kit");
    const text = "\ufeff" + candidateText;
    await writeFile(file, text);
    expect((await command(["--kit", file, ...expected()])).json.kitSource).toBe(kitFromFile(text, null).source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
