// Your Space's own tables (T011, data-model.md): whether the owner exists, actors, and events.
import type { SavedView } from "../../../shared/workspace-layout/model.mjs";
import type { Theme } from "../../../shared/appearance/theme.mjs";
import type { AgentAccess } from "../apps/agent-kit.ts";
import type { FileRead } from "../apps/github.ts";
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
  | "app.data_deleted"
  | "knowledge.created"
  | "knowledge.retitled"
  | "knowledge.deleted"
  | "knowledge.granted"
  | "knowledge.revoked";

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
  /**
   * The app's Compose file on GitHub, at the exact commit Your Space reads it at. Required, except in a
   * kit given with a Compose file on this machine. Kits stored before 2026-11-23 may lack `commit`.
   */
  source?: { repo: string; path: string; commit?: string };
  name?: string;
  title?: string;
  interface?: { service: string; port: number };
  pane?: boolean;
  /** The app's whole environment: each variable, and where its value comes from (2026-11-23). */
  env?: Record<string, EnvSource>;
  outbound?: string[];
  /** Memory in bytes, parsed from the kit's 512M or 1G. */
  limits?: Record<string, { memory?: number; cpus?: number }>;
  /** The app asks for knowledge bases, which Your Space mounts at `<path>/<name>` (journey 014). */
  knowledge?: { path: string };
}

/** Where a variable in a kit's `env` gets its value. */
export type EnvSource =
  /** A value the kit gives, which the owner can change. */
  | string
  /** Generated when the app is installed; a secret. */
  | { generate: { bytes: number; encoding: "hex" | "base64url" } }
  /** The app's address, or a template built from other variables, like `postgresql://u:${POSTGRES_PASSWORD}@db/app`. */
  | { derive: "app_origin" | "app_host" | { template: string } }
  /** Given by the owner: `true` when the install needs it, `optional` when it doesn't. */
  | { ask: true | "optional"; secret: boolean };

/**
 * A kit as an installed app keeps it. One stored before kits named the app's environment in `env`
 * (2026-11-23) has these fields instead, which `kitEnv` reads as `env`.
 */
export interface StoredKit extends Kit {
  generate?: Record<string, { bytes?: number; encoding?: "hex" | "base64url" }>;
  derive?: Record<string, "app_origin" | "app_host" | { template: string }>;
  set?: Record<string, string>;
  secrets?: string[];
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

/**
 * How an app's kit and its Compose file were each read from GitHub (journey 015, R4): anonymously, or
 * through the GitHub connection with the account the token belonged to. A kit given on this machine
 * wasn't read from GitHub, so it has none.
 */
export interface Provenance {
  kit: FileRead | null;
  /** Null only for a Compose file given on this machine, which no command gives any more. */
  compose: FileRead | null;
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
    kit: jsonb("kit").$type<StoredKit>(),
    kitSource: text("kit_source"),
    /** Null for an app installed before journey 015. */
    provenance: jsonb("provenance").$type<Provenance>(),
    /** Each image's pinned digest; `private` marks one pulled with the registry credential (journey 015, R9). */
    images: jsonb("images").$type<Record<string, { digest: string; private?: true }>>().notNull(),
    adaptations: jsonb("adaptations").$type<Adaptation[]>().notNull(),
    interface: jsonb("interface").$type<{ service: string; port: number }>(),
    pane: boolean("pane").notNull().default(true),
    publish: jsonb("publish").$type<Publish>(),
    /** Whether Your Space shows the app in its pane when it is published with a link (decision 2026-11-20). */
    // Since the owner's "Show inside Your Space" switch left (2026-11-23, Alpha scope), only the
    // server's start reads it: an app left with it off is applied once and set to true.
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

// Knowledge bases (journey 014): named volumes that belong to Your Space, which the owner gives to apps.

export const knowledgeBase = pgTable(
  "knowledge_base",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Fixed once it is created: its folder's name in every app given it, and its volume's. */
    name: text("name").notNull().unique(),
    title: text("title").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("knowledge_base_name_valid", sql`${t.name} ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'`)],
);

/**
 * The knowledge base an event is about. A table of its own rather than a column of `event`, which
 * keeps the shape every earlier schema has: the upgrade tests write and read events at schema 0005.
 * Deleting the knowledge base removes the link; the event stays.
 */
export const eventKnowledgeBase = pgTable("event_knowledge_base", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => event.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id")
    .notNull()
    .references(() => knowledgeBase.id, { onDelete: "cascade" }),
});

/** A knowledge base the owner gave an app. Removing the app, or deleting the knowledge base, ends it. */
export const appKnowledgeBase = pgTable(
  "app_knowledge_base",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.knowledgeBaseId] })],
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
  /** Unset since spec 017: the credentials are in agent_credential. */
  credential: text("credential"),
  enabledRoles: text("enabled_roles").array().notNull(),
  kitDigest: text("kit_digest").notNull(),
  /** Earliest request revision admitted under the present upstream authority. */
  credentialRevision: integer("credential_revision").notNull().default(1),
  revision: integer("revision").notNull(),
});
/**
 * The app credentials bound to an installation, one per name its kit declares (spec 017): a kit with
 * one `credential` has one, named by its binding. Encrypted under the data key and moved by its rotation.
 */
export const agentCredential = pgTable(
  "agent_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => agentBinding.appId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    credential: text("credential").notNull(),
  },
  (t) => [unique("agent_credential_name").on(t.appId, t.name)],
);
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
    // Unread since 2026-11-23: Ask for all writes is gone (spec 017); new grants store false.
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
    // Unset since 2026-11-23: Your Space keeps no operation ID (spec 017).
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
  mode: text("mode", { enum: ["system", "light", "dark"] }).notNull().default("system"),
  themes: jsonb("themes").$type<{ id: string; theme: Theme }[]>().notNull(),
}, (t) => [check("workspace_appearance_mode_valid", sql`${t.mode} in ('system', 'light', 'dark')`)]);

/**
 * The workspace's source credential (journey 015): what lets Your Space read a file it can't read
 * anonymously. Its first adapter is a fine-grained GitHub token with Contents read, which the owner
 * pastes. One per workspace (R6).
 */
export const sourceCredential = pgTable("source_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().unique().references(() => organization.id, { onDelete: "cascade" }),
  /** AES-256-GCM ciphertext under the data key (spec 009); never returned or logged. */
  token: text("token").notNull(),
  /** The account GitHub said the token belongs to, the last time it answered. */
  account: text("account").notNull(),
  /** When GitHub last accepted the token. */
  workedAt: timestamp("worked_at", { withTimezone: true }).notNull(),
  /** When GitHub refused the token on its latest use; null while it works. */
  refusedAt: timestamp("refused_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The workspace's registry credential (journey 015, decision 4): what lets the engine pull an image a
 * registry won't give anonymously. Its first adapter is the GitHub connection's optional image token,
 * a classic token with only `read:packages`, for `ghcr.io`. A slot of its own, apart from the source
 * credential, so either can be added, replaced or removed alone. One per workspace (R6).
 */
export const registryCredential = pgTable("registry_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().unique().references(() => organization.id, { onDelete: "cascade" }),
  /** AES-256-GCM ciphertext under the data key (spec 009); never returned or logged. */
  token: text("token").notNull(),
  /** The account GitHub said the token belongs to, the last time it answered. */
  account: text("account").notNull(),
  /** When the token last worked: GitHub accepted it, or the registry gave an image with it. */
  workedAt: timestamp("worked_at", { withTimezone: true }).notNull(),
  /** When GitHub refused the token, the last time it was asked; null while it works. */
  refusedAt: timestamp("refused_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ownerLayout = pgTable("owner_layout", {
  workspaceId: uuid("workspace_id").notNull().references(() => organization.id, {onDelete:"cascade"}),
  ownerId: uuid("owner_id").notNull().references(() => actor.id, {onDelete:"cascade"}),
  revision: integer("revision").notNull(),
  appOrder: jsonb("app_order").$type<string[]>().notNull(),
  views: jsonb("views").$type<SavedView[]>().notNull(),
}, t => [primaryKey({columns:[t.workspaceId,t.ownerId]})]);
