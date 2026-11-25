// Installing and managing apps (components A, F, G, H, N, O, P). The server keeps each app's record,
// settings and approvals; the runtime manager runs it. Secret values leave the server only in the
// app spec sent to the runtime manager.
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { recordEvent } from "../actors.ts";
import type { Db } from "../db/client.ts";
import {
  app,
  appAccessRequest,
  appKnowledgeBase,
  appOutbound,
  appSetting,
  installJob,
  knowledgeBase,
  type AppState,
  type EventType,
  type JobStep,
  type Kit,
  type Publish,
} from "../db/schema.ts";
import { errorFields, log } from "../log.ts";
import {
  fetchPinnedFile,
  fetchPinnedFileWith,
  fetchSourceWith,
  githubEndpoints,
  githubRegistry,
  SourceError,
  TokenRefusedError,
  type FileRead,
  type GithubEndpoints,
  type SourceCredential,
  type SourceFile,
  type SourceMiss,
} from "./github.ts";
import { composeOf, kitFromFile, kitFromLink, kitFromSource, KitError, kitIdentity, NotAKitError, type FoundKit } from "./kits.ts";
import { localSource, type LocalCompose } from "./local.ts";
import { RuntimeError, type AppSpec, type CheckAnswer, type RegistryCredential, type Runtime, type ServiceState } from "./runtime-client.ts";
import {
  buildSettings,
  decrypt,
  encrypt,
  isAsked,
  isDerived,
  kitEnv,
  publicSetting,
  resolveTemplates,
  templateOf,
  undefinedVariables,
  withFileDefaults,
  type Setting,
} from "./settings.ts";

export const DEFAULT_MEMORY = 1024 * 1024 * 1024;
export const DEFAULT_CPUS = 1;
const PREVIEW_LIFETIME_MS = 30 * 60_000;
/** A host name an app may be allowed to reach; the kit parser and approvals use the same rule. */
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** Waiting access requests kept per app, so an app can't flood the owner's list. */
const MAX_PENDING_REQUESTS = 50;
const RESERVED_NAMES = new Set(["www", "api", "app", "apps", "space", "admin", "static", "assets", "mail"]);
/** A published port listens only on this machine unless the owner chooses another address. */
export const DEFAULT_BIND = "127.0.0.1";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The workspace's source credential (journey 015), the GitHub connection: what reads a kit, or the
 * Compose file a kit pins, that GitHub doesn't show anonymously. It is asked for only after an
 * anonymous read found nothing (R1).
 */
export interface SourceCredentials {
  reading(): Promise<
    | { state: "none" }
    /** Stored, but no data key here can read it (decision 3). */
    | { state: "unreadable"; login: string }
    | {
        state: "ready";
        credential: SourceCredential;
        /** GitHub accepted it for a read. */
        worked(): Promise<void>;
        /** GitHub refused it: it expired, or was deleted or revoked (decision 5). */
        refused(): Promise<void>;
      }
  >;
}

/**
 * The workspace's registry credential (journey 015, R9), the GitHub connection's image token: what
 * signs the engine in to `registry`, GHCR, to look up and pull an image it won't give anonymously. It
 * is asked for only after a check found such an image.
 */
export interface RegistryCredentials {
  /** The registry the credential signs in to: `ghcr.io`, or a stand-in for it in the browser tests. */
  readonly registry: string;
  signingIn(): Promise<
    | { state: "none" }
    /** Stored, but no data key here can read it (decision 3). */
    | { state: "unreadable"; login: string }
    | {
        state: "ready";
        login: string;
        credential: Omit<RegistryCredential, "images">;
        /** The registry gave an image with it. */
        worked(): Promise<void>;
      }
  >;
}

export interface AppsConfig {
  /** Your Space's own address, e.g. http://space.localhost. */
  publicUrl: string;
  /** Encrypts apps' settings (spec 009). */
  dataKey: string;
  github?: GithubEndpoints;
  fetch?: typeof fetch;
  /** Left out where nothing is connected, as in tests that don't need it. */
  credentials?: SourceCredentials;
  /** The image token; left out where nothing is connected, as in tests that don't need it. */
  registries?: RegistryCredentials;
}

/** The API's error code for each way GitHub gave no file. */
const MISS_CODE: Record<SourceMiss, string> = { not_found: "not_found", not_visible: "repository_not_visible", no_ref: "not_found", no_file: "file_missing" };
/** What the owner does about a connection that can't read a private file; the page and the command each say where. */
const RECONNECT = "Create a new token and connect GitHub again, then try again.";
/** Where the owner adds the image token: the GitHub page, or the server command. */
const ADD_IMAGE_TOKEN = "on Your Space's GitHub page, or with docker compose exec server github image-token";

interface Preview {
  id: string;
  expiresAt: number;
  source: SourceFile;
  kit: Kit;
  kitSource: string;
  /** How the kit was read from GitHub; null for a kit file given on this machine. */
  kitRead: FileRead | null;
  name: string;
  title: string;
  check: CheckAnswer;
  settings: Setting[];
  outbound: string[];
  limits: Record<string, { memory: number; cpus: number }>;
  interface: { service: string; port: number } | null;
  /** The port publishing uses unless the owner chooses another. */
  publishPort: number | null;
  pane: boolean;
  retained: boolean;
  /** Where the app's knowledge bases are mounted, when its kit asks for knowledge (journey 014). */
  knowledge: { path: string } | null;
}

export type AppRow = typeof app.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** `sure.space.localhost` for Your Space at `space.localhost`, with the same scheme and port. */
export function appAddress(publicUrl: string, name: string): { origin: string; host: string } {
  const url = new URL(publicUrl);
  const host = `${name}.${url.hostname}`;
  return { host, origin: `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}` };
}

/**
 * Where a person reaches an app: the owner's link when it is published with one (decision
 * 2026-11-19), else its built-in address.
 */
export function appOrigin(publicUrl: string, row: { name: string; publish: Publish | null }): string {
  return row.publish?.link ?? appAddress(publicUrl, row.name).origin;
}

/**
 * Whether a request's host is under Your Space's name, where the apps' addresses are, whether or not
 * an app is at it. Your Space's own name isn't under it.
 */
export function underOwnName(publicUrl: string, hostHeader: string | undefined): boolean {
  const host = (hostHeader ?? "").toLowerCase().replace(/:\d+$/, "");
  return host.endsWith(`.${new URL(publicUrl).hostname}`);
}

/** The app named by a request's host, or undefined when the host isn't an app's. */
export function appNameFromHost(publicUrl: string, hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, "");
  const suffix = `.${new URL(publicUrl).hostname}`;
  if (!host.endsWith(suffix)) return undefined;
  const name = host.slice(0, -suffix.length);
  return /^[a-z][a-z0-9-]{0,29}$/.test(name) ? name : undefined;
}

/** The address settings of an app reached at the owner's link, in appAddress's form. */
export function linkAddress(link: string): { origin: string; host: string } {
  const url = new URL(link);
  return { origin: url.origin, host: url.hostname };
}

const LINK_MESSAGE = "The link must be the address you reach the app at, like https://plane.example.com, with no path.";

/** A link as an origin: http or https, with nothing after the host and port. */
export function linkOrigin(link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new AppError(400, "bad_link", LINK_MESSAGE);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new AppError(400, "bad_link", LINK_MESSAGE);
  }
  return url.origin;
}

/**
 * The port the app's own file publishes for its interface, or else the interface's own port. Your
 * Space never looks for a free port: the owner chooses another when this one is taken.
 */
export function defaultPort(services: CheckAnswer["services"], iface: { service: string; port: number } | null): number | null {
  if (!iface) return null;
  const service = services.find((s) => s.name === iface.service);
  return service?.published?.find((p) => p.target === iface.port)?.host ?? iface.port;
}

/**
 * Publishing as the API takes it: where the app is published. Your Space shows a published app inside
 * its pane wherever it can (inPane); the owner's switch for it left with the alpha scope (decision
 * 2026-11-23), and the app's stored `frame` is no longer read.
 */
export type PublishChoices = Publish;

/**
 * Browsers show no plain-HTTP page inside an HTTPS one, apart from one on this machine, so a link like
 * that can't be framed by an HTTPS Your Space.
 */
export function plainInHttps(publicUrl: string, link: string): boolean {
  const { protocol, hostname } = new URL(link);
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127\./.test(hostname);
  return new URL(publicUrl).protocol === "https:" && protocol === "http:" && !local;
}

/**
 * Whether Your Space shows the app at its link in its pane: the app has a link, its kit lets it run in
 * a pane, and Your Space's page can frame the link. The one rule for both the app's Caddy, which lets
 * only Your Space frame it then, and the pane.
 */
export function inPane(publicUrl: string, row: { publish: Publish | null; pane: boolean }): boolean {
  const link = row.publish?.link ?? null;
  return row.pane && link !== null && !plainInHttps(publicUrl, link);
}

/**
 * The app's publishing, as the API shows it, or null when it isn't published: the owner's choices,
 * and whether Your Space shows the app at its link in its pane.
 */
export function publishOf(publicUrl: string, row: { publish: Publish | null; pane: boolean }): (PublishChoices & { inPane: boolean }) | null {
  return row.publish ? { ...row.publish, inPane: inPane(publicUrl, row) } : null;
}

/** The owner's choices for publishing, checked, over the current or default ones. */
export function publishFrom(input: unknown, current: PublishChoices): PublishChoices {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppError(400, "bad_publish", "Send the port, the address to listen on and the link, or null to stop publishing.");
  }
  const { port, bind, link } = input as { port?: unknown; bind?: unknown; link?: unknown };
  const next = { ...current };
  if (port !== undefined) {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new AppError(400, "bad_port", "The port must be a whole number from 1 to 65535.");
    }
    next.port = port;
  }
  if (bind !== undefined) {
    if (typeof bind !== "string" || !isIP(bind.trim())) {
      throw new AppError(400, "bad_bind", "The address to listen on must be an IP address of this machine, like 127.0.0.1, or 0.0.0.0 for all of them.");
    }
    next.bind = bind.trim();
  }
  if (link !== undefined) {
    if (link !== null && typeof link !== "string") throw new AppError(400, "bad_link", LINK_MESSAGE);
    next.link = link === null || link.trim() === "" ? null : linkOrigin(link);
  }
  return next;
}

/** Two listening addresses share a port when they are the same, or either is every address. */
function overlaps(a: string, b: string): boolean {
  const every = (ip: string) => ip === "0.0.0.0" || ip === "::";
  return a === b || every(a) || every(b);
}

function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 30).replace(/-+$/, "");
  return s || "app";
}

function now(): string {
  return new Date().toISOString();
}

/** An app's state from what the runtime reports for its services. */
export function stateFromServices(services: ServiceState[]): { state: AppState; reason: string | null } {
  // A service that runs once, such as a migration, and finished takes no part in the app's state.
  const app = services.filter((s) => s.role === "app" && !s.completed);
  // Your Space's Caddy for a published app.
  const proxy = services.find((s) => s.role === "publish");
  if (app.length === 0) return { state: "stopped", reason: "Not running." };
  const problems: string[] = [];
  let starting = false;
  for (const s of app) {
    if (s.state === "running" && (s.health === undefined || s.health === "healthy")) continue;
    if (s.state === "running" && s.health === "starting") {
      starting = true;
      continue;
    }
    if (s.state === "created") {
      starting = true;
      continue;
    }
    if (s.oomKilled) problems.push(`${s.name} stopped: it ran out of memory`);
    else if (s.state === "running" && s.health === "unhealthy") problems.push(`${s.name} is unhealthy`);
    else if (s.state === "restarting") problems.push(`${s.name} keeps restarting`);
    else if (s.state === "exited" && s.exitCode === 0) continue;
    else problems.push(`${s.name} stopped${s.exitCode !== undefined ? ` (exit code ${s.exitCode})` : ""}`);
  }
  if (problems.length === app.length) {
    return { state: app.every((s) => s.state === "exited" && !s.oomKilled && s.exitCode !== undefined && [0, 137, 143].includes(s.exitCode)) ? "stopped" : "degraded", reason: `${problems.join("; ")}.` };
  }
  if (problems.length > 0) return { state: "degraded", reason: `${problems.join("; ")}.` };
  // The app runs, but its published port isn't open, for example because something else took it.
  if (proxy && proxy.state !== "running" && app.some((s) => s.state === "running")) {
    return { state: "degraded", reason: "Its published port isn't open. Choose another port if something else uses it." };
  }
  return starting ? { state: "starting", reason: null } : { state: "running", reason: null };
}

/**
 * Why an image its registry won't give without a sign-in can't be installed, and what to do (journey
 * 015, decision 7): GHCR with no image token, with one no key here can read, or with one that can't
 * read the image; and another registry, from which Your Space pulls public images only (decision 4).
 * GHCR answers alike for a private image and one that doesn't exist.
 */
function signInReason(image: CheckAnswer["images"][number], registry: string, token: Awaited<ReturnType<RegistryCredentials["signingIn"]>>): string {
  if (image.registry !== registry) {
    return `${image.registry} doesn't show ${image.ref} without signing in: it is private, or it doesn't exist. Your Space pulls private images only from GitHub's container registry, ghcr.io, with an image token; from other registries it pulls public images only.`;
  }
  const hidden = `GitHub's container registry doesn't show ${image.ref} without signing in: it is private, or it doesn't exist.`;
  if (image.signIn === "refused" && token.state === "ready") {
    return `Your image token (@${token.login}) can't read ${image.ref}, or it doesn't exist. Check that @${token.login} can see the package, that GitHub still accepts the token, and that an organization with SAML single sign-on has authorized it. To use another token, replace the image token ${ADD_IMAGE_TOKEN}.`;
  }
  if (token.state === "unreadable") {
    return `${hidden} Your image token (@${token.login}) can't be used: no data key here can read it, as when the data key was replaced without the one before it. Add the image token again ${ADD_IMAGE_TOKEN}.`;
  }
  return `${hidden} If it's private, add an image token, a classic token with only read:packages, ${ADD_IMAGE_TOKEN}, then review the kit again.`;
}

export class AppsService {
  readonly db: Db;
  readonly runtime: Runtime;
  readonly config: AppsConfig;
  private readonly previews = new Map<string, Preview>();
  private readonly busy = new Set<string>();
  /** Apps whose outdated Caddy this server process has renewed, or tried to: once each. */
  private readonly renewed = new Set<string>();

  constructor(db: Db, runtime: Runtime, config: AppsConfig) {
    this.db = db;
    this.runtime = runtime;
    this.config = config;
  }

  /** The app's built-in address, under Your Space's own; the gate and the handoff work there. */
  address(name: string) {
    return appAddress(this.config.publicUrl, name);
  }

  /** Values of the settings the kit derives from the app's address, when the owner gave a link. */
  private linkValues(row: Pick<AppRow, "kit" | "publish">): Map<string, string> {
    const values = new Map<string, string>();
    if (!row.publish?.link) return values;
    const address = linkAddress(row.publish.link);
    for (const [name, source] of Object.entries(kitEnv(row.kit))) {
      if (typeof source !== "object" || !("derive" in source)) continue;
      if (source.derive === "app_origin") values.set(name, address.origin);
      if (source.derive === "app_host") values.set(name, address.host);
    }
    return values;
  }

  /**
   * Refuses, before the owner's choice is saved, a port another published app uses or that anything
   * else on this machine uses. Something that takes the port after that shows when the app starts.
   */
  private async refuseTakenPort(publish: Publish, name: string): Promise<void> {
    const rows = await this.db.select({ name: app.name, title: app.title, publish: app.publish }).from(app).where(ne(app.state, "removed"));
    const other = rows.find((r) => r.name !== name && r.publish && r.publish.port === publish.port && overlaps(r.publish.bind, publish.bind));
    if (other) {
      throw new AppError(
        409,
        "port_in_use",
        `Port ${publish.port} on ${publish.bind} is already used by ${other.title}, which Your Space publishes on ${other.publish!.bind}:${other.publish!.port}. Choose another port.`,
      );
    }
    let answer: { inUse: boolean; by?: string };
    try {
      answer = await this.runtime.checkPort(`ys-${name}`, { port: publish.port, bind: publish.bind });
    } catch (error) {
      if (!(error instanceof RuntimeError)) throw error;
      // The check couldn't run, for example because Your Space's Caddy isn't running. Saving goes
      // ahead, and the start names the port if it is taken.
      log("warn", "app.port_check_failed", { app: name, ...errorFields(error) });
      return;
    }
    if (answer.inUse) {
      throw new AppError(409, "port_in_use", `Port ${publish.port} on ${publish.bind} is already used by ${answer.by ?? "another program on this machine"}. Choose another port.`);
    }
  }

  // ----- Preview and install (FR-011) -----

  /**
   * Reviews an app from its kit (decision 2026-11-23): the kit's GitHub link, read at the commit the
   * link resolves to now, or a kit file's text given on this machine. The kit names the app's Compose
   * file on GitHub at an exact commit (composeOf), and the review reads it there. With a Compose file
   * given on this machine, the kit is a file given with it, nothing is read from GitHub, and the app
   * takes its kit's name. No command gives one since the alpha scope (2026-11-23); it stands for an
   * app installed that way before, which keeps running from its stored file.
   */
  async preview(kit: { link: string } | { text: string }, compose?: LocalCompose): Promise<ReturnType<AppsService["reviewOf"]>> {
    const github = this.config.github ?? githubEndpoints();
    const fetcher = this.config.fetch ?? fetch;
    let source: SourceFile;
    let found: FoundKit & { file?: SourceFile };
    try {
      if (compose) {
        if (!("text" in kit)) throw new KitError("give the kit as a file on this machine with a Compose file on this machine.");
        source = localSource(compose);
        found = kitFromFile(kit.text, null);
      } else {
        found = "link" in kit ? await this.kitAt(kit.link, github, fetcher) : kitFromFile(kit.text, null);
        source = await this.composeAt(found.kit, github, fetcher);
      }
    } catch (error) {
      if (error instanceof NotAKitError) throw new AppError(400, "kit_required", error.message);
      if (error instanceof SourceError && error.miss) throw new AppError(404, MISS_CODE[error.miss], error.message);
      if (error instanceof SourceError || error instanceof KitError) throw new AppError(400, "source", error.message);
      throw error;
    }
    return this.previewResolved(source, found);
  }

  /**
   * The kit at its link (journey 015, R1): read from public GitHub first, and through the GitHub
   * connection only when GitHub shows no such repository without it, as for a private one. A
   * public kit never touches the connection, so a connection GitHub refuses, or that no data key here
   * can read, never stops it.
   */
  private async kitAt(link: string, github: GithubEndpoints, fetcher: typeof fetch): Promise<FoundKit & { file: SourceFile }> {
    try {
      return await kitFromLink(link, github, fetcher);
    } catch (error) {
      if (!(error instanceof SourceError && error.miss === "not_found")) throw error;
      return kitFromSource(await this.throughConnection(error, "kit", (credential) => fetchSourceWith(credential, link, github, fetcher)));
    }
  }

  /**
   * The Compose file a kit pins, at its exact commit, read the same way as the kit (journey 015): from
   * public GitHub first, and through the GitHub connection only when GitHub shows no such repository
   * without it. It may be in the kit's repository or another one, and a public Compose file never
   * touches the connection, whether the kit was read through it or given on this machine.
   */
  private async composeAt(kit: Kit, github: GithubEndpoints, fetcher: typeof fetch): Promise<SourceFile> {
    const file = composeOf(kit);
    try {
      return await fetchPinnedFile(file.repo, file.path, file.commit, github, fetcher);
    } catch (error) {
      if (!(error instanceof SourceError && error.miss === "not_found")) throw error;
      return this.throughConnection(error, "compose", (credential) => fetchPinnedFileWith(credential, file.repo, file.path, file.commit, github, fetcher));
    }
  }

  /**
   * A file public GitHub doesn't show (`miss`), read again with the connection's token, or the
   * problem that stops it: nothing connected, a token no data key here reads, or one GitHub no longer
   * accepts, which is marked so the GitHub page shows Reconnect (decision 5). Each error's details
   * say which file it was, the kit or its Compose file.
   */
  private async throughConnection(miss: SourceError, file: "kit" | "compose", read: (credential: SourceCredential) => Promise<SourceFile>): Promise<SourceFile> {
    const reading = (await this.config.credentials?.reading()) ?? { state: "none" as const };
    if (reading.state === "none") {
      throw new AppError(404, "not_connected", `${miss.message} If the repository is private, connect GitHub with a token that can read it, then try again.`, { file });
    }
    if (reading.state === "unreadable") {
      throw new AppError(
        409,
        "token_unreadable",
        `${miss.message} Your GitHub connection (@${reading.login}) can't read it: no data key here can read its token, as when the data key was replaced without the one before it. ${RECONNECT}`,
        { file },
      );
    }
    let found: SourceFile;
    try {
      found = await read(reading.credential);
    } catch (failure) {
      if (!(failure instanceof TokenRefusedError)) throw failure;
      await reading.refused();
      throw new AppError(
        409,
        "token_refused",
        `GitHub no longer accepts your GitHub connection's token (@${reading.credential.login}): it expired, or it was deleted or revoked. ${RECONNECT}`,
        { file },
      );
    }
    await reading.worked();
    return found;
  }

  /** The review of a kit and the Compose file it names, both already read. HTTP callers never
   * supply trusted source, commit, or review metadata. */
  async previewResolved(source: SourceFile, found: FoundKit & { file?: SourceFile }): Promise<ReturnType<AppsService["reviewOf"]>> {
    for (const [id, p] of this.previews) if (p.expiresAt < Date.now()) this.previews.delete(id);
    const kit = found.kit;
    const name = source.repo ? (kit.name ?? slug(source.repo.split("/")[1]!)) : kit.name;
    if (!name) throw new AppError(400, "name_required", "Give a kit that names the app.");
    if (!/^[a-z][a-z0-9-]{0,29}$/.test(name)) throw new AppError(400, "bad_name", "An app's name is 1 to 30 lower-case letters, digits and dashes, starting with a letter.");
    if (RESERVED_NAMES.has(name)) throw new AppError(400, "name_reserved", `The name ${name} is reserved by Your Space.`);
    const existing = (await this.db.select().from(app).where(eq(app.name, name)))[0];
    if (existing && existing.state !== "removed") {
      throw new AppError(409, "already_installed", `An app called ${name} is already installed. Remove it first to install it again.`);
    }
    // A Compose file on this machine has no repository, so data kept under its name can be reused,
    // in either direction, when the owner chooses to (--reuse-data).
    if (existing && existing.repo && source.repo && existing.repo.toLowerCase() !== source.repo.toLowerCase()) {
      throw new AppError(409, "name_taken", `Data kept from another app called ${name} uses this name. Delete that data first.`);
    }
    const previous = existing ? await this.storedValues(existing.id) : new Map<string, string | null>();
    const address = this.address(name);

    // The app's settings are exactly its kit's env (decision 2026-11-23), and the file is checked with
    // them. A setting the file requires that has no value yet gets a placeholder, so the review shows
    // the file and the owner fills the setting in; installing needs a real value (install).
    const settings = buildSettings(kit, address, previous);
    // The knowledge path goes with the check, so a file that mounts something of its own there is refused.
    const knowledge = kit.knowledge ? { path: kit.knowledge.path, bases: [] } : null;
    let check = await this.checkSigningIn({ project: `ys-${name}`, app: name, compose: source.text, env: this.envOf(settings), interface: kit.interface ?? null, placeholders: true, knowledge });
    withFileDefaults(settings, check.variables);
    // A variable the file needs, with no default, is one the kit must define.
    const env = kitEnv(kit);
    const missing = undefinedVariables(check.variables, env);
    // Data kept from a removed app was written with its settings then. A value kept for a variable the
    // file uses that the kit no longer defines would give way to the file's default, so it is refused.
    const dropped = [...previous]
      .filter(([variable, value]) => value !== null && !Object.hasOwn(env, variable) && check.variables.some((v) => v.name === variable))
      .map(([variable]) => variable)
      .sort();
    if (missing.length || dropped.length) {
      const refusals = [
        ...missing.map((variable) => ({ service: "", setting: "env", reason: `The kit doesn't define ${variable}, which the Compose file needs. Add it to the kit's env.` })),
        ...dropped.map((variable) => ({
          service: "",
          setting: "env",
          reason: `Data kept from ${name} was written with a value for ${variable}, which the kit doesn't define. Add it to the kit's env, or delete the kept data.`,
        })),
      ];
      check = { ...check, ok: false, refusals: [...check.refusals, ...refusals] };
    }

    const limits: Record<string, { memory: number; cpus: number }> = {};
    for (const service of check.services) {
      const fromKit = kit.limits?.[service.name];
      limits[service.name] = { memory: fromKit?.memory ?? DEFAULT_MEMORY, cpus: fromKit?.cpus ?? DEFAULT_CPUS };
    }
    const preview: Preview = {
      id: randomUUID(),
      expiresAt: Date.now() + PREVIEW_LIFETIME_MS,
      source,
      kit,
      kitSource: found.source,
      kitRead: found.file?.read ?? null,
      name,
      title: kit.title ?? (source.repo ? source.repo.split("/")[1]! : name),
      check,
      settings,
      outbound: kit.outbound ?? [],
      limits,
      interface: kit.interface ?? null,
      publishPort: defaultPort(check.services, kit.interface ?? null),
      pane: kit.pane ?? true,
      retained: Boolean(existing),
      knowledge: kit.knowledge ?? null,
    };
    this.previews.set(preview.id, preview);
    return this.reviewOf(preview);
  }

  private async check(spec: AppSpec): Promise<CheckAnswer> {
    try {
      return await this.runtime.check(spec);
    } catch (error) {
      if (error instanceof RuntimeError) throw new AppError(error.status === 400 ? 400 : 503, error.code, error.message);
      throw error;
    }
  }

  /**
   * Checks the app's file, signing in to GHCR for its private images (journey 015, R9). The first
   * check is anonymous. Only when GHCR won't give an image without a sign-in is the image token read,
   * and the file checked again with it, for those images alone, so a public image never touches the
   * token, and a token no key can read, or GitHub refuses, never stops a public install. Each image
   * a registry won't give is refused with what to do about it.
   */
  private async checkSigningIn(spec: AppSpec): Promise<CheckAnswer> {
    let check = await this.check(spec);
    const registry = this.config.registries?.registry ?? githubRegistry();
    const denied = check.images.filter((i) => i.signIn === "needed" && i.registry === registry).map((i) => i.ref);
    let token: Awaited<ReturnType<RegistryCredentials["signingIn"]>> = { state: "none" };
    if (denied.length) {
      token = (await this.config.registries?.signingIn()) ?? { state: "none" };
      if (token.state === "ready") {
        check = await this.check({ ...spec, registryCredentials: [{ ...token.credential, images: denied }] });
        if (check.images.some((i) => i.private)) await token.worked();
        // An image GHCR didn't show anonymously stays private when the engine answered the signed-in
        // lookup with its own copy, as when GHCR couldn't answer, so the install still signs in for it.
        check = { ...check, images: check.images.map((i) => (denied.includes(i.ref) && i.digest ? { ...i, private: true as const } : i)) };
      }
    }
    const refusals = check.images.filter((i) => i.signIn).map((i) => ({ service: "", setting: "image", reason: signInReason(i, registry, token) }));
    return refusals.length ? { ...check, ok: false, refusals: [...check.refusals, ...refusals] } : check;
  }

  private reviewOf(p: Preview) {
    const kit = kitIdentity(p.kitSource);
    return {
      previewId: p.id,
      name: p.name,
      title: p.title,
      origin: this.address(p.name).origin,
      // How each file was read: a Private label in the review for one read through the connection (decision 7).
      source: { link: p.source.link, repo: p.source.repo, path: p.source.path, ref: p.source.ref, commit: p.source.commit, pinnedLink: p.source.pinnedLink, read: p.source.read ?? null },
      kit: { ...kit, read: p.kitRead },
      // A Compose file read through the connection from a repository other than the kit's, which a kit
      // file given on this machine doesn't have, gets its own line in the review (decision 7).
      readsRepository:
        p.source.read?.read === "connection" && p.source.repo.toLowerCase() !== kit.repo?.toLowerCase() ? p.source.repo : null,
      ok: p.check.ok,
      services: p.check.services,
      // A Private image label on each image pulled with the image token (decision 7).
      images: p.check.images.map((i) => ({ ref: i.ref, digest: i.digest, runsHere: i.runsHere, private: i.private === true })),
      adaptations: p.check.adaptations,
      refusals: p.check.refusals,
      settings: p.settings.map(publicSetting),
      outbound: p.outbound,
      interface: p.interface,
      publishPort: p.publishPort,
      pane: p.pane,
      retained: p.retained,
      knowledge: p.knowledge,
      warning:
        "Installing an app trusts it with everything you put into it. Your Space keeps it away from your other apps, Your Space's own data and this machine, and lets it reach only the internet hosts you approve.",
    };
  }

  async install(
    previewId: string,
    values: Record<string, string>,
    reuseData: boolean,
    actorId: string,
    publishWith: unknown = null,
    knowledgeWith: unknown = [],
  ): Promise<{ name: string; jobId: string; done: Promise<void> }> {
    const p = this.previews.get(previewId);
    if (!p || p.expiresAt < Date.now()) throw new AppError(404, "preview_expired", "This review has expired. Paste the kit's link again.");
    const review = this.reviewOf(p);
    if (!review.ok) throw new AppError(400, "refused", "Your Space can't run this app as it is.", review.refusals);
    if (p.retained && !reuseData) {
      throw new AppError(409, "retained_data", `Data kept from ${p.name} exists. Reuse it, or delete it first.`);
    }
    // The review gave each required setting without a value a placeholder (previewResolved).
    const placeheld = p.settings.some((s) => s.required && !s.value);
    const settings = p.settings.map((s) => ({ ...s }));
    for (const [name, value] of Object.entries(values ?? {})) {
      const setting = settings.find((s) => s.name === name);
      if (!setting || setting.derived) throw new AppError(400, "unknown_setting", `${name} isn't a setting of this app.`);
      setting.value = value === "" ? null : value;
      setting.generated = false;
    }
    // Template settings follow the values the owner just gave.
    const filled = resolveTemplates(kitEnv(p.kit), new Map(settings.map((s) => [s.name, s.value])));
    for (const setting of settings) setting.value = filled.get(setting.name) ?? null;
    const missing = settings.filter((s) => s.required && !s.value).map((s) => s.name);
    if (missing.length) throw new AppError(400, "settings_required", `These settings need a value: ${missing.join(", ")}.`);
    // Then the file is checked again with the owner's values, so its images and changes are the real ones.
    let check = p.check;
    if (placeheld) {
      check = await this.checkSigningIn({
        project: `ys-${p.name}`,
        app: p.name,
        compose: p.source.text,
        env: this.envOf(settings),
        interface: p.kit.interface ?? null,
        knowledge: p.knowledge && { path: p.knowledge.path, bases: [] },
      });
      if (!check.ok) {
        const reasons = check.refusals.map((r) => `${r.service ? `${r.service}: ` : ""}${r.reason}`).join(" ");
        throw new AppError(400, "refused", `Your Space can't run this app with these settings: ${reasons}`, check.refusals);
      }
    }

    // An image pulled with the image token is recorded as private, so the install signs in for it alone.
    const images = Object.fromEntries(check.images.filter((i) => i.digest).map((i) => [i.ref, { digest: i.digest!, ...(i.private ? { private: true as const } : {}) }]));
    let publish: PublishChoices | null = null;
    if (publishWith !== null && publishWith !== undefined) {
      if (!p.interface || p.publishPort === null) throw new AppError(400, "no_interface", `${p.title} has no interface to publish.`);
      publish = publishFrom(publishWith, { port: p.publishPort, bind: DEFAULT_BIND, link: null });
      await this.refuseTakenPort(publish, p.name);
    }
    const bases = await this.knowledgeBases(p.kit, p.title, knowledgeWith);

    this.previews.delete(previewId);
    const appId = await this.db.transaction(async (tx) => {
      const values = {
        title: p.title,
        sourceUrl: p.source.link,
        repo: p.source.repo,
        path: p.source.path,
        ref: p.source.ref,
        commit: p.source.commit,
        compose: p.source.text,
        kit: p.kit,
        kitSource: p.kitSource,
        provenance: { kit: p.kitRead, compose: p.source.read ?? null },
        images,
        adaptations: check.adaptations,
        interface: p.interface,
        pane: p.pane,
        publish: publish && { port: publish.port, bind: publish.bind, link: publish.link },
        frame: true,
        limits: p.limits,
        desired: "running" as const,
        state: "installing" as const,
        stateReason: null,
        installedBy: actorId,
        updatedAt: new Date(),
        removedAt: null,
      };
      let id: string;
      if (p.retained) {
        const updated = await tx.update(app).set(values).where(and(eq(app.name, p.name), eq(app.state, "removed"))).returning({ id: app.id });
        if (!updated[0]) throw new AppError(409, "conflict", "The app changed while you were reviewing it. Paste the kit's link again.");
        id = updated[0].id;
        await tx.delete(appSetting).where(eq(appSetting.appId, id));
        await tx.delete(appOutbound).where(eq(appOutbound.appId, id));
        await tx.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, id));
      } else {
        const inserted = await tx
          .insert(app)
          .values({ name: p.name, ...values })
          .onConflictDoNothing()
          .returning({ id: app.id });
        if (!inserted[0]) throw new AppError(409, "already_installed", `An app called ${p.name} is already installed.`);
        id = inserted[0].id;
      }
      if (settings.length) {
        await tx.insert(appSetting).values(
          settings.map((s) => ({
            appId: id,
            name: s.name,
            value: s.value === null ? null : encrypt(this.config.dataKey, s.value),
            secret: s.secret,
            generated: s.generated,
            publishedDefault: s.publishedDefault,
          })),
        );
      }
      if (p.outbound.length) {
        await tx.insert(appOutbound).values(p.outbound.map((host) => ({ appId: id, host, source: "kit" as const, approvedBy: actorId })));
      }
      await recordEvent(tx, "app.installed", actorId, null, id);
      if (bases.length) {
        await tx.insert(appKnowledgeBase).values(bases.map((base) => ({ appId: id, knowledgeBaseId: base.id, grantedBy: actorId })));
        for (const base of bases) await recordEvent(tx, "knowledge.granted", actorId, null, id, base);
      }
      return id;
    });
    const { jobId, done } = await this.startJob(appId, "install");
    log("info", "app.install_started", { app: p.name });
    return { name: p.name, jobId, done };
  }

  // ----- Jobs (FR-012) -----

  private async storedValues(appId: string): Promise<Map<string, string | null>> {
    const rows = await this.db.select().from(appSetting).where(eq(appSetting.appId, appId));
    return new Map(rows.map((r) => [r.name, r.value === null ? null : this.read(r.value)]));
  }

  /** A stored setting, or an error that says what to do when no key Your Space has can read it. */
  private read(stored: string): string {
    try {
      return decrypt(this.config.dataKey, stored);
    } catch {
      throw new AppError(
        409,
        "settings_unreadable",
        "Your Space can't read this app's settings: its data key may be missing or not the one they were saved with, or a stored setting may be damaged. Restore the data key Your Space had when the app was installed. Only if that isn't possible: remove the app and delete its kept data, which can't be undone, then install it again; it starts empty.",
      );
    }
  }

  /** A setting to show, or null when it can't be read; the app's state says why. */
  private readOrNull(stored: string): string | null {
    try {
      return decrypt(this.config.dataKey, stored);
    } catch {
      return null;
    }
  }

  private envOf(settings: { name: string; value: string | null }[]): Record<string, string> {
    return Object.fromEntries(settings.filter((s) => s.value !== null && s.value !== "").map((s) => [s.name, s.value!]));
  }

  async specFor(row: AppRow): Promise<AppSpec> {
    const values = await this.storedValues(row.id);
    // Behind the owner's link, the app's address settings follow it; templates that use them too.
    for (const [name, value] of this.linkValues(row)) if (values.has(name)) values.set(name, value);
    const outbound = await this.db.select({ host: appOutbound.host }).from(appOutbound).where(eq(appOutbound.appId, row.id));
    const pins = Object.fromEntries(Object.entries(row.images).map(([ref, { digest }]) => [ref, digest]));
    const bases = row.kit?.knowledge ? (await this.grants(row.id)).map((base) => base.name) : [];
    return {
      project: `ys-${row.name}`,
      ...(row.kit?.agentAccess ? { appId: row.id } : {}),
      app: row.name,
      compose: row.compose,
      env: this.envOf([...resolveTemplates(kitEnv(row.kit), values)].map(([name, value]) => ({ name, value }))),
      pins,
      interface: row.interface,
      limits: row.limits,
      egress: outbound.map((o) => o.host),
      // The app's Caddy replaces its framing rules only where the pane frames it.
      publish: row.publish ? { port: row.publish.port, bind: row.publish.bind, frame: inPane(this.config.publicUrl, row) } : null,
      knowledge: row.kit?.knowledge ? { path: row.kit.knowledge.path, bases } : null,
    };
  }

  /** The knowledge bases the owner gave the app, by name. */
  async grants(appId: string, db: Db | Tx = this.db): Promise<{ id: string; name: string; title: string }[]> {
    return db
      .select({ id: knowledgeBase.id, name: knowledgeBase.name, title: knowledgeBase.title })
      .from(appKnowledgeBase)
      .innerJoin(knowledgeBase, eq(appKnowledgeBase.knowledgeBaseId, knowledgeBase.id))
      .where(eq(appKnowledgeBase.appId, appId))
      .orderBy(knowledgeBase.name);
  }

  /**
   * The knowledge bases a request names for an app, checked: a list of names, each an existing
   * knowledge base. Only an app whose kit asks for knowledge can be given any (journey 014).
   */
  private async knowledgeBases(kit: Kit | null, title: string, input: unknown): Promise<{ id: string; name: string }[]> {
    const given = input ?? [];
    if (!Array.isArray(given) || given.some((name) => typeof name !== "string")) {
      throw new AppError(400, "bad_knowledge", "Send the knowledge bases to give the app as a list of their names.");
    }
    const names = [...new Set(given as string[])];
    if (names.length === 0) return [];
    if (!kit?.knowledge) throw new AppError(400, "no_knowledge", `${title}'s kit doesn't ask for knowledge, so it can't be given knowledge bases.`);
    const rows = await this.db.select({ id: knowledgeBase.id, name: knowledgeBase.name }).from(knowledgeBase).where(inArray(knowledgeBase.name, names));
    const missing = names.filter((name) => !rows.some((row) => row.name === name));
    if (missing.length) throw new AppError(400, "unknown_knowledge_base", `There is no knowledge base called ${missing.join(", ")}.`);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Whether the app has a job running, or a change holds it (hold). */
  isBusy(appId: string): boolean {
    return this.busy.has(appId);
  }

  /**
   * Holds free apps for a change that runs a job on each of them in turn, as deleting a knowledge base
   * does: until it lets go, none of them starts another change, so what it reads of them stays true.
   * Its jobs pass `held`. Returns what lets them go.
   */
  hold(appIds: string[]): () => void {
    if (appIds.some((id) => this.busy.has(id))) throw new AppError(409, "busy", "An app is busy with another change. Try again when it finishes.");
    for (const id of appIds) this.busy.add(id);
    return () => {
      for (const id of appIds) this.busy.delete(id);
    };
  }

  private async step(jobId: string, message: string): Promise<void> {
    const step: JobStep = { at: now(), message };
    await this.db
      .update(installJob)
      .set({ steps: sql`${installJob.steps} || ${JSON.stringify([step])}::jsonb` })
      .where(eq(installJob.id, jobId));
  }

  /** A job for a request, which answers with the job's ID and doesn't wait for it. */
  private async queue(appId: string, kind: "apply" | "remove", first?: (tx: Tx) => Promise<void>): Promise<{ jobId: string }> {
    const { jobId } = await this.startJob(appId, kind, { first });
    return { jobId };
  }

  /**
   * Starts a job that applies the app; one job per app at a time. `first` runs once the app is the
   * job's, in the transaction that records the job, so a change it saves is never left without the
   * job that applies it, and neither is kept when the other fails. A job of an app the caller holds
   * (hold) passes `held`: it neither checks the app is free nor lets go of it.
   */
  async startJob(
    appId: string,
    kind: "install" | "apply" | "remove",
    { first, held = false }: { first?: (tx: Tx) => Promise<void>; held?: boolean } = {},
  ): Promise<{ jobId: string; done: Promise<void> }> {
    if (!held) {
      if (this.busy.has(appId)) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
      this.busy.add(appId);
    }
    const letGo = () => {
      if (!held) this.busy.delete(appId);
    };
    try {
      const jobId = await this.db.transaction(async (tx) => {
        await first?.(tx);
        const inserted = await tx.insert(installJob).values({ appId, kind }).returning({ id: installJob.id });
        return inserted[0]!.id;
      });
      return { jobId, done: this.runJob(jobId, appId, kind).finally(letGo) };
    } catch (error) {
      letGo();
      throw error;
    }
  }

  private async runJob(jobId: string, appId: string, kind: "install" | "apply" | "remove"): Promise<void> {
    try {
      const row = (await this.db.select().from(app).where(eq(app.id, appId)))[0];
      if (!row) throw new AppError(404, "not_found", "The app is gone.");
      if (kind === "remove") {
        await this.step(jobId, "Stopping and removing the app's containers. Its data is kept.");
        await this.runtime.down(`ys-${row.name}`);
        // A removed app has no knowledge bases: installing it again gives it the ones the owner picks then.
        await this.db.transaction(async (tx) => {
          await tx.update(app).set({ state: "removed", desired: "removed", stateReason: null, removedAt: new Date(), updatedAt: new Date() }).where(eq(app.id, appId));
          await tx.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, appId));
        });
      } else {
        await this.db.update(app).set({ state: kind === "install" ? "installing" : "starting", stateReason: null, updatedAt: new Date() }).where(eq(app.id, appId));
        const spec = await this.specFor(row);
        // The install pulls the app's private images signed in with the image token, for those
        // images alone (R9). Nothing else uses it: Your Space doesn't sign in in the background (R7).
        if (kind === "install") spec.registryCredentials = await this.signInToPull(row);
        let lastImage = "";
        let lastPercent = -1;
        const pending: Promise<void>[] = [];
        await this.runtime.apply(spec, (event) => {
          if (event.step === "check") pending.push(this.step(jobId, "Checking the app's file against Your Space's rules."));
          if (event.step === "pull" && event.image) {
            const percent = Math.floor((event.progress ?? 0) * 10) * 10;
            if (event.image !== lastImage || percent !== lastPercent) {
              lastImage = event.image;
              lastPercent = percent;
              pending.push(this.step(jobId, `Downloading ${event.image.split("@")[0]}: ${percent}%`));
            }
          }
          if (event.step === "start") pending.push(this.step(jobId, "Starting the app's services."));
          if (event.step === "started") pending.push(this.step(jobId, "Started."));
        });
        await Promise.all(pending);
        await this.db.update(app).set({ state: "starting", updatedAt: new Date() }).where(eq(app.id, appId));
        await this.refreshState(row.name);
      }
      await this.db.update(installJob).set({ state: "succeeded", finishedAt: new Date() }).where(eq(installJob.id, jobId));
    } catch (error) {
      let message = error instanceof AppError || error instanceof RuntimeError ? error.message : "Something went wrong on the server.";
      if (!(error instanceof AppError || error instanceof RuntimeError)) log("error", "app.job_failed", errorFields(error));
      // A private image's registry asked for a sign-in while downloading it.
      if (error instanceof RuntimeError && error.code === "sign_in") {
        message +=
          kind === "install"
            ? ` Check your image token ${ADD_IMAGE_TOKEN}, then remove the app and install it again.`
            : " Your Space signs in to download a private image only while installing the app: remove it, then install it again, reusing its data, with your image token in place.";
      }
      await this.db.update(installJob).set({ state: "failed", error: message, finishedAt: new Date() }).where(eq(installJob.id, jobId));
      // Refused because Your Space is stopping: the app starts again with Your Space.
      const stopping = error instanceof RuntimeError && error.status === 409;
      // A failed removal shows as failed too, so the owner sees why and can remove it again.
      await this.db
        .update(app)
        .set(stopping ? { state: "stopped", stateReason: message, updatedAt: new Date() } : { state: "failed", stateReason: message, updatedAt: new Date() })
        .where(eq(app.id, appId));
    }
  }

  /** The image token, for the app's private images alone, or none when it has none or no token is ready. */
  private async signInToPull(row: AppRow): Promise<RegistryCredential[] | undefined> {
    const images = Object.entries(row.images).filter(([, image]) => image.private).map(([ref]) => ref);
    if (!images.length) return undefined;
    const token = (await this.config.registries?.signingIn()) ?? { state: "none" as const };
    return token.state === "ready" ? [{ ...token.credential, images }] : undefined;
  }

  async job(id: string) {
    const row = (await this.db.select().from(installJob).where(eq(installJob.id, id)))[0];
    if (!row) throw new AppError(404, "not_found", "There is no such job.");
    return { id: row.id, kind: row.kind, state: row.state, steps: row.steps, error: row.error, createdAt: row.createdAt, finishedAt: row.finishedAt };
  }

  // ----- Restart recovery and reconcile (FR-007, FR-008) -----

  /** At start: jobs whose process stopped can't finish, so they end as failed. */
  async recoverJobs(): Promise<void> {
    const interrupted = await this.db
      .update(installJob)
      .set({ state: "failed", error: "Interrupted by a restart of Your Space. Start the app again.", finishedAt: new Date() })
      .where(eq(installJob.state, "running"))
      .returning({ appId: installJob.appId });
    for (const { appId } of interrupted) {
      await this.db
        .update(app)
        .set({ state: "failed", stateReason: "The change was interrupted by a restart of Your Space.", updatedAt: new Date() })
        .where(and(eq(app.id, appId), inArray(app.state, ["installing", "starting"])));
    }
  }

  private async refreshState(name: string): Promise<void> {
    const report = (await this.runtime.apps()).find((a) => a.app === name);
    const { state, reason } = stateFromServices(report?.services ?? []);
    await this.db.update(app).set({ state, stateReason: reason, updatedAt: new Date() }).where(and(eq(app.name, name), ne(app.state, "removed")));
  }

  /** Starts apps that should run and don't, records each app's state, and collects access requests. */
  async reconcile(): Promise<void> {
    let reports;
    try {
      // While Your Space is being stopped on purpose, its apps are meant to stop with it.
      if ((await this.runtime.engine()).stopping) return;
      reports = await this.runtime.apps();
    } catch (error) {
      log("warn", "apps.reconcile_unavailable", errorFields(error));
      return;
    }
    const rows = await this.db.select().from(app).where(ne(app.state, "removed"));
    for (const row of rows) {
      if (this.busy.has(row.id)) continue;
      const services = reports.find((r) => r.app === row.name)?.services ?? [];
      const running = services.some((s) => s.role === "app" && (s.state === "running" || s.state === "restarting"));
      if (row.desired === "running" && !running && row.state !== "failed" && row.state !== "installing") {
        log("info", "apps.starting", { app: row.name });
        await this.startJob(row.id, "apply").catch(() => undefined);
        continue;
      }
      // A published app's Caddy follows Your Space's own after an update, and replaces the port
      // forwarder an earlier Your Space ran. Only it is recreated; the app's services keep running.
      // Once per app while this server runs, so a start that fails isn't repeated.
      if (row.desired === "running" && running && row.publish && services.some((s) => s.role === "publish" && s.outdated) && !this.renewed.has(row.id)) {
        this.renewed.add(row.id);
        log("info", "apps.renewing_proxy", { app: row.name });
        await this.startJob(row.id, "apply").catch(() => undefined);
        continue;
      }
      // An app whose owner had turned "Show inside Your Space" off shows in its pane now (decision
      // 2026-11-23, Alpha scope). Applied once per server start, its Caddy lets Your Space frame it;
      // `frame` is set only once that apply succeeded, so a failed one is tried after the next start.
      if (row.desired === "running" && running && !row.frame && inPane(this.config.publicUrl, row) && !this.renewed.has(row.id)) {
        this.renewed.add(row.id);
        log("info", "apps.renewing_proxy", { app: row.name });
        const started = await this.startJob(row.id, "apply").catch(() => undefined);
        void started?.done
          .then(async () => {
            const [job] = await this.db.select({ state: installJob.state }).from(installJob).where(eq(installJob.id, started.jobId));
            if (job?.state === "succeeded") await this.db.update(app).set({ frame: true }).where(eq(app.id, row.id));
          })
          .catch(() => undefined);
        continue;
      }
      const { state, reason } = row.desired === "stopped" && !running ? { state: "stopped" as const, reason: null } : stateFromServices(services);
      if (row.state === "failed" && !running) continue;
      if (state !== row.state || reason !== row.stateReason) {
        await this.db.update(app).set({ state, stateReason: reason, updatedAt: new Date() }).where(eq(app.id, row.id));
      }
      if (running) await this.collectDenials(row.id, row.name);
    }
  }

  private async collectDenials(appId: string, name: string): Promise<void> {
    let denied;
    try {
      denied = await this.runtime.denials(`ys-${name}`);
    } catch {
      return;
    }
    if (!denied.hosts.length) return;
    const approved = new Set((await this.db.select({ host: appOutbound.host }).from(appOutbound).where(eq(appOutbound.appId, appId))).map((o) => o.host));
    const known = new Set((await this.db.select({ host: appAccessRequest.host }).from(appAccessRequest).where(eq(appAccessRequest.appId, appId))).map((r) => r.host));
    const pending = (await this.db.select({ id: appAccessRequest.id }).from(appAccessRequest).where(and(eq(appAccessRequest.appId, appId), eq(appAccessRequest.state, "pending")))).length;
    let room = MAX_PENDING_REQUESTS - pending;
    for (const { host, attempts, lastSeen } of denied.hosts) {
      // The app chose these names, so only real host names become requests, and only so many.
      if (approved.has(host) || !HOST.test(host)) continue;
      if (!known.has(host)) {
        if (room <= 0) continue;
        room -= 1;
      }
      // The proxy's log counts every attempt it still holds; the request keeps the highest count seen.
      await this.db
        .insert(appAccessRequest)
        .values({ appId, host, attempts, lastSeen: new Date(lastSeen) })
        .onConflictDoUpdate({
          target: [appAccessRequest.appId, appAccessRequest.host],
          set: {
            attempts: sql`greatest(${appAccessRequest.attempts}, excluded.attempts)`,
            lastSeen: sql`greatest(${appAccessRequest.lastSeen}, excluded.last_seen)`,
          },
        });
    }
  }

  // ----- Reading -----

  async rowByName(name: string): Promise<AppRow> {
    const row = (await this.db.select().from(app).where(eq(app.name, name)))[0];
    if (!row) throw new AppError(404, "not_found", "There is no app with that name.");
    return row;
  }

  async list() {
    const rows = await this.db.select().from(app).orderBy(app.createdAt);
    const pending = await this.db
      .select({ appId: appAccessRequest.appId, n: sql<number>`count(*)::int` })
      .from(appAccessRequest)
      .where(eq(appAccessRequest.state, "pending"))
      .groupBy(appAccessRequest.appId);
    const counts = new Map(pending.map((p) => [p.appId, p.n]));
    const framing = await this.framing(rows.filter((r) => r.state !== "removed" && inPane(this.config.publicUrl, r)).map((r) => r.name));
    return {
      apps: rows
        .filter((r) => r.state !== "removed")
        .map((r) => ({
          id: r.id,
          name: r.name,
          title: r.title,
          state: r.state,
          stateReason: r.stateReason,
          origin: appOrigin(this.config.publicUrl, r),
          pane: r.pane,
          hasInterface: Boolean(r.interface),
          publish: publishOf(this.config.publicUrl, r),
          framing: framing.get(r.name) ?? null,
          pendingRequests: counts.get(r.id) ?? 0,
        })),
      retained: rows.filter((r) => r.state === "removed").map((r) => ({ name: r.name, title: r.title, repo: r.repo, removedAt: r.removedAt })),
    };
  }

  /**
   * For apps shown at their link in the pane: the short ID of each one's Caddy while it runs and lets
   * Your Space frame the app, as the runtime manager reports it. The pane frames the link only then,
   * with the ID in its address, so that a page the browser cached before, such as the app's refusal to
   * be framed, is never reused. Missing while a change is applied, or the runtime manager is down.
   */
  async framing(names: string[]): Promise<Map<string, string>> {
    const framing = new Map<string, string>();
    if (names.length === 0) return framing;
    try {
      for (const report of await this.runtime.apps()) {
        const id = report.services.find((s) => s.role === "publish" && s.framing)?.framing;
        if (id && names.includes(report.app)) framing.set(report.app, id);
      }
    } catch {
      // The runtime manager is down: no pane frames a link until it answers again.
    }
    return framing;
  }

  async detail(name: string) {
    const row = await this.rowByName(name);
    const settings = await this.db.select().from(appSetting).where(eq(appSetting.appId, row.id)).orderBy(appSetting.name);
    const outbound = await this.db.select().from(appOutbound).where(eq(appOutbound.appId, row.id)).orderBy(appOutbound.host);
    const requests = await this.db.select().from(appAccessRequest).where(eq(appAccessRequest.appId, row.id)).orderBy(desc(appAccessRequest.lastSeen));
    const job = (await this.db.select().from(installJob).where(eq(installJob.appId, row.id)).orderBy(desc(installJob.createdAt)).limit(1))[0];
    let services: ServiceState[] = [];
    try {
      services = (await this.runtime.apps()).find((a) => a.app === name)?.services ?? [];
    } catch {
      // The runtime manager is down; the record still shows.
    }
    const fromLink = this.linkValues(row);
    const env = kitEnv(row.kit);
    const bases = row.kit?.knowledge ? (await this.grants(row.id)).map(({ name, title }) => ({ name, title })) : [];
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      origin: appOrigin(this.config.publicUrl, row),
      state: row.state,
      stateReason: row.stateReason,
      desired: row.desired,
      pane: row.pane,
      interface: row.interface,
      publish: publishOf(this.config.publicUrl, row),
      source: { link: row.sourceUrl, repo: row.repo, path: row.path, ref: row.ref, commit: row.commit },
      kitSource: row.kitSource,
      provenance: row.provenance,
      images: row.images,
      adaptations: row.adaptations,
      services: services.map((s) => ({ ...s, limit: row.limits[s.name] ?? null })),
      limits: row.limits,
      settings: settings.map((s) =>
        publicSetting({
          name: s.name,
          secret: s.secret,
          generated: s.generated,
          required: isAsked(env, s.name),
          publishedDefault: s.publishedDefault,
          value: s.value === null ? null : s.secret ? "set" : (fromLink.get(s.name) ?? this.readOrNull(s.value)),
          derived: isDerived(env, s.name),
        }),
      ),
      outbound: outbound.map((o) => ({ host: o.host, source: o.source, createdAt: o.createdAt })),
      requests: requests.map((r) => ({ id: r.id, host: r.host, state: r.state, attempts: r.attempts, firstSeen: r.firstSeen, lastSeen: r.lastSeen })),
      job: job ? { id: job.id, kind: job.kind, state: job.state, steps: job.steps, error: job.error } : null,
      knowledge: row.kit?.knowledge ? { path: row.kit.knowledge.path, bases } : null,
      installedAt: row.createdAt,
      removedAt: row.removedAt,
    };
  }

  async logs(name: string, service: string): Promise<string[]> {
    const row = await this.rowByName(name);
    if (!Object.hasOwn(row.limits, service) && service !== "ys-egress") throw new AppError(404, "not_found", "There is no such service.");
    try {
      return await this.runtime.logs(`ys-${name}`, service, 300);
    } catch (error) {
      if (error instanceof RuntimeError) throw new AppError(error.status === 404 ? 404 : 503, error.code, error.status === 404 ? "That service isn't running." : error.message);
      throw error;
    }
  }

  async engine() {
    const info = await this.runtime.engine().catch(() => ({ reachable: false, connection: "unknown" }) as Awaited<ReturnType<Runtime["engine"]>>);
    const rows = await this.db.select().from(app).where(ne(app.state, "removed"));
    const apps = await Promise.all(
      rows.map(async (r) => {
        try {
          const stats = await this.runtime.stats(`ys-${r.name}`);
          return {
            name: r.name,
            title: r.title,
            memory: stats.services.reduce((n, s) => n + s.memory, 0),
            cpuPercent: Math.round(stats.services.reduce((n, s) => n + s.cpuPercent, 0) * 10) / 10,
          };
        } catch {
          return { name: r.name, title: r.title, memory: null, cpuPercent: null };
        }
      }),
    );
    return { ...info, apps };
  }

  // ----- Changing an app -----

  private async event(type: EventType, actorId: string, appId: string): Promise<void> {
    await recordEvent(this.db, type, actorId, null, appId);
  }

  private async liveRow(name: string): Promise<AppRow> {
    const row = await this.rowByName(name);
    if (this.busy.has(row.id)) throw new AppError(409, "busy", "The app is busy with another change.");
    if (row.state === "removed") throw new AppError(409, "removed", "The app has been removed. Install it again to use it.");
    return row;
  }

  async start(name: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    // Refused before anything is recorded, so a busy app's intent doesn't change.
    if (this.busy.has(row.id)) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
    await this.db.update(app).set({ desired: "running" }).where(eq(app.id, row.id));
    return this.queue(row.id, "apply");
  }

  async updateSettings(name: string, values: Record<string, string | null>, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    const current = await this.db.select().from(appSetting).where(eq(appSetting.appId, row.id));
    const changes = Object.entries(values ?? {});
    const env = kitEnv(row.kit);
    // Every value is checked before any is written, and they are written together.
    for (const [key, value] of changes) {
      const setting = current.find((s) => s.name === key);
      if (!setting || isDerived(env, key)) throw new AppError(400, "unknown_setting", `${key} isn't a setting you can change.`);
      if (value !== null && typeof value !== "string") throw new AppError(400, "invalid_setting", `${key} must be text.`);
      // A blank secret would let the app fall back to its published default (FR-006).
      if (setting.secret && (value === null || value === "")) {
        throw new AppError(400, "secret_required", `${key} is a secret. Replace it with a new value instead of clearing it.`);
      }
      // Nothing else stops the app from starting without a value its kit asks the owner for.
      if (isAsked(env, key) && (value === null || value === "")) {
        throw new AppError(400, "setting_required", `${key} is required. Replace it with a new value instead of clearing it.`);
      }
    }
    // Template settings that use a changed value are rewritten with it.
    const next = new Map(current.map((s) => [s.name, s.value === null ? null : this.read(s.value)]));
    for (const [key, value] of changes) next.set(key, value === null || value === "" ? null : value);
    const filled = resolveTemplates(env, next);
    const templates = Object.entries(env)
      .filter(([name, source]) => templateOf(source) !== undefined && current.some((s) => s.name === name))
      .map(([name]) => [name, filled.get(name) ?? null] as const);
    await this.db.transaction(async (tx) => {
      for (const [key, value] of changes) {
        await tx
          .update(appSetting)
          .set({ value: value === null || value === "" ? null : encrypt(this.config.dataKey, value), generated: false })
          .where(and(eq(appSetting.appId, row.id), eq(appSetting.name, key)));
      }
      for (const [key, value] of templates) {
        await tx
          .update(appSetting)
          .set({ value: value === null || value === "" ? null : encrypt(this.config.dataKey, value) })
          .where(and(eq(appSetting.appId, row.id), eq(appSetting.name, key)));
      }
    });
    await this.event("app.settings_changed", actorId, row.id);
    return this.queue(row.id, "apply");
  }

  /**
   * Publishes the app on a port of this machine, changes how, or stops (null). Applying the app again
   * restarts only the services whose address settings follow a link that changed, and otherwise
   * recreates at most its Caddy. Stopping drops the owner's choices, so publishing again starts from
   * the defaults.
   */
  async updatePublish(name: string, publishWith: unknown, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    if (this.busy.has(row.id)) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
    let publish: PublishChoices | null = null;
    if (publishWith !== null) {
      if (!row.interface) throw new AppError(400, "no_interface", `${row.title} has no interface to publish.`);
      // The first time, the check gives the port the app's file publishes.
      const current = row.publish ?? { port: defaultPort((await this.check(await this.specFor(row))).services, row.interface) ?? row.interface.port, bind: DEFAULT_BIND, link: null };
      publish = publishFrom(publishWith, current);
      await this.refuseTakenPort(publish, row.name);
    }
    await this.db
      .update(app)
      .set({ publish: publish && { port: publish.port, bind: publish.bind, link: publish.link }, frame: true, updatedAt: new Date() })
      .where(eq(app.id, row.id));
    await this.event("app.publish_changed", actorId, row.id);
    return this.queue(row.id, "apply");
  }

  async updateLimits(name: string, limits: Record<string, { memory?: number; cpus?: number }>, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    const next = { ...row.limits };
    for (const [service, limit] of Object.entries(limits ?? {})) {
      if (!Object.hasOwn(next, service)) throw new AppError(400, "unknown_service", `${service} isn't a service of this app.`);
      if (typeof limit !== "object" || limit === null) throw new AppError(400, "bad_limit", `Send ${service}'s memory and CPUs.`);
      const memory = limit.memory ?? next[service].memory;
      const cpus = limit.cpus ?? next[service].cpus;
      if (!Number.isInteger(memory) || memory < 32 * 1024 * 1024) throw new AppError(400, "bad_limit", "Memory must be at least 32 MiB.");
      if (typeof cpus !== "number" || cpus < 0.1 || cpus > 64) throw new AppError(400, "bad_limit", "CPUs must be between 0.1 and 64.");
      next[service] = { memory, cpus };
    }
    await this.db.update(app).set({ limits: next, updatedAt: new Date() }).where(eq(app.id, row.id));
    await this.event("app.limits_changed", actorId, row.id);
    return this.queue(row.id, "apply");
  }

  /**
   * Gives the app exactly these knowledge bases (journey 014). Applying it again recreates its
   * interface service with their folders; its data is kept.
   */
  async updateKnowledge(name: string, input: unknown, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    if (!row.kit?.knowledge) throw new AppError(400, "no_knowledge", `${row.title}'s kit doesn't ask for knowledge, so it can't be given knowledge bases.`);
    const next = await this.knowledgeBases(row.kit, row.title, input);
    // Read and saved only once the app is the job's, with the job: a grant saved without the apply
    // that mounts it, or takes it away, would leave the app's containers and its grants disagreeing,
    // and grants read before then may be another change's, from before it was saved.
    return this.queue(row.id, "apply", async (tx) => {
      const current = await this.grants(row.id, tx);
      const added = next.filter((base) => !current.some((c) => c.id === base.id));
      const removed = current.filter((base) => !next.some((n) => n.id === base.id));
      if (removed.length) {
        await tx.delete(appKnowledgeBase).where(and(eq(appKnowledgeBase.appId, row.id), inArray(appKnowledgeBase.knowledgeBaseId, removed.map((base) => base.id))));
      }
      if (added.length) await tx.insert(appKnowledgeBase).values(added.map((base) => ({ appId: row.id, knowledgeBaseId: base.id, grantedBy: actorId })));
      for (const base of added) await recordEvent(tx, "knowledge.granted", actorId, null, row.id, base);
      for (const base of removed) await recordEvent(tx, "knowledge.revoked", actorId, null, row.id, base);
    });
  }

  async approve(name: string, host: string, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    const clean = host.trim().toLowerCase();
    if (!HOST.test(clean)) {
      throw new AppError(400, "bad_host", "That isn't a host name, like api.example.com.");
    }
    await this.db.insert(appOutbound).values({ appId: row.id, host: clean, source: "owner", approvedBy: actorId }).onConflictDoNothing();
    await this.db.delete(appAccessRequest).where(and(eq(appAccessRequest.appId, row.id), eq(appAccessRequest.host, clean)));
    await this.event("app.outbound_approved", actorId, row.id);
    return this.queue(row.id, "apply");
  }

  async approveRequest(name: string, requestId: string, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    const request = (await this.db.select().from(appAccessRequest).where(and(eq(appAccessRequest.id, requestId), eq(appAccessRequest.appId, row.id))))[0];
    if (!request) throw new AppError(404, "not_found", "There is no such access request.");
    return this.approve(name, request.host, actorId);
  }

  async dismissRequest(name: string, requestId: string, actorId: string): Promise<void> {
    const row = await this.liveRow(name);
    const updated = await this.db
      .update(appAccessRequest)
      .set({ state: "dismissed" })
      .where(and(eq(appAccessRequest.id, requestId), eq(appAccessRequest.appId, row.id)))
      .returning({ id: appAccessRequest.id });
    if (!updated[0]) throw new AppError(404, "not_found", "There is no such access request.");
    await this.event("app.request_dismissed", actorId, row.id);
  }

  async removeOutbound(name: string, host: string, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    const removed = await this.db
      .delete(appOutbound)
      .where(and(eq(appOutbound.appId, row.id), eq(appOutbound.host, host.toLowerCase())))
      .returning({ host: appOutbound.host });
    if (!removed[0]) throw new AppError(404, "not_found", "That host isn't approved for this app.");
    await this.event("app.outbound_removed", actorId, row.id);
    return this.queue(row.id, "apply");
  }

  /** Removes the app's containers and networks; its data and settings stay as retained data (FR-023). */
  async remove(name: string, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    // Recorded once the job holds the app, so a removal refused as busy changes nothing: a change that
    // holds the app, such as deleting a knowledge base, never reads a removal it doesn't run.
    return this.queue(row.id, "remove", async (tx) => {
      await tx.update(app).set({ desired: "removed" }).where(eq(app.id, row.id));
      await recordEvent(tx, "app.removed", actorId, null, row.id);
    });
  }

  async deleteData(name: string, confirm: string, actorId: string): Promise<void> {
    const row = await this.rowByName(name);
    if (row.state !== "removed") throw new AppError(409, "not_removed", "Remove the app before deleting its data.");
    if (confirm !== name) throw new AppError(400, "confirm", `Type ${name} to confirm.`);
    try {
      await this.runtime.deleteVolumes(`ys-${name}`);
    } catch (error) {
      if (error instanceof RuntimeError) throw new AppError(503, error.code, error.message);
      throw error;
    }
    await this.event("app.data_deleted", actorId, row.id);
    await this.db.delete(app).where(eq(app.id, row.id));
  }

  async isInstalled(name: string): Promise<boolean> {
    const rows = await this.db.select({ id: app.id }).from(app).where(and(eq(app.name, name), ne(app.state, "removed")));
    return rows.length > 0;
  }
}
