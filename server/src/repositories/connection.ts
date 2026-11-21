import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import { encrypt, decrypt } from "../apps/settings.ts";
import { AppError } from "../apps/service.ts";
import { deviceRequest, GithubClient, type GithubScope } from "./github.ts";

const expired = () => new AppError(410, "connection_expired", "This request ended. Start a new GitHub connection.");
const invalid = () => new AppError(400, "invalid_input", "Check the GitHub connection request.");
const failed = () => new AppError(502, "github_unavailable", "GitHub could not complete this request. Try again.");
type Actor = { actorId: string; sessionId: string };

function clientId(): string | undefined {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  return id && /^[a-z\d_.-]{4,128}$/i.test(id) ? id : undefined;
}
function requiredId() {
  const id = clientId();
  if (!id)
    throw new AppError(
      503,
      "github_not_configured",
      "Configure a GitHub OAuth app with Device Flow enabled and set GITHUB_OAUTH_CLIENT_ID on this server.",
    );
  return id;
}

export async function getGithubClient(db: Db, ownerId: string, dataKey: string): Promise<GithubClient> {
  const {
    rows: [row],
  } = await db.$client.query("select github_user_id,credential,scope from github_connection where owner_id=$1", [
    ownerId,
  ]);
  if (!row || !["public_repo", "repo"].includes(row.scope))
    throw new AppError(409, "github_not_connected", "Connect a GitHub account first.");
  return new GithubClient(decrypt(dataKey, row.credential), row.github_user_id, row.scope);
}

// Serialize connection replacement/disconnect for this owner, including when the
// connection row does not exist yet. No network request runs under this lock.
async function change<T>(db: Db, ownerId: string, work: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await db.$client.connect();
  try {
    await tx.query("begin");
    await tx.query("select id from actor where id=$1 for update", [ownerId]);
    const result = await work(tx);
    await tx.query("commit");
    return result;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/u.test(value);
}

export function githubConnections(db: Db, dataKey: string) {
  const pool = db.$client;
  async function start(owner: Actor, includePrivate: boolean) {
    const client = requiredId();
    const attempt = randomUUID();
    const scope = includePrivate ? "repo" : "public_repo";
    // Reserve the attempt before contacting GitHub. A disconnect or later start
    // invalidates it even if this upstream request finishes afterwards.
    await change(db, owner.actorId, (tx) =>
      tx.query(
        `insert into github_device(owner_id,session_id,attempt_id,device_code,expires_at,next_poll_at,interval_seconds,scope)
       values($1,$2,$3,'',now(),now(),5,$4) on conflict(owner_id) do update set session_id=$2,attempt_id=$3,
       device_code='',expires_at=now(),next_poll_at=now(),interval_seconds=5,scope=$4`,
        [owner.actorId, owner.sessionId, attempt, scope],
      ),
    );
    const response = await deviceRequest("device/code", { client_id: client, scope });
    if (
      !boundedString(response.device_code, 2048) ||
      !boundedString(response.user_code, 32) ||
      response.verification_uri !== "https://github.com/login/device" ||
      !Number.isInteger(response.expires_in) ||
      Number(response.expires_in) <= 0 ||
      !Number.isInteger(response.interval ?? 5)
    )
      throw failed();
    const interval = Math.max(5, Math.min(300, Number(response.interval ?? 5)));
    const expires = Math.min(900, Number(response.expires_in));
    const updated = await pool.query(
      `update github_device set device_code=$4,expires_at=now()+($5::integer * interval '1 second'),
       next_poll_at=now()+($6::integer * interval '1 second'),interval_seconds=$6
       where owner_id=$1 and session_id=$2 and attempt_id=$3 returning expires_at`,
      [owner.actorId, owner.sessionId, attempt, encrypt(dataKey, response.device_code), expires, interval],
    );
    if (!updated.rowCount) throw expired();
    return {
      attemptId: attempt,
      verificationUri: response.verification_uri,
      userCode: response.user_code,
      expiresAt: updated.rows[0].expires_at.toISOString(),
      intervalSeconds: interval,
    };
  }

  async function poll(owner: Actor, attempt: string) {
    const client = requiredId();
    const params = [owner.actorId, owner.sessionId, attempt];
    const match = "owner_id=$1 and session_id=$2 and attempt_id=$3";
    // Only the first in-window poll reaches GitHub, across HTTP sessions and workers.
    const {
      rows: [row],
    } = await pool.query(
      `update github_device set next_poll_at=now()+(interval_seconds * interval '1 second')
       where ${match} and expires_at>now() and next_poll_at<=now() returning device_code,scope,interval_seconds`,
      params,
    );
    if (!row) {
      const {
        rows: [wait],
      } = await pool.query(`select interval_seconds from github_device where ${match} and expires_at>now()`, params);
      if (!wait) {
        await pool.query(`delete from github_device where ${match} and expires_at<=now() and device_code<>''`, params);
        throw expired();
      }
      return { status: "pending", intervalSeconds: wait.interval_seconds };
    }
    const response = await deviceRequest("oauth/access_token", {
      client_id: client,
      device_code: decrypt(dataKey, row.device_code),
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (response.error === "authorization_pending") return { status: "pending", intervalSeconds: row.interval_seconds };
    if (response.error === "slow_down") {
      const seconds = Math.min(
        300,
        Math.max(row.interval_seconds + 5, Number.isInteger(response.interval) ? Number(response.interval) : 0),
      );
      const updated = await pool.query(
        `update github_device set interval_seconds=$4,next_poll_at=now()+($4::integer * interval '1 second') where ${match}`,
        [...params, seconds],
      );
      if (!updated.rowCount) throw expired();
      return { status: "pending", intervalSeconds: seconds };
    }
    if (
      response.error ||
      !boundedString(response.access_token, 4096) ||
      response.scope !== row.scope ||
      typeof response.token_type !== "string" ||
      response.token_type.toLowerCase() !== "bearer"
    ) {
      await pool.query(`delete from github_device where ${match}`, params);
      if (response.error === "access_denied")
        throw new AppError(403, "github_denied", "GitHub authorization was declined.");
      if (response.error === "expired_token" || response.error === "token_expired") throw expired();
      if (response.access_token && response.scope !== row.scope)
        throw new AppError(
          403,
          "github_scope_changed",
          "GitHub granted a different scope. Review this OAuth app in GitHub Settings before reconnecting.",
        );
      throw failed();
    }
    const token = response.access_token;
    const scope: GithubScope = row.scope;
    const account = await new GithubClient(token, "", scope).account();
    await change(db, owner.actorId, async (tx) => {
      const consumed = await tx.query(
        `delete from github_device where ${match} and expires_at>now() returning owner_id`,
        params,
      );
      if (!consumed.rowCount) throw expired();
      // An account switch must not resurrect agent grants if the owner later switches back.
      await tx.query("delete from repository_grant where owner_id=$1 and account_id<>$2", [owner.actorId, account.id]);
      await tx.query(
        `insert into github_connection(owner_id,github_user_id,login,credential,scope) values($1,$2,$3,$4,$5)
         on conflict(owner_id) do update set github_user_id=$2,login=$3,credential=$4,scope=$5`,
        [owner.actorId, account.id, account.login, encrypt(dataKey, token), scope],
      );
    });
    return { status: "connected", login: account.login, scope };
  }

  return {
    async state(owner: Actor) {
      await pool.query("delete from github_device where owner_id=$1 and expires_at<=now() and device_code<>''", [
        owner.actorId,
      ]);
      const {
        rows: [row],
      } = await pool.query("select login,scope from github_connection where owner_id=$1", [owner.actorId]);
      return {
        configured: Boolean(clientId()),
        connected: Boolean(row),
        ...(row ? { login: row.login, scope: row.scope } : {}),
      };
    },
    start,
    poll,
    async disconnect(owner: Actor) {
      await change(db, owner.actorId, async (tx) => {
        await tx.query("delete from github_device where owner_id=$1", [owner.actorId]);
        await tx.query("delete from github_connection where owner_id=$1", [owner.actorId]);
      });
      return { ok: true };
    },
  };
}

export function githubConnectionRoutes(auth: Auth, db: Db, dataKey: string) {
  const router = Router();
  const service = githubConnections(db, dataKey);
  const route =
    (fields: string[], work: (owner: Actor, body: Record<string, unknown>) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        const owner = await ownerFor(auth, db, req);
        if (typeof owner === "string")
          throw new AppError(owner === "signed_out" ? 401 : 403, owner, "Sign in as the workspace owner.");
        let body = {};
        if (req.method !== "GET") {
          if (req.get("origin") !== new URL(auth.options.baseURL as string).origin || !req.is("application/json")) {
            throw new AppError(403, "forbidden", "Use the signed-in workspace to manage GitHub.");
          }
          if (
            !req.body ||
            typeof req.body !== "object" ||
            Array.isArray(req.body) ||
            Object.keys(req.body).some((key) => !fields.includes(key))
          )
            throw invalid();
          body = req.body;
        }
        res.json(await work(owner, body));
      } catch (err) {
        if (err instanceof AppError) res.status(err.status).json({ error: err.code, message: err.message });
        else res.status(500).json({ error: "connection_failed", message: "Could not complete the GitHub connection." });
      }
    };
  router.get(
    "/",
    route([], (owner) => service.state(owner)),
  );
  router.post(
    "/start",
    route(["privateRepos"], (owner, body) => {
      if (body.privateRepos !== undefined && typeof body.privateRepos !== "boolean") throw invalid();
      return service.start(owner, body.privateRepos === true);
    }),
  );
  router.post(
    "/poll",
    route(["attemptId"], (owner, body) => {
      if (typeof body.attemptId !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.attemptId))
        throw invalid();
      return service.poll(owner, body.attemptId);
    }),
  );
  router.delete(
    "/",
    route([], (owner) => service.disconnect(owner)),
  );
  return router;
}
