// The owner-only apps API (component I, FR-010, contracts/http-api.md).
import { and, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ensureHumanActor } from "../actors.ts";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { member } from "../db/auth-schema.ts";
import { AppError, type AppsService } from "./service.ts";

interface Owner {
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
  return { actorId: await ensureHumanActor(db, current.user.id) };
}

type Handler = (req: Request, res: Response, owner: Owner) => Promise<void>;

export function appRoutes(auth: Auth, db: Db, apps: AppsService): Router {
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

  return router;
}
