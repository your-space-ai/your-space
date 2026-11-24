import { Router } from "express";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import { AppsService, AppError } from "../apps/service.ts";
import { getGithubClient } from "./connection.ts";
import { publicGithubClient } from "./github.ts";
import { catalog, previewKitUrl } from "./sources.ts";

function kitLink(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new AppError(400, "invalid_kit_source", "Paste the GitHub link to the app's kit, like https://github.com/owner/repo/blob/main/kit.yaml.");
  }
  return value;
}

/**
 * The kit directory's listing, and the review of an app from its kit's link: the only way the web
 * client installs an app (decision 2026-11-23). With the owner's GitHub connection, the kit is read
 * through it, which reaches a kit in a private repository when the connection has private access.
 * Without one, Your Space reads a public kit as the server command does.
 */
export function kitRoutes(auth: Auth, db: Db, dataKey: string, apps: AppsService) {
  const router = Router();
  router.all(["/catalog", "/preview"], async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      const owner = await ownerFor(auth, db, req);
      if (typeof owner === "string")
        throw new AppError(owner === "signed_out" ? 401 : 403, owner, "Sign in as the workspace owner.");
      const listing = req.method === "GET" && req.path === "/catalog";
      if (!listing && !(req.method === "POST" && req.path === "/preview")) {
        next();
        return;
      }
      if (
        !listing &&
        (!req.is("application/json") || req.get("origin") !== new URL(auth.options.baseURL as string).origin)
      )
        throw new AppError(403, "forbidden", "Open the kit from the signed-in workspace.");
      const connected = await getGithubClient(db, owner.actorId, dataKey).catch((error) => {
        if (error instanceof AppError && error.code === "github_not_connected") return null;
        throw error;
      });
      const kitUrl: unknown = req.body?.kitUrl;
      res.json(
        listing
          ? await catalog(connected ?? publicGithubClient(), apps.config.kitsRepository)
          : connected
            ? await previewKitUrl(connected, apps, kitUrl)
            : await apps.preview({ link: kitLink(kitUrl) }).catch((error: unknown) => {
                if (error instanceof AppError && error.code === "kit_not_found") {
                  throw new AppError(404, error.code, `${error.message} If the kit is in a private repository, connect GitHub with private repositories included, on the GitHub page, then paste its link again.`);
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
