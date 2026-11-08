// A fresh, migrated database per test file (T016), with helpers to take storage away and back.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDatabase, type Database } from "../../src/db/client.ts";
import { runMigrations } from "../../src/migrate.ts";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://yourspace:yourspace@127.0.0.1:5432/yourspace";

export interface TestDatabase extends Database {
  name: string;
  url: string;
  /** Makes the database refuse connections and drops the open ones, like a stopped database. */
  stop(): Promise<void>;
  /** Accepts connections again. */
  restore(): Promise<void>;
  /** Closes the pool and drops the database. */
  destroy(): Promise<void>;
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function databaseUrl(name: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Creates an empty database. `migrate: false` leaves it without any schema. */
export async function createTestDatabase(options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  const name = `ys_test_${randomBytes(6).toString("hex")}`;
  await admin((c) => c.query(`create database "${name}"`));
  const url = databaseUrl(name);
  const database = createDatabase(url);
  if (options.migrate ?? true) await runMigrations(database.pool);

  const disconnect = (c: pg.Client) =>
    c.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [
      name,
    ]);

  return {
    ...database,
    name,
    url,
    async stop() {
      await admin(async (c) => {
        await c.query(`alter database "${name}" allow_connections false`);
        await disconnect(c);
      });
    },
    async restore() {
      await admin((c) => c.query(`alter database "${name}" allow_connections true`));
    },
    async destroy() {
      await database.pool.end().catch(() => {});
      await admin(async (c) => {
        await c.query(`alter database "${name}" allow_connections false`);
        await disconnect(c);
        await c.query(`drop database if exists "${name}"`);
      });
    },
  };
}
