import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { app, installJob } from "../db/schema.ts";
import { AppError, AppsService, type AppsConfig } from "./service.ts";
import { installedGeneration } from "./upgrade-agent-kit.ts";
import { refreshRuntimeInterface, socketRuntime } from "./runtime-client.ts";

/** Operator-only refresh after attaching a route catalog. Retrying never touches a verified interface. */
export async function refreshAgentInterface(
  db: Db,
  config: AppsConfig,
  installationId: string,
  expectedKitSource: string,
  expectedInstallation: string,
): Promise<"current" | "refreshed" | "stopped"> {
  return db.transaction(async (tx) => {
    // Prevent a concurrent uninstall/reinstall or second kit update through verification.
    // A new lifecycle job references this row, so its insertion also waits for the row lock.
    const [row] = await tx.select().from(app).where(eq(app.id, installationId)).for("update");
    if (!row || row.desired === "removed" || row.state === "removed")
      throw new AppError(404, "not_found", "This app installation is no longer present.");
    if (await installedGeneration(tx, row.id) !== expectedInstallation)
      throw new AppError(409, "installation_changed", "This app was reinstalled. Inspect its current installation before refreshing.");
    if (row.kitSource !== expectedKitSource || !row.kit?.agentAccess || !row.interface)
      throw new AppError(409, "kit_changed", "The installed kit or its interface no longer matches the requested upgrade.");
    if (row.desired === "stopped") return "stopped";
    const [active] = await tx.select({ id: installJob.id }).from(installJob)
      .where(and(eq(installJob.appId, row.id), eq(installJob.state, "running"))).limit(1);
    if (active) throw new AppError(409, "app_busy", "Wait for this app's current lifecycle operation, then retry the refresh.");

    const apps = new AppsService(db, socketRuntime(), config);
    const spec = await apps.specFor(row);
    try {
      return (await refreshRuntimeInterface(spec)).status;
    } catch {
      throw new AppError(503, "interface_unavailable",
        "Your Space could not verify the running interface. Check that the app and runtime are healthy, then retry the refresh.");
    }
  });
}
