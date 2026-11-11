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

export async function snapshot(db: Db) {
  const rows = await db.execute<Record<string, unknown>>(sql`select
      u.id as user_id, u.username, u.email, u.name, u.email_verified,
      o.id as workspace_id, o.name as workspace_name,
      m.id as member_id, m.role,
      i.state, i.workspace_id as claimed_workspace_id,
      a.id as actor_id
    from installation i
    left join organization o on o.id = i.workspace_id
    left join member m on m.organization_id = o.id and m.role = 'owner'
    left join "user" u on u.id = m.user_id
    left join actor a on a.user_id = u.id
    where i.id = 1`);
  return rows.rows[0];
}
