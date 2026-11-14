// The Docker adapter's rules (FR-D03, FR-D04): check an app's fully resolved Compose file, the JSON
// from `docker compose config --format json`, and build the file Your Space runs. Pure functions, so
// the rules are tested without Docker.

export interface AppSpec {
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
  env_file: "Environment files on the host can't be read.",
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

function checkVolumes(service: string, volumes: unknown, refusals: Refusal[]): void {
  if (!Array.isArray(volumes)) return;
  for (const volume of volumes) {
    if (!isObject(volume)) continue;
    const type = volume.type;
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

function dependsOn(service: Json): string[] {
  if (isObject(service.depends_on)) return Object.keys(service.depends_on);
  if (Array.isArray(service.depends_on)) return service.depends_on.map(String);
  return [];
}

function namedVolumes(service: Json): string[] {
  if (!Array.isArray(service.volumes)) return [];
  return service.volumes.filter((v): v is Json => isObject(v) && v.type === "volume" && typeof v.source === "string").map((v) => v.source as string);
}

/** The Squid configuration for an app's egress proxy (FR-019). */
export function egressConfig(hosts: string[]): string {
  const lines = [
    `http_port ${EGRESS_PORT}`,
    "pid_filename none",
    "pinger_enable off",
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

/** Checks the resolved file and, when nothing is refused, builds the file to run. */
export function adapt(spec: AppSpec, resolved: Json, profiledServices: string[] = []): CheckResult {
  const refusals: Refusal[] = [];
  const adaptations: Adaptation[] = [];
  const services = isObject(resolved.services) ? resolved.services : {};

  for (const name of profiledServices) {
    if (!(name in services)) {
      adaptations.push({ service: name, kind: "left_out", detail: "Left out: it runs only with a Compose profile." });
    }
  }
  if (Object.keys(services).length === 0) {
    refusals.push({ service: "", setting: "services", reason: "The file defines no services that run by default." });
  }
  if (EGRESS_SERVICE in services) {
    refusals.push({ service: EGRESS_SERVICE, setting: "services", reason: `The service name ${EGRESS_SERVICE} is reserved for Your Space.` });
  }
  checkTopLevel(resolved, refusals);
  for (const [name, service] of Object.entries(services)) {
    if (isObject(service)) checkService(name, service, refusals, adaptations);
  }
  if (spec.interface && !(spec.interface.service in services)) {
    refusals.push({ service: spec.interface.service, setting: "interface", reason: "The installation kit names an interface service the file doesn't have." });
  }

  const summaries: ServiceSummary[] = Object.entries(services)
    .filter(([, s]) => isObject(s))
    .map(([name, s]) => ({
      name,
      image: String((s as Json).image ?? ""),
      interface: spec.interface?.service === name,
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
    out.restart = service.restart && service.restart !== "no" ? service.restart : "unless-stopped";
    const environment = isObject(service.environment) ? { ...service.environment } : {};
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) environment[key] = proxy;
    environment.NO_PROXY = noProxy;
    environment.no_proxy = noProxy;
    out.environment = environment;
    out.labels = { ...(isObject(service.labels) ? service.labels : {}), ...labels };
    out.networks = {
      app: spec.interface?.service === name ? { aliases: [`${spec.project}-ui`] } : {},
    };
    const limit = spec.limits?.[name] ?? {};
    out.mem_limit = limit.memory ?? DEFAULT_MEMORY;
    out.cpus = limit.cpus ?? DEFAULT_CPUS;
    out.oom_score_adj = 500;
    out.security_opt = ["no-new-privileges:true"];
    if (isObject(service.depends_on)) out.depends_on = service.depends_on;
    outServices[name] = out;
  }

  const egressHosts = [...new Set((spec.egress ?? []).map((h) => h.toLowerCase()))].sort();
  outServices[EGRESS_SERVICE] = {
    image: spec.pins?.[`${EGRESS_IMAGE}:latest`] ? pinnedImage(EGRESS_IMAGE, spec.pins[`${EGRESS_IMAGE}:latest`]!) : `${EGRESS_IMAGE}:latest`,
    restart: "unless-stopped",
    networks: { app: {}, egress: {} },
    configs: [{ source: "egress", target: "/etc/squid/squid.conf" }],
    labels: { ...labels, "ai.your-space.role": "egress" },
    mem_limit: EGRESS_MEMORY,
    cpus: EGRESS_CPUS,
    oom_score_adj: 500,
    security_opt: ["no-new-privileges:true"],
  };
  adaptations.push({ service: EGRESS_SERVICE, kind: "added", detail: "Added Your Space's outbound proxy, which lets the app reach only approved hosts." });

  const volumes = isObject(resolved.volumes) ? resolved.volumes : {};
  const outVolumes: Json = {};
  for (const name of Object.keys(volumes)) outVolumes[name] = { labels: labels };

  const adapted: Json = {
    name: spec.project,
    services: escapeDollars(outServices) as Json,
    networks: {
      app: {
        internal: true,
        driver: "bridge",
        driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
        labels,
      },
      egress: { driver: "bridge", labels },
    },
    volumes: outVolumes,
    configs: { egress: { content: escapeDollars(egressConfig(egressHosts)) } },
  };
  return { services: summaries, adaptations, refusals, adapted };
}
