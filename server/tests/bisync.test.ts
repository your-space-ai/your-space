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
  linkPathOf,
  localFs,
  backupsFs,
  logLines,
  madeAnyOf,
  MAX_DELETE,
  outcome,
  printedName,
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
      // rclone's local backend with links: a link syncs as a `.rclonelink` file, never followed out.
      path2: ":local,links:/knowledge/notes",
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
      // On the same remote as Path2, by the same string, as bisync wants.
      backupDir2: ":local,links:/state/notes/backups/2026-11-25T17-05-00-123Z",
      createEmptySrcDirs: true,
    });
    expect(SYNC_MARKER).toBe(".your-space-sync");
    expect(MAX_DELETE).toBe(50);
  });

  it("names the local side with links everywhere, so every step of a run uses the same strings, the Drive side never", () => {
    expect(localFs("notes")).toBe(":local,links:/knowledge/notes");
    expect(backupsFs("notes")).toBe(":local,links:/state/notes/backups");
    for (const options of [{}, { resync: true }, { force: true, dryRun: true }, { force: true }]) {
      const params = bisyncParams("notes", "r", options);
      expect(params.path2).toBe(localFs("notes"));
      expect(params.backupDir2).toBe(`${backupsFs("notes")}/r`);
      expect(params.path1).toBe("kb-notes:");
    }
    expect(tieCopyParams("notes", ["a.md"]).srcFs).toBe(localFs("notes"));
    // The Drive remote has no links option; rclone's `links` is the local backend's own.
    expect(JSON.stringify(remoteConfig(remote, false))).not.toMatch(/links/);
  });

  it("keeps the backups on the sync state's mount, never on the knowledge base's", () => {
    // With both on one mount, rclone 1.75.2 moves a replaced file into the backups: a Drive file that
    // replaced a link's .rclonelink is then moved there as the link's backup, the run reports success,
    // and the next run deletes the file in Drive. With the backups on a mount of their own, that move
    // is a copy, which fails: the run stops, with the Drive file on both sides. The runtime manager
    // mounts the sync state as a volume of its own at /state/<name> (runtime/tests/sync.test.ts).
    expect(backupsFs("notes").startsWith(":local,links:/state/notes/")).toBe(true);
    expect(`${backupsFs("notes")}/`.startsWith(`${localFs("notes")}/`)).toBe(false);
    expect(String(bisyncParams("notes", "r").backupDir2).startsWith(`${localFs("notes")}/`)).toBe(false);
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
      srcFs: ":local,links:/knowledge/notes",
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
      [false, [line("error", "googleapi: Error 401: Invalid Credentials, authError")], "bisync aborted", { result: "unauthorized" }],
      [false, [line("error", "prior lock file found: /state/notes/bisync/x.lck")], "bisync aborted", { result: "busy" }],
      [false, [line("error", 'couldn\'t list directory: Get "https://www.googleapis.com/drive/v3/files": proxyconnect tcp: dial tcp: lookup ys-egress: no such host')], "bisync aborted", { result: "failed" }],
      // A run that failed before it logged anything: rclone's error for the job.
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

  it("reads each stop only from bisync's own words at the start of a line, never from an app's file named like them", () => {
    // rclone 1.75.2's words, captured: bisync's critical error for an empty side, and the job's
    // error for a lock held and for the deletion limit, which bisync's lines don't name.
    const empty = [
      line("error", "Empty current Path2 listing. Cannot sync to an empty directory: /state/notes/bisync/x.path2.lst-new"),
      line("error", "Bisync critical error: empty current Path2 listing: /state/notes/bisync/x.path2.lst-new"),
      line("error", "Bisync aborted. Error is retryable without --resync due to --resilient mode."),
    ];
    expect(outcome(false, empty as never, "bisync aborted")).toMatchObject({ result: "stopped", reason: "empty", side: "local" });
    const lock = 'prior lock file found: /state/notes/bisync/x.lck \nTip: this indicates that another bisync run (of these same paths) either is still running or was interrupted before completion. \nIf you\'re SURE you want to override this safety feature, you can delete the lock file with the following command, then run bisync again: \nrclone deletefile "/state/notes/bisync/x.lck"';
    expect(outcome(false, [], lock)).toMatchObject({ result: "busy" });
    expect(outcome(false, [line("notice", "Bisync aborted. Please try again.")] as never, "too many deletes")).toMatchObject({ result: "stopped", reason: "max_delete" });
    // An error of the local file system holds the app's path, as for a file the sync can't read: it
    // fails the run, which is tried again, whatever the file's name says.
    for (const name of [
      'too many deletes (>50%, 1 of 2) on Path1 "kb-notes:". Run with --force if desired.md',
      "too many deletes",
      "Empty current Path1 listing. Cannot sync to an empty directory: x.md",
      "Access test failed: Path1 count 1, Path2 count 0 - .your-space-sync",
      "check file check failed",
      "prior lock file found: x.lck",
      "Bisync aborted. Must run --resync to recover.",
      "path1 and path2 are out of sync, run --resync to recover",
      "cannot find prior Path1 or Path2 listings.md",
    ]) {
      const unreadable = `Failed to sync: reading source directory: open /knowledge/notes/${name}: permission denied`;
      expect(outcome(false, [line("error", unreadable)] as never, "bisync aborted"), name).toMatchObject({ result: "failed" });
      expect(outcome(false, [], `open /knowledge/notes/${name}: permission denied`), name).toMatchObject({ result: "failed" });
    }
  });

  // rclone 1.75.2's lines when Google's token endpoint refuses the refresh, captured with a stand-in
  // for that endpoint (the remote's `token_url`), so Google itself was never asked.
  const URL = "https://www.googleapis.com/drive/v3/files?alt=json&fields=files%28id%2Cname%2Csize%2Cmd5Checksum%2Csha1Checksum%2Csha256Checksum%2Ctrashed%2CexplicitlyTrashed%2CmodifiedTime%2CcreatedTime%2CmimeType%2Cparents%2CwebViewLink%2CshortcutDetails%2CexportLinks%2CresourceKey%29%2CnextPageToken%2CincompleteSearch&includeItemsFromAllDrives=true&pageSize=1000&prettyPrint=false&q=trashed%3Dfalse+and+%28%271AbCdEfGh%27+in+parents%29&supportsAllDrives=true";
  const REFUSALS = {
    invalid_grant: 'invalid_grant: maybe token expired? - try refreshing with "rclone config reconnect kb-kb:"',
    deleted_client: 'deleted_client: maybe token expired? - try refreshing with "rclone config reconnect kb-kb:"',
    invalid_client: "invalid_client: if you're using your own client id/secret, make sure they're properly set up following the docs",
    unauthorized_client: "unauthorized_client: if you're using your own client id/secret, make sure they're properly set up following the docs",
  };
  const listing = (reason: string) => `couldn't list directory: Get "${URL}": couldn't fetch token: ${reason}`;
  /** A run after a resync: its listing of the Drive folder fails first. */
  const normalRun = (reason: string) => [
    { level: "error", msg: `error reading source root directory: ${listing(reason)}`, object: "Google drive root ''" },
    { level: "error", msg: `error during march: ${listing(reason)}`, object: "march" },
    { level: "error", msg: "There were errors while building listings. Aborting as it is too dangerous to continue." },
    { level: "error", msg: `Bisync critical error: ${listing(reason)}` },
    { level: "error", msg: "Bisync aborted. Error is retryable without --resync due to --resilient mode." },
  ];
  /** A resync: its access check fails first. */
  const resync = (reason: string) => [
    { level: "error", msg: `error reading source root directory: ${listing(reason)}`, object: "Google drive root ''" },
    { level: "error", msg: `error during findCheckFiles: ${listing(reason)}` },
    { level: "error", msg: `Bisync critical error: ${listing(reason)}` },
    { level: "error", msg: "Bisync aborted. Must run --resync to recover." },
  ];

  it("reads Google's refusal from where rclone fetched the token, and keeps only that as the message", () => {
    for (const [code, reason] of Object.entries(REFUSALS)) {
      for (const lines of [normalRun(reason), resync(reason)]) {
        expect(outcome(false, logLines(json(lines)), "bisync aborted"), code).toEqual({ result: "unauthorized", message: `couldn't fetch token: ${reason}` });
      }
      // The marker's check before a resync of Your Space's own, as the remote control answers it.
      expect(outcome(false, [], listing(reason)), code).toEqual({ result: "unauthorized", message: `couldn't fetch token: ${reason}` });
    }
    // Google's server failing isn't a refusal: the run failed, and the next one tries again.
    expect(outcome(false, logLines(json(normalRun('oauth2: "internal_failure"'))), "bisync aborted").result).toBe("failed");
    expect(outcome(false, logLines(json(resync('oauth2: "internal_failure"'))), "bisync aborted")).toMatchObject({ result: "stopped", reason: "resync" });
  });

  it("never reads an app's file, named like Google's refusal, as one", () => {
    // rclone 1.75.2's lines for files an app can't let the sync read, or folders it can't let it write
    // into, named like the lines above: user 1234 made them, umask 022, mode 000 for the files.
    const unreadable = (path: string) => [
      { level: "error", msg: `error during march: hash: failed to open: open /knowledge/kb/${path}: permission denied`, object: "march" },
      { level: "error", msg: "There were errors while building listings. Aborting as it is too dangerous to continue." },
      { level: "error", msg: `Bisync critical error: hash: failed to open: open /knowledge/kb/${path}: permission denied` },
      { level: "error", msg: "Bisync aborted. Error is retryable without --resync due to --resilient mode." },
    ];
    for (const path of [
      "invalid_grant notes.md",
      "couldn't fetch token: invalid_grant: x/a.md",
      "n\nBisync critical error: couldn't list directory: couldn't fetch token: invalid_grant: x",
      "googleapi: Error 401: Invalid Credentials, authError",
      // No name holds a `/`, so no path holds the request's `https://`.
      'x: Get "https:/www.googleapis.com/drive": couldn\'t fetch token: invalid_grant: y',
    ]) {
      // A run that failed while listing, which changed nothing and is tried again.
      expect(outcome(false, logLines(json(unreadable(path))), "bisync aborted"), path).toMatchObject({ result: "failed" });
    }
    // A Drive file in a folder the sync can't write into, named like a refusal: bisync wants a resync.
    const partial = "openat couldn't fetch token: invalid_grant/new.md.0cbf105b.partial: permission denied";
    const unwritable = [
      { level: "error", msg: `Failed to copy: ${partial}`, object: "couldn't fetch token: invalid_grant/new.md" },
      { level: "error", msg: "not deleting files as there were IO errors", object: "Local file system at /knowledge/kb" },
      { level: "notice", msg: `Received error: ${partial} - retrying as --resilient is set. Retry 1/3`, object: "copy1to2" },
      { level: "error", msg: `Bisync critical error: ${partial}` },
      { level: "error", msg: "Bisync aborted. Must run --resync to recover." },
    ];
    expect(outcome(false, logLines(json(unwritable)), "bisync aborted")).toMatchObject({ result: "stopped", reason: "resync" });
  });

  it("stops for the owner at a Drive folder where the knowledge base has a link, naming its path, before any other reason", () => {
    // rclone 1.75.2's log of a run with links where Drive has notes/out/planted.txt and notes/out is a
    // link here to the knowledge base's own sync state: it refuses to write through it.
    const escapes = (path: string, op = `mkdirat ${path}: statat ${path}`) => [
      { level: "error", msg: `Failed to copy: ${op}: path escapes from parent`, object: `${path}/planted.txt` },
      { level: "error", msg: "not deleting files as there were IO errors", object: "Local file system at /knowledge/notes" },
      { level: "notice", msg: `Received error: ${op}: path escapes from parent - retrying as --resilient is set. Retry 1/3`, object: "copy1to2" },
      { level: "error", msg: `Bisync critical error: ${op}: path escapes from parent` },
      { level: "error", msg: "Bisync aborted. Must run --resync to recover." },
    ];
    const run = outcome(false, logLines(json(escapes("notes/out"))), "bisync aborted");
    // Not `resync`, which Your Space can run by itself after an interruption.
    expect(run).toEqual({ result: "stopped", reason: "link", message: "Bisync critical error: mkdirat notes/out: statat notes/out: path escapes from parent" });
    expect(linkPathOf(run.message)).toBe("notes/out");
    // A folder under the link, and the folder's time when the folder was there already.
    expect(linkPathOf(outcome(false, logLines(json(escapes("notes/out/deep", "mkdirat notes/out/deep")))).message)).toBe("notes/out/deep");
    const time = [{ level: "error", msg: "Bisync critical error: failed to set directory modtime: chtimesat notes/out: path escapes from parent" }, { level: "error", msg: "Bisync aborted. Must run --resync to recover." }];
    expect(outcome(false, logLines(json(time)))).toMatchObject({ result: "stopped", reason: "link" });
    expect(linkPathOf(outcome(false, logLines(json(time))).message)).toBe("notes/out");
    // A resync with the folder there, or a run with an empty folder under the link.
    const metadata = [{ level: "error", msg: "Bisync critical error: failed to set metadata on directory: failed to set times: chtimesat out: path escapes from parent" }, { level: "error", msg: "Bisync aborted. Must run --resync to recover." }];
    expect(outcome(false, logLines(json(metadata)))).toMatchObject({ result: "stopped", reason: "link" });
    expect(linkPathOf(outcome(false, logLines(json(metadata))).message)).toBe("out");
    // The path is the app's: a link named like Google's refusal, a lock or a stop is still this stop,
    // so it can't disconnect Google, and its whole name is named.
    // rclone keeps a line break in the name as it is in `msg` (in `object` it is ␊).
    for (const name of ["notes/invalid_grant: a b", "prior lock file found", "too many deletes (>50%) on Path1", "x: statat x", "notes/a\ninvalid_grant: b", "a\n"]) {
      const named = outcome(false, logLines(json(escapes(name))), "bisync aborted");
      expect(named, name).toMatchObject({ result: "stopped", reason: "link" });
      expect(linkPathOf(named.message), name).toBe(name);
    }
    expect(linkPathOf(null)).toBeUndefined();
    expect(linkPathOf("Bisync aborted. Must run --resync to recover.")).toBeUndefined();
    // Only bisync's own critical error: the words in a file's line aren't it.
    expect(outcome(false, [{ level: "info", msg: "- Path1             File is new                                 - path escapes from parent" }, { level: "error", msg: "couldn't list directory" }])).toMatchObject({ result: "failed" });
    expect(outcome(true, [{ level: "info", msg: "- Path1             File is new                                 - path escapes from parent" }])).toEqual({ result: "synced" });
    // A run that synced with the error in its log stops the same way.
    expect(outcome(true, logLines(json(escapes("notes/out"))))).toMatchObject({ result: "stopped", reason: "link" });
  });

  it("stops for the owner at an empty Drive folder where the knowledge base has a link, which bisync reports as successful", () => {
    // rclone 1.75.2 over rcd, the knowledge base with a link l to /etc that synced, and an empty Drive
    // folder l beside its l.rclonelink: bisync logs no error and succeeds, and the job's stats count
    // the error. Every run would try again and never make the folder.
    const lines = logLines(
      json([
        { level: "info", msg: "- Path1             File is new                                 - l" },
        { level: "info", msg: "- Path1             Queue copy to Path2                         - :local{b6816}:/knowledge/kb/l" },
        { level: "info", msg: "Making directory", object: "l" },
        { level: "info", msg: "Bisync successful" },
      ]),
    );
    const run = outcome(true, lines, "", "mkdirat l: statat l: path escapes from parent");
    expect(run).toEqual({ result: "stopped", reason: "link", message: "mkdirat l: statat l: path escapes from parent" });
    // The page names the path from the stats' error as from bisync's.
    expect(linkPathOf(run.message)).toBe("l");
    expect(linkPathOf("failed to set metadata on directory: failed to set times: chtimesat out: path escapes from parent")).toBe("out");
    for (const name of ["notes/invalid_grant: a b", "a\ninvalid_grant: b", "x: statat x"]) {
      const named = outcome(true, lines, "", `mkdirat ${name}: statat ${name}: path escapes from parent`);
      expect(named, name).toMatchObject({ result: "stopped", reason: "link" });
      expect(linkPathOf(named.message), name).toBe(name);
    }
    // Any other error such a run counted leaves it synced, as before; so does a failed run's last error alone.
    expect(outcome(true, lines, "", "openat a.md.partial: permission denied")).toEqual({ result: "synced" });
    expect(outcome(true, lines)).toEqual({ result: "synced" });
    expect(outcome(false, [], "bisync aborted", "mkdirat l: statat l: path escapes from parent")).toMatchObject({ result: "failed" });
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

  it("keeps a name's spaces at its end, and reads a name bisync quotes, as rclone 1.75.2 prints them", () => {
    // Captured: a name with a quote is printed as Go quotes it; one with a space at its end as it is.
    const lines = logLines(
      json([
        { level: "notice", msg: '- Path2             File was deleted                            - "draft\\"v2.md"' },
        { level: "notice", msg: "- Path2             File was deleted                            - report.md " },
        { level: "notice", msg: "- Path2             File was deleted                            - report.md" },
        { level: "notice", msg: '- Path1             File was deleted                            - "notes/a\\nb\\t\\\\c\\x1b\\u00e9.md"' },
      ]),
    );
    expect(deletionsOf(lines)).toEqual([
      { side: "local", path: 'draft"v2.md' },
      { side: "local", path: "report.md " },
      { side: "local", path: "report.md" },
      { side: "remote", path: "notes/a\nb\t\\c\u001b\u00e9.md" },
    ]);
    // A list that differs only by a space at a name's end is another list.
    expect(sameDeletions([{ side: "local", path: "report.md " }], [{ side: "local", path: "report.md" }])).toBe(false);
    expect(printedName('"not "go" quoted"')).toBe('"not "go" quoted"');
    expect(printedName('"bad \\q escape"')).toBe('"bad \\q escape"');
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
    // Captured: a name with a quote is printed as Go quotes it, and one with a space at its end as it
    // is; the copy's filter then names the file itself.
    const quoted = { level: "error", msg: '-                   Checksum not equal in listing. Path1: 74b87337454200d4d33f80c4663dc5e5, Path2: 65ba841e01d6db7733e90a5b7f9e6f80 - "tie\\"q.md"' };
    expect(tiesOf(logLines(json([quoted, tie("spaced.md "), ...end])))).toEqual(['tie"q.md', "spaced.md "]);
    expect(tieCopyParams("notes", tiesOf(logLines(json([quoted, ...end]))))._filter).toEqual({ IncludeRule: ['/tie"q.md'] });
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

  it("tells a forced run that deleted any of the owner's deletions, in Drive or into the backups, from one that deleted none of them", () => {
    const deletions = [
      { side: "local" as const, path: "a.md" },
      { side: "remote" as const, path: "notes/b c.md" },
    ];
    expect(madeAnyOf(logLines(json([{ level: "info", msg: "Deleted", object: "a.md" }])), deletions)).toBe(true);
    expect(madeAnyOf(logLines(json([{ level: "info", msg: "Moved into backup dir", object: "notes/b c.md" }])), deletions)).toBe(true);
    expect(madeAnyOf(logLines(json([{ level: "info", msg: "Deleted", object: "other.md" }])), deletions)).toBe(false);
    // A replaced file's old copy moved into the backups, a dry run's skipped deletion, or a line that only lists it.
    expect(madeAnyOf(logLines(json([{ level: "info", msg: "Moved (server-side)", object: "a.md" }])), deletions)).toBe(false);
    expect(madeAnyOf(logLines(json([{ level: "notice", msg: "Skipped delete as --dry-run is set (size 8)", object: "a.md" }])), deletions)).toBe(false);
    expect(madeAnyOf(logLines(json([{ level: "info", msg: "- Path1    Queue delete              - kb-notes:a.md" }])), deletions)).toBe(false);
  });

  it("fails a run, and stops a resync, at a file named like a link's .rclonelink, as rclone 1.75.2 reads it as a link", () => {
    // An app's file report.rclonelink, with no link report beside it.
    const normalRun = [
      { level: "error", msg: "Failed to read link size: readlink /knowledge/kb/report: no such file or directory", object: "report.rclonelink" },
      { level: "error", msg: "error during march: hash: failed to open: readlink /knowledge/kb/report: no such file or directory", object: "march" },
      { level: "error", msg: "There were errors while building listings. Aborting as it is too dangerous to continue." },
      { level: "error", msg: "Bisync critical error: hash: failed to open: readlink /knowledge/kb/report: no such file or directory" },
      { level: "error", msg: "Bisync aborted. Error is retryable without --resync due to --resilient mode." },
    ];
    const resync = [
      { level: "error", msg: "Failed to read link size: readlink /knowledge/kb/report: no such file or directory", object: "report.rclonelink" },
      { level: "error", msg: "Failed to copy: failed to open source object: lstat /knowledge/kb/report: no such file or directory", object: "report.rclonelink" },
      { level: "error", msg: "Bisync critical error: failed to open source object: lstat /knowledge/kb/report: no such file or directory" },
      { level: "error", msg: "Bisync aborted. Must run --resync to recover." },
    ];
    expect(outcome(false, logLines(json(normalRun)), "bisync aborted")).toEqual({ result: "failed", message: "Bisync aborted. Error is retryable without --resync due to --resilient mode." });
    expect(outcome(false, logLines(json(resync)), "bisync aborted")).toEqual({ result: "stopped", reason: "resync", message: "Bisync aborted. Must run --resync to recover." });
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
