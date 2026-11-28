import { randomBytes } from "node:crypto";
import type pg from "pg";
import { encrypt } from "../apps/settings.ts";
import { AgentKitError, OLD_FORMAT, credentialNames, parseAskRules } from "../apps/agent-kit.ts";
import { catalog, conflict, forbidden, hash, invalid, object, owned } from "./store.ts";

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
/**
 * Binds an installation's app credentials. A kit with one `credential` takes `credential`; a kit with
 * named `credentials` takes `credentials`, a value or null for each name it changes. Grants name the
 * credential they use and stay when it is replaced (spec 018); pending approvals go stale.
 */
export async function bind(client: pg.PoolClient, id: string, body: Record<string, unknown>, dataKey: string) {
  const { row, access, problem } = await catalog(client, id);
  if (!access) invalid(problem === "old_format" ? OLD_FORMAT : "This app gives agents no access.");
  if (body.revision !== (row.revision ?? 0)) conflict();
  const names = credentialNames(access);
  let supplied: Record<string, unknown> = {};
  if (access.credentials) {
    if (Object.hasOwn(body, "credential")) invalid("This kit names its credentials: supply credentials.");
    if (body.credentials !== undefined) supplied = object(body.credentials);
    if (Object.keys(supplied).some((name) => !names.includes(name))) invalid("Supply only the credentials this kit names.");
  } else {
    if (Object.hasOwn(body, "credentials")) invalid("This kit has one credential: supply credential.");
    if (Object.hasOwn(body, "credential")) supplied = { [names[0]!]: body.credential };
  }
  for (const value of Object.values(supplied))
    if (value !== null && (typeof value !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(value)))
      invalid("Enter a valid app credential.");
  const changed = Object.keys(supplied);
  const revision = (row.revision ?? 0) + 1;
  const credentialRevision = changed.length ? revision : (row.credential_revision ?? revision);
  await client.query(
    `insert into agent_binding(app_id,credential,enabled_roles,kit_digest,revision,credential_revision) values ($1,null,'{}','',$2,$3)
    on conflict(app_id) do update set revision=excluded.revision,credential_revision=excluded.credential_revision`,
    [id, revision, credentialRevision],
  );
  for (const [name, value] of Object.entries(supplied)) {
    if (value === null) await client.query("delete from agent_credential where app_id=$1 and name=$2", [id, name]);
    else
      await client.query(
        `insert into agent_credential(app_id,name,credential) values ($1,$2,$3)
        on conflict(app_id,name) do update set credential=excluded.credential`,
        [id, name, encrypt(dataKey, value as string)],
      );
  }
  await client.query(
    "update agent_request set status='stale',input=null,revision=revision+1 where app_id=$1 and status='pending'",
    [id],
  );
  return { revision };
}
/**
 * Gives an agent an app, or takes it away (spec 018): the bound credential it uses, and its routes that
 * ask first. A null credential removes the grant.
 */
export async function grant(
  client: pg.PoolClient,
  owner: string,
  id: string,
  appId: string,
  body: Record<string, unknown>,
) {
  await owned(client, id, owner);
  const { row, access, problem, bound } = await catalog(client, appId);
  if (body.bindingRevision !== (row.revision ?? 0)) conflict();
  const prior = (await client.query("select revision from agent_grant where agent_id=$1 and app_id=$2", [id, appId]))
    .rows[0];
  if (body.revision !== (prior?.revision ?? 0)) conflict();
  if (body.credential === null) {
    await client.query("delete from agent_grant where agent_id=$1 and app_id=$2", [id, appId]);
    await client.query(
      "update agent_request set status='revoked',input=null,revision=revision+1 where agent_id=$1 and app_id=$2 and status='pending'",
      [id, appId],
    );
    return { revision: 0 };
  }
  // Removing access works on any app; giving it needs a kit that names its API.
  if (!access) invalid(problem === "old_format" ? OLD_FORMAT : "This app gives agents no access.");
  if (typeof body.credential !== "string" || !credentialNames(access).includes(body.credential) || !Object.hasOwn(bound, body.credential))
    invalid("Pick a bound app key for this agent.");
  let asks;
  try {
    asks = parseAskRules(body.asks ?? []);
  } catch (error) {
    if (error instanceof AgentKitError) invalid(error.message);
    throw error;
  }
  const revision = (prior?.revision ?? 0) + 1;
  // Roles, Ask for all writes and route overrides are 017's and stay unread (spec 018).
  await client.query(
    `insert into agent_grant(app_id,agent_id,roles,ask_all_writes,overrides,credential,asks,revision) values($1,$2,'{}',false,'{}',$3,$4,$5)
    on conflict(app_id,agent_id) do update set credential=excluded.credential,asks=excluded.asks,revision=excluded.revision`,
    [appId, id, body.credential, JSON.stringify(asks), revision],
  );
  // Pending reviews are exact. A new policy cannot auto-release an earlier request.
  await client.query(
    "update agent_request set status='stale',input=null,revision=revision+1 where agent_id=$1 and app_id=$2 and status='pending'",
    [id, appId],
  );
  return { revision };
}
