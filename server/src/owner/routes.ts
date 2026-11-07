// GET /api/status and GET /api/health (T029, contracts/http-api.md).
import { Router } from "express";
import type { Db } from "../db/client.ts";
import { errorFields, log } from "../log.ts";
import { readInstallationState, StorageUnavailable } from "./installation.ts";

export function ownerRoutes(db: Db): Router {
  const router = Router();

  router.get("/status", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const state = await readInstallationState(db);
      res.json({ owner: state === "claimed" });
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) log("error", "status.failed", errorFields(error));
      res.status(503).json({ state: "storage_unavailable" });
    }
  });

  router.get("/health", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await readInstallationState(db);
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "storage_unavailable" });
    }
  });

  return router;
}
