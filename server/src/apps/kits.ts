// Installation kits (component D, FR-002a, contracts/kit-format.md): an app's definition in Your
// Space, kept in a separate repository and read as data. Every app installs from one (decision
// 2026-11-23). Your Space has no app-specific logic.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { parse } from "yaml";
import { parseAgentAccess, AgentKitError } from "./agent-kit.ts";
import type { Kit } from "../db/schema.ts";
import { fetchLatestFile, fetchPinnedFile, fetchSource, githubEndpoints, MAX_FILE_BYTES, SourceError, type GithubEndpoints, type SourceFile } from "./github.ts";
import { TEMPLATE_REFERENCE, templateNames } from "./settings.ts";

export class KitError extends Error {
  constructor(message: string) {
    super(`The installation kit can't be used: ${message}`);
    this.name = "KitError";
  }
}

/** What Your Space says when it is given a Compose file where a kit belongs. */
export const KIT_REQUIRED =
  "That's a Compose file, not a Your Space kit. Your Space installs an app from its kit: a small YAML file that names the app's Compose file and says what Your Space needs to run and show the app, such as its interface, the settings to generate, the internet hosts it needs and its limits. Give the link to the app's kit instead.";

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
  if (data.kit === undefined && isObject(data.services)) throw new NotAKitError();
  for (const key of Object.keys(data)) if (!TOP_KEYS.has(key) && !(data.kit === 2 && key === "agentAccess")) throw new KitError(`it has the unknown field ${key}.`);
  if (data.kit !== 1 && data.kit !== 2) throw new KitError("it is for a kit format this Your Space doesn't know (use kit: 1 or kit: 2).");
  // A kit for a Compose file given on this machine (install-app --compose) may leave out source, and
  // a kit linked from GitHub without it names the compose.yaml beside it (composeOf).
  const source = data.source;
  if (source !== undefined && (!isObject(source) || typeof source.repo !== "string" || typeof source.path !== "string")) {
    throw new KitError("it must name the source repo and path it fits.");
  }
  // The path is read at the commit Your Space records, so it can't step out of it with . or ..
  if (source !== undefined && (!REPOSITORY.test(source.repo as string) || (source.repo as string).split("/").some((part) => part === "." || part === ".."))) {
    throw new KitError("its source repo must be a GitHub owner/repository.");
  }
  if (source !== undefined && (source.path as string).split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new KitError("its source path must be a file's path in the repository, with no empty, . or .. parts.");
  }
  const kit: Kit = { kit: data.kit, ...(source !== undefined ? { source: { repo: source.repo as string, path: source.path as string } } : {}) };
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
      : "it names no source file, so it is for a Compose file given on this machine with install-app --compose.",
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
 * The Compose file a kit names (contracts/kit-format.md): its `source`, read at the kit's own commit
 * when it is in the kit's repository, or at the head of its repository's default branch (commit
 * null). A kit linked from GitHub without `source` names the compose.yaml beside it. A kit file given
 * on this machine (`at` null) names no file without `source`.
 */
export function composeOf(kit: Kit, at: { repo: string; path: string; commit: string } | null): { repo: string; path: string; commit: string | null } | null {
  if (kit.source) {
    const same = at !== null && kit.source.repo.toLowerCase() === at.repo.toLowerCase();
    return { repo: kit.source.repo, path: kit.source.path, commit: same ? at.commit : null };
  }
  if (!at) return null;
  return { repo: at.repo, path: posix.join(posix.dirname(at.path), "compose.yaml"), commit: at.commit };
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
