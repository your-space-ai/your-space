// Installing and managing apps (components A, F, G, H, N, O, P). The server keeps each app's record,
// settings and approvals; the runtime manager runs it. Secret values leave the server only in the
// app spec sent to the runtime manager.
import { storedAgentAccess } from "./agent-kit.ts";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { recordEvent } from "../actors.ts";
import type { Db } from "../db/client.ts";
import {
  app,
  appAccessRequest,
  appOutbound,
  appSetting,
  installJob,
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
  defaultBranchLink,
  fetchSourceWith,
  githubEndpoints,
  isBranch,
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
import { restore, restoreInterruptedUpdates, snapshotOf } from "./rollback.ts";
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


/** The agent access an app's stored kit gives: its API's path, or why it gives none. */
function agentAccessOf(
  kit: unknown,
  appInterface: unknown,
): { api: string | null; problem: "old_format" | "no_interface" | null } | null {
  const stored = storedAgentAccess(kit);
  if (!stored) return null;
  if (!("access" in stored)) return { api: null, problem: stored.problem };
  // The gateway reaches an app only through the interface its kit names.
  return appInterface ? { api: stored.access.api, problem: null } : { api: null, problem: "no_interface" };
}

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
  /** How long an update waits for the app to run, and keep running, before it is kept (journey 019). */
  updateSettle?: { waitMs: number; steadyMs: number; pollMs: number };
}

/** Opening an app's page checks it for an update at most this often (decision 4). */
const AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60_000;
/** An update is kept once the app has run for 10 seconds, waiting at most five minutes for it to start. */
const UPDATE_SETTLE = { waitMs: 300_000, steadyMs: 10_000, pollMs: 2_000 };

/** The API's error code for each way GitHub gave no file. */
const MISS_CODE: Record<SourceMiss, string> = { not_found: "not_found", not_visible: "repository_not_visible", no_ref: "not_found", no_file: "file_missing" };
/** What the owner does about a connection that can't read a private file; the page and the command each say where. */
const RECONNECT = "Create a new token and connect GitHub again, then try again.";
/** Where the owner adds the image token: the GitHub page, or the server command. */
const ADD_IMAGE_TOKEN = "on Your Space's GitHub page, or with docker compose exec server github image-token";

type JobKind = "install" | "apply" | "update" | "remove";

/** A digest of an app's stored settings rows, as stored (ciphertext). */
function digestOf(rows: { name: string; value: string | null }[]): string {
  return createHash("sha256").update(JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.name, r.value]))).digest("hex");
}

/** What an update changes, against what the app runs (journey 019, section 2). */
export interface UpdateChanges {
  kit: { from: string | null; to: string };
  compose: { from: { repo: string; path: string; commit: string }; to: { repo: string; path: string; commit: string } } | null;
  images: { ref: string; from: string | null; to: string | null; private: boolean }[];
  /** `changed`: values the kit sets, which the owner never changed, that take the new kit's value. */
  settings: { added: string[]; removed: string[]; changed: string[] };
  outbound: { added: string[]; removed: string[] };
  services: { added: string[]; removed: string[] };
  interface: { from: { service: string; port: number } | null; to: { service: string; port: number } | null } | null;
  /** The kit's other fields that change: `agentAccess`, `title`, `pane`, `limits`, `kit` or `name`. */
  kitFields: string[];
}

/** A reviewed update: one candidate, the new kit at a commit, its Compose file and image digests (FR-006). */
interface UpdatePreview {
  id: string;
  expiresAt: number;
  appId: string;
  name: string;
  /** The kit the app ran when the review was made; applying is refused once it runs another. */
  expected: string | null;
  source: SourceFile;
  kit: Kit;
  kitSource: string;
  kitRead: FileRead | null;
  kitLink: string;
  check: CheckAnswer;
  settings: Setting[];
  changes: UpdateChanges;
  upToDate: boolean;
  /** A digest of everything the review shows, which `update --review` binds an apply to. */
  digest: string;
  /** The app's stored settings when the review was made; applying is refused once they changed. */
  settingsDigest: string;
  /** How the app was published when the review was made, which its address settings follow. */
  publish: Publish | null;
}

interface Preview {
  id: string;
  expiresAt: number;
  source: SourceFile;
  kit: Kit;
  kitSource: string;
  /** How the kit was read from GitHub; null for a kit file given on this machine. */
  kitRead: FileRead | null;
  /** The kit's link as given, at its branch, tag or commit; null for a kit file given on this machine. */
  kitLink: string | null;
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
}

export type AppRow = typeof app.$inferSelect;

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
  private readonly updates = new Map<string, UpdatePreview>();
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
    let check = await this.checkSigningIn({ project: `ys-${name}`, app: name, compose: source.text, env: this.envOf(settings), interface: kit.interface ?? null, placeholders: true });
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
      kitLink: found.file?.link ?? null,
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
      check = await this.checkSigningIn({ project: `ys-${p.name}`, app: p.name, compose: p.source.text, env: this.envOf(settings), interface: p.kit.interface ?? null });
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
        kitLink: p.kitLink,
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
      return id;
    });
    const { jobId, done } = await this.startJob(appId, "install");
    log("info", "app.install_started", { app: p.name });
    return { name: p.name, jobId, done };
  }

  // ----- Updates in place (journey 019) -----

  /**
   * Reviews an update of an installed app: its kit read again at its own location (decision 7), with
   * the Compose file the kit pins, checked with the app's stored settings. The review says what changes against what the app runs, and whether anything
   * does (FR-002, FR-003). Nothing changes until the owner applies it.
   */
  /**
   * The check that opening an app's page runs (decision 4): a review, as `previewUpdate` gives it, or
   * null when the app's last check is under 12 hours old.
   */
  async autoCheckUpdate(name: string): Promise<ReturnType<AppsService["updateReviewOf"]> | null> {
    const row = await this.rowByName(name);
    const at = row.updateCheck ? Date.parse(row.updateCheck.at) : Number.NaN;
    if (Number.isFinite(at) && Date.now() - at < AUTO_CHECK_INTERVAL_MS) return null;
    return this.previewUpdate(name);
  }

  /** Reviews an update, and records the check's time and result for the app (decision 4). */
  async previewUpdate(name: string): Promise<ReturnType<AppsService["updateReviewOf"]>> {
    // An app that is busy or removed isn't checked, and nothing is recorded.
    const row = await this.liveRow(name);
    try {
      const review = await this.reviewUpdate(name);
      await this.recordCheck(row, { at: new Date().toISOString(), available: !review.upToDate });
      return review;
    } catch (error) {
      // A failed check counts as one, so the page doesn't try again on each visit.
      const message = error instanceof AppError ? error.message : "Something went wrong on the server.";
      await this.recordCheck(row, { at: new Date().toISOString(), available: row.updateCheck?.available ?? false, error: message });
      throw error;
    }
  }

  /** Kept only while the app still runs the kit the check was made against. */
  private async recordCheck(row: AppRow, check: { at: string; available: boolean; error?: string }): Promise<void> {
    const sameKit = row.kitSource === null ? isNull(app.kitSource) : eq(app.kitSource, row.kitSource);
    await this.db.update(app).set({ updateCheck: check }).where(and(eq(app.id, row.id), sameKit));
  }

  private async reviewUpdate(name: string): Promise<ReturnType<AppsService["updateReviewOf"]>> {
    for (const [id, p] of this.updates) if (p.expiresAt < Date.now()) this.updates.delete(id);
    const row = await this.liveRow(name);
    // The app's own link, or, for an app installed before links were kept, its pinned kit link.
    const pinned = kitIdentity(row.kitSource ?? "");
    const own = row.kitLink ?? (pinned.repo && pinned.path ? defaultBranchLink(pinned.repo, pinned.path) : null);
    if (!own) {
      throw new AppError(409, "no_kit_link", `${row.title} was installed from a kit file on this machine, so it has no kit on GitHub to check for an update.`);
    }
    const github = this.config.github ?? githubEndpoints();
    const fetcher = this.config.fetch ?? fetch;
    let found: FoundKit & { file: SourceFile };
    let source: SourceFile;
    try {
      found = await this.kitAt(await this.followed(row, own, github, fetcher), github, fetcher);
      source = await this.composeAt(found.kit, github, fetcher);
    } catch (error) {
      if (error instanceof NotAKitError) throw new AppError(400, "kit_required", error.message);
      if (error instanceof SourceError && error.miss) throw new AppError(404, MISS_CODE[error.miss], error.message);
      if (error instanceof SourceError || error instanceof KitError) throw new AppError(400, "source", error.message);
      throw error;
    }
    // As the database stores it, so comparing it with the installed kit finds only real changes.
    const kit = JSON.parse(JSON.stringify(found.kit)) as Kit;
    if (kit.name !== undefined && kit.name !== row.name) {
      throw new AppError(400, "other_app", `That kit is for an app called ${kit.name}, not ${row.name}.`);
    }

    // Kept settings keep their values (section 5); a value the kit sets, that the owner left as the
    // installed kit set it, follows the new kit.
    // The stored settings are read once, so the digest describes exactly the values the review keeps.
    const stored = await this.db.select({ name: appSetting.name, value: appSetting.value }).from(appSetting).where(eq(appSetting.appId, row.id));
    const settingsDigest = digestOf(stored);
    const previous = new Map(stored.map((r) => [r.name, r.value === null ? null : this.read(r.value)]));
    const before = kitEnv(row.kit);
    // Values the kit sets, which follow the new kit's (decision 5), listed in the review.
    const followed: string[] = [];
    for (const [variable, entry] of Object.entries(kitEnv(kit))) {
      const old = before[variable];
      if (typeof entry === "string" && typeof old === "string" && previous.get(variable) === old) {
        previous.delete(variable);
        if (entry !== old) followed.push(variable);
      }
    }
    const settings = buildSettings(kit, this.address(row.name), previous);
    let check = await this.checkSigningIn({ project: `ys-${row.name}`, app: row.name, compose: source.text, env: this.runEnv(kit, settings, row), interface: kit.interface ?? null, placeholders: true });
    withFileDefaults(settings, check.variables);
    const refusals = undefinedVariables(check.variables, kitEnv(kit)).map((variable) => ({
      service: "",
      setting: "env",
      reason: `The kit doesn't define ${variable}, which the Compose file needs. Add it to the kit's env.`,
    }));
    if (row.publish && !kit.interface) {
      refusals.push({ service: "", setting: "interface", reason: `The new kit gives ${row.title} no interface, and it is published. Stop publishing it first.` });
    }
    if (refusals.length) check = { ...check, ok: false, refusals: [...check.refusals, ...refusals] };

    const kitHosts = (
      await this.db.select({ host: appOutbound.host }).from(appOutbound).where(and(eq(appOutbound.appId, row.id), eq(appOutbound.source, "kit")))
    ).map((o) => o.host);
    const outbound = kit.outbound ?? [];
    const images = new Map(check.images.filter((i) => i.digest).map((i) => [i.ref, { digest: i.digest!, private: i.private === true }]));
    const refs = [...new Set([...Object.keys(row.images), ...images.keys()])].sort();
    const services = check.services.map((s) => s.name);
    const sameInterface = isDeepStrictEqual(row.interface ?? null, kit.interface ?? null);
    const changes: UpdateChanges = {
      kit: { from: row.kitSource, to: found.source },
      compose:
        row.repo === source.repo && row.path === source.path && row.commit === source.commit
          ? null
          : { from: { repo: row.repo, path: row.path, commit: row.commit }, to: { repo: source.repo, path: source.path, commit: source.commit } },
      images: refs
        .filter((ref) => row.images[ref]?.digest !== images.get(ref)?.digest)
        .map((ref) => ({ ref, from: row.images[ref]?.digest ?? null, to: images.get(ref)?.digest ?? null, private: images.get(ref)?.private ?? false })),
      settings: {
        added: settings.filter((s) => !previous.has(s.name) && !Object.hasOwn(before, s.name)).map((s) => s.name),
        removed: Object.keys(before).filter((variable) => !settings.some((s) => s.name === variable)).sort(),
        changed: followed.sort(),
      },
      outbound: { added: outbound.filter((h) => !kitHosts.includes(h)), removed: kitHosts.filter((h) => !outbound.includes(h)).sort() },
      services: { added: services.filter((n) => !Object.hasOwn(row.limits, n)), removed: Object.keys(row.limits).filter((n) => !services.includes(n)).sort() },
      interface: sameInterface ? null : { from: row.interface ?? null, to: kit.interface ?? null },
      kitFields: [],
    };
    // The kit's other fields that change, such as its agent access, title or limits, so a review of
    // a kit whose only change is one of them still says what changes.
    const shown = new Set(["source", "env", "outbound", "interface"]);
    const installed = (row.kit ?? {}) as unknown as Record<string, unknown>;
    const candidate = kit as unknown as Record<string, unknown>;
    changes.kitFields = [...new Set([...Object.keys(installed), ...Object.keys(candidate)])]
      .filter((field) => !shown.has(field) && !isDeepStrictEqual(installed[field], candidate[field]))
      .sort();
    // An update is a changed kit (decision 1); an image tag that names another digest now isn't one.
    const upToDate = isDeepStrictEqual(row.kit, kit) && changes.compose === null;
    const digest = createHash("sha256")
      .update(JSON.stringify([row.kitSource, found.file.link, found.source, source.repo, source.path, source.commit, refs.map((ref) => [ref, images.get(ref)?.digest ?? null])]))
      .digest("hex");
    const preview: UpdatePreview = {
      id: randomUUID(),
      expiresAt: Date.now() + PREVIEW_LIFETIME_MS,
      appId: row.id,
      name: row.name,
      expected: row.kitSource,
      source,
      kit,
      kitSource: found.source,
      kitRead: found.file.read ?? null,
      kitLink: found.file.link,
      check,
      settings,
      changes,
      upToDate,
      digest,
      settingsDigest,
      publish: row.publish ?? null,
    };
    this.updates.set(preview.id, preview);
    return this.updateReviewOf(preview);
  }

  /**
   * The environment the app runs with, as `specFor` gives it: behind the owner's published link, its
   * address settings follow the link, and templates that use them too, so a review checks the images
   * the update's job pulls.
   */
  private runEnv(kit: Kit, settings: Setting[], row: Pick<AppRow, "publish">): Record<string, string> {
    const values = new Map(settings.map((s) => [s.name, s.value]));
    for (const [name, value] of this.linkValues({ kit, publish: row.publish })) if (values.has(name)) values.set(name, value);
    return this.envOf([...resolveTemplates(kitEnv(kit), values)].map(([name, value]) => ({ name, value })));
  }

  /** The app's stored settings, as a digest: a review made before the owner changed one is refused. */
  private async settingsDigest(db: Pick<Db, "select">, appId: string): Promise<string> {
    return digestOf(await db.select({ name: appSetting.name, value: appSetting.value }).from(appSetting).where(eq(appSetting.appId, appId)));
  }

  /**
   * Where an app's update is read (decision 1): its own link at a branch, or the same file on the
   * repository's default branch for a link at a commit or a tag. Only whether the ref is a branch is
   * asked, so a tag deleted since doesn't stop the check.
   */
  private async followed(row: AppRow, own: string, github: GithubEndpoints, fetcher: typeof fetch): Promise<string> {
    const pinned = kitIdentity(row.kitSource ?? "");
    if (!pinned.repo || !pinned.path) return own;
    const head = defaultBranchLink(pinned.repo, pinned.path);
    const prefix = `https://github.com/${pinned.repo}/blob/`;
    const suffix = head.slice(prefix.length + "HEAD".length);
    if (!own.startsWith(prefix) || !own.endsWith(suffix)) return own;
    const ref = decodeURIComponent(own.slice(prefix.length, own.length - suffix.length));
    if (ref === "HEAD") return own;
    let credential: SourceCredential | undefined;
    if (row.provenance?.kit?.read === "connection") {
      const reading = (await this.config.credentials?.reading()) ?? { state: "none" as const };
      if (reading.state === "ready") credential = reading.credential;
    }
    return (await isBranch(pinned.repo, ref, github, fetcher, credential)) ? own : head;
  }

  private updateReviewOf(p: UpdatePreview) {
    return {
      previewId: p.id,
      name: p.name,
      upToDate: p.upToDate,
      digest: p.digest,
      link: p.kitLink,
      kit: { ...kitIdentity(p.kitSource), read: p.kitRead },
      source: { repo: p.source.repo, path: p.source.path, commit: p.source.commit, pinnedLink: p.source.pinnedLink, read: p.source.read ?? null },
      changes: p.changes,
      ok: p.check.ok,
      refusals: p.check.refusals,
      settings: p.settings.filter((s) => p.changes.settings.added.includes(s.name)).map(publicSetting),
    };
  }

  /**
   * Applies a reviewed update in place (FR-004, FR-006): the candidate the review was made of, never
   * the branch's latest commit, and only while the app still runs the kit the review was made
   * against. The app keeps its ID, volumes, kept settings, publish settings, owner-approved hosts and
   * limits, and agent access (spec 018); removed settings and the kit hosts it dropped are deleted.
   * With `digest`, the review must also be the one an earlier check printed (`update --review`).
   */
  async applyUpdate(name: string, previewId: string, values: Record<string, string>, actorId: string, digest?: string): Promise<{ name: string; jobId: string; done: Promise<void> }> {
    const p = this.updates.get(previewId);
    if (!p || p.expiresAt < Date.now() || p.name !== name) throw new AppError(404, "preview_expired", "This review has expired. Check for the update again.");
    if (digest !== undefined && digest !== p.digest) {
      throw new AppError(409, "update_changed", "The update isn't the one you reviewed: the app, its kit's branch or an image changed since. Check for the update again.");
    }
    if (p.upToDate) throw new AppError(409, "up_to_date", `${p.name} already runs this kit.`);
    if (!p.check.ok) throw new AppError(400, "refused", "Your Space can't run this update as it is.", p.check.refusals);
    const settings = p.settings.map((s) => ({ ...s }));
    for (const [name, value] of Object.entries(values ?? {})) {
      const setting = settings.find((s) => s.name === name);
      if (!setting || setting.derived) throw new AppError(400, "unknown_setting", `${name} isn't a setting of this app.`);
      setting.value = value === "" ? null : value;
      setting.generated = false;
    }
    const filled = resolveTemplates(kitEnv(p.kit), new Map(settings.map((s) => [s.name, s.value])));
    for (const setting of settings) setting.value = filled.get(setting.name) ?? null;
    const missing = settings.filter((s) => s.required && !s.value).map((s) => s.name);
    if (missing.length) throw new AppError(400, "settings_required", `These settings need a value: ${missing.join(", ")}.`);
    // The file is checked again with the values given, so its changes are the real ones. Its images
    // stay those the review showed: a tag that names another digest now is refused (FR-006).
    let check = p.check;
    if (Object.keys(values ?? {}).length) {
      const current = (await this.db.select({ publish: app.publish }).from(app).where(eq(app.id, p.appId)))[0];
      check = await this.checkSigningIn({ project: `ys-${p.name}`, app: p.name, compose: p.source.text, env: this.runEnv(p.kit, settings, { publish: current?.publish ?? null }), interface: p.kit.interface ?? null });
      if (!check.ok) {
        const reasons = check.refusals.map((r) => `${r.service ? `${r.service}: ` : ""}${r.reason}`).join(" ");
        throw new AppError(400, "refused", `Your Space can't run this update with these settings: ${reasons}`, check.refusals);
      }
      // An image the review resolved must name the same version; one whose reference a setting given
      // now completes, which the review held as a placeholder, is checked here for the first time.
      const reviewed = new Map(p.check.images.filter((i) => i.digest).map((i) => [i.ref, i.digest]));
      if (check.images.some((i) => reviewed.has(i.ref) && reviewed.get(i.ref) !== i.digest)) {
        throw new AppError(409, "update_changed", "An image the update uses names another version than the one you reviewed. Check for the update again.");
      }
    }
    const images = Object.fromEntries(check.images.filter((i) => i.digest).map((i) => [i.ref, { digest: i.digest!, ...(i.private ? { private: true as const } : {}) }]));

    // The app is claimed before anything is written, and its job is recorded in the same transaction
    // as the change, so no other change, here or in a server command's process, runs in between.
    if (this.busy.has(p.appId)) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
    this.busy.add(p.appId);
    this.updates.delete(previewId);
    let jobId: string;
    try {
      jobId = await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(app).where(eq(app.id, p.appId)).for("update");
        if (
          !row ||
          row.state === "removed" ||
          row.kitSource !== p.expected ||
          !isDeepStrictEqual(row.publish ?? null, p.publish) ||
          (await this.settingsDigest(tx, row.id)) !== p.settingsDigest
        ) {
          throw new AppError(409, "update_changed", "The app changed while you were reviewing the update. Check for the update again.");
        }
        const [running] = await tx.select({ id: installJob.id }).from(installJob).where(and(eq(installJob.appId, row.id), eq(installJob.state, "running"))).limit(1);
        if (running) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
        const rollback = await snapshotOf(tx, row, actorId);
        const limits: Record<string, { memory: number; cpus: number }> = {};
        for (const service of check.services) {
          const fromKit = p.kit.limits?.[service.name];
          limits[service.name] = row.limits[service.name] ?? { memory: fromKit?.memory ?? DEFAULT_MEMORY, cpus: fromKit?.cpus ?? DEFAULT_CPUS };
        }
        await tx
          .update(app)
          .set({
            title: p.kit.title ?? row.title,
            sourceUrl: p.source.link,
            repo: p.source.repo,
            path: p.source.path,
            ref: p.source.ref,
            commit: p.source.commit,
            compose: p.source.text,
            kit: p.kit,
            kitSource: p.kitSource,
            kitLink: p.kitLink,
            provenance: { kit: p.kitRead, compose: p.source.read ?? null },
            images,
            adaptations: check.adaptations,
            interface: p.kit.interface ?? null,
            pane: p.kit.pane ?? true,
            limits,
            // An update starts the app, as Start does.
            desired: "running",
            updateCheck: { at: new Date().toISOString(), available: false },
            updatedAt: new Date(),
          })
          .where(eq(app.id, row.id));
        const names = settings.map((s) => s.name);
        await tx.delete(appSetting).where(and(eq(appSetting.appId, row.id), names.length ? notInArray(appSetting.name, names) : undefined));
        for (const s of settings) {
          const value = s.value === null ? null : encrypt(this.config.dataKey, s.value);
          await tx
            .insert(appSetting)
            .values({ appId: row.id, name: s.name, value, secret: s.secret, generated: s.generated, publishedDefault: s.publishedDefault })
            .onConflictDoUpdate({ target: [appSetting.appId, appSetting.name], set: { value, secret: s.secret, generated: s.generated, publishedDefault: s.publishedDefault } });
        }
        const outbound = p.kit.outbound ?? [];
        await tx
          .delete(appOutbound)
          .where(and(eq(appOutbound.appId, row.id), eq(appOutbound.source, "kit"), outbound.length ? notInArray(appOutbound.host, outbound) : undefined));
        if (outbound.length) {
          await tx.insert(appOutbound).values(outbound.map((host) => ({ appId: row.id, host, source: "kit" as const, approvedBy: actorId }))).onConflictDoNothing();
        }
        await recordEvent(tx, "app.updated", actorId, null, row.id);
        const [job] = await tx.insert(installJob).values({ appId: row.id, kind: "update", rollback }).returning({ id: installJob.id });
        return job!.id;
      });
    } catch (error) {
      this.busy.delete(p.appId);
      throw error;
    }
    const done = this.runJob(jobId, p.appId, "update").finally(() => this.busy.delete(p.appId));
    log("info", "app.update_started", { app: p.name });
    return { name: p.name, jobId, done };
  }

  /**
   * Waits for an app to run and keep running (decision 3): it must report running within `waitMs`,
   * then for `steadyMs` without a break. A container that exits a moment after it started is seen,
   * and so is one that keeps restarting, or an app service that exited, even cleanly.
   */
  private async settle(name: string): Promise<{ ok: boolean; reason: string }> {
    const { waitMs, steadyMs, pollMs } = this.config.updateSettle ?? UPDATE_SETTLE;
    const until = Date.now() + waitMs;
    let since: number | null = null;
    for (;;) {
      const services = (await this.runtime.apps()).find((a) => a.app === name)?.services ?? [];
      const exited = services.find((s) => s.role === "app" && !s.completed && s.state === "exited");
      const found = stateFromServices(services);
      if (exited && found.state === "running") return { ok: false, reason: `${exited.name} stopped.` };
      if (found.state === "running") {
        since ??= Date.now();
        if (Date.now() - since >= steadyMs) return { ok: true, reason: "" };
      } else if (found.state === "starting") {
        since = null;
        if (Date.now() >= until) return { ok: false, reason: `it was still starting after ${Math.round(waitMs / 60_000)} minutes.` };
      } else {
        return { ok: false, reason: found.reason ?? "it isn't running." };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /**
   * Puts an update back (decision 3): the app's row, settings and kit hosts as they were, then, unless
   * Your Space is stopping, starts the app with them again and waits for it to run. Recorded, with
   * why, for the owner to see. When the kit it ran before doesn't run either, the app is stopped, so
   * no service of the update keeps running, and shows as failed.
   */
  private async rollBack(jobId: string, appId: string, reason: string, start: boolean): Promise<void> {
    const [job] = await this.db.select({ rollback: installJob.rollback }).from(installJob).where(eq(installJob.id, jobId));
    const snapshot = job?.rollback;
    if (!snapshot) return;
    await this.step(jobId, `The update didn't start: ${reason} Rolling it back.`);
    await this.db.transaction(async (tx) => {
      await restore(tx, appId, snapshot);
      // The update it rolled back is still there to apply.
      await tx.update(app).set({ updateCheck: { at: new Date().toISOString(), available: true } }).where(eq(app.id, appId));
      await tx.update(installJob).set({ rollback: null }).where(eq(installJob.id, jobId));
      await recordEvent(tx, "app.update_rolled_back", snapshot.actorId, null, appId);
    });
    const message = `The update didn't start and was rolled back: ${reason}`;
    // The app's state is written before its job ends, so whoever waits on the job sees it.
    if (!start) {
      await this.db.update(app).set({ state: "stopped", stateReason: message, updatedAt: new Date() }).where(eq(app.id, appId));
      await this.db.update(installJob).set({ state: "failed", error: message, finishedAt: new Date() }).where(eq(installJob.id, jobId));
      return;
    }
    const row = (await this.db.select().from(app).where(eq(app.id, appId)))[0]!;
    let why: string;
    try {
      const spec = await this.specFor(row);
      spec.registryCredentials = await this.signInToPull(row);
      await this.runtime.apply(spec, () => undefined);
      const settled = await this.settle(row.name);
      if (settled.ok) {
        await this.refreshState(row.name);
        await this.db.update(app).set({ stateReason: message, updatedAt: new Date() }).where(eq(app.id, appId));
        await this.step(jobId, "Rolled back: the app runs the kit it ran before.");
        await this.db.update(installJob).set({ state: "failed", error: message, finishedAt: new Date() }).where(eq(installJob.id, jobId));
        return;
      }
      why = settled.reason;
    } catch (error) {
      why = error instanceof AppError || error instanceof RuntimeError ? error.message : "Something went wrong on the server.";
      if (!(error instanceof AppError || error instanceof RuntimeError)) log("error", "app.rollback_failed", errorFields(error));
    }
    // A start that failed before Compose ran may leave the update's own services running.
    await this.runtime.down(`ys-${row.name}`).catch((error: unknown) => log("warn", "app.rollback_stop_failed", errorFields(error)));
    const failed = `${message} Starting it again with the kit it ran before failed too: ${why} The app is stopped; start it again once the problem is fixed.`;
    await this.db.update(app).set({ state: "failed", stateReason: failed, updatedAt: new Date() }).where(eq(app.id, appId));
    await this.db.update(installJob).set({ state: "failed", error: failed, finishedAt: new Date() }).where(eq(installJob.id, jobId));
  }

  /**
   * A rollback that couldn't finish, as when the database refused a write: the job ends, so nothing
   * waits on it, and keeps what the update replaced, which the server's next start puts back.
   */
  private async rollBackFailed(jobId: string, appId: string, failure: unknown): Promise<void> {
    log("error", "app.rollback_failed", errorFields(failure));
    const message = "The update didn't start, and Your Space couldn't roll it back. Restart Your Space to roll it back.";
    await this.db.update(app).set({ state: "failed", stateReason: message, updatedAt: new Date() }).where(eq(app.id, appId)).catch(() => undefined);
    await this.db.update(installJob).set({ state: "failed", error: message, finishedAt: new Date() }).where(eq(installJob.id, jobId)).catch(() => undefined);
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
  private async queue(appId: string, kind: "apply" | "update" | "remove"): Promise<{ jobId: string }> {
    const { jobId } = await this.startJob(appId, kind);
    return { jobId };
  }

  /** Starts a job that applies the app; one job per app at a time. */
  async startJob(appId: string, kind: JobKind): Promise<{ jobId: string; done: Promise<void> }> {
    if (this.busy.has(appId)) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
    this.busy.add(appId);
    try {
      const inserted = await this.db.insert(installJob).values({ appId, kind }).returning({ id: installJob.id });
      const jobId = inserted[0]!.id;
      return { jobId, done: this.runJob(jobId, appId, kind).finally(() => this.busy.delete(appId)) };
    } catch (error) {
      this.busy.delete(appId);
      throw error;
    }
  }

  private async runJob(jobId: string, appId: string, kind: JobKind): Promise<void> {
    try {
      const row = (await this.db.select().from(app).where(eq(app.id, appId)))[0];
      if (!row) throw new AppError(404, "not_found", "The app is gone.");
      if (kind === "remove") {
        await this.step(jobId, "Stopping and removing the app's containers. Its data is kept.");
        await this.runtime.down(`ys-${row.name}`);
        await this.db.update(app).set({ state: "removed", desired: "removed", stateReason: null, removedAt: new Date(), updatedAt: new Date() }).where(eq(app.id, appId));
      } else {
        await this.db.update(app).set({ state: kind === "install" ? "installing" : "starting", stateReason: null, updatedAt: new Date() }).where(eq(app.id, appId));
        const spec = await this.specFor(row);
        // The install pulls the app's private images signed in with the image token, for those
        // images alone (R9), and so does an update the owner applies (journey 019, FR-005). Nothing
        // else uses it: Your Space doesn't sign in in the background (R7).
        if (kind === "install" || kind === "update") spec.registryCredentials = await this.signInToPull(row);
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
        if (kind === "update") {
          // An update is kept only once the app runs, and keeps running (decision 3).
          const settled = await this.settle(row.name);
          if (!settled.ok) {
            await this.rollBack(jobId, appId, settled.reason, true).catch((failure: unknown) => this.rollBackFailed(jobId, appId, failure));
            return;
          }
        }
        await this.refreshState(row.name);
      }
      await this.db.update(installJob).set({ state: "succeeded", rollback: null, finishedAt: new Date() }).where(eq(installJob.id, jobId));
    } catch (error) {
      let message = error instanceof AppError || error instanceof RuntimeError ? error.message : "Something went wrong on the server.";
      if (!(error instanceof AppError || error instanceof RuntimeError)) log("error", "app.job_failed", errorFields(error));
      // A private image's registry asked for a sign-in while downloading it.
      if (error instanceof RuntimeError && error.code === "sign_in") {
        message +=
          kind === "install"
            ? ` Check your image token ${ADD_IMAGE_TOKEN}, then remove the app and install it again.`
            : kind === "update"
              ? ` Check your image token ${ADD_IMAGE_TOKEN}, then check for the update again.`
            : " Your Space signs in to download a private image only while installing the app: remove it, then install it again, reusing its data, with your image token in place.";
      }
      // Refused because Your Space is stopping: the app starts again with Your Space.
      const stopping = error instanceof RuntimeError && error.status === 409;
      // An update that doesn't start is put back, and started again unless Your Space is stopping (decision 3).
      if (kind === "update") {
        await this.rollBack(jobId, appId, message, !stopping).catch((failure: unknown) => this.rollBackFailed(jobId, appId, failure));
        return;
      }
      await this.db.update(installJob).set({ state: "failed", error: message, finishedAt: new Date() }).where(eq(installJob.id, jobId));
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
  async recoverJobs(restoredAtStart: string[] = []): Promise<void> {
    // An interrupted update is put back first (decision 3); the server's start does this before it
    // moves stored settings to a new data key, and passes the apps it put back.
    const restored = [...restoredAtStart, ...(await restoreInterruptedUpdates(this.db))];
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
    // An app whose update was put back starts again with the kit it ran before, which replaces the
    // update's containers before their state is recorded as the app's.
    for (const appId of restored) await this.startJob(appId, "apply").catch((error) => log("warn", "apps.restore_start_failed", errorFields(error)));
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
          updateAvailable: r.updateCheck?.available === true,
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
      // The last update check (journey 019, decision 4).
      update: row.updateCheck ?? null,
      // Whether agents can reach the app through Your Space, and why not (spec 018 decision 11).
      agentAccess: agentAccessOf(row.kit, row.interface),
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

  async approve(name: string, host: string, actorId: string): Promise<{ jobId: string }> {
    const row = await this.liveRow(name);
    const clean = host.trim().toLowerCase();
    if (!HOST.test(clean)) {
      throw new AppError(400, "bad_host", "That isn't a host name, like api.example.com.");
    }
    // An owner's approval of a host the kit lists too makes it the owner's, so an update that drops it
    // from the kit keeps it (journey 019).
    await this.db
      .insert(appOutbound)
      .values({ appId: row.id, host: clean, source: "owner", approvedBy: actorId })
      .onConflictDoUpdate({ target: [appOutbound.appId, appOutbound.host], set: { source: "owner", approvedBy: actorId } });
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
    await this.db.update(app).set({ desired: "removed" }).where(eq(app.id, row.id));
    await this.event("app.removed", actorId, row.id);
    return this.queue(row.id, "remove");
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
