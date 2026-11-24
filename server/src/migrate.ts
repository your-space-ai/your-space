// Applies pending migrations at startup under a PostgreSQL advisory lock (T013, research R11).
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { log } from "./log.ts";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

// Any fixed number works; it only has to be the same in every server process.
const MIGRATION_LOCK_KEY = 7_959_001;

/**
 * The database records migrations newer than any this build has: a newer version of Your Space
 * migrated it. Drizzle would skip every migration here and start on a schema it doesn't know, so
 * the server refuses to start instead (decision 2026-11-23, Your Space updates).
 */
export class NewerSchemaError extends Error {
  override name = "NewerSchemaError";
  readonly schemaVersion: number;
  readonly knownSchemaVersion: number;

  constructor(schemaVersion: number, knownSchemaVersion: number) {
    super(`The database's schema version ${schemaVersion} is newer than this build's ${knownSchemaVersion}.`);
    this.schemaVersion = schemaVersion;
    this.knownSchemaVersion = knownSchemaVersion;
  }
}

/** The schema version: how many migrations are recorded in drizzle.__drizzle_migrations. */
export async function schemaVersion(client: pg.ClientBase | pg.Pool): Promise<number> {
  const exists = await client.query<{ table: string | null }>(
    "select to_regclass($1) as table",
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );
  if (!exists.rows[0]?.table) return 0;
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return result.rows[0]?.n ?? 0;
}

/** How many recorded migrations are later than this build's newest, by the time drizzle orders them by. */
async function newerMigrations(client: pg.ClientBase, newest: number): Promise<number> {
  if ((await schemaVersion(client)) === 0) return 0;
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" where created_at > $1`,
    [newest],
  );
  return result.rows[0]?.n ?? 0;
}

export async function runMigrations(pool: pg.Pool, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void> {
  const client = await pool.connect();
  let failed: unknown;
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const from = await schemaVersion(client);
      const migrations = readMigrationFiles({ migrationsFolder });
      const target = migrations.length;
      const newer = await newerMigrations(client, Math.max(0, ...migrations.map((m) => m.folderMillis)));
      if (newer > 0) {
        log("error", "db.migrate.newer_schema", { schemaVersion: from, knownSchemaVersion: target, newerMigrations: newer });
        throw new NewerSchemaError(from, target);
      }
      log("info", "db.migrate.start", { fromSchemaVersion: from, toSchemaVersion: target });
      await migrate(drizzle({ client }), {
        migrationsFolder,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
      const to = await schemaVersion(client);
      log("info", "db.migrate.done", { fromSchemaVersion: from, toSchemaVersion: to });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } catch (error) {
    failed = error;
    throw error;
  } finally {
    // A client that failed mid-migration is discarded rather than returned to the pool.
    client.release(failed instanceof Error ? failed : undefined);
  }
}
