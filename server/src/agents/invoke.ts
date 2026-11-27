import type pg from "pg";
import { sampleDenial } from "./denials.ts";
import type { Db } from "../db/client.ts";
import { decrypt, encrypt } from "../apps/settings.ts";
import { agentCredentialHeader, isWrite, passAgentResult, renderAgentRequest, routeCredential } from "../apps/agent-kit.ts";
import { dispatchAppAction } from "./transport.ts";
import {
  AgencyError,
  catalog,
  conflict,
  forbidden,
  hash,
  identity,
  invalid,
  object,
  transaction,
  uuid,
} from "./store.ts";

type Who = Awaited<ReturnType<typeof identity>>;
// A role grants a route at its HTTP method and nothing finer (spec 017). An invocation names the route
// and its input; Your Space keeps no operation ID and doesn't match a retry to an earlier write.
interface Invocation {
  installationId: string;
  actionId: string;
  input: Record<string, unknown>;
}
function invocation(raw: unknown): Invocation {
  const data = object(raw);
  if (Object.keys(data).some((k) => !["installationId", "actionId", "input"].includes(k))) invalid();
  if (typeof data.actionId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(data.actionId)) invalid();
  return { installationId: uuid(data.installationId), actionId: data.actionId, input: object(data.input ?? {}) };
}
async function permissions(client: pg.PoolClient, who: Who, id: string) {
  const install = await catalog(client, id);
  const grant = (await client.query("select * from agent_grant where agent_id=$1 and app_id=$2", [who.agent, id]))
    .rows[0];
  const allowed = new Set<string>();
  if (install.current && grant) {
    for (const role of grant.roles) {
      if (install.row.enabled_roles.includes(role) && Object.hasOwn(install.access.roles, role)) {
        for (const action of install.access.roles[role]!.routes) {
          // A route whose credential isn't bound is unavailable; nothing falls back to another one.
          const route = install.access.routes[action];
          if (route && Object.hasOwn(install.bound, routeCredential(install.access, route).name)) allowed.add(action);
        }
      }
    }
  }
  return { ...install, grant, allowed };
}
export async function discover(client: pg.PoolClient, who: Who) {
  const apps = (
    await client.query(
      `select g.app_id from agent_grant g join app a on g.app_id=a.id
    where g.agent_id=$1 and a.desired<>'removed' and a.kit->'agentAccess' is not null`,
      [who.agent],
    )
  ).rows;
  const actions = [];
  for (const item of apps) {
    const { access, allowed, row } = await permissions(client, who, item.app_id);
    for (const actionId of allowed) {
      const route = access.routes[actionId]!;
      actions.push({
        installationId: row.id,
        appName: row.title,
        actionId,
        method: route.method,
        path: route.path,
        effect: route.effect,
        pathParams: route.pathParams,
        queryFields: route.queryFields,
      });
    }
  }
  return { actions };
}
interface Outcome {
  id: string;
  status: string;
  result?: unknown;
}
function summary(row: pg.QueryResultRow, dataKey: string): Outcome {
  return {
    id: row.id,
    status: row.status,
    ...(row.result ? { result: JSON.parse(decrypt(dataKey, row.result)) } : {}),
  };
}
/** A request's outcome, for the agent that made it: a read that waited for approval is answered here. */
export async function requestOutcome(db: Db, verifier: string, id: string, dataKey: string): Promise<Outcome> {
  return transaction(db, async (client) => {
    const who = await identity(client, verifier);
    const row = (await client.query("select * from agent_request where id=$1 and agent_id=$2", [id, who.agent]))
      .rows[0];
    if (!row) forbidden();
    const install = await permissions(client, who, row.app_id);
    if (!install.allowed.has(row.route) || row.binding_revision < install.row.credential_revision) forbidden();
    return summary(row, dataKey);
  });
}
interface Admission {
  outcome: Outcome;
  dispatch?: { args: Parameters<typeof dispatchAppAction>[0]; redact: string[]; write: boolean };
}
async function admit(
  client: pg.PoolClient,
  who: Who,
  v: Invocation,
  dataKey: string,
  pending?: pg.QueryResultRow,
): Promise<Admission> {
  let install;
  try {
    install = await permissions(client, who, v.installationId);
  } catch (error) {
    if (!(error instanceof AgencyError) || error.status !== 403) throw error;
  }
  if (!install || !install.allowed.has(v.actionId)) {
    const id = await sampleDenial(client, who, v.installationId, v.actionId);
    return { outcome: { id, status: "denied" } };
  }
  const { access, row, grant } = install;
  if (row.state !== "running") throw new AgencyError(503, "app_unavailable", "The app is unavailable.");
  const route = access.routes[v.actionId]!;
  const request = renderAgentRequest(route, v.input);
  // A pending decision binds the exact request, its body included, to the authority it was admitted
  // under. A read has no body and keeps the null there, so a read pending across an upgrade still matches.
  const fingerprint = hash(
    JSON.stringify([
      request.method,
      request.path,
      request.headers,
      request.body ?? null,
      who.key,
      row.revision,
      grant.revision,
    ]),
  );
  if (
    pending &&
    (pending.fingerprint !== fingerprint ||
      pending.binding_revision !== row.revision ||
      pending.grant_revision !== grant.revision ||
      pending.key_id !== who.key)
  )
    conflict();
  // The owner's setting, then the kit's; a write nobody set asks first (spec 017 decision 6).
  const ask = (grant.overrides[v.actionId] ?? route.approval ?? (isWrite(route) ? "ask" : "allow")) === "ask";
  const status = ask && !pending ? "pending" : "dispatching";
  let id: string;
  if (pending) {
    await client.query(
      "update agent_request set status='dispatching',input=null,expires_at=now()+interval '1 minute',revision=revision+1 where id=$1",
      [pending.id],
    );
    id = pending.id;
  } else {
    const input = status === "pending" ? encrypt(dataKey, JSON.stringify(v)) : null;
    const result = await client.query(
      `insert into agent_request(agent_id,key_id,app_id,route,fingerprint,status,input,binding_revision,grant_revision,expires_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+case when $6='pending' then interval '15 minutes' else interval '1 minute' end) returning id`,
      [who.agent, who.key, row.id, v.actionId, fingerprint, status, input, row.revision, grant.revision],
    );
    id = result.rows[0].id;
  }
  const outcome = { id, status };
  if (status === "pending") return { outcome };
  // The request carries only its route's credential; a response may echo none of the installation's.
  const { inject, name } = routeCredential(access, route);
  const secrets = Object.fromEntries(Object.entries(install.bound).map(([key, value]) => [key, decrypt(dataKey, value)]));
  const secret = secrets[name]!;
  const args = {
    installation: {
      id: row.id,
      name: row.name,
      project: "ys-" + row.name,
      interfaceService: row.interface.service,
      interfacePort: row.interface.port,
    },
    ...request,
    headers: { ...request.headers, ...agentCredentialHeader(inject, secret) },
  };
  return { outcome, dispatch: { args, redact: Object.values(secrets), write: isWrite(route) } };
}
async function run(db: Db, dataKey: string, admission: Admission): Promise<Outcome> {
  const { outcome, dispatch } = admission;
  if (!dispatch) return outcome;
  let status = "unknown";
  let result: unknown;
  try {
    const response = await dispatchAppAction(dispatch.args);
    // A credential bound or replaced while the app answered is redacted too, along with those bound at
    // admission. Read only for a response to pass on, so a failure here can't hide a refusal.
    const redact = async () => {
      const bound = await db.$client.query("select credential from agent_credential where app_id=$1", [
        dispatch.args.installation.id,
      ]);
      return [...dispatch.redact, ...bound.rows.map((row) => decrypt(dataKey, row.credential))];
    };
    if (response.status >= 200 && response.status < 300 && response.status !== 202) {
      // The app's JSON response, unchanged, unless it echoes the app credential, is too large or isn't
      // JSON. A read that can't be passed on stays unknown; a write was applied, so it succeeded, and the
      // agent gets no result rather than a reason to send it again.
      if (dispatch.write) {
        status = "succeeded";
        if (response.usable) {
          try {
            result = passAgentResult(response.body, await redact());
          } catch {
            // Withheld.
          }
        }
      } else if (response.usable) {
        result = passAgentResult(response.body, await redact());
        status = "succeeded";
      }
    } else if (response.status >= 400 && response.status < 500 && response.status !== 408) status = "refused";
  } catch {
    // The app didn't answer in time, or answered with something unusable.
  }
  const stored = result === undefined ? null : encrypt(dataKey, JSON.stringify(result));
  await db.$client.query(
    "update agent_request set status=$1,result=$2,revision=revision+1 where id=$3 and status='dispatching'",
    [status, stored, outcome.id],
  );
  return { id: outcome.id, status, ...(result === undefined ? {} : { result }) };
}
export async function invoke(db: Db, dataKey: string, verifier: string, raw: unknown) {
  const v = invocation(raw);
  return run(db, dataKey, await transaction(db, async (c) => admit(c, await identity(c, verifier), v, dataKey)));
}
export async function decide(db: Db, dataKey: string, owner: string, id: string, raw: unknown) {
  const { approve, revision } = object(raw);
  if (typeof approve !== "boolean" || !Number.isInteger(revision)) invalid();
  const admission = await transaction(db, async (c) => {
    const row = (
      await c.query(
        `select r.*,k.verifier from agent_request r join external_agent a on a.id=r.agent_id join agent_key k on k.id=r.key_id
      where r.id=$1 and a.owner_id=$2`,
        [id, owner],
      )
    ).rows[0];
    if (!row) forbidden();
    if (row.status !== "pending" || row.revision !== revision || row.expires_at <= new Date()) conflict();
    if (!approve) {
      await c.query("update agent_request set status='rejected',input=null,revision=revision+1 where id=$1", [id]);
      return { outcome: { id, status: "rejected" } };
    }
    const who = await identity(c, row.verifier);
    return admit(c, who, invocation(JSON.parse(decrypt(dataKey, row.input))), dataKey, row);
  });
  return run(db, dataKey, admission);
}
