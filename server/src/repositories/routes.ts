import { Router, type Request, type Response, type NextFunction } from "express";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import { AppsService, AppError } from "../apps/service.ts";
import { applyReplacement, pendingReplacement, previewReplacement } from "../apps/replacement.ts";
import { AgencyError, hash, identity, object, transaction, uuid } from "../agents/store.ts";
import { getGithubClient } from "./connection.ts";
import type { GithubClient, GithubRepo } from "./github.ts";
import { loadSnapshot, previewSnapshot } from "./sources.ts";

const denied = () => new AppError(403, "forbidden", "This operation is outside your repository access.");
const bad = () => new AppError(400, "invalid_repository_input", "Check the repository and request fields.");
const repoId = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{1,20}$/.test(v)) throw bad();
  return v;
};
const word = (v: unknown) => {
  if (typeof v !== "string" || !v.length || v.length > 1024) throw bad();
  return v;
};
type Principal = { owner: string; agent?: string };
type Grant = { canCreate: boolean; canFork: boolean; repoIds: string[]; revision: number };
const empty: Grant = { canCreate: false, canFork: false, repoIds: [], revision: 0 };
const fields = 'repo_id as id, full_name as "fullName", origin, default_branch as "defaultBranch", private';
const grants = 'can_create as "canCreate", can_fork as "canFork", repo_ids as "repoIds", revision';

async function access(db: Db, p: Principal, github: GithubClient): Promise<Grant> {
  if (!p.agent) return empty;
  const r = await db.$client.query(
    "select " + grants + " from repository_grant where owner_id=$1 and account_id=$2 and agent_id=$3",
    [p.owner, github.accountId, p.agent],
  );
  return r.rows[0] ?? empty;
}

async function managed(db: Db, p: Principal, github: GithubClient, id: string) {
  const grant = await access(db, p, github);
  if (p.agent && !grant.repoIds.includes(id)) throw denied();
  const r = await db.$client.query(
    "select " + fields + " from managed_repository where owner_id=$1 and account_id=$2 and repo_id=$3",
    [p.owner, github.accountId, id],
  );
  if (!r.rowCount) throw denied();
  return r.rows[0] as GithubRepo;
}

export function repoRoutes(
  auth: Auth,
  db: Db,
  dataKey: string,
  apps: AppsService,
  agent = false,
  connect = getGithubClient,
) {
  const router = Router();
  const route =
    (fn: (p: Principal, req: Request, github: GithubClient) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.set("Cache-Control", "no-store");
        let p: Principal;
        if (agent) {
          const key = req.get("authorization");
          if (!key || !/^Bearer ysa_[A-Za-z0-9_-]{43}$/.test(key))
            throw new AgencyError(401, "invalid_credential", "A current Your Space agent key is required.");
          const who = await transaction(db, (c) => identity(c, hash(key.slice(7))));
          p = { owner: who.owner, agent: who.agent };
        } else {
          const who = await ownerFor(auth, db, req);
          if (who === "signed_out") throw new AppError(401, "signed_out", "Sign in to Your Space.");
          if (who === "forbidden") throw denied();
          if (req.method !== "GET" && req.get("origin") !== new URL(auth.options.baseURL as string).origin)
            throw denied();
          p = { owner: who.actorId };
        }
        if (req.method !== "GET" && !req.is("application/json")) throw bad();
        res.json(await fn(p, req, await connect(db, p.owner, dataKey)));
      } catch (e) {
        if (e instanceof AppError || e instanceof AgencyError)
          res.status(e.status).json({ error: e.code, message: e.message });
        else next(e);
      }
    };
  router.get(
    "/",
    route(async (p, _req, g) => {
      const a = await access(db, p, g);
      const all = await db.$client.query(
        "select " + fields + " from managed_repository where owner_id=$1 and account_id=$2 order by lower(full_name)",
        [p.owner, g.accountId],
      );
      if (p.agent)
        return { repos: all.rows.filter((r) => a.repoIds.includes(r.id)), canCreate: a.canCreate, canFork: a.canFork };
      const agents = await db.$client.query(
        "select id,name from external_agent where owner_id=$1 and not disabled order by name",
        [p.owner],
      );
      const gs = await db.$client.query(
        'select agent_id as "agentId", ' + grants + " from repository_grant where owner_id=$1 and account_id=$2",
        [p.owner, g.accountId],
      );
      return { repos: all.rows, agents: agents.rows, grants: gs.rows };
    }),
  );
  async function register(p: Principal, g: GithubClient, r: GithubRepo, origin: "imported" | "created" | "forked") {
    const row = await transaction(db, async (c) => {
      const conn = await c.query("select github_user_id from github_connection where owner_id=$1 for share", [p.owner]);
      if (conn.rows[0]?.github_user_id !== g.accountId) throw denied();
      const result = await c.query(
        "insert into managed_repository (owner_id,account_id,repo_id,full_name,origin,default_branch,private) values ($1,$2,$3,$4,$5,$6,$7) on conflict (owner_id,account_id,repo_id) do update set full_name=excluded.full_name,default_branch=excluded.default_branch,private=excluded.private returning " +
          fields,
        [p.owner, g.accountId, r.id, r.fullName, origin, r.defaultBranch, r.private],
      );
      if (p.agent && origin !== "imported") {
        const ability = origin === "created" ? "can_create" : "can_fork";
        await c.query(
          "update repository_grant set repo_ids=array_append(repo_ids,$4),revision=revision+1 where owner_id=$1 and account_id=$2 and agent_id=$3 and " +
            ability +
            " and not ($4=any(repo_ids))",
          [p.owner, g.accountId, p.agent, r.id],
        );
      }
      await c.query("insert into event(type,actor_id) values($1,$2)", ["repository." + origin, p.agent ?? p.owner]);
      return result.rows[0];
    });
    return { repo: row };
  }
  if (!agent)
    router.post(
      "/import",
      route(async (p, r, g) => register(p, g, await g.repo(word(r.body?.fullName)), "imported")),
    );
  router.post(
    "/create",
    route(async (p, r, g) => {
      if (p.agent && !(await access(db, p, g)).canCreate) throw denied();
      if (typeof r.body?.private !== "boolean") throw bad();
      return register(p, g, await g.create(word(r.body.name), r.body.private), "created");
    }),
  );
  router.post(
    "/fork",
    route(async (p, r, g) => {
      const fullName = word(r.body?.fullName);
      if (p.agent) {
        const grant = await access(db, p, g);
        if (!grant.canFork) throw denied();
        const known = await db.$client.query(
          "select 1 from app where lower(repo)=lower($1) and desired <> 'removed' union all select 1 from managed_repository where owner_id=$2 and account_id=$3 and lower(full_name)=lower($1) and repo_id=any($4::text[])",
          [fullName, p.owner, g.accountId, grant.repoIds],
        );
        if (!known.rowCount) throw denied();
      }
      const upstream = await g.repo(fullName);
      return register(
        p,
        g,
        await g.fork(upstream.id, r.body?.name ? word(r.body.name) : upstream.fullName.split("/")[1]),
        "forked",
      );
    }),
  );
  if (!agent)
    router.put(
      "/grants/:id",
      route(async (p, r, g) => {
        const id = uuid(r.params.id),
          b = object(r.body);
        if (
          typeof b.canCreate !== "boolean" ||
          typeof b.canFork !== "boolean" ||
          !Number.isSafeInteger(b.revision) ||
          !Array.isArray(b.repoIds) ||
          b.repoIds.length > 256
        )
          throw bad();
        const ids = [...new Set(b.repoIds.map(repoId))];
        return transaction(db, async (c) => {
          const who = await c.query(
            "select id from external_agent where owner_id=$1 and id=$2 and not disabled for share",
            [p.owner, id],
          );
          if (!who.rowCount) throw denied();
          const owned = await c.query(
            "select repo_id from managed_repository where owner_id=$1 and account_id=$2 and repo_id=any($3::text[])",
            [p.owner, g.accountId, ids],
          );
          if (owned.rowCount !== ids.length) throw denied();
          const old = await c.query(
            "select revision from repository_grant where owner_id=$1 and account_id=$2 and agent_id=$3 for update",
            [p.owner, g.accountId, id],
          );
          if ((old.rows[0]?.revision ?? 0) !== b.revision)
            throw new AppError(409, "stale_grant", "Refresh the repository grants before saving.");
          const result = await c.query(
            "insert into repository_grant (owner_id,account_id,agent_id,can_create,can_fork,repo_ids) values($1,$2,$3,$4,$5,$6) on conflict(owner_id,account_id,agent_id) do update set can_create=excluded.can_create,can_fork=excluded.can_fork,repo_ids=excluded.repo_ids,revision=repository_grant.revision+1 returning " +
              grants,
            [p.owner, g.accountId, id, b.canCreate, b.canFork, ids],
          );
          return result.rows[0];
        });
      }),
    );
  router.get(
    "/file",
    route(async (p, r, g) => {
      const id = repoId(r.query.repoId),
        repo = await managed(db, p, g, id);
      return g.file(id, word(r.query.path), word(r.query.ref ?? repo.defaultBranch));
    }),
  );
  router.put(
    "/file",
    route(async (p, r, g) => {
      const b = object(r.body),
        id = repoId(b.repoId);
      await managed(db, p, g, id);
      if (typeof b.content !== "string") throw bad();
      const result = await g.put(id, word(b.path), {
        content: b.content,
        message: word(b.message),
        branch: word(b.branch),
        ...(b.sha === undefined ? {} : { sha: word(b.sha) }),
      });
      await db.$client.query("insert into event(type,actor_id) values('repository.committed',$1)", [
        p.agent ?? p.owner,
      ]);
      return result;
    }),
  );
  if (!agent) {
    router.post(
      "/:id/install/preview",
      route(async (p, r, g) => {
        const id = repoId(r.params.id);
        await managed(db, p, g, id);
        return previewSnapshot(apps, await loadSnapshot(g, id, object(r.body)));
      }),
    );
    router.post(
      "/:id/deploy/preview",
      route(async (p, r, g) => {
        const id = repoId(r.params.id);
        await managed(db, p, g, id);
        return previewReplacement(
          apps,
          uuid(r.body?.appId),
          p.owner,
          await loadSnapshot(g, id, object(r.body)),
          g.accountId,
        );
      }),
    );
    router.get(
      "/:id/deploy/pending",
      route(async (p, r, g) => {
        const id = repoId(r.params.id);
        await managed(db, p, g, id);
        return pendingReplacement(apps, uuid(r.query.appId), p.owner, id, g.accountId);
      }),
    );
    router.get(
      "/:id/deploy/receipt",
      route(async (p, r, g) => {
        const id = repoId(r.params.id);
        await managed(db, p, g, id);
        const appId = uuid(r.query.appId);
        const previewId = uuid(r.query.previewId);
        const commit = r.query.commit;
        if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) throw bad();
        const result = await db.$client.query(
          `select r.app_id as "appId", r.repo_id as "repoId", r.candidate->>'commit' as commit, r.state as status
           from app_replacement r
           join app a on a.id = r.app_id and a.desired <> 'removed'
           join github_connection c on c.owner_id = r.owner_id and c.github_user_id = (r.original #>> '{review,accountId}')
           where r.owner_id = $1 and c.github_user_id = $2 and r.repo_id = $3 and r.app_id = $4
             and r.id = $5 and r.candidate->>'commit' = $6 and r.state in ('applying', 'applied')`,
          [p.owner, g.accountId, id, appId, previewId, commit],
        );
        const row = result.rows[0];
        if (row?.status === "applying") return { receipt: null, applying: true };
        return { receipt: row ?? null };
      }),
    );
    router.post(
      "/:id/deploy/apply",
      route(async (p, r, g) => {
        const id = repoId(r.params.id);
        await managed(db, p, g, id);
        return applyReplacement(
          apps,
          uuid(r.body?.appId),
          p.owner,
          uuid(r.body?.previewId),
          id,
          g.accountId,
          r.body?.commit,
        );
      }),
    );
  }
  return router;
}
