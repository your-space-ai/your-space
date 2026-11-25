// Synced knowledge bases (journey 014, decision 2026-11-25 "Knowledge bases"): one long-running
// container of stock rclone's remote control (`rclone rcd`) syncs every synced knowledge base with its
// Google Drive folder. The runtime manager only runs that container: the official image pinned to its
// digest, as user 1000, without capabilities, with a read-only root, no engine socket and no FUSE, on a
// network whose only way out is a Squid of its own that lets through only Google's token and Drive
// hosts. rclone's configuration is in memory only (`--config ""`), and its remote control listens only
// on a Unix socket in a volume that only it and the server mount (ys-sync), owned by user 1000 with
// mode 0700. The server creates each knowledge base's remote there, with its client and token, and
// starts each bisync there (server/src/apps/knowledge-sync.ts): nothing secret passes through the
// runtime manager, and none is in the container's environment, command or files.
//
// The container mounts each synced knowledge base at /knowledge/<name> and its sync state, bisync's
// listings and the files syncs replaced, at /state/<name>, from a volume of Your Space's outside the
// knowledge base. Connecting or disconnecting a knowledge base changes the mounts, so Compose
// recreates the container. It stops with SIGINT, bisync's graceful shutdown, so a run under way saves
// its state for the next one. Once Your Space is stopping (/stop-all), nothing here starts.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EGRESS_IMAGE, EGRESS_PORT, EGRESS_SERVICE, egressConfig, egressService, escapeDollars, knowledgeStateVolume, knowledgeSyncLabels, knowledgeVolume, pinnedImage } from "./adapter.ts";
import { deleteKnowledgeState, holdKnowledgeBases, imagePresent, initKnowledge, INSTALLATION, isStopping, knowledgeOf, SpecError, validateKnowledgeName } from "./apps.ts";
import { docker, engine, engineInfo, engineJson, EngineError, inspectImage, listContainers, pullImage } from "./engine.ts";

/** rclone 1.75.2's official image, for every processor it is published for, by its index digest. */
export const RCLONE_IMAGE = "rclone/rclone@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5";
const PINNED_RCLONE = /^rclone\/rclone(:[A-Za-z0-9._-]{1,64})?@sha256:[0-9a-f]{64}$/;

/**
 * The rclone image the sync runs: YS_SYNC_IMAGE, which the release's Compose file sets for the runtime
 * manager (deploy/stack.yaml) and no .env can change, or RCLONE_IMAGE without it, as in tests. Only the
 * stock image, pinned to a digest.
 */
export function rcloneImage(env: NodeJS.ProcessEnv = process.env): string {
  const image = env.YS_SYNC_IMAGE?.trim() || RCLONE_IMAGE;
  if (!PINNED_RCLONE.test(image)) throw new EngineError(`The sync's image must be rclone's own, pinned to its digest: ${image} isn't.`, 500);
  return image;
}

/**
 * The hosts the sync's proxy lets through: Google's token endpoint, where rclone refreshes the access
 * token, and the Drive API's, for its files, uploads and downloads. Your Space's server, not rclone,
 * signs in with Google.
 */
export const SYNC_HOSTS = ["oauth2.googleapis.com", "www.googleapis.com"];
/** Where the socket's volume is mounted, in the sync's container and in the server's (deploy/stack.yaml). */
export const SOCKET_DIR = "/run/ys-sync";
export const RC_SOCKET = `${SOCKET_DIR}/rc.sock`;
/** The socket volume's name in Your Space's own Compose file. */
export const SOCKET_VOLUME_KEY = "ys-sync";
/** The sync's service in its Compose project. */
export const RCLONE_SERVICE = "rclone";
/** How long rclone keeps a finished run's result, so a server that restarts meanwhile can read it. */
export const JOB_EXPIRY = "1h";
/** How long a stop gives bisync's graceful shutdown: it wraps up in 30 seconds, then cancels and waits up to 60. */
export const STOP_GRACE_S = 100;
/** The most knowledge bases one container mounts: two volumes each. */
export const MAX_SYNCED = 100;
const STOPPING = "Your Space is stopping, so nothing syncs until it starts again.";
const SYNC_MEMORY = "1g";

/**
 * rclone's remote control, and only that. A socket an earlier container left behind is removed first:
 * rclone doesn't replace one, and wouldn't start. `--rc-no-auth` because rclone refuses to create a
 * remote over a remote control without authentication, and the socket's file permissions are its
 * authentication. `-v`, JSON and no colour: the server reads each bisync's log from its result.
 */
export function rcloneCommand(): string {
  return [
    `rm -f ${RC_SOCKET}`,
    `exec rclone rcd --config '' --rc-addr unix://${RC_SOCKET} --rc-no-auth --rc-job-expire-duration ${JOB_EXPIRY} -v --use-json-log --color NEVER`,
  ].join(" && ");
}

/**
 * The browser tests' remote (YS_E2E_SYNC_FIXTURE=1 in the runtime manager's environment, which only
 * e2e/compose.e2e.yaml sets; the runtime's environment comes from Compose files alone, never from the
 * owner's .env): a test volume mounted at /remote, whose folders stand in for Drive folders. Only then
 * does the container mount it, and only then does the runtime manager tell the server to use it, so
 * nothing the server or the owner sends selects it.
 */
export function fixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YS_E2E_SYNC_FIXTURE === "1";
}

/** The browser tests' stand-in for Drive: a volume with a folder for each Drive folder ID. */
export function fixtureVolume(): string {
  return `ys-sync-fixture.${INSTALLATION}`;
}

/** The sync's own Compose project, its rclone and its outbound proxy: never an app's, whose projects are `ys-<app>`. */
export function syncProject(): string {
  return `${INSTALLATION}_knowledge-sync`;
}

/** The sealed network rclone joins, whose only way out is the proxy. */
export function syncNetwork(): string {
  return `${syncProject()}_sync`;
}

/** The labels of the sync's containers and networks. */
function syncLabels(): Record<string, string> {
  return { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge-sync" };
}

export interface SyncServiceSpec {
  squid: string;
  rclone: string;
  /** The ys-sync volume, which the server mounts too. */
  socketVolume: string;
  /** The synced knowledge bases, by name. */
  knowledgeBases: string[];
  fixture: boolean;
}

/** The sync's Compose file: rclone's remote control, and the proxy it reaches Google through. */
export function syncServiceFile(spec: SyncServiceSpec): Record<string, unknown> {
  const labels = syncLabels();
  const config = egressConfig(SYNC_HOSTS);
  const proxy = `http://${EGRESS_SERVICE}:${EGRESS_PORT}`;
  const volumes: Record<string, unknown> = { socket: { external: true, name: spec.socketVolume } };
  const mounts: Record<string, unknown>[] = [{ type: "volume", source: "socket", target: SOCKET_DIR, volume: { nocopy: true } }];
  for (const name of spec.knowledgeBases) {
    volumes[`kb-${name}`] = { external: true, name: knowledgeVolume(INSTALLATION, name) };
    volumes[`state-${name}`] = { external: true, name: knowledgeStateVolume(INSTALLATION, name) };
    mounts.push({ type: "volume", source: `kb-${name}`, target: `/knowledge/${name}`, volume: { nocopy: true } });
    mounts.push({ type: "volume", source: `state-${name}`, target: `/state/${name}`, volume: { nocopy: true } });
  }
  if (spec.fixture) {
    volumes.fixture = { external: true, name: fixtureVolume() };
    mounts.push({ type: "volume", source: "fixture", target: "/remote", volume: { nocopy: true } });
  }
  const rclone = {
    image: spec.rclone,
    entrypoint: ["/bin/sh", "-c"],
    command: [rcloneCommand()],
    user: "1000:1000",
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    // No secret: the server creates the remotes over the socket.
    environment: { HOME: "/tmp", HTTPS_PROXY: proxy, HTTP_PROXY: proxy },
    networks: { sync: {} },
    volumes: mounts,
    restart: "unless-stopped",
    // bisync's graceful shutdown: a run under way saves its state.
    stop_signal: "SIGINT",
    stop_grace_period: `${STOP_GRACE_S}s`,
    healthcheck: {
      test: ["CMD", "rclone", "rc", "--unix-socket", RC_SOCKET, "rc/noop"],
      interval: "30s",
      timeout: "5s",
      retries: 3,
      start_period: "30s",
      start_interval: "1s",
    },
    // A run's log is written once more to the container's: rotated, as a run a minute adds up.
    logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } },
    mem_limit: SYNC_MEMORY,
    cpus: 1,
    pids_limit: 256,
    labels: { ...labels, "ai.your-space.knowledge-bases": spec.knowledgeBases.join(",") },
  };
  return {
    name: syncProject(),
    services: escapeDollars({ [EGRESS_SERVICE]: egressService(spec.squid, labels, config, ["sync", "egress"]), [RCLONE_SERVICE]: rclone }),
    networks: {
      sync: { internal: true, driver: "bridge", driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" }, labels },
      egress: { driver: "bridge", labels },
    },
    volumes,
    configs: { egress: { content: escapeDollars(config) } },
  };
}

export interface SyncService {
  /** Whether rclone's container runs now. */
  running: boolean;
  /** The knowledge bases it mounts. */
  knowledgeBases: string[];
  /** The browser tests' remote: the server creates each remote on a folder of /remote instead of Drive. */
  fixture: boolean;
  /** Where the server reaches its remote control, in the ys-sync volume. */
  socket: string;
}

async function rcloneContainer() {
  const found = await listContainers([`com.docker.compose.project=${syncProject()}`, `com.docker.compose.service=${RCLONE_SERVICE}`]);
  return found.find((c) => c.State === "running") ?? found[0];
}

/** The sync's container as it is now. */
export async function syncService(): Promise<SyncService> {
  const container = await rcloneContainer();
  const mounted = container?.Labels["ai.your-space.knowledge-bases"] ?? "";
  return { running: container?.State === "running", knowledgeBases: mounted ? mounted.split(",") : [], fixture: fixtureEnabled(), socket: RC_SOCKET };
}

/** Validates the server's request: the knowledge bases to sync, by name, and nothing else. */
export function validateSyncService(body: unknown): string[] {
  const { knowledgeBases, ...rest } = (typeof body === "object" && body !== null && !Array.isArray(body) ? body : {}) as { knowledgeBases?: unknown };
  if (Object.keys(rest).length > 0) throw new SpecError(`The sync service takes knowledge bases only: ${Object.keys(rest).join(", ")} isn't a field.`);
  if (!Array.isArray(knowledgeBases)) throw new SpecError("Name the knowledge bases to sync.");
  if (knowledgeBases.length > MAX_SYNCED) throw new SpecError(`At most ${MAX_SYNCED} knowledge bases sync at once.`);
  return [...new Set(knowledgeBases.map((name) => validateKnowledgeName(String(name))))].sort();
}

/** One change to the sync's container at a time. */
let changing: Promise<unknown> = Promise.resolve();
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = changing.catch(() => undefined).then(work);
  changing = next;
  return next;
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

/** The ys-sync volume of Your Space's own Compose project, which the server mounts too. */
export async function socketVolume(): Promise<string> {
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${INSTALLATION}`, `com.docker.compose.volume=${SOCKET_VOLUME_KEY}`] }));
  const { Volumes } = await engineJson<{ Volumes: { Name: string }[] | null }>("GET", `/volumes?filters=${filters}`);
  const volume = Volumes?.[0]?.Name;
  if (!volume) throw new EngineError(`Your Space's Compose files have no ${SOCKET_VOLUME_KEY} volume, so knowledge bases can't sync. Update Your Space's files.`, 503);
  return volume;
}

let squid: string | undefined;

/** Squid's image that apps' proxies use, pinned to the digest its registry gives when it is first needed. */
async function squidImage(): Promise<string> {
  if (!squid) {
    const info = await engineInfo();
    if (!info.reachable) throw new EngineError("The engine can't be reached.", 503);
    const image = await inspectImage(`${EGRESS_IMAGE}:latest`, info.arch ?? "amd64");
    if (!image.digest) throw new EngineError(`The sync's proxy image ${EGRESS_IMAGE} can't be found: ${image.error ?? "no digest"}`);
    squid = pinnedImage(EGRESS_IMAGE, image.digest);
  }
  return squid;
}

async function compose(file: Record<string, unknown>, args: string[]): Promise<void> {
  const dir = mkdtempSync("/tmp/ys-sync-");
  try {
    writeFileSync(join(dir, "compose.json"), JSON.stringify(file), { mode: 0o600 });
    const ran = await docker(["compose", "-p", syncProject(), "--project-directory", dir, "-f", join(dir, "compose.json"), ...args], {}, dir);
    if (ran.code !== 0) throw new EngineError(`Starting the sync failed: ${ran.stderr.split("\n").filter((l) => l.trim()).slice(-3).join(" ").slice(0, 600)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function projectExists(): Promise<boolean> {
  return (await listContainers([`com.docker.compose.project=${syncProject()}`])).length > 0;
}

/**
 * Runs the sync's container with exactly these knowledge bases mounted, and its proxy, and answers once
 * its remote control answers. Compose recreates the container when the mounts change, which stops it
 * with SIGINT first; the server stops nothing it runs. With none, both are removed. The knowledge
 * bases are held meanwhile, so none of them, or its sync state, is deleted under it.
 */
export function ensureSyncService(knowledgeBases: string[]): Promise<SyncService> {
  return queued(async () => {
    if (isStopping()) throw new EngineError(STOPPING, 409);
    const names = [...new Set(knowledgeBases)].sort();
    if (names.length === 0) {
      if (await projectExists()) {
        const down = await docker(["compose", "-p", syncProject(), "down", "--remove-orphans"]);
        if (down.code !== 0) throw new EngineError(`Stopping the sync failed: ${down.stderr.trim().slice(-600)}`);
      }
      return syncService();
    }
    const release = holdKnowledgeBases(names);
    try {
      for (const name of names) if (!(await knowledgeOf(name))) throw new EngineError(`The knowledge base ${name} isn't on this machine's engine.`, 404);
      const rclone = rcloneImage();
      const proxy = await squidImage();
      await ensureImage(rclone);
      await ensureImage(proxy);
      for (const name of names) await ensureVolume(knowledgeStateVolume(INSTALLATION, name), knowledgeSyncLabels(INSTALLATION, name), "0700");
      const socket = await socketVolume();
      // Only user 1000, rclone's and the server's, reaches the socket.
      await initKnowledge(socket, "0700");
      const fixture = fixtureEnabled();
      if (fixture) await ensureVolume(fixtureVolume(), { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "sync-fixture" }, "2777");
      // Checked again once the images and volumes are ready, which can take long: a stop may have begun.
      if (isStopping()) throw new EngineError(STOPPING, 409);
      await compose(syncServiceFile({ squid: proxy, rclone, socketVolume: socket, knowledgeBases: names, fixture }), ["up", "-d", "--wait", "--remove-orphans", "--pull", "never"]);
    } finally {
      release();
    }
    return syncService();
  });
}

/**
 * Stops rclone as Ctrl+C stops it, so a bisync under way shuts down gracefully and saves its state,
 * and starts it again: the server's limit on one run's time. The server creates its remotes again.
 */
export function restartSyncService(): Promise<SyncService> {
  return queued(async () => {
    if (isStopping()) throw new EngineError(STOPPING, 409);
    const restarted = await docker(["compose", "-p", syncProject(), "restart", RCLONE_SERVICE]);
    if (restarted.code !== 0) throw new EngineError(`Restarting the sync failed: ${restarted.stderr.trim().slice(-600)}`);
    return syncService();
  });
}

/**
 * Stops the sync as Your Space's apps are stopped (`stop-apps`), once Your Space is stopping: rclone
 * stops with SIGINT, so a bisync under way shuts down gracefully, saving its state for the next run,
 * which resumes with `--recover`; then its proxy. A change of the container under way finishes first.
 */
export async function stopSyncs(): Promise<void> {
  if (!isStopping()) throw new Error("The syncs stop only once Your Space is stopping.");
  await queued(async () => {
    if (!(await projectExists())) return;
    await docker(["compose", "-p", syncProject(), "stop", "-t", String(STOP_GRACE_S)]);
  });
}

/**
 * Removes a knowledge base's sync state, bisync's listings and the files syncs replaced; it and the
 * remote folder keep their files, and its next connection starts with a first run that deletes
 * nothing. Refused while the sync's container mounts it: the server takes it out of the sync first.
 */
export function removeSync(name: string): Promise<void> {
  return queued(async () => {
    const { knowledgeBases } = await syncService();
    if (knowledgeBases.includes(name)) throw new EngineError(`The knowledge base ${name} is still synced, so its sync can't be removed yet.`, 409);
    await deleteKnowledgeState(name);
  });
}
