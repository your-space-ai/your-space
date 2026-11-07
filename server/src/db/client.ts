// The PostgreSQL pool and Drizzle instance (T008).
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as authSchema from "./auth-schema.ts";
import * as appSchema from "./schema.ts";
import { errorFields, log } from "../log.ts";

export const schema = { ...authSchema, ...appSchema };
export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  pool: pg.Pool;
  db: Db;
}

export function createDatabase(databaseUrl: string): Database {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    // Fail fast while the database is down, so requests get a 503 instead of hanging.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client losing its connection emits `error` on the pool. Without a handler the
  // process would crash; with it, later queries fail and are reported as storage_unavailable.
  pool.on("error", (error) => {
    log("warn", "db.connection_lost", errorFields(error));
  });
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
]);

/** Whether an error (or anything in its cause chain) means storage is unavailable. */
export function isStorageError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof e !== "object") break;
    const { code, message, name } = e as { code?: unknown; message?: unknown; name?: unknown };
    if (name === "StorageUnavailable") return true;
    if (typeof code === "string" && (STORAGE_ERROR_CODES.has(code) || code.startsWith("08"))) return true;
    if (
      typeof message === "string" &&
      /Connection terminated|timeout exceeded when trying to connect|does not allow connections|Client has encountered a connection error/i.test(
        message,
      )
    ) {
      return true;
    }
  }
  return false;
}
