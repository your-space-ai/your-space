// What the runtime manager does with apps: check, apply, stop, remove, and report.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { adapt, EGRESS_IMAGE, FRAME_ORIGIN_LABEL, imageRef, pinnedImage, PUBLISH_TARGET, runsOnce, type AppSpec, type CheckResult, type OwnCaddy } from "./adapter.ts";
import {
  connectNetwork,
  disconnectNetwork,
  docker,
  engine,
  engineInfo,
  engineJson,
  EngineError,
  inspectImage,
  listContainers,
  pullImage,
  scrub,
  type CliResult,
  type ContainerSummary,
  type ImageCheck,
} from "./engine.ts";

export const INSTALLATION = process.env.YS_INSTALLATION || "your-space";
const INSTALLATION_LABEL = `ai.your-space.installation=${INSTALLATION}`;

export class SpecError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PROJECT = /^ys-[a-z][a-z0-9-]{0,29}$/;

export function validateSpec(body: unknown): AppSpec {
  const spec = body as Partial<AppSpec>;
  if (!spec || typeof spec !== "object") throw new SpecError("The request needs an app.");
  if (typeof spec.project !== "string" || !PROJECT.test(spec.project)) throw new SpecError("The project name isn't valid.");
  if (typeof spec.app !== "string" || `ys-${spec.app}` !== spec.project) throw new SpecError("The app name doesn't match the project.");
  if (typeof spec.compose !== "string" || spec.compose.length > 512 * 1024) throw new SpecError("The app's file is missing or too large.");
  if (spec.appId !== undefined && (typeof spec.appId !== "string" || !UUID.test(spec.appId))) throw new SpecError("Invalid app installation ID.");
  const env = spec.env ?? {};
  if (typeof env !== "object" || Object.entries(env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string")) {
    throw new SpecError("Settings must be names with text values.");
  }
  if (spec.verifyPins !== undefined && (!Array.isArray(spec.verifyPins) || spec.verifyPins.length > 128 ||
      spec.verifyPins.some(ref => typeof ref !== "string" || !/^sha256:[a-f0-9]{64}$/.test(spec.pins?.[ref] ?? "")))) {
    throw new SpecError("The requested image pins are invalid.");
  }
  if (spec.publish !== undefined && spec.publish !== null) {
    validatePublish(spec.publish);
    const { frame } = spec.publish as { frame?: unknown };
    if (frame !== undefined && typeof frame !== "boolean") throw new SpecError("Whether Your Space frames the published app must be true or false.");
  }
  if (spec.placeholders !== undefined && typeof spec.placeholders !== "boolean") throw new SpecError("Whether the check uses placeholders must be true or false.");
  return { ...spec, installation: INSTALLATION, env } as AppSpec;
}

type Publish = { port: number; bind: string };

function validatePublish(publish: unknown): Publish {
  const { port, bind } = (typeof publish === "object" && publish !== null ? publish : {}) as { port?: unknown; bind?: unknown };
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) throw new SpecError("The published port must be from 1 to 65535.");
  if (typeof bind !== "string" || !isIP(bind)) throw new SpecError("The published port's address must be an IP address.");
  return { port: port as number, bind };
}

/** A port check's request: where the app would be published. */
export function validatePortCheck(body: unknown): Publish {
  const { publish } = (typeof body === "object" && body !== null ? body : {}) as { publish?: unknown };
  return validatePublish(publish);
}

let stopping = false;

export function isStopping(): boolean {
  return stopping;
}

interface Variable {
  name: string;
  required: boolean;
  default: string;
}

interface Resolved {
  resolved: Record<string, unknown>;
  profiled: string[];
  variables: Variable[];
}

/**
 * What a check gives a setting the file requires, with `${NAME:?…}` or `${NAME?…}`, when the spec
 * has no value for it, so the owner can review the file before filling the setting in. Only a check
 * that asks for placeholders uses it; an apply never does, so it never reaches a running app.
 */
export const PLACEHOLDER = "ys-placeholder";

/** The settings, with the placeholder for each required one that has no value. */
export function withPlaceholders(env: Record<string, string>, variables: Variable[]): Record<string, string> {
  const filled = { ...env };
  for (const { name, required } of variables) if (required && !(Object.hasOwn(filled, name) && filled[name])) filled[name] = PLACEHOLDER;
  return filled;
}

/** `docker compose config --variables --format json`, or none when Compose couldn't list them. */
function variablesOf(listed: CliResult): Variable[] {
  if (listed.code !== 0) return [];
  return Object.values(JSON.parse(listed.stdout) as Record<string, { Name: string; DefaultValue: string; Required: boolean }>).map((v) => ({
    name: v.Name,
    required: v.Required,
    default: v.DefaultValue,
  }));
}

async function resolve(spec: AppSpec, placeholders: boolean): Promise<Resolved> {
  const dir = mkdtempSync("/tmp/ys-check-");
  try {
    writeFileSync(join(dir, "compose.yaml"), spec.compose, { mode: 0o600 });
    const base = ["compose", "-p", spec.project, "--project-directory", dir, "-f", join(dir, "compose.yaml")];
    // Compose lists the file's settings without resolving it, so a required one without a value doesn't stop it.
    const listed = docker([...base, "config", "--variables", "--format", "json"], {}, dir).then(variablesOf);
    const env = placeholders ? withPlaceholders(spec.env, await listed) : spec.env;
    const [plain, all, vars] = await Promise.all([
      docker([...base, "config", "--format", "json"], env, dir),
      docker([...base, "--profile", "*", "config", "--format", "json"], env, dir),
      listed,
    ]);
    if (plain.code !== 0) {
      const message = scrub(plain.stderr, spec.env)
        .split("\n")
        .filter((l) => l.trim() && !/level=warning/.test(l))
        .join(" ")
        .slice(0, 600);
      // A placeholder fits a setting used as text, not one used as a port or another typed value.
      const filled = Object.keys(env).filter((name) => env[name] !== spec.env[name]);
      const placeheld = filled.length
        ? ` Your Space read it with a placeholder in place of ${filled.join(", ")}, which the file requires and which ${filled.length === 1 ? "has" : "have"} no value yet.`
        : "";
      throw new SpecError(`The file isn't a Compose file Your Space can read: ${message || "Compose refused it."}${placeheld}`);
    }
    const resolved = JSON.parse(plain.stdout) as Record<string, unknown>;
    const allServices = all.code === 0 ? Object.keys((JSON.parse(all.stdout) as { services?: object }).services ?? {}) : [];
    const running = Object.keys((resolved.services as object) ?? {});
    return { resolved, profiled: allServices.filter((s) => !running.includes(s)), variables: vars };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface CheckAnswer extends Omit<CheckResult, "adapted"> {
  ok: boolean;
  variables: Resolved["variables"];
  images: ImageCheck[];
}

async function checkWithImages(spec: AppSpec, waitForCaddy = 0, placeholders = false): Promise<{ answer: CheckAnswer; adapted: CheckResult["adapted"] }> {
  const { resolved, profiled, variables } = await resolve(spec, placeholders);
  const info = await engineInfo();
  if (!info.reachable) throw new EngineError("The engine can't be reached.", 503);
  const caddy = spec.publish ? await ownCaddy(waitForCaddy) : undefined;
  const refs = [...new Set(Object.values((resolved.services as Record<string, { image?: string }>) ?? {}).map((s) => s.image).filter((i): i is string => !!i).map(imageRef))];
  refs.push(`${EGRESS_IMAGE}:latest`);
  const pins: Record<string, string> = { ...(spec.pins ?? {}) };
  const images = await Promise.all(
    refs.map(async (ref) => {
      // An image named with a placeholder is looked up once the owner gives the setting (the install's check).
      if (placeholders && ref.includes(PLACEHOLDER)) return { ref, platforms: [], runsHere: true } satisfies ImageCheck;
      if (pins[ref]) {
        if (!spec.verifyPins?.includes(ref)) return { ref, digest: pins[ref], platforms: [], runsHere: true } satisfies ImageCheck;
        const expected = pins[ref]!;
        const inspected = await inspectImage(pinnedImage(ref, expected), info.arch ?? "amd64");
        if (inspected.digest !== expected) {
          return { ...inspected, ref, error: "The requested immutable image could not be verified on this engine." };
        }
        return { ...inspected, ref };
      }
      const image = await inspectImage(ref, info.arch ?? "amd64");
      if (image.digest) pins[ref] = image.digest;
      return image;
    }),
  );
  const result = adapt({ ...spec, pins }, resolved, profiled, caddy);
  for (const image of images) {
    if (image.error) result.refusals.push({ service: "", setting: "image", reason: `${image.ref} can't be found in its registry: ${image.error}` });
    else if (!image.runsHere) result.refusals.push({ service: "", setting: "image", reason: `${image.ref} isn't published for this machine's processor (linux/${info.arch}).` });
  }
  const ok = result.refusals.length === 0;
  return {
    answer: { ok, services: result.services, adaptations: result.adaptations, refusals: result.refusals, variables, images },
    adapted: ok ? result.adapted : null,
  };
}

export async function check(spec: AppSpec): Promise<CheckAnswer> {
  return (await checkWithImages(spec, 0, spec.placeholders === true)).answer;
}

async function installationContainer(service: string): Promise<string | undefined> {
  const found = await listContainers([`com.docker.compose.project=${INSTALLATION}`, `com.docker.compose.service=${service}`]);
  return found.find((c) => c.State === "running")?.Id ?? found[0]?.Id;
}

/** How long an app's start waits for Your Space's Caddy, which Compose starts after the server. */
const CADDY_WAIT_MS = 120_000;

/**
 * Your Space's own Caddy: its image's ID, which a published app's Caddy runs too, and its origin, the
 * only one a published app's Caddy lets frame the app. Waits up to `waitMs` for the container, as when
 * Your Space and its apps start together.
 */
export async function ownCaddy(waitMs = 0): Promise<OwnCaddy | undefined> {
  const until = Date.now() + waitMs;
  for (;;) {
    const id = await installationContainer("caddy");
    // Compose can remove the container between the list and the inspection while it recreates Caddy.
    const detail = id
      ? await engineJson<{ Image: string; Config: { Env?: string[] | null } }>("GET", `/containers/${id}/json`).catch((error: unknown) => {
          if (error instanceof EngineError && error.status === 404) return undefined;
          throw error;
        })
      : undefined;
    if (detail?.Image) {
      const origin = (detail.Config.Env ?? []).find((e) => e.startsWith("YS_ORIGIN="))?.slice("YS_ORIGIN=".length);
      return { image: detail.Image, ...(origin ? { origin } : {}) };
    }
    if (Date.now() >= until) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function imagePresent(image: string): Promise<boolean> {
  const answer = await engine("GET", `/images/${encodeURIComponent(image)}/json`);
  return answer.status === 200;
}

export type Emit = (event: Record<string, unknown>) => void;

/** Pulls what is missing, starts the app, and connects Your Space's proxy to its network. */
export async function apply(spec: AppSpec, emit: Emit): Promise<void> {
  if (stopping) throw new EngineError("Your Space is stopping, so no app starts until it starts again.", 409);
  emit({ step: "check" });
  const { answer, adapted } = await checkWithImages(spec, CADDY_WAIT_MS);
  if (!adapted) {
    throw new SpecError(answer.refusals.map((r) => `${r.service ? `${r.service}: ` : ""}${r.reason}`).join(" "));
  }
  const services = adapted.services as Record<string, { image: string; restart?: string }>;
  const images = [...new Set(Object.values(services).map((s) => s.image))];
  for (const image of images) {
    if (await imagePresent(image)) continue;
    emit({ step: "pull", image, progress: 0 });
    await pullImage(image, (progress) => emit({ step: "pull", image, progress: Math.round(progress * 100) / 100 }));
    emit({ step: "pull", image, progress: 1 });
  }
  emit({ step: "start" });
  const dir = mkdtempSync(`/tmp/ys-${randomUUID().slice(0, 8)}-`);
  try {
    writeFileSync(join(dir, "compose.json"), JSON.stringify(adapted), { mode: 0o600 });
    const compose = ["compose", "-p", spec.project, "--project-directory", dir, "-f", join(dir, "compose.json")];
    // Compose starts every stopped container, a finished one-time service too, unless the others are
    // named without it.
    const done = await finishedServices(spec.project, services, compose, dir);
    const only = done.length > 0 ? ["--no-deps", ...Object.keys(services).filter((s) => !done.includes(s))] : [];
    const up = await docker([...compose, "up", "-d", "--remove-orphans", "--pull", "never", ...only], {}, dir);
    if (up.code !== 0) {
      // Checked when the owner saved; something can still have taken the port since.
      if (spec.publish && portTaken(up.stderr)) {
        throw new EngineError(
          `Port ${spec.publish.port} on ${spec.publish.bind} is already in use on this machine, so ${spec.app} can't be published there. Choose another port for it.`,
          409,
        );
      }
      throw new EngineError(`Starting the app failed: ${scrub(up.stderr, spec.env).split("\n").filter((l) => l.trim()).slice(-3).join(" ").slice(0, 600)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await connectProxy(spec.project);
  emit({ step: "started" });
}

/** A container of an app's service: its state, its exit code once exited, and Compose's hash of its definition. */
export interface ServiceRun {
  service: string;
  state: string;
  exitCode?: number;
  hash?: string;
}

/**
 * The one-time services an apply leaves as they are (2026-11-20): while the app runs, each that
 * finished with exit code 0 and that Compose wouldn't recreate, because its image, command and
 * settings are the same (`hashes`, from `docker compose config --hash`). A stopped app starts every
 * service, since a service that was stopped with it can't be told from one that finished.
 */
export function finishedOnce(restarts: Record<string, string>, runs: ServiceRun[], hashes: Record<string, string>): string[] {
  const own = (service: string) => Object.hasOwn(restarts, service);
  const once = (service: string) => own(service) && runsOnce(restarts[service]!);
  const running = runs.some((r) => own(r.service) && !once(r.service) && (r.state === "running" || r.state === "restarting"));
  if (!running) return [];
  const finished = runs.filter((r) => once(r.service) && r.state === "exited" && r.exitCode === 0 && r.hash !== undefined && r.hash === hashes[r.service]);
  return [...new Set(finished.map((r) => r.service))];
}

/** The app's one-time services that `finishedOnce` leaves as they are. */
async function finishedServices(project: string, services: Record<string, { restart?: string }>, compose: string[], dir: string): Promise<string[]> {
  const restarts = Object.fromEntries(Object.entries(services).map(([name, s]) => [name, s.restart ?? ""]));
  const once = Object.keys(restarts).filter((name) => runsOnce(restarts[name]!));
  if (once.length === 0) return [];
  const runs = await Promise.all(
    (await projectContainers(project)).map(async (c): Promise<ServiceRun> => {
      const run: ServiceRun = { service: c.Labels["com.docker.compose.service"] ?? "", state: c.State, hash: c.Labels["com.docker.compose.config-hash"] };
      if (c.State === "exited" && once.includes(run.service)) {
        const detail = await engineJson<{ State: { ExitCode: number } }>("GET", `/containers/${c.Id}/json`).catch(() => undefined);
        run.exitCode = detail?.State.ExitCode;
      }
      return run;
    }),
  );
  if (!runs.some((r) => r.exitCode === 0)) return [];
  const hashed = await docker([...compose, "config", "--hash", once.join(",")], {}, dir);
  // Without the hashes, every service starts, as Compose would.
  if (hashed.code !== 0) return [];
  const hashes = Object.fromEntries(hashed.stdout.split("\n").map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 2));
  return finishedOnce(restarts, runs, hashes);
}

/**
 * Docker says "port is already allocated" for another container's port, and "address already in use"
 * for anything else on the machine.
 */
export function portTaken(message: string): boolean {
  return /port is already allocated|address already in use/i.test(message);
}

/** Two listening addresses share a port when they are the same, or either is every address. */
function overlaps(a: string, b: string): boolean {
  const every = (ip: string) => ip === "" || ip === "0.0.0.0" || ip === "::";
  return a === b || every(a) || every(b);
}

/**
 * The running container that publishes the port, if one does. Another project's is named first; the
 * app's own (its Caddy, before the app restarts with the owner's new choice) means the port is the
 * app's already.
 */
export function portHolder(containers: ContainerSummary[], project: string, publish: Publish): { container: string; own: boolean } | undefined {
  const holders = containers.filter((c) => (c.Ports ?? []).some((p) => p.Type === "tcp" && p.PublicPort === publish.port && overlaps(p.IP ?? "", publish.bind)));
  const own = (c: ContainerSummary) => c.Labels["ai.your-space.installation"] === INSTALLATION && c.Labels["com.docker.compose.project"] === project;
  const holder = holders.find((c) => !own(c)) ?? holders[0];
  return holder && { container: holder.Names[0]?.replace(/^\//, "") ?? holder.Id.slice(0, 12), own: own(holder) };
}

/**
 * A container of a published app's Caddy's image, hardened like it, that publishes the port the way
 * that Caddy would and exits at once. It has no app's labels, so nothing counts it as part of an app.
 */
export function portProbe(image: string, publish: Publish): Record<string, unknown> {
  const port = `${PUBLISH_TARGET}/tcp`;
  return {
    Image: image,
    Cmd: ["true"],
    User: "65534:65534",
    Labels: { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "port-check" },
    ExposedPorts: { [port]: {} },
    HostConfig: {
      PortBindings: { [port]: [{ HostIp: publish.bind, HostPort: String(publish.port) }] },
      NetworkMode: "bridge",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Memory: 32 * 1024 * 1024,
      NanoCpus: 250_000_000,
    },
  };
}

/**
 * Whether the app can be published on the port. A container that publishes it is named, unless it is
 * the app's own. Anything else, such as a program on this machine, shows when a short-lived container
 * tries to publish it: the runtime manager has no network of its own, and can't see the machine's.
 */
export async function checkPort(project: string, publish: Publish): Promise<{ inUse: boolean; by?: string }> {
  const holder = portHolder(await engineJson<ContainerSummary[]>("GET", "/containers/json"), project, publish);
  if (holder) return holder.own ? { inUse: false } : { inUse: true, by: `the container ${holder.container}` };
  const caddy = await ownCaddy();
  if (!caddy) throw new EngineError("Your Space's Caddy isn't running, so the port can't be checked.", 503);
  const { Id } = await engineJson<{ Id: string }>("POST", "/containers/create", portProbe(caddy.image, publish));
  try {
    await engineJson("POST", `/containers/${Id}/start`);
    return { inUse: false };
  } catch (error) {
    if (error instanceof EngineError && portTaken(error.message)) return { inUse: true };
    throw error;
  } finally {
    await engine("DELETE", `/containers/${Id}?force=1`).catch(() => {});
  }
}

async function connectProxy(project: string): Promise<void> {
  const caddy = await installationContainer("caddy");
  if (caddy) await connectNetwork(`${project}_app`, caddy);
}

export async function stop(project: string): Promise<void> {
  const result = await docker(["compose", "-p", project, "stop"]);
  if (result.code !== 0) throw new EngineError(`Stopping the app failed: ${result.stderr.trim().slice(0, 400)}`);
}

/** Apps being removed, whose networks Your Space's proxy doesn't join again. */
const removing = new Set<string>();
/** The proxy's reconnection under way, if one is (`connectProxyToAll`). */
let reconnecting: Promise<void> | undefined;

/**
 * Removes the app's containers, networks and anonymous volumes; its named volumes stay (FR-023). An
 * anonymous volume isn't the app's data (FR-024): no new container gets it back. The proxy leaves the
 * app's network and doesn't join it again meanwhile, so Compose can remove the network.
 */
export async function down(project: string): Promise<void> {
  removing.add(project);
  try {
    // A reconnection already under way can still join the network, so it finishes first.
    await reconnecting?.catch(() => undefined);
    const anonymous = anonymousVolumes(await projectContainers(project), await anonymousVolumeNames());
    const caddy = await installationContainer("caddy");
    if (caddy) await disconnectNetwork(`${project}_app`, caddy);
    const result = await docker(["compose", "-p", project, "down", "--remove-orphans"]);
    if (result.code !== 0) throw new EngineError(`Removing the app failed: ${result.stderr.trim().slice(0, 400)}`);
    for (const name of anonymous) {
      const answer = await engine("DELETE", `/volumes/${encodeURIComponent(name)}`);
      if (answer.status >= 400 && answer.status !== 404) throw new EngineError(`Deleting ${name} failed: ${answer.body.trim()}`);
    }
  } finally {
    removing.delete(project);
  }
}

/**
 * The anonymous volumes the containers mount: those the engine created for a path the image or the
 * file names without a volume. A named volume, the app's data, is never one of them.
 */
export function anonymousVolumes(containers: ContainerSummary[], anonymous: Set<string>): string[] {
  const names = new Set<string>();
  for (const c of containers) {
    for (const mount of c.Mounts ?? []) if (mount.Type === "volume" && mount.Name && anonymous.has(mount.Name)) names.add(mount.Name);
  }
  return [...names];
}

interface VolumeList {
  Volumes: { Name: string; Labels: Record<string, string> | null }[] | null;
}

/** The engine labels each volume it creates without a name. */
async function anonymousVolumeNames(): Promise<Set<string>> {
  const filters = encodeURIComponent(JSON.stringify({ label: ["com.docker.volume.anonymous"] }));
  const list = await engineJson<VolumeList>("GET", `/volumes?filters=${filters}`);
  return new Set((list.Volumes ?? []).map((v) => v.Name));
}

async function appVolumes(project: string): Promise<string[]> {
  const filters = encodeURIComponent(JSON.stringify({ label: [INSTALLATION_LABEL, `com.docker.compose.project=${project}`] }));
  const list = await engineJson<VolumeList>("GET", `/volumes?filters=${filters}`);
  return (list.Volumes ?? []).map((v) => v.Name);
}


export async function deleteVolumes(project: string): Promise<void> {
  const running = await listContainers([INSTALLATION_LABEL, `com.docker.compose.project=${project}`]);
  if (running.length > 0) throw new EngineError("The app still has containers; remove it first.", 409);
  for (const name of await appVolumes(project)) {
    const answer = await engine("DELETE", `/volumes/${encodeURIComponent(name)}`);
    if (answer.status >= 400 && answer.status !== 404) throw new EngineError(`Deleting ${name} failed: ${answer.body.trim()}`);
  }
}

export interface ServiceState {
  name: string;
  role: "app" | "egress" | "publish";
  state: string;
  health?: string;
  exitCode?: number;
  oomKilled?: boolean;
  /** A service that runs once, such as a migration, and finished. */
  completed?: boolean;
  /**
   * A published app's Caddy that doesn't run Your Space's own Caddy's image, as after Your Space is
   * updated, or the port forwarder an earlier Your Space ran, or that lets another origin than Your
   * Space's frame the app, as after Your Space moves to another address; the app's next start renews it.
   */
  outdated?: boolean;
  /**
   * A published app's Caddy that runs and lets Your Space's current origin frame the app: its
   * container's ID, shortened. Compose gives it a new one whenever it recreates the Caddy.
   */
  framing?: string;
}

/**
 * Whether a published app's Caddy runs another image than Your Space's own Caddy does now, or lets
 * another origin frame the app. One that lets no origin frame it doesn't depend on the origin.
 */
export function proxyOutdated(container: ContainerSummary, caddy: OwnCaddy): boolean {
  const framedBy = container.Labels[FRAME_ORIGIN_LABEL];
  return container.ImageID !== caddy.image || (framedBy !== undefined && framedBy !== caddy.origin);
}

/**
 * The short ID of a published app's Caddy that runs and lets Your Space's current origin frame the
 * app, or undefined. Its image doesn't matter: an outdated Caddy still frames the app until it is renewed.
 */
export function framingOf(container: ContainerSummary, caddy: OwnCaddy): string | undefined {
  const framedBy = container.Labels[FRAME_ORIGIN_LABEL];
  return container.State === "running" && framedBy !== undefined && framedBy === caddy.origin ? container.Id.slice(0, 12) : undefined;
}

export async function listApps(): Promise<{ project: string; app: string; services: ServiceState[] }[]> {
  const containers = await listContainers([INSTALLATION_LABEL]);
  const caddy = containers.some((c) => c.Labels["ai.your-space.role"] === "publish") ? await ownCaddy() : undefined;
  const byProject = new Map<string, { project: string; app: string; services: ServiceState[] }>();
  for (const c of containers) {
    const project = c.Labels["com.docker.compose.project"];
    const app = c.Labels["ai.your-space.app"];
    if (!project || !app) continue;
    const entry = byProject.get(project) ?? { project, app, services: [] };
    const service: ServiceState = {
      name: c.Labels["com.docker.compose.service"] ?? c.Names[0] ?? c.Id,
      role: c.Labels["ai.your-space.role"] === "egress" ? "egress" : c.Labels["ai.your-space.role"] === "publish" ? "publish" : "app",
      state: c.State,
    };
    const health = /\((healthy|unhealthy|health: starting)\)/.exec(c.Status)?.[1];
    if (health) service.health = health.replace("health: ", "");
    if (service.role === "publish" && caddy) {
      if (proxyOutdated(c, caddy)) service.outdated = true;
      const framing = framingOf(c, caddy);
      if (framing) service.framing = framing;
    }
    if (c.State === "exited" || c.State === "dead" || c.State === "restarting") {
      const detail = await engineJson<{ State: { ExitCode: number; OOMKilled: boolean }; HostConfig?: { RestartPolicy?: { Name?: string } } }>(
        "GET",
        `/containers/${c.Id}/json`,
      );
      service.exitCode = detail.State.ExitCode;
      service.oomKilled = detail.State.OOMKilled;
      // Every other service is restarted until it is stopped, so only one that runs once can finish.
      const policy = detail.HostConfig?.RestartPolicy?.Name ?? "";
      if (c.State === "exited" && detail.State.ExitCode === 0 && (policy === "no" || policy === "" || policy === "on-failure")) service.completed = true;
    }
    entry.services.push(service);
    byProject.set(project, entry);
  }
  return [...byProject.values()];
}

async function projectContainers(project: string) {
  return listContainers([INSTALLATION_LABEL, `com.docker.compose.project=${project}`]);
}

interface AppNetwork {
  Name: string;
  Driver: string;
  Internal: boolean;
  Labels: Record<string, string>;
  Containers: Record<string, { IPv4Address: string }> | null;
}

/** Select a single engine-observed interface on this exact app's sealed bridge. */
export function interfaceTarget(
  project: string,
  appId: string,
  service: string,
  port: number,
  containers: ContainerSummary[],
  network: AppNetwork,
): { address: string; legacy: boolean } {
  const app = project.slice(3);
  const expected = {
    "ai.your-space.installation": INSTALLATION,
    "ai.your-space.app": app,
    "com.docker.compose.project": project,
  };
  const matches = (labels: Record<string, string>) =>
    Object.entries(expected).every(([key, value]) => labels?.[key] === value);
  const refused = () => new EngineError("The installed app has no verified running interface.", 503);
  if (
    !PROJECT.test(project) ||
    !UUID.test(appId) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(service) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw refused();
  if (
    network.Name !== project + "_app" ||
    !network.Internal ||
    network.Driver !== "bridge" ||
    !matches(network.Labels) ||
    network.Labels["com.docker.compose.network"] !== "app"
  )
    throw refused();
  const candidates = containers.filter(
    (c) =>
      c.State === "running" &&
      matches(c.Labels) &&
      c.Labels["com.docker.compose.service"] === service,
  );
  if (candidates.length !== 1) throw refused();
  const target = candidates[0]!;
  const recordedId = target.Labels["ai.your-space.app-id"];
  const recordedPort = target.Labels["ai.your-space.interface-port"];
  const legacy = recordedId === undefined && recordedPort === undefined;
  if (!legacy && (recordedId !== appId || recordedPort !== String(port))) throw refused();
  const address = network.Containers?.[target.Id]?.IPv4Address?.split("/")[0];
  if (!address || isIP(address) !== 4) throw refused();
  return { address, legacy };
}

export function interfaceAddress(...args: Parameters<typeof interfaceTarget>): string {
  const target = interfaceTarget(...args);
  if (target.legacy) throw new EngineError("The app interface needs its installation labels refreshed.", 503);
  return target.address;
}

async function inspectInterface(project: string) {
  const [containers, network] = await Promise.all([
    projectContainers(project),
    engineJson<AppNetwork>("GET", "/networks/" + encodeURIComponent(project + "_app")),
  ]);
  return { containers, network };
}

export async function resolveInterface(project: string, appId: string, service: string, port: number) {
  const { containers, network } = await inspectInterface(project);
  return { address: interfaceAddress(project, appId, service, port, containers, network) };
}

/** The operator may upgrade only the previously unlabelled, running interface of this installation. */
export async function refreshInterface(spec: AppSpec): Promise<"current" | "refreshed"> {
  if (stopping) throw new EngineError("Your Space is stopping.", 409);
  const { appId, project, interface: iface } = spec;
  if (!appId || !iface) throw new SpecError("An installed app and its interface are required.");
  const { containers, network } = await inspectInterface(project);
  const target = interfaceTarget(project, appId, iface.service, iface.port, containers, network);
  if (!target.legacy) return "current";

  const { adapted } = await checkWithImages(spec);
  if (!adapted) throw new SpecError("The installed app no longer passes the runtime checks.");
  const dir = mkdtempSync("/tmp/ys-refresh-interface-");
  try {
    const file = join(dir, "compose.json");
    writeFileSync(file, JSON.stringify(adapted), { mode: 0o600 });
    const result = await docker([
      "compose", "-p", project, "--project-directory", dir, "-f", file,
      "up", "-d", "--no-deps", "--no-build", "--pull", "never", iface.service,
    ], {}, dir);
    // Keep settings, upstream output and process diagnostics inside the runtime.
    if (result.code !== 0) throw new EngineError("Compose could not refresh this app's interface.", 503);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await resolveInterface(project, appId, iface.service, iface.port);
  return "refreshed";
}

export async function logs(project: string, service: string, tail: number): Promise<string[]> {
  const container = (await projectContainers(project)).find((c) => c.Labels["com.docker.compose.service"] === service);
  if (!container) throw new EngineError("No such service.", 404);
  const result = await docker(["logs", "--tail", String(Math.min(Math.max(tail, 1), 1000)), "--timestamps", container.Id]);
  return `${result.stdout}${result.stderr}`.split("\n").filter((l) => l.length > 0).sort();
}

interface Stats {
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
}

export async function stats(project: string) {
  const containers = (await projectContainers(project)).filter((c) => c.State === "running");
  const services = await Promise.all(
    containers.map(async (c) => {
      const s = await engineJson<Stats>("GET", `/containers/${c.Id}/stats?stream=false`);
      const memory = (s.memory_stats.usage ?? 0) - (s.memory_stats.stats?.inactive_file ?? 0);
      const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
      const systemDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * (s.cpu_stats.online_cpus ?? 1) * 100 : 0;
      return {
        name: c.Labels["com.docker.compose.service"] ?? c.Id,
        memory,
        memoryLimit: s.memory_stats.limit ?? 0,
        cpuPercent: Math.round(cpuPercent * 10) / 10,
      };
    }),
  );
  return { services };
}

/** Hosts the app's egress proxy refused, from its access log. */
export async function denials(project: string) {
  const egress = (await projectContainers(project)).find((c) => c.Labels["ai.your-space.role"] === "egress" && c.State === "running");
  if (!egress) return { hosts: [] };
  const result = await docker(["exec", egress.Id, "tail", "-n", "5000", "/var/log/squid/access.log"]);
  return { hosts: parseDenials(result.stdout) };
}

export function parseDenials(log: string): { host: string; attempts: number; lastSeen: string }[] {
  const hosts = new Map<string, { host: string; attempts: number; lastSeen: number }>();
  for (const line of log.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 7 || !fields[3]?.startsWith("TCP_DENIED")) continue;
    const time = Number(fields[0]) * 1000;
    const target = fields[6]!;
    let host: string;
    if (fields[5] === "CONNECT") host = target.replace(/:\d+$/, "");
    else {
      try {
        host = new URL(target).hostname;
      } catch {
        continue;
      }
    }
    host = host.toLowerCase();
    if (!host || /^[\d.:[\]]+$/.test(host)) continue;
    const entry = hosts.get(host) ?? { host, attempts: 0, lastSeen: 0 };
    entry.attempts += 1;
    entry.lastSeen = Math.max(entry.lastSeen, time);
    hosts.set(host, entry);
  }
  return [...hosts.values()].map((h) => ({ host: h.host, attempts: h.attempts, lastSeen: new Date(h.lastSeen).toISOString() }));
}

/** Stops every app this installation manages, and refuses to start any until restarted. */
export async function stopAll(): Promise<string[]> {
  stopping = true;
  const projects = (await listApps()).map((a) => a.project);
  for (const project of projects) await stop(project);
  return projects;
}

/**
 * Keeps Your Space's proxy connected to every app's network, for example after Caddy is recreated,
 * except an app's that is being removed. One reconnection runs at a time.
 */
export function connectProxyToAll(): Promise<void> {
  reconnecting ??= reconnect().finally(() => {
    reconnecting = undefined;
  });
  return reconnecting;
}

async function reconnect(): Promise<void> {
  const caddy = await installationContainer("caddy");
  if (!caddy) return;
  const detail = await engineJson<{ NetworkSettings: { Networks: Record<string, unknown> } }>("GET", `/containers/${caddy}/json`);
  const joined = new Set(Object.keys(detail.NetworkSettings.Networks));
  const filters = encodeURIComponent(JSON.stringify({ label: [INSTALLATION_LABEL] }));
  const networks = await engineJson<{ Name: string }[]>("GET", `/networks?filters=${filters}`);
  for (const network of networks) {
    if (!network.Name.endsWith("_app") || joined.has(network.Name)) continue;
    // Checked just before connecting: a removal can start while this runs.
    if (removing.has(network.Name.slice(0, -"_app".length))) continue;
    await connectNetwork(network.Name, caddy);
  }
}

