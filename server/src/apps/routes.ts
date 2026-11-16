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
      const { previewId, settings } = body(req);
      if (typeof previewId !== "string") throw new AppError(400, "preview_required", "Review the app before installing it.");
      if (settings !== undefined && (typeof settings !== "object" || settings === null || Array.isArray(settings))) {
        throw new AppError(400, "invalid_setting", "Settings must be names with text values.");
      }
      const values = (settings ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(values)) {
        if (typeof value !== "string") throw new AppError(400, "invalid_setting", `${key} must be text.`);
      }
      const { name, jobId } = await apps.install(previewId, values as Record<string, string>, who.actorId);
      res.status(202).json({ name, jobId });
    }),
  );

  router.get("/apps/:name", owner(async (req, res) => void res.json(await apps.detail(name(req)))));
  router.post("/apps/:name/start", owner(async (req, res) => void res.status(202).json(await apps.start(name(req)))));
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
