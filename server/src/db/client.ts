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
