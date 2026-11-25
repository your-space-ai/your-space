// Synced knowledge bases (journey 014, decision 2026-11-25 "Knowledge bases"): a two-way sync between
// a knowledge base's volume and a remote folder with rclone bisync. The runtime manager runs rclone in
// a container of its own for each step and removes it after the step: the official image pinned to
// its digest, as user 1000, without capabilities, with a read-only root, no engine socket and no FUSE,
// on a network whose only way out is a Squid of its own that lets through only Google's token and
// Drive hosts. The remote's configuration, its client secret and token included, reaches rclone only
// as that container's environment (RCLONE_CONFIG=/dev/null keeps rclone's configuration in memory):
// Your Space never writes it to a file, logs it or gives it to an app. The engine keeps a container's
// environment in that container's configuration for as long as the container exists, so each step's
// container is removed when the step ends, and any a runtime manager left behind is removed when the
// next one starts (removeLeftoverSteps). bisync's state, and the files a sync replaced, are in a volume
// of Your Space's for each knowledge base, outside the knowledge base. A run holds its knowledge base
// from before its first step to after its last, so neither it nor its sync is deleted in between.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EGRESS_IMAGE,
  EGRESS_PORT,
  EGRESS_SERVICE,
  egressConfig,
  egressService,
  escapeDollars,
  knowledgeStateVolume,
  knowledgeSyncLabels,
  knowledgeVolume,
  pinnedImage,
} from "./adapter.ts";
import { deleteKnowledgeState, holdingKnowledge, imagePresent, initKnowledge, INSTALLATION, isStopping, knowledgeHold, knowledgeOf, SpecError } from "./apps.ts";
import { docker, engine, engineInfo, engineJson, EngineError, inspectImage, pullImage, scrub } from "./engine.ts";

/** rclone 1.75.2's official image, for every processor it is published for, by its index digest. */
export const RCLONE_IMAGE = "rclone/rclone@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5";
/** The file at both roots that bisync's access check looks for (`--check-access`). */
export const SYNC_MARKER = ".your-space-sync";
/** bisync's limit on the deletions a run makes, in percent of a side's files (`--max-delete`). */
export const MAX_DELETE = 50;
/**
 * The hosts the sync's proxy lets through: Google's token endpoint, where rclone refreshes the access
 * token, and the Drive API's, for its files, uploads and downloads. Your Space's server, not rclone,
 * signs in with Google.
 */
export const SYNC_HOSTS = ["oauth2.googleapis.com", "www.googleapis.com"];
/** How long the files syncs replaced or deleted in a knowledge base are kept in its sync state. */
export const BACKUP_DAYS = 30;
/** A step that runs longer is stopped. */
const STEP_TIMEOUT_MS = 25 * 60_000;
/** The markers' modification time, the same on both sides, so creating them again changes nothing. */
const MARKER_TIME = "2000-01-01T00:00:00";
const SYNC_MEMORY = 512 * 1024 * 1024;

export type SyncMode = "sync" | "resync" | "force";

export interface DriveRemote {
  type: "drive";
  clientId: string;
  clientSecret: string;
  /** rclone's token: the JSON of an OAuth token, with its refresh token and expiry. */
  token: string;
  /** The Drive folder to sync, which is the remote's root: never the whole Drive. */
  folderId: string;
}

/** A file a run deletes: on this side it was deleted, so the run deletes it on the other. */
export interface Deletion {
  side: "local" | "remote";
  path: string;
}

export interface SyncRequest {
  remote: DriveRemote;
  /**
   * `sync` is a run; `resync` copies both ways and deletes nothing, as the first run does; `force`
   * makes the deletions the owner confirmed, past the limit, once.
   */
  mode: SyncMode;
  /** For `force`: the deletions the owner confirmed. */
  confirm?: Deletion[];
}

export interface SyncResult {
  result: "synced" | "stopped" | "unauthorized" | "failed" | "busy";
  /** Why a run stopped: over the deletion limit, an empty side, a missing marker, a resync needed, or deletions that changed since the owner confirmed them. */
  reason?: "max_delete" | "empty" | "marker" | "resync" | "changed";
  /** The side the stop is about, when rclone says. */
  side?: "local" | "remote";
  /** What rclone said about a run that didn't sync, without any secret. */
  message?: string;
  /** The deletions a run stopped over, or would make. */
  deletions: Deletion[];
  /** Files whose local copy replaced the remote's in a resync, because both had the same modification time. */
  ties: string[];
  /** The knowledge base's conflict copies: a remote file renamed because both sides changed it. */
  conflicts: string[];
  /** The files syncs replaced or deleted in the knowledge base, by run, newest first. */
  backups: { run: string; path: string; size: number }[];
  /** Whether the run copied, renamed or deleted anything. */
  changed: boolean;
  /** Whether `conflicts` and `backups` were listed after the run. */
  listed?: boolean;
}

const FOLDER_ID = /^[A-Za-z0-9_-]{10,200}$/;
const TEXT = /^[\x21-\x7e]{1,512}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSyncRequest(body: unknown): SyncRequest {
  if (!isObject(body)) throw new SpecError("The request needs a remote and a mode.");
  const { remote, mode, confirm } = body;
  // Google Drive is the only remote (decision 2026-11-25): the request can't name another type.
  if (!isObject(remote) || remote.type !== "drive") throw new SpecError("A knowledge base syncs with a Google Drive folder only.");
  const { clientId, clientSecret, token, folderId } = remote;
  if (typeof clientId !== "string" || !TEXT.test(clientId)) throw new SpecError("The Google client ID isn't valid.");
  if (typeof clientSecret !== "string" || !TEXT.test(clientSecret)) throw new SpecError("The Google client secret isn't valid.");
  if (typeof token !== "string" || token.length > 8192 || !validToken(token)) throw new SpecError("The Google token isn't valid.");
  if (typeof folderId !== "string" || !FOLDER_ID.test(folderId)) throw new SpecError("The Drive folder ID isn't valid.");
  if (mode !== "sync" && mode !== "resync" && mode !== "force") throw new SpecError("The sync's mode must be sync, resync or force.");
  const request: SyncRequest = { remote: { type: "drive", clientId, clientSecret, token, folderId }, mode };
  if (mode === "force") {
    if (!Array.isArray(confirm) || confirm.length > 10_000 || !confirm.every(isDeletion)) throw new SpecError("Applying deletions needs the list the owner confirmed.");
    request.confirm = confirm;
  }
  return request;
}

function validToken(token: string): boolean {
  try {
    const parsed = JSON.parse(token) as unknown;
    return isObject(parsed) && typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 0;
  } catch {
    return false;
  }
}

function isDeletion(value: unknown): value is Deletion {
  return isObject(value) && (value.side === "local" || value.side === "remote") && typeof value.path === "string" && value.path.length > 0 && value.path.length <= 4096;
}

/**
 * The browser tests' remote (YS_E2E_SYNC_FIXTURE=1 in the runtime manager's environment, which only
 * e2e/compose.e2e.yaml sets; the runtime's environment comes from Compose files alone, never from the
 * owner's .env): the Drive folder is a folder of a test volume instead, so the tests run real bisync
 * without Google. Nothing the server or the owner sends selects it.
 */
export function fixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YS_E2E_SYNC_FIXTURE === "1";
}

/** The browser tests' stand-in for Drive: a volume with a folder for each Drive folder ID. */
export function fixtureVolume(): string {
  return `ys-sync-fixture.${INSTALLATION}`;
}

/** The remote's configuration, as rclone reads it from its environment: the remote is named `remote`. */
export function remoteEnv(remote: DriveRemote, fixture = fixtureEnabled()): Record<string, string> {
  if (fixture) return { RCLONE_CONFIG_REMOTE_TYPE: "alias", RCLONE_CONFIG_REMOTE_REMOTE: `/remote/${remote.folderId}` };
  return {
    RCLONE_CONFIG_REMOTE_TYPE: "drive",
    RCLONE_CONFIG_REMOTE_CLIENT_ID: remote.clientId,
    RCLONE_CONFIG_REMOTE_CLIENT_SECRET: remote.clientSecret,
    RCLONE_CONFIG_REMOTE_TOKEN: remote.token,
    RCLONE_CONFIG_REMOTE_SCOPE: "drive",
    RCLONE_CONFIG_REMOTE_ROOT_FOLDER_ID: remote.folderId,
  };
}

/** Every secret in the remote's configuration, which any text rclone writes is cleaned of. */
export function secretValues(remote: DriveRemote): Record<string, string> {
  const values: Record<string, string> = { clientId: remote.clientId, clientSecret: remote.clientSecret, token: remote.token };
  try {
    const token = JSON.parse(remote.token) as Record<string, unknown>;
    for (const key of ["access_token", "refresh_token", "id_token"]) if (typeof token[key] === "string") values[key] = token[key];
  } catch {
    // validateSyncRequest parsed it already.
  }
  return values;
}

/** The sync's own Compose project, its outbound proxy: never an app's, whose projects are `ys-<app>`. */
export function syncProject(): string {
  return `${INSTALLATION}_knowledge-sync`;
}

/** The sealed network the sync's containers join, whose only way out is the proxy. */
export function syncNetwork(): string {
  return `${syncProject()}_sync`;
}

/** The sync's outbound proxy: the same Squid as an app's, on a sealed network of its own, for Google's hosts only. */
export function syncProxyFile(squidImage: string): Record<string, unknown> {
  const labels = { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge-sync" };
  const config = egressConfig(SYNC_HOSTS);
  return {
    name: syncProject(),
    services: escapeDollars({ [EGRESS_SERVICE]: egressService(squidImage, labels, config, ["sync", "egress"]) }),
    networks: {
      sync: { internal: true, driver: "bridge", driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" }, labels },
      egress: { driver: "bridge", labels },
    },
    configs: { egress: { content: escapeDollars(config) } },
  };
}

interface Mount {
  source: string;
  target: string;
  readOnly?: boolean;
}

/** One step's container: rclone with the arguments, hardened, mounting only the knowledge base's volumes. */
export function syncContainer(name: string, args: string[], options: { env?: Record<string, string>; network?: string; mounts: Mount[] }): Record<string, unknown> {
  const proxy = `http://${EGRESS_SERVICE}:${EGRESS_PORT}`;
  const env: Record<string, string> = {
    // rclone keeps its configuration in memory and never saves it, a refreshed token included.
    RCLONE_CONFIG: "/dev/null",
    HOME: "/tmp",
    ...(options.network ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
    ...options.env,
  };
  return {
    Image: RCLONE_IMAGE,
    Cmd: args,
    User: "1000:1000",
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    Labels: knowledgeSyncLabels(INSTALLATION, name),
    ...(options.network ? {} : { NetworkDisabled: true }),
    HostConfig: {
      NetworkMode: options.network ?? "none",
      Mounts: options.mounts.map((m) => ({ Type: "volume", Source: m.source, Target: m.target, ReadOnly: m.readOnly === true, VolumeOptions: { NoCopy: true } })),
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Memory: SYNC_MEMORY,
      NanoCpus: 1_000_000_000,
      PidsLimit: 256,
    },
  };
}

/** The arguments of a bisync run between the remote's folder (Path1) and the knowledge base (Path2). */
export function bisyncArgs(backup: string): string[] {
  return [
    "bisync",
    "remote:",
    "/knowledge",
    "--workdir",
    "/state/bisync",
    "--check-access",
    "--check-filename",
    SYNC_MARKER,
    "--max-delete",
    String(MAX_DELETE),
    "--resilient",
    "--recover",
    "--max-lock",
    "2m",
    "--compare",
    "size,modtime,checksum",
    // The knowledge base's copy keeps the file's name; the remote's is renamed `<name>.conflict<n>`.
    "--conflict-resolve",
    "path2",
    // A file a run replaces or deletes in the knowledge base is kept in that run's folder.
    "--backup-dir2",
    `/state/backups/${backup}`,
    ...DRIVE_SCOPE,
    "--create-empty-src-dirs",
    ...LOGGING,
  ];
}

/**
 * What of the Drive folder a sync sees: never Google Docs, Sheets or Slides, which have no file, and
 * never a shortcut, which rclone would otherwise follow into a folder or file outside the chosen one,
 * uploading and deleting there.
 */
const DRIVE_SCOPE = ["--drive-skip-gdocs", "--drive-skip-shortcuts"];

/** rclone's filter pattern for exactly this path from the root, its special characters escaped. */
export function exactPattern(path: string): string {
  return `/${path.replace(/[\\*?[{}]/g, "\\$&")}`;
}

/** The most ties one step copies, so its arguments stay well under the kernel's limit. */
const TIES_PER_STEP = 100;

/**
 * Copies the knowledge base's copy of each file over the remote's, whatever their sizes and times:
 * the files a resync found with the same size and time on both sides but different content.
 */
export function tieCopyArgs(ties: string[]): string[] {
  return ["copy", "/knowledge", "remote:", "--ignore-times", ...DRIVE_SCOPE, ...ties.flatMap((path) => ["--include", exactPattern(path)]), ...LOGGING];
}

const LOGGING = ["-v", "--use-json-log", "--color", "NEVER"];

export interface LogLine {
  level: string;
  msg: string;
  stats?: { transfers?: number; deletes?: number; renames?: number; serverSideMoves?: number };
}

/** rclone's JSON log, one object per line; any other line is kept as a notice. */
export function logLines(text: string): LogLine[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as LogLine;
        if (typeof parsed.msg === "string" && typeof parsed.level === "string") return parsed;
      } catch {
        // not JSON
      }
      return { level: "notice", msg: line };
    });
}

/** The side bisync calls Path1 is the remote, Path2 the knowledge base. */
const side = (path: string): "local" | "remote" => (path === "Path1" ? "remote" : "local");

const DELETED = /^- (Path1|Path2)\s+File was deleted\s+- (.+)$/;

/** The deletions a run found: files deleted on one side, which it deletes, or would, on the other. */
export function deletionsOf(lines: LogLine[]): Deletion[] {
  const found = new Map<string, Deletion>();
  for (const { msg } of lines) {
    const match = DELETED.exec(msg.trim());
    if (match) found.set(`${match[1]}\u0000${match[2]}`, { side: side(match[1]!), path: match[2]! });
  }
  return [...found.values()];
}

export function sameDeletions(a: Deletion[], b: Deletion[]): boolean {
  const key = (d: Deletion) => `${d.side}\u0000${d.path}`;
  const left = new Set(a.map(key));
  const right = new Set(b.map(key));
  return left.size === right.size && [...left].every((k) => right.has(k));
}

/** bisync's line about a tie: its hashes, then the file's name, which may itself hold " - ". */
const TIE = /Checksum not equal in listing\. Path1: \S*, Path2: \S* - (.+)$/;

/**
 * The files a resync left different on the two sides because both have the same size and modification
 * time, which `--resync-mode newer` can't tell apart, when nothing else stopped it.
 */
export function tiesOf(lines: LogLine[]): string[] {
  const errors = lines.filter((l) => l.level === "error" || l.level === "critical");
  const ties = errors.map((l) => TIE.exec(l.msg.trim())?.[1]).filter((path): path is string => path !== undefined);
  const onlyTies = errors.every((l) => TIE.test(l.msg) || /path1 and path2 are out of sync|Bisync aborted/.test(l.msg));
  return onlyTies ? [...new Set(ties)] : [];
}

/** Google refused the client or the token: the connection needs the owner to sign in again. */
const UNAUTHORIZED = /invalid_grant|invalid_client|unauthorized_client|deleted_client|Token has been expired or revoked|Invalid Credentials/i;

/** bisync's lines about one file, `- Path1   File is new   - <file>` or `-   Checksum not equal … - <file>`. */
const FILE_LINE = /^-\s/;

/**
 * The lines that say why a step failed: errors, and rclone's fatal notices. Never one of bisync's lines
 * about a file, which end with the file's name, so a file's name can't read as a refusal or a stop.
 * (rclone's JSON log keeps the name of a file an error is about in a field of its own, not in `msg`.)
 */
function failureLines(lines: LogLine[]): string[] {
  return lines
    .filter((l) => l.level === "error" || l.level === "critical" || (l.level === "notice" && /^(Fatal error|Failed to)/.test(l.msg.trim())))
    .map((l) => l.msg.trim())
    .filter((msg) => !FILE_LINE.test(msg));
}

/** The side whose marker is missing, from bisync's line about it: its start is bisync's, its end the marker's name. */
const MARKER_MISSING = /^-\s+Access test failed: (Path1|Path2) file not found in (Path1|Path2) - /;

/** What a step's exit code and log say about it. */
export function outcome(code: number, lines: LogLine[]): Pick<SyncResult, "result" | "reason" | "side" | "message"> {
  if (code === 0) return { result: "synced" };
  const failures = failureLines(lines);
  const text = failures.join("\n");
  const message = (lines.filter((l) => l.level === "error" || l.level === "critical").at(-1)?.msg.trim() ?? failures.at(-1) ?? `rclone stopped with exit code ${code}.`).slice(0, 600);
  if (UNAUTHORIZED.test(text)) return { result: "unauthorized", message };
  const tooMany = /too many deletes.* on (Path1|Path2)/.exec(text);
  if (tooMany || /too many deletes/.test(text)) return { result: "stopped", reason: "max_delete", ...(tooMany ? { side: side(tooMany[1]!) } : {}), message };
  const empty = /Empty current (Path1|Path2) listing/.exec(text);
  if (empty) return { result: "stopped", reason: "empty", side: side(empty[1]!), message };
  if (/check file check failed|Access test failed/.test(text)) {
    const missing = lines.map((l) => MARKER_MISSING.exec(l.msg.trim())).find((m) => m !== null);
    return { result: "stopped", reason: "marker", ...(missing ? { side: side(missing[2]!) } : {}), message };
  }
  if (/prior lock file found|lock file found/i.test(text)) return { result: "busy", message };
  if (/run --resync to recover|Must run --resync/i.test(text)) return { result: "stopped", reason: "resync", message };
  return { result: "failed", message };
}

function changedBy(lines: LogLine[]): boolean {
  return lines.some((l) => l.stats !== undefined && ((l.stats.transfers ?? 0) > 0 || (l.stats.deletes ?? 0) > 0 || (l.stats.renames ?? 0) > 0 || (l.stats.serverSideMoves ?? 0) > 0));
}

/** A run's backup folder's name, which sorts by time: 2026-11-25T17-05-00-123Z. */
export function runFolder(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

/** When a backup folder's run was, or undefined for a folder Your Space didn't name. */
export function runTime(folder: string): Date | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(folder);
  if (!match) return undefined;
  const time = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isNaN(time.getTime()) ? undefined : time;
}

interface Listed {
  Path: string;
  Size: number;
}

/** The conflict copies and backups a listing of the knowledge base and its state found. */
export function listingOf(stdout: string, now: Date): { conflicts: string[]; backups: SyncResult["backups"]; expired: string[] } {
  let entries: Listed[] = [];
  try {
    entries = JSON.parse(stdout) as Listed[];
  } catch {
    entries = [];
  }
  const conflicts: string[] = [];
  const backups: SyncResult["backups"] = [];
  const expired = new Set<string>();
  const oldest = now.getTime() - BACKUP_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (entry.Path.startsWith("knowledge/")) conflicts.push(entry.Path.slice("knowledge/".length));
    else if (entry.Path.startsWith("state/backups/")) {
      const [run, ...rest] = entry.Path.slice("state/backups/".length).split("/");
      const time = runTime(run!);
      if (!time || rest.length === 0) continue;
      if (time.getTime() < oldest) expired.add(run!);
      else backups.push({ run: run!, path: rest.join("/"), size: entry.Size });
    }
  }
  backups.sort((a, b) => (a.run === b.run ? a.path.localeCompare(b.path) : b.run.localeCompare(a.run)));
  return { conflicts: conflicts.sort().slice(0, 500), backups: backups.slice(0, 500), expired: [...expired] };
}

/** The one container name a knowledge base's steps run under, so the engine runs one at a time. */
function containerName(name: string): string {
  return `${INSTALLATION}.knowledge-sync.${name}`;
}

interface StepResult {
  code: number;
  lines: LogLine[];
  stdout: string;
}

/** Creates the step's container, or says another run of the knowledge base still has one. */
async function create(name: string, body: Record<string, unknown>): Promise<string | undefined> {
  const path = `/containers/create?name=${encodeURIComponent(containerName(name))}`;
  for (let attempt = 0; ; attempt++) {
    const answer = await engine("POST", path, body);
    if (answer.status < 400) return (JSON.parse(answer.body) as { Id: string }).Id;
    if (answer.status !== 409 || attempt > 0) throw new EngineError(`Starting the sync failed: ${answer.body.trim().slice(0, 300)}`);
    // A container left by a runtime manager that stopped mid-run is removed; a running one is a run.
    const left = await engineJson<{ State: { Running: boolean } }>("GET", `/containers/${encodeURIComponent(containerName(name))}/json`).catch(() => undefined);
    if (left?.State.Running) return undefined;
    await engine("DELETE", `/containers/${encodeURIComponent(containerName(name))}?force=1`);
  }
}

/** Runs one step to its end and removes its container; its output is cleaned of the secrets. */
async function step(name: string, args: string[], options: { env?: Record<string, string>; network?: string; mounts: Mount[]; secrets: Record<string, string> }): Promise<StepResult | "busy"> {
  const id = await create(name, syncContainer(name, args, options));
  if (!id) return "busy";
  try {
    await engineJson("POST", `/containers/${id}/start`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), STEP_TIMEOUT_MS)));
    const waited = await Promise.race([engineJson<{ StatusCode: number }>("POST", `/containers/${id}/wait`), timeout]).finally(() => clearTimeout(timer));
    const logs = await docker(["logs", id]);
    const lines = logLines(scrub(logs.stderr, options.secrets));
    if (waited === "timeout") return { code: 10, lines: [...lines, { level: "error", msg: `The sync step took longer than ${STEP_TIMEOUT_MS / 60_000} minutes and was stopped.` }], stdout: "" };
    return { code: waited.StatusCode, lines, stdout: scrub(logs.stdout, options.secrets) };
  } finally {
    await engine("DELETE", `/containers/${id}?force=1`).catch(() => {});
  }
}

async function ensureImage(image: string): Promise<void> {
  if (!(await imagePresent(image))) await pullImage(image, () => {});
}

/** Creates a volume of Your Space's, set up for user 1000, unless it is there with its labels already. */
async function ensureVolume(volume: string, labels: Record<string, string>, mode: "2777" | "0700"): Promise<void> {
  const found = await engine("GET", `/volumes/${encodeURIComponent(volume)}`);
  if (found.status === 200) {
    const existing = (JSON.parse(found.body) as { Labels: Record<string, string> | null }).Labels ?? {};
    if (!Object.entries(labels).every(([key, value]) => existing[key] === value)) {
      throw new EngineError(`A volume named ${volume} exists on the engine, but Your Space didn't make it, so the sync doesn't use it.`, 409);
    }
    return;
  }
  if (found.status !== 404) throw new EngineError(`Reading ${volume} failed: ${found.body.trim().slice(0, 300)}`);
  await engineJson("POST", "/volumes/create", { Name: volume, Driver: "local", Labels: labels });
  try {
    await initKnowledge(volume, mode);
  } catch (error) {
    await engine("DELETE", `/volumes/${encodeURIComponent(volume)}`).catch(() => {});
    throw error;
  }
}

let squid: string | undefined;
let proxyStarting: Promise<void> = Promise.resolve();

/**
 * Starts the sync's proxy, or leaves it running. Its image is Squid's that apps' proxies use, pinned
 * to the digest its registry gives when the runtime manager first needs it. One start at a time.
 */
function ensureProxy(): Promise<void> {
  const next = proxyStarting.catch(() => undefined).then(async () => {
    if (!squid) {
      const info = await engineInfo();
      if (!info.reachable) throw new EngineError("The engine can't be reached.", 503);
      const image = await inspectImage(`${EGRESS_IMAGE}:latest`, info.arch ?? "amd64");
      if (!image.digest) throw new EngineError(`The sync's proxy image ${EGRESS_IMAGE} can't be found: ${image.error ?? "no digest"}`);
      squid = pinnedImage(EGRESS_IMAGE, image.digest);
    }
    await ensureImage(squid);
    const dir = mkdtempSync("/tmp/ys-sync-");
    try {
      writeFileSync(join(dir, "compose.json"), JSON.stringify(syncProxyFile(squid)), { mode: 0o600 });
      const up = await docker(["compose", "-p", syncProject(), "--project-directory", dir, "-f", join(dir, "compose.json"), "up", "-d", "--wait", "--remove-orphans", "--pull", "never"], {}, dir);
      if (up.code !== 0) throw new EngineError(`Starting the sync's proxy failed: ${up.stderr.split("\n").filter((l) => l.trim()).slice(-3).join(" ").slice(0, 600)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  proxyStarting = next;
  return next;
}

/** Stops the sync's proxy, as Your Space's apps are stopped (`stop-apps`). */
export async function stopSyncProxy(): Promise<void> {
  await docker(["compose", "-p", syncProject(), "stop"]);
}

const BUSY: SyncResult = { result: "busy", message: "Another sync of this knowledge base is running.", deletions: [], ties: [], conflicts: [], backups: [], changed: false };

/**
 * Runs a sync of the knowledge base, holding it until the run ends; another run of it answers busy,
 * and its deletion, or its sync's, refuses the run with 409.
 */
export function syncKnowledge(name: string, request: SyncRequest): Promise<SyncResult> {
  if (isStopping()) throw new EngineError("Your Space is stopping, so nothing syncs until it starts again.", 409);
  if (knowledgeHold(name) === "sync") return Promise.resolve(BUSY);
  return holdingKnowledge(name, "sync", () => runSync(name, request));
}

/** Removes a knowledge base's sync state; its files and the remote's stay. Refused while it syncs. */
export function removeSync(name: string): Promise<void> {
  return deleteKnowledgeState(name);
}

async function runSync(name: string, request: SyncRequest): Promise<SyncResult> {
  if (!(await knowledgeOf(name))) throw new EngineError(`The knowledge base ${name} isn't on this machine's engine.`, 404);
  const fixture = fixtureEnabled();
  const state = knowledgeStateVolume(INSTALLATION, name);
  await ensureImage(RCLONE_IMAGE);
  await ensureVolume(state, knowledgeSyncLabels(INSTALLATION, name), "0700");
  if (fixture) await ensureVolume(fixtureVolume(), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "sync-fixture" }, "2777");
  await ensureProxy();

  const secrets = secretValues(request.remote);
  const local: Mount = { source: knowledgeVolume(INSTALLATION, name), target: "/knowledge" };
  const mounts: Mount[] = [local, { source: state, target: "/state" }, ...(fixture ? [{ source: fixtureVolume(), target: "/remote" }] : [])];
  const env = remoteEnv(request.remote, fixture);
  const remote = (args: string[]) => step(name, args, { env, network: syncNetwork(), mounts, secrets });
  const offline = (args: string[], only: Mount[]) => step(name, args, { mounts: only, secrets });
  const backup = runFolder(new Date());
  const empty: SyncResult = { result: "synced", deletions: [], ties: [], conflicts: [], backups: [], changed: false };
  const finish = (ran: StepResult | "busy", more: Partial<SyncResult> = {}): SyncResult =>
    ran === "busy" ? BUSY : { ...empty, ...outcome(ran.code, ran.lines), deletions: deletionsOf(ran.lines), changed: changedBy(ran.lines), ...more };

  const steps = async (): Promise<SyncResult> => {
    if (request.mode === "resync") {
      // The owner chose to connect or to resync: both sides get the marker, then bisync copies both
      // ways and deletes nothing. A scheduled run never creates a marker, so a missing one stops it.
      const touchedHere = await offline(["touch", "--timestamp", MARKER_TIME, `/knowledge/${SYNC_MARKER}`, ...LOGGING], [local]);
      const touchedThere = touchedHere === "busy" || touchedHere.code !== 0 ? touchedHere : await remote(["touch", "--timestamp", MARKER_TIME, `remote:${SYNC_MARKER}`, ...LOGGING]);
      if (touchedThere === "busy" || touchedThere.code !== 0) return finish(touchedThere);
      const resync = [...bisyncArgs(backup), "--resync", "--resync-mode", "newer"];
      const first = await remote(resync);
      const ties = first === "busy" ? [] : tiesOf(first.lines);
      if (first === "busy" || first.code === 0 || ties.length === 0) return finish(first);
      // The newer copy won everywhere else. Where both copies have the same size and modification
      // time but different content, the knowledge base's copy replaces the remote's (journey 014),
      // and Drive keeps the replaced one in its version history. Only those files are copied; then
      // the same resync runs again, so the newer copy still wins every other file, one changed on
      // either side since the first pass included.
      for (let i = 0; i < ties.length; i += TIES_PER_STEP) {
        const copied = await remote(tieCopyArgs(ties.slice(i, i + TIES_PER_STEP)));
        if (copied === "busy" || copied.code !== 0) return { ...finish(copied), changed: true };
      }
      return { ...finish(await remote(resync), { ties }), changed: true };
    }
    if (request.mode === "force") {
      // Only the deletions the owner confirmed: a dry run lists them again first.
      const previewed = finish(await remote([...bisyncArgs(backup), "--force", "--dry-run"]));
      if (previewed.result !== "synced") return previewed;
      if (!sameDeletions(previewed.deletions, request.confirm ?? [])) {
        return { ...previewed, result: "stopped", reason: "changed", message: "The files to delete changed since the owner confirmed them.", changed: false };
      }
      return finish(await remote([...bisyncArgs(backup), "--force"]));
    }
    return finish(await remote(bisyncArgs(backup)));
  };
  const result = await steps();
  if (result.result === "busy") return result;

  // The knowledge base's conflict copies, and the files recent runs replaced; older backups are removed.
  const listed = await offline(
    ["lsjson", "-R", "--files-only", "--no-mimetype", "--no-modtime", "/scan", "--include", "/knowledge/**.conflict[0-9]*", "--include", "/state/backups/**", "--color", "NEVER"],
    [
      { source: local.source, target: "/scan/knowledge", readOnly: true },
      { source: state, target: "/scan/state", readOnly: true },
    ],
  );
  if (listed !== "busy" && listed.code === 0) {
    const { conflicts, backups, expired } = listingOf(listed.stdout, new Date());
    result.conflicts = conflicts;
    result.backups = backups;
    result.listed = true;
    if (expired.length > 0) {
      await offline(["delete", "/state/backups", "--rmdirs", ...expired.flatMap((run) => ["--include", `/${run}/**`]), "--color", "NEVER"], [{ source: state, target: "/state" }]);
    }
  }
  return result;
}
