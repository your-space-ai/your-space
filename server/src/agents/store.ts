// Short transactions serialize policy changes with admission. Upstream I/O is always outside them.
import { createHash } from "node:crypto";
import type pg from "pg";
import type { Db } from "../db/client.ts";
import type { AgentAccess } from "../apps/agent-kit.ts";
import { decrypt } from "../apps/settings.ts";

export class AgencyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function invalid(message = "The request is invalid."): never {
  throw new AgencyError(400, "invalid_request", message);
}
export function forbidden(): never {
  throw new AgencyError(403, "not_allowed", "Access is not permitted.");
}
export function conflict(): never {
  throw new AgencyError(409, "conflict", "The record changed. Refresh and try again.");
}
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  return input as Record<string, unknown>;
}
export function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    invalid();
  return value;
}
export function roles(input: unknown, eligible: string[]) {
  if (
    !Array.isArray(input) ||
    input.length > eligible.length ||
    !input.every((v) => typeof v === "string" && eligible.includes(v)) ||
    new Set(input).size !== input.length
  )
    invalid("Select only available roles.");
  return input as string[];
}
export async function expireRequests(executor: pg.Pool | pg.PoolClient) {
  await executor.query(
    "update agent_request set status='expired', input=null, revision=revision+1 where status='pending' and expires_at <= now()",
  );
  // Keep the outcome for the activity history. The separately encrypted result
  // stays readable by the agent that asked for a day.
  await executor.query("update agent_request set result=null where result is not null and created_at < now() - interval '1 day'");
  // The edge transport times out after 15 seconds. A stale claim can follow a crashed server.
  await executor.query(
    "update agent_request set status='unknown',revision=revision+1 where status='dispatching' and expires_at <= now()",
  );
}
export async function transaction<T>(db: Db, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.$client.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(507006)");
    await expireRequests(client);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
export async function catalog(client: pg.PoolClient, id: string) {
  const row = (
    await client.query(
      `select a.id,a.name,a.title,a.kit,a.kit_source,a.commit,a.interface,a.state,a.desired,b.credential,b.enabled_roles,b.revision,b.kit_digest,b.credential_revision
    from app a left join agent_binding b on b.app_id=a.id where a.id=$1 and a.desired<>'removed' for share of a`,
      [id],
    )
  ).rows[0];
  const declared = row?.kit?.agentAccess as AgentAccess | undefined;
  if (!row || !declared || !row.interface) forbidden();
  const access = withoutCutWrites(declared);
  const digest = hash(JSON.stringify([row.kit, row.kit_source, row.commit]));
  return { row, access, digest, current: row.kit_digest === digest };
}
/**
 * A kit stored before writes were cut (2026-11-23, Alpha scope) may still declare write routes with
 * `effect: write`. They stay left out, so a server upgrade never adds a write to a role the owner
 * granted for reads; a write route of spec 017 declares no effect. A kit stored before 2026-11-24 may
 * still give its routes outputFields; nothing reads them, and the app's response reaches the agent
 * unchanged.
 */
function withoutCutWrites(access: AgentAccess): AgentAccess {
  const routes = Object.fromEntries(
    Object.entries(access.routes).filter(([, route]) =>
      route.method === "GET" ? route.effect === "read" : (route as { effect?: string }).effect === undefined,
    ),
  );
  const roles = Object.fromEntries(
    Object.entries(access.roles).map(([id, role]) => [id, { ...role, routes: role.routes.filter((r) => Object.hasOwn(routes, r)) }]),
  );
  return { ...access, routes, roles };
}
export async function owned(client: pg.PoolClient, id: string, owner: string, active = true) {
  const row = (await client.query("select * from external_agent where id=$1 and owner_id=$2", [id, owner])).rows[0];
  if (!row || (active && row.disabled)) forbidden();
  return row;
}
export async function identity(client: pg.PoolClient, verifier: string) {
  const row = (
    await client.query(
      `select a.id as agent,a.owner_id as owner,k.id as key from agent_key k
    join external_agent a on a.id=k.agent_id join installation i on i.workspace_id=a.workspace_id
    where not k.revoked and not a.disabled and k.verifier=$1`,
      [verifier],
    )
  ).rows[0];
  if (!row) throw new AgencyError(401, "invalid_credential", "A current agent key is required.");
  return { agent: String(row.agent), key: String(row.key), owner: String(row.owner) };
}
export async function activity(client: pg.PoolClient, owner: string, before?: string) {
  const rows = (
    await client.query(
      `select r.id,r.agent_id as "agentId",a.owner_id as "ownerId",r.app_id as "installationId",r.route as "actionId",r.status,r.created_at as "createdAt"
    from agent_request r join external_agent a on a.id=r.agent_id where a.owner_id=$1
    and ($2::uuid is null or (r.created_at,r.id)<(select created_at,id from agent_request where id=$2)) order by r.created_at desc,r.id desc limit 51`,
      [owner, before ?? null],
    )
  ).rows;
  const events = rows.slice(0, 50);
  return { events, nextCursor: rows.length > 50 ? events.at(-1)?.id : null };
}
export async function dashboard(client: pg.PoolClient, owner: string, dataKey: string) {
  const agents = (
    await client.query(
      `select a.id,a.name,a.disabled,
    coalesce((select json_agg(json_build_object('id',k.id,'revoked',k.revoked)) from agent_key k where k.agent_id=a.id),'[]') as keys,
    coalesce((select json_agg(json_build_object('installationId',g.app_id,'roles',g.roles,'revision',g.revision,'overrides',g.overrides)) from agent_grant g where g.agent_id=a.id),'[]') as grants
    from external_agent a where owner_id=$1 order by name,id`,
      [owner],
    )
  ).rows;
  const apps = (
    await client.query(
      "select id from app where desired<>'removed' and kit->'agentAccess' is not null and interface is not null order by name",
    )
  ).rows;
  const installations = [];
  for (const { id } of apps) {
    const { row, access, current } = await catalog(client, id);
    installations.push({
      id,
      name: row.name,
      title: row.title,
      source: row.kit_source,
      roles: access.roles,
      routes: access.routes,
      bound: current && !!row.credential,
      enabledRoles: current ? row.enabled_roles : [],
      revision: row.revision ?? 0,
    });
  }
  const requests = (
    await client.query(
      `select r.id,agent_id as "agentId",app_id as "installationId",route as "actionId",status,input,r.revision,key_id as "credentialId",expires_at as "expiresAt"
    from agent_request r join external_agent a on a.id=r.agent_id where a.owner_id=$1 and status='pending' order by r.created_at limit 100`,
      [owner],
    )
  ).rows.map((row) => {
    const payload = JSON.parse(decrypt(dataKey, row.input));
    return { ...row, input: payload.input };
  });
  return { agents, installations, requests, ...(await activity(client, owner)) };
}
