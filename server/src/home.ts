import { and, eq, isNotNull } from "drizzle-orm";
import { Router, type Request, type Response, type NextFunction } from "express";
import type pg from "pg";
import type { Auth } from "./auth.ts";
import type { Db } from "./db/client.ts";
import { app, type Publish } from "./db/schema.ts";
import { ownerFor } from "./apps/routes.ts";
import { appOrigin, inPane, type AppsService } from "./apps/service.ts";
import {
  AgentKitError,
  agentCredentialHeader,
  filterAgentResult,
  renderAgentRequest,
  type AgentAccess,
} from "./apps/agent-kit.ts";
import { decrypt } from "./apps/settings.ts";
import {
  AgencyError,
  catalog,
  conflict,
  forbidden,
  hash,
  invalid,
  object,
  roles,
  transaction,
  uuid,
} from "./agents/store.ts";
import { dispatchAppAction } from "./agents/transport.ts";

type AgentRole = AgentAccess["roles"][string];
interface Grant {
  installationId: string;
  bindingRevision: number;
  roles: string[];
}
interface Setting {
  revision: number;
  selected_id: string | null;
  generation: string | null;
  grants: Grant[];
}
interface HomeRow {
  id: string;
  name: string;
  title: string;
  pane: boolean;
  frame: boolean;
  publish: Publish | null;
  interface: { service: string; port: number } | null;
  state: string;
  desired: string;
  kit: { agentAccess?: AgentAccess } | null;
  kit_source: string | null;
  commit: string;
  install_event: string | null;
}
interface Candidate {
  installationId: string;
  generation: string;
  name: string;
  title: string;
  origin: string;
  src: string;
}
interface Target {
  installationId: string;
  name: string;
  title: string;
  bindingRevision: number;
  roles: Record<string, AgentRole>;
}

function keys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) invalid();
}

function readRoles(access: AgentAccess, enabled: string[]): Record<string, AgentRole> {
  const result: Record<string, AgentRole> = Object.create(null);
  for (const id of enabled) {
    if (!Object.hasOwn(access.roles, id)) continue;
    const role = access.roles[id]!;
    if (!role.routes.every((key) => access.routes[key]?.effect === "read" && access.routes[key]?.method === "GET"))
      continue;
    const routes = role.routes.filter((key) => access.routes[key]!.approval !== "ask");
    if (routes.length) result[id] = { title: role.title, routes };
  }
  return result;
}

async function setting(client: pg.PoolClient, owner: string) {
  const [workspace] = (
    await client.query<{ id: string }>(
      `select i.workspace_id as id from installation i
    join member m on m.organization_id=i.workspace_id and m.role='owner' join actor a on a.user_id=m.user_id
    where i.id=1 and i.state='claimed' and a.id=$1`,
      [owner],
    )
  ).rows;
  if (!workspace) forbidden();
  const [saved] = (
    await client.query<Setting>(
      "select revision,selected_id,generation,grants from workspace_home where workspace_id=$1",
      [workspace.id],
    )
  ).rows;
  return { workspace: workspace.id, saved: saved ?? { revision: 0, selected_id: null, generation: null, grants: [] } };
}

async function installed(client: pg.PoolClient): Promise<HomeRow[]> {
  return (
    await client.query<HomeRow>(`select a.id,a.name,a.title,a.pane,a.frame,a.publish,a.interface,a.state,a.desired,
    a.kit,a.kit_source,a.commit,(select e.id from event e where e.subject_app_id=a.id and e.type='app.installed'
      order by e.created_at desc,e.id desc limit 1) as install_event
    from app a where a.desired <> 'removed' order by a.name for share of a`)
  ).rows;
}

function candidates(rows: HomeRow[], publicUrl: string, frames: Map<string, string>): Candidate[] {
  const origins = rows.map((row) => new URL(appOrigin(publicUrl, row)).origin);
  const result: Candidate[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.state !== "running" || row.desired !== "running" || !row.interface || !row.pane || !row.frame) continue;
    const origin = origins[index]!;
    if (
      origin === new URL(publicUrl).origin ||
      origins.indexOf(origin) !== origins.lastIndexOf(origin) ||
      rows.some((other) => other.id !== row.id && appOrigin(publicUrl, { name: other.name, publish: null }) === origin)
    )
      continue;
    const link = row.publish?.link;
    const framing = frames.get(row.name);
    if (link && (!inPane(publicUrl, row) || !framing)) continue;
    const generation = hash(
      JSON.stringify([row.id, row.install_event, row.kit_source, row.kit, row.commit, row.interface, origin]),
    );
    result.push({
      installationId: row.id,
      generation,
      name: row.name,
      title: row.title,
      origin,
      src: link ? link + "/?ys-pane=" + encodeURIComponent(framing!) : origin + "/",
    });
  }
  return result;
}

async function target(client: pg.PoolClient, id: string) {
  const { row, access, current } = await catalog(client, id);
  if (!current || !row.credential || row.state !== "running" || row.desired !== "running") return null;
  const allowed = readRoles(access, row.enabled_roles);
  if (!Object.keys(allowed).length) return null;
  const visible: Target = {
    installationId: id,
    name: row.name,
    title: row.title,
    bindingRevision: row.revision,
    roles: allowed,
  };
  return { visible, row, access };
}

async function state(client: pg.PoolClient, owner: string, publicUrl: string, frames: Map<string, string>) {
  const { saved } = await setting(client, owner);
  const rows = await installed(client);
  const list = candidates(rows, publicUrl, frames);
  const activeHome =
    list.find((home) => home.installationId === saved.selected_id && home.generation === saved.generation) ?? null;
  const targets: Target[] = [];
  for (const row of rows) {
    if (!row.kit?.agentAccess || !row.interface || row.state !== "running" || row.desired !== "running") continue;
    const entry = await target(client, row.id);
    if (entry) targets.push(entry.visible);
  }
  return {
    revision: saved.revision,
    selectedId: saved.selected_id,
    activeHome,
    candidates: list,
    targets,
    grants: saved.grants,
  };
}

function checkedHome(view: Awaited<ReturnType<typeof state>>, body: Record<string, unknown>) {
  if (body.revision !== view.revision) conflict();
  if (!view.activeHome || view.activeHome.installationId !== uuid(body.homeId)) forbidden();
  return view.activeHome;
}

function allowedRoutes(view: Awaited<ReturnType<typeof state>>, target: Target) {
  const grant = view.grants.find(
    (item) => item.installationId === target.installationId && item.bindingRevision === target.bindingRevision,
  );
  return new Set(grant?.roles.flatMap((role) => target.roles[role]?.routes ?? []) ?? []);
}

export function homeRoutes(auth: Auth, db: Db, dataKey: string, service?: AppsService) {
  const router = Router();
  const publicUrl = String(auth.options.baseURL);
  async function framing() {
    if (!service) return new Map<string, string>();
    const apps = await db
      .select({ name: app.name })
      .from(app)
      .where(and(isNotNull(app.publish), eq(app.state, "running")));
    return service.framing(apps.map((row) => row.name));
  }
  type Context = { owner: string; body: Record<string, unknown>; frames: Map<string, string> };
  const route = (fn: (ctx: Context) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    try {
      const who = await ownerFor(auth, db, req);
      if (who === "signed_out") throw new AgencyError(401, "signed_out", "Sign in to Your Space first.");
      if (who === "forbidden") forbidden();
      if (req.method !== "GET" && (req.get("origin") !== new URL(publicUrl).origin || !req.is("application/json")))
        forbidden();
      res.json(
        await fn({ owner: who.actorId, body: req.method === "GET" ? {} : object(req.body), frames: await framing() }),
      );
    } catch (error) {
      if (error instanceof AgencyError) res.status(error.status).json({ error: error.code, message: error.message });
      else if (error instanceof AgentKitError)
        res.status(400).json({ error: "invalid_input", message: "The input does not match the selected read." });
      else next(error);
    }
  };
  router.get(
    "/",
    route(({ owner, frames }) => transaction(db, (c) => state(c, owner, publicUrl, frames))),
  );
  router.put(
    "/",
    route(({ owner, body, frames }) =>
      transaction(db, async (c) => {
        keys(body, ["revision", "homeId", "homeGeneration", "grants"]);
        const view = await state(c, owner, publicUrl, frames);
        if (body.revision !== view.revision) conflict();
        if (!Array.isArray(body.grants) || body.grants.length > view.targets.length) invalid();
        const home = body.homeId === null ? null : view.candidates.find((x) => x.installationId === uuid(body.homeId));
        if (home === undefined || (home?.generation ?? null) !== body.homeGeneration) conflict();
        if (!home && body.grants.length) forbidden();
        const chosen: Grant[] = [];
        for (const raw of body.grants) {
          const value = object(raw);
          keys(value, ["installationId", "bindingRevision", "roles"]);
          const dest = view.targets.find((x) => x.installationId === uuid(value.installationId));
          if (!dest || chosen.some((x) => x.installationId === dest.installationId)) invalid();
          if (value.bindingRevision !== dest.bindingRevision) conflict();
          const selected = roles(value.roles, Object.keys(dest.roles));
          if (!selected.length) invalid();
          chosen.push({ installationId: dest.installationId, bindingRevision: dest.bindingRevision, roles: selected });
        }
        const { workspace } = await setting(c, owner);
        await c.query(
          `insert into workspace_home(workspace_id,selected_id,generation,revision,grants)
      values($1,$2,$3,$4,$5) on conflict(workspace_id) do update set selected_id=excluded.selected_id,
      generation=excluded.generation,revision=excluded.revision,grants=excluded.grants`,
          [
            workspace,
            home?.installationId ?? null,
            home?.generation ?? null,
            view.revision + 1,
            JSON.stringify(chosen),
          ],
        );
        await c.query("insert into event(type,actor_id,subject_app_id) values('home.configuration_changed',$1,$2)", [
          owner,
          home?.installationId ?? view.selectedId,
        ]);
        return {
          ...view,
          activeHome: home,
          selectedId: home?.installationId ?? null,
          revision: view.revision + 1,
          grants: chosen,
        };
      }),
    ),
  );
  router.get(
    "/activity",
    route(({ owner }) =>
      transaction(db, async (c) => {
        await setting(c, owner);
        const { rows } = await c.query(
          `select home_id as "homeId",target_id as "installationId",
      action as "actionId",last_read as "lastRead" from home_read_activity where owner_id=$1
      order by last_read desc,home_id,target_id,action limit 50`,
          [owner],
        );
        return { reads: rows };
      }),
    ),
  );
  router.post(
    "/actions",
    route(({ owner, body, frames }) =>
      transaction(db, async (c) => {
        keys(body, ["homeId", "revision"]);
        const view = await state(c, owner, publicUrl, frames);
        checkedHome(view, body);
        const actions = [];
        for (const dest of view.targets) {
          const ids = allowedRoutes(view, dest);
          if (!ids.size) continue;
          const { access } = await catalog(c, dest.installationId);
          for (const actionId of ids) {
            const { method, effect, pathParams, queryFields } = access.routes[actionId]!;
            actions.push({
              installationId: dest.installationId,
              appName: dest.title,
              actionId,
              method,
              effect,
              pathParams,
              queryFields,
            });
          }
        }
        return { actions };
      }),
    ),
  );
  router.post(
    "/read",
    route(async ({ owner, body, frames }) => {
      keys(body, ["revision", "homeId", "installationId", "actionId", "input"]);
      const id = uuid(body.installationId);
      const actionId = body.actionId;
      if (typeof actionId !== "string") invalid();
      async function admit(c: pg.PoolClient, proofs: Map<string, string>) {
        const view = await state(c, owner, publicUrl, proofs);
        const home = checkedHome(view, body);
        const dest = view.targets.find((x) => x.installationId === id);
        if (!dest || !allowedRoutes(view, dest).has(actionId as string)) forbidden();
        return home;
      }
      const admitted = await transaction(db, async (c) => {
        const home = await admit(c, frames);
        const { access, row } = await catalog(c, id);
        const route = access.routes[actionId]!;
        const request = renderAgentRequest(route, body.input ?? {});
        const secret = decrypt(dataKey, row.credential);
        return {
          homeId: home.installationId,
          route,
          secret,
          args: {
            ...request,
            installation: {
              id,
              name: row.name,
              interfaceService: row.interface.service,
              interfacePort: row.interface.port,
            },
            headers: { ...request.headers, ...agentCredentialHeader(access, secret) },
          },
        };
      });
      let result;
      try {
        const response = await dispatchAppAction(admitted.args);
        if (response.status !== 200) throw new Error();
        result = filterAgentResult(admitted.route, response.body, [admitted.secret]);
      } catch {
        throw new AgencyError(502, "read_failed", "The target app could not return a permitted result.");
      }
      const fresh = await framing();
      await transaction(db, async (c) => {
        await admit(c, fresh);
        await c.query(
          `insert into home_read_activity(home_id,target_id,action,owner_id) values($1,$2,$3,$4)
        on conflict(home_id,target_id,action) do update set owner_id=excluded.owner_id,last_read=now()`,
          [admitted.homeId, id, actionId, owner],
        );
      });
      return { result };
    }),
  );
  return router;
}
