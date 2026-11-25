// Synced knowledge bases (journey 014, decision 2026-11-25 "Knowledge bases"): a knowledge base kept
// in two-way sync with a Google Drive folder. The owner sets up the Google connection once, with the
// operator's own OAuth client, and connects knowledge bases to folders; the runtime manager runs each
// sync with rclone bisync (runtime/src/sync.ts). Your Space syncs every five minutes while it runs and
// when the owner asks, one run per knowledge base at a time. A run that stops for safety waits for the
// owner. Connecting, disconnecting, resyncing and applying deletions are the owner's; each run is
// Your Space's own.
import { asc, eq } from "drizzle-orm";
import { operatorActorId, recordEvent } from "../actors.ts";
import { googleConnection, knowledgeBase, knowledgeSync, type SyncDeletion } from "../db/schema.ts";
import { errorFields, log } from "../log.ts";
import { authorizationUrl, exchangeCode, folderIdOf, GoogleError, googleEndpoints, redirectUri, SignIns, type GoogleEndpoints } from "./google.ts";
import { RuntimeError, type SyncRequest, type SyncRunResult } from "./runtime-client.ts";
import { AppError, type AppsService } from "./service.ts";
import { decrypt, encrypt } from "./settings.ts";

/** Your Space syncs every connected knowledge base this often while it runs. */
export const SYNC_INTERVAL_MS = 5 * 60_000;
/**
 * The most deletions a stopped run keeps for the owner to confirm, all of them, as the runtime manager
 * compares them with its dry run. A run that lists more stops with reason `too_many`, and can't be
 * applied from the page.
 */
export const MAX_DELETIONS = 10_000;
/** The deletions a sync's status shows; the owner confirms them all by the run that listed them. */
export const SHOWN_DELETIONS = 500;

const CLIENT_ID = /^[A-Za-z0-9._-]{8,300}$/;
const CLIENT_SECRET = /^[\x21-\x7e]{8,300}$/;

type SyncRow = typeof knowledgeSync.$inferSelect;
type Mode = SyncRequest["mode"];

/** What the owner sees of a knowledge base's sync. */
export interface SyncStatus {
  folderId: string;
  folderUrl: string;
  connectedAt: Date;
  running: boolean;
  /** The next run copies both ways and deletes nothing. */
  firstRun: boolean;
  /** The Google connection can't be used until the owner signs in again. */
  disconnected: boolean;
  lastRunAt: Date | null;
  lastSyncedAt: Date | null;
  result: SyncRow["result"];
  reason: string | null;
  side: SyncRow["side"];
  /** What happened, for the owner. */
  summary: string | null;
  /** What rclone said, for a run that didn't sync. */
  detail: string | null;
  /** The first of the deletions a stopped run listed, up to SHOWN_DELETIONS. */
  deletions: SyncDeletion[];
  /** How many deletions it listed, by the side each file was deleted on; Apply these deletions makes them all. */
  deletionCounts: { local: number; remote: number };
  conflicts: string[];
  backups: SyncRow["backups"];
  ties: string[];
}

const where = (side: SyncRow["side"], local: string, remote: string) => (side === "remote" ? remote : local);

/** The owner's words for how a run ended. */
export function summaryOf(row: Pick<SyncRow, "result" | "reason" | "side">): string | null {
  switch (row.result) {
    case null:
      return null;
    case "synced":
      return "Synced.";
    case "unauthorized":
      return "Google refused Your Space's access to Drive, so the sync stopped. Reconnect to sign in again; the files stay, and apps keep working on the local copy.";
    case "failed":
      return "The sync didn't finish. Your Space tries again at the next sync.";
    case "stopped":
      switch (row.reason) {
        case "max_delete":
          return `More than half of the files were deleted ${where(row.side, "in the knowledge base", "in the Drive folder")} since the last sync, so it stopped and deleted nothing ${where(row.side, "in Drive", "here")}. Resync brings them back from the other side; Apply these deletions deletes them there too.`;
        case "changed":
          return "The files to delete changed since you confirmed them, so nothing was deleted. Check the new list.";
        case "too_many":
          return `More than half of the files were deleted ${where(row.side, "in the knowledge base", "in the Drive folder")} since the last sync, over ${MAX_DELETIONS.toLocaleString("en-US")} of them, so it stopped and deleted nothing ${where(row.side, "in Drive", "here")}. That is more than Your Space can list for you to confirm. Resync brings them back from the other side; to delete them, delete them ${where(row.side, "in the Drive folder", "here")} too.`;
        case "empty":
          return `The ${where(row.side, "knowledge base", "Drive folder")} is empty, so the sync stopped rather than delete everything on the other side. Resync copies the files back and deletes nothing.`;
        case "marker":
          return `Your Space's marker file, .your-space-sync, is missing ${where(row.side, "in the knowledge base", "in the Drive folder")}, so the sync stopped: the folder may have been emptied, replaced or moved. Resync puts the marker back and copies both ways, deleting nothing.`;
        default:
          return "The sync stopped and needs a resync, which copies both ways and deletes nothing.";
      }
  }
  return null;
}

const instances = new WeakMap<AppsService, KnowledgeSync>();

export class KnowledgeSync {
  readonly apps: AppsService;
  readonly signIns = new SignIns();
  /** Runs under way, by knowledge base; a Sync now during one runs once more after it. */
  private readonly runs = new Map<string, Promise<void>>();
  private readonly again = new Map<string, Promise<void>>();
  /** Knowledge bases being deleted, connected or disconnected: no run starts for them meanwhile. */
  private readonly held = new Set<string>();

  /** The one sync service of the apps service, which the routes and the schedule share. */
  static for(apps: AppsService): KnowledgeSync {
    let sync = instances.get(apps);
    if (!sync) instances.set(apps, (sync = new KnowledgeSync(apps)));
    return sync;
  }

  constructor(apps: AppsService) {
    this.apps = apps;
  }

  private get db() {
    return this.apps.db;
  }

  private get endpoints(): GoogleEndpoints {
    return this.apps.config.google ?? googleEndpoints();
  }

  private async connection() {
    return (await this.db.select().from(googleConnection).where(eq(googleConnection.id, 1)))[0];
  }

  /** Whether a knowledge base syncs now, or has a run waiting for the one under way. */
  isRunning(knowledgeBaseId: string): boolean {
    return this.runs.has(knowledgeBaseId) || this.again.has(knowledgeBaseId);
  }

  /**
   * Holds a knowledge base off the schedule and the owner's runs while it is deleted, connected or
   * disconnected; false while it syncs or something else holds it. The caller checks and holds with
   * no wait between the two, and releases it when done.
   */
  hold(knowledgeBaseId: string): boolean {
    if (this.isRunning(knowledgeBaseId) || this.held.has(knowledgeBaseId)) return false;
    this.held.add(knowledgeBaseId);
    return true;
  }

  release(knowledgeBaseId: string): void {
    this.held.delete(knowledgeBaseId);
  }

  /** Whether a knowledge base is held, as `hold` holds it. */
  isHeld(knowledgeBaseId: string): boolean {
    return this.held.has(knowledgeBaseId);
  }

  // The Google connection.

  async google() {
    const row = await this.connection();
    const connected = (await this.db.select({ id: knowledgeSync.knowledgeBaseId }).from(knowledgeSync)).length;
    return {
      redirectUri: redirectUri(this.apps.config.publicUrl),
      clientId: row?.clientId ?? null,
      state: !row ? "not_set_up" : !row.token ? "signed_out" : row.problem ? "disconnected" : "connected",
      problem: row?.problem ?? null,
      connectedAt: row?.connectedAt ?? null,
      knowledgeBases: connected,
    };
  }

  /**
   * Saves the operator's OAuth client. The secret is encrypted with the data key and never shown
   * again. A token belongs to its client, so the owner signs in again after any change.
   */
  async saveClient(input: Record<string, unknown>, actorId: string) {
    const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
    const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";
    if (!CLIENT_ID.test(clientId)) throw new AppError(400, "bad_client_id", "Paste the client ID of the OAuth client, like 1234-abcd.apps.googleusercontent.com.");
    if (!CLIENT_SECRET.test(clientSecret)) throw new AppError(400, "bad_client_secret", "Paste the client secret of the OAuth client.");
    const secret = encrypt(this.apps.config.dataKey, clientSecret);
    await this.db.transaction(async (tx) => {
      await tx
        .insert(googleConnection)
        .values({ id: 1, clientId, clientSecret: secret, createdBy: actorId })
        .onConflictDoUpdate({ target: googleConnection.id, set: { clientId, clientSecret: secret, token: null, problem: null, connectedAt: null, updatedAt: new Date() } });
      await recordEvent(tx, "google.client_saved", actorId, null);
    });
    log("info", "google.client_saved", {});
    return this.google();
  }

  /** Forgets the Google connection. Refused while a knowledge base syncs through it. */
  async removeGoogle(actorId: string): Promise<void> {
    const synced = await this.db.select({ title: knowledgeBase.title }).from(knowledgeSync).innerJoin(knowledgeBase, eq(knowledgeSync.knowledgeBaseId, knowledgeBase.id)).orderBy(asc(knowledgeBase.title));
    if (synced.length > 0) {
      throw new AppError(409, "in_use", `Disconnect ${synced.map((s) => s.title).join(", ")} from Drive first: ${synced.length === 1 ? "it syncs" : "they sync"} through this connection.`);
    }
    await this.db.transaction(async (tx) => {
      const removed = await tx.delete(googleConnection).returning({ id: googleConnection.id });
      if (removed.length) await recordEvent(tx, "google.removed", actorId, null);
    });
  }

  /** Google's sign-in page, for the owner's session. */
  async authorize(sessionId: string): Promise<{ url: string }> {
    const row = await this.connection();
    if (!row) throw new AppError(409, "not_set_up", "Save the OAuth client's ID and secret first.");
    const { state, challenge } = this.signIns.start(sessionId);
    return { url: authorizationUrl(this.endpoints, { clientId: row.clientId, redirectUri: redirectUri(this.apps.config.publicUrl), state, challenge }) };
  }

  /**
   * Google sent the owner back: the state must be one this session started. The server exchanges the
   * code, with the PKCE verifier, and keeps the token encrypted with the data key. Answers what the
   * Knowledge page says about it.
   */
  async finishSignIn(query: Record<string, unknown>, who: { sessionId: string; actorId: string }): Promise<"connected" | "expired" | "denied" | "refused" | "no_drive" | "unreadable"> {
    const verifier = this.signIns.finish(typeof query.state === "string" ? query.state : "", who.sessionId);
    if (!verifier) return "expired";
    if (query.error !== undefined) return query.error === "access_denied" ? "denied" : "refused";
    const code = typeof query.code === "string" ? query.code : "";
    const row = await this.connection();
    if (!row || !code) return "expired";
    let clientSecret: string;
    try {
      clientSecret = decrypt(this.apps.config.dataKey, row.clientSecret);
    } catch {
      return "unreadable";
    }
    let token: string;
    try {
      token = await exchangeCode(
        this.endpoints,
        { code, verifier, clientId: row.clientId, clientSecret, redirectUri: redirectUri(this.apps.config.publicUrl) },
        this.apps.config.fetch ?? fetch,
      );
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      log("warn", "google.sign_in_refused", { code: error.code });
      return error.code === "no_drive" ? "no_drive" : "refused";
    }
    await this.db.transaction(async (tx) => {
      await tx.update(googleConnection).set({ token: encrypt(this.apps.config.dataKey, token), problem: null, connectedAt: new Date(), updatedAt: new Date() }).where(eq(googleConnection.id, 1));
      await recordEvent(tx, "google.connected", who.actorId, null);
    });
    log("info", "google.connected", {});
    return "connected";
  }

  // Knowledge bases' syncs.

  /** The sync of each knowledge base that has one. */
  async statuses(): Promise<Map<string, SyncStatus>> {
    const connection = await this.connection();
    const disconnected = !connection?.token || connection.problem !== null;
    const rows = await this.db.select().from(knowledgeSync);
    return new Map(rows.map((row) => [row.knowledgeBaseId, this.status(row, disconnected)]));
  }

  private status(row: SyncRow, disconnected: boolean): SyncStatus {
    return {
      folderId: row.folderId,
      folderUrl: `https://drive.google.com/drive/folders/${row.folderId}`,
      connectedAt: row.connectedAt,
      running: this.isRunning(row.knowledgeBaseId),
      firstRun: row.resync,
      disconnected,
      lastRunAt: row.lastRunAt,
      lastSyncedAt: row.lastSyncedAt,
      result: row.result,
      reason: row.reason,
      side: row.side,
      summary: summaryOf(row),
      detail: row.result === "synced" ? null : row.message,
      deletions: row.deletions.slice(0, SHOWN_DELETIONS),
      deletionCounts: { local: row.deletions.filter((d) => d.side === "local").length, remote: row.deletions.filter((d) => d.side === "remote").length },
      conflicts: row.conflicts,
      backups: row.backups,
      ties: row.ties,
    };
  }

  private async knowledgeRow(name: string) {
    const row = (await this.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, name)))[0];
    if (!row) throw new AppError(404, "not_found", "There is no knowledge base with that name.");
    return row;
  }

  private async syncRow(knowledgeBaseId: string) {
    return (await this.db.select().from(knowledgeSync).where(eq(knowledgeSync.knowledgeBaseId, knowledgeBaseId)))[0];
  }

  /** The Google connection, ready for a run, or why it isn't. */
  private async usableConnection() {
    const row = await this.connection();
    if (!row) throw new AppError(409, "google_not_set_up", "Set up the Google Drive connection on the Knowledge page first.");
    if (!row.token) throw new AppError(409, "google_signed_out", "Sign in with Google on the Knowledge page first.");
    if (row.problem) throw new AppError(409, "google_disconnected", "Google refused Your Space's access to Drive. Reconnect on the Knowledge page first.");
    return row;
  }

  /**
   * Connects a knowledge base to a Drive folder, given by its link. Your Space starts with a resync,
   * which copies both ways and deletes nothing. The body names only the folder: the remote is always
   * Google Drive, through the Google connection.
   */
  async connect(name: string, input: Record<string, unknown>, actorId: string) {
    const base = await this.knowledgeRow(name);
    const unknown = Object.keys(input).filter((key) => key !== "folder");
    if (unknown.length > 0) throw new AppError(400, "unknown_field", `A knowledge base connects to a Drive folder only: ${unknown.join(", ")} isn't a field.`);
    const folderId = typeof input.folder === "string" ? folderIdOf(input.folder) : undefined;
    if (!folderId) throw new AppError(400, "bad_folder", "Paste the link of a Google Drive folder, like https://drive.google.com/drive/folders/1AbC…, as Drive shows it in the address bar or under Share.");
    await this.usableConnection();
    if (!this.hold(base.id)) throw new AppError(409, "busy", "The knowledge base is syncing, or being deleted or disconnected. Try again when that finishes.");
    try {
      if (await this.syncRow(base.id)) throw new AppError(409, "already_connected", "This knowledge base is connected already. Disconnect it first to sync another folder.");
      // No earlier connection's state can read as deletions against this folder.
      await this.apps.runtime.removeSync(name).catch((error: unknown) => {
        throw new AppError(409, error instanceof RuntimeError ? error.code : "busy", error instanceof Error ? error.message : "The knowledge base's earlier sync can't be removed.");
      });
      await this.db.transaction(async (tx) => {
        await tx.insert(knowledgeSync).values({ knowledgeBaseId: base.id, folderId, connectedBy: actorId });
        await recordEvent(tx, "knowledge.connected", actorId, null, null, { id: base.id, name: base.name });
      });
    } finally {
      this.release(base.id);
    }
    const row = (await this.syncRow(base.id))!;
    this.launch(base.id, base.name, "resync");
    return this.status(row, false);
  }

  /** Disconnects a knowledge base: its sync state goes, and both it and the Drive folder keep their files. */
  async disconnect(name: string, actorId: string): Promise<void> {
    const base = await this.knowledgeRow(name);
    if (!(await this.syncRow(base.id))) throw new AppError(404, "not_connected", "This knowledge base isn't connected to Drive.");
    if (this.isRunning(base.id)) throw new AppError(409, "busy", "The knowledge base is syncing. Disconnect it when the sync finishes.");
    if (!this.hold(base.id)) throw new AppError(409, "busy", "The knowledge base is being deleted or disconnected already.");
    try {
      await this.apps.runtime.removeSync(name).catch((error: unknown) => {
        throw new AppError(error instanceof RuntimeError && error.status === 409 ? 409 : 503, error instanceof RuntimeError ? error.code : "runtime_error", error instanceof Error ? error.message : "The sync can't be removed.");
      });
      await this.db.transaction(async (tx) => {
        await tx.delete(knowledgeSync).where(eq(knowledgeSync.knowledgeBaseId, base.id));
        await recordEvent(tx, "knowledge.disconnected", actorId, null, null, { id: base.id, name: base.name });
      });
    } finally {
      this.release(base.id);
    }
  }

  /**
   * The owner's actions: Sync now, which runs once more after a run under way; Resync, which copies
   * both ways and deletes nothing; and Apply these deletions, every one a stopped run listed, which the
   * owner confirmed by that run and their number. Answers once the run has started; `done` settles
   * when it ends.
   */
  async start(name: string, input: Record<string, unknown>, actorId: string): Promise<{ done: Promise<void> }> {
    const base = await this.knowledgeRow(name);
    const row = await this.syncRow(base.id);
    if (!row) throw new AppError(404, "not_connected", "This knowledge base isn't connected to Drive.");
    await this.usableConnection();
    if (this.held.has(base.id)) throw new AppError(409, "busy", "The knowledge base is being deleted, connected or disconnected.");
    const action = input.action;
    if (action === "sync") {
      const waiting = this.again.get(base.id);
      if (waiting) return { done: waiting };
      const current = this.runs.get(base.id);
      if (!current) return { done: this.launch(base.id, base.name, row.resync ? "resync" : "sync") };
      // A file changed just now may have missed the run under way, so one more follows it. It counts
      // as running until that one ends, so the owner never sees a gap between the two.
      const next = current
        .then(async () => {
          const latest = await this.syncRow(base.id);
          return latest ? this.launch(base.id, base.name, latest.resync ? "resync" : "sync") : undefined;
        })
        .catch((error: unknown) => log("warn", "knowledge.sync_failed", { name: base.name, ...errorFields(error) }))
        .finally(() => this.again.delete(base.id));
      this.again.set(base.id, next);
      return { done: next };
    }
    if (this.isRunning(base.id)) throw new AppError(409, "busy", "The knowledge base is syncing. Try again when the sync finishes.");
    if (action === "resync") {
      await recordEvent(this.db, "knowledge.resync_requested", actorId, null, null, { id: base.id, name: base.name });
      return { done: this.launch(base.id, base.name, "resync") };
    }
    if (action === "apply_deletions") {
      if (row.result !== "stopped" || (row.reason !== "max_delete" && row.reason !== "changed") || row.deletions.length === 0) {
        throw new AppError(409, "no_deletions", "There are no deletions waiting for you to confirm.");
      }
      // The owner confirms the deletions of the run they saw, by its time and their number; the runtime
      // manager gets every one of them, and makes them only if its dry run lists exactly those.
      const { run, count } = input;
      if (typeof run !== "string" || typeof count !== "number" || !Number.isInteger(count)) {
        throw new AppError(400, "deletions_required", "Send the run whose deletions you confirmed, and how many there are.");
      }
      if (!row.lastRunAt || Date.parse(run) !== row.lastRunAt.getTime() || count !== row.deletions.length) {
        throw new AppError(409, "deletions_changed", "The deletions waiting changed since you looked, so nothing was deleted. Check the new list.");
      }
      return { done: this.launch(base.id, base.name, "force", row.deletions, actorId) };
    }
    throw new AppError(400, "bad_action", "The action must be sync, resync or apply_deletions.");
  }

  /** Every connected knowledge base's run, one after another; a stopped one waits for the owner. */
  async scheduled(): Promise<void> {
    const connection = await this.connection();
    if (!connection?.token || connection.problem) return;
    const rows = await this.db
      .select({ id: knowledgeBase.id, name: knowledgeBase.name, result: knowledgeSync.result, resync: knowledgeSync.resync })
      .from(knowledgeSync)
      .innerJoin(knowledgeBase, eq(knowledgeSync.knowledgeBaseId, knowledgeBase.id))
      .orderBy(asc(knowledgeBase.name));
    for (const row of rows) {
      if (row.result === "stopped" || this.isRunning(row.id) || this.held.has(row.id)) continue;
      await this.launch(row.id, row.name, row.resync ? "resync" : "sync");
    }
  }

  /** Starts a run of the knowledge base, which no other run of it is under way for; none while it is held. */
  private launch(id: string, name: string, mode: Mode, confirm?: SyncDeletion[], confirmedBy?: string): Promise<void> {
    if (this.held.has(id)) return Promise.resolve();
    const run = this.execute(id, name, mode, confirm, confirmedBy)
      .catch((error: unknown) => log("warn", "knowledge.sync_failed", { name, ...errorFields(error) }))
      .finally(() => this.runs.delete(id));
    this.runs.set(id, run);
    return run;
  }

  private async execute(id: string, name: string, mode: Mode, confirm?: SyncDeletion[], confirmedBy?: string): Promise<void> {
    const connection = await this.connection();
    const row = await this.syncRow(id);
    if (!row || !connection?.token || connection.problem) return;
    const startedAt = new Date();
    let outcome: SyncRunResult;
    let clientSecret: string;
    let token: string;
    try {
      clientSecret = decrypt(this.apps.config.dataKey, connection.clientSecret);
      token = decrypt(this.apps.config.dataKey, connection.token);
    } catch {
      outcome = failure("The Google connection can't be read with Your Space's data key. Set up the Google Drive connection again on the Knowledge page.");
      return this.record(id, name, row, mode, startedAt, outcome, confirmedBy);
    }
    try {
      outcome = await this.apps.runtime.syncKnowledge(name, { remote: { type: "drive", clientId: connection.clientId, clientSecret, token, folderId: row.folderId }, mode, ...(confirm ? { confirm } : {}) });
    } catch (error) {
      outcome = failure(error instanceof RuntimeError ? error.message : "The runtime manager couldn't run the sync.");
    }
    if (outcome.result === "busy") return;
    await this.record(id, name, row, mode, startedAt, outcome, confirmedBy);
  }

  /** Keeps a run's result on the knowledge base's sync, and records it against Your Space. */
  private async record(id: string, name: string, before: SyncRow, mode: Mode, startedAt: Date, outcome: SyncRunResult, confirmedBy?: string): Promise<void> {
    const synced = outcome.result === "synced";
    // More deletions than the owner can confirm: the run stays stopped, and none of them is kept.
    const tooMany = outcome.result === "stopped" && outcome.deletions.length > MAX_DELETIONS;
    const yourSpace = await operatorActorId(this.db);
    const subject = { id, name };
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(knowledgeSync)
        .set({
          lastRunAt: startedAt,
          result: outcome.result as SyncRow["result"],
          reason: tooMany ? "too_many" : (outcome.reason ?? null),
          side: outcome.side ?? null,
          message: outcome.message?.slice(0, 1000) ?? null,
          // Every one of them, which the owner confirms and the runtime manager compares with its dry run.
          deletions: outcome.result === "stopped" && !tooMany ? outcome.deletions : [],
          ...(outcome.listed ? { conflicts: outcome.conflicts.slice(0, 500), backups: outcome.backups.slice(0, 500) } : {}),
          ...(synced ? { lastSyncedAt: new Date() } : {}),
          ...(synced && mode === "resync" ? { resync: false, ties: outcome.ties.slice(0, 500) } : {}),
        })
        .where(eq(knowledgeSync.knowledgeBaseId, id))
        .returning({ id: knowledgeSync.knowledgeBaseId });
      // Disconnected while it ran: nothing is kept.
      if (updated.length === 0) return;
      if (synced && mode === "force" && confirmedBy) await recordEvent(tx, "knowledge.deletions_applied", confirmedBy, null, null, subject);
      if (synced && outcome.changed) await recordEvent(tx, "knowledge.synced", yourSpace, null, null, subject);
      if (outcome.result === "stopped") await recordEvent(tx, "knowledge.sync_stopped", yourSpace, null, null, subject);
      // A run that keeps failing, as while offline, is recorded once.
      if (outcome.result === "failed" && before.result !== "failed") await recordEvent(tx, "knowledge.sync_failed", yourSpace, null, null, subject);
      if (outcome.result === "unauthorized") {
        const refused = await tx
          .update(googleConnection)
          .set({ problem: outcome.message?.slice(0, 500) ?? "Google refused the token.", updatedAt: new Date() })
          .where(eq(googleConnection.id, 1))
          .returning({ id: googleConnection.id });
        if (refused.length) await recordEvent(tx, "google.refused", yourSpace, null);
      }
    });
    log(synced ? "info" : "warn", "knowledge.synced", { name, mode, result: outcome.result, reason: outcome.reason, changed: outcome.changed });
  }
}

function failure(message: string): SyncRunResult {
  return { result: "failed", message, deletions: [], ties: [], conflicts: [], backups: [], changed: false };
}
