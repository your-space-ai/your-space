import { Router, type Request, type Response, type NextFunction } from "express";
import type pg from "pg";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import {
  activity,
  AgencyError,
  dashboard,
  forbidden,
  object,
  transaction,
  uuid,
} from "./store.ts";
import { bind, createAgent, editAgent, grant, manageKey } from "./owner.ts";
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
  return router;
}
