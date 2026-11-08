// Your Space's own tables (T011, data-model.md): whether the owner exists, actors, and events.
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.ts";

/** Exactly one row, created by the first migration. Owner existence is read from it, never inferred. */
export const installation = pgTable(
  "installation",
  {
    id: smallint("id").primaryKey().default(1),
    state: text("state", { enum: ["unclaimed", "claimed"] }).notNull().default("unclaimed"),
    workspaceId: uuid("workspace_id").references(() => organization.id, { onDelete: "restrict" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [
    check("installation_single_row", sql`${t.id} = 1`),
    check("installation_state_valid", sql`${t.state} in ('unclaimed', 'claimed')`),
    check(
      "installation_claimed_complete",
      sql`${t.state} <> 'claimed' or (${t.workspaceId} is not null and ${t.claimedAt} is not null)`,
    ),
  ],
);

/** The stable identity that records credit (FR-025). Records point here, never straight at `user`. */
export const actor = pgTable(
  "actor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["human", "operator", "agent"] }).notNull(),
    userId: uuid("user_id")
      .unique()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("actor_kind_valid", sql`${t.kind} in ('human', 'operator', 'agent')`),
    check("actor_human_has_user", sql`${t.kind} <> 'human' or ${t.userId} is not null`),
    uniqueIndex("actor_single_operator").on(t.kind).where(sql`${t.kind} = 'operator'`),
  ],
);

/** A minimal record of owner-creation and recovery actions. Never stores secrets. */
export const event = pgTable("event", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => actor.id, { onDelete: "restrict" }),
  subjectUserId: uuid("subject_user_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventType = "owner.created" | "recovery.link_issued" | "recovery.password_reset";
