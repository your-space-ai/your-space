// Synced knowledge bases (journey 014): the runtime manager's rclone bisync job. Its containers are
// hardened and see only the knowledge base's volumes; the remote's configuration reaches only the
// steps that talk to Drive, as their environment, and never a file, an argument or the output. What
// rclone says is read into the owner's outcome. The engine is a fake; the browser tests run real rclone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeStateVolume, knowledgeVolume } from "../src/adapter.ts";
import { deleteKnowledge, INSTALLATION, SpecError } from "../src/apps.ts";
import * as engineModule from "../src/engine.ts";
import {
  bisyncArgs,
  deletionsOf,
  exactPattern,
  fixtureEnabled,
  listingOf,
  logLines,
  MAX_DELETE,
  outcome,
  RCLONE_IMAGE,
  remoteEnv,
  removeSync,
  runFolder,
  runTime,
  sameDeletions,
  secretValues,
  SYNC_HOSTS,
  SYNC_MARKER,
  syncContainer,
  syncKnowledge,
  syncNetwork,
  syncProxyFile,
  tieCopyArgs,
  tiesOf,
  validateSyncRequest,
  type DriveRemote,
} from "../src/sync.ts";

vi.mock("../src/engine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine.ts")>()),
  engine: vi.fn(),
  engineJson: vi.fn(),
  listContainers: vi.fn(),
  docker: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
  pullImage: vi.fn(),
}));

type Json = Record<string, unknown>;

const TOKEN = JSON.stringify({ access_token: "ya29.access-secret", token_type: "Bearer", refresh_token: "1//refresh-secret", expiry: "2026-11-25T18:00:00Z" });
const remote: DriveRemote = { type: "drive", clientId: "1234-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret", token: TOKEN, folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz" };
const SECRETS = [remote.clientSecret, "ya29.access-secret", "1//refresh-secret", TOKEN];
const json = (lines: Json[]) => lines.map((l) => JSON.stringify(l)).join("\n");

describe("a sync request", () => {
  it("names Google Drive, its client and token, a folder, and a mode", () => {
    expect(validateSyncRequest({ remote, mode: "sync" })).toEqual({ remote, mode: "sync" });
    expect(validateSyncRequest({ remote, mode: "force", confirm: [{ side: "local", path: "a.md" }] }).confirm).toEqual([{ side: "local", path: "a.md" }]);
  });

  it("can't select any remote but Drive, the browser tests' stand-in included", () => {
    for (const type of ["fixture", "alias", "local", "s3", undefined]) {
      expect(() => validateSyncRequest({ remote: { ...remote, type }, mode: "sync" }), String(type)).toThrow(SpecError);
    }
    // Nor smuggle another backend's settings into rclone through a field.
    expect(validateSyncRequest({ remote: { ...remote, path: "/etc" }, mode: "sync" }).remote).toEqual(remote);
  });

  it("refuses a folder ID that isn't one, a token without a refresh token, a mode it doesn't know, or force without a list", () => {
    for (const folderId of ["", "root", "../../etc", "1AbC/../../x", "a b c d e f g h i j"]) expect(() => validateSyncRequest({ remote: { ...remote, folderId }, mode: "sync" })).toThrow(/folder/);
    expect(() => validateSyncRequest({ remote: { ...remote, token: JSON.stringify({ access_token: "x" }) }, mode: "sync" })).toThrow(/token/);
    expect(() => validateSyncRequest({ remote: { ...remote, token: "not json" }, mode: "sync" })).toThrow(/token/);
    expect(() => validateSyncRequest({ remote: { ...remote, clientSecret: "has space" }, mode: "sync" })).toThrow(/secret/);
    expect(() => validateSyncRequest({ remote, mode: "bisync --force" })).toThrow(/mode/);
    expect(() => validateSyncRequest({ remote, mode: "force" })).toThrow(/confirmed/);
  });
});

describe("the remote's configuration", () => {
  it("is Drive's, from the environment only, with the drive scope and the folder as its root", () => {
    expect(remoteEnv(remote, false)).toEqual({
      RCLONE_CONFIG_REMOTE_TYPE: "drive",
      RCLONE_CONFIG_REMOTE_CLIENT_ID: remote.clientId,
      RCLONE_CONFIG_REMOTE_CLIENT_SECRET: remote.clientSecret,
      RCLONE_CONFIG_REMOTE_TOKEN: TOKEN,
      RCLONE_CONFIG_REMOTE_SCOPE: "drive",
      RCLONE_CONFIG_REMOTE_ROOT_FOLDER_ID: remote.folderId,
    });
  });

  it("is the browser tests' volume folder only with YS_E2E_SYNC_FIXTURE=1 in the runtime manager's own environment", () => {
    expect(fixtureEnabled({})).toBe(false);
    expect(fixtureEnabled({ YS_E2E_SYNC_FIXTURE: "true" })).toBe(false);
    expect(fixtureEnabled({ YS_E2E_SYNC_FIXTURE: "1" })).toBe(true);
    // The tests' environment doesn't set it, so this is the production default.
    expect(fixtureEnabled()).toBe(false);
    expect(remoteEnv(remote)).toMatchObject({ RCLONE_CONFIG_REMOTE_TYPE: "drive" });
    expect(remoteEnv(remote, true)).toEqual({ RCLONE_CONFIG_REMOTE_TYPE: "alias", RCLONE_CONFIG_REMOTE_REMOTE: `/remote/${remote.folderId}` });
  });

  it("lists every secret the output is cleaned of, the token's parts included", () => {
    expect(Object.values(secretValues(remote))).toEqual(expect.arrayContaining([remote.clientId, ...SECRETS]));
  });
});

describe("a step's container", () => {
  const mounts = [
    { source: knowledgeVolume(INSTALLATION, "notes"), target: "/knowledge" },
    { source: knowledgeStateVolume(INSTALLATION, "notes"), target: "/state" },
  ];

  it("runs the pinned rclone as user 1000, without capabilities, privileges, engine socket, devices or FUSE", () => {
    const body = syncContainer("notes", bisyncArgs("run"), { env: remoteEnv(remote, false), network: syncNetwork(), mounts }) as Json & { HostConfig: Json };
    expect(body.Image).toBe(RCLONE_IMAGE);
    expect(RCLONE_IMAGE).toMatch(/^rclone\/rclone@sha256:[0-9a-f]{64}$/);
    expect(body.User).toBe("1000:1000");
    expect(body.HostConfig).toMatchObject({ ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: syncNetwork() });
    for (const key of ["Binds", "Devices", "CapAdd", "Privileged", "PidMode", "IpcMode", "VolumesFrom"]) expect(body.HostConfig[key], key).toBeUndefined();
    // Only the knowledge base's volumes, never a folder of the machine or the engine's socket.
    expect((body.HostConfig.Mounts as Json[]).map((m) => [m.Type, m.Source])).toEqual(mounts.map((m) => ["volume", m.source]));
    expect(JSON.stringify(body)).not.toContain("docker.sock");
    expect(body.Labels).toEqual({ "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge-sync", "ai.your-space.knowledge": "notes" });
  });

  it("keeps rclone's configuration in memory, goes out through the sync's proxy, and has the secrets only in its environment", () => {
    const body = syncContainer("notes", bisyncArgs("run"), { env: remoteEnv(remote, false), network: syncNetwork(), mounts }) as { Env: string[]; Cmd: string[] };
    expect(body.Env).toContain("RCLONE_CONFIG=/dev/null");
    expect(body.Env).toContain("HTTPS_PROXY=http://ys-egress:3128");
    expect(body.Env).toContain(`RCLONE_CONFIG_REMOTE_CLIENT_SECRET=${remote.clientSecret}`);
    for (const secret of SECRETS) expect(body.Cmd.join(" ")).not.toContain(secret);
  });

  it("has no network and no proxy for a step on the knowledge base alone", () => {
    const body = syncContainer("notes", ["lsjson", "/knowledge"], { mounts }) as { Env: string[]; NetworkDisabled: boolean; HostConfig: Json };
    expect(body.NetworkDisabled).toBe(true);
    expect(body.HostConfig.NetworkMode).toBe("none");
    expect(body.Env.some((e) => e.startsWith("HTTPS_PROXY"))).toBe(false);
  });

  it("runs bisync with the safety checks: the marker, the deletion limit, the lock, and the knowledge base's copy winning", () => {
    const args = bisyncArgs("2026-11-25T17-05-00-123Z");
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(args.slice(0, 3)).toEqual(["bisync", "remote:", "/knowledge"]);
    expect(args).toEqual(expect.arrayContaining(["--check-access", "--resilient", "--recover", "--drive-skip-gdocs", "--create-empty-src-dirs"]));
    // Never a shortcut, which rclone would follow out of the chosen folder: listing, uploading and
    // deleting in the folder or file it points to (https://rclone.org/drive/#shortcuts).
    expect(args).toContain("--drive-skip-shortcuts");
    expect(flag("--check-filename")).toBe(SYNC_MARKER);
    expect(flag("--max-delete")).toBe(String(MAX_DELETE));
    expect(MAX_DELETE).toBe(50);
    expect(flag("--max-lock")).toBe("2m");
    expect(flag("--compare")).toBe("size,modtime,checksum");
    expect(flag("--conflict-resolve")).toBe("path2");
    // State and backups are in the sync's own volume, never in the knowledge base.
    expect(flag("--workdir")).toBe("/state/bisync");
    expect(flag("--backup-dir2")).toBe("/state/backups/2026-11-25T17-05-00-123Z");
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--resync");
    expect(args.some((a) => a.startsWith("--dump") || a === "-vv")).toBe(false);
  });

  it("copies exactly the tie files over Drive's, their names' special characters escaped, and nothing else", () => {
    expect(exactPattern("plan.md")).toBe("/plan.md");
    expect(exactPattern("notes/tie [1] {a} *?.md")).toBe("/notes/tie \\[1] \\{a\\} \\*\\?.md");
    expect(exactPattern("back\\slash.md")).toBe("/back\\\\slash.md");
    const args = tieCopyArgs(["a.md", "dir/b [2].md"]);
    expect(args.slice(0, 3)).toEqual(["copy", "/knowledge", "remote:"]);
    // Whatever the two copies' sizes and times, which rclone's copy would otherwise take as the same.
    expect(args).toEqual(expect.arrayContaining(["--ignore-times", "--drive-skip-gdocs", "--drive-skip-shortcuts"]));
    expect(args.filter((_, i) => args[i - 1] === "--include")).toEqual(["/a.md", "/dir/b \\[2].md"]);
    expect(args.some((a) => a === "--exclude" || a === "--filter" || a.startsWith("--delete") || a === "sync")).toBe(false);
  });
});

describe("the sync's proxy", () => {
  it("is Squid on a sealed network of the sync's own, letting through only Google's token and Drive hosts", () => {
    const file = syncProxyFile("ubuntu/squid@sha256:abc") as { name: string; services: Record<string, Json>; networks: Record<string, Json>; configs: { egress: { content: string } } };
    expect(file.name).toBe(`${INSTALLATION}_knowledge-sync`);
    // Never an app's project, which is ys-<app>.
    expect(file.name).not.toMatch(/^ys-[a-z][a-z0-9-]*$/);
    expect(file.networks.sync).toMatchObject({ internal: true });
    expect(SYNC_HOSTS).toEqual(["oauth2.googleapis.com", "www.googleapis.com"]);
    const config = file.configs.egress.content;
    expect(config).toContain("acl approved dstdomain oauth2.googleapis.com www.googleapis.com");
    expect(config).toContain("http_access deny private");
    expect(config.trimEnd().endsWith("http_access deny all")).toBe(true);
    expect(file.services["ys-egress"]!.labels).toMatchObject({ "ai.your-space.installation": INSTALLATION });
    expect((file.services["ys-egress"]!.labels as Json)["ai.your-space.app"]).toBeUndefined();
  });
});

describe("reading rclone's log", () => {
  const line = (level: string, msg: string) => ({ level, msg });

  it("tells a sync from each stop, Google's refusal, a lock and a failure", () => {
    const cases: [number, Json[], Partial<ReturnType<typeof outcome>>][] = [
      [0, [line("info", "Bisync successful")], { result: "synced" }],
      [1, [line("error", 'too many deletes (>50%, 7 of 13) on Path2 "/knowledge/". Run with --force if desired.')], { result: "stopped", reason: "max_delete", side: "local" }],
      [1, [line("error", 'too many deletes (>50%, 3 of 4) on Path1 "remote:". Run with --force if desired.')], { result: "stopped", reason: "max_delete", side: "remote" }],
      [7, [line("error", "Empty current Path2 listing. Cannot sync to an empty directory: /state/bisync/x.path2.lst-new")], { result: "stopped", reason: "empty", side: "local" }],
      [7, [line("error", "Access test failed: Path1 count 1, Path2 count 0 - .your-space-sync"), line("error", "-                   Access test failed: Path1 file not found in Path2 - .your-space-sync"), line("error", "Bisync critical error: check file check failed")], { result: "stopped", reason: "marker", side: "local" }],
      [7, [line("error", "Bisync critical error: path1 and path2 are out of sync, run --resync to recover")], { result: "stopped", reason: "resync" }],
      [1, [line("error", 'Failed to create file system for "remote:": couldn\'t fetch token: invalid_grant: maybe token expired? - try refreshing with "rclone config reconnect remote:"')], { result: "unauthorized" }],
      [1, [line("error", "googleapi: Error 401: Invalid Credentials, authError")], { result: "unauthorized" }],
      [1, [line("error", "prior lock file found: /state/bisync/x.lck")], { result: "busy" }],
      [1, [line("error", "couldn't list directory: Get \"https://www.googleapis.com/drive/v3/files\": proxyconnect tcp: dial tcp: lookup ys-egress: no such host")], { result: "failed" }],
    ];
    for (const [code, lines, expected] of cases) expect(outcome(code, lines as never), JSON.stringify(lines)).toMatchObject(expected);
    // A file's name never reads as a refusal or a stop, in a run that synced or in one that failed.
    const named = [line("info", "- Path1             File is new                                 - invalid_grant notes.md"), line("notice", "- Path2             Queue copy to Path1                         - remote:Invalid Credentials.md"), line("info", "too many deletes.md: Copied (new)")];
    expect(outcome(0, named as never).result).toBe("synced");
    expect(outcome(1, [...named, line("error", "couldn't list directory")] as never)).toMatchObject({ result: "failed", message: "couldn't list directory" });
    // Nor does a name in bisync's error lines about a file, which would disconnect every synced knowledge base.
    const tie = line("error", "-                   Checksum not equal in listing. Path1: aaa, Path2: bbb - Invalid Credentials checklist.md");
    expect(outcome(7, [tie, line("error", "couldn't list directory"), line("error", "Bisync aborted. Must run --resync to recover.")] as never).result).toBe("stopped");
    expect(outcome(1, [line("error", "-                   Access test failed: Path1 file not found in Path2 - invalid_grant too many deletes.md"), line("error", "couldn't list directory")] as never).result).toBe("failed");
    // rclone's fatal errors are notices.
    expect(outcome(1, [line("notice", "Failed to create file system for \"remote:\": couldn't fetch token: invalid_grant: maybe token expired?")] as never).result).toBe("unauthorized");
    // A network failure on the token endpoint isn't a refusal: the connection stays.
    expect(outcome(1, [line("error", "couldn't fetch token: Post \"https://oauth2.googleapis.com/token\": dial tcp: i/o timeout")] as never).result).toBe("failed");
  });

  it("reads JSON lines, and keeps any other line as a notice", () => {
    expect(logLines(`${JSON.stringify({ level: "info", msg: "a" })}\nplain text\n\n`)).toEqual([
      { level: "info", msg: "a" },
      { level: "notice", msg: "plain text" },
    ]);
  });

  it("finds the deletions on each side, once each, and compares lists in any order", () => {
    const lines = logLines(
      json([
        { level: "info", msg: "- Path1             File was deleted                            - gone on drive.md" },
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
    const stdout = JSON.stringify([
      { Path: "knowledge/plan.md.conflict1", Size: 3 },
      { Path: "knowledge/sub/notes.md.conflict2", Size: 3 },
      { Path: `state/backups/${recent}/a.md`, Size: 5 },
      { Path: `state/backups/${newer}/sub/b.md`, Size: 6 },
      { Path: `state/backups/${old}/c.md`, Size: 7 },
      { Path: "state/backups/someone-elses/d.md", Size: 1 },
    ]);
    expect(listingOf(stdout, now)).toEqual({
      conflicts: ["plan.md.conflict1", "sub/notes.md.conflict2"],
      backups: [
        { run: newer, path: "sub/b.md", size: 6 },
        { run: recent, path: "a.md", size: 5 },
      ],
      expired: [old],
    });
    expect(listingOf("not json", now)).toEqual({ conflicts: [], backups: [], expired: [] });
  });
});

describe("a run", () => {
  let created: { name: string; body: Json & { Env: string[]; Cmd: string[]; HostConfig: Json } }[];
  let removed: string[];
  let composed: string[][];
  let volumes: Map<string, Record<string, string>>;
  /** What each rclone step says, by its first argument; bisync's in order. */
  let logs: Record<string, { stderr: string; stdout?: string; code?: number }[]>;

  beforeEach(() => {
    created = [];
    removed = [];
    composed = [];
    volumes = new Map([[knowledgeVolume(INSTALLATION, "notes"), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "notes" }]]);
    logs = {};
    let next = 0;
    const codes = new Map<string, number>();
    vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "amd64", connection: "unix:///var/run/docker.sock" });
    vi.mocked(engineModule.inspectImage).mockResolvedValue({ ref: "ubuntu/squid:latest", digest: "sha256:squid", platforms: [], runsHere: true });
    // The runtime manager's own container; no step's container is left behind.
    vi.mocked(engineModule.listContainers).mockImplementation(async (labels) => (labels.includes("ai.your-space.role=knowledge-sync") ? [] : [{ Id: "runtime-id", Names: [], State: "running", Status: "", Labels: {} }]));
    vi.mocked(engineModule.engine).mockImplementation(async (method, path, body) => {
      if (path.startsWith("/volumes/")) {
        const name = decodeURIComponent(path.slice("/volumes/".length));
        if (method === "DELETE") return volumes.delete(name) ? { status: 204, body: "" } : { status: 404, body: "" };
        return volumes.has(name) ? { status: 200, body: JSON.stringify({ Name: name, Labels: volumes.get(name) }) } : { status: 404, body: "" };
      }
      if (method === "GET" && path.startsWith("/images/")) return { status: 200, body: "{}" };
      if (method === "POST" && path.startsWith("/containers/create?name=")) {
        const id = `step-${next++}`;
        const b = body as Json & { Env: string[]; Cmd: string[]; HostConfig: Json };
        created.push({ name: decodeURIComponent(path.split("name=")[1]!), body: b });
        const said = logs[b.Cmd[0]!]?.shift();
        codes.set(id, said?.code ?? 0);
        stepLogs.set(id, said ?? { stderr: "" });
        return { status: 201, body: JSON.stringify({ Id: id }) };
      }
      if (method === "DELETE" && path.startsWith("/containers/")) {
        removed.push(path.split("/")[2]!.split("?")[0]!);
        return { status: 204, body: "" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const stepLogs = new Map<string, { stderr: string; stdout?: string }>();
    vi.mocked(engineModule.engineJson).mockImplementation(async (method, path, body) => {
      if (method === "POST" && path === "/volumes/create") {
        const b = body as { Name: string; Labels: Record<string, string> };
        volumes.set(b.Name, b.Labels);
        return {} as never;
      }
      if (method === "GET" && path === "/containers/runtime-id/json") return { Image: "sha256:runtime" } as never;
      // What mounts a volume, which a deletion asks: no step's container is left.
      if (method === "GET" && path.startsWith("/containers/json?")) return [] as never;
      // The volume set-up helper (knowledgeInit), which runs before any step.
      if (method === "POST" && path === "/containers/create") return { Id: "init-id" } as never;
      if (path.startsWith("/containers/") && path.endsWith("/start")) return {} as never;
      if (path.startsWith("/containers/") && path.endsWith("/wait")) return { StatusCode: codes.get(path.split("/")[2]!) ?? 0 } as never;
      throw new Error(`unexpected ${method} ${path}`);
    });
    vi.mocked(engineModule.docker).mockImplementation(async (args) => {
      if (args[0] === "logs") return { code: 0, stdout: stepLogs.get(args[1]!)?.stdout ?? "", stderr: stepLogs.get(args[1]!)?.stderr ?? "" };
      if (args[0] === "compose") {
        composed.push(args);
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected docker ${args.join(" ")}`);
    });
  });

  const steps = () => created.filter((c) => c.name === `${INSTALLATION}.knowledge-sync.notes`);
  const envOf = (step: { body: { Env: string[] } }) => step.body.Env.filter((e) => e.startsWith("RCLONE_CONFIG_REMOTE_"));

  it("starts the proxy, syncs, lists conflicts and backups, removes every container, and keeps secrets out of what it answers", async () => {
    logs.bisync = [{ stderr: json([{ level: "error", msg: `Something mentioned ${remote.clientSecret} and 1//refresh-secret` }]), code: 1 }];
    logs.lsjson = [{ stderr: "", stdout: JSON.stringify([{ Path: "knowledge/a.md.conflict1", Size: 1 }]) }];
    const result = await syncKnowledge("notes", { remote, mode: "sync" });
    expect(result).toMatchObject({ result: "failed", conflicts: ["a.md.conflict1"], listed: true });
    for (const secret of SECRETS) expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.message).toContain("[hidden]");

    // The proxy is Compose's, and its file holds no secret: the secrets go to rclone's container only.
    expect(composed[0]).toEqual(expect.arrayContaining(["-p", `${INSTALLATION}_knowledge-sync`, "up", "-d", "--wait"]));
    for (const secret of SECRETS) expect(composed.flat().join(" ")).not.toContain(secret);
    // A sync state volume of Your Space's, then the bisync step with Drive's configuration, then the
    // listing, with none: it has no network and reads the volumes only.
    expect(volumes.get(knowledgeStateVolume(INSTALLATION, "notes"))).toEqual({ "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge-sync", "ai.your-space.knowledge": "notes" });
    const [bisync, listing] = steps();
    expect(bisync!.body.Cmd[0]).toBe("bisync");
    expect(envOf(bisync!)).toHaveLength(6);
    expect(bisync!.body.HostConfig.NetworkMode).toBe(syncNetwork());
    expect(listing!.body.Cmd[0]).toBe("lsjson");
    expect(envOf(listing!)).toEqual([]);
    expect(listing!.body.HostConfig.NetworkMode).toBe("none");
    expect((listing!.body.HostConfig.Mounts as { ReadOnly: boolean }[]).every((m) => m.ReadOnly)).toBe(true);
    expect(removed).toEqual(expect.arrayContaining(["step-0", "step-1"]));
  });

  it("puts the marker on both sides before a resync, and lets the knowledge base's copy win the ties a resync leaves", async () => {
    const tie = { level: "error", msg: "-                   Checksum not equal in listing. Path1: a, Path2: b - same.md" };
    logs.bisync = [{ stderr: json([tie, { level: "error", msg: "Bisync critical error: path1 and path2 are out of sync, run --resync to recover" }]), code: 7 }, { stderr: json([{ level: "info", msg: "Bisync successful" }]) }];
    const result = await syncKnowledge("notes", { remote, mode: "resync" });
    expect(result).toMatchObject({ result: "synced", ties: ["same.md"], changed: true });
    const [touchHere, touchThere, newer, copy, again] = steps();
    expect(touchHere!.body.Cmd.slice(0, 4)).toEqual(["touch", "--timestamp", "2000-01-01T00:00:00", `/knowledge/${SYNC_MARKER}`]);
    // Only the knowledge base, with no network and no secret.
    expect(envOf(touchHere!)).toEqual([]);
    expect(touchHere!.body.HostConfig.NetworkMode).toBe("none");
    expect(touchThere!.body.Cmd.slice(0, 4)).toEqual(["touch", "--timestamp", "2000-01-01T00:00:00", `remote:${SYNC_MARKER}`]);
    expect(newer!.body.Cmd).toEqual(expect.arrayContaining(["--resync", "--resync-mode", "newer"]));
    // Only the tie is copied over Drive's; then the same resync again, so a file changed on Drive
    // since the first pass still wins as the newer copy, rather than every differing file going to
    // the knowledge base's copy as with `--resync-mode path2`.
    expect(copy!.body.Cmd).toEqual(tieCopyArgs(["same.md"]));
    expect(envOf(copy!)).toHaveLength(6);
    expect(copy!.body.HostConfig.NetworkMode).toBe(syncNetwork());
    expect(again!.body.Cmd).toEqual(newer!.body.Cmd);
    expect(steps().flatMap(({ body: { Cmd } }) => (Cmd.includes("--resync-mode") ? [Cmd[Cmd.indexOf("--resync-mode") + 1]] : []))).toEqual(["newer", "newer"]);
  });

  it("doesn't resync again when copying a tie fails", async () => {
    const tie = { level: "error", msg: "-                   Checksum not equal in listing. Path1: a, Path2: b - same.md" };
    logs.bisync = [{ stderr: json([tie, { level: "error", msg: "Bisync critical error: path1 and path2 are out of sync, run --resync to recover" }]), code: 7 }];
    logs.copy = [{ stderr: json([{ level: "error", msg: "Failed to copy: googleapi: Error 500: backendError" }]), code: 1 }];
    const result = await syncKnowledge("notes", { remote, mode: "resync" });
    expect(result).toMatchObject({ result: "failed", ties: [] });
    expect(steps().filter((s) => s.body.Cmd[0] === "bisync")).toHaveLength(1);
  });

  it("applies deletions only when a dry run lists exactly the ones the owner confirmed", async () => {
    const deleted = { level: "notice", msg: "- Path2             File was deleted                            - a.md" };
    logs.bisync = [{ stderr: json([deleted, { level: "notice", msg: "- Path2             File was deleted                            - b.md" }]) }];
    const changed = await syncKnowledge("notes", { remote, mode: "force", confirm: [{ side: "local", path: "a.md" }] });
    expect(changed).toMatchObject({ result: "stopped", reason: "changed", deletions: [{ side: "local", path: "a.md" }, { side: "local", path: "b.md" }] });
    expect(steps().filter((s) => s.body.Cmd[0] === "bisync").map((s) => s.body.Cmd.includes("--dry-run"))).toEqual([true]);

    created = [];
    logs.bisync = [{ stderr: json([deleted]) }, { stderr: json([{ level: "info", msg: "Bisync successful" }]) }];
    const applied = await syncKnowledge("notes", { remote, mode: "force", confirm: [{ side: "local", path: "a.md" }] });
    expect(applied.result).toBe("synced");
    const runs = steps().filter((s) => s.body.Cmd[0] === "bisync");
    expect(runs.map((s) => [s.body.Cmd.includes("--force"), s.body.Cmd.includes("--dry-run")])).toEqual([
      [true, true],
      [true, false],
    ]);
  });

  it("applies more than 500 deletions when the owner confirmed every one of them", async () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ side: "local" as const, path: `course/week ${i}.md` }));
    const listed = many.map((d) => ({ level: "notice", msg: `- Path2             File was deleted                            - ${d.path}` }));
    logs.bisync = [{ stderr: json(listed) }, { stderr: json([{ level: "info", msg: "Bisync successful" }]) }];
    const request = validateSyncRequest({ remote, mode: "force", confirm: [...many].reverse() });
    expect(request.confirm).toHaveLength(700);
    expect((await syncKnowledge("notes", request)).result).toBe("synced");
    expect(steps().filter((s) => s.body.Cmd[0] === "bisync").map((s) => s.body.Cmd.includes("--dry-run"))).toEqual([true, false]);
  });

  /** Holds the engine at the first request `at` matches, until released. */
  function holdEngineAt(at: (method: string, path: string, body: unknown) => boolean): { reached: Promise<void>; release: () => void } {
    const answer = vi.mocked(engineModule.engine).getMockImplementation()!;
    let release: () => void = () => {};
    let reach: () => void = () => {};
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    let once = false;
    vi.mocked(engineModule.engine).mockImplementation(async (method, path, body) => {
      if (!once && at(method, path, body)) {
        once = true;
        reach();
        await held;
      }
      return answer(method, path, body);
    });
    return { reached, release };
  }

  it("holds the knowledge base before its first step and between steps: neither it nor its sync is deleted meanwhile", async () => {
    // Before its first container: nothing mounts the volume yet, as while rclone's image is pulled.
    const early = holdEngineAt(() => true);
    const first = syncKnowledge("notes", { remote, mode: "sync" });
    await early.reached;
    expect(created).toEqual([]);
    await expect(deleteKnowledge("notes")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("is syncing") });
    await expect(removeSync("notes")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("is syncing") });
    early.release();
    expect((await first).result).toBe("synced");

    // Between bisync and the listing: bisync's container is removed, the listing's isn't made yet.
    created = [];
    const between = holdEngineAt((method, path, body) => method === "POST" && path.startsWith("/containers/create?name=") && (body as { Cmd: string[] }).Cmd[0] === "lsjson");
    const second = syncKnowledge("notes", { remote, mode: "sync" });
    await between.reached;
    expect(steps().map((s) => s.body.Cmd[0])).toEqual(["bisync"]);
    await expect(deleteKnowledge("notes")).rejects.toMatchObject({ status: 409 });
    await expect(removeSync("notes")).rejects.toMatchObject({ status: 409 });
    between.release();
    expect((await second).listed).toBe(true);
    expect(volumes.has(knowledgeVolume(INSTALLATION, "notes"))).toBe(true);
    expect(volumes.has(knowledgeStateVolume(INSTALLATION, "notes"))).toBe(true);

    // Once it ends, the knowledge base and its sync state are deleted.
    await deleteKnowledge("notes");
    expect(volumes.has(knowledgeVolume(INSTALLATION, "notes"))).toBe(false);
    expect(volumes.has(knowledgeStateVolume(INSTALLATION, "notes"))).toBe(false);
  });

  it("starts no run while the knowledge base or its sync is being deleted", async () => {
    volumes.set(knowledgeStateVolume(INSTALLATION, "notes"), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge-sync", "ai.your-space.knowledge": "notes" });
    const deleting = holdEngineAt((_, path) => path.startsWith("/volumes/"));
    const deleted = deleteKnowledge("notes");
    await deleting.reached;
    await expect(syncKnowledge("notes", { remote, mode: "sync" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("being deleted") });
    deleting.release();
    await deleted;
    expect(created).toEqual([]);
    expect(volumes.size).toBe(0);

    const removing = holdEngineAt((_, path) => path.startsWith("/volumes/"));
    const removed = removeSync("notes");
    await removing.reached;
    await expect(syncKnowledge("notes", { remote, mode: "resync" })).rejects.toMatchObject({ status: 409 });
    removing.release();
    await removed;
    expect(created).toEqual([]);
  });

  it("answers busy for a second run of the same knowledge base while one runs", async () => {
    const answer = vi.mocked(engineModule.engine).getMockImplementation()!;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(engineModule.engine).mockImplementation(async (...args) => {
      await held;
      return answer(...args);
    });
    const first = syncKnowledge("notes", { remote, mode: "sync" });
    expect(await syncKnowledge("notes", { remote, mode: "sync" })).toMatchObject({ result: "busy" });
    release();
    expect((await first).result).toBe("synced");
    expect(steps().filter((s) => s.body.Cmd[0] === "bisync")).toHaveLength(1);
  });
});
