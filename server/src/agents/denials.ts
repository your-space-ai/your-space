import type pg from "pg";

/**
 * A denied attempt has no app receipt. Keep at most 32 examples per agent for
 * the owner's activity view, sampling at most once per minute across all keys,
 * installations and actions. The enclosing admission transaction serializes
 * this check with concurrent attempts, including requests for unknown apps.
 */
export async function sampleDenial(
  client: pg.PoolClient,
  who: { agent: string; key: string },
  installationId: string,
  actionId: string,
): Promise<string> {
  const latest = await client.query<{ id: string }>(
    `select id from agent_request
     where agent_id=$1 and status='denied' and created_at > now() - interval '1 minute'
     order by created_at desc,id desc limit 1`,
    [who.agent],
  );
  if (latest.rows[0]) return latest.rows[0].id;

  await client.query(
    `delete from agent_request where id in (
       select id from agent_request where agent_id=$1 and status='denied'
       order by created_at desc,id desc offset 31
     )`,
    [who.agent],
  );
  const inserted = await client.query<{ id: string }>(
    `insert into agent_request(agent_id,key_id,app_id,route,status,binding_revision,grant_revision,expires_at)
     values ($1,$2,$3,$4,'denied',0,0,now()) returning id`,
    [who.agent, who.key, installationId, actionId],
  );
  return inserted.rows[0]!.id;
}
