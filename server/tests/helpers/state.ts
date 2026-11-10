// Reads the identity and ownership records the stories compare.
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/client.ts";

export async function counts(db: Db) {
  const rows = await db.execute<{
    users: number;
    organizations: number;
    members: number;
    sessions: number;
    actors: number;
    events: number;
  }>(sql`select
      (select count(*)::int from "user") as users,
      (select count(*)::int from organization) as organizations,
      (select count(*)::int from member) as members,
      (select count(*)::int from session) as sessions,
      (select count(*)::int from actor) as actors,
      (select count(*)::int from event) as events`);
  return rows.rows[0]!;
}
