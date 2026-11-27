import { randomBytes } from "node:crypto";
import type pg from "pg";
import { encrypt } from "../apps/settings.ts";
import { catalog, conflict, forbidden, hash, invalid, object, owned, roles } from "./store.ts";

function name(input: unknown) {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 80)
    invalid("Enter a name of up to 80 characters.");
  return input.trim();
}
export async function createAgent(client: pg.PoolClient, owner: string, input: unknown) {
  const label = name(input);
  const result = await client.query(
    `with new_actor as (insert into actor(kind) values ('agent') returning id)
    insert into external_agent(id,owner_id,workspace_id,name)
    select new_actor.id,$1,i.workspace_id,$2 from new_actor cross join installation i where i.state='claimed' returning id,name,disabled`,
    [owner, label],
  );
  if (!result.rowCount) forbidden();
  return result.rows[0];
}
export async function editAgent(client: pg.PoolClient, owner: string, id: string, body: Record<string, unknown>) {
  await owned(client, id, owner);
  if (body.disabled === true) {
    await client.query("update external_agent set disabled=true where id=$1", [id]);
    await client.query("update agent_key set revoked=true where agent_id=$1", [id]);
    await client.query(
      "update agent_request set status='revoked', input=null, revision=revision+1 where agent_id=$1 and status='pending'",
      [id],
    );
  } else await client.query("update external_agent set name=$2 where id=$1", [id, name(body.name)]);
  return { id };
}
export async function manageKey(client: pg.PoolClient, owner: string, id: string, oldId?: string, revokeOnly = false) {
  await owned(client, id, owner);
  if (oldId) {
    const changed = await client.query(
      "update agent_key set revoked=true where agent_id=$1 and id=$2 and not revoked",
      [id, oldId],
    );
    if (!changed.rowCount) conflict();
    await client.query(
      "update agent_request set status='revoked', input=null, revision=revision+1 where key_id=$1 and status='pending'",
      [oldId],
    );
    if (revokeOnly) return { id: oldId };
  }
  const key = "ysa_" + randomBytes(32).toString("base64url");
  const result = await client.query("insert into agent_key(agent_id,verifier) values($1,$2) returning id", [
    id,
    hash(key),
  ]);
  return { id: result.rows[0].id, key };
}
export async function bind(client: pg.PoolClient, id: string, body: Record<string, unknown>, dataKey: string) {
  const { row, access, digest, current } = await catalog(client, id);
  if (body.revision !== (row.revision ?? 0)) conflict();
  const enabled = roles(body.enabledRoles, Object.keys(access.roles));
  const supplied = Object.hasOwn(body, "credential");
  if (
    supplied &&
    body.credential !== null &&
    (typeof body.credential !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(body.credential))
  )
    invalid("Enter a valid app credential.");
  const credential = supplied
    ? body.credential === null
      ? null
      : encrypt(dataKey, body.credential as string)
    : current
      ? row.credential
      : null;
  if (enabled.length && !credential) invalid("Supply an app credential before enabling roles.");
  const revision = (row.revision ?? 0) + 1;
  const credentialRevision = current && !supplied ? row.credential_revision : revision;
  await client.query(
    `insert into agent_binding(app_id,credential,enabled_roles,kit_digest,revision,credential_revision) values ($1,$2,$3,$4,$5,$6)
    on conflict(app_id) do update set credential=excluded.credential,enabled_roles=excluded.enabled_roles,kit_digest=excluded.kit_digest,revision=excluded.revision,credential_revision=excluded.credential_revision`,
    [id, credential, enabled, digest, revision, credentialRevision],
  );
  // A replacement credential or kit could represent broader upstream authority. Regrant explicitly.
  if (!current || supplied) await client.query("delete from agent_grant where app_id=$1", [id]);
  else
    await client.query(
      `update agent_grant set roles=array(select x from unnest(roles) as x where x=any($2)), revision=revision+1
    where app_id=$1 and not roles <@ $2::text[]`,
      [id, enabled],
    );
  await client.query(
    "update agent_request set status='stale',input=null,revision=revision+1 where app_id=$1 and status='pending'",
    [id],
  );
  return { revision };
}
export async function grant(
  client: pg.PoolClient,
  owner: string,
  id: string,
  appId: string,
  body: Record<string, unknown>,
) {
  await owned(client, id, owner);
  const { row, access, current } = await catalog(client, appId);
  if (!current || !row.credential) forbidden();
  if (body.bindingRevision !== row.revision) conflict();
  const selected = roles(body.roles, row.enabled_roles);
  const prior = (await client.query("select revision from agent_grant where agent_id=$1 and app_id=$2", [id, appId]))
    .rows[0];
  if (body.revision !== (prior?.revision ?? 0)) conflict();
  const overrides = object(body.overrides);
  if (Object.entries(overrides).some(([k, v]) => !Object.hasOwn(access.routes, k) || (v !== "ask" && v !== "allow")))
    invalid();
  const revision = (prior?.revision ?? 0) + 1;
  // Ask for all writes is gone (spec 017): nothing reads ask_all_writes, and new grants store false.
  await client.query(
    `insert into agent_grant(app_id,agent_id,roles,ask_all_writes,overrides,revision) values($1,$2,$3,false,$4,$5)
    on conflict(app_id,agent_id) do update set roles=excluded.roles,ask_all_writes=false,overrides=excluded.overrides,revision=excluded.revision`,
    [appId, id, selected, overrides, revision],
  );
  // Pending reviews are exact. A new policy cannot auto-release an earlier request.
  await client.query(
    "update agent_request set status='stale',input=null,revision=revision+1 where agent_id=$1 and app_id=$2 and status='pending'",
    [id, appId],
  );
  return { revision };
}
