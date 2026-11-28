// T041: a newer build's migration upgrades an installation in place (FR-024, cross-cutting scenario 8).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, sql } from "drizzle-orm";
import { account, member, organization, session, user, verification } from "../src/db/auth-schema.ts";
import { createDatabase, type Db } from "../src/db/client.ts";
import { actor, app, event, installation } from "../src/db/schema.ts";
import { MIGRATIONS_FOLDER, runMigrations, schemaVersion } from "../src/migrate.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { PUBLIC_URL, TEST_DATA_KEY, TEST_SECRET } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer } from "./helpers/server.ts";
import { counts, snapshot } from "./helpers/state.ts";

// The shipped journal. The test migration goes after its last entry, so adding real migrations needs no change here.
const JOURNAL = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};
const LAST = JOURNAL.entries.at(-1)!;
// The schema version of the current build, and of the newer build with one more migration.
const CURRENT_VERSION = JOURNAL.entries.length;
const NEWER_VERSION = CURRENT_VERSION + 1;

// A later build's migration: a new column with a default on an identity table, and a new table.
const UPGRADE_TAG = `${String(CURRENT_VERSION).padStart(4, "0")}_test_upgrade`;
const UPGRADE_WHEN = LAST.when + 60_000;
const UPGRADE_SQL = `ALTER TABLE "user" ADD COLUMN "test_locale" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
CREATE TABLE "test_upgrade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL REFERENCES "actor"("id") ON DELETE restrict
);
`;

// The rows drizzle records: each migration file's hash and its journal timestamp.
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const SHIPPED_ROWS = JOURNAL.entries.map((e) => ({
  hash: sha256(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), "utf8")),
  createdAt: e.when,
}));
const UPGRADE_ROW = { hash: sha256(UPGRADE_SQL), createdAt: UPGRADE_WHEN };
const ALL_HASHES = [...SHIPPED_ROWS, UPGRADE_ROW].map((r) => r.hash);

// The newer build's migrations folder: the shipped migrations plus the test migration.
let newerBuild: string;
beforeAll(() => {
  newerBuild = mkdtempSync(join(tmpdir(), "ys-migrations-"));
  cpSync(MIGRATIONS_FOLDER, newerBuild, { recursive: true });
  writeFileSync(join(newerBuild, `${UPGRADE_TAG}.sql`), UPGRADE_SQL);
  const upgrade = { idx: CURRENT_VERSION, version: LAST.version, when: UPGRADE_WHEN, tag: UPGRADE_TAG, breakpoints: true };
  const journal = { ...JOURNAL, entries: [...JOURNAL.entries, upgrade] };
  writeFileSync(join(newerBuild, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
});
afterAll(() => {
  rmSync(newerBuild, { recursive: true, force: true });
});

let t: TestDatabase;
afterEach(async () => {
  vi.restoreAllMocks();
  await t.destroy();
});

async function recorded(db: Db) {
  const rows = await db.execute<{ id: number; hash: string; created_at: string }>(
    sql`select id, hash, created_at from drizzle.__drizzle_migrations order by id`,
  );
  return rows.rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/** The db.migrate.* lines written to stdout so far, parsed. */
function migrateLogs(calls: unknown[][]) {
  return calls
    .map(([line]) => String(line))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { event: string })
    .filter((l) => l.event.startsWith("db.migrate."));
}

/** Waits until `n` connections to the test database are waiting for a lock. */
async function lockWaits(n: number) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    // Polled from the pool: inside a transaction, pg_stat_activity would keep showing its first reading.
    const waiting = await t.pool.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'",
      [t.name],
    );
    if (waiting.rows[0]!.n >= n) return;
    if (Date.now() > deadline) throw new Error(`expected ${n} connections waiting for a lock, saw ${waiting.rows[0]!.n}`);
    await delay(20);
  }
}

/** Every identity, ownership, claim, and session record, as the current schema reads them. */
async function records(db: Db) {
  return {
    counts: await counts(db),
    snapshot: await snapshot(db),
    installation: await db.select().from(installation),
    users: await db.select().from(user).orderBy(asc(user.id)),
    accounts: await db.select().from(account).orderBy(asc(account.id)),
    sessions: await db.select().from(session).orderBy(asc(session.id)),
    verifications: await db.select().from(verification).orderBy(asc(verification.id)),
    organizations: await db.select().from(organization).orderBy(asc(organization.id)),
    members: await db.select().from(member).orderBy(asc(member.id)),
    actors: await db.select().from(actor).orderBy(asc(actor.id)),
    events: await db.select().from(event).orderBy(asc(event.id)),
  };
}

async function signedInOwnerCookie(db: Db) {
  const oldBuild = await startServer(db, { publicUrl: PUBLIC_URL });
  try {
    const signIn = await oldBuild.request("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    });
    expect(signIn.status).toBe(200);
    return cookieHeader(signIn);
  } finally {
    await oldBuild.close();
  }
}

it("upgrades a populated 0005 workspace in place without granting agent access", async () => {
  t = await createTestDatabase({ migrate: false });
  const baseline = mkdtempSync(join(tmpdir(), "ys-before-agent-migrations-"));
  const entries = JOURNAL.entries.filter((entry) => entry.idx <= 5);
  expect(entries.at(-1)?.tag).toBe("0005_frame");
  try {
    mkdirSync(join(baseline, "meta"));
    for (const { tag } of entries) cpSync(join(MIGRATIONS_FOLDER, tag + ".sql"), join(baseline, tag + ".sql"));
    writeFileSync(join(baseline, "meta", "_journal.json"), JSON.stringify({ ...JOURNAL, entries }));
    await runMigrations(t.pool, baseline);
  } finally {
    rmSync(baseline, { recursive: true, force: true });
  }
  expect(await recorded(t.db)).toEqual(SHIPPED_ROWS.slice(0, entries.length));

  await createOwnerWithPassword(t.db, OWNER, PUBLIC_URL);
  const cookie = await signedInOwnerCookie(t.db);
  const before = await records(t.db);
  const owner = before.actors.find((row) => row.kind === "human")!;
  // Written as SQL: the schema's app table has columns that later migrations add.
  const { rows: appsBefore } = await t.pool.query(
    `insert into app (name, title, source_url, repo, path, ref, commit, compose, kit, interface, images, adaptations, limits, state, installed_by)
     values ('legacy', 'Legacy app', 'https://example.test/legacy', 'sample/legacy', 'compose.yaml', 'main', $1, 'services: {}', '{"kit":1}',
       '{"service":"web","port":8080}', '{}', '[]', '{}', 'running', $2)
     returning *`,
    ["a".repeat(40), owner.id],
  );
  expect(appsBefore).toHaveLength(1);

  await runMigrations(t.pool);
  expect(await recorded(t.db)).toEqual(SHIPPED_ROWS);
  expect(await records(t.db)).toEqual(before);
  // The app is as it was; an app installed before journey 015 has no record of how its files were read.
  const { rows: appsAfter } = await t.pool.query("select * from app");
  expect(appsAfter.map(({ provenance, kit_link, update_check, ...row }) => row)).toEqual(appsBefore);
  expect(appsAfter.map((row) => [row.provenance, row.kit_link, row.update_check])).toEqual([[null, null, null]]);
  expect(await t.db.select({ name: app.name }).from(app)).toEqual([{ name: "legacy" }]);
  const authority = await t.pool.query(`select
    (select count(*)::int from external_agent) as agents,
    (select count(*)::int from agent_key) as keys,
    (select count(*)::int from agent_binding) as bindings,
    (select count(*)::int from agent_grant) as grants,
    (select count(*)::int from agent_request) as requests`);
  expect(authority.rows).toEqual([{ agents: 0, keys: 0, bindings: 0, grants: 0, requests: 0 }]);

  const upgraded = await startServer(t.db, { publicUrl: PUBLIC_URL });
  try {
    const session = await upgraded.request("/api/auth/get-session", { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ session: { id: before.sessions[0]!.id }, user: { id: owner.userId } });
    const dashboard = await upgraded.request("/api/agents/dashboard", { headers: { cookie } });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.json()).toMatchObject({ agents: [], installations: [], requests: [], events: [] });
    expect((await upgraded.request("/api/agent/apps", { headers: { cookie } })).status).toBe(401);
  } finally {
    await upgraded.close();
  }
});

describe("schema migrations", () => {
  beforeEach(async () => {
    t = await createTestDatabase();
  });
  it("upgrades an installation in place and keeps identities, ownership, claim state, and sessions", async () => {
    // An installation created by the current build, with a signed-in owner.
    await createOwnerWithPassword(t.db, OWNER, PUBLIC_URL);
    const cookie = await signedInOwnerCookie(t.db);

    expect(await schemaVersion(t.pool)).toBe(CURRENT_VERSION);
    expect(await recorded(t.db)).toEqual(SHIPPED_ROWS);
    const before = await records(t.db);
    expect(before.snapshot).toMatchObject({ username: OWNER.username, role: "owner", state: "claimed" });
    expect(before.snapshot!.claimed_workspace_id).toBe(before.snapshot!.workspace_id);
    expect(before.counts).toMatchObject({ users: 1, organizations: 1, members: 1, sessions: 1, actors: 2 });

    // The newer build starts against the same storage.
    const logs = vi.spyOn(console, "log");
    await runMigrations(t.pool, newerBuild);

    expect(await schemaVersion(t.pool)).toBe(NEWER_VERSION);
    expect(await recorded(t.db)).toEqual([...SHIPPED_ROWS, UPGRADE_ROW]);
    // The upgrade is logged before and after, with the old and new schema versions.
    const versions = { fromSchemaVersion: CURRENT_VERSION, toSchemaVersion: NEWER_VERSION };
    expect(migrateLogs(logs.mock.calls)).toMatchObject([
      { level: "info", event: "db.migrate.start", ...versions },
      { level: "info", event: "db.migrate.done", ...versions },
    ]);

    // The migration applied in place: the existing user has the new column, and the new table works.
    const locales = await t.db.execute<{ test_locale: string }>(sql`select test_locale from "user"`);
    expect(locales.rows).toEqual([{ test_locale: "en" }]);
    const table = await t.db.execute<{ table: string | null }>(sql`select to_regclass('public.test_upgrade') as table`);
    expect(table.rows[0]!.table).toBe("test_upgrade");

    // Nothing that existed changed.
    expect(await records(t.db)).toEqual(before);

    const ownerActor = before.actors.find((a) => a.kind === "human")!;
    await t.db.execute(sql`insert into test_upgrade (actor_id) values (${ownerActor.id})`);

    // The owner's existing session still works on the newer build.
    const newBuild = await startServer(t.db, { publicUrl: PUBLIC_URL });
    try {
      const current = await newBuild.request("/api/auth/get-session", { headers: { cookie } });
      expect(current.status).toBe(200);
      const body = (await current.json()) as { session: { id: string }; user: { id: string; username: string } };
      expect(body.session.id).toBe(before.sessions[0]!.id);
      expect(body.user).toMatchObject({ id: before.users[0]!.id, username: OWNER.username });
      expect(await (await newBuild.request("/api/status")).json()).toEqual({ owner: true });
    } finally {
      await newBuild.close();
    }
  });

  it("does nothing when run again at the latest version", async () => {
    await createOwnerWithPassword(t.db);
    await runMigrations(t.pool, newerBuild);
    const before = await records(t.db);

    await runMigrations(t.pool, newerBuild);

    expect(await schemaVersion(t.pool)).toBe(NEWER_VERSION);
    expect((await recorded(t.db)).map((r) => r.hash)).toEqual(ALL_HASHES);
    expect(await records(t.db)).toEqual(before);
  });

  it("refuses a database a newer build migrated, and changes nothing", async () => {
    await createOwnerWithPassword(t.db);
    await runMigrations(t.pool, newerBuild);
    const before = await records(t.db);
    // Errors are logged on stderr.
    const logs = vi.spyOn(console, "error");

    // This build doesn't know the newer migration: drizzle alone would skip it and start.
    await expect(runMigrations(t.pool)).rejects.toMatchObject({
      name: "NewerSchemaError",
      schemaVersion: NEWER_VERSION,
      knownSchemaVersion: CURRENT_VERSION,
    });
    expect(migrateLogs(logs.mock.calls)).toMatchObject([
      { level: "error", event: "db.migrate.newer_schema", schemaVersion: NEWER_VERSION, knownSchemaVersion: CURRENT_VERSION, newerMigrations: 1 },
    ]);
    expect((await recorded(t.db)).map((r) => r.hash)).toEqual(ALL_HASHES);
    expect(await records(t.db)).toEqual(before);
    // The migration lock was released: the newer build still starts.
    await runMigrations(t.pool, newerBuild);
  });

  it("stops the server with its own exit status when a newer build migrated the database", async () => {
    await runMigrations(t.pool, newerBuild);
    const server = spawn(process.execPath, [fileURLToPath(new URL("../src/index.ts", import.meta.url))], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        YS_E2E_EPHEMERAL_GATE: "1",
        PORT: "0",
        DATABASE_URL: t.url,
        BETTER_AUTH_SECRET: TEST_SECRET,
        YS_DATA_KEY: TEST_DATA_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    server.stdout.on("data", (chunk) => (stdout += chunk));
    server.stderr.on("data", (chunk) => (stderr += chunk));
    // `close` comes after the output streams end, so everything the server wrote is here.
    const [code] = (await once(server, "close")) as [number | null];
    expect(code, `${stdout}\n${stderr}`).toBe(2);
    expect(stderr).toContain('"event":"db.migrate.newer_schema"');
    expect(stderr).toContain("The database was updated by a newer version of Your Space, so this version did not start");
    expect(await schemaVersion(t.pool)).toBe(NEWER_VERSION);
  });

  it("applies the migration once when two servers start at the same time", async () => {
    await createOwnerWithPassword(t.db);
    const before = await records(t.db);
    const logs = vi.spyOn(console, "log");
    const first = createDatabase(t.url);
    const second = createDatabase(t.url);
    // Holds the user table, so the upgrade stops inside its migration until both servers have started.
    const blocker = new pg.Client({ connectionString: t.url });
    await blocker.connect();
    let running: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query('lock table "user" in access exclusive mode');
      running = Promise.allSettled([runMigrations(first.pool, newerBuild), runMigrations(second.pool, newerBuild)]);
      // One server waits for the table inside its migration, the other for the migration lock.
      await lockWaits(2);
      // Only one has started, and it logged the versions before migrating.
      expect(migrateLogs(logs.mock.calls)).toMatchObject([
        { event: "db.migrate.start", fromSchemaVersion: CURRENT_VERSION, toSchemaVersion: NEWER_VERSION },
      ]);
      await blocker.query("commit");
      expect((await running).map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    } finally {
      // Closing the blocker releases the table if the test failed before the commit.
      await blocker.end();
      await running;
      await first.pool.end();
      await second.pool.end();
    }

    // The second server waited for the first, then found nothing to apply.
    expect(migrateLogs(logs.mock.calls)).toMatchObject([
      { event: "db.migrate.start", fromSchemaVersion: CURRENT_VERSION, toSchemaVersion: NEWER_VERSION },
      { event: "db.migrate.done", fromSchemaVersion: CURRENT_VERSION, toSchemaVersion: NEWER_VERSION },
      { event: "db.migrate.start", fromSchemaVersion: NEWER_VERSION, toSchemaVersion: NEWER_VERSION },
      { event: "db.migrate.done", fromSchemaVersion: NEWER_VERSION, toSchemaVersion: NEWER_VERSION },
    ]);
    expect(await schemaVersion(t.pool)).toBe(NEWER_VERSION);
    expect((await recorded(t.db)).map((r) => r.hash)).toEqual(ALL_HASHES);
    const columns = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'user' and column_name = 'test_locale'`,
    );
    expect(columns.rows[0]!.n).toBe(1);
    expect(await records(t.db)).toEqual(before);
  });
});
