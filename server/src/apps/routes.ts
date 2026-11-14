// The owner-only apps API (component I, FR-010, contracts/http-api.md).
import { and, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ensureHumanActor } from "../actors.ts";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { member } from "../db/auth-schema.ts";
import { safeReturn, type Handoffs } from "./gate.ts";
import { AppError, type AppsService } from "./service.ts";

interface Owner {
  userId: string;
  sessionId: string;
  actorId: string;
}

async function ownerFor(auth: Auth, db: Db, req: Request): Promise<Owner | "signed_out" | "forbidden"> {
  const current = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!current) return "signed_out";
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, current.user.id), eq(member.role, "owner")))
    .limit(1);
  if (!rows[0]) return "forbidden";
  return { userId: current.user.id, sessionId: current.session.id, actorId: await ensureHumanActor(db, current.user.id) };
}

type Handler = (req: Request, res: Response, owner: Owner) => Promise<void>;

export function appRoutes(auth: Auth, db: Db, apps: AppsService, handoffs: Handoffs): Router {
  const router = Router();

  const owner = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    try {
      const who = await ownerFor(auth, db, req);
      if (who === "signed_out") return void res.status(401).json({ error: "signed_out", message: "Sign in to Your Space first." });
      if (who === "forbidden") return void res.status(403).json({ error: "forbidden", message: "Only the owner can manage apps." });
      await handler(req, res, who);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.status).json({ error: error.code, message: error.message, details: error.details });
        return;
      }
      next(error);
    }
  };

  const name = (req: Request) => String(req.params.name);
  const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

  router.get("/apps", owner(async (_req, res) => void res.json(await apps.list())));

  router.post(
    "/apps/preview",
    owner(async (req, res) => {
      const { link, kit } = body(req);
      if (typeof link !== "string" || !link.trim()) throw new AppError(400, "link_required", "Paste the GitHub link to the app's Compose file.");
      res.json(await apps.preview(link, typeof kit === "string" && kit.trim() ? kit : undefined));
    }),
  );

  router.post(
    "/apps",
    owner(async (req, res, who) => {
      const { previewId, settings, reuseData } = body(req);
      if (typeof previewId !== "string") throw new AppError(400, "preview_required", "Review the app before installing it.");
      const values = (settings && typeof settings === "object" ? settings : {}) as Record<string, string>;
      const { name, jobId } = await apps.install(previewId, values, reuseData === true, who.actorId);
      res.status(202).json({ name, jobId });
    }),
  );

  router.get("/apps/:name", owner(async (req, res) => void res.json(await apps.detail(name(req)))));
  router.get(
    "/apps/:name/logs",
    owner(async (req, res) => void res.json({ lines: await apps.logs(name(req), String(req.query.service ?? "")) })),
  );
  router.post("/apps/:name/start", owner(async (req, res) => void res.status(202).json(await apps.start(name(req)))));
  router.put(
    "/apps/:name/settings",
    owner(async (req, res, who) => {
      const values = body(req).values as Record<string, string | null> | undefined;
      if (!values || typeof values !== "object") throw new AppError(400, "values_required", "Send the settings to change.");
      res.status(202).json(await apps.updateSettings(name(req), values, who.actorId));
    }),
  );
  router.put(
    "/apps/:name/limits",
    owner(async (req, res, who) => {
      const limits = body(req).limits as Record<string, { memory?: number; cpus?: number }> | undefined;
      if (!limits || typeof limits !== "object") throw new AppError(400, "limits_required", "Send the limits to change.");
      res.status(202).json(await apps.updateLimits(name(req), limits, who.actorId));
    }),
  );
  router.post(
    "/apps/:name/outbound",
    owner(async (req, res, who) => {
      const host = body(req).host;
      if (typeof host !== "string") throw new AppError(400, "host_required", "Send the host to approve.");
      res.status(202).json(await apps.approve(name(req), host, who.actorId));
    }),
  );
  router.delete(
    "/apps/:name/outbound/:host",
    owner(async (req, res, who) => void res.status(202).json(await apps.removeOutbound(name(req), String(req.params.host), who.actorId))),
  );
  router.post(
    "/apps/:name/requests/:id/approve",
    owner(async (req, res, who) => void res.status(202).json(await apps.approveRequest(name(req), String(req.params.id), who.actorId))),
  );
  router.post(
    "/apps/:name/requests/:id/dismiss",
    owner(async (req, res, who) => {
      await apps.dismissRequest(name(req), String(req.params.id), who.actorId);
      res.status(204).end();
    }),
  );
  router.post("/apps/:name/remove", owner(async (req, res, who) => void res.status(202).json(await apps.remove(name(req), who.actorId))));
  router.delete(
    "/apps/:name/data",
    owner(async (req, res, who) => {
      await apps.deleteData(name(req), String(body(req).confirm ?? ""), who.actorId);
      res.status(204).end();
    }),
  );
  router.get("/jobs/:id", owner(async (req, res) => void res.json(await apps.job(String(req.params.id)))));
  router.get("/engine", owner(async (_req, res) => void res.json(await apps.engine())));

  // Opening an app: a one-time code takes the owner's signed-in session to the app's own origin,
  // where the gate turns it into a pass. A browser follows this from the pane, so answers are
  // redirects and short pages rather than JSON.
  router.get("/apps/:name/open", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      const who = await ownerFor(auth, db, req);
      if (who === "signed_out") return void res.redirect(302, `${apps.config.publicUrl}/`);
      if (who === "forbidden") return void res.status(403).type("text").send("Only the owner can open apps.");
      if (!(await apps.isInstalled(name(req)))) return void res.status(404).type("text").send("There is no app with that name.");
      const code = handoffs.issue(name(req), who.sessionId);
      const back = safeReturn(req.query.return);
      res.redirect(302, `${apps.address(name(req)).origin}/__ys/handoff?code=${code}&return=${encodeURIComponent(back)}`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
