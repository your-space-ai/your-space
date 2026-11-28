// The owner-only apps API (component I, FR-010, contracts/http-api.md).
import { and, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ensureHumanActor } from "../actors.ts";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { member } from "../db/auth-schema.ts";
import { installation } from "../db/schema.ts";
import { safeReturn, type Handoffs } from "./gate.ts";
import { AppError, type AppsService } from "./service.ts";

interface Owner {
  sessionId: string;
  actorId: string;
}

export async function ownerFor(auth: Auth, db: Db, req: Request): Promise<Owner | "signed_out" | "forbidden"> {
  const current = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!current) return "signed_out";
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(installation, eq(member.organizationId, installation.workspaceId))
    .where(and(eq(installation.state,"claimed"), eq(member.userId, current.user.id), eq(member.role, "owner")))
    .limit(1);
  if (!rows[0]) return "forbidden";
  return { sessionId: current.session.id, actorId: await ensureHumanActor(db, current.user.id) };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function blockedPage(url: string): string {
  const href = escapeHtml(url);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Open in its own tab</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.3rem">This browser won't run the app here</h1>
<p>It blocks the app's cookies inside Your Space, so the app can't keep you signed in. It works in its own tab.</p>
<p><a href="${href}" target="_blank" rel="noopener" data-ys-own-tab>Open in its own tab</a></p></body></html>`;
}

type Handler = (req: Request, res: Response, owner: Owner) => Promise<void>;

export function appRoutes(auth: Auth, db: Db, apps: AppsService, handoffs: Handoffs): Router {
  const router = Router();
  const publicOrigin = new URL(apps.config.publicUrl).origin;

  const owner = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    try {
      const who = await ownerFor(auth, db, req);
      if (who === "signed_out") return void res.status(401).json({ error: "signed_out", message: "Sign in to Your Space first." });
      if (who === "forbidden") return void res.status(403).json({ error: "forbidden", message: "Only the owner can manage apps." });
      // Apps live under Your Space's host, so the browser sends the owner's session with a request
      // from an app's page too. A change counts only from Your Space's own pages, which browsers say
      // in the Origin header; a request without one is refused like any other.
      if (req.method !== "GET" && req.method !== "HEAD" && req.get("origin") !== publicOrigin) {
        return void res.status(403).json({ error: "forbidden", message: "Manage apps from Your Space itself." });
      }
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

  // An app is reviewed from its kit's link at POST /api/kits/preview (repositories/kits.ts), which
  // reads public GitHub, and a private kit or Compose file through the GitHub connection (journey 015).

  router.post(
    "/apps",
    owner(async (req, res, who) => {
      const { previewId, settings, reuseData, publish } = body(req);
      if (typeof previewId !== "string") throw new AppError(400, "preview_required", "Review the app before installing it.");
      if (settings !== undefined && (typeof settings !== "object" || settings === null || Array.isArray(settings))) {
        throw new AppError(400, "invalid_setting", "Settings must be names with text values.");
      }
      const values = (settings ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(values)) {
        if (typeof value !== "string") throw new AppError(400, "invalid_setting", `${key} must be text.`);
      }
      const { name, jobId } = await apps.install(previewId, values as Record<string, string>, reuseData === true, who.actorId, publish ?? null);
      res.status(202).json({ name, jobId });
    }),
  );

  router.get("/apps/:name", owner(async (req, res) => void res.json(await apps.detail(name(req)))));
  router.get(
    "/apps/:name/logs",
    owner(async (req, res) => void res.json({ lines: await apps.logs(name(req), String(req.query.service ?? "")) })),
  );
  router.post("/apps/:name/start", owner(async (req, res) => void res.status(202).json(await apps.start(name(req)))));
  // Journey 019: check an installed app's kit for an update, then apply the reviewed one in place.
  router.post(
    "/apps/:name/update/check",
    owner(async (req, res) => {
      // Opening the app's page sends `auto`: checked at most every 12 hours (decision 4).
      if (body(req).auto === true) {
        const review = await apps.autoCheckUpdate(name(req));
        res.json(review ?? { skipped: true });
        return;
      }
      res.json(await apps.previewUpdate(name(req)));
    }),
  );
  router.post(
    "/apps/:name/update",
    owner(async (req, res, who) => {
      const { previewId, settings, digest } = body(req);
      if (typeof previewId !== "string") throw new AppError(400, "preview_required", "Check for the update before applying it.");
      if (digest !== undefined && typeof digest !== "string") throw new AppError(400, "invalid_digest", "The review's digest must be text.");
      if (settings !== undefined && (typeof settings !== "object" || settings === null || Array.isArray(settings))) {
        throw new AppError(400, "invalid_setting", "Settings must be names with text values.");
      }
      const values = (settings ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(values)) {
        if (typeof value !== "string") throw new AppError(400, "invalid_setting", `${key} must be text.`);
      }
      const { jobId } = await apps.applyUpdate(name(req), previewId, values as Record<string, string>, who.actorId, digest);
      res.status(202).json({ name: name(req), jobId });
    }),
  );
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
  router.put(
    "/apps/:name/publish",
    owner(async (req, res, who) => {
      const { publish } = body(req);
      if (publish === undefined) throw new AppError(400, "publish_required", "Send how to publish the app, or null to stop publishing it.");
      res.status(202).json(await apps.updatePublish(name(req), publish, who.actorId));
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
      const back = safeReturn(req.query.return);
      const origin = apps.address(name(req)).origin;
      // Only a pane can loop: browsers say so with Sec-Fetch-Dest, and an app's own tab always proceeds.
      if (req.get("sec-fetch-dest") === "iframe" && handoffs.looping(name(req), who.sessionId)) {
        // In a pane whose cookies the browser blocks, every request starts over. Its own tab works.
        res.status(200).type("html").send(blockedPage(`${origin}${back}`));
        return;
      }
      const code = handoffs.issue(name(req), who.sessionId);
      res.set("Referrer-Policy", "no-referrer");
      res.redirect(302, `${origin}/__ys/handoff?code=${code}&return=${encodeURIComponent(back)}`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
