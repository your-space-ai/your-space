import type pg from "pg";
import { sampleDenial } from "./denials.ts";
import type { Db } from "../db/client.ts";
import { decrypt, encrypt } from "../apps/settings.ts";
import { agentCredentialHeader, filterAgentResult, renderAgentRequest, type AgentRoute } from "../apps/agent-kit.ts";
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
interface Invocation {
  installationId: string;
  actionId: string;
  input: Record<string, unknown>;
  operationId?: string;
  expectedRevision?: string;
}
function invocation(raw: unknown): Invocation {
  const data = object(raw);
  if (
    Object.keys(data).some(
      (k) => !["installationId", "actionId", "input", "operationId", "expectedRevision"].includes(k),
    )
  )
    invalid();
  if (typeof data.actionId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(data.actionId)) invalid();
  for (const field of ["operationId", "expectedRevision"])
    if (data[field] !== undefined && typeof data[field] !== "string") invalid();
  return {
    installationId: uuid(data.installationId),
    actionId: data.actionId,
    input: object(data.input ?? {}),
    operationId: data.operationId as string | undefined,
    expectedRevision: data.expectedRevision as string | undefined,
  };
}
async function permissions(client: pg.PoolClient, who: Who, id: string) {
  const install = await catalog(client, id);
  const grant = (await client.query("select * from agent_grant where agent_id=$1 and app_id=$2", [who.agent, id]))
    .rows[0];
  const allowed = new Set<string>();
  if (install.current && install.row.credential && grant) {
    for (const role of grant.roles) {
      if (install.row.enabled_roles.includes(role) && Object.hasOwn(install.access.roles, role)) {
        for (const action of install.access.roles[role]!.routes) allowed.add(action);
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
        bodyFields: route.bodyFields,
        needsRevision: !!route.expectedRevision,
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
/** Keys for upstream operations must not collide between agents that share an app credential. */
function upstreamId(agent: string, app: string, route: string, clientOperation: string) {
  return hash(JSON.stringify([agent, app, route, clientOperation]));
}
export async function receipt(db: Db, verifier: string, id: string, dataKey: string) {
  const checked = await transaction(db, async (client) => {
    const who = await identity(client, verifier);
    const row = (await client.query("select * from agent_request where id=$1 and agent_id=$2", [id, who.agent]))
      .rows[0];
    if (!row) forbidden();
    const install = await permissions(client, who, row.app_id);
    if (!install.allowed.has(row.route) || row.binding_revision < install.row.credential_revision) forbidden();
    const outcome = summary(row, dataKey);
    const mapping = install.access.routes[row.route]?.receipt;
    if (row.status !== "unknown" || !mapping || !row.operation_id || install.row.state !== "running")
      return { outcome };
    // A receipt is a separate read of the original operation. Never replay the write.
    if (!install.allowed.has(mapping.route)) return { outcome };
    const receiptRoute = install.access.routes[mapping.route]!;
    if ((install.grant.overrides[mapping.route] ?? receiptRoute.approval) === "ask") return { outcome };
    const secret = decrypt(dataKey, install.row.credential);
    const request = renderAgentRequest(receiptRoute, {
      path: { [mapping.param]: upstreamId(who.agent, row.app_id, row.route, row.operation_id) },
    });
    return {
      outcome,
      lookup: {
        args: {
          installation: {
            id: row.app_id,
            name: install.row.name,
            interfaceService: install.row.interface.service,
            interfacePort: install.row.interface.port,
          },
          ...request,
          headers: { ...request.headers, ...agentCredentialHeader(install.access, secret) },
        },
        secret,
        receiptRoute,
        writeRoute: install.access.routes[row.route]!,
      },
    };
  });
  if (!checked.lookup) return checked.outcome;
  const { args, secret, receiptRoute, writeRoute } = checked.lookup;
  try {
    const answer = await dispatchAppAction(args);
    if (answer.status !== 200) return checked.outcome;
    const visible = filterAgentResult(receiptRoute, answer.body, [secret]);
    const result = filterAgentResult(writeRoute, visible, [secret]);
    await db.$client.query(
      "update agent_request set status='succeeded',result=$2,revision=revision+1 where id=$1 and status='unknown'",
      [id, encrypt(dataKey, JSON.stringify(result))],
    );
    return { id, status: "succeeded", result };
  } catch {
    return checked.outcome;
  }
}
interface Admission {
  outcome: Outcome;
  dispatch?: { args: Parameters<typeof dispatchAppAction>[0]; route: AgentRoute; redact: string[] };
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
  if (v.operationId !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(v.operationId))
    invalid("Use a printable operation ID of up to 128 characters.");
  const operation = v.operationId === undefined ? undefined : upstreamId(who.agent, row.id, v.actionId, v.operationId);
  const request = renderAgentRequest(route, v.input, operation, v.expectedRevision);
  // Pending decisions bind current authority. For a read-only replay, compare the
  // exact rendered request against the authority metadata of its original admission.
  const fingerprintFor = (credentialId: string, bindingRevision: number, grantRevision: number) =>
    hash(
      JSON.stringify([
        request.method,
        request.path,
        request.headers,
        request.body,
        credentialId,
        bindingRevision,
        grantRevision,
      ]),
    );
  const fingerprint = fingerprintFor(who.key, row.revision, grant.revision);
  if (v.operationId && !pending) {
    const previous = (
      await client.query(
        "select * from agent_request where agent_id=$1 and app_id=$2 and route=$3 and operation_id=$4",
        [who.agent, row.id, v.actionId, v.operationId],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.binding_revision < row.credential_revision ||
        previous.fingerprint !== fingerprintFor(previous.key_id, previous.binding_revision, previous.grant_revision)
      )
        conflict();
      return { outcome: summary(previous, dataKey) };
    }
  }
  if (
    pending &&
    (pending.fingerprint !== fingerprint ||
      pending.binding_revision !== row.revision ||
      pending.grant_revision !== grant.revision ||
      pending.key_id !== who.key)
  )
    conflict();
  const isWrite = route.effect === "write" || route.method !== "GET";
  const ask =
    (isWrite && grant.ask_all_writes) ||
    (grant.overrides[v.actionId] ?? route.approval ?? (isWrite ? "ask" : "allow")) === "ask";
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
      `insert into agent_request(agent_id,key_id,app_id,route,operation_id,fingerprint,status,input,binding_revision,grant_revision,expires_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+case when $7='pending' then interval '15 minutes' else interval '1 minute' end) returning id`,
      [
        who.agent,
        who.key,
        row.id,
        v.actionId,
        v.operationId ?? null,
        fingerprint,
        status,
        input,
        row.revision,
        grant.revision,
      ],
    );
    id = result.rows[0].id;
  }
  const outcome = { id, status };
  if (status === "pending") return { outcome };
  const secret = decrypt(dataKey, row.credential);
  const args = {
    installation: {
      id: row.id,
      name: row.name,
      project: "ys-" + row.name,
      interfaceService: row.interface.service,
      interfacePort: row.interface.port,
    },
    ...request,
    headers: { ...request.headers, ...agentCredentialHeader(access, secret) },
  };
  return { outcome, dispatch: { args, route, redact: [secret] } };
}
async function run(db: Db, dataKey: string, admission: Admission): Promise<Outcome> {
  const { outcome, dispatch } = admission;
  if (!dispatch) return outcome;
  let status = "unknown";
  let result: unknown;
  try {
    const response = await dispatchAppAction(dispatch.args);
    if (response.status >= 200 && response.status < 300 && response.status !== 202) {
      result = filterAgentResult(dispatch.route, response.body, dispatch.redact);
      status = "succeeded";
    } else if (response.status === 409 || response.status === 412) status = "conflict";
    else if (response.status >= 400 && response.status < 500 && response.status !== 408) status = "refused";
  } catch {
    // Upstream may have committed. Never send another write on an uncertain outcome.
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
