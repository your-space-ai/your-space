// Installation kits (component D, FR-002a, contracts/kit-format.md): what makes a particular app fit
// Your Space, kept in a separate repository and read as data. Your Space has no app-specific logic.
import { parse } from "yaml";
import type { Kit } from "../db/schema.ts";
import { fetchSource, githubEndpoints, SourceError, type GithubEndpoints } from "./github.ts";
import { TEMPLATE_REFERENCE, templateNames } from "./settings.ts";

export const KITS_REPO = "your-space-ai/your-space-app-kits";

export function kitsRepo(env: NodeJS.ProcessEnv = process.env): string {
  return env.YS_E2E_KITS || KITS_REPO;
}

export class KitError extends Error {
  constructor(message: string) {
    super(`The installation kit can't be used: ${message}`);
    this.name = "KitError";
  }
}

const NAME = /^[a-z][a-z0-9-]{0,29}$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const TOP_KEYS = new Set(["kit", "source", "name", "title", "interface", "pane", "generate", "derive", "set", "secrets", "outbound", "limits"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `512M`, `1.5G`, `1536Mi` or a number of bytes. */
export function parseMemory(value: string | number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  const match = /^(\d+(?:\.\d+)?)\s*([kmg])i?b?$/i.exec(String(value).trim());
  if (!match) throw new KitError(`${String(value)} isn't an amount of memory, like 512M or 1G.`);
  const unit = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2]!.toLowerCase() as "k" | "m" | "g"];
  return Math.round(Number(match[1]) * unit);
}

/** Validates a kit strictly, so a kit for a newer format never half-applies. */
export function parseKit(text: string): Kit {
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    throw new KitError("it isn't valid YAML.");
  }
  if (!isObject(data)) throw new KitError("it isn't a YAML mapping.");
  for (const key of Object.keys(data)) if (!TOP_KEYS.has(key)) throw new KitError(`it has the unknown field ${key}.`);
  if (data.kit !== 1) throw new KitError("it is for a kit format this Your Space doesn't know (kit: 1).");
  const source = data.source;
  if (!isObject(source) || typeof source.repo !== "string" || typeof source.path !== "string") {
    throw new KitError("it must name the source repo and path it fits.");
  }
  const kit: Kit = { kit: 1, source: { repo: source.repo, path: source.path } };
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || !NAME.test(data.name)) throw new KitError("its name must be lower-case letters, digits and dashes.");
    kit.name = data.name;
  }
  if (data.title !== undefined) {
    if (typeof data.title !== "string" || data.title.length > 60) throw new KitError("its title must be short text.");
    kit.title = data.title;
  }
  if (data.interface !== undefined) {
    const i = data.interface;
    if (!isObject(i) || typeof i.service !== "string" || !Number.isInteger(i.port) || (i.port as number) < 1 || (i.port as number) > 65535) {
      throw new KitError("its interface needs a service and a port.");
    }
    kit.interface = { service: i.service, port: i.port as number };
  }
  if (data.pane !== undefined) {
    if (typeof data.pane !== "boolean") throw new KitError("pane must be true or false.");
    kit.pane = data.pane;
  }
  if (data.generate !== undefined) {
    if (!isObject(data.generate)) throw new KitError("generate must map setting names to options.");
    kit.generate = {};
    for (const [name, options] of Object.entries(data.generate)) {
      if (!VARIABLE.test(name)) throw new KitError(`${name} isn't a setting name.`);
      const o = options ?? {};
      if (!isObject(o)) throw new KitError(`generate.${name} must be options.`);
      const bytes = o.bytes ?? 32;
      if (!Number.isInteger(bytes) || (bytes as number) < 16 || (bytes as number) > 128) throw new KitError(`generate.${name}.bytes must be 16 to 128.`);
      const encoding = o.encoding ?? "base64url";
      if (encoding !== "hex" && encoding !== "base64url") throw new KitError(`generate.${name}.encoding must be hex or base64url.`);
      kit.generate[name] = { bytes: bytes as number, encoding };
    }
  }
  if (data.derive !== undefined) {
    if (!isObject(data.derive)) throw new KitError("derive must map setting names to values.");
    kit.derive = {};
    for (const [name, value] of Object.entries(data.derive)) {
      if (!VARIABLE.test(name)) throw new KitError(`${name} isn't a setting name.`);
      if (value === "app_origin" || value === "app_host") {
        kit.derive[name] = value;
      } else if (isObject(value) && Object.keys(value).length === 1 && typeof value.template === "string" && value.template.length <= 1000) {
        kit.derive[name] = { template: value.template };
      } else {
        throw new KitError(`derive.${name} must be app_origin, app_host or { template: ... }.`);
      }
    }
  }
  if (data.set !== undefined) {
    if (!isObject(data.set)) throw new KitError("set must map setting names to values.");
    kit.set = {};
    for (const [name, value] of Object.entries(data.set)) {
      if (!VARIABLE.test(name)) throw new KitError(`${name} isn't a setting name.`);
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new KitError(`set.${name} must be a value.`);
      kit.set[name] = String(value);
    }
  }
  for (const [name, value] of Object.entries(kit.derive ?? {})) {
    if (typeof value === "string") continue;
    for (const ref of templateNames(value.template)) {
      const known = kit.generate?.[ref] !== undefined || kit.set?.[ref] !== undefined || typeof kit.derive?.[ref] === "string";
      if (!known) throw new KitError(`derive.${name} uses ${ref}, which the kit doesn't generate, set or derive from the app's address.`);
    }
    if (value.template.replace(TEMPLATE_REFERENCE, "").includes("${")) throw new KitError(`derive.${name} has a placeholder that isn't \${SETTING_NAME}.`);
  }
  if (data.secrets !== undefined) {
    if (!Array.isArray(data.secrets) || !data.secrets.every((s) => typeof s === "string" && VARIABLE.test(s))) {
      throw new KitError("secrets must be a list of setting names.");
    }
    kit.secrets = data.secrets as string[];
  }
  if (data.outbound !== undefined) {
    if (!Array.isArray(data.outbound)) throw new KitError("outbound must be a list of host names.");
    kit.outbound = data.outbound.map((h) => {
      const host = String(h).toLowerCase();
      if (!HOST.test(host)) throw new KitError(`${String(h)} isn't a host name.`);
      return host;
    });
  }
  if (data.limits !== undefined) {
    if (!isObject(data.limits)) throw new KitError("limits must map services to memory and cpus.");
    kit.limits = {};
    for (const [service, limit] of Object.entries(data.limits)) {
      if (!isObject(limit)) throw new KitError(`limits.${service} must have memory or cpus.`);
      const entry: { memory?: number; cpus?: number } = {};
      if (limit.memory !== undefined) entry.memory = parseMemory(limit.memory as string | number);
      if (limit.cpus !== undefined) {
        if (typeof limit.cpus !== "number" || limit.cpus <= 0 || limit.cpus > 64) throw new KitError(`limits.${service}.cpus must be a positive number.`);
        entry.cpus = limit.cpus;
      }
      kit.limits[service] = entry;
    }
  }
  return kit;
}

export interface FoundKit {
  kit: Kit;
  /** The kit's link at its exact commit. */
  source: string;
}

/**
 * The kit for an app's file: the one the owner linked, or the kits repository's kit for the app's
 * repository. A kit for another file of the same repository doesn't apply.
 */
export async function findKit(
  repo: string,
  path: string,
  kitLink: string | undefined,
  endpoints: GithubEndpoints = githubEndpoints(),
  fetcher: typeof fetch = fetch,
): Promise<FoundKit | null> {
  const link = kitLink?.trim() || `https://github.com/${kitsRepo()}/blob/main/apps/${repo.toLowerCase()}.yaml`;
  let file;
  try {
    file = await fetchSource(link, endpoints, fetcher);
  } catch (error) {
    // No kit in the kits repository is normal; a link the owner gave must work.
    if (!kitLink && error instanceof SourceError) return null;
    throw error;
  }
  const kit = parseKit(file.text);
  if (kit.source.repo.toLowerCase() !== repo.toLowerCase() || kit.source.path !== path) {
    if (!kitLink) return null;
    throw new KitError(`it is for ${kit.source.repo}/${kit.source.path}, not ${repo}/${path}.`);
  }
  return { kit, source: file.pinnedLink };
}
