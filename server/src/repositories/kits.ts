import { Router } from "express";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { ownerFor } from "../apps/routes.ts";
import { AppsService, AppError } from "../apps/service.ts";
import { getGithubClient } from "./connection.ts";
import { publicGithubClient } from "./github.ts";
import { catalog, previewKitUrl } from "./sources.ts";

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
      res.json(
        listing
          ? await catalog(connected ?? publicGithubClient(), apps.config.kitsRepository)
          : await previewKitUrl(db, owner.actorId, connected, apps, req.body?.kitUrl),
      );
    } catch (error) {
      if (error instanceof AppError) res.status(error.status).json({ error: error.code, message: error.message });
      else next(error);
    }
  });
  return router;
}
