// Installation kits (component D, FR-002a, contracts/kit-format.md): an app's definition in Your
// Space, a file anywhere on GitHub, read as data, that names the app's Compose file at an exact
// commit. Every app installs from one (decision 2026-11-23). Your Space has no app-specific logic.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parse } from "yaml";
import { parseAgentAccess, AgentKitError } from "./agent-kit.ts";
import type { EnvSource, Kit } from "../db/schema.ts";
import { fetchLatestFile, fetchPinnedFile, fetchSource, githubEndpoints, MAX_FILE_BYTES, SourceError, type GithubEndpoints, type SourceFile } from "./github.ts";
import { TEMPLATE_REFERENCE, templateNames, templateOf } from "./settings.ts";

export class KitError extends Error {
  constructor(message: string) {
    super(`The installation kit can't be used: ${message}`);
    this.name = "KitError";
  }
}

/** What Your Space says when it is given a Compose file where a kit belongs. */
export const KIT_REQUIRED =
  "That's a Compose file, not a Your Space kit. Your Space installs an app from its kit: a small YAML file that names the app's Compose file and says what Your Space needs to run and show the app, such as its interface, its environment, the internet hosts it needs and its limits. Give the link to the app's kit instead.";

/** A Compose file given where a kit belongs. */
export class NotAKitError extends KitError {
  constructor() {
    super("");
    this.name = "NotAKitError";
    this.message = KIT_REQUIRED;
  }
}

const NAME = /^[a-z][a-z0-9-]{0,29}$/;
/** A GitHub `owner/repo`, as a link names it. */
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const TOP_KEYS = new Set(["kit", "source", "name", "title", "interface", "pane", "env", "outbound", "limits"]);
/** The fields kits named settings in before `env` (2026-11-23). */
const SETTINGS_FIELDS = new Set(["generate", "derive", "set", "secrets"]);
const SOURCE_KEYS = new Set(["repo", "path", "commit"]);
/** A full commit SHA, as GitHub gives it. */
const COMMIT = /^[0-9a-f]{40}$/;

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

/** One entry of a kit's `env`: a value, or where the value comes from. */
function envSource(name: string, entry: unknown): EnvSource {
  if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return String(entry);
  if (!isObject(entry)) throw new KitError(`env.${name} must be a value, or generate, derive or ask.`);
  const keys = Object.keys(entry);
  const from = keys.filter((key) => key === "generate" || key === "derive" || key === "ask");
  if (from.length !== 1) throw new KitError(`env.${name} must be a value, or exactly one of generate, derive or ask.`);
  for (const key of keys) {
    if (key !== from[0] && !(from[0] === "ask" && key === "secret")) throw new KitError(`env.${name} has the unknown field ${key}.`);
  }
  if ("generate" in entry) {
    const o = entry.generate === true || entry.generate === null ? {} : entry.generate;
    if (!isObject(o)) throw new KitError(`env.${name}.generate must be true or options.`);
    for (const key of Object.keys(o)) if (key !== "bytes" && key !== "encoding") throw new KitError(`env.${name}.generate has the unknown field ${key}.`);
    const bytes = o.bytes ?? 32;
    if (!Number.isInteger(bytes) || (bytes as number) < 16 || (bytes as number) > 128) throw new KitError(`env.${name}.generate.bytes must be 16 to 128.`);
    const encoding = o.encoding ?? "base64url";
    if (encoding !== "hex" && encoding !== "base64url") throw new KitError(`env.${name}.generate.encoding must be hex or base64url.`);
    return { generate: { bytes: bytes as number, encoding } };
  }
  if ("derive" in entry) {
    const value = entry.derive;
    if (value === "app_origin" || value === "app_host") return { derive: value };
    if (isObject(value) && Object.keys(value).length === 1 && typeof value.template === "string" && value.template.length <= 1000) {
      return { derive: { template: value.template } };
    }
    throw new KitError(`env.${name}.derive must be app_origin, app_host or { template: ... }.`);
  }
  if (entry.ask !== true && entry.ask !== "optional") throw new KitError(`env.${name}.ask must be true, or optional when the app runs without it.`);
  if (entry.secret !== undefined && typeof entry.secret !== "boolean") throw new KitError(`env.${name}.secret must be true or false.`);
  // What the owner types is shown only as set unless the kit says it isn't secret.
  return { ask: entry.ask, secret: entry.secret ?? true };
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
  if (data.kit === undefined && isObject(data.services)) throw new NotAKitError();
  for (const key of Object.keys(data)) {
    if (SETTINGS_FIELDS.has(key)) {
      throw new KitError(
        `it names settings in ${key}, which kits no longer have. A kit gives the app's whole environment in env: each variable with a value, or with where its value comes from (generate, derive or ask).`,
      );
    }
    if (!TOP_KEYS.has(key) && !(data.kit === 2 && key === "agentAccess")) throw new KitError(`it has the unknown field ${key}.`);
  }
  if (data.kit !== 1 && data.kit !== 2) throw new KitError("it is for a kit format this Your Space doesn't know (use kit: 1 or kit: 2).");
  // The source names the app's Compose file at an exact commit (contracts/kit-format.md). Only a kit
  // given with a Compose file on this machine (install-app --compose) may leave it out (composeOf).
  const source = data.source;
  if (source !== undefined) {
    if (!isObject(source) || typeof source.repo !== "string" || typeof source.path !== "string") {
      throw new KitError("its source must name the app's Compose file with source.repo, source.path and source.commit.");
    }
    for (const key of Object.keys(source)) if (!SOURCE_KEYS.has(key)) throw new KitError(`its source has the unknown field ${key}.`);
    // The path is read at that commit, so it can't step out of it with . or ..
    if (!REPOSITORY.test(source.repo) || source.repo.split("/").some((part) => part === "." || part === "..")) {
      throw new KitError("its source.repo must be a GitHub owner/repository.");
    }
    if (source.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new KitError("its source.path must be a file's path in the repository, with no empty, . or .. parts.");
    }
    if (source.commit === undefined) {
      throw new KitError(
        `its source has no commit. Add source.commit, the full 40-character commit of ${source.repo} to read ${source.path} at: Your Space reads the app's Compose file at exactly that commit, never at a branch's latest one.`,
      );
    }
    if (typeof source.commit !== "string" || !COMMIT.test(source.commit)) {
      throw new KitError("its source.commit must be a full 40-character commit in lower case, not a branch, a tag or a short commit.");
    }
  }
  const kit: Kit = {
    kit: data.kit,
    ...(source !== undefined ? { source: { repo: source.repo as string, path: source.path as string, commit: source.commit as string } } : {}),
  };
  if (data.kit === 2) {
    try {
      kit.agentAccess = parseAgentAccess(data.agentAccess);
    } catch (error) {
      if (error instanceof AgentKitError) throw new KitError(error.message);
      throw error;
    }
  }
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
  if (data.env !== undefined) {
    if (!isObject(data.env)) throw new KitError("env must map the app's variables to their values.");
    const env: Record<string, EnvSource> = {};
    for (const [name, entry] of Object.entries(data.env)) {
      if (!VARIABLE.test(name)) throw new KitError(`${name} isn't a variable name.`);
      env[name] = envSource(name, entry);
    }
    for (const [name, source] of Object.entries(env)) {
      const template = templateOf(source);
      if (template === undefined) continue;
      for (const ref of templateNames(template)) {
        if (!Object.hasOwn(env, ref)) throw new KitError(`env.${name} uses ${ref}, which the kit's env doesn't define.`);
        if (templateOf(env[ref]) !== undefined) throw new KitError(`env.${name} uses ${ref}, another template; a template can use only values.`);
      }
      if (template.replace(TEMPLATE_REFERENCE, "").includes("${")) throw new KitError(`env.${name} has a placeholder that isn't \${VARIABLE_NAME}.`);
    }
    kit.env = env;
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
  /** The kit's link at its exact commit, or `sha256:<hex>` for a kit file given on this machine. */
  source: string;
}

/** The repository, path and commit of a kit linked from GitHub, from its pinned link. */
export function kitIdentity(source: string): { source: string; repo?: string; path?: string; commit?: string } {
  const pin = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/blob\/([0-9a-f]{40})\/([^?#]+)$/.exec(source);
  if (!pin) return { source };
  let path: string;
  try {
    path = pin[3]!.split("/").map(decodeURIComponent).join("/");
  } catch {
    return { source };
  }
  return { source, repo: pin[1], path, commit: pin[2] };
}

export class KitFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KitFileError";
  }
}

/** The text of a kit file on this machine: `-` reads standard input, and anything else is the file. */
export function readLocalKit(kit: string, stdin: number | string = 0): string {
  try {
    if (kit === "-") return readFileSync(stdin, "utf8");
    if (statSync(kit).isDirectory()) throw new KitFileError(`${kit} is a folder. Give the kit file itself.`);
    if (statSync(kit).size > MAX_FILE_BYTES) throw new KitFileError(`The kit file ${kit} is larger than a kit should be.`);
    return readFileSync(kit, "utf8");
  } catch (error) {
    if (error instanceof KitFileError) throw error;
    throw new KitFileError(`The kit file ${kit} can't be read (${(error as NodeJS.ErrnoException).code ?? "error"}).`);
  }
}

/** Whether a kit names this file on GitHub as the one it fits. */
function fits(kit: Kit, repo: string, path: string): boolean {
  return kit.source !== undefined && kit.source.repo.toLowerCase() === repo.toLowerCase() && kit.source.path === path;
}

/** Why a kit doesn't fit an app's file on GitHub. */
function misfit(kit: Kit, repo: string, path: string): KitError {
  return new KitError(
    kit.source
      ? `it is for ${kit.source.repo}/${kit.source.path}, not ${repo}/${path}.`
      : "it names no Compose file in source, so it goes only with a Compose file given on this machine (install-app --compose).",
  );
}

/**
 * A kit file the owner gives on this machine, such as one from a private kits repository, which Your
 * Space can't read from GitHub. For an app's file on GitHub it must fit that file. For a Compose file
 * on this machine (`file` null), giving both in one command is what binds them, so its source isn't
 * matched and may be left out. The record keeps its digest, since a path on the machine identifies
 * nothing.
 */
export function kitFromFile(text: string, file: { repo: string; path: string } | null): FoundKit {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new KitError("the file is larger than a kit should be.");
  const kit = parseKit(text);
  if (file && !fits(kit, file.repo, file.path)) throw misfit(kit, file.repo, file.path);
  return { kit, source: `sha256:${createHash("sha256").update(text).digest("hex")}` };
}

/**
 * The Compose file a parsed kit names (contracts/kit-format.md): its `source`, at the exact commit the
 * kit pins. Nothing is read at a branch's latest commit. Only a kit given with a Compose file on this
 * machine leaves out `source`, so any other kit without it is refused.
 */
export function composeOf(kit: Kit): { repo: string; path: string; commit: string } {
  if (!kit.source) {
    throw new KitError(
      "it names no Compose file. Add source with the app's Compose file's repo, path and commit. Only a kit given with a Compose file on this machine (install-app --compose) leaves out source.",
    );
  }
  // parseKit refuses a source without its commit; only a kit stored before kits pinned one lacks it.
  return { repo: kit.source.repo, path: kit.source.path, commit: kit.source.commit! };
}

/** A review can follow unchanged kit bytes through an unrelated repository commit.
 * Fetch older bytes only from the already authorized repository and path. */
export async function matchesKitReview(
  record: unknown, digest: string, file: { repo: string; path: string; commit: string; text: string },
  readAt: (commit: string) => Promise<string>,
): Promise<boolean> {
  if (!isObject(record) || record.status !== "reviewed" || record.sha256 !== digest || typeof record.kit !== "string") return false;
  const pin = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/blob\/([0-9a-f]{40})\/([^?#]+)$/.exec(record.kit);
  if (!pin || pin[1].toLowerCase() !== file.repo.toLowerCase()) return false;
  let path: string;
  try {
    path = decodeURIComponent(pin[3]);
  } catch {
    return false;
  }
  if (path !== file.path) return false;
  const attested = pin[2];
  return attested === file.commit || await readAt(attested) === file.text;
}

/**
 * The kit at a GitHub link, read at the exact commit the link resolves to, with the directory's
 * review evidence for its agent access when the directory has a review of these exact bytes.
 */
export async function kitFromLink(
  link: string,
  directory: string | undefined,
  endpoints: GithubEndpoints = githubEndpoints(),
  fetcher: typeof fetch = fetch,
): Promise<FoundKit & { file: SourceFile }> {
  const file = await fetchSource(link, endpoints, fetcher);
  const kit = parseKit(file.text);
  if (kit.agentAccess && directory) {
    const digest = createHash("sha256").update(file.text).digest("hex");
    try {
      const review = await fetchLatestFile(directory, `reviews/sha256/${digest}.json`, endpoints, fetcher);
      const record: unknown = JSON.parse(review.text);
      if (await matchesKitReview(record, digest, file, async (commit) =>
        (await fetchPinnedFile(file.repo, file.path, commit, endpoints, fetcher)).text)) {
        kit.agentReview = { source: review.pinnedLink };
      }
    } catch (error) {
      // Missing, unreadable and malformed evidence all leave the kit unreviewed.
      if (!(error instanceof SourceError || error instanceof SyntaxError)) throw error;
    }
  }
  return { kit, source: file.pinnedLink, file };
}
