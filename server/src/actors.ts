// Actors and events (FR-025, cross-cutting scenario 7). The full activity log is spec 005.
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { actor, event, type EventType } from "./db/schema.ts";
import { errorFields, log } from "./log.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** The actor for actions taken from the server's command line. The first migration creates it. */
export async function operatorActorId(db: Executor): Promise<string> {
  const rows = await db.select({ id: actor.id }).from(actor).where(eq(actor.kind, "operator")).limit(1);
  const row = rows[0];
  if (!row) throw new Error("The operator actor is missing; migrations have not run.");
  return row.id;
}

export async function humanActorId(db: Executor, userId: string): Promise<string | undefined> {
  const rows = await db.select({ id: actor.id }).from(actor).where(eq(actor.userId, userId)).limit(1);
  return rows[0]?.id;
}

export async function ensureHumanActor(db: Executor, userId: string): Promise<string> {
  const existing = await humanActorId(db, userId);
  if (existing) return existing;
  const rows = await db.insert(actor).values({ kind: "human", userId }).returning({ id: actor.id });
  return rows[0]!.id;
}

export async function recordEvent(
  db: Executor,
  type: EventType,
  actorId: string,
  subjectUserId: string | null,
): Promise<void> {
  await db.insert(event).values({ type, actorId, subjectUserId });
}

/**
 * Better Auth calls this after a password reset completes (T049). The reset is already done, so a
 * failure to record it is logged rather than reported to the person as a failed reset.
 */
export async function recordPasswordReset(db: Db, userId: string): Promise<void> {
  try {
    const actorId = await humanActorId(db, userId);
    if (!actorId) {
      log("warn", "event.actor_missing", { type: "recovery.password_reset" });
      return;
    }
    await recordEvent(db, "recovery.password_reset", actorId, userId);
  } catch (error) {
    log("error", "event.record_failed", { type: "recovery.password_reset", ...errorFields(error) });
  }
}
