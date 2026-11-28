// Rollback of an update (journey 019, decision 3): before an update changes an app, what it replaces
// is kept on the update's job, in the same transaction; an update that doesn't start, or that a
// restart interrupts, is put back from it. The app's own data isn't: Your Space keeps no copy of an
// app's volumes.
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { app, appOutbound, appSetting, installJob, type UpdateSnapshot } from "../db/schema.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** What an update of the app is about to replace. */
export async function snapshotOf(tx: Tx, row: typeof app.$inferSelect, actorId: string): Promise<UpdateSnapshot> {
  const settings = await tx
    .select({ name: appSetting.name, value: appSetting.value, secret: appSetting.secret, generated: appSetting.generated, publishedDefault: appSetting.publishedDefault })
    .from(appSetting)
    .where(eq(appSetting.appId, row.id));
  const outbound = await tx
    .select({ host: appOutbound.host, approvedBy: appOutbound.approvedBy, createdAt: appOutbound.createdAt })
    .from(appOutbound)
    .where(and(eq(appOutbound.appId, row.id), eq(appOutbound.source, "kit")));
  const { title, sourceUrl, repo, path, ref, commit, compose, kit, kitSource, kitLink, provenance, images, adaptations, interface: iface, pane, limits, desired } = row;
  return {
    actorId,
    app: { title, sourceUrl, repo, path, ref, commit, compose, kit, kitSource, kitLink, provenance, images, adaptations, interface: iface, pane, limits, desired },
    settings,
    outbound: outbound.map((o) => ({ host: o.host, approvedBy: o.approvedBy, createdAt: o.createdAt.toISOString() })),
  };
}

/** Puts back what an update replaced: the app's row, its settings as stored, and its kit's hosts. */
export async function restore(tx: Tx, appId: string, snapshot: UpdateSnapshot): Promise<void> {
  await tx.update(app).set({ ...snapshot.app, updatedAt: new Date() }).where(eq(app.id, appId));
  await tx.delete(appSetting).where(eq(appSetting.appId, appId));
  if (snapshot.settings.length) await tx.insert(appSetting).values(snapshot.settings.map((s) => ({ appId, ...s })));
  await tx.delete(appOutbound).where(and(eq(appOutbound.appId, appId), eq(appOutbound.source, "kit")));
  if (snapshot.outbound.length) {
    // Each keeps the date it was approved.
    await tx
      .insert(appOutbound)
      .values(snapshot.outbound.map((o) => ({ appId, host: o.host, source: "kit" as const, approvedBy: o.approvedBy, ...(o.createdAt ? { createdAt: new Date(o.createdAt) } : {}) })))
      .onConflictDoNothing();
  }
}

/**
 * At start, before stored settings move to a new data key: each update a restart interrupted is put
 * back, so the app never starts on a kit whose update didn't finish. Its job ends as failed, and the
 * app waits for the owner to start it again, as any change a restart interrupts does.
 */
export async function restoreInterruptedUpdates(db: Db): Promise<string[]> {
  return db.transaction(async (tx) => {
    const jobs = await tx
      .select({ id: installJob.id, appId: installJob.appId, rollback: installJob.rollback })
      .from(installJob)
      .where(and(eq(installJob.kind, "update"), isNotNull(installJob.rollback)))
      .for("update");
    for (const job of jobs) {
      await restore(tx, job.appId, job.rollback!);
      await tx
        .update(installJob)
        .set({ state: "failed", error: "Interrupted by a restart of Your Space, and rolled back.", rollback: null, finishedAt: new Date() })
        .where(eq(installJob.id, job.id));
      // The server starts the app again with the kit it ran before, which replaces the update's
      // containers, before anything records their state as the app's.
      await tx
        .update(app)
        .set({ state: "starting", stateReason: "The update was interrupted by a restart of Your Space and rolled back." })
        .where(eq(app.id, job.appId));
    }
    return jobs.map((job) => job.appId);
  });
}
