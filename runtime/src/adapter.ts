// The Docker adapter's rules (FR-D03, FR-D04): check an app's fully resolved Compose file, the JSON
// from `docker compose config --format json`, and build the file Your Space runs. Pure functions, so
// the rules are tested without Docker.
import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { RegistryCredential } from "./engine.ts";

export interface AppSpec {
  /** Stable server installation ID for a kit with agent access; identifies its declared interface. */
  appId?: string;
  /** The Compose project, `ys-<app>`. */
  project: string;
  app: string;
  /** The installation's own Compose project, so two installations on one engine never mix. */
  installation: string;
  compose: string;
  env: Record<string, string>;
  /** Image reference → `sha256:…` index digest. */
  pins?: Record<string, string>;
  interface?: { service: string; port: number } | null;
  limits?: Record<string, { memory?: number; cpus?: number }>;
  egress?: string[];
  /**
   * Publishes the interface on a port of this machine, for the owner's own network setup. With
   * `frame`, the app's Caddy lets only Your Space's origin frame it, so Your Space shows it in its pane.
   */
  publish?: { port: number; bind: string; frame?: boolean } | null;
  /**
   * A check gives each setting the file requires and `env` has no value for a placeholder, so the
   * owner can review the file before filling those settings in. An apply ignores it.
   */
  placeholders?: boolean;
  /**
   * Signs the engine in to a registry for the images each credential names, for the lookups and
   * pulls of those images alone (journey 015, R9).
   */
  registryCredentials?: RegistryCredential[];
  /**
   * The knowledge bases the owner gave an app whose kit asks for knowledge (journey 014): Your Space
   * mounts each in the interface service at `<path>/<name>`. A check sends the path with no bases, so
   * the review refuses a file that mounts something of its own there.
   */
  knowledge?: { path: string; bases: string[] } | null;
}

export interface Adaptation {
  service: string;
  kind: "changed" | "left_out" | "added";
  detail: string;
}

export interface Refusal {
  service: string;
  setting: string;
  reason: string;
}

export interface ServiceSummary {
  name: string;
  image: string;
  interface: boolean;
  /** Container ports the file publishes or exposes, the first published first. */
  ports: number[];
  /** The machine's ports the file publishes, each with the container port it leads to. */
  published: { target: number; host: number }[];
  volumes: string[];
  dependsOn: string[];
}

export interface CheckResult {
  services: ServiceSummary[];
  adaptations: Adaptation[];
  refusals: Refusal[];
  /** The file to run, or null when anything was refused. */
  adapted: Record<string, unknown> | null;
}

type Json = Record<string, unknown>;

export const DEFAULT_MEMORY = 1024 * 1024 * 1024;
export const DEFAULT_CPUS = 1;
export const EGRESS_SERVICE = "ys-egress";
export const EGRESS_PORT = 3128;
export const EGRESS_IMAGE = "ubuntu/squid";
const EGRESS_MEMORY = 64 * 1024 * 1024;
const EGRESS_CPUS = 0.25;
const EGRESS_FILES = 4096;
export const PUBLISH_SERVICE = "ys-publish";
/** The port a published app's Caddy listens on inside its container. */
export const PUBLISH_TARGET = 8080;
const PUBLISH_MEMORY = 128 * 1024 * 1024;
const PUBLISH_CPUS = 0.5;
/** Labels a published app's Caddy with the origin it lets frame the app, when it lets one. */
export const FRAME_ORIGIN_LABEL = "ai.your-space.frame-origin";

/**
 * Every knowledge base's volume name starts with this (journey 014). Compose names an app's volumes
 * `ys-<app>_<key>`, and a Compose project's name has no dot, so no volume Compose makes for an app
 * can have this name; an app's file can't name one either (`checkTopLevel`, `checkVolumes`).
 */
export const KNOWLEDGE_PREFIX = "ys-knowledge.";
/** A knowledge base's name, and its folder in the apps given it: lower-case letters, digits and dashes. */
export const KNOWLEDGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/**
 * A knowledge path: absolute and normalised, so not `/`, with no empty, `.` or `..` folder, since a
 * folder name can't start with a dot.
 */
export const KNOWLEDGE_PATH = /^(?:\/[A-Za-z0-9_][A-Za-z0-9._-]{0,63}){1,8}$/;
/**
 * Folders the container's kernel file systems are at, and the files Docker mounts in every container,
 * which a mount can't go in.
 */
const SYSTEM_FOLDERS = ["/proc", "/sys", "/dev", "/etc/resolv.conf", "/etc/hosts", "/etc/hostname"];

/** The volume that holds a knowledge base of this installation. */
export function knowledgeVolume(installation: string, name: string): string {
  return `${KNOWLEDGE_PREFIX}${installation}.${name}`;
}

/**
 * A knowledge base volume's labels: Your Space's installation and the knowledge base, never an app's
 * or a Compose project's, so nothing that finds an app's volumes finds it.
 */
export function knowledgeLabels(installation: string, name: string): Record<string, string> {
  return { "ai.your-space.installation": installation, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": name };
}

/** Whether a path is the folder or inside it. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** Whether a path is at or in one of the system folders or files a mount can't go in. */
export function reservedPath(path: string): boolean {
  return SYSTEM_FOLDERS.some((folder) => within(path, folder));
}

/** Whether a knowledge path is one Your Space mounts knowledge bases under. */
export function validKnowledgePath(path: string): boolean {
  return KNOWLEDGE_PATH.test(path) && !reservedPath(path);
}

/** Your Space's own Caddy: the image a published app's Caddy runs too, and the origin it lets frame apps. */
export interface OwnCaddy {
  /** The image's ID, `sha256:…`. */
  image: string;
  /** Its YS_ORIGIN, if it has one. */
  origin?: string;
}

/** Kept as the app wrote them. */
const ALLOWED = new Set([
  "image",
  "command",
  "entrypoint",
  "environment",
  "working_dir",
  "user",
  "healthcheck",
  "depends_on",
  "restart",
  "stop_signal",
  "stop_grace_period",
  "init",
  "tty",
  "stdin_open",
  "labels",
  "expose",
  "hostname",
  "read_only",
  "shm_size",
  "tmpfs",
  "ulimits",
  "platform",
  "pull_policy",
  "volumes",
  // Dropping capabilities only removes power.
  "cap_drop",
]);

/** Removed or replaced by Your Space, and reported. */
const REPLACED: Record<string, string> = {
  ports: "Published ports removed: Your Space routes to the app's interface itself.",
  networks: "Networks replaced by the app's own sealed network.",
  links: "Links removed: services reach each other by name on the app's network.",
  dns: "Fixed DNS servers removed: the app's network resolves names through its outbound proxy.",
  dns_search: "DNS search domains removed.",
  dns_opt: "DNS options removed.",
  extra_hosts: "Extra host entries removed.",
  container_name: "Container name removed, so two apps can't collide.",
  logging: "Logging settings replaced by Your Space's.",
  mem_limit: "Memory limit replaced by Your Space's limit for this service.",
  memswap_limit: "Swap limit replaced by Your Space's limit for this service.",
  mem_reservation: "Memory reservation removed.",
  cpus: "CPU limit replaced by Your Space's limit for this service.",
  cpu_shares: "CPU shares removed.",
  cpu_quota: "CPU quota replaced by Your Space's limit.",
  cpu_period: "CPU period removed.",
  cpuset: "CPU set removed.",
  deploy: "Deploy settings replaced by Your Space's limits.",
  oom_score_adj: "Out-of-memory priority replaced: apps are stopped before Your Space.",
  oom_kill_disable: "Out-of-memory setting removed.",
  scale: "Scale removed: each service runs once.",
  domainname: "Domain name removed.",
  mac_address: "MAC address removed.",
  develop: "Development settings removed.",
};

/** Refused with the reason. */
const REFUSED: Record<string, string> = {
  privileged: "A privileged container controls the whole machine.",
  devices: "Host devices are not available to apps.",
  device_cgroup_rules: "Host devices are not available to apps.",
  cap_add: "Extra kernel capabilities are not available to apps.",
  security_opt: "Security options can't be changed by apps.",
  pid: "Apps can't share the host's or another container's processes.",
  ipc: "Apps can't share the host's or another container's memory.",
  uts: "Apps can't share the host's name space.",
  userns_mode: "Apps can't change user name spaces.",
  cgroup: "Apps can't share the host's control groups.",
  cgroup_parent: "Apps can't choose their control group.",
  volumes_from: "Apps can't mount another container's volumes.",
  sysctls: "Kernel settings can't be changed by apps.",
  // Compose reads both before the adapter sees the file; `envFiles` checks them first.
  env_file: "Settings files on the machine can't be read.",
  label_file: "Label files on the machine can't be read.",
  secrets: "File-based secrets aren't supported; use the app's settings.",
  configs: "File-based configs aren't supported.",
  group_add: "Extra groups are not available to apps.",
  runtime: "Apps can't choose the container runtime.",
  isolation: "Apps can't choose the isolation technology.",
  gpus: "GPUs are not available to apps yet.",
  storage_opt: "Storage options can't be changed by apps.",
  blkio_config: "Block device settings are not available to apps.",
  external_links: "Apps can't link to containers outside the app.",
  credential_spec: "Credential specs are not supported.",
  annotations: "Annotations are not supported.",
  attach: "Attach settings are not supported.",
  provider: "Service providers are not supported.",
  models: "Model runners are not supported.",
  use_api_socket: "Apps can't use the engine's API socket.",
};

const PRIVATE_MODES = new Set(["", "private", "none", "shareable"]);

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Escapes `$` so Compose doesn't interpolate the resolved values a second time. */
export function escapeDollars(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("$", "$$");
  if (Array.isArray(value)) return value.map(escapeDollars);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeDollars(v)]));
  return value;
}

/** `name:tag` or `name@digest` → the reference without any digest, with an explicit tag. */
export function imageRef(image: string): string {
  const at = image.indexOf("@");
  const base = at === -1 ? image : image.slice(0, at);
  const lastSlash = base.lastIndexOf("/");
  return base.slice(lastSlash + 1).includes(":") ? base : `${base}:latest`;
}

export function pinnedImage(image: string, digest: string): string {
  const ref = imageRef(image);
  const name = ref.slice(0, ref.lastIndexOf(":"));
  return `${name}@${digest}`;
}

/**
 * The files an app's services load settings and labels from (2026-11-23), from Compose's reading of
 * the app's file before it reads any of them: `docker compose config` with every resolution turned
 * off (`UNRESOLVED`). Compose puts what such a file holds into the service and drops the key, so the
 * adapter alone would never see one.
 *
 * A service whose `env_file` names only `.env`, the file next to the Compose file where self-hosted
 * apps keep their settings, gets the environment the app's kit defines instead (`adapt`). Any other
 * settings file, and any label file, is refused. Compose is told to read none of them (`resetFiles`).
 */
export interface EnvFiles {
  /** Services that load `.env`, and so get the environment the app's kit defines. */
  settings: string[];
  /** Per service, the keys Compose must not read: `env_file`, `label_file` or both. */
  reset: Record<string, string[]>;
  refusals: Refusal[];
}

export const NO_ENV_FILES: EnvFiles = { settings: [], reset: {}, refusals: [] };

/** `docker compose config` flags that read the file as written: nothing it names, nothing interpolated. */
export const UNRESOLVED = ["--no-interpolate", "--no-env-resolution", "--no-normalize", "--no-path-resolution", "--no-consistency"];

/** The paths a service's `env_file` or `label_file` names, in any of Compose's forms. */
function filePaths(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return entries.map((entry) => String(isObject(entry) ? entry.path : entry));
}

/** The app's own settings file, `.env` next to the Compose file. */
const SETTINGS_FILE = new Set([".env", "./.env"]);

export function envFiles(unresolved: Json): EnvFiles {
  // Service names come from the app's file, so `__proto__` must be a key like any other.
  const files: EnvFiles = { settings: [], reset: Object.create(null) as EnvFiles["reset"], refusals: [] };
  const services = isObject(unresolved.services) ? unresolved.services : {};
  for (const [name, service] of Object.entries(services)) {
    if (!isObject(service)) continue;
    const envPaths = filePaths(service.env_file);
    const labelPaths = filePaths(service.label_file);
    const reset = [...(envPaths.length > 0 ? ["env_file"] : []), ...(labelPaths.length > 0 ? ["label_file"] : [])];
    if (reset.length === 0) continue;
    files.reset[name] = reset;
    const others = envPaths.filter((path) => !SETTINGS_FILE.has(path));
    for (const path of new Set(others)) {
      files.refusals.push({ service: name, setting: "env_file", reason: `Settings file ${path} can't be read: Your Space gives a service the environment its kit defines in place of .env only.` });
    }
    for (const path of new Set(labelPaths)) {
      files.refusals.push({ service: name, setting: "label_file", reason: `Label file ${path} can't be read: apps can't read files on the machine.` });
    }
    if (envPaths.length > 0 && others.length === 0) files.settings.push(name);
  }
  return files;
}

/** A Compose file, given after the app's, that tells Compose not to read the files `envFiles` found. */
export function resetFiles(reset: EnvFiles["reset"]): string {
  const lines = ["services:"];
  for (const [service, keys] of Object.entries(reset)) {
    lines.push(`  ${JSON.stringify(service)}:`);
    for (const key of keys) lines.push(`    ${key}: !reset []`);
  }
  return `${lines.join("\n")}\n`;
}

const KNOWLEDGE_ONLY = "only Your Space mounts knowledge bases, in the apps the owner gives them to.";

function checkVolumes(service: string, volumes: unknown, refusals: Refusal[]): void {
  if (!Array.isArray(volumes)) return;
  for (const volume of volumes) {
    if (!isObject(volume)) continue;
    const type = volume.type;
    if (type === "volume" && String(volume.source ?? "").startsWith(KNOWLEDGE_PREFIX)) {
      refusals.push({ service, setting: "volumes", reason: `Volume ${String(volume.source)} is a knowledge base's: ${KNOWLEDGE_ONLY}` });
      continue;
    }
    if (type === "volume" || type === "tmpfs") continue;
    if (type === "bind") {
      refusals.push({ service, setting: "volumes", reason: `Host folder ${String(volume.source)} can't be mounted; apps keep data in named volumes.` });
    } else {
      refusals.push({ service, setting: "volumes", reason: `Volume type ${String(type)} isn't supported.` });
    }
  }
}

function checkService(name: string, service: Json, refusals: Refusal[], adaptations: Adaptation[]): void {
  for (const [key, value] of Object.entries(service)) {
    if (value === null || value === undefined) continue;
    if (ALLOWED.has(key)) continue;
    if (key in REPLACED) {
      if (Array.isArray(value) && value.length === 0) continue;
      // Compose's own default network, which every file gets.
      if (key === "networks" && isObject(value) && Object.keys(value).every((n) => n === "default")) continue;
      if (isObject(value) && Object.keys(value).length === 0) continue;
      adaptations.push({ service: name, kind: "changed", detail: REPLACED[key]! });
      continue;
    }
    if (key === "network_mode") {
      if (value === "bridge" || value === "default") {
        adaptations.push({ service: name, kind: "changed", detail: REPLACED.networks! });
      } else {
        refusals.push({ service: name, setting: key, reason: `Network mode ${String(value)} would leave the app's sealed network.` });
      }
      continue;
    }
    if (key === "build") {
      if (typeof service.image === "string" && service.image) {
        adaptations.push({ service: name, kind: "changed", detail: "Build settings removed: Your Space runs the published image." });
      } else {
        refusals.push({ service: name, setting: key, reason: "Your Space runs published images only, and this service has none." });
      }
      continue;
    }
    if (key === "security_opt" && Array.isArray(value) && value.every((o) => /^no-new-privileges(:true)?$/.test(String(o)))) {
      // Your Space sets this on every service anyway.
      continue;
    }
    if (key in REFUSED) {
      if (Array.isArray(value) && value.length === 0) continue;
      if (isObject(value) && Object.keys(value).length === 0) continue;
      if ((key === "ipc" || key === "pid" || key === "uts" || key === "cgroup") && typeof value === "string" && PRIVATE_MODES.has(value)) continue;
      if (key === "privileged" && value === false) continue;
      refusals.push({ service: name, setting: key, reason: REFUSED[key]! });
      continue;
    }
    refusals.push({ service: name, setting: key, reason: `The setting ${key} isn't one Your Space knows is safe.` });
  }
  if (typeof service.image !== "string" || !service.image) {
    if (service.build === undefined) refusals.push({ service: name, setting: "image", reason: "The service has no image." });
  }
  checkVolumes(name, service.volumes, refusals);
}

function checkTopLevel(resolved: Json, refusals: Refusal[]): void {
  const volumes = isObject(resolved.volumes) ? resolved.volumes : {};
  for (const [name, volume] of Object.entries(volumes)) {
    // Your Space's own knowledge base volumes are named this way in the file it runs.
    if (name.startsWith(KNOWLEDGE_PREFIX) || (isObject(volume) && String(volume.name ?? "").startsWith(KNOWLEDGE_PREFIX))) {
      refusals.push({ service: "", setting: `volumes.${name}`, reason: `The volume names a knowledge base's: ${KNOWLEDGE_ONLY}` });
      continue;
    }
    if (!isObject(volume)) continue;
    if (volume.external) refusals.push({ service: "", setting: `volumes.${name}`, reason: "External volumes belong to something else on the machine." });
    if (volume.driver && volume.driver !== "local") refusals.push({ service: "", setting: `volumes.${name}`, reason: `Volume driver ${String(volume.driver)} isn't supported.` });
    if (isObject(volume.driver_opts) && Object.keys(volume.driver_opts).length > 0) {
      refusals.push({ service: "", setting: `volumes.${name}`, reason: "Volume driver options can mount host folders or network shares." });
    }
  }
  const networks = isObject(resolved.networks) ? resolved.networks : {};
  for (const [name, network] of Object.entries(networks)) {
    if (isObject(network) && network.external) {
      refusals.push({ service: "", setting: `networks.${name}`, reason: "External networks would connect the app to something else on the machine." });
    }
  }
  for (const key of ["secrets", "configs", "models"]) {
    if (isObject(resolved[key]) && Object.keys(resolved[key] as Json).length > 0) {
      refusals.push({ service: "", setting: key, reason: REFUSED[key] ?? `${key} aren't supported.` });
    }
  }
}

/**
 * The paths a service mounts a volume, a host folder or a tmpfs at, normalised as the engine does:
 * Compose cleans a volume's target, but leaves a short-form tmpfs as written, so `//knowledge`,
 * `/./knowledge/notes` and `/x/../knowledge` are each in the knowledge path.
 */
function mountTargets(service: Json): string[] {
  const targets: string[] = [];
  for (const volume of Array.isArray(service.volumes) ? service.volumes : []) if (isObject(volume) && typeof volume.target === "string") targets.push(volume.target);
  const tmpfs = Array.isArray(service.tmpfs) ? service.tmpfs : typeof service.tmpfs === "string" ? [service.tmpfs] : [];
  for (const entry of tmpfs) targets.push(String(entry).split(":")[0]!);
  return targets.map((target) => {
    const clean = posix.normalize(target);
    return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
  });
}

function dependsOn(service: Json): string[] {
  if (isObject(service.depends_on)) return Object.keys(service.depends_on);
  if (Array.isArray(service.depends_on)) return service.depends_on.map(String);
  return [];
}

function namedVolumes(service: Json): string[] {
  if (!Array.isArray(service.volumes)) return [];
  return service.volumes.filter((v): v is Json => isObject(v) && v.type === "volume" && typeof v.source === "string").map((v) => v.source as string);
}

function publishedPorts(service: Json): { target: number; host: number }[] {
  const ports: { target: number; host: number }[] = [];
  for (const p of Array.isArray(service.ports) ? service.ports : []) {
    if (!isObject(p)) continue;
    const target = Number(p.target);
    const host = Number(p.published);
    if (Number.isInteger(target) && Number.isInteger(host) && host > 0 && host <= 65535) ports.push({ target, host });
  }
  return ports;
}

function servicePorts(service: Json): number[] {
  const ports: number[] = [];
  for (const p of Array.isArray(service.ports) ? service.ports : []) {
    const target = Number(isObject(p) ? p.target : String(p).split(":").pop());
    if (Number.isInteger(target) && target > 0 && !ports.includes(target)) ports.push(target);
  }
  return ports;
}

/**
 * How Docker restarts a service. Your Space keeps services running, so they come back after a
 * restart of the machine, except a service its file says runs once, such as a database migration:
 * `restart: "no"` or `on-failure`, or Compose's `deploy.restart_policy` (whose other settings Your
 * Space replaces) with `none` or `on-failure`. Without either, it is `unless-stopped`.
 */
export function restartPolicy(service: Json): string {
  const restart = typeof service.restart === "string" ? service.restart : undefined;
  if (restart) return restart;
  const policy = isObject(service.deploy) && isObject(service.deploy.restart_policy) ? service.deploy.restart_policy : {};
  if (policy.condition === "none") return "no";
  if (policy.condition === "on-failure") {
    const attempts = Number(policy.max_attempts);
    return Number.isInteger(attempts) && attempts > 0 ? `on-failure:${attempts}` : "on-failure";
  }
  return "unless-stopped";
}

/** Whether a restart policy from `restartPolicy` is one of a service that runs once. */
export function runsOnce(restart: string): boolean {
  return restart === "no" || restart.startsWith("on-failure");
}

/** The Squid configuration for an app's egress proxy (FR-019). */
export function egressConfig(hosts: string[]): string {
  const lines = [
    `http_port ${EGRESS_PORT}`,
    "pid_filename none",
    "pinger_enable off",
    // Each refused host is written at once, so it becomes an access request without delay.
    "buffered_logs off",
    // Squid sizes its tables by the open-file limit; a machine's Docker can allow a million, which
    // alone exceeds the proxy's memory limit.
    `max_filedescriptors ${EGRESS_FILES}`,
    "cache deny all",
    "access_log stdio:/var/log/squid/access.log logformat=squid",
    "cache_log stdio:/var/log/squid/cache.log",
    "acl private dst 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 fc00::/7 fe80::/10 ::1",
    "http_access deny private",
  ];
  if (hosts.length > 0) {
    lines.push(`acl approved dstdomain ${hosts.join(" ")}`, "http_access allow approved");
  }
  lines.push("http_access deny all", "");
  return lines.join("\n");
}

/**
 * Checks the resolved file and, when nothing is refused, builds the file to run. A published app's own
 * Caddy runs the image of Your Space's Caddy, and lets that Caddy's origin frame the app when the owner
 * shows it in Your Space. A service that loads `.env` gets the environment the kit defines (`files`, in
 * `spec.env`), under the environment its file sets, as Compose puts a settings file's values under it.
 */
export function adapt(spec: AppSpec, resolved: Json, profiledServices: string[] = [], caddy?: OwnCaddy, files: EnvFiles = NO_ENV_FILES): CheckResult {
  const services = isObject(resolved.services) ? resolved.services : {};
  // A service left out with its profile doesn't run, so the files it names don't matter.
  const refusals: Refusal[] = files.refusals.filter((r) => r.service in services);
  const adaptations: Adaptation[] = [];
  const settings = files.settings.filter((name) => name in services);
  // Escaped as Compose escapes the values it resolved, so `up` takes each `$` as it is.
  const settingValues = Object.fromEntries(Object.entries(spec.env).map(([name, value]) => [name, value.split("$").join("$$")]));
  for (const name of settings) {
    adaptations.push({
      service: name,
      kind: "changed",
      detail: "Settings file .env replaced: Your Space gives the service the environment its installation kit defines.",
    });
  }

  for (const name of profiledServices) {
    if (!(name in services)) {
      adaptations.push({ service: name, kind: "left_out", detail: "Left out: it runs only with a Compose profile." });
    }
  }
  if (Object.keys(services).length === 0) {
    refusals.push({ service: "", setting: "services", reason: "The file defines no services that run by default." });
  }
  for (const reserved of [EGRESS_SERVICE, PUBLISH_SERVICE]) {
    if (reserved in services) {
      refusals.push({ service: reserved, setting: "services", reason: `The service name ${reserved} is reserved for Your Space.` });
    }
  }
  checkTopLevel(resolved, refusals);
  for (const [name, service] of Object.entries(services)) {
    if (isObject(service)) checkService(name, service, refusals, adaptations);
  }
  if (spec.interface && !(spec.interface.service in services)) {
    refusals.push({ service: spec.interface.service, setting: "interface", reason: "The installation kit names an interface service the file doesn't have." });
  }
  if (spec.publish && !spec.interface) {
    refusals.push({ service: "", setting: "publish", reason: "Only an app with an interface can be published on a port." });
  }
  if (spec.publish && spec.interface && !caddy) {
    refusals.push({ service: "", setting: "publish", reason: "Your Space's Caddy isn't running, so the app can't be published until it is." });
  }
  if (spec.publish?.frame && spec.interface && caddy && !caddy.origin) {
    refusals.push({ service: "", setting: "publish", reason: "Your Space's Caddy has no origin set, so the app can't be shown inside Your Space. Turn that off for it." });
  }
  const knowledge = spec.knowledge ?? null;
  if (knowledge && !spec.interface) {
    refusals.push({ service: "", setting: "knowledge", reason: "Only an app with an interface can be given knowledge bases: Your Space mounts them in its interface service." });
  }
  if (knowledge && spec.interface && isObject(services[spec.interface.service])) {
    // The knowledge path is Your Space's, so a knowledge base's folder is never hidden or taken.
    for (const target of mountTargets(services[spec.interface.service] as Json)) {
      if (within(target, knowledge.path)) {
        refusals.push({
          service: spec.interface.service,
          setting: "volumes",
          reason: `The file mounts ${target} in the app's knowledge path, ${knowledge.path}, where Your Space mounts the knowledge bases the owner gives the app.`,
        });
      }
    }
    // A knowledge base's folder can land on one of the files Docker mounts, as /etc and hosts do.
    for (const name of knowledge.bases) {
      const target = `${knowledge.path}/${name}`;
      if (reservedPath(target)) {
        refusals.push({ service: spec.interface.service, setting: "knowledge", reason: `The knowledge base ${name} would be mounted at ${target}, where Docker mounts a file of its own, so the app can't be given it.` });
      }
    }
  }

  const summaries: ServiceSummary[] = Object.entries(services)
    .filter(([, s]) => isObject(s))
    .map(([name, s]) => ({
      name,
      image: String((s as Json).image ?? ""),
      interface: spec.interface?.service === name,
      ports: servicePorts(s as Json),
      published: publishedPorts(s as Json),
      volumes: namedVolumes(s as Json),
      dependsOn: dependsOn(s as Json),
    }));

  if (refusals.length > 0) return { services: summaries, adaptations, refusals, adapted: null };

  const proxy = `http://${EGRESS_SERVICE}:${EGRESS_PORT}`;
  const noProxy = ["localhost", "127.0.0.1", ...Object.keys(services)].join(",");
  const labels = { "ai.your-space.installation": spec.installation, "ai.your-space.app": spec.app };
  const outServices: Json = {};

  for (const [name, raw] of Object.entries(services)) {
    const service = raw as Json;
    const out: Json = {};
    for (const key of Object.keys(service)) if (ALLOWED.has(key) && service[key] !== null) out[key] = service[key];
    if (typeof out.image === "string") {
      const digest = spec.pins?.[imageRef(out.image)];
      if (digest) out.image = pinnedImage(out.image, digest);
    }
    out.restart = restartPolicy(service);
    const environment = { ...(settings.includes(name) ? settingValues : {}), ...(isObject(service.environment) ? service.environment : {}) };
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) environment[key] = proxy;
    environment.NO_PROXY = noProxy;
    environment.no_proxy = noProxy;
    out.environment = environment;
    const serviceLabels = { ...(isObject(service.labels) ? service.labels : {}), ...labels } as Json;
    // The server and runtime determine these labels. A Compose file cannot declare its own identity.
    delete serviceLabels["ai.your-space.app-id"];
    delete serviceLabels["ai.your-space.interface-port"];
    if (spec.appId && spec.interface?.service === name) {
      serviceLabels["ai.your-space.app-id"] = spec.appId;
      serviceLabels["ai.your-space.interface-port"] = String(spec.interface.port);
    }
    out.labels = serviceLabels;
    out.networks = {
      app: spec.interface?.service === name ? { aliases: [`${spec.project}-ui`] } : {},
    };
    const limit = spec.limits?.[name] ?? {};
    out.mem_limit = limit.memory ?? DEFAULT_MEMORY;
    out.cpus = limit.cpus ?? DEFAULT_CPUS;
    out.oom_score_adj = 500;
    out.security_opt = ["no-new-privileges:true"];
    // Each service starts once the outbound proxy answers, so its first requests aren't lost.
    out.depends_on = {
      ...(isObject(service.depends_on) ? service.depends_on : {}),
      [EGRESS_SERVICE]: { condition: "service_healthy", required: true },
    };
    outServices[name] = out;
  }

  const egressHosts = [...new Set((spec.egress ?? []).map((h) => h.toLowerCase()))].sort();
  const egress = egressConfig(egressHosts);
  outServices[EGRESS_SERVICE] = {
    image: spec.pins?.[`${EGRESS_IMAGE}:latest`] ? pinnedImage(EGRESS_IMAGE, spec.pins[`${EGRESS_IMAGE}:latest`]!) : `${EGRESS_IMAGE}:latest`,
    restart: "unless-stopped",
    networks: { app: {}, egress: {} },
    configs: [{ source: "egress", target: "/etc/squid/squid.conf" }],
    ulimits: { nofile: { soft: EGRESS_FILES, hard: EGRESS_FILES } },
    healthcheck: {
      test: ["CMD", "bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${EGRESS_PORT}`],
      interval: "10s",
      timeout: "3s",
      retries: 3,
      start_period: "30s",
      start_interval: "1s",
    },
    // Compose doesn't recreate a container when only its inline config changes; a label does.
    labels: { ...labels, "ai.your-space.role": "egress", "ai.your-space.egress-config": createHash("sha256").update(egress).digest("hex").slice(0, 16) },
    mem_limit: EGRESS_MEMORY,
    cpus: EGRESS_CPUS,
    oom_score_adj: 500,
    security_opt: ["no-new-privileges:true"],
  };
  adaptations.push({ service: EGRESS_SERVICE, kind: "added", detail: "Added Your Space's outbound proxy, which lets the app reach only approved hosts." });

  const networks: Json = {
    app: {
      internal: true,
      driver: "bridge",
      driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
      labels,
    },
    egress: { driver: "bridge", labels },
  };
  if (spec.publish && spec.interface && caddy) {
    // The app's own services stay on the sealed network, where Docker publishes no port. A Caddy of
    // Your Space's, from its own image (deploy/published.caddyfile), joins that network and one of its
    // own, listens on the machine's port, and passes every request to the interface, so the owner's
    // proxy or tunnel reaches the app there. It passes the app's responses on unchanged, except that
    // when the owner shows the app in Your Space it lets only Your Space's origin frame it.
    const frame = spec.publish.frame === true;
    outServices[PUBLISH_SERVICE] = {
      image: caddy.image,
      command: ["caddy", "run", "--config", "/etc/caddy/published.caddyfile", "--adapter", "caddyfile"],
      environment: {
        YS_UPSTREAM: `${spec.project}-ui:${spec.interface.port}`,
        YS_FRAME: frame ? "on" : "off",
        ...(frame ? { YS_ORIGIN: caddy.origin } : {}),
        // Caddy keeps its few files in memory: the root is read-only.
        XDG_DATA_HOME: "/tmp/data",
        XDG_CONFIG_HOME: "/tmp/config",
      },
      restart: "unless-stopped",
      user: "65534:65534",
      read_only: true,
      tmpfs: ["/tmp"],
      cap_drop: ["ALL"],
      networks: { app: {}, publish: {} },
      ports: [{ target: PUBLISH_TARGET, published: String(spec.publish.port), host_ip: spec.publish.bind, protocol: "tcp" }],
      labels: { ...labels, "ai.your-space.role": "publish", ...(frame ? { [FRAME_ORIGIN_LABEL]: caddy.origin } : {}) },
      mem_limit: PUBLISH_MEMORY,
      cpus: PUBLISH_CPUS,
      oom_score_adj: 500,
      security_opt: ["no-new-privileges:true"],
    };
    networks.publish = { driver: "bridge", labels };
    adaptations.push({
      service: PUBLISH_SERVICE,
      kind: "added",
      detail: `Added Your Space's Caddy, which publishes the app's interface on ${spec.publish.bind}:${spec.publish.port}${frame ? " and lets only Your Space frame it" : ""}.`,
    });
  }

  const volumes = isObject(resolved.volumes) ? resolved.volumes : {};
  const outVolumes: Json = {};
  for (const name of Object.keys(volumes)) outVolumes[name] = { labels: labels };

  if (knowledge && spec.interface && knowledge.bases.length > 0) {
    // The one shared volume an app mounts (decision 2026-11-25): Your Space's own knowledge bases, the
    // ones the owner gave the app, each in its own folder. Compose uses each as it is and never removes
    // it; `nocopy` keeps an image's files at the folder from being copied into an empty one.
    const service = outServices[spec.interface.service] as Json;
    const mounts = knowledge.bases.map((name) => ({
      type: "volume",
      source: knowledgeVolume(spec.installation, name),
      target: `${knowledge.path}/${name}`,
      volume: { nocopy: true },
    }));
    service.volumes = [...(Array.isArray(service.volumes) ? service.volumes : []), ...mounts];
    for (const mount of mounts) outVolumes[mount.source] = { external: true, name: mount.source };
    adaptations.push({
      service: spec.interface.service,
      kind: "added",
      detail: `Added the knowledge bases you gave the app: ${mounts.map((m) => m.target).join(", ")}.`,
    });
  }

  const adapted: Json = {
    name: spec.project,
    services: escapeDollars(outServices) as Json,
    networks,
    volumes: outVolumes,
    configs: { egress: { content: escapeDollars(egress) } },
  };
  return { services: summaries, adaptations, refusals, adapted };
}
