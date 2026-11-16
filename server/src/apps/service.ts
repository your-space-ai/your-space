// Installing and managing apps (components A, F, G, H). The server keeps each app's record and
// settings; the runtime manager runs it. Secret values leave the server only in the app spec sent to
// the runtime manager.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { recordEvent } from "../actors.ts";
import type { Db } from "../db/client.ts";
import { app, appSetting, installJob, type AppState, type JobStep, type Kit } from "../db/schema.ts";
import { errorFields, log } from "../log.ts";
import { fetchSource, githubEndpoints, SourceError, type GithubEndpoints, type SourceFile } from "./github.ts";
import { findKit, KitError } from "./kits.ts";
import { RuntimeError, type AppSpec, type CheckAnswer, type Runtime, type ServiceState } from "./runtime-client.ts";
import { buildSettings, decrypt, encrypt, publicSetting, type Setting } from "./settings.ts";

export const DEFAULT_MEMORY = 1024 * 1024 * 1024;
export const DEFAULT_CPUS = 1;
const PREVIEW_LIFETIME_MS = 30 * 60_000;
const RESERVED_NAMES = new Set(["www", "api", "app", "apps", "space", "admin", "static", "assets", "mail"]);

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

export interface AppsConfig {
  /** Your Space's own address, e.g. http://space.localhost. */
  publicUrl: string;
  authSecret: string;
  github?: GithubEndpoints;
  fetch?: typeof fetch;
}

interface Preview {
  id: string;
  expiresAt: number;
  source: SourceFile;
  kit: Kit | null;
  kitSource: string | null;
  name: string;
  title: string;
  check: CheckAnswer;
  settings: Setting[];
  limits: Record<string, { memory: number; cpus: number }>;
  interface: { service: string; port: number } | null;
  pane: boolean;
}

export type AppRow = typeof app.$inferSelect;

/** `sure.space.localhost` for Your Space at `space.localhost`, with the same scheme and port. */
export function appAddress(publicUrl: string, name: string): { origin: string; host: string } {
  const url = new URL(publicUrl);
  const host = `${name}.${url.hostname}`;
  return { host, origin: `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}` };
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

function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 30).replace(/-+$/, "");
  return s || "app";
}

function now(): string {
  return new Date().toISOString();
}

/** An app's state from what the runtime reports for its services. */
export function stateFromServices(services: ServiceState[]): { state: AppState; reason: string | null } {
  const app = services.filter((s) => s.role === "app");
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
  return starting ? { state: "starting", reason: null } : { state: "running", reason: null };
}

export class AppsService {
  readonly db: Db;
  readonly runtime: Runtime;
  readonly config: AppsConfig;
  private readonly previews = new Map<string, Preview>();
  private readonly busy = new Set<string>();

  constructor(db: Db, runtime: Runtime, config: AppsConfig) {
    this.db = db;
    this.runtime = runtime;
    this.config = config;
  }

  address(name: string) {
    return appAddress(this.config.publicUrl, name);
  }

  // ----- Preview and install (FR-011) -----

  async preview(link: string, kitLink?: string): Promise<ReturnType<AppsService["reviewOf"]>> {
    for (const [id, p] of this.previews) if (p.expiresAt < Date.now()) this.previews.delete(id);
    const github = this.config.github ?? githubEndpoints();
    const fetcher = this.config.fetch ?? fetch;
    let source: SourceFile;
    let found;
    try {
      source = await fetchSource(link, github, fetcher);
      found = await findKit(source.repo, source.path, kitLink, github, fetcher);
    } catch (error) {
      if (error instanceof SourceError || error instanceof KitError) throw new AppError(400, "source", error.message);
      throw error;
    }
    const kit = found?.kit ?? null;
    const name = kit?.name ?? slug(source.repo.split("/")[1]!);
    if (RESERVED_NAMES.has(name)) throw new AppError(400, "name_reserved", `The name ${name} is reserved by Your Space.`);
    const existing = (await this.db.select().from(app).where(eq(app.name, name)))[0];
    if (existing) throw new AppError(409, "already_installed", `An app called ${name} is already installed.`);
    const address = this.address(name);

    // A first check reads the settings the file uses; the second resolves the file with them.
    const spec: AppSpec = { project: `ys-${name}`, app: name, compose: source.text, env: {}, interface: kit?.interface ?? null };
    const first = await this.check(spec);
    const settings = buildSettings(first.variables, kit, address);
    const check = await this.check({ ...spec, env: this.envOf(settings) });

    const limits: Record<string, { memory: number; cpus: number }> = {};
    for (const service of check.services) {
      const fromKit = kit?.limits?.[service.name];
      limits[service.name] = { memory: fromKit?.memory ?? DEFAULT_MEMORY, cpus: fromKit?.cpus ?? DEFAULT_CPUS };
    }
    const preview: Preview = {
      id: randomUUID(),
      expiresAt: Date.now() + PREVIEW_LIFETIME_MS,
      source,
      kit,
      kitSource: found?.source ?? null,
      name,
      title: kit?.title ?? source.repo.split("/")[1]!,
      check,
      settings,
      limits,
      interface: kit?.interface ?? this.guessInterface(check),
      pane: kit?.pane ?? true,
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

  /** Without a kit, the interface is the one service that publishes a port, if there is exactly one. */
  private guessInterface(check: CheckAnswer): { service: string; port: number } | null {
    const published = check.services.filter((s) => s.ports.length > 0);
    if (published.length !== 1) return null;
    return { service: published[0]!.name, port: published[0]!.ports[0]! };
  }

  private reviewOf(p: Preview) {
    return {
      previewId: p.id,
      name: p.name,
      title: p.title,
      origin: this.address(p.name).origin,
      source: { link: p.source.link, repo: p.source.repo, path: p.source.path, ref: p.source.ref, commit: p.source.commit, pinnedLink: p.source.pinnedLink },
      kit: p.kitSource ? { source: p.kitSource } : null,
      ok: p.check.ok,
      services: p.check.services,
      images: p.check.images.map((i) => ({ ref: i.ref, digest: i.digest, runsHere: i.runsHere })),
      adaptations: p.check.adaptations,
      refusals: p.check.refusals,
      settings: p.settings.map(publicSetting),
      interface: p.interface,
      pane: p.pane,
      warning:
        "Installing an app trusts it with everything you put into it. Your Space keeps it away from your other apps, Your Space's own data and this machine, and lets it reach only the internet hosts you approve.",
    };
  }

  async install(previewId: string, values: Record<string, string>, actorId: string): Promise<{ name: string; jobId: string; done: Promise<void> }> {
    const p = this.previews.get(previewId);
    if (!p || p.expiresAt < Date.now()) throw new AppError(404, "preview_expired", "This review has expired. Paste the link again.");
    const review = this.reviewOf(p);
    if (!review.ok) throw new AppError(400, "refused", "Your Space can't run this app as it is.", review.refusals);
    const settings = p.settings.map((s) => ({ ...s }));
    for (const [name, value] of Object.entries(values ?? {})) {
      const setting = settings.find((s) => s.name === name);
      if (!setting || setting.derived) throw new AppError(400, "unknown_setting", `${name} isn't a setting of this app.`);
      setting.value = value === "" ? null : value;
      setting.generated = false;
    }
    const missing = settings.filter((s) => s.required && !s.value).map((s) => s.name);
    if (missing.length) throw new AppError(400, "settings_required", `These settings need a value: ${missing.join(", ")}.`);

    this.previews.delete(previewId);
    const images = Object.fromEntries(p.check.images.filter((i) => i.digest).map((i) => [i.ref, { digest: i.digest! }]));
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
        images,
        adaptations: p.check.adaptations,
        interface: p.interface,
        pane: p.pane,
        limits: p.limits,
        desired: "running" as const,
        state: "installing" as const,
        stateReason: null,
        installedBy: actorId,
        updatedAt: new Date(),
        removedAt: null,
      };
      const inserted = await tx
        .insert(app)
        .values({ name: p.name, ...values })
        .onConflictDoNothing()
        .returning({ id: app.id });
      if (!inserted[0]) throw new AppError(409, "already_installed", `An app called ${p.name} is already installed.`);
      const id = inserted[0].id;
      if (settings.length) {
        await tx.insert(appSetting).values(
          settings.map((s) => ({
            appId: id,
            name: s.name,
            value: s.value === null ? null : encrypt(this.config.authSecret, s.value),
            secret: s.secret,
            generated: s.generated,
            publishedDefault: s.publishedDefault,
          })),
        );
      }
      await recordEvent(tx, "app.installed", actorId, null, id);
      return id;
    });
    const { jobId, done } = await this.startJob(appId, "install");
    log("info", "app.install_started", { app: p.name });
    return { name: p.name, jobId, done };
  }

  // ----- Jobs (FR-012) -----

  private async storedValues(appId: string): Promise<Map<string, string | null>> {
    const rows = await this.db.select().from(appSetting).where(eq(appSetting.appId, appId));
    return new Map(rows.map((r) => [r.name, r.value === null ? null : decrypt(this.config.authSecret, r.value)]));
  }

  private envOf(settings: { name: string; value: string | null }[]): Record<string, string> {
    return Object.fromEntries(settings.filter((s) => s.value !== null && s.value !== "").map((s) => [s.name, s.value!]));
  }

  async specFor(row: AppRow): Promise<AppSpec> {
    const values = await this.storedValues(row.id);
    const pins = Object.fromEntries(Object.entries(row.images).map(([ref, { digest }]) => [ref, digest]));
    return {
      project: `ys-${row.name}`,
      app: row.name,
      compose: row.compose,
      env: this.envOf([...values].map(([name, value]) => ({ name, value }))),
      pins,
      interface: row.interface,
      limits: row.limits,
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
  private async queue(appId: string, kind: "apply"): Promise<{ jobId: string }> {
    const { jobId } = await this.startJob(appId, kind);
    return { jobId };
  }

  /** Starts a job that applies the app; one job per app at a time. */
  async startJob(appId: string, kind: "install" | "apply"): Promise<{ jobId: string; done: Promise<void> }> {
    if (this.busy.has(appId)) throw new AppError(409, "busy", "The app is busy with another change. Try again when it finishes.");
    this.busy.add(appId);
    const inserted = await this.db.insert(installJob).values({ appId, kind }).returning({ id: installJob.id });
    const jobId = inserted[0]!.id;
    const done = this.runJob(jobId, appId, kind).finally(() => {
      this.busy.delete(appId);
    });
    return { jobId, done };
  }

  private async runJob(jobId: string, appId: string, kind: "install" | "apply"): Promise<void> {
    try {
      const row = (await this.db.select().from(app).where(eq(app.id, appId)))[0];
      if (!row) throw new AppError(404, "not_found", "The app is gone.");
      await this.db.update(app).set({ state: kind === "install" ? "installing" : "starting", stateReason: null, updatedAt: new Date() }).where(eq(app.id, appId));
      const spec = await this.specFor(row);
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
      await this.db.update(installJob).set({ state: "succeeded", finishedAt: new Date() }).where(eq(installJob.id, jobId));
    } catch (error) {
      const message = error instanceof AppError || error instanceof RuntimeError ? error.message : "Something went wrong on the server.";
      if (!(error instanceof AppError || error instanceof RuntimeError)) log("error", "app.job_failed", errorFields(error));
      await this.db.update(installJob).set({ state: "failed", error: message, finishedAt: new Date() }).where(eq(installJob.id, jobId));
      // Refused because Your Space is stopping: the app starts again with Your Space.
      const stopping = error instanceof RuntimeError && error.status === 409;
      await this.db
        .update(app)
        .set(stopping ? { state: "stopped", stateReason: message, updatedAt: new Date() } : { state: "failed", stateReason: message, updatedAt: new Date() })
        .where(eq(app.id, appId));
    }
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

  /** Starts apps that should run and don't, and records each app's state. */
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
      const { state, reason } = row.desired === "stopped" && !running ? { state: "stopped" as const, reason: null } : stateFromServices(services);
      if (row.state === "failed" && !running) continue;
      if (state !== row.state || reason !== row.stateReason) {
        await this.db.update(app).set({ state, stateReason: reason, updatedAt: new Date() }).where(eq(app.id, row.id));
      }
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
    return {
      apps: rows
        .filter((r) => r.state !== "removed")
        .map((r) => ({
          name: r.name,
          title: r.title,
          state: r.state,
          stateReason: r.stateReason,
          origin: this.address(r.name).origin,
          pane: r.pane,
          hasInterface: Boolean(r.interface),
        })),
    };
  }

  async detail(name: string) {
    const row = await this.rowByName(name);
    const job = (await this.db.select().from(installJob).where(eq(installJob.appId, row.id)).orderBy(desc(installJob.createdAt)).limit(1))[0];
    return {
      name: row.name,
      title: row.title,
      origin: this.address(row.name).origin,
      state: row.state,
      stateReason: row.stateReason,
      desired: row.desired,
      pane: row.pane,
      interface: row.interface,
      source: { link: row.sourceUrl, repo: row.repo, path: row.path, ref: row.ref, commit: row.commit },
      kitSource: row.kitSource,
      images: row.images,
      adaptations: row.adaptations,
      job: job ? { id: job.id, kind: job.kind, state: job.state, steps: job.steps, error: job.error } : null,
      installedAt: row.createdAt,
    };
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

  private async liveRow(name: string): Promise<AppRow> {
    const row = await this.rowByName(name);
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

  async isInstalled(name: string): Promise<boolean> {
    const rows = await this.db.select({ id: app.id }).from(app).where(and(eq(app.name, name), ne(app.state, "removed")));
    return rows.length > 0;
  }
}
