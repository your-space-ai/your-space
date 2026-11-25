// Synced knowledge bases (journey 014): the runtime manager runs one long-running container of stock
// `rclone rcd` for every synced knowledge base, and its outbound proxy. The container is hardened, sees
// only the synced knowledge bases' volumes, their sync state and the socket only the server shares, and
// has no secret: the server creates the remotes over the socket, and the runtime manager takes only the
// knowledge bases' names. Changing them recreates it; stopping Your Space stops it as Ctrl+C stops
// rclone. The engine is a fake; the browser tests run real rclone.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeStateVolume, knowledgeSyncLabels, knowledgeVolume } from "../src/adapter.ts";
import { deleteKnowledge, INSTALLATION, stopAll } from "../src/apps.ts";
import * as engineModule from "../src/engine.ts";
import {
  ensureSyncService,
  fixtureEnabled,
  RC_SOCKET,
  RCLONE_IMAGE,
  rcloneCommand,
  rcloneImage,
  removeSync,
  restartSyncService,
  stopSyncs,
  SYNC_HOSTS,
  syncNetwork,
  syncProject,
  syncServiceFile,
  validateSyncService,
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
interface ComposeFile {
  name: string;
  services: Record<string, Json & { volumes?: { source: string; target: string }[]; environment?: Record<string, string>; command?: string[]; labels?: Record<string, string> }>;
  networks: Record<string, Json>;
  volumes: Record<string, { external: boolean; name: string }>;
  configs: { egress: { content: string } };
}

const SOCKET_VOLUME = `${INSTALLATION}_ys-sync`;
const file = (bases: string[], fixture = false) => syncServiceFile({ squid: "ubuntu/squid@sha256:squid", rclone: RCLONE_IMAGE, socketVolume: SOCKET_VOLUME, knowledgeBases: bases, fixture }) as unknown as ComposeFile;

describe("the sync's container", () => {
  it("runs stock rclone, pinned to its digest, as user 1000, without capabilities, privileges, engine socket, devices or FUSE", () => {
    const rclone = file(["notes"]).services.rclone!;
    expect(rclone.image).toBe(RCLONE_IMAGE);
    expect(RCLONE_IMAGE).toMatch(/^rclone\/rclone@sha256:[0-9a-f]{64}$/);
    expect(rclone).toMatchObject({ user: "1000:1000", read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], restart: "unless-stopped" });
    for (const key of ["privileged", "cap_add", "devices", "pid", "network_mode", "ipc"]) expect(rclone[key], key).toBeUndefined();
    expect(JSON.stringify(rclone)).not.toMatch(/docker\.sock|\/dev\/fuse|SYS_ADMIN/);
    // Stopped as Ctrl+C stops rclone: bisync's graceful shutdown, which saves a run's state.
    expect(rclone).toMatchObject({ stop_signal: "SIGINT", stop_grace_period: "100s" });
  });

  it("runs only rclone's remote control, with its configuration in memory, on a socket in the volume only the server shares", () => {
    const rclone = file(["notes"]).services.rclone!;
    expect(rclone.entrypoint).toEqual(["/bin/sh", "-c"]);
    expect(rclone.command).toEqual([rcloneCommand()]);
    // A socket an earlier container left is removed first: rclone wouldn't start beside it.
    expect(rcloneCommand()).toBe(
      `rm -f ${RC_SOCKET} && exec rclone rcd --config '' --rc-addr unix://${RC_SOCKET} --rc-no-auth --rc-job-expire-duration 1h -v --use-json-log --color NEVER`,
    );
    expect(RC_SOCKET).toBe("/run/ys-sync/rc.sock");
    expect(rclone.volumes![0]).toMatchObject({ source: "socket", target: "/run/ys-sync" });
    expect(file(["notes"]).volumes.socket).toEqual({ external: true, name: SOCKET_VOLUME });
    expect(rclone.healthcheck).toMatchObject({ test: ["CMD", "rclone", "rc", "--unix-socket", RC_SOCKET, "rc/noop"] });
  });

  it("has no secret: no remote, token or client in its environment, command or labels", () => {
    const rclone = file(["notes", "recipes"]).services.rclone!;
    expect(Object.keys(rclone.environment!).sort()).toEqual(["HOME", "HTTPS_PROXY", "HTTP_PROXY"]);
    expect(JSON.stringify(rclone)).not.toMatch(/RCLONE_CONFIG|token|client_secret|client_id|refresh/i);
  });

  it("mounts each synced knowledge base and its sync state, and the browser tests' remote only with their flag", () => {
    const rclone = file(["notes", "recipes"]).services.rclone!;
    expect(rclone.volumes!.map((v) => `${v.source}:${v.target}`)).toEqual([
      "socket:/run/ys-sync",
      "kb-notes:/knowledge/notes",
      "state-notes:/state/notes",
      "kb-recipes:/knowledge/recipes",
      "state-recipes:/state/recipes",
    ]);
    expect(file(["notes"]).volumes["kb-notes"]).toEqual({ external: true, name: knowledgeVolume(INSTALLATION, "notes") });
    expect(file(["notes"]).volumes["state-notes"]).toEqual({ external: true, name: knowledgeStateVolume(INSTALLATION, "notes") });
    expect(rclone.labels!["ai.your-space.knowledge-bases"]).toBe("notes,recipes");
    expect(file(["notes"]).volumes.fixture).toBeUndefined();
    expect(file(["notes"], true).services.rclone!.volumes!.at(-1)).toMatchObject({ source: "fixture", target: "/remote" });
    expect(fixtureEnabled({})).toBe(false);
    expect(fixtureEnabled({ YS_E2E_SYNC_FIXTURE: "1" })).toBe(true);
  });

  it("reaches Google only through Squid on a sealed network of its own, which lets through only the token and Drive hosts", () => {
    const sync = file(["notes"]);
    expect(sync.name).toBe(`${INSTALLATION}_knowledge-sync`);
    // Never an app's project, which is ys-<app>.
    expect(sync.name).not.toMatch(/^ys-[a-z][a-z0-9-]*$/);
    expect(syncNetwork()).toBe(`${syncProject()}_sync`);
    expect(sync.services.rclone!.networks).toEqual({ sync: {} });
    expect(sync.networks.sync).toMatchObject({ internal: true });
    expect(sync.services.rclone!.environment).toMatchObject({ HTTPS_PROXY: "http://ys-egress:3128", HTTP_PROXY: "http://ys-egress:3128" });
    expect(SYNC_HOSTS).toEqual(["oauth2.googleapis.com", "www.googleapis.com"]);
    const config = sync.configs.egress.content;
    expect(config).toContain("acl approved dstdomain oauth2.googleapis.com www.googleapis.com");
    expect(config).toContain("http_access deny private");
    expect(config.trimEnd().endsWith("http_access deny all")).toBe(true);
    expect(sync.services["ys-egress"]!.labels).toMatchObject({ "ai.your-space.installation": INSTALLATION });
    expect((sync.services["ys-egress"]!.labels as Json)["ai.your-space.app"]).toBeUndefined();
  });

  it("is the image the release's Compose file pins, and refuses any other", () => {
    const stack = readFileSync(new URL("../../deploy/stack.yaml", import.meta.url), "utf8");
    expect(/^\s+YS_SYNC_IMAGE: (\S+)$/m.exec(stack)?.[1]).toBe(RCLONE_IMAGE);
    expect(rcloneImage({})).toBe(RCLONE_IMAGE);
    expect(rcloneImage({ YS_SYNC_IMAGE: `rclone/rclone:1.75.2@sha256:${"a".repeat(64)}` })).toBe(`rclone/rclone:1.75.2@sha256:${"a".repeat(64)}`);
    for (const image of ["rclone/rclone:latest", "rclone/rclone:1.75.2", `evil/rclone@sha256:${"a".repeat(64)}`, `rclone/rclone@sha256:${"a".repeat(63)}`]) {
      expect(() => rcloneImage({ YS_SYNC_IMAGE: image }), image).toThrow(/pinned/);
    }
  });
});

describe("the server's request", () => {
  it("names the knowledge bases to sync, and nothing else: never a remote, a client or a token", () => {
    expect(validateSyncService({ knowledgeBases: ["recipes", "notes", "notes"] })).toEqual(["notes", "recipes"]);
    expect(validateSyncService({ knowledgeBases: [] })).toEqual([]);
    expect(() => validateSyncService({ knowledgeBases: ["notes"], token: "secret" })).toThrow(/token isn't a field/);
    expect(() => validateSyncService({ knowledgeBases: ["Notes"] })).toThrow();
    expect(() => validateSyncService({ knowledgeBases: ["../x"] })).toThrow();
    expect(() => validateSyncService({})).toThrow(/Name the knowledge bases/);
  });
});

describe("running the sync's container", () => {
  let volumes: Map<string, Record<string, string>>;
  let composed: { args: string[]; file?: ComposeFile }[];
  let inits: string[];
  let containers: engineModule.ContainerSummary[];
  /** Holds Compose's `up` until released, to catch the service being started. */
  let holdUp: Promise<void> | undefined;

  beforeEach(() => {
    volumes = new Map([
      [knowledgeVolume(INSTALLATION, "notes"), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "notes" }],
      [knowledgeVolume(INSTALLATION, "recipes"), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "recipes" }],
    ]);
    composed = [];
    inits = [];
    containers = [];
    holdUp = undefined;
    vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "amd64", connection: "unix:///var/run/docker.sock" });
    vi.mocked(engineModule.inspectImage).mockResolvedValue({ ref: "ubuntu/squid:latest", digest: "sha256:squid", platforms: [], runsHere: true });
    vi.mocked(engineModule.pullImage).mockResolvedValue();
    vi.mocked(engineModule.listContainers).mockImplementation(async (labels) => {
      if (labels.includes("com.docker.compose.service=runtime")) return [{ Id: "runtime-id", Names: [], State: "running", Status: "", Labels: {} }];
      if (labels.some((l) => l === `com.docker.compose.project=${syncProject()}`)) return containers.filter((c) => !labels.includes("com.docker.compose.service=rclone") || c.Id === "rclone");
      // What mounts a knowledge base: the sync's container, when it runs.
      return [];
    });
    vi.mocked(engineModule.engine).mockImplementation(async (method, path) => {
      if (path.startsWith("/volumes/")) {
        const name = decodeURIComponent(path.slice("/volumes/".length));
        if (method === "DELETE") return volumes.delete(name) ? { status: 204, body: "" } : { status: 404, body: "" };
        return volumes.has(name) ? { status: 200, body: JSON.stringify({ Name: name, Labels: volumes.get(name) }) } : { status: 404, body: "" };
      }
      if (method === "GET" && path.startsWith("/images/")) return { status: 200, body: "{}" };
      if (method === "DELETE" && path.startsWith("/containers/")) return { status: 204, body: "" };
      throw new Error(`unexpected ${method} ${path}`);
    });
    vi.mocked(engineModule.engineJson).mockImplementation(async (method, path, body) => {
      if (method === "GET" && path.startsWith("/volumes?filters=")) {
        const wanted = JSON.parse(decodeURIComponent(path.split("filters=")[1]!)) as { label: string[] };
        expect(wanted.label).toEqual([`com.docker.compose.project=${INSTALLATION}`, "com.docker.compose.volume=ys-sync"]);
        return { Volumes: [{ Name: SOCKET_VOLUME }] } as never;
      }
      if (method === "POST" && path === "/volumes/create") {
        const b = body as { Name: string; Labels: Record<string, string> };
        volumes.set(b.Name, b.Labels);
        return {} as never;
      }
      if (method === "GET" && path === "/containers/runtime-id/json") return { Image: "sha256:runtime" } as never;
      if (method === "GET" && path.startsWith("/containers/json?")) {
        const wanted = JSON.parse(decodeURIComponent(path.split("filters=")[1]!)) as { volume: string[] };
        return containers.filter((c) => c.Mounts?.some((m) => wanted.volume.includes(m.Name ?? ""))) as never;
      }
      if (method === "POST" && path === "/containers/create") {
        const b = body as { Cmd: string[]; HostConfig: { Mounts: { Source: string }[] } };
        inits.push(`${b.HostConfig.Mounts[0]!.Source} ${b.Cmd[0]!}`);
        return { Id: "init-id" } as never;
      }
      if (path === "/containers/init-id/start") return {} as never;
      if (path === "/containers/init-id/wait") return { StatusCode: 0 } as never;
      throw new Error(`unexpected ${method} ${path}`);
    });
    vi.mocked(engineModule.docker).mockImplementation(async (args) => {
      const f = args.indexOf("-f");
      const entry = { args, file: f > 0 ? (JSON.parse(readFileSync(args[f + 1]!, "utf8")) as ComposeFile) : undefined };
      composed.push(entry);
      if (args.includes("up")) {
        await holdUp;
        const bases = entry.file!.services.rclone!.labels!["ai.your-space.knowledge-bases"]!;
        const mounts = entry.file!.services.rclone!.volumes!.map((v) => ({ Type: "volume", Name: entry.file!.volumes[v.source]!.name }));
        containers = [{ Id: "rclone", Names: [], State: "running", Status: "", Labels: { "ai.your-space.role": "knowledge-sync", "ai.your-space.knowledge-bases": bases }, Mounts: mounts }];
      }
      if (args.includes("down")) containers = [];
      if (args.includes("stop")) containers = containers.map((c) => ({ ...c, State: "exited" }));
      return { code: 0, stdout: "", stderr: "" };
    });
  });

  it("makes each knowledge base's sync state, gives the socket's volume to user 1000 alone, and answers once rclone answers", async () => {
    const service = await ensureSyncService(["notes"]);
    expect(service).toEqual({ running: true, knowledgeBases: ["notes"], fixture: false, socket: RC_SOCKET });
    const state = knowledgeStateVolume(INSTALLATION, "notes");
    expect(volumes.get(state)).toEqual(knowledgeSyncLabels(INSTALLATION, "notes"));
    expect(inits).toEqual([`${state} chown 1000:1000 /knowledge && chmod 0700 /knowledge`, `${SOCKET_VOLUME} chown 1000:1000 /knowledge && chmod 0700 /knowledge`]);
    const up = composed.at(-1)!;
    expect(up.args).toEqual(expect.arrayContaining(["compose", "-p", syncProject(), "up", "-d", "--wait", "--remove-orphans", "--pull", "never"]));
    expect(up.file!.services.rclone!.image).toBe(RCLONE_IMAGE);
  });

  it("changes the mounts when a knowledge base is connected or disconnected, which Compose recreates it for, and removes it with none", async () => {
    await ensureSyncService(["notes"]);
    await ensureSyncService(["notes", "recipes"]);
    expect(composed.at(-1)!.file!.services.rclone!.volumes!.map((v) => v.target)).toEqual(["/run/ys-sync", "/knowledge/notes", "/state/notes", "/knowledge/recipes", "/state/recipes"]);
    await ensureSyncService(["recipes"]);
    expect(composed.at(-1)!.file!.services.rclone!.volumes!.map((v) => v.target)).toEqual(["/run/ys-sync", "/knowledge/recipes", "/state/recipes"]);
    expect(await ensureSyncService([])).toMatchObject({ running: false, knowledgeBases: [] });
    expect(composed.at(-1)!.args).toEqual(["compose", "-p", syncProject(), "down", "--remove-orphans"]);
  });

  it("refuses a knowledge base that isn't on the engine, or a state volume Your Space didn't make", async () => {
    await expect(ensureSyncService(["missing"])).rejects.toMatchObject({ status: 404 });
    volumes.set(knowledgeStateVolume(INSTALLATION, "notes"), { "ai.your-space.installation": "someone-else" });
    await expect(ensureSyncService(["notes"])).rejects.toMatchObject({ status: 409 });
    expect(composed).toEqual([]);
  });

  it("holds the knowledge bases while it starts, so none of them is deleted under it", async () => {
    let release: () => void = () => {};
    holdUp = new Promise((resolve) => (release = resolve));
    const starting = ensureSyncService(["notes"]);
    for (let i = 0; i < 50 && !composed.some((c) => c.args.includes("up")); i++) await new Promise((r) => setTimeout(r, 5));
    await expect(deleteKnowledge("notes")).rejects.toMatchObject({ status: 409 });
    release();
    await starting;
    // Mounted by the sync's container, it isn't deleted, nor is its state removed.
    await expect(deleteKnowledge("notes")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("is still synced") });
    await expect(removeSync("notes")).rejects.toMatchObject({ status: 409 });
    await ensureSyncService(["recipes"]);
    await removeSync("notes");
    expect(volumes.has(knowledgeStateVolume(INSTALLATION, "notes"))).toBe(false);
  });

  it("restarts rclone as Ctrl+C stops it, for a run past its time", async () => {
    await ensureSyncService(["notes"]);
    await restartSyncService();
    expect(composed.at(-1)!.args).toEqual(["compose", "-p", syncProject(), "restart", "rclone"]);
  });

  it("stops with Your Space's apps as Ctrl+C stops rclone, then starts nothing", async () => {
    await ensureSyncService(["notes"]);
    await expect(stopSyncs()).rejects.toThrow(/only once Your Space is stopping/);
    await stopAll();
    await stopSyncs();
    expect(composed.at(-1)!.args).toEqual(["compose", "-p", syncProject(), "stop", "-t", "100"]);
    await expect(ensureSyncService(["notes"])).rejects.toMatchObject({ status: 409, message: expect.stringContaining("stopping") });
    await expect(restartSyncService()).rejects.toMatchObject({ status: 409 });
  });
});
