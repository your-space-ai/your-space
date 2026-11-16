// What the runtime manager does with apps: check, apply, stop, and report.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adapt, EGRESS_IMAGE, imageRef, type AppSpec, type CheckResult } from "./adapter.ts";
import {
  connectNetwork,
  docker,
  engine,
  engineInfo,
  engineJson,
  EngineError,
  inspectImage,
  listContainers,
  pullImage,
  scrub,
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

const PROJECT = /^ys-[a-z][a-z0-9-]{0,29}$/;

export function validateSpec(body: unknown): AppSpec {
  const spec = body as Partial<AppSpec>;
  if (!spec || typeof spec !== "object") throw new SpecError("The request needs an app.");
  if (typeof spec.project !== "string" || !PROJECT.test(spec.project)) throw new SpecError("The project name isn't valid.");
  if (typeof spec.app !== "string" || `ys-${spec.app}` !== spec.project) throw new SpecError("The app name doesn't match the project.");
  if (typeof spec.compose !== "string" || spec.compose.length > 512 * 1024) throw new SpecError("The app's file is missing or too large.");
  const env = spec.env ?? {};
  if (typeof env !== "object" || Object.entries(env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string")) {
    throw new SpecError("Settings must be names with text values.");
  }
  return { ...spec, installation: INSTALLATION, env } as AppSpec;
}

let stopping = false;

export function isStopping(): boolean {
  return stopping;
}

interface Resolved {
  resolved: Record<string, unknown>;
  profiled: string[];
  variables: { name: string; required: boolean; default: string }[];
}

async function resolve(spec: AppSpec): Promise<Resolved> {
  const dir = mkdtempSync("/tmp/ys-check-");
  try {
    writeFileSync(join(dir, "compose.yaml"), spec.compose, { mode: 0o600 });
    const base = ["compose", "-p", spec.project, "--project-directory", dir, "-f", join(dir, "compose.yaml")];
    const [plain, all, variables] = await Promise.all([
      docker([...base, "config", "--format", "json"], spec.env, dir),
      docker([...base, "--profile", "*", "config", "--format", "json"], spec.env, dir),
      docker([...base, "config", "--variables", "--format", "json"], {}, dir),
    ]);
    if (plain.code !== 0) {
      const message = scrub(plain.stderr, spec.env)
        .split("\n")
        .filter((l) => l.trim() && !/level=warning/.test(l))
        .join(" ")
        .slice(0, 600);
      throw new SpecError(`The file isn't a Compose file Your Space can read: ${message || "Compose refused it."}`);
    }
    const resolved = JSON.parse(plain.stdout) as Record<string, unknown>;
    const allServices = all.code === 0 ? Object.keys((JSON.parse(all.stdout) as { services?: object }).services ?? {}) : [];
    const running = Object.keys((resolved.services as object) ?? {});
    const vars =
      variables.code === 0
        ? Object.values(JSON.parse(variables.stdout) as Record<string, { Name: string; DefaultValue: string; Required: boolean }>).map((v) => ({
            name: v.Name,
            required: v.Required,
            default: v.DefaultValue,
          }))
        : [];
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

async function checkWithImages(spec: AppSpec): Promise<{ answer: CheckAnswer; adapted: CheckResult["adapted"] }> {
  const { resolved, profiled, variables } = await resolve(spec);
  const info = await engineInfo();
  if (!info.reachable) throw new EngineError("The engine can't be reached.", 503);
  const refs = [...new Set(Object.values((resolved.services as Record<string, { image?: string }>) ?? {}).map((s) => s.image).filter((i): i is string => !!i).map(imageRef))];
  refs.push(`${EGRESS_IMAGE}:latest`);
  const pins: Record<string, string> = { ...(spec.pins ?? {}) };
  const images = await Promise.all(
    refs.map(async (ref) => {
      if (pins[ref]) return { ref, digest: pins[ref], platforms: [], runsHere: true } satisfies ImageCheck;
      const image = await inspectImage(ref, info.arch ?? "amd64");
      if (image.digest) pins[ref] = image.digest;
      return image;
    }),
  );
  const result = adapt({ ...spec, pins }, resolved, profiled);
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
  return (await checkWithImages(spec)).answer;
}

async function installationContainer(service: string): Promise<string | undefined> {
  const found = await listContainers([`com.docker.compose.project=${INSTALLATION}`, `com.docker.compose.service=${service}`]);
  return found.find((c) => c.State === "running")?.Id ?? found[0]?.Id;
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
  const { answer, adapted } = await checkWithImages(spec);
  if (!adapted) {
    throw new SpecError(answer.refusals.map((r) => `${r.service ? `${r.service}: ` : ""}${r.reason}`).join(" "));
  }
  const services = adapted.services as Record<string, { image: string }>;
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
    const up = await docker(["compose", "-p", spec.project, "--project-directory", dir, "-f", join(dir, "compose.json"), "up", "-d", "--remove-orphans", "--pull", "never"], {}, dir);
    if (up.code !== 0) {
      throw new EngineError(`Starting the app failed: ${scrub(up.stderr, spec.env).split("\n").filter((l) => l.trim()).slice(-3).join(" ").slice(0, 600)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await connectProxy(spec.project);
  emit({ step: "started" });
}

async function connectProxy(project: string): Promise<void> {
  const caddy = await installationContainer("caddy");
  if (caddy) await connectNetwork(`${project}_app`, caddy);
}

export async function stop(project: string): Promise<void> {
  const result = await docker(["compose", "-p", project, "stop"]);
  if (result.code !== 0) throw new EngineError(`Stopping the app failed: ${result.stderr.trim().slice(0, 400)}`);
}

export interface ServiceState {
  name: string;
  role: "app" | "egress";
  state: string;
  health?: string;
  exitCode?: number;
  oomKilled?: boolean;
}

export async function listApps(): Promise<{ project: string; app: string; services: ServiceState[] }[]> {
  const containers = await listContainers([INSTALLATION_LABEL]);
  const byProject = new Map<string, { project: string; app: string; services: ServiceState[] }>();
  for (const c of containers) {
    const project = c.Labels["com.docker.compose.project"];
    const app = c.Labels["ai.your-space.app"];
    if (!project || !app) continue;
    const entry = byProject.get(project) ?? { project, app, services: [] };
    const service: ServiceState = {
      name: c.Labels["com.docker.compose.service"] ?? c.Names[0] ?? c.Id,
      role: c.Labels["ai.your-space.role"] === "egress" ? "egress" : "app",
      state: c.State,
    };
    const health = /\((healthy|unhealthy|health: starting)\)/.exec(c.Status)?.[1];
    if (health) service.health = health.replace("health: ", "");
    if (c.State === "exited" || c.State === "dead" || c.State === "restarting") {
      const detail = await engineJson<{ State: { ExitCode: number; OOMKilled: boolean } }>("GET", `/containers/${c.Id}/json`);
      service.exitCode = detail.State.ExitCode;
      service.oomKilled = detail.State.OOMKilled;
    }
    entry.services.push(service);
    byProject.set(project, entry);
  }
  return [...byProject.values()];
}

async function projectContainers(project: string) {
  return listContainers([INSTALLATION_LABEL, `com.docker.compose.project=${project}`]);
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

/** Keeps Your Space's proxy connected to every app's network, for example after Caddy is recreated. */
export async function connectProxyToAll(): Promise<void> {
  const caddy = await installationContainer("caddy");
  if (!caddy) return;
  const detail = await engineJson<{ NetworkSettings: { Networks: Record<string, unknown> } }>("GET", `/containers/${caddy}/json`);
  const joined = new Set(Object.keys(detail.NetworkSettings.Networks));
  const filters = encodeURIComponent(JSON.stringify({ label: [INSTALLATION_LABEL] }));
  const networks = await engineJson<{ Name: string }[]>("GET", `/networks?filters=${filters}`);
  for (const network of networks) {
    if (network.Name.endsWith("_app") && !joined.has(network.Name)) await connectNetwork(network.Name, caddy);
  }
}

