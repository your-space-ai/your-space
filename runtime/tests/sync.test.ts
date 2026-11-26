// Synced knowledge bases (journey 014): the runtime manager runs a long-running container of stock
// `rclone rcd` for each synced knowledge base, and their outbound proxy. Each is hardened, sees only its
// knowledge base's volume, its sync state and its own folder of the socket volume only the server
// shares whole, and has no secret: the server creates the remote over the socket, and the runtime
// manager takes only the knowledge bases' names. Connecting or disconnecting one adds or removes its
// container only; stopping Your Space stops them as Ctrl+C stops rclone. The engine is a fake; the
// browser tests run real rclone.
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
  rcloneService,
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
const rcloneOf = (f: ComposeFile, name = "notes") => f.services[rcloneService(name)]!;

describe("the sync's containers", () => {
  it("runs stock rclone, pinned to its digest, as user 1000, without capabilities, privileges, engine socket, devices or FUSE", () => {
    const rclone = rcloneOf(file(["notes"]));
    expect(rclone.image).toBe(RCLONE_IMAGE);
    expect(RCLONE_IMAGE).toMatch(/^rclone\/rclone@sha256:[0-9a-f]{64}$/);
    expect(rclone).toMatchObject({ user: "1000:1000", read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], restart: "unless-stopped" });
    for (const key of ["privileged", "cap_add", "devices", "pid", "network_mode", "ipc"]) expect(rclone[key], key).toBeUndefined();
    expect(JSON.stringify(rclone)).not.toMatch(/docker\.sock|\/dev\/fuse|SYS_ADMIN/);
    // Stopped as Ctrl+C stops rclone: bisync's graceful shutdown, which saves a run's state.
    expect(rclone).toMatchObject({ stop_signal: "SIGINT", stop_grace_period: "100s" });
  });

  it("runs only rclone's remote control, with its configuration in memory, on a socket in its own folder of the volume only the server shares", () => {
    const rclone = rcloneOf(file(["notes"]));
    expect(rclone.entrypoint).toEqual(["/bin/sh", "-c"]);
    expect(rclone.command).toEqual([rcloneCommand()]);
    // Whatever an earlier container left there is removed first: rclone wouldn't start beside it.
    expect(rcloneCommand()).toBe(
      `rm -rf ${RC_SOCKET} && exec rclone rcd --config '' --rc-addr unix://${RC_SOCKET} --rc-no-auth --rc-job-expire-duration 1h -v --use-json-log --color NEVER`,
    );
    expect(RC_SOCKET).toBe("/run/ys-sync/rc.sock");
    // The folder of the socket volume named after the knowledge base: the server reaches it at /run/ys-sync/notes/rc.sock.
    expect(rclone.volumes![0]).toMatchObject({ source: "socket", target: "/run/ys-sync", volume: { nocopy: true, subpath: "notes" } });
    expect(file(["notes"]).volumes.socket).toEqual({ external: true, name: SOCKET_VOLUME });
    expect(rclone.healthcheck).toMatchObject({ test: ["CMD", "rclone", "rc", "--unix-socket", RC_SOCKET, "rc/noop"] });
  });

  it("runs in the engine's own user name space only when the server does, so the socket's user is the same to both", () => {
    expect(rcloneOf(file(["notes"])).userns_mode).toBeUndefined();
    const usernsHost = syncServiceFile({ squid: "ubuntu/squid@sha256:squid", rclone: RCLONE_IMAGE, socketVolume: SOCKET_VOLUME, knowledgeBases: ["notes"], fixture: false, usernsHost: true }) as unknown as ComposeFile;
    expect(rcloneOf(usernsHost).userns_mode).toBe("host");
  });

  it("has no secret: no remote, token or client in its environment, command or labels", () => {
    for (const name of ["notes", "recipes"]) {
      const rclone = rcloneOf(file(["notes", "recipes"]), name);
      expect(Object.keys(rclone.environment!).sort()).toEqual(["HOME", "HTTPS_PROXY", "HTTP_PROXY"]);
      expect(JSON.stringify(rclone)).not.toMatch(/RCLONE_CONFIG|token|client_secret|client_id|refresh/i);
    }
  });

  it("gives each knowledge base a container of its own, which mounts only it, its sync state and its socket's folder", () => {
    // rclone writes through a symbolic link to a folder: an app given one knowledge base could
    // otherwise have a sync write into another, or over its listings or socket.
    const both = file(["notes", "recipes"]);
    expect(Object.keys(both.services).sort()).toEqual(["rclone-notes", "rclone-recipes", "ys-egress"]);
    for (const name of ["notes", "recipes"]) {
      expect(rcloneOf(both, name).volumes!.map((v) => `${v.source}:${v.target}`)).toEqual([`socket:/run/ys-sync`, `kb-${name}:/knowledge/${name}`, `state-${name}:/state/${name}`]);
      expect((rcloneOf(both, name).volumes![0] as unknown as { volume: { subpath: string } }).volume.subpath).toBe(name);
    }
    expect(both.volumes["kb-notes"]).toEqual({ external: true, name: knowledgeVolume(INSTALLATION, "notes") });
    expect(both.volumes["state-notes"]).toEqual({ external: true, name: knowledgeStateVolume(INSTALLATION, "notes") });
    // Its own name only, so another's change leaves its container as it is.
    expect(rcloneOf(both).labels).toMatchObject({ "ai.your-space.knowledge": "notes", "ai.your-space.role": "knowledge-sync" });
    expect(rcloneOf(both)).toEqual(rcloneOf(file(["notes"])));
  });

  it("mounts the browser tests' remote only with their flag", () => {
    expect(file(["notes"]).volumes.fixture).toBeUndefined();
    expect(rcloneOf(file(["notes"], true)).volumes!.at(-1)).toMatchObject({ source: "fixture", target: "/remote" });
    expect(fixtureEnabled({})).toBe(false);
    expect(fixtureEnabled({ YS_E2E_SYNC_FIXTURE: "1" })).toBe(true);
  });

  it("reaches Google only through Squid on a sealed network of its own, which lets through only the token and Drive hosts", () => {
    const sync = file(["notes"]);
    expect(sync.name).toBe(`${INSTALLATION}_knowledge-sync`);
    // Never an app's project, which is ys-<app>.
    expect(sync.name).not.toMatch(/^ys-[a-z][a-z0-9-]*$/);
    expect(syncNetwork()).toBe(`${syncProject()}_sync`);
    expect(rcloneOf(sync).networks).toEqual({ sync: {} });
    expect(sync.networks.sync).toMatchObject({ internal: true });
    expect(rcloneOf(sync).environment).toMatchObject({ HTTPS_PROXY: "http://ys-egress:3128", HTTP_PROXY: "http://ys-egress:3128" });
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

describe("running the sync's containers", () => {
  let volumes: Map<string, Record<string, string>>;
  let composed: { args: string[]; file?: ComposeFile }[];
  let inits: string[];
  let containers: engineModule.ContainerSummary[];
  /** Holds Compose's `up` until released, to catch the service being started. */
  let holdUp: Promise<void> | undefined;
  /** A Compose command that fails, by its subcommand, as on an engine that stopped answering. */
  let composeFails: string | undefined;
  let created = 0;

  beforeEach(() => {
    volumes = new Map([
      [knowledgeVolume(INSTALLATION, "notes"), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "notes" }],
      [knowledgeVolume(INSTALLATION, "recipes"), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "recipes" }],
    ]);
    composed = [];
    inits = [];
    containers = [];
    holdUp = undefined;
    composeFails = undefined;
    vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "amd64", connection: "unix:///var/run/docker.sock" });
    vi.mocked(engineModule.inspectImage).mockResolvedValue({ ref: "ubuntu/squid:latest", registry: "docker.io", digest: "sha256:squid", platforms: [], runsHere: true });
    vi.mocked(engineModule.pullImage).mockResolvedValue();
    vi.mocked(engineModule.listContainers).mockImplementation(async (labels) => {
      if (labels.includes("com.docker.compose.service=runtime")) return [{ Id: "runtime-id", Names: [], State: "running", Status: "", Labels: {} }];
      if (labels.some((l) => l === `com.docker.compose.project=${syncProject()}`)) return containers.filter((c) => !labels.includes("ai.your-space.knowledge") || c.Labels["ai.your-space.knowledge"]);
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
      if (composeFails && args.includes(composeFails)) return { code: 1, stdout: "", stderr: "the engine failed" };
      // Compose as it treats services: one named is the only one changed; a container whose service
      // is unchanged keeps its ID; one whose service is gone is removed.
      const named = args.slice(args.findIndex((a) => a === "up" || a === "stop" || a === "restart") + 1).filter((a) => a.startsWith("rclone-"));
      if (args.includes("up") && !args.includes("--no-recreate")) {
        await holdUp;
        const services = Object.entries(entry.file!.services).filter(([service]) => service.startsWith("rclone-"));
        const kept = new Map(containers.map((c) => [c.Labels["com.docker.compose.service"]!, c]));
        containers = services.map(([service, spec]) => {
          const was = kept.get(service);
          const config = JSON.stringify(spec);
          if (was && was.Labels.config === config) return { ...was, State: "running" };
          const mounts = spec.volumes!.map((v) => ({ Type: "volume", Name: entry.file!.volumes[v.source]!.name }));
          return { Id: `${service}-${++created}`, Names: [], State: "running", Status: "", Labels: { ...spec.labels, "com.docker.compose.service": service, config }, Mounts: mounts };
        });
      }
      if (args.includes("down")) containers = [];
      if (args.includes("stop")) containers = containers.map((c) => (named.length === 0 || named.includes(c.Labels["com.docker.compose.service"]!) ? { ...c, State: "exited" } : c));
      return { code: 0, stdout: "", stderr: "" };
    });
  });

  it("makes each knowledge base's sync state, gives each its socket's folder for user 1000 alone, and answers once its rclone answers", async () => {
    const service = await ensureSyncService(["notes"]);
    expect(service).toEqual({ knowledgeBases: ["notes"], running: ["notes"], fixture: false });
    const state = knowledgeStateVolume(INSTALLATION, "notes");
    expect(volumes.get(state)).toEqual(knowledgeSyncLabels(INSTALLATION, "notes"));
    expect(inits).toEqual([
      `${state} chown 1000:1000 /knowledge && chmod 0700 /knowledge`,
      `${SOCKET_VOLUME} chown 1000:1000 /knowledge && chmod 0700 /knowledge && mkdir -p /knowledge/notes && chown 1000:1000 /knowledge/notes && chmod 0700 /knowledge/notes`,
    ]);
    const [up, wait] = composed.slice(-2);
    expect(up!.args.slice(-5)).toEqual(["up", "-d", "--remove-orphans", "--pull", "never"]);
    expect(rcloneOf(up!.file!).image).toBe(RCLONE_IMAGE);
    // Only the new knowledge base's rclone is waited for.
    expect(wait!.args.slice(-7)).toEqual(["up", "-d", "--wait", "--no-recreate", "--pull", "never", "rclone-notes"]);
  });

  it("adds or removes only the container of a knowledge base connected or disconnected, stopping it first as Ctrl+C stops rclone, and removes all with none", async () => {
    await ensureSyncService(["notes"]);
    const notes = containers.find((c) => c.Labels["ai.your-space.knowledge"] === "notes")!.Id;
    await ensureSyncService(["notes", "recipes"]);
    expect(Object.keys(composed.at(-1)!.file!.services).sort()).toEqual(["rclone-notes", "rclone-recipes", "ys-egress"]);
    // Notes' rclone runs on, and only recipes' is waited for.
    expect(containers.find((c) => c.Labels["ai.your-space.knowledge"] === "notes")!.Id).toBe(notes);
    expect(composed.at(-1)!.args.at(-1)).toBe("rclone-recipes");
    const before = composed.length;
    await ensureSyncService(["recipes"]);
    // Notes' rclone stops gracefully before Compose removes it; nothing is waited for.
    expect(composed.slice(before).map((c) => c.args.slice(3))).toEqual([
      ["stop", "-t", "100", "rclone-notes"],
      ["--project-directory", expect.any(String), "-f", expect.any(String), "up", "-d", "--remove-orphans", "--pull", "never"],
    ]);
    expect(Object.keys(composed.at(-1)!.file!.services).sort()).toEqual(["rclone-recipes", "ys-egress"]);
    expect(containers.map((c) => c.Labels["ai.your-space.knowledge"])).toEqual(["recipes"]);
    expect(await ensureSyncService([])).toMatchObject({ running: [], knowledgeBases: [] });
    expect(composed.slice(-2).map((c) => c.args)).toEqual([
      ["compose", "-p", syncProject(), "stop", "-t", "100", "rclone-recipes"],
      ["compose", "-p", syncProject(), "down", "--remove-orphans"],
    ]);
  });

  it("sets up a kept state volume again before its knowledge base's container first mounts it, and leaves running ones' alone", async () => {
    const state = knowledgeStateVolume(INSTALLATION, "notes");
    // As after a try whose setup failed and whose volume couldn't be deleted: labelled, not set up.
    volumes.set(state, knowledgeSyncLabels(INSTALLATION, "notes"));
    await ensureSyncService(["notes"]);
    expect(inits[0]).toBe(`${state} chown 1000:1000 /knowledge && chmod 0700 /knowledge`);
    inits = [];
    await ensureSyncService(["notes", "recipes"]);
    expect(inits.filter((i) => i.startsWith(state))).toEqual([]);
    expect(inits[0]).toBe(`${knowledgeStateVolume(INSTALLATION, "recipes")} chown 1000:1000 /knowledge && chmod 0700 /knowledge`);
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

  it("restarts a knowledge base's rclone as Ctrl+C stops it, for a run past its time or an rclone that stopped answering", async () => {
    await ensureSyncService(["notes", "recipes"]);
    await restartSyncService("notes");
    expect(composed.at(-1)!.args).toEqual(["compose", "-p", syncProject(), "restart", "-t", "100", "rclone-notes"]);
    await expect(restartSyncService("drafts")).rejects.toMatchObject({ status: 404 });
  });

  it("stops with Your Space's apps as Ctrl+C stops rclone, then starts nothing", async () => {
    await ensureSyncService(["notes", "recipes"]);
    await expect(stopSyncs()).rejects.toThrow(/only once Your Space is stopping/);
    await stopAll();
    await stopSyncs();
    expect(composed.slice(-2).map((c) => c.args)).toEqual([
      ["compose", "-p", syncProject(), "stop", "-t", "100", "rclone-notes", "rclone-recipes"],
      ["compose", "-p", syncProject(), "stop"],
    ]);
    await expect(ensureSyncService(["notes"])).rejects.toMatchObject({ status: 409, message: expect.stringContaining("stopping") });
    await expect(restartSyncService("notes")).rejects.toMatchObject({ status: 409 });
    // A stop the engine refuses, rclone's and then the whole project's, says so rather than answer that the sync stopped.
    composeFails = "stop";
    await expect(stopSyncs()).rejects.toThrow(/Stopping the sync failed: the engine failed/);
  });
});
