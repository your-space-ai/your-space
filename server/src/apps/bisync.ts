// rclone bisync for synced knowledge bases (journey 014): what the server asks rclone's remote control
// to run (runtime/src/sync.ts runs it), and how it reads what rclone answers. Each knowledge base's
// remote, `kb-<name>:`, is its Drive folder (bisync's Path1), and the knowledge base is mounted at
// /knowledge/<name> (Path2); its sync state, bisync's listings and the files syncs replaced, is at
// /state/<name>, outside the knowledge base.

/** The file at both roots that bisync's access check looks for (`checkAccess`). */
export const SYNC_MARKER = ".your-space-sync";
/** bisync's limit on the deletions a run makes, in percent of a side's files (`maxDelete`). */
export const MAX_DELETE = 50;
/** How long the files syncs replaced or deleted in a knowledge base are kept in its sync state. */
export const BACKUP_DAYS = 30;
/** The most tie files one copy copies: rclone reports the last 100 files a copy checked or copied. */
export const TIES_PER_COPY = 40;
/** The most conflict copies and backups the page lists. */
export const LISTED = 500;

export type SyncMode = "sync" | "resync" | "force";

/** A file a run deletes: on this side it was deleted, so the run deletes it on the other. */
export interface Deletion {
  side: "local" | "remote";
  path: string;
}

export interface DriveRemote {
  clientId: string;
  clientSecret: string;
  /** rclone's token: the JSON of an OAuth token, with its refresh token and expiry. */
  token: string;
  /** The Drive folder to sync, which is the remote's root: never the whole Drive. */
  folderId: string;
}

export interface Outcome {
  result: "synced" | "stopped" | "unauthorized" | "failed" | "busy";
  /** Why a run stopped: over the deletion limit, an empty side, a missing marker, a resync needed, or deletions that changed since the owner confirmed them. */
  reason?: "max_delete" | "empty" | "marker" | "resync" | "changed";
  /** The side the stop is about, when rclone says. */
  side?: "local" | "remote";
  /** What rclone said about a run that didn't sync. */
  message?: string;
}

export const remoteName = (knowledgeBase: string) => `kb-${knowledgeBase}`;
export const localPath = (knowledgeBase: string) => `/knowledge/${knowledgeBase}`;
export const backupsPath = (knowledgeBase: string) => `/state/${knowledgeBase}/backups`;

/**
 * The remote rclone keeps in memory for a knowledge base: its Drive folder, through the operator's
 * client and the owner's token, never seeing Google Docs or shortcuts, which rclone would otherwise
 * follow out of the chosen folder, uploading and deleting there. In the browser tests (`fixture`, as
 * the runtime manager says), a folder of the test volume at /remote instead, given the same client and
 * token, so the tests check where they go.
 */
export function remoteConfig(remote: DriveRemote, fixture: boolean): { type: string; parameters: Record<string, unknown> } {
  const credentials = { client_id: remote.clientId, client_secret: remote.clientSecret, token: remote.token };
  if (fixture) return { type: "alias", parameters: { remote: `/remote/${remote.folderId}`, ...credentials } };
  return { type: "drive", parameters: { ...credentials, scope: "drive", root_folder_id: remote.folderId, skip_gdocs: true, skip_shortcuts: true } };
}

/**
 * A bisync run between the knowledge base's Drive folder and the knowledge base, with bisync's own
 * checks: the marker at both roots, the deletion limit, the lock that expires if a run dies, recovery
 * after an interruption, comparing by size, time and checksum, and the knowledge base's copy keeping
 * the name in a conflict. A file a run replaces or deletes in the knowledge base is kept in that run's
 * backup folder. `resync` copies both ways and deletes nothing, the newer copy winning; `force` makes
 * deletions past the limit; `dryRun` changes nothing and lists what it would do.
 */
export function bisyncParams(knowledgeBase: string, run: string, options: { resync?: boolean; force?: boolean; dryRun?: boolean } = {}): Record<string, unknown> {
  return {
    path1: `${remoteName(knowledgeBase)}:`,
    path2: localPath(knowledgeBase),
    workdir: `/state/${knowledgeBase}/bisync`,
    checkAccess: true,
    checkFilename: SYNC_MARKER,
    maxDelete: MAX_DELETE,
    resilient: true,
    recover: true,
    maxLock: "2m",
    compare: "size,modtime,checksum",
    conflictResolve: "path2",
    backupDir2: `${backupsPath(knowledgeBase)}/${run}`,
    createEmptySrcDirs: true,
    ...(options.resync ? { resync: true, resyncMode: "newer" } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.dryRun ? { dryRun: true } : {}),
  };
}

/**
 * rclone's filter pattern for exactly this path from the root, its special characters escaped: a `]`
 * too, which rclone otherwise refuses as "mismatched ']'".
 */
export function exactPattern(path: string): string {
  return `/${path.replace(/[\\*?[\]{}]/g, "\\$&")}`;
}

/**
 * Copies the knowledge base's copy of each file over the remote's: the files a resync found with the
 * same size and time on both sides but different content. By checksum, which copies such a file that
 * the same size and time would otherwise skip; and only over an older remote copy (`UpdateOlder`), so
 * one edited on Drive since the resync compared them keeps that edit.
 */
export function tieCopyParams(knowledgeBase: string, ties: string[]): Record<string, unknown> {
  return {
    srcFs: localPath(knowledgeBase),
    dstFs: `${remoteName(knowledgeBase)}:`,
    _config: { UpdateOlder: true, CheckSum: true },
    _filter: { IncludeRule: ties.map(exactPattern) },
  };
}

export interface LogLine {
  level: string;
  msg: string;
  /** The file a line is about, as rclone's JSON log names it. */
  object?: string;
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
 * time, which resync's `newer` mode can't tell apart, when nothing else stopped it.
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
 * The lines that say why a run failed: errors, and rclone's fatal notices. Never one of bisync's lines
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

/** What a run's success and log say about it; `error` is the error rclone's remote control gives the job. */
export function outcome(success: boolean, lines: LogLine[], error = ""): Outcome {
  if (success) return { result: "synced" };
  const failures = failureLines(lines);
  const text = [...failures, error].join("\n");
  const message = (lines.filter((l) => l.level === "error" || l.level === "critical").at(-1)?.msg.trim() ?? failures.at(-1) ?? (error || "rclone didn't say why.")).slice(0, 600);
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
  if (/run --resync to recover|Must run --resync|cannot find prior Path1 or Path2 listings/i.test(text)) return { result: "stopped", reason: "resync", message };
  return { result: "failed", message };
}

/** Whether a run copied, renamed or deleted anything: a dry run's lines say it skipped them. */
export function changedBy(lines: LogLine[]): boolean {
  return lines.some((l) => /^(Copied|Deleted|Moved|Renamed|Made directory|Removed directory|Server side copied)\b/.test(l.msg.trim()));
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

export interface Listed {
  Path: string;
  Size: number;
}

export interface Backup {
  run: string;
  path: string;
  size: number;
}

/** A backup folder's runs: those kept 30 days, newest first, and the older ones to remove. Folders Your Space didn't name are left. */
export function backupRuns(folders: string[], now: Date): { recent: string[]; expired: string[] } {
  const oldest = now.getTime() - BACKUP_DAYS * 24 * 60 * 60 * 1000;
  const runs = folders.map((f) => ({ f, time: runTime(f) })).filter((r): r is { f: string; time: Date } => r.time !== undefined);
  return {
    recent: runs.filter((r) => r.time.getTime() >= oldest).map((r) => r.f).sort().reverse(),
    expired: runs.filter((r) => r.time.getTime() < oldest).map((r) => r.f),
  };
}

/** The files of a backup folder listing kept 30 days, newest run first, and the older runs to remove. */
export function backupsOf(entries: Listed[], now: Date): { backups: Backup[]; expired: string[] } {
  const backups: Backup[] = [];
  const expired = new Set<string>();
  const oldest = now.getTime() - BACKUP_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    const [run, ...rest] = entry.Path.split("/");
    const time = runTime(run!);
    if (!time || rest.length === 0) continue;
    if (time.getTime() < oldest) expired.add(run!);
    else backups.push({ run: run!, path: rest.join("/"), size: entry.Size });
  }
  backups.sort((a, b) => (a.run === b.run ? a.path.localeCompare(b.path) : b.run.localeCompare(a.run)));
  return { backups: backups.slice(0, LISTED), expired: [...expired] };
}

/** The conflict copies a listing of the knowledge base found, by path. */
export function conflictsOf(entries: Listed[]): string[] {
  return entries
    .map((e) => e.Path)
    .sort()
    .slice(0, LISTED);
}
