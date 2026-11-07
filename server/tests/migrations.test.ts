// T041: a newer build's migration upgrades an installation in place (FR-024, cross-cutting scenario 8).
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, sql } from "drizzle-orm";
import { account, member, organization, session, user, verification } from "../src/db/auth-schema.ts";
import { createDatabase, type Db } from "../src/db/client.ts";
import { actor, event, installation } from "../src/db/schema.ts";
import { MIGRATIONS_FOLDER, runMigrations, schemaVersion } from "../src/migrate.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { PUBLIC_URL } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer } from "./helpers/server.ts";
import { counts, snapshot } from "./helpers/state.ts";

// A later build's migration: a new column with a default on an identity table, and a new table.
const UPGRADE_TAG = "0001_test_upgrade";
const UPGRADE_SQL = `ALTER TABLE "user" ADD COLUMN "test_locale" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
CREATE TABLE "test_upgrade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL REFERENCES "actor"("id") ON DELETE restrict
);
`;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const INITIAL_HASH = sha256(readFileSync(join(MIGRATIONS_FOLDER, "0000_initial.sql"), "utf8"));
const UPGRADE_HASH = sha256(UPGRADE_SQL);

// The newer build's migrations folder: the shipped migrations plus the test migration.
let newerBuild: string;
let upgradeWhen: number;
beforeAll(() => {
  newerBuild = mkdtempSync(join(tmpdir(), "ys-migrations-"));
  cpSync(MIGRATIONS_FOLDER, newerBuild, { recursive: true });
  writeFileSync(join(newerBuild, `${UPGRADE_TAG}.sql`), UPGRADE_SQL);
  const journalPath = join(newerBuild, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  expect(journal.entries).toHaveLength(1);
  upgradeWhen = journal.entries[0].when + 60_000;
  journal.entries.push({ idx: 1, version: "7", when: upgradeWhen, tag: UPGRADE_TAG, breakpoints: true });
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
});
afterAll(() => {
  rmSync(newerBuild, { recursive: true, force: true });
});

let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
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

describe("schema migrations", () => {
  it("upgrades an installation in place and keeps identities, ownership, claim state, and sessions", async () => {
    // An installation created by the first build, with a signed-in owner.
    await createOwnerWithPassword(t.db, OWNER, PUBLIC_URL);
    const oldBuild = await startServer(t.db, { publicUrl: PUBLIC_URL });
    const signIn = await oldBuild.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
    });
    expect(signIn.status).toBe(200);
    const cookie = cookieHeader(signIn);
    await oldBuild.close();

    expect(await schemaVersion(t.pool)).toBe(1);
    expect(await recorded(t.db)).toEqual([{ hash: INITIAL_HASH, createdAt: upgradeWhen - 60_000 }]);
    const before = await records(t.db);
    expect(before.snapshot).toMatchObject({ email: OWNER.email, role: "owner", state: "claimed" });
    expect(before.snapshot!.claimed_workspace_id).toBe(before.snapshot!.workspace_id);
    expect(before.counts).toMatchObject({ users: 1, organizations: 1, members: 1, sessions: 1, actors: 2 });

    // The newer build starts against the same storage.
    const logs = vi.spyOn(console, "log");
    await runMigrations(t.pool, newerBuild);

    expect(await schemaVersion(t.pool)).toBe(2);
    expect(await recorded(t.db)).toEqual([
      { hash: INITIAL_HASH, createdAt: upgradeWhen - 60_000 },
      { hash: UPGRADE_HASH, createdAt: upgradeWhen },
    ]);
    // The upgrade is logged with the old and new schema versions.
    const done = logs.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .find((l) => l.event === "db.migrate.done");
    expect(done).toMatchObject({ level: "info", fromSchemaVersion: 1, toSchemaVersion: 2 });

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
      const body = (await current.json()) as { session: { id: string }; user: { id: string; email: string } };
      expect(body.session.id).toBe(before.sessions[0]!.id);
      expect(body.user).toMatchObject({ id: before.users[0]!.id, email: OWNER.email });
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
    await runMigrations(t.pool);

    expect(await schemaVersion(t.pool)).toBe(2);
    expect((await recorded(t.db)).map((r) => r.hash)).toEqual([INITIAL_HASH, UPGRADE_HASH]);
    expect(await records(t.db)).toEqual(before);
  });

  it("applies the migration once when two servers start at the same time", async () => {
    await createOwnerWithPassword(t.db);
    const before = await records(t.db);
    const first = createDatabase(t.url);
    const second = createDatabase(t.url);
    try {
      const results = await Promise.allSettled([
        runMigrations(first.pool, newerBuild),
        runMigrations(second.pool, newerBuild),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    } finally {
      await first.pool.end();
      await second.pool.end();
    }

    expect(await schemaVersion(t.pool)).toBe(2);
    expect((await recorded(t.db)).map((r) => r.hash)).toEqual([INITIAL_HASH, UPGRADE_HASH]);
    const columns = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'user' and column_name = 'test_locale'`,
    );
    expect(columns.rows[0]!.n).toBe(1);
    expect(await records(t.db)).toEqual(before);
  });
});
