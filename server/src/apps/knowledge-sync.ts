// Synced knowledge bases (journey 014, decision 2026-11-25 "Knowledge bases"): a knowledge base kept
// in two-way sync with a Google Drive folder. The owner sets up the Google connection once, with the
// operator's own OAuth client, and connects knowledge bases to folders. A long-running container of
// stock `rclone rcd` for each, which the runtime manager runs (runtime/src/sync.ts), syncs it; the
// server drives each over its socket (rclone.ts): it creates the knowledge base's remote there, with
// the client and token, which stay in rclone's memory, and starts each bisync there as a job in the
// background. A container mounts its own knowledge base only, so no sync writes into another's.
//
// About once a minute for each knowledge base, and at once on the owner's Sync now, Resync or Apply
// these deletions, the server starts a run. Each knowledge base has its own turn: its runs never
// overlap, as the server starts none while one is under way, and bisync's lock is the backstop; the
// knowledge bases' runs go on side by side. rclone keeps a single log for its whole process while a
// bisync runs, and the server reads each run's deletions, ties and reason from it, so each rclone runs
// one bisync at a time. A run's job is kept on its knowledge base's row, so a server that restarts
// meanwhile reads its result from rclone, which keeps it for an hour, and records it. A run that stops
// for safety waits for the owner. Connecting, disconnecting, resyncing and applying deletions are the
// owner's; each run is Your Space's own.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { operatorActorId, recordEvent } from "../actors.ts";
import { googleConnection, knowledgeBase, knowledgeSync, type SyncDeletion, type SyncJob, type SyncRequested } from "../db/schema.ts";
import { errorFields, log } from "../log.ts";
import {
  backupRuns,
  backupsOf,
  backupsPath,
  bisyncParams,
  changedBy,
  conflictsOf,
  deletionsOf,
  LISTED,
  localPath,
  logLines,
  outcome,
  remoteConfig,
  remoteName,
  runFolder,
  sameDeletions,
  SYNC_MARKER,
  tieCopyParams,
  tiesOf,
  TIES_PER_COPY,
  type Backup,
  type Listed,
  type LogLine,
  type Outcome,
  type SyncMode,
} from "./bisync.ts";
import { authorizationUrl, exchangeCode, folderIdOf, GoogleError, googleEndpoints, redirectUri, SignIns, type GoogleEndpoints } from "./google.ts";
import { RcError, socketRcs, type Rc, type RcFor, type RcJob } from "./rclone.ts";
import { RuntimeError } from "./runtime-client.ts";
import { AppError, type AppsService } from "./service.ts";
import { decrypt, encrypt } from "./settings.ts";

/** Your Space syncs every connected knowledge base about this often while it runs. */
export const SYNC_INTERVAL_MS = 60_000;
/**
 * A run that takes longer is stopped by restarting its knowledge base's rclone, as Ctrl+C stops it; it
 * is recorded as failed, and the next run carries on from there.
 */
export const RUN_LIMIT_MS = 2 * 60 * 60_000;
/** A knowledge base's rclone that hasn't answered for this long, as one hung, is restarted. */
export const UNREACHABLE_MS = 60_000;
/**
 * The most deletions a stopped run keeps for the owner to confirm, all of them, as the server compares
 * them with its dry run. A run that lists more stops with reason `too_many`, and can't be applied from
 * the page.
 */
export const MAX_DELETIONS = 10_000;
/** The deletions a sync's status shows; the owner confirms them all by the run that listed them. */
export const SHOWN_DELETIONS = 500;
/** A dry run older than this, as when the server restarted after it, is run again before deletions are applied. */
const PREVIEW_FRESH_MS = 30_000;
/** The conflict copies and backups of a knowledge base whose runs change nothing are listed again this often. */
const LIST_EVERY_MS = 60 * 60_000;
/** How long after the sync's containers couldn't be started the server tries again, or after a run past its time it restarts its rclone again. */
const SERVICE_RETRY_MS = 15_000;

const CLIENT_ID = /^[A-Za-z0-9._-]{8,300}$/;
const CLIENT_SECRET = /^[\x21-\x7e]{8,300}$/;

type SyncRow = typeof knowledgeSync.$inferSelect;

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

type Connection = typeof googleConnection.$inferSelect;
type Row = SyncRow & { name: string };

export class KnowledgeSync {
  readonly apps: AppsService;
  readonly signIns = new SignIns();
  /** Each knowledge base's rclone, by its name. */
  readonly rcFor: RcFor;
  readonly intervalMs: number;
  /** Knowledge bases being deleted, connected or disconnected: no run starts for them meanwhile. */
  private readonly held = new Set<string>();
  /** Knowledge bases being deleted or disconnected, which leave the sync. */
  private readonly leaving = new Set<string>();
  /** Changes to the sync's containers, one at a time: the timer's, and connecting, disconnecting or deleting a knowledge base. */
  private serviceTurn: Promise<unknown> = Promise.resolve();
  /** How many changes to the containers are waiting or under way: the timer leaves them alone meanwhile. */
  private serviceBusy = 0;
  /** Each knowledge base's steps, one at a time: its run starting or followed, or an owner's action. */
  private readonly turns = new Map<string, Promise<unknown>>();
  /** A knowledge base's step waiting for its turn: ticks meanwhile wait for it, rather than each for its own. */
  private readonly queuedSteps = new Map<string, Promise<void>>();
  /** A tick that hasn't started yet: ticks asked for meanwhile are that one. */
  private queuedTick: Promise<void> | undefined;
  /** The knowledge bases whose containers were last started, and whether the sync is the browser tests'. */
  private service: { bases: string[]; fixture: boolean } | undefined;
  /** When starting the containers last failed: it is tried again only after SERVICE_RETRY_MS. */
  private serviceFailed = 0;
  /** Since when each knowledge base's rclone hasn't answered. */
  private readonly unreachableSince = new Map<string, number>();
  /** When the server last restarted each knowledge base's rclone for a run past its time. */
  private readonly limitedAt = new Map<string, number>();
  /** The remotes made in rclone, by knowledge base: which rclone, and for which connection and folder. */
  private readonly remotes = new Map<string, { executeId: string; version: string; connectedAt: string | null }>();
  /** When each knowledge base's conflict copies and backups were last listed. */
  private readonly listedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  /** Set once the server stops: nothing starts after it, and runs under way go on in rclone. */
  private closed = false;

  /** The one sync of the apps service, which the routes and the timer share. */
  static for(apps: AppsService): KnowledgeSync {
    let sync = instances.get(apps);
    if (!sync) instances.set(apps, (sync = new KnowledgeSync(apps)));
    return sync;
  }

  constructor(apps: AppsService) {
    this.apps = apps;
    this.rcFor = apps.config.rclone ?? socketRcs();
    this.intervalMs = apps.config.syncIntervalMs ?? SYNC_INTERVAL_MS;
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

  /** Runs `work` in the knowledge base's turn: one step of it at a time, whatever the others do. */
  private inTurnOf<T>(knowledgeBaseId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.turns.get(knowledgeBaseId) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.turns.set(knowledgeBaseId, next);
    void next.catch(() => undefined).then(() => {
      if (this.turns.get(knowledgeBaseId) === next) this.turns.delete(knowledgeBaseId);
    });
    return next;
  }

  /** Runs `work` in the containers' turn: one change to them at a time. */
  private inServiceTurn<T>(work: () => Promise<T>): Promise<T> {
    this.serviceBusy++;
    const next = this.serviceTurn
      .catch(() => undefined)
      .then(work)
      .finally(() => this.serviceBusy--);
    this.serviceTurn = next;
    return next;
  }

  /**
   * Holds a knowledge base off the timer and the owner's runs while it is deleted, connected or
   * disconnected; false while something else holds it. The caller releases it when done.
   */
  hold(knowledgeBaseId: string): boolean {
    if (this.held.has(knowledgeBaseId)) return false;
    this.held.add(knowledgeBaseId);
    return true;
  }

  release(knowledgeBaseId: string): void {
    this.held.delete(knowledgeBaseId);
    this.leaving.delete(knowledgeBaseId);
  }

  /** Whether a knowledge base is held, as `hold` holds it. */
  isHeld(knowledgeBaseId: string): boolean {
    return this.held.has(knowledgeBaseId);
  }

  /** Starts the timer: a tick every few seconds, which follows each run under way or starts the next. */
  startTimer(): void {
    const every = Math.max(250, Math.min(2_000, Math.floor(this.intervalMs / 4)));
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref?.();
    void this.tick();
  }

  /**
   * For the server's stop: no run starts from now on, and the steps in their turns end first. Runs
   * under way go on in rclone; the next server reads their results.
   */
  async close(waitMs = 5_000): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    let timer: NodeJS.Timeout | undefined;
    const steps = Promise.all([this.serviceTurn, ...this.turns.values()].map((t) => t.catch(() => undefined)));
    await Promise.race([steps, new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]).finally(() => clearTimeout(timer));
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
    // rclone forgets the remotes made with the earlier client: its secret, the token and the access
    // tokens rclone renewed. The next sign-in's runs make them again.
    await this.forgetRemotes();
    return this.google();
  }

  /**
   * Forgets the Google connection. Refused while a knowledge base syncs through it. The connection is
   * locked first, as a connect locks it before saving its sync, so a connect under way is saved before
   * the check and one after finds no connection.
   */
  async removeGoogle(actorId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = await tx.select({ id: googleConnection.id }).from(googleConnection).where(eq(googleConnection.id, 1)).for("update");
      const synced = await tx.select({ title: knowledgeBase.title }).from(knowledgeSync).innerJoin(knowledgeBase, eq(knowledgeSync.knowledgeBaseId, knowledgeBase.id)).orderBy(asc(knowledgeBase.title));
      if (synced.length > 0) {
        throw new AppError(409, "in_use", `Disconnect ${synced.map((s) => s.title).join(", ")} from Drive first: ${synced.length === 1 ? "it syncs" : "they sync"} through this connection.`);
      }
      if (locked.length === 0) return;
      await tx.delete(googleConnection).where(eq(googleConnection.id, 1));
      await recordEvent(tx, "google.removed", actorId, null);
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
    // Kept only for the client it was signed in with: a client saved or removed during the exchange
    // makes it the sign-in of a client that is gone.
    const saved = await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(googleConnection)
        .set({ token: encrypt(this.apps.config.dataKey, token), problem: null, connectedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(googleConnection.id, 1), eq(googleConnection.clientId, row.clientId), eq(googleConnection.clientSecret, row.clientSecret)))
        .returning({ id: googleConnection.id });
      if (updated.length === 0) return false;
      await recordEvent(tx, "google.connected", who.actorId, null);
      return true;
    });
    if (!saved) {
      log("warn", "google.sign_in_outdated", {});
      return "expired";
    }
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
      // A run the owner asked for waits while the connection can't be used.
      running: Boolean(row.job || (row.requested && !disconnected)),
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

  /** Every synced knowledge base, by name. */
  private async rows(): Promise<Row[]> {
    const rows = await this.db.select({ sync: knowledgeSync, name: knowledgeBase.name }).from(knowledgeSync).innerJoin(knowledgeBase, eq(knowledgeSync.knowledgeBaseId, knowledgeBase.id)).orderBy(asc(knowledgeBase.name));
    return rows.map((r) => ({ ...r.sync, name: r.name }));
  }

  /** One synced knowledge base, by its ID, with its name. */
  private async rowOf(knowledgeBaseId: string): Promise<Row | undefined> {
    const rows = await this.db.select({ sync: knowledgeSync, name: knowledgeBase.name }).from(knowledgeSync).innerJoin(knowledgeBase, eq(knowledgeSync.knowledgeBaseId, knowledgeBase.id)).where(eq(knowledgeSync.knowledgeBaseId, knowledgeBaseId));
    return rows[0] ? { ...rows[0].sync, name: rows[0].name } : undefined;
  }

  /** The Google connection, ready for a run, or why it isn't. */
  private async usableConnection() {
    return usable(await this.connection());
  }

  /**
   * Connects a knowledge base to a Drive folder, given by its link. Your Space starts with a resync,
   * which copies both ways and deletes nothing. The body names only the folder: the remote is always
   * Google Drive, through the Google connection. The knowledge base gets an rclone container of its
   * own; the others' run on.
   */
  async connect(name: string, input: Record<string, unknown>, actorId: string) {
    const base = await this.knowledgeRow(name);
    const unknown = Object.keys(input).filter((key) => key !== "folder");
    if (unknown.length > 0) throw new AppError(400, "unknown_field", `A knowledge base connects to a Drive folder only: ${unknown.join(", ")} isn't a field.`);
    const folderId = typeof input.folder === "string" ? folderIdOf(input.folder) : undefined;
    if (!folderId) throw new AppError(400, "bad_folder", "Paste the link of a Google Drive folder, like https://drive.google.com/drive/folders/1AbC…, as Drive shows it in the address bar or under Share.");
    await this.usableConnection();
    if (!this.hold(base.id)) throw new AppError(409, "busy", "The knowledge base is being deleted, connected or disconnected. Try again when that finishes.");
    try {
      if (await this.syncRow(base.id)) throw new AppError(409, "already_connected", "This knowledge base is connected already. Disconnect it first to sync another folder.");
      await this.inServiceTurn(async () => {
        // No earlier connection's state can read as deletions against this folder.
        await this.apps.runtime.removeSync(name).catch((error: unknown) => {
          throw new AppError(409, error instanceof RuntimeError ? error.code : "busy", error instanceof Error ? error.message : "The knowledge base's earlier sync can't be removed.");
        });
        await this.db.transaction(async (tx) => {
          // Checked again with the connection locked until this commits: forgetting it meanwhile waits,
          // then refuses, as this knowledge base syncs through it.
          usable((await tx.select().from(googleConnection).where(eq(googleConnection.id, 1)).for("share"))[0]);
          const requested: SyncRequested = { mode: "resync", by: actorId, at: new Date().toISOString() };
          await tx.insert(knowledgeSync).values({ knowledgeBaseId: base.id, folderId, connectedBy: actorId, requested });
          await recordEvent(tx, "knowledge.connected", actorId, null, null, { id: base.id, name: base.name });
        });
        try {
          await this.startService(this.bases(await this.rows()));
        } catch (error) {
          await this.db.delete(knowledgeSync).where(eq(knowledgeSync.knowledgeBaseId, base.id));
          throw serviceError(error);
        }
      });
    } finally {
      this.release(base.id);
    }
    this.kick();
    return this.status((await this.syncRow(base.id))!, false);
  }

  /**
   * Disconnects a knowledge base: its sync state goes, and both it and the Drive folder keep their
   * files. Its step under way ends first, and none starts meanwhile; then its rclone is stopped as
   * Ctrl+C stops it, which stops a run under way, and removed. The other knowledge bases' run on.
   */
  async disconnect(name: string, actorId: string): Promise<void> {
    const base = await this.knowledgeRow(name);
    const row = await this.syncRow(base.id);
    if (!row) throw new AppError(404, "not_connected", "This knowledge base isn't connected to Drive.");
    if (!this.hold(base.id)) throw new AppError(409, "busy", "The knowledge base is being deleted or disconnected already.");
    this.leaving.add(base.id);
    try {
      await this.inTurnOf(base.id, async () => {});
      await this.inServiceTurn(async () => {
        await this.startService(this.bases(await this.rows())).catch((error: unknown) => {
          throw serviceError(error);
        });
        await this.apps.runtime.removeSync(name).catch((error: unknown) => {
          throw new AppError(error instanceof RuntimeError && error.status === 409 ? 409 : 503, error instanceof RuntimeError ? error.code : "runtime_error", error instanceof Error ? error.message : "The sync can't be removed.");
        });
        await this.db.transaction(async (tx) => {
          await tx.delete(knowledgeSync).where(eq(knowledgeSync.knowledgeBaseId, base.id));
          await recordEvent(tx, "knowledge.disconnected", actorId, null, null, { id: base.id, name: base.name });
        });
        this.forget(base.id, name);
      });
    } finally {
      this.release(base.id);
    }
  }

  /**
   * Takes a knowledge base the caller holds out of the sync, before it is deleted: once its step under
   * way ends, its rclone is stopped and removed. Nothing for one that isn't synced. Its release puts
   * it back, unless it is gone.
   */
  async leaveService(knowledgeBaseId: string): Promise<void> {
    if (!(await this.syncRow(knowledgeBaseId))) return;
    this.leaving.add(knowledgeBaseId);
    await this.inTurnOf(knowledgeBaseId, async () => {});
    await this.inServiceTurn(async () => {
      await this.startService(this.bases(await this.rows())).catch((error: unknown) => {
        throw serviceError(error);
      });
    });
  }

  /**
   * The owner's actions: Sync now, which runs once more after a run under way; Resync, which copies
   * both ways and deletes nothing; and Apply these deletions, every one a stopped run listed, which the
   * owner confirmed by that run and their number. Each starts at once, or after the knowledge base's
   * run under way.
   */
  async start(name: string, input: Record<string, unknown>, actorId: string): Promise<void> {
    const base = await this.knowledgeRow(name);
    const action = input.action;
    if (action !== "sync" && action !== "resync" && action !== "apply_deletions") throw new AppError(400, "bad_action", "The action must be sync, resync or apply_deletions.");
    if (action === "apply_deletions") {
      const { run, count } = input;
      if (typeof run !== "string" || typeof count !== "number" || !Number.isInteger(count)) {
        throw new AppError(400, "deletions_required", "Send the run whose deletions you confirmed, and how many there are.");
      }
    }
    await this.inTurnOf(base.id, async () => {
      const row = await this.syncRow(base.id);
      if (!row) throw new AppError(404, "not_connected", "This knowledge base isn't connected to Drive.");
      await this.usableConnection();
      if (this.held.has(base.id)) throw new AppError(409, "busy", "The knowledge base is being deleted, connected or disconnected.");
      const at = new Date().toISOString();
      let requested: SyncRequested;
      if (action === "sync") {
        // A file changed just now may have missed the run under way, so one more follows it.
        if (row.requested) return;
        requested = { mode: "sync", by: actorId, at };
      } else {
        if (row.job || row.requested) throw new AppError(409, "busy", "The knowledge base is syncing. Try again when the sync finishes.");
        if (action === "resync") {
          await recordEvent(this.db, "knowledge.resync_requested", actorId, null, null, { id: base.id, name: base.name });
          requested = { mode: "resync", by: actorId, at };
        } else {
          if (row.result !== "stopped" || (row.reason !== "max_delete" && row.reason !== "changed") || row.deletions.length === 0) {
            throw new AppError(409, "no_deletions", "There are no deletions waiting for you to confirm.");
          }
          // The owner confirms the deletions of the run they saw, by its time and their number; the
          // server applies them only if its dry run lists exactly the ones it keeps.
          const run = input.run as string;
          const count = input.count as number;
          if (!row.lastRunAt || Date.parse(run) !== row.lastRunAt.getTime() || count !== row.deletions.length) {
            throw new AppError(409, "deletions_changed", "The deletions waiting changed since you looked, so nothing was deleted. Check the new list.");
          }
          requested = { mode: "force", by: actorId, at, run, count };
        }
      }
      await this.db.update(knowledgeSync).set({ requested }).where(eq(knowledgeSync.knowledgeBaseId, base.id));
    });
    this.kick();
  }

  /** A tick soon: an owner's run starts without waiting for the timer. */
  private kick(): void {
    if (!this.closed && this.timer) setTimeout(() => void this.tick(), 0).unref?.();
  }

  /**
   * One tick of the sync: the containers are started as the synced knowledge bases need, unless a
   * change of them is under way; then each knowledge base takes a step in its own turn, so one that
   * takes long, as a large listing, holds up none of the others. A tick asked for before this one has
   * started is this one; each knowledge base has at most one step waiting.
   */
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.queuedTick) return this.queuedTick;
    const tick = (async () => {
      await Promise.resolve();
      // From here on, a tick asked for is another: it sees what this one does.
      this.queuedTick = undefined;
      try {
        if (this.serviceBusy === 0) await this.inServiceTurn(() => this.reconcile());
        const rows = await this.rows();
        await Promise.all(rows.map((row) => this.step(row.knowledgeBaseId)));
      } catch (error) {
        log("warn", "knowledge.sync_tick_failed", errorFields(error));
      }
    })();
    this.queuedTick = tick;
    return tick;
  }

  /** The knowledge base's next step, in its turn; one already waiting is that one. */
  private step(knowledgeBaseId: string): Promise<void> {
    const queued = this.queuedSteps.get(knowledgeBaseId);
    if (queued) return queued;
    const step = this.inTurnOf(knowledgeBaseId, async () => {
      this.queuedSteps.delete(knowledgeBaseId);
      try {
        await this.advance(knowledgeBaseId);
      } catch (error) {
        log("warn", "knowledge.sync_step_failed", errorFields(error));
      }
    });
    this.queuedSteps.set(knowledgeBaseId, step);
    return step;
  }

  /**
   * The containers run for exactly the synced knowledge bases: started once after the server starts,
   * and again if they differ, unless that failed less than SERVICE_RETRY_MS ago.
   */
  private async reconcile(): Promise<void> {
    const bases = this.bases(await this.rows());
    if (this.service && this.service.bases.join(",") === bases.join(",")) return;
    if (Date.now() - this.serviceFailed < SERVICE_RETRY_MS) return;
    try {
      await this.startService(bases);
    } catch (error) {
      this.serviceFailed = Date.now();
      log("warn", "knowledge.sync_service_failed", errorFields(error));
    }
  }

  /** The knowledge bases that sync: every synced one, except those leaving it. */
  private bases(rows: Row[]): string[] {
    return rows.filter((r) => !this.leaving.has(r.knowledgeBaseId)).map((r) => r.name);
  }

  /** Starts an rclone container for exactly each of these knowledge bases. */
  private async startService(bases: string[]): Promise<void> {
    const names = [...new Set(bases)].sort();
    const service = await this.apps.runtime.ensureSyncService(names);
    this.service = { bases: names, fixture: service.fixture };
  }

  /** What the server knows of a knowledge base's rclone, once it no longer syncs. */
  private forget(knowledgeBaseId: string, name: string): void {
    this.remotes.delete(knowledgeBaseId);
    this.listedAt.delete(knowledgeBaseId);
    this.unreachableSince.delete(name);
    this.limitedAt.delete(name);
  }

  /**
   * One step of a knowledge base, in its turn: its run under way is followed; with none, its next one
   * starts if it is due or the owner asked for it. Nothing while it is held, before its container is
   * known to run, or before the containers have said whether they are the browser tests'.
   */
  private async advance(knowledgeBaseId: string): Promise<void> {
    if (this.closed || this.held.has(knowledgeBaseId)) return;
    const row = await this.rowOf(knowledgeBaseId);
    if (!row || !this.service?.bases.includes(row.name)) return;
    if (row.job) return this.follow(row);
    if (!this.isNext(row)) return;
    const connection = await this.connection();
    if (!connection?.token || connection.problem) return;
    // rclone is asked only when a run starts: each call it answers is kept for an hour.
    const executeId = await this.instance(row);
    if (executeId === undefined) return;
    await this.begin(row, connection, executeId);
  }

  /** Whether the knowledge base's next run is now: one the owner asked for, or it is due and didn't stop for safety. */
  private isNext(row: Row): boolean {
    if (row.requested && !row.requested.again) return true;
    // A Resync asked for again after an interruption runs when its knowledge base is due, as others do.
    if (!row.requested?.again && row.result === "stopped") return false;
    return !row.lastRunAt || Date.now() - row.lastRunAt.getTime() >= this.intervalMs;
  }

  /**
   * The knowledge base's rclone's instance, which changes when it restarts; undefined while it can't be
   * reached, or while it runs a job of this knowledge base's that the server doesn't follow, as one a
   * server started just before it stopped: bisync's log is rclone's, so two would mix theirs.
   */
  private async instance(row: Row): Promise<string | undefined> {
    const rc = this.rcFor(row.name);
    try {
      const list = await rc.call<{ executeId: string; runningIds?: number[] }>("job/list");
      this.unreachableSince.delete(row.name);
      for (const id of list.runningIds ?? []) {
        // Every call is a job of rclone's, this one among them; a run's is in a group of Your Space's.
        const job = await rc.call<RcJob>("job/status", { jobid: id }).catch(() => undefined);
        if (job && !job.finished && job.group?.startsWith("knowledge/")) {
          log("warn", "knowledge.sync_untracked", { name: row.name, job: id });
          return undefined;
        }
      }
      return list.executeId;
    } catch (error) {
      if (error instanceof RcError && (error.status === 503 || error.status === 504)) await this.unreachable(row);
      else log("warn", "knowledge.sync_instance_failed", { name: row.name, ...errorFields(error) });
      return undefined;
    }
  }

  /**
   * The knowledge base's rclone didn't answer, or not in time: once that has lasted UNREACHABLE_MS, as
   * with one hung, or whose socket is gone, it is restarted, and the next restart waits as long again.
   */
  private async unreachable(row: Row): Promise<void> {
    const since = this.unreachableSince.get(row.name);
    if (since === undefined) {
      this.unreachableSince.set(row.name, Date.now());
      return;
    }
    if (Date.now() - since < UNREACHABLE_MS) return;
    this.unreachableSince.set(row.name, Date.now());
    log("warn", "knowledge.sync_unreachable", { name: row.name });
    await this.apps.runtime.restartSyncService(row.name).catch((error: unknown) => {
      log("warn", "knowledge.sync_restart_failed", { name: row.name, ...errorFields(error) });
      // Its container is gone, as one removed by hand: the next tick starts the containers again.
      if (error instanceof RuntimeError && error.status === 404) this.service = undefined;
    });
  }

  /**
   * Starts a run: the one the owner asked for, or the one the knowledge base is due, a resync until one
   * has succeeded. Its remote is made in rclone first, when this rclone hasn't it for the current
   * client, token and folder.
   */
  private async begin(row: Row, connection: Connection, executeId: string): Promise<void> {
    const requested = row.requested;
    // Sync now before a first resync has succeeded is that resync: there are no listings to sync from.
    const asked: SyncMode = requested?.mode ?? "sync";
    const mode: SyncMode = asked === "sync" && row.resync ? "resync" : asked;
    await this.db.update(knowledgeSync).set({ requested: null }).where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId));
    if (mode === "force" && (!row.lastRunAt || requested?.run === undefined || Date.parse(requested.run) !== row.lastRunAt.getTime() || requested.count !== row.deletions.length)) {
      log("warn", "knowledge.deletions_outdated", { name: row.name });
      return;
    }
    const startedAt = new Date();
    const run = runFolder(startedAt);
    const job: Omit<SyncJob, "id" | "executeId" | "step"> = { mode, startedAt: startedAt.toISOString(), run, connectedAt: connection.connectedAt?.toISOString() ?? null, ...(requested && asked !== "sync" ? { by: requested.by } : {}) };
    try {
      await this.remote(row, connection, executeId);
      if (mode === "resync") await this.markers(row.name);
      const step = mode === "resync" ? "resync" : mode === "force" ? "preview" : "sync";
      await this.launch(row, { ...job, step }, bisyncParams(row.name, run, { resync: mode === "resync", force: mode === "force", dryRun: mode === "force" }));
    } catch (error) {
      const message = error instanceof AppError || error instanceof RcError ? error.message : "The sync couldn't start.";
      log("warn", "knowledge.sync_start_failed", { name: row.name, ...errorFields(error) });
      await this.finish(row, { ...job, id: 0, executeId, step: "sync" }, error instanceof RcError ? outcome(false, [], message) : { result: "failed", message }, [], { changed: false, listed: false });
    }
  }

  /** Makes the knowledge base's remote in its rclone, unless that rclone has it for this connection and folder. */
  private async remote(row: Row, connection: Connection, executeId: string): Promise<void> {
    const fixture = this.service!.fixture;
    const version = `${connection.clientId} ${connection.updatedAt.toISOString()} ${row.folderId} ${fixture}`;
    const known = this.remotes.get(row.knowledgeBaseId);
    if (known?.executeId === executeId && known.version === version) return;
    let clientSecret: string;
    let token: string;
    try {
      clientSecret = decrypt(this.apps.config.dataKey, connection.clientSecret);
      token = decrypt(this.apps.config.dataKey, connection.token!);
    } catch {
      throw new AppError(409, "unreadable", "The Google connection can't be read with Your Space's data key. Set up the Google Drive connection again on the Knowledge page.");
    }
    const { type, parameters } = remoteConfig({ clientId: connection.clientId, clientSecret, token, folderId: row.folderId }, fixture);
    // rclone then asks whether to sign in again for a new token; that question is never answered, so it
    // keeps the token it was given, and the access tokens it renews, in memory.
    await this.rcFor(row.name).call("config/create", { name: remoteName(row.name), type, parameters, opt: { nonInteractive: true } });
    this.remotes.set(row.knowledgeBaseId, { executeId, version, connectedAt: connection.connectedAt?.toISOString() ?? null });
  }

  /** Deletes every knowledge base's remote from its rclone's memory, as when the OAuth client changes. */
  private async forgetRemotes(): Promise<void> {
    await Promise.all(
      (await this.rows()).map((row) =>
        this.inTurnOf(row.knowledgeBaseId, async () => {
          await this.rcFor(row.name)
            .call("config/delete", { name: remoteName(row.name) })
            .catch((error: unknown) => log("warn", "knowledge.remote_delete_failed", { name: row.name, ...errorFields(error) }));
          this.remotes.delete(row.knowledgeBaseId);
        }),
      ),
    );
  }

  /** Puts Your Space's marker at both roots before a resync, copying it from one side to the other. */
  private async markers(name: string): Promise<void> {
    const rc = this.rcFor(name);
    const here = await this.stat(rc, localPath(name));
    const there = await this.stat(rc, `${remoteName(name)}:`);
    if (!here && there) await rc.call("operations/copyfile", { srcFs: `${remoteName(name)}:`, srcRemote: SYNC_MARKER, dstFs: localPath(name), dstRemote: SYNC_MARKER });
    else if (!here) await rc.upload(localPath(name), "", SYNC_MARKER, "");
    if (!there) await rc.call("operations/copyfile", { srcFs: localPath(name), srcRemote: SYNC_MARKER, dstFs: `${remoteName(name)}:`, dstRemote: SYNC_MARKER });
  }

  private async stat(rc: Rc, fs: string): Promise<boolean> {
    const { item } = await rc.call<{ item: unknown }>("operations/stat", { fs, remote: SYNC_MARKER });
    return Boolean(item);
  }

  /** Starts a job in the knowledge base's rclone, in the background, and keeps it on its row. */
  private async launch(row: Row, job: Omit<SyncJob, "id" | "executeId">, params: Record<string, unknown>): Promise<void> {
    const command = job.step === "ties" ? "sync/copy" : "sync/bisync";
    // A group of its own: rclone counts each job's transfers by it, as the tie copies read back.
    const group = `knowledge/${row.name}/${job.run}/${job.step}/${randomUUID().slice(0, 8)}`;
    const started = await this.rcFor(row.name).call<{ jobid: number; executeId: string }>(command, { ...params, _async: true, _group: group });
    await this.db
      .update(knowledgeSync)
      .set({ job: { ...job, id: started.jobid, executeId: started.executeId } })
      .where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId));
  }

  /**
   * Reads the run's job: one its rclone forgot, as when it restarted or Your Space stopped, was
   * interrupted; one still under way past RUN_LIMIT_MS is stopped by restarting its rclone, as Ctrl+C
   * stops it; one that finished goes on to the run's next step, or is recorded.
   */
  private async follow(row: Row): Promise<void> {
    const job = row.job!;
    const rc = this.rcFor(row.name);
    let status: RcJob | undefined;
    try {
      status = await rc.call<RcJob>("job/status", { jobid: job.id });
    } catch (error) {
      if (!(error instanceof RcError)) throw error;
      // rclone isn't running or doesn't answer: restarted once that lasts, and its answer then says
      // whether it still has the job.
      if (error.status === 503 || error.status === 504) return this.unreachable(row);
      // Any other failure, as an answer cut short, says nothing of the job: it is asked again next tick.
      if (!/job not found/i.test(error.message)) {
        log("warn", "knowledge.sync_status_failed", { name: row.name, ...errorFields(error) });
        return;
      }
    }
    this.unreachableSince.delete(row.name);
    // One rclone no longer has, or a job of the same number of a restarted rclone: interrupted.
    if (!status || status.executeId !== job.executeId) return this.interrupted(row, job);
    if (!status.finished) {
      if (Date.now() - Date.parse(job.startedAt) > RUN_LIMIT_MS && Date.now() - (this.limitedAt.get(row.name) ?? 0) >= SERVICE_RETRY_MS) {
        log("warn", "knowledge.sync_limit", { name: row.name });
        this.limitedAt.set(row.name, Date.now());
        // Kept on the run, so its interruption is recorded as the time limit's.
        if (!job.limited) await this.db.update(knowledgeSync).set({ job: { ...job, limited: true } }).where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId));
        await this.apps.runtime.restartSyncService(row.name).catch((error: unknown) => log("warn", "knowledge.sync_restart_failed", { name: row.name, ...errorFields(error) }));
      }
      return;
    }
    const lines = logLines(typeof status.output?.output === "string" ? status.output.output : "");
    await this.stepDone(row, job, status, lines);
    // rclone keeps each job's counts until it has a thousand: a run a minute adds up.
    await rc.call("core/stats-delete", { group: status.group }).catch(() => {});
  }

  /**
   * A run's job its rclone no longer has, as after it restarted, Your Space stopped, or the run's time
   * was up. A dry run before deletions changed nothing: the deletions wait for the owner, confirmed by
   * the same run. Any other run may have changed files, so it is recorded as one that failed, against
   * Your Space, and deletions the owner confirmed as theirs; it is due again at once, and carries on
   * with `recover`. A Resync the owner asked for then runs again, in its turn.
   */
  private async interrupted(row: Row, job: SyncJob): Promise<void> {
    log("warn", "knowledge.sync_interrupted", { name: row.name, step: job.step, limited: Boolean(job.limited) });
    if (job.step === "preview") {
      await this.db.update(knowledgeSync).set({ job: null }).where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId));
      return;
    }
    const requested: SyncRequested | null = job.mode === "resync" && job.by ? { mode: "resync", by: job.by, at: new Date().toISOString(), again: true } : null;
    const message = job.limited
      ? `The sync took longer than ${RUN_LIMIT_MS / 3_600_000} hours, so Your Space stopped it. The next sync carries on from there; a file that takes longer than that to copy never finishes.`
      : "The sync was interrupted, as when Your Space or its sync stopped. The next sync carries on from there.";
    await this.finish(row, job, { result: "failed", message }, [], { changed: true, listed: false, interrupted: true, requested });
  }

  /** A job ended: the run's next step starts, or the run is recorded. */
  private async stepDone(row: Row, job: SyncJob, status: RcJob, lines: LogLine[]): Promise<void> {
    const ended = outcome(status.success, lines, status.error);
    const changed = changedBy(lines);
    switch (job.step) {
      case "resync": {
        const ties = ended.result === "synced" ? [] : tiesOf(lines);
        // The newer copy won everywhere else. Where both copies have the same size and modification
        // time but different content, the knowledge base's copy replaces the remote's (journey 014),
        // and Drive keeps the replaced one in its version history. Only those files are copied, and a
        // remote copy changed since the first pass, so newer now, is left; then the same resync runs
        // again, so the newer copy still wins every other file, one changed on either side included.
        if (ties.length > 0) return this.copyTies(row, { ...job, ties: { pending: ties, replaced: [] } });
        return this.finish(row, job, ended, lines, { changed });
      }
      case "ties": {
        if (!status.success) return this.finish(row, job, ended, lines, { changed: true });
        const transferred = await this.rcFor(row.name)
          .call<{ transferred: { name: string; what: string; error: string; checked?: boolean }[] }>("core/transferred", { group: status.group })
          .catch(() => ({ transferred: [] }));
        const replaced = [...(job.ties?.replaced ?? []), ...transferred.transferred.filter((t) => t.what === "transferring" && !t.error && !t.checked).map((t) => t.name)];
        return this.copyTies(row, { ...job, ties: { pending: job.ties?.pending ?? [], replaced } });
      }
      case "resync_again":
        return this.finish(row, job, ended, lines, { changed: true, ties: job.ties?.replaced ?? [] });
      case "preview": {
        if (ended.result !== "synced") return this.finish(row, job, ended, lines, { changed: false });
        // A dry run from before the server restarted is run again, so the deletions follow it at once.
        if (Date.now() - Date.parse(status.endTime) > PREVIEW_FRESH_MS) return this.launch(row, job, bisyncParams(row.name, job.run, { force: true, dryRun: true }));
        const deletions = deletionsOf(lines);
        if (!sameDeletions(deletions, row.deletions)) {
          return this.finish(row, job, { result: "stopped", reason: "changed", message: "The files to delete changed since the owner confirmed them." }, lines, { changed: false, deletions });
        }
        return this.launch(row, { ...job, step: "force" }, bisyncParams(row.name, job.run, { force: true }));
      }
      default:
        return this.finish(row, job, ended, lines, { changed });
    }
  }

  /** Copies the next tie files, or once all are copied, runs the resync again. */
  private async copyTies(row: Row, job: SyncJob): Promise<void> {
    const pending = job.ties?.pending ?? [];
    if (pending.length === 0) return this.launch(row, { ...job, step: "resync_again" }, bisyncParams(row.name, job.run, { resync: true }));
    const next = pending.slice(0, TIES_PER_COPY);
    await this.launch(row, { ...job, step: "ties", ties: { pending: pending.slice(TIES_PER_COPY), replaced: job.ties?.replaced ?? [] } }, tieCopyParams(row.name, next));
  }

  /**
   * The knowledge base's conflict copies, and the files recent runs replaced; older backups are
   * removed. rclone keeps every answer for an hour, so the backups are listed a run's folder at a time,
   * newest first, only until the page has as many as it shows.
   */
  private async listing(name: string): Promise<{ conflicts: string[]; backups: Backup[] } | undefined> {
    const rc = this.rcFor(name);
    const list = async (fs: string, opt: Record<string, unknown>, filter?: Record<string, unknown>): Promise<Listed[]> => {
      try {
        const { list } = await rc.call<{ list: Listed[] }>("operations/list", { fs, remote: "", opt: { noModTime: true, noMimeType: true, ...opt }, ...(filter ? { _filter: filter } : {}) });
        return list ?? [];
      } catch (error) {
        if (error instanceof RcError && /directory not found/i.test(error.message)) return [];
        throw error;
      }
    };
    try {
      const conflicts = conflictsOf(await list(localPath(name), { recurse: true, filesOnly: true }, { IncludeRule: ["**.conflict[0-9]*"] }));
      const { recent, expired } = backupRuns((await list(backupsPath(name), { dirsOnly: true })).map((e) => e.Path), new Date());
      for (const run of expired) await rc.call("operations/purge", { fs: backupsPath(name), remote: run });
      const files: Listed[] = [];
      for (const run of recent) {
        if (files.length >= LISTED) break;
        files.push(...(await list(`${backupsPath(name)}/${run}`, { recurse: true, filesOnly: true })).map((e) => ({ ...e, Path: `${run}/${e.Path}` })));
      }
      return { conflicts, backups: backupsOf(files, new Date()).backups };
    } catch (error) {
      log("warn", "knowledge.sync_listing_failed", { name, ...errorFields(error) });
      return undefined;
    }
  }

  /**
   * Keeps a run's result on the knowledge base's sync, and records it against Your Space. Google's
   * refusal disconnects the connection only while it still has the sign-in the run's remote had.
   */
  private async finish(
    row: Row,
    job: SyncJob,
    ran: Outcome,
    lines: LogLine[],
    extra: { changed: boolean; ties?: string[]; deletions?: SyncDeletion[]; listed?: false; interrupted?: boolean; requested?: SyncRequested | null },
  ): Promise<void> {
    const subject = { id: row.knowledgeBaseId, name: row.name };
    if (ran.result === "busy") {
      // bisync's lock: another run of it, as one a restarted rclone left, holds it until it expires.
      // Nothing else is recorded, and the next run is due a minute later.
      await this.db.update(knowledgeSync).set({ job: null, lastRunAt: new Date(job.startedAt) }).where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId));
      log("warn", "knowledge.sync_locked", { name: row.name });
      return;
    }
    const deletions = extra.deletions ?? deletionsOf(lines);
    const listedBefore = this.listedAt.get(row.knowledgeBaseId) ?? 0;
    const listed = extra.listed === false || (!extra.changed && job.mode === "sync" && ran.result === "synced" && Date.now() - listedBefore < LIST_EVERY_MS) ? undefined : await this.listing(row.name);
    if (listed) this.listedAt.set(row.knowledgeBaseId, Date.now());
    const yourSpace = await operatorActorId(this.db);
    await this.db.transaction(async (tx) => {
      let ended = ran;
      if (ended.result === "unauthorized") {
        // Only while the connection still has the sign-in Google refused: one the owner made since, or
        // a connection set up again, isn't refused by it.
        const refused = await tx
          .update(googleConnection)
          .set({ problem: ended.message?.slice(0, 500) ?? "Google refused the token.", updatedAt: new Date() })
          .where(and(eq(googleConnection.id, 1), job.connectedAt ? eq(googleConnection.connectedAt, new Date(job.connectedAt)) : isNotNull(googleConnection.token)))
          .returning({ id: googleConnection.id });
        if (refused.length) await recordEvent(tx, "google.refused", yourSpace, null);
        else ended = { ...ended, result: "failed", message: "Google refused the token this run had, which has been replaced since. The next sync uses the new one." };
      }
      const synced = ended.result === "synced";
      const stopped = ended.result === "stopped";
      // More deletions than the owner can confirm: the run stays stopped, and none of them is kept.
      const tooMany = stopped && deletions.length > MAX_DELETIONS;
      const updated = await tx
        .update(knowledgeSync)
        .set({
          job: null,
          lastRunAt: new Date(job.startedAt),
          result: ended.result as SyncRow["result"],
          reason: tooMany ? "too_many" : (ended.reason ?? null),
          side: ended.side ?? null,
          message: ended.message?.slice(0, 1000) ?? null,
          // Every one of them, which the owner confirms and the server compares with its dry run.
          deletions: stopped && !tooMany ? deletions : [],
          ...(listed ? { conflicts: listed.conflicts, backups: listed.backups } : {}),
          ...(synced ? { lastSyncedAt: new Date() } : {}),
          ...(synced && job.mode === "resync" ? { resync: false, ties: (extra.ties ?? []).slice(0, 500) } : {}),
          ...(extra.requested ? { requested: extra.requested } : {}),
        })
        .where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId))
        .returning({ id: knowledgeSync.knowledgeBaseId });
      // Disconnected meanwhile: nothing is kept.
      if (updated.length === 0) return;
      // The owner's deletions, applied, or being applied when the run was interrupted: some may have been made.
      if ((synced || extra.interrupted) && job.step === "force" && job.by) await recordEvent(tx, "knowledge.deletions_applied", job.by, null, null, subject);
      if (synced && extra.changed) await recordEvent(tx, "knowledge.synced", yourSpace, null, null, subject);
      if (stopped) await recordEvent(tx, "knowledge.sync_stopped", yourSpace, null, null, subject);
      // A run that keeps failing, as while offline, is recorded once.
      if (ended.result === "failed" && row.result !== "failed") await recordEvent(tx, "knowledge.sync_failed", yourSpace, null, null, subject);
    });
    log(ran.result === "synced" ? "info" : "warn", "knowledge.synced", { name: row.name, mode: job.mode, result: ran.result, reason: ran.reason, changed: extra.changed });
  }
}

/** A failure to start the sync's containers, for the owner. */
function serviceError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = error instanceof RuntimeError && error.status === 409 ? 409 : 503;
  return new AppError(status, error instanceof RuntimeError ? error.code : "runtime_error", error instanceof Error ? error.message : "The knowledge bases' sync couldn't be started.");
}

/** The Google connection, when a run can use it, or why it can't. */
function usable(row: Connection | undefined) {
  if (!row) throw new AppError(409, "google_not_set_up", "Set up the Google Drive connection on the Knowledge page first.");
  if (!row.token) throw new AppError(409, "google_signed_out", "Sign in with Google on the Knowledge page first.");
  if (row.problem) throw new AppError(409, "google_disconnected", "Google refused Your Space's access to Drive. Reconnect on the Knowledge page first.");
  return row;
}
