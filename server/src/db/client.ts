// The PostgreSQL pool and Drizzle instance (T008).
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as authSchema from "./auth-schema.ts";
import * as appSchema from "./schema.ts";
import { errorFields, log } from "../log.ts";

export const schema = { ...authSchema, ...appSchema };
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export interface Database {
  pool: pg.Pool;
  db: Db;
}

export function createDatabase(databaseUrl: string): Database {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    // Fail fast while the database is down or stops answering, so requests get a 503 instead of
    // hanging.
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    keepAlive: true,
    idleTimeoutMillis: 30_000,
  });
  // A connection that is lost emits `error`: on the pool while idle, and on the client itself while
  // checked out (for example between a transaction's queries). Without a listener either would crash
  // the process; with one, the affected queries fail and are reported as storage_unavailable.
  const onLost = (error: Error) => log("warn", "db.connection_lost", errorFields(error));
  pool.on("error", onLost);
  pool.on("connect", (client) => client.on("error", onLost));
  const db = drizzle({ client: pool, schema });
  return { pool, db };
}

// Error codes that mean the database could not be reached or read, as opposed to a bug.
const STORAGE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "3D000", // invalid_catalog_name: the database is gone
  "42P01", // undefined_table: the schema is missing
  "25006", // read_only_sql_transaction: the database accepts reads but not writes
]);

/** Whether an error (or anything in its cause chain) means storage is unavailable. */
export function isStorageError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof e !== "object") break;
    const { code, message, name } = e as { code?: unknown; message?: unknown; name?: unknown };
    if (name === "StorageUnavailable") return true;
    // Class 08: connection exceptions. Class 53: insufficient resources, such as a full disk.
    if (typeof code === "string" && (STORAGE_ERROR_CODES.has(code) || code.startsWith("08") || code.startsWith("53"))) {
      return true;
    }
    if (
      typeof message === "string" &&
      /Connection terminated|timeout exceeded when trying to connect|is not currently accepting connections|Client has encountered a connection error|Query read timeout/i.test(
        message,
      )
    ) {
      return true;
    }
  }
  return false;
}
