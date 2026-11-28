import type pg from "pg";
import { sampleDenial } from "./denials.ts";
import type { Db } from "../db/client.ts";
import { decrypt, encrypt } from "../apps/settings.ts";
import {
  AgentKitError,
  agentCredentialHeader,
  asksFirst,
  credentialInject,
  parseAskRules,
  parseCall,
  passAgentResult,
} from "../apps/agent-kit.ts";
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
// Agent access is per app (spec 018): a call names an installation, a method and a path under its
// API, with a body. Your Space keeps no operation ID and doesn't match a retry to an earlier call.
interface Invocation {
  installationId: string;
  method: unknown;
  path: unknown;
  body?: unknown;
}
function invocation(raw: unknown): Invocation {
  const data = object(raw);
  if (Object.keys(data).some((k) => !["installationId", "method", "path", "body"].includes(k))) invalid();
  return { installationId: uuid(data.installationId), method: data.method, path: data.path, body: data.body };
}
/**
 * What an agent can do with an installation: reach it when it has a grant, the app's kit names its
 * API, and the grant's credential is bound and named by the kit. Nothing falls back to another
 * credential.
 */
async function permissions(client: pg.PoolClient, who: Who, id: string) {
  const install = await catalog(client, id);
  const grant = (await client.query("select * from agent_grant where agent_id=$1 and app_id=$2", [who.agent, id]))
    .rows[0];
  const inject =
    install.access && grant?.credential && Object.hasOwn(install.bound, grant.credential)
      ? credentialInject(install.access, grant.credential)
      : undefined;
  return { ...install, grant, inject };
}
/** Why an agent can't reach an app it has a grant for, in words for the agent and the owner. */
function unavailable(install: Awaited<ReturnType<typeof permissions>>): string | undefined {
  if (install.problem === "old_format")
    return "Agent access is unavailable: this app's kit is in the format before agent access per app. It returns once the app runs a kit that names api.";
  if (!install.grant?.credential) return "Agent access is unavailable: the owner hasn't picked the app key this agent uses.";
  if (!install.inject) return "Agent access is unavailable: the app key this agent uses isn't bound, or the app's kit no longer names it.";
  return undefined;
}
export async function discover(client: pg.PoolClient, who: Who) {
  const rows = (
    await client.query(
      `select g.app_id from agent_grant g join app a on g.app_id=a.id
    where g.agent_id=$1 and a.desired<>'removed' and a.kit->'agentAccess' is not null and a.interface is not null order by a.name`,
      [who.agent],
    )
  ).rows;
  const apps = [];
  for (const item of rows) {
    const install = await permissions(client, who, item.app_id);
    const reason = unavailable(install);
    apps.push({
      installationId: install.row.id,
      appName: install.row.title,
      api: install.access?.api ?? null,
      available: !reason,
      ...(reason ? { reason } : {}),
      asks: install.grant.asks,
    });
  }
  return { apps };
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
/** A request's outcome, for the agent that made it: a call that waited for approval is answered here. */
export async function requestOutcome(db: Db, verifier: string, id: string, dataKey: string): Promise<Outcome> {
  return transaction(db, async (client) => {
    const who = await identity(client, verifier);
    const row = (await client.query("select * from agent_request where id=$1 and agent_id=$2", [id, who.agent]))
      .rows[0];
    if (!row) forbidden();
    const install = await permissions(client, who, row.app_id);
    if (unavailable(install) || row.binding_revision < install.row.credential_revision) forbidden();
    return summary(row, dataKey);
  });
}
interface Admission {
  outcome: Outcome;
  dispatch?: {
    args: Parameters<typeof dispatchAppAction>[0];
    redact: string[];
    write: boolean;
    /** The grant's credential as it was sealed at admission, checked again just before sending. */
    sealed: { name: string; value: string };
  };
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
  // A label the activity log can store and show: printable text only, else just "call".
  const raw = typeof v.method === "string" && typeof v.path === "string" ? v.method + " " + v.path.split("?")[0] : "";
  const label = /^[\x20-\x7e]{1,300}$/.test(raw) ? raw : "call";
  if (!install?.grant) {
    const id = await sampleDenial(client, who, v.installationId, label);
    return { outcome: { id, status: "denied" } };
  }
  const reason = unavailable(install);
  if (reason) throw new AgencyError(403, "unavailable", reason);
  const { access, row, grant } = install;
  if (row.state !== "running") throw new AgencyError(503, "app_unavailable", "The app is unavailable.");
  let call;
  try {
    call = parseCall(access!, v);
  } catch (error) {
    if (error instanceof AgentKitError) invalid(error.message);
    throw error;
  }
  // A pending decision binds the exact call, its body included, to the authority it was admitted under.
  const fingerprint = hash(
    JSON.stringify([call.method, call.target, call.body ?? null, who.key, row.revision, grant.revision, grant.credential]),
  );
  if (
    pending &&
    (pending.fingerprint !== fingerprint ||
      pending.binding_revision !== row.revision ||
      pending.grant_revision !== grant.revision ||
      pending.key_id !== who.key)
  )
    conflict();
  // Nothing asks first unless the owner listed a route that does (spec 018 decisions 4 and 6).
  const ask = asksFirst(parseAskRules(grant.asks ?? []), call);
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
      [who.agent, who.key, row.id, call.label, fingerprint, status, input, row.revision, grant.revision],
    );
    id = result.rows[0].id;
  }
  const outcome = { id, status };
  if (status === "pending") return { outcome };
  // The call carries only its grant's credential; a response may echo none of the installation's.
  const secrets = Object.fromEntries(Object.entries(install.bound).map(([key, value]) => [key, decrypt(dataKey, value)]));
  const args = {
    installation: {
      id: row.id,
      name: row.name,
      project: "ys-" + row.name,
      interfaceService: row.interface.service,
      interfacePort: row.interface.port,
    },
    method: call.method,
    path: call.target,
    headers: agentCredentialHeader(install.inject!, secrets[grant.credential]!),
    ...(call.body === undefined ? {} : { body: call.body }),
  };
  return {
    outcome,
    dispatch: {
      args,
      redact: Object.values(secrets),
      write: call.method !== "GET",
      sealed: { name: grant.credential, value: install.bound[grant.credential]! },
    },
  };
}
async function run(db: Db, dataKey: string, admission: Admission): Promise<Outcome> {
  const { outcome, dispatch } = admission;
  if (!dispatch) return outcome;
  // A replaced or removed key is never used again (spec 018 decision 12): a call admitted with it, and
  // not yet sent, goes stale instead.
  const current = await db.$client.query("select credential from agent_credential where app_id=$1 and name=$2", [
    dispatch.args.installation.id,
    dispatch.sealed.name,
  ]);
  if (current.rows[0]?.credential !== dispatch.sealed.value) {
    await db.$client.query(
      "update agent_request set status='stale',revision=revision+1 where id=$1 and status='dispatching'",
      [outcome.id],
    );
    return { id: outcome.id, status: "stale" };
  }
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
