// Knowledge bases (journey 014, decision 2026-11-25): named folders of files that belong to Your
// Space, not to any app, kept in volumes the runtime manager makes. The owner creates them here and
// gives them to apps whose kits ask for knowledge (AppsService.install and updateKnowledge).
import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
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
    await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(knowledgeBase).values({ name, title, createdBy: actorId }).onConflictDoNothing().returning({ id: knowledgeBase.id });
      if (!inserted[0]) throw new AppError(409, "already_exists", `A knowledge base called ${name} already exists.`);
      await recordEvent(tx, "knowledge.created", actorId, null, null, { id: inserted[0].id, name });
    });
    log("info", "knowledge.created", { name });
    return { name, title };
  }

  /** Changes a knowledge base's title; its name, the apps' folder, stays. */
  async retitle(name: string, input: unknown, actorId: string) {
    const row = await this.rowByName(name);
    const title = titleOf(input);
    await this.db.transaction(async (tx) => {
      await tx.update(knowledgeBase).set({ title, updatedAt: new Date() }).where(eq(knowledgeBase.id, row.id));
      await recordEvent(tx, "knowledge.retitled", actorId, null, null, { id: row.id, name: row.name });
    });
    return { name, title };
  }

  /**
   * Deletes a knowledge base and its files. It leaves every app that has it first: each app it was
   * given to, and any app whose containers still mount it without a grant, as after a change that
   * couldn't be applied or a restart in the middle of an earlier delete. Each is applied again
   * without it, or removed when the owner asked to remove it, and only then does the runtime manager
   * delete its storage, which it refuses while any container still mounts it. When an app couldn't be
   * applied or removed, nothing is deleted: that app keeps its grant, so the owner can fix it and try
   * again. The apps are held from the start to the end, so no other change of theirs runs meanwhile.
   */
  async delete(name: string, actorId: string): Promise<void> {
    const row = await this.rowByName(name);
    const subject = { id: row.id, name: row.name };
    const { apps: mounting } = await this.apps.runtime.knowledgeUsers(name).catch(refused);
    const granted = (await this.db.select({ appId: appKnowledgeBase.appId }).from(appKnowledgeBase).where(eq(appKnowledgeBase.knowledgeBaseId, row.id))).map((g) => g.appId);
    const which = [...(granted.length ? [inArray(app.id, granted)] : []), ...(mounting.length ? [inArray(app.name, mounting)] : [])];
    // A removed app has no containers to apply.
    const targets = which.length
      ? await this.db
          .select({ id: app.id, title: app.title })
          .from(app)
          .where(and(ne(app.state, "removed"), or(...which)))
          .orderBy(asc(app.title))
      : [];
    const busy = targets.filter((target) => this.apps.isBusy(target.id));
    if (busy.length) throw new AppError(409, "busy", `${busy.map((b) => b.title).join(", ")} ${busy.length === 1 ? "is" : "are"} busy with another change. Try again when it finishes.`);
    // Taken with no wait after the check: what is read of the apps from here on stays true until the end.
    const release = this.apps.hold(targets.map((target) => target.id));
    try {
      // Only the held apps' grants are taken: one given since to another app stays, with the apply that mounts it.
      const ids = targets.map((target) => target.id);
      const taken = ids.length
        ? await this.db
            .delete(appKnowledgeBase)
            .where(and(eq(appKnowledgeBase.knowledgeBaseId, row.id), inArray(appKnowledgeBase.appId, ids)))
            .returning()
        : [];
      const failed: { appId: string; reason: string }[] = [];
      for (const target of targets) {
        // Read now that the app is held. One removed since it was read has no containers to apply, and
        // one the owner asked to remove, whose removal didn't finish, is removed, not started again.
        const current = (await this.db.select({ state: app.state, desired: app.desired }).from(app).where(eq(app.id, target.id)))[0];
        if (!current || current.state === "removed") continue;
        const kind = current.desired === "removed" ? "remove" : "apply";
        try {
          const { jobId, done } = await this.apps.startJob(target.id, kind, { held: true });
          await done;
          const job = await this.apps.job(jobId);
          if (job.state !== "succeeded") {
            failed.push({ appId: target.id, reason: `${target.title}: ${job.error ?? (kind === "remove" ? "it wasn't removed." : "it didn't start again.")}` });
          }
        } catch (error) {
          failed.push({ appId: target.id, reason: `${target.title}: ${error instanceof AppError ? error.message : "it couldn't be applied again."}` });
        }
      }
      // When nothing is deleted, an app that couldn't be applied or removed keeps its grant, and the others' are revoked.
      const keep = () =>
        this.db.transaction(async (tx) => {
          const back = taken.filter((g) => failed.some((f) => f.appId === g.appId));
          if (back.length) await tx.insert(appKnowledgeBase).values(back).onConflictDoNothing();
          for (const { appId } of taken.filter((g) => !back.includes(g))) await recordEvent(tx, "knowledge.revoked", actorId, null, appId, subject);
        });
      if (failed.length) {
        // Even when no container of theirs mounts it, so the knowledge base is kept as long as an app keeps it.
        await keep();
        throw new AppError(
          409,
          "apps_failed",
          `The knowledge base ${name} wasn't deleted, and keeps its files. These apps keep it, since they couldn't be applied again without it, or removed: ${failed.map((f) => f.reason).join(" ")}`,
        );
      }
      try {
        await this.apps.runtime.deleteKnowledge(name);
      } catch (error) {
        await keep();
        refused(error);
      }
      await this.db.transaction(async (tx) => {
        // Every grant ends with it, one given since it was read too.
        const left = await tx.select({ appId: appKnowledgeBase.appId }).from(appKnowledgeBase).where(eq(appKnowledgeBase.knowledgeBaseId, row.id));
        for (const appId of new Set([...taken.map((g) => g.appId), ...left.map((g) => g.appId)])) await recordEvent(tx, "knowledge.revoked", actorId, null, appId, subject);
        await recordEvent(tx, "knowledge.deleted", actorId, null, null, subject);
        await tx.delete(knowledgeBase).where(eq(knowledgeBase.id, row.id));
      });
      log("info", "knowledge.deleted", { name, apps: targets.length });
    } finally {
      release();
    }
  }
}
