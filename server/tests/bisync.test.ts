// Synced knowledge bases (journey 014): what the server asks rclone's remote control to run, and how
// it reads what rclone answers. The browser tests run real rclone; these check the options each run
// carries and the reading of rclone's log, from lines rclone 1.75.2 writes.
import { describe, expect, it } from "vitest";
import {
  backupsOf,
  bisyncParams,
  changedBy,
  conflictsOf,
  deletionsOf,
  exactPattern,
  logLines,
  MAX_DELETE,
  outcome,
  remoteConfig,
  runFolder,
  runTime,
  sameDeletions,
  SYNC_MARKER,
  tieCopyParams,
  tiesOf,
} from "../src/apps/bisync.ts";

type Json = Record<string, unknown>;
const json = (lines: Json[]) => lines.map((l) => JSON.stringify(l)).join("\n");
const TOKEN = JSON.stringify({ access_token: "ya29.access-secret", token_type: "Bearer", refresh_token: "1//refresh-secret", expiry: "2026-11-25T18:00:00Z" });
const remote = { clientId: "1234-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret", token: TOKEN, folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz" };

describe("a knowledge base's remote", () => {
  it("is its Drive folder, through the operator's client and the owner's token, never Google Docs or shortcuts", () => {
    expect(remoteConfig(remote, false)).toEqual({
      type: "drive",
      parameters: {
        client_id: remote.clientId,
        client_secret: remote.clientSecret,
        token: TOKEN,
        scope: "drive",
        root_folder_id: remote.folderId,
        skip_gdocs: true,
        // Never a shortcut, which rclone would follow out of the chosen folder: listing, uploading
        // and deleting in the folder or file it points to (https://rclone.org/drive/#shortcuts).
        skip_shortcuts: true,
      },
    });
  });

  it("is the browser tests' volume folder only when the runtime manager says so, with the same client and token", () => {
    expect(remoteConfig(remote, true)).toEqual({ type: "alias", parameters: { remote: `/remote/${remote.folderId}`, client_id: remote.clientId, client_secret: remote.clientSecret, token: TOKEN } });
  });
});

describe("a run's options", () => {
  it("runs bisync with the safety checks: the marker, the deletion limit, the lock, recovery, and the knowledge base's copy winning", () => {
    const params = bisyncParams("notes", "2026-11-25T17-05-00-123Z");
    expect(params).toEqual({
      path1: "kb-notes:",
      path2: "/knowledge/notes",
      // State and backups are in the sync's own volume, never in the knowledge base.
      workdir: "/state/notes/bisync",
      checkAccess: true,
      checkFilename: SYNC_MARKER,
      maxDelete: MAX_DELETE,
      resilient: true,
      recover: true,
      maxLock: "2m",
      compare: "size,modtime,checksum",
      conflictResolve: "path2",
      backupDir2: "/state/notes/backups/2026-11-25T17-05-00-123Z",
      createEmptySrcDirs: true,
    });
    expect(SYNC_MARKER).toBe(".your-space-sync");
    expect(MAX_DELETE).toBe(50);
  });

  it("copies both ways and deletes nothing for a resync, the newer copy winning; checks deletions with a dry run before forcing them", () => {
    expect(bisyncParams("notes", "r", { resync: true })).toMatchObject({ resync: true, resyncMode: "newer" });
    expect(bisyncParams("notes", "r", { force: true, dryRun: true })).toMatchObject({ force: true, dryRun: true });
    expect(bisyncParams("notes", "r", { force: true })).toMatchObject({ force: true });
    expect(bisyncParams("notes", "r", { force: true }).dryRun).toBeUndefined();
    expect(bisyncParams("notes", "r").force).toBeUndefined();
    expect(bisyncParams("notes", "r").resync).toBeUndefined();
  });

  it("copies exactly the tie files over Drive's, by content and never over a newer copy, their names' special characters escaped", () => {
    expect(exactPattern("plan.md")).toBe("/plan.md");
    expect(exactPattern("notes/tie [1] {a} *?.md")).toBe("/notes/tie \\[1\\] \\{a\\} \\*\\?.md");
    expect(exactPattern("a]b.md")).toBe("/a\\]b.md");
    expect(exactPattern("back\\slash.md")).toBe("/back\\\\slash.md");
    expect(tieCopyParams("notes", ["a.md", "dir/b [2].md"])).toEqual({
      srcFs: "/knowledge/notes",
      dstFs: "kb-notes:",
      _config: { UpdateOlder: true, CheckSum: true },
      _filter: { IncludeRule: ["/a.md", "/dir/b \\[2\\].md"] },
    });
  });
});

describe("reading rclone's log", () => {
  const line = (level: string, msg: string) => ({ level, msg });

  it("tells a sync from each stop, Google's refusal, a lock and a failure", () => {
    const cases: [boolean, Json[], string, Partial<ReturnType<typeof outcome>>][] = [
      [true, [line("info", "Bisync successful")], "", { result: "synced" }],
      [false, [line("error", 'too many deletes (>50%, 7 of 13) on Path2 "/knowledge/notes/". Run with --force if desired.')], "too many deletes", { result: "stopped", reason: "max_delete", side: "local" }],
      [false, [line("error", 'too many deletes (>50%, 3 of 4) on Path1 "kb-notes:". Run with --force if desired.')], "too many deletes", { result: "stopped", reason: "max_delete", side: "remote" }],
      [false, [line("error", "Empty current Path2 listing. Cannot sync to an empty directory: /state/notes/bisync/x.path2.lst-new")], "bisync aborted", { result: "stopped", reason: "empty", side: "local" }],
      [false, [line("error", "Access test failed: Path1 count 1, Path2 count 0 - .your-space-sync"), line("error", "-                   Access test failed: Path1 file not found in Path2 - .your-space-sync"), line("error", "Bisync critical error: check file check failed")], "bisync aborted", { result: "stopped", reason: "marker", side: "local" }],
      [false, [line("error", "Bisync critical error: path1 and path2 are out of sync, run --resync to recover")], "bisync aborted", { result: "stopped", reason: "resync" }],
      // A run interrupted before bisync kept a backup of its listings, as right after a resync.
      [false, [line("error", "Bisync critical error: cannot find prior Path1 or Path2 listings, likely due to critical error on prior run"), line("error", "Bisync aborted. Error is retryable without --resync due to --resilient mode.")], "bisync aborted", { result: "stopped", reason: "resync" }],
      [false, [line("error", 'couldn\'t list directory: Get "https://www.googleapis.com/drive/v3/files": couldn\'t fetch token: invalid_grant: maybe token expired? - try refreshing with "rclone config reconnect kb-notes:"')], "bisync aborted", { result: "unauthorized" }],
      [false, [line("error", "googleapi: Error 401: Invalid Credentials, authError")], "bisync aborted", { result: "unauthorized" }],
      [false, [line("error", "prior lock file found: /state/notes/bisync/x.lck")], "bisync aborted", { result: "busy" }],
      [false, [line("error", 'couldn\'t list directory: Get "https://www.googleapis.com/drive/v3/files": proxyconnect tcp: dial tcp: lookup ys-egress: no such host')], "bisync aborted", { result: "failed" }],
      // A run that failed before it logged anything: rclone's error for the job.
      [false, [], "couldn't fetch token: invalid_grant: maybe token expired?", { result: "unauthorized" }],
      [false, [], "didn't find section in config file", { result: "failed", message: "didn't find section in config file" }],
    ];
    for (const [success, lines, error, expected] of cases) expect(outcome(success, lines as never, error), JSON.stringify(lines)).toMatchObject(expected);
    // A file's name never reads as a refusal or a stop, in a run that synced or in one that failed.
    const named = [line("info", "- Path1             File is new                                 - invalid_grant notes.md"), line("notice", "- Path2             Queue copy to Path1                         - kb-notes:Invalid Credentials.md"), line("info", "too many deletes.md: Copied (new)")];
    expect(outcome(true, named as never).result).toBe("synced");
    expect(outcome(false, [...named, line("error", "couldn't list directory")] as never)).toMatchObject({ result: "failed", message: "couldn't list directory" });
    // Nor does a name in bisync's error lines about a file, which would disconnect every synced knowledge base.
    const tie = line("error", "-                   Checksum not equal in listing. Path1: aaa, Path2: bbb - Invalid Credentials checklist.md");
    expect(outcome(false, [tie, line("error", "couldn't list directory"), line("error", "Bisync aborted. Must run --resync to recover.")] as never).result).toBe("stopped");
    expect(outcome(false, [line("error", "-                   Access test failed: Path1 file not found in Path2 - invalid_grant too many deletes.md"), line("error", "couldn't list directory")] as never).result).toBe("failed");
    // A network failure on the token endpoint isn't a refusal: the connection stays.
    expect(outcome(false, [line("error", "couldn't fetch token: Post \"https://oauth2.googleapis.com/token\": dial tcp: i/o timeout")] as never).result).toBe("failed");
  });

  it("reads JSON lines, and keeps any other line as a notice", () => {
    expect(logLines(`${JSON.stringify({ level: "info", msg: "a" })}\nplain text\n\n`)).toEqual([
      { level: "info", msg: "a" },
      { level: "notice", msg: "plain text" },
    ]);
  });

  it("finds the deletions on each side, once each, a dry run's too, and compares lists in any order", () => {
    const lines = logLines(
      json([
        { level: "info", msg: "- Path1             File was deleted                            - gone on drive.md" },
        // A dry run logs them as notices.
        { level: "notice", msg: "- Path2             File was deleted                            - sub/gone here.md" },
        { level: "info", msg: "- Path2             File was deleted                            - sub/gone here.md" },
        { level: "info", msg: "- Path2             File changed: size (larger), time (newer)    - changed.md" },
      ]),
    );
    const found = deletionsOf(lines);
    expect(found).toEqual([
      { side: "remote", path: "gone on drive.md" },
      { side: "local", path: "sub/gone here.md" },
    ]);
    expect(sameDeletions(found, [...found].reverse())).toBe(true);
    expect(sameDeletions(found, found.slice(1))).toBe(false);
    expect(sameDeletions(found, [{ side: "local", path: "gone on drive.md" }, found[1]!])).toBe(false);
  });

  it("finds the files a resync left different only because both have the same size and time", () => {
    const tie = (path: string) => ({ level: "error", msg: `-                   Checksum not equal in listing. Path1: aaa, Path2: bbb - ${path}` });
    const end = [
      { level: "error", msg: "Bisync critical error: path1 and path2 are out of sync, run --resync to recover" },
      { level: "error", msg: "Bisync aborted. Must run --resync to recover." },
    ];
    expect(tiesOf(logLines(json([tie("a.md"), tie("dir/b.md"), ...end])))).toEqual(["a.md", "dir/b.md"]);
    // A name with " - " in it is the whole name, as rclone 1.75.2 writes it, so the right file is copied.
    const real = { level: "error", msg: "-                   Checksum not equal in listing. Path1: 9448a1bf333fadd2a57965ec38487b89, Path2: e5828c564f71fea3a12dde8bd5d27063 - Lecture 1 - Intro, part 2.md" };
    expect(tiesOf(logLines(json([real, ...end])))).toEqual(["Lecture 1 - Intro, part 2.md"]);
    // Anything else wrong as well, and the knowledge base's copy doesn't replace Drive's.
    expect(tiesOf(logLines(json([tie("a.md"), { level: "error", msg: "couldn't list directory" }, ...end])))).toEqual([]);
  });

  it("tells a run that copied, moved or deleted a file from one that changed nothing, or a dry run", () => {
    expect(changedBy(logLines(json([{ level: "info", msg: "Copied (new)", object: "a.md" }])))).toBe(true);
    expect(changedBy(logLines(json([{ level: "info", msg: "Deleted", object: "a.md" }])))).toBe(true);
    expect(changedBy(logLines(json([{ level: "info", msg: "Moved (server-side) to: a.md.conflict1", object: "a.md" }])))).toBe(true);
    expect(changedBy(logLines(json([{ level: "info", msg: "Bisync successful" }, { level: "info", msg: "There was nothing to transfer" }])))).toBe(false);
    expect(changedBy(logLines(json([{ level: "notice", msg: "Skipped delete as --dry-run is set (size 8)", object: "a.md" }])))).toBe(false);
  });
});

describe("conflict copies and backups", () => {
  it("lists conflict copies, keeps 30 days of backups, newest run first, and names older runs to remove", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const recent = runFolder(new Date("2026-11-20T10:00:00.5Z"));
    const newer = runFolder(new Date("2026-11-24T10:00:00Z"));
    const old = runFolder(new Date("2026-10-01T10:00:00Z"));
    expect(recent).toBe("2026-11-20T10-00-00-500Z");
    expect(runTime(recent)?.toISOString()).toBe("2026-11-20T10:00:00.500Z");
    expect(runTime("not-a-run")).toBeUndefined();
    expect(conflictsOf([{ Path: "sub/notes.md.conflict2", Size: 3 }, { Path: "plan.md.conflict1", Size: 3 }])).toEqual(["plan.md.conflict1", "sub/notes.md.conflict2"]);
    expect(
      backupsOf(
        [
          { Path: `${recent}/a.md`, Size: 5 },
          { Path: `${newer}/sub/b.md`, Size: 6 },
          { Path: `${old}/c.md`, Size: 7 },
          { Path: "someone-elses/d.md", Size: 1 },
        ],
        now,
      ),
    ).toEqual({
      backups: [
        { run: newer, path: "sub/b.md", size: 6 },
        { run: recent, path: "a.md", size: 5 },
      ],
      expired: [old],
    });
  });
});
