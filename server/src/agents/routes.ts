import { Router, type Request, type Response, type NextFunction } from "express";
import type pg from "pg";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import { AgentKitError } from "../apps/agent-kit.ts";
import {
  activity,
  AgencyError,
  dashboard,
  forbidden,
  hash,
  identity,
  invalid,
  object,
  transaction,
  uuid,
} from "./store.ts";
import { bind, createAgent, editAgent, grant, manageKey } from "./owner.ts";
import { decide, discover, invoke, requestOutcome } from "./invoke.ts";

function verifier(req: Request) {
  const value = req.get("Authorization");
  if (!value || !/^Bearer ysa_[A-Za-z0-9_-]{43}$/.test(value))
    throw new AgencyError(401, "invalid_credential", "A current agent key is required.");
  return hash(value.slice(7));
}
export function agentRoutes(auth: Auth, db: Db, dataKey: string) {
  const router = Router();
  const route =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      res.set("Cache-Control", "no-store");
      try {
        await handler(req, res);
      } catch (err) {
        if (err instanceof AgencyError) res.status(err.status).json({ error: err.code, message: err.message });
        else if (err instanceof AgentKitError)
          res.status(400).json({ error: "invalid_input", message: err.message });
        else next(err);
      }
    };
  const owner = async (req: Request) => {
    if (
      req.method !== "GET" &&
      (req.get("origin") !== new URL(auth.options.baseURL as string).origin || !req.is("application/json"))
    )
      forbidden();
    const who = await ownerFor(auth, db, req);
    if (who === "signed_out") throw new AgencyError(401, "signed_out", "Sign in to Your Space first.");
    if (who === "forbidden") forbidden();
    return who.actorId;
  };
  const ownerRoute = (handler: (c: pg.PoolClient, id: string, req: Request) => Promise<unknown>) =>
    route(async (req, res) => {
      const id = await owner(req);
      res.json(await transaction(db, (c) => handler(c, id, req)));
    });
  router.get(
    "/agents/dashboard",
    ownerRoute((c, id) => dashboard(c, id, dataKey)),
  );
  router.get(
    "/agents/activity",
    ownerRoute((c, id, r) => activity(c, id, r.query.before === undefined ? undefined : uuid(r.query.before))),
  );
  router.post(
    "/agents",
    ownerRoute((c, id, r) => createAgent(c, id, object(r.body).name)),
  );
  router.patch(
    "/agents/:id",
    ownerRoute((c, id, r) => editAgent(c, id, uuid(r.params.id), object(r.body))),
  );
  router.post(
    "/agents/:id/keys",
    ownerRoute((c, id, r) => manageKey(c, id, uuid(r.params.id))),
  );
  router.post(
    "/agents/:id/keys/:keyId/rotate",
    ownerRoute((c, id, r) => manageKey(c, id, uuid(r.params.id), uuid(r.params.keyId))),
  );
  router.post(
    "/agents/:id/keys/:keyId/revoke",
    ownerRoute((c, id, r) => manageKey(c, id, uuid(r.params.id), uuid(r.params.keyId), true)),
  );
  router.put(
    "/agents/installations/:id",
    ownerRoute((c, _id, r) => bind(c, uuid(r.params.id), object(r.body), dataKey)),
  );
  router.put(
    "/agents/:id/grants/:installationId",
    ownerRoute((c, id, r) => grant(c, id, uuid(r.params.id), uuid(r.params.installationId), object(r.body))),
  );
  router.post(
    "/agents/requests/:id/decision",
    route(async (r, res) => {
      res.json(await decide(db, dataKey, await owner(r), uuid(r.params.id), r.body));
    }),
  );
  router.get(
    "/agent/apps",
    route(async (r, res) => {
      const key = verifier(r);
      res.json(await transaction(db, async (c) => discover(c, await identity(c, key))));
    }),
  );
  router.get(
    "/agent/requests/:id",
    route(async (r, res) => {
      const key = verifier(r);
      res.json(await requestOutcome(db, key, uuid(r.params.id), dataKey));
    }),
  );
  router.post(
    "/agent/call",
    route(async (r, res) => {
      if (!r.is("application/json")) invalid();
      const outcome = await invoke(db, dataKey, verifier(r), r.body);
      const status = { pending: 202, denied: 403, refused: 422, unknown: 502 }[outcome.status] ?? 200;
      if (outcome.status === "denied") {
        res.status(403).json({ error: "denied", status: "denied" });
      } else {
        res.status(status).json(status >= 400 ? { ...outcome, error: outcome.status } : outcome);
      }
    }),
  );
  return router;
}
