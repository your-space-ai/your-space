// rclone bisync for synced knowledge bases (journey 014): what the server asks rclone's remote control
// to run (runtime/src/sync.ts runs it), and how it reads what rclone answers. Each knowledge base's
// remote, `kb-<name>:`, is its Drive folder (bisync's Path1), and the knowledge base is mounted at
// /knowledge/<name> (Path2); its sync state, bisync's listings and the files syncs replaced, is at
// /state/<name>, outside the knowledge base. rclone is given the local side always with its `links`
// option (2026-11-26), so a symbolic link syncs as a link and is never followed out of the knowledge
// base; every step of a run names the local side by the same strings, which bisync's listings are
// named after.

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
  /**
   * Why a run stopped: over the deletion limit, an empty side, a missing marker, a resync needed,
   * deletions that changed since the owner confirmed them, or a Drive folder where the knowledge base
   * has a link that sync doesn't write through.
   */
  reason?: "max_delete" | "empty" | "marker" | "resync" | "changed" | "link";
  /** The side the stop is about, when rclone says. */
  side?: "local" | "remote";
  /** What rclone said about a run that didn't sync. */
  message?: string;
}

export const remoteName = (knowledgeBase: string) => `kb-${knowledgeBase}`;
/**
 * rclone's local backend with its `links` option: a symbolic link is read as a `<name>.rclonelink`
 * file holding its target, and such a file is written as a link, so a link syncs to Drive as that
 * file and back. rclone never writes through a link that leads out of the folder, or an absolute one;
 * a Drive folder at its path fails the run instead ("path escapes from parent"). Without it, rclone
 * writes through a link to a folder, as into the knowledge base's own sync state. For every fs of the
 * local side, the knowledge base's and its backups'; bisync wants its backup folder on the same
 * remote, by the same string, as the side it backs up.
 */
const LOCAL = ":local,links:";
/** The knowledge base, as rclone is given it. */
export const localFs = (knowledgeBase: string) => `${LOCAL}/knowledge/${knowledgeBase}`;
/**
 * The folder of the knowledge base's backups, a folder for each run, as rclone is given it: in the sync
 * state's volume, a mount of its own, where moving a replaced file there is a copy. On the knowledge
 * base's own mount, rclone would move a Drive file that replaced a link's `.rclonelink` there as the
 * link's backup, report success, and delete the file in Drive on the next run.
 */
export const backupsFs = (knowledgeBase: string) => `${LOCAL}/state/${knowledgeBase}/backups`;

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
    path2: localFs(knowledgeBase),
    workdir: `/state/${knowledgeBase}/bisync`,
    checkAccess: true,
    checkFilename: SYNC_MARKER,
    maxDelete: MAX_DELETE,
    resilient: true,
    recover: true,
    maxLock: "2m",
    compare: "size,modtime,checksum",
    conflictResolve: "path2",
    backupDir2: `${backupsFs(knowledgeBase)}/${run}`,
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
    srcFs: localFs(knowledgeBase),
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

const GO_ESCAPES: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34, "'": 39 };

/**
 * A file's name as bisync prints it at the end of its lines about one file: as it is, or quoted as Go
 * quotes it (`strconv.Quote`) when it holds a quote, a backslash or a character that isn't printable,
 * a line break among them (rclone 1.75.2). A name printed as it is never starts with a quote, since
 * one that holds a quote is always quoted. Its spaces, at its end too, are the name's.
 */
export function printedName(printed: string): string {
  if (printed.length < 2 || !printed.startsWith('"') || !printed.endsWith('"')) return printed;
  const body = printed.slice(1, -1);
  const bytes: number[] = [];
  const text = (value: string) => bytes.push(...Buffer.from(value, "utf8"));
  for (let i = 0; i < body.length; i++) {
    const char = String.fromCodePoint(body.codePointAt(i)!);
    i += char.length - 1;
    if (char === '"') return printed;
    if (char !== "\\") {
      text(char);
      continue;
    }
    const next = body[++i];
    if (next === undefined) return printed;
    if (next in GO_ESCAPES) {
      bytes.push(GO_ESCAPES[next]!);
    } else if (next === "x" || next === "u" || next === "U") {
      const digits = { x: 2, u: 4, U: 8 }[next];
      const hex = body.slice(i + 1, i + 1 + digits);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== digits) return printed;
      i += digits;
      if (next === "x") bytes.push(parseInt(hex, 16));
      else text(String.fromCodePoint(parseInt(hex, 16)));
    } else if (/[0-7]/.test(next)) {
      const octal = body.slice(i, i + 3);
      if (!/^[0-7]{3}$/.test(octal)) return printed;
      i += 2;
      bytes.push(parseInt(octal, 8));
    } else {
      return printed;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The deletions a run found: files deleted on one side, which it deletes, or would, on the other.
 * Each line is read from its start only, as a name's spaces at its end are the name's.
 */
export function deletionsOf(lines: LogLine[]): Deletion[] {
  const found = new Map<string, Deletion>();
  for (const { msg } of lines) {
    const match = DELETED.exec(msg.trimStart());
    if (!match) continue;
    const path = printedName(match[2]!);
    found.set(`${match[1]}\u0000${path}`, { side: side(match[1]!), path });
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
  const ties = errors.map((l) => TIE.exec(l.msg.trimStart())?.[1]).filter((path): path is string => path !== undefined).map(printedName);
  const onlyTies = errors.every((l) => TIE.test(l.msg) || /path1 and path2 are out of sync|Bisync aborted/.test(l.msg));
  return onlyTies ? [...new Set(ties)] : [];
}

/**
 * Google refused the client or the token: the connection needs the owner to sign in again. Read only
 * from where rclone fetched the token for a request to Google, which rclone 1.75.2 logs as
 * `couldn't list directory: Get "https://www.googleapis.com/drive/v3/files?…": couldn't fetch token:
 * invalid_grant: maybe token expired? …` (`invalid_client`, `unauthorized_client` and `deleted_client`
 * alike), after bisync's own words; or from the Drive API refusing the access token, `googleapi:
 * Error 401: …`. Only from the start of a line, through rclone's own words: an error of the local file
 * system holds an app's path, as `open /knowledge/<name>/<path>: permission denied`, and an app can
 * name a file or folder like any of these, line breaks included. A path never holds the request's
 * `https://`, as no name has a `/`, and the request's URL is percent-encoded between its quotes.
 */
const CONTEXT = "(?:Bisync critical error|error reading (?:source|destination) root directory|error during [A-Za-z]+|couldn't list directory|Failed to [a-z]+): ";
const REFUSED = new RegExp(
  `^(?:${CONTEXT})*(?:(?:Get|Post|Put|Patch|Delete) "https://[^"\\s]+": (couldn't fetch token: (?:oauth2: ")?(?:invalid_grant|invalid_client|unauthorized_client|deleted_client)\\b.*)|(googleapi: Error 401: .*))`,
);

/** bisync's lines about one file, `- Path1   File is new   - <file>` or `-   Checksum not equal … - <file>`. */
const FILE_LINE = /^-\s/;

/**
 * The lines that say why a run failed: errors, and rclone's fatal notices. Never one of bisync's lines
 * about a file, which end with the file's name, so a file's name can't read as a stop. (rclone's JSON
 * log keeps the name of a file an error is about in a field of its own, though an error of the local
 * file system holds its path in `msg` too, as `mkdirat <path>: …`, which is why Google's refusal is
 * read only as `REFUSED` has it.)
 */
function failureLines(lines: LogLine[]): string[] {
  return lines
    .filter((l) => l.level === "error" || l.level === "critical" || (l.level === "notice" && /^(Fatal error|Failed to)/.test(l.msg.trim())))
    .map((l) => l.msg.trim())
    .filter((msg) => !FILE_LINE.test(msg));
}

/**
 * rclone's error when the Drive side has a folder at the path of a link in the knowledge base that
 * rclone doesn't write through (`links`): the folder it couldn't make, or whose time it couldn't set,
 * at the link or under it. rclone 1.75.2 says `mkdirat <path>: statat <path>: path escapes from
 * parent`, `mkdirat <path>: path escapes from parent` for a folder under the link, `failed to set
 * directory modtime: chtimesat <path>: …`, or `failed to set metadata on directory: failed to set
 * times: chtimesat <path>: …`. The path is whatever the app named, line breaks included, which rclone
 * keeps as they are in `msg`, so the error is read from its start to its end, the path between them.
 */
const ESCAPE = "(?:failed to set directory modtime: |failed to set metadata on directory: failed to set times: )?[a-z]+ (.+?)(?:: [a-z]+ \\1)?: path escapes from parent";
/** bisync's critical error for it, which fails the run. */
const ESCAPES = new RegExp(`^Bisync critical error: ${ESCAPE}$`, "s");
/**
 * The same error as the job's stats keep it, rclone's last error of the run, without bisync's words:
 * for an empty Drive folder there, bisync reports the run as successful, and its log has no error.
 */
const ESCAPED = new RegExp(`^${ESCAPE}$`, "s");

/** The path a run's `link` stop names, from its message: bisync's critical error, or the job's last error. */
export function linkPathOf(message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  const trimmed = message.trim();
  return (ESCAPES.exec(trimmed) ?? ESCAPED.exec(trimmed))?.[1];
}

/**
 * bisync's own words for why it stopped, as rclone 1.75.2 says them, each read from the start of a
 * line, or of the job's error, never from inside one: an error of the local file system holds an
 * app's path, which can name a file `too many deletes.md` or `Must run --resync.md`. A critical
 * error follows `Bisync critical error: `. What follows the words is bisync's own, such as a root or
 * a listing's path in Your Space's sync state, or the marker's name.
 */
const CRITICAL = "(?:Bisync critical error: )?";
const STOPS = {
  tooMany: new RegExp(`^(?:too many deletes \\(>\\d+%, \\d+ of \\d+\\) on (Path1|Path2) |${CRITICAL}too many deletes$)`),
  empty: new RegExp(`^${CRITICAL}[Ee]mpty current (Path1|Path2) listing[.:] `),
  marker: new RegExp(`^(?:Access test failed: Path1 count \\d+, Path2 count \\d+ - |${CRITICAL}check file check failed$)`),
  lock: new RegExp(`^${CRITICAL}prior lock file found: `),
  resync: new RegExp(
    `^(?:Bisync aborted\\. Must run --resync to recover\\.$|${CRITICAL}(?:path1 and path2 are out of sync, run --resync to recover$|cannot find prior Path1 or Path2 listings\\b))`,
  ),
};

/** The side whose marker is missing, from bisync's line about it: its start is bisync's, its end the marker's name. */
const MARKER_MISSING = /^-\s+Access test failed: (Path1|Path2) file not found in (Path1|Path2) - /;

/**
 * What a run's success and log say about it; `error` is the error rclone's remote control gives the
 * job, and `lastError` the last error its stats counted, for a job that succeeded.
 */
export function outcome(success: boolean, lines: LogLine[], error = "", lastError = ""): Outcome {
  // First: its lines hold a path the app named, which could read as any other reason. Then bisync
  // wants a resync, which only the owner chooses here. Whatever bisync reported: for a Drive folder at
  // a link's path that is empty, bisync makes no folder there and reports success, with the error only
  // in the job's stats (rclone 1.75.2), so every run would try again.
  const errors = lines.filter((l) => l.level === "error" || l.level === "critical").map((l) => l.msg.trim());
  const clash = [...(success ? [lastError.trim()] : []), ...errors].find((msg) => ESCAPES.test(msg) || (success && ESCAPED.test(msg)));
  if (clash) return { result: "stopped", reason: "link", message: clash.slice(0, 1000) };
  if (success) return { result: "synced" };
  const failures = failureLines(lines);
  const said = (stop: RegExp) => [...failures, error.trim()].map((msg) => stop.exec(msg)).filter((match) => match !== null);
  const message = (lines.filter((l) => l.level === "error" || l.level === "critical").at(-1)?.msg.trim() ?? failures.at(-1) ?? (error || "rclone didn't say why.")).slice(0, 600);
  // Each line on its own, from its start: never the lines joined, as a path can hold a line break.
  // Its message is Google's refusal as rclone words it, without the request it was for.
  const refusal = [...failures, error.trim()].map((msg) => REFUSED.exec(msg)).find((match) => match !== null);
  if (refusal) return { result: "unauthorized", message: (refusal[1] ?? refusal[2]!).slice(0, 600) };
  const tooMany = said(STOPS.tooMany);
  if (tooMany.length) {
    const onSide = tooMany.find((match) => match[1])?.[1];
    return { result: "stopped", reason: "max_delete", ...(onSide ? { side: side(onSide) } : {}), message };
  }
  const empty = said(STOPS.empty)[0];
  if (empty) return { result: "stopped", reason: "empty", side: side(empty[1]!), message };
  if (said(STOPS.marker).length) {
    const missing = lines.map((l) => MARKER_MISSING.exec(l.msg.trim())).find((m) => m !== null);
    return { result: "stopped", reason: "marker", ...(missing ? { side: side(missing[2]!) } : {}), message };
  }
  if (said(STOPS.lock).length) return { result: "busy", message };
  if (said(STOPS.resync).length) return { result: "stopped", reason: "resync", message };
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
