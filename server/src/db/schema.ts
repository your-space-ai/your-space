// Your Space's own tables (T011, data-model.md): whether the owner exists, actors, and events.
import type { SavedView } from "../../../shared/workspace-layout/model.mjs";
import type { Theme } from "../../../shared/appearance/theme.mjs";
import type { AgentAccess } from "../apps/agent-kit.ts";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  subjectAppId: uuid("subject_app_id").references(() => app.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventType =
  | "owner.created"
  | "recovery.link_issued"
  | "recovery.password_reset"
  | "app.installed"
  | "app.agent_kit_upgraded"
  | "app.settings_changed"
  | "app.limits_changed"
  | "app.outbound_approved"
  | "app.outbound_removed"
  | "app.request_dismissed"
  | "app.publish_changed"
  | "app.removed"
  | "app.data_deleted";

// Apps (journey 002, data-model.md).

export type AppState = "installing" | "starting" | "running" | "degraded" | "stopped" | "failed" | "removed";

export interface Adaptation {
  service: string;
  kind: "changed" | "left_out" | "added";
  detail: string;
}

export interface Kit {
  kit: 1 | 2;
  agentAccess?: AgentAccess;
  /** Verified independently by the registry lookup; never accepted in kit YAML. */
  agentReview?: { source: string };
  /** The app's file on GitHub that the kit fits; a kit for a Compose file given on this machine may leave it out. */
  source?: { repo: string; path: string };
  name?: string;
  title?: string;
  interface?: { service: string; port: number };
  pane?: boolean;
  generate?: Record<string, { bytes?: number; encoding?: "hex" | "base64url" }>;
  /** The app's address, or a template built from other settings the kit names, like `postgresql://u:${POSTGRES_PASSWORD}@db/app`. */
  derive?: Record<string, "app_origin" | "app_host" | { template: string }>;
  /** Values the app's own example settings give, which its file leaves empty. The owner can change them. */
  set?: Record<string, string>;
  /** Settings the owner gives, which the app can't run without; the install needs a value for each. */
  required?: string[];
  secrets?: string[];
  outbound?: string[];
  /** Memory in bytes, parsed from the kit's 512M or 1G. */
  limits?: Record<string, { memory?: number; cpus?: number }>;
}

/**
 * An app published on a port of this machine, for the owner's own network setup to reach (decision
 * 2026-11-19). `link` is the address the owner reaches it at; its address settings follow it.
 */
export interface Publish {
  port: number;
  /** The IP address the port listens on: 127.0.0.1 unless the owner chose another. */
  bind: string;
  link: string | null;
}

export const app = pgTable(
  "app",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    title: text("title").notNull(),
    sourceUrl: text("source_url").notNull(),
    repo: text("repo").notNull(),
    path: text("path").notNull(),
    ref: text("ref").notNull(),
    commit: text("commit").notNull(),
    compose: text("compose").notNull(),
    kit: jsonb("kit").$type<Kit>(),
    kitSource: text("kit_source"),
    images: jsonb("images").$type<Record<string, { digest: string }>>().notNull(),
    adaptations: jsonb("adaptations").$type<Adaptation[]>().notNull(),
    interface: jsonb("interface").$type<{ service: string; port: number }>(),
    pane: boolean("pane").notNull().default(true),
    publish: jsonb("publish").$type<Publish>(),
    /** Whether Your Space shows the app in its pane when it is published with a link (decision 2026-11-20). */
    frame: boolean("frame").notNull().default(true),
    limits: jsonb("limits").$type<Record<string, { memory: number; cpus: number }>>().notNull(),
    desired: text("desired", { enum: ["running", "stopped", "removed"] }).notNull().default("running"),
    state: text("state", { enum: ["installing", "starting", "running", "degraded", "stopped", "failed", "removed"] })
      .notNull()
      .default("installing"),
    stateReason: text("state_reason"),
    installedBy: uuid("installed_by")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    check("app_name_valid", sql`${t.name} ~ '^[a-z][a-z0-9-]{0,29}$'`),
    check("app_desired_valid", sql`${t.desired} in ('running', 'stopped', 'removed')`),
    check(
      "app_state_valid",
      sql`${t.state} in ('installing', 'starting', 'running', 'degraded', 'stopped', 'failed', 'removed')`,
    ),
  ],
);

export const appSetting = pgTable(
  "app_setting",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** AES-256-GCM ciphertext; null when unset. */
    value: text("value"),
    secret: boolean("secret").notNull().default(false),
    generated: boolean("generated").notNull().default(false),
    publishedDefault: text("published_default"),
  },
  (t) => [primaryKey({ columns: [t.appId, t.name] })],
);

export const appOutbound = pgTable(
  "app_outbound",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    source: text("source", { enum: ["kit", "owner"] }).notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.host] })],
);

export const appAccessRequest = pgTable(
  "app_access_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    state: text("state", { enum: ["pending", "dismissed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("app_access_request_app_host").on(t.appId, t.host)],
);

export interface JobStep {
  at: string;
  message: string;
}

export const installJob = pgTable("install_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: uuid("app_id")
    .notNull()
    .references(() => app.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["install", "apply", "remove"] }).notNull(),
  state: text("state", { enum: ["running", "succeeded", "failed"] }).notNull().default("running"),
  steps: jsonb("steps").$type<JobStep[]>().notNull().default([]),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// External agents are actors; ownership remains a separate human identity.
export const externalAgent = pgTable("external_agent", {
  id: uuid("id")
    .primaryKey()
    .references(() => actor.id),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => actor.id),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  disabled: boolean("disabled").notNull().default(false),
});
export const agentKey = pgTable("agent_key", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => externalAgent.id),
  verifier: text("verifier").unique().notNull(),
  revoked: boolean("revoked").notNull().default(false),
});
export const agentBinding = pgTable("agent_binding", {
  appId: uuid("app_id")
    .primaryKey()
    .references(() => app.id, { onDelete: "cascade" }),
  credential: text("credential"),
  enabledRoles: text("enabled_roles").array().notNull(),
  kitDigest: text("kit_digest").notNull(),
  /** Earliest request revision admitted under the present upstream authority. */
  credentialRevision: integer("credential_revision").notNull().default(1),
  revision: integer("revision").notNull(),
});
export const agentGrant = pgTable(
  "agent_grant",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => agentBinding.appId, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => externalAgent.id),
    roles: text("roles").array().notNull(),
    askAllWrites: boolean("ask_all_writes").notNull(),
    overrides: jsonb("overrides").notNull(),
    revision: integer("revision").notNull(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.agentId] })],
);
export const agentRequest = pgTable(
  "agent_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => externalAgent.id),
    keyId: uuid("key_id")
      .notNull()
      .references(() => agentKey.id),
    appId: uuid("app_id").notNull(),
    route: text("route").notNull(),
    operationId: text("operation_id"),
    fingerprint: text("fingerprint"),
    input: text("input"),
    result: text("result"),
    status: text("status").notNull(),
    bindingRevision: integer("binding_revision").notNull(),
    grantRevision: integer("grant_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    unique("agent_operation").on(t.agentId, t.appId, t.route, t.operationId),
    index("agent_denied_samples").on(t.agentId, t.createdAt.desc(), t.id.desc()).where(sql`${t.status} = 'denied'`),
  ],
);

/** The owner's saved themes share one revision across edits and selection. An absent row uses the platform default. */
export const workspaceAppearance = pgTable("workspace_appearance", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  activeId: text("active_id").notNull(),
  themes: jsonb("themes").$type<{ id: string; theme: Theme }[]>().notNull(),
});

/** An absent selection always opens the built-in Home. Grants are bound to the installed target's revision. */
export const workspaceHome = pgTable("workspace_home", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  selectedId: uuid("selected_id").references(() => app.id, { onDelete: "set null" }),
  generation: text("generation"),
  revision: integer("revision").notNull(),
  grants: jsonb("grants").$type<{ installationId: string; bindingRevision: number; roles: string[] }[]>().notNull(),
});

/** Last successful read per delegated route, without copies of request data, results, or credentials. */
export const homeReadActivity = pgTable("home_read_activity", {
  homeId: uuid("home_id").notNull().references(() => app.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => app.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => actor.id),
  lastRead: timestamp("last_read", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.homeId, t.targetId, t.action] })]);

/** A replacement preview pins an exact artifact and the installed source it may replace. Keep only source files
 * and image pins here. Runtime settings, credentials, volume contents and results stay with the installation. */
export const appReplacement = pgTable("app_replacement", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => app.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => actor.id),
  repoId: text("repo_id").notNull(),
  baseFingerprint: text("base_fingerprint").notNull(),
  original: jsonb("original").notNull(),
  candidate: jsonb("candidate").notNull(),
  state: text("state", {enum:["preview","applying","applied","failed"]}).notNull().default("preview"),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
}, t => [index("app_replacement_installation").on(t.appId, t.createdAt)]);

export const githubConnection = pgTable("github_connection", {
  ownerId: uuid("owner_id").primaryKey().references(() => actor.id, {onDelete:"cascade"}),
  githubUserId: text("github_user_id").notNull(),
  login: text("login").notNull(),
  credential: text("credential").notNull(),
  scope: text("scope").notNull(),
});
export const githubDevice = pgTable("github_device", {
  ownerId: uuid("owner_id").primaryKey().references(() => actor.id,{onDelete:"cascade"}),
  sessionId: text("session_id").notNull(),
  attemptId: uuid("attempt_id").notNull(),
  deviceCode: text("device_code").notNull(),
  expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
  nextPollAt: timestamp("next_poll_at",{withTimezone:true}).notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  scope: text("scope").notNull(),
});
export const managedRepository = pgTable("managed_repository", {
  ownerId: uuid("owner_id").notNull().references(() => actor.id,{onDelete:"cascade"}),
  accountId: text("account_id").notNull(),
  repoId: text("repo_id").notNull(),
  fullName: text("full_name").notNull(),
  origin: text("origin",{enum:["created","forked","imported"]}).notNull(),
  defaultBranch: text("default_branch").notNull(),
  private: boolean("private").notNull(),
}, t => [primaryKey({columns:[t.ownerId,t.accountId,t.repoId]})]);
export const repositoryGrant = pgTable("repository_grant", {
  ownerId: uuid("owner_id").notNull().references(() => githubConnection.ownerId,{onDelete:"cascade"}),
  accountId: text("account_id").notNull(),
  agentId: uuid("agent_id").notNull().references(() => externalAgent.id,{onDelete:"cascade"}),
  canCreate: boolean("can_create").notNull(),
  canFork: boolean("can_fork").notNull(),
  repoIds: text("repo_ids").array().notNull(),
  revision: integer("revision").notNull().default(1),
},t => [primaryKey({columns:[t.ownerId,t.accountId,t.agentId]})]);
export const ownerLayout = pgTable("owner_layout", {
  workspaceId: uuid("workspace_id").notNull().references(() => organization.id, {onDelete:"cascade"}),
  ownerId: uuid("owner_id").notNull().references(() => actor.id, {onDelete:"cascade"}),
  revision: integer("revision").notNull(),
  appOrder: jsonb("app_order").$type<string[]>().notNull(),
  views: jsonb("views").$type<SavedView[]>().notNull(),
}, t => [primaryKey({columns:[t.workspaceId,t.ownerId]})]);
