import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import { operatorActorId, recordEvent } from "../actors.ts";
import type { Db } from "../db/client.ts";
import { app, event, installJob } from "../db/schema.ts";
import { kitFromFile } from "./kits.ts";
import { AppError } from "./service.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A reinstall retaining data reuses the app UUID. Its new installation event must invalidate outstanding inspections. */
export async function installedGeneration(db: Db | Tx, appId: string): Promise<string> {
  const [last] = await db
    .select({ id: event.id, count: sql<number>`count(*) over ()` })
    .from(event)
    .where(and(eq(event.subjectAppId, appId), eq(event.type, "app.installed")))
    .orderBy(desc(event.createdAt), desc(event.id))
    .limit(1);
  const hash = createHash("sha256")
    .update([appId, last?.count ?? 0, last?.id ?? ""].join("/"))
    .digest("hex");
  return `install:${hash}`;
}

export async function inspectAgentKit(db: Db, name: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: app.id,
        kitSource: app.kitSource,
        kitVersion: sql<number | null>`(${app.kit}->>'kit')::integer`,
        desired: app.desired,
        state: app.state,
      })
      .from(app)
      .where(eq(app.name, name))
      .for("share");
    if (!row || row.state === "removed" || row.desired === "removed") {
      throw new AppError(404, "app_not_found", "No installed app has this name.");
    }
    return {
      name,
      appId: row.id,
      installation: await installedGeneration(tx, row.id),
      kitSource: row.kitSource,
      kitVersion: row.kitVersion,
    };
  });
}

/** The runtime refresh follows the metadata commit so a failure can be retried against the same kit and installation. */
export async function upgradeAgentKit(
  db: Db,
  name: string,
  expectedInstallation: string,
  expectedSource: string,
  candidate: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: app.id,
        state: app.state,
        desired: app.desired,
        kit: app.kit,
        kitSource: app.kitSource,
        interface: app.interface,
        repo: app.repo,
        path: app.path,
      })
      .from(app)
      .where(eq(app.name, name))
      .for("update");
    if (!row || row.state === "removed" || row.desired === "removed") {
      throw new AppError(404, "app_not_found", "No installed app has this name.");
    }
    const installation = await installedGeneration(tx, row.id);
    if (
      installation !== expectedInstallation ||
      row.kitSource !== expectedSource ||
      !/^sha256:[a-f0-9]{64}$/.test(expectedSource)
    ) {
      throw new AppError(409, "upgrade_conflict", "The installation or its pinned local kit differs. Inspect the app again.");
    }
    if (row.kit?.kit !== 1 || row.kit.agentAccess !== undefined || !row.interface) {
      throw new AppError(409, "upgrade_conflict", "The app needs a pinned version 1 kit and a registered interface.");
    }
    const [busy] = await tx
      .select({ id: installJob.id })
      .from(installJob)
      .where(and(eq(installJob.appId, row.id), eq(installJob.state, "running")))
      .limit(1);
    if (busy || row.state === "installing" || row.state === "starting") {
      throw new AppError(409, "upgrade_conflict", "Wait for the app's current operation to finish.");
    }
    const found = kitFromFile(candidate, row.repo ? { repo: row.repo, path: row.path } : null);
    if (found.kit.kit !== 2 || !found.kit.agentAccess) {
      throw new AppError(400, "invalid_kit", "Supply a version 2 kit with agentAccess.");
    }
    // Both sides contain parsed kit fields, including normalized units and defaults.
    const { agentAccess, ...fields } = found.kit;
    if (!isDeepStrictEqual({ ...fields, kit: 1 }, row.kit)) {
      throw new AppError(
        409,
        "upgrade_conflict",
        "Only the kit version and agentAccess may change. Keep the installed kit's other fields.",
      );
    }
    await tx
      .update(app)
      .set({ kit: { ...row.kit, kit: 2, agentAccess }, kitSource: found.source, updatedAt: new Date() })
      .where(eq(app.id, row.id));
    await recordEvent(tx, "app.agent_kit_upgraded", await operatorActorId(tx), null, row.id);
    return {
      name,
      appId: row.id,
      installation,
      previousKitSource: expectedSource,
      kitSource: found.source,
      kitVersion: 2 as const,
    };
  });
}
