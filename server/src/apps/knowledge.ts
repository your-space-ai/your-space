// Knowledge bases (journey 014, decision 2026-11-25): named folders of files that belong to Your
// Space, not to any app, kept in volumes the runtime manager makes. The owner creates them here and
// gives them to apps whose kits ask for knowledge (AppsService.install and updateKnowledge).
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { recordEvent } from "../actors.ts";
import { app, appKnowledgeBase, knowledgeBase } from "../db/schema.ts";
import { log } from "../log.ts";
import { RuntimeError } from "./runtime-client.ts";
import { AppError, type AppsService } from "./service.ts";

/** A knowledge base's name: lower-case letters, digits and dashes, which become its folder in apps. */
export const KNOWLEDGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_TITLE = 80;

function titleOf(input: unknown, fallback?: string): string {
  if (input === undefined && fallback !== undefined) return fallback;
  if (typeof input !== "string" || !input.trim() || input.trim().length > MAX_TITLE) {
    throw new AppError(400, "bad_title", `A knowledge base's title is 1 to ${MAX_TITLE} characters.`);
  }
  return input.trim();
}

/** A runtime manager's refusal, as the owner sees it. */
function refused(error: unknown): never {
  if (error instanceof RuntimeError) throw new AppError(error.status === 400 || error.status === 409 ? error.status : 503, error.code, error.message);
  throw error;
}

export class KnowledgeBases {
  readonly apps: AppsService;

  constructor(apps: AppsService) {
    this.apps = apps;
  }

  private get db() {
    return this.apps.db;
  }

  private async rowByName(name: string) {
    const row = (await this.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, name)))[0];
    if (!row) throw new AppError(404, "not_found", "There is no knowledge base with that name.");
    return row;
  }

  /** The installed apps given each knowledge base; a removed app has none. */
  private async users(ids: string[]): Promise<Map<string, { name: string; title: string }[]>> {
    const users = new Map<string, { name: string; title: string }[]>();
    if (ids.length === 0) return users;
    const rows = await this.db
      .select({ knowledgeBaseId: appKnowledgeBase.knowledgeBaseId, id: app.id, name: app.name, title: app.title })
      .from(appKnowledgeBase)
      .innerJoin(app, eq(appKnowledgeBase.appId, app.id))
      .where(and(inArray(appKnowledgeBase.knowledgeBaseId, ids), ne(app.state, "removed")))
      .orderBy(asc(app.title));
    for (const row of rows) users.set(row.knowledgeBaseId, [...(users.get(row.knowledgeBaseId) ?? []), { name: row.name, title: row.title }]);
    return users;
  }

  async list() {
    const rows = await this.db.select().from(knowledgeBase).orderBy(asc(knowledgeBase.title), asc(knowledgeBase.name));
    const users = await this.users(rows.map((r) => r.id));
    return {
      knowledgeBases: rows.map((r) => ({ name: r.name, title: r.title, createdAt: r.createdAt, apps: users.get(r.id) ?? [] })),
    };
  }

  /** Creates a knowledge base: its storage first, then its record, so a retry after a failure works. */
  async create(input: { name?: unknown; title?: unknown }, actorId: string) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!KNOWLEDGE_NAME.test(name)) {
      throw new AppError(400, "bad_name", "A knowledge base's name is 1 to 40 lower-case letters, digits and dashes, starting and ending with a letter or digit, like course-notes.");
    }
    const title = titleOf(input.title, name);
    if ((await this.db.select({ id: knowledgeBase.id }).from(knowledgeBase).where(eq(knowledgeBase.name, name)))[0]) {
      throw new AppError(409, "already_exists", `A knowledge base called ${name} already exists.`);
    }
    await this.apps.runtime.createKnowledge(name).catch(refused);
    const id = await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(knowledgeBase).values({ name, title, createdBy: actorId }).onConflictDoNothing().returning({ id: knowledgeBase.id });
      if (!inserted[0]) throw new AppError(409, "already_exists", `A knowledge base called ${name} already exists.`);
      await recordEvent(tx, "knowledge.created", actorId, null, null, inserted[0].id);
      return inserted[0].id;
    });
    log("info", "knowledge.created", { name });
    return { name, title, id };
  }

  /** Changes a knowledge base's title; its name, the apps' folder, stays. */
  async retitle(name: string, input: unknown, actorId: string) {
    const row = await this.rowByName(name);
    const title = titleOf(input);
    await this.db.transaction(async (tx) => {
      await tx.update(knowledgeBase).set({ title, updatedAt: new Date() }).where(eq(knowledgeBase.id, row.id));
      await recordEvent(tx, "knowledge.retitled", actorId, null, null, row.id);
    });
    return { name, title };
  }

  /**
   * Deletes a knowledge base and its files. It leaves every app it was given to first: those apps are
   * applied again without it, and only then does the runtime manager delete its storage, which it
   * refuses while any container still mounts it. When it refuses, an app that couldn't be applied
   * without the knowledge base keeps it, so the owner can fix that app and try again.
   */
  async delete(name: string, actorId: string): Promise<void> {
    const row = await this.rowByName(name);
    const grants = await this.db
      .select({ grant: appKnowledgeBase, title: app.title, state: app.state })
      .from(appKnowledgeBase)
      .innerJoin(app, eq(appKnowledgeBase.appId, app.id))
      .where(eq(appKnowledgeBase.knowledgeBaseId, row.id));
    const busy = grants.filter((g) => this.apps.isBusy(g.grant.appId));
    if (busy.length) throw new AppError(409, "busy", `${busy.map((g) => g.title).join(", ")} ${busy.length === 1 ? "is" : "are"} busy with another change. Try again when it finishes.`);
    if (grants.length) await this.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.knowledgeBaseId, row.id));
    const failed: { appId: string; reason: string }[] = [];
    for (const { grant, title, state } of grants) {
      if (state === "removed") continue;
      try {
        const { jobId, done } = await this.apps.startJob(grant.appId, "apply");
        await done;
        const job = await this.apps.job(jobId);
        if (job.state !== "succeeded") failed.push({ appId: grant.appId, reason: `${title}: ${job.error ?? "it didn't start again."}` });
      } catch (error) {
        failed.push({ appId: grant.appId, reason: `${title}: ${error instanceof AppError ? error.message : "it couldn't be applied again."}` });
      }
    }
    const left = grants.filter((g) => !failed.some((f) => f.appId === g.grant.appId));
    try {
      await this.apps.runtime.deleteKnowledge(name);
    } catch (error) {
      await this.db.transaction(async (tx) => {
        const back = grants.filter((g) => failed.some((f) => f.appId === g.grant.appId)).map((g) => g.grant);
        if (back.length) await tx.insert(appKnowledgeBase).values(back).onConflictDoNothing();
        for (const { grant } of left) await recordEvent(tx, "knowledge.revoked", actorId, null, grant.appId, row.id);
      });
      if (error instanceof RuntimeError && failed.length) {
        throw new AppError(409, error.code, `${error.message} These apps couldn't be applied without it, so they keep it: ${failed.map((f) => f.reason).join(" ")}`);
      }
      refused(error);
    }
    await this.db.transaction(async (tx) => {
      for (const { grant } of grants) await recordEvent(tx, "knowledge.revoked", actorId, null, grant.appId, row.id);
      await recordEvent(tx, "knowledge.deleted", actorId, null, null, row.id);
      await tx.delete(knowledgeBase).where(eq(knowledgeBase.id, row.id));
    });
    log("info", "knowledge.deleted", { name, apps: grants.length });
  }
}
