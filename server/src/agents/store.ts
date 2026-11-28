// Short transactions serialize policy changes with admission. Upstream I/O is always outside them.
import { createHash } from "node:crypto";
import type pg from "pg";
import type { Db } from "../db/client.ts";
import { credentialNames, storedAgentAccess, type AgentAccess } from "../apps/agent-kit.ts";
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
/**
 * An installation's agent access: its kit's, read as stored, and its bound credentials, encrypted, by
 * name. Bound credentials and grants outlive a kit change (spec 018 decision 5), so nothing here
 * depends on the kit they were bound under. A kit stored before spec 018 gives no access (decision 11).
 */
export async function catalog(client: pg.PoolClient, id: string) {
  const row = (
    await client.query(
      `select a.id,a.name,a.title,a.kit,a.kit_source,a.commit,a.interface,a.state,a.desired,b.revision,b.credential_revision,
    (select json_object_agg(c.name,c.credential) from agent_credential c where c.app_id=a.id) as credentials
    from app a left join agent_binding b on b.app_id=a.id where a.id=$1 and a.desired<>'removed' for share of a`,
      [id],
    )
  ).rows[0];
  const stored = storedAgentAccess(row?.kit);
  if (!row || !stored || !row.interface) forbidden();
  const access: AgentAccess | undefined = "access" in stored ? stored.access : undefined;
  const bound: Record<string, string> = row.credentials ?? {};
  return { row, access, problem: "problem" in stored ? stored.problem : undefined, bound };
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
    coalesce((select json_agg(json_build_object('installationId',g.app_id,'credential',g.credential,'asks',g.asks,'revision',g.revision)) from agent_grant g where g.agent_id=a.id),'[]') as grants
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
    const { row, access, problem, bound } = await catalog(client, id);
    installations.push({
      id,
      name: row.name,
      title: row.title,
      source: row.kit_source,
      // Why agents can't reach the app, when they can't: its stored kit is in the format before 018.
      problem: problem ?? null,
      api: access?.api ?? null,
      named: !!access?.credentials,
      credentials: access
        ? credentialNames(access).map((name) => ({ name, bound: Object.hasOwn(bound, name) }))
        : Object.keys(bound).sort().map((name) => ({ name, bound: true })),
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
    const { method, path, body } = JSON.parse(decrypt(dataKey, row.input));
    return { ...row, input: { method, path, ...(body === undefined ? {} : { body }) } };
  });
  return { agents, installations, requests, ...(await activity(client, owner)) };
}
