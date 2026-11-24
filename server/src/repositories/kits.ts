import { Router } from "express";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import { AppsService, AppError } from "../apps/service.ts";

function kitLink(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new AppError(400, "invalid_kit_source", "Paste the GitHub link to the app's kit, like https://github.com/owner/repo/blob/main/kit.yaml.");
  }
  return value;
}

/**
 * The review of an app from its kit's link: the only way the web client installs an app (decision
 * 2026-11-23). It reads public GitHub, as the server command does; a kit in a private repository
 * installs from this machine with the server command instead.
 */
export function kitRoutes(auth: Auth, db: Db, apps: AppsService) {
  const router = Router();
  router.all("/preview", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      const owner = await ownerFor(auth, db, req);
      if (typeof owner === "string")
        throw new AppError(owner === "signed_out" ? 401 : 403, owner, "Sign in as the workspace owner.");
      if (req.method !== "POST") {
        next();
        return;
      }
      if (!req.is("application/json") || req.get("origin") !== new URL(auth.options.baseURL as string).origin)
        throw new AppError(403, "forbidden", "Open the kit from the signed-in workspace.");
      const kitUrl: unknown = req.body?.kitUrl;
      res.json(
        await apps.preview({ link: kitLink(kitUrl) }).catch((error: unknown) => {
          if (error instanceof AppError && error.code === "kit_not_found") {
            throw new AppError(
              404,
              error.code,
              `${error.message} If the kit is in a private repository, install it from this machine with the server command: docker compose exec -T server install-app --kit - < kit.yaml.`,
            );
          }
          throw error;
        }),
      );
    } catch (error) {
      if (error instanceof AppError) res.status(error.status).json({ error: error.code, message: error.message });
      else next(error);
    }
  });
  return router;
}
