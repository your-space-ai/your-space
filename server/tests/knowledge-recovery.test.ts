// Journey 014, slice 1 (owner decision 2026-11-26): taking a knowledge base from an app finishes once
// Your Space is back from a restart in the middle of it. Each check of the apps compares the knowledge
// bases a running app's containers mount, as the runtime manager reports them, with its grants, and
// applies again an app that mounts one it isn't given. Nothing new is saved for it.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { KnowledgeBases } from "../src/apps/knowledge.ts";
import type { ApplyEvent, AppSpec } from "../src/apps/runtime-client.ts";
import { AppsService } from "../src/apps/service.ts";
import { actor, app, appKnowledgeBase, event, eventKnowledgeBase, installJob, knowledgeBase } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { fakeGithub, FakeRuntime, kitLink, plainKit } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

const COMPOSE = "services:\n  web:\n    image: traefik/whoami:latest\n";

/** A runtime manager whose applies and removals can be cut off, as when Your Space stops while one runs: it never answers. */
class StoppingRuntime extends FakeRuntime {
  cutOff = false;
  override async apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void) {
    if (!this.cutOff) return super.apply(spec, onEvent);
    this.calls.push({ method: "apply", spec });
    return new Promise<void>(() => {});
  }
  override async down(project: string) {
    if (!this.cutOff) return super.down(project);
    this.calls.push({ method: "down", project });
    return new Promise<void>(() => {});
  }
}

const runtime = new StoppingRuntime();
const fetch = fakeGithub({
  "ys-fixtures/notes/compose.yaml": COMPOSE,
  "ys-fixtures/atlas/compose.yaml": COMPOSE,
  "ys-fixtures/vault/compose.yaml": COMPOSE,
  "ys-fixtures/relay/compose.yaml": COMPOSE,
  "ys-fixtures/ledger/compose.yaml": COMPOSE,
  ...plainKit("notes", "knowledge: {}\n"),
  ...plainKit("atlas", "knowledge: {}\n"),
  ...plainKit("vault", "knowledge: {}\n"),
  ...plainKit("relay", "knowledge: {}\n"),
  ...plainKit("ledger", "knowledge: {}\n"),
});
let t: TestDatabase;
let server: TestServer;
let cookie: string;
let owner: string;
let yourSpace: string;

beforeAll(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db, { apps: { runtime, fetch } });
  await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
  const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
  cookie = cookieHeader(signedIn);
  owner = (await t.db.select({ id: actor.id }).from(actor).where(eq(actor.kind, "human")))[0]!.id;
  yourSpace = (await t.db.select({ id: actor.id }).from(actor).where(eq(actor.kind, "operator")))[0]!.id;
});

afterEach(() => {
  runtime.cutOff = false;
  runtime.failApply = undefined;
  vi.useRealTimers();
});

afterAll(async () => {
  await server?.close();
  await t?.destroy();
});

const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
const send = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });
const appId = async (name: string) => (await t.db.select({ id: app.id }).from(app).where(eq(app.name, name)))[0]!.id;
const applies = (name: string) => runtime.calls.filter((c) => c.method === "apply" && c.spec?.project === `ys-${name}`);
const downs = (name: string) => runtime.calls.filter((c) => c.method === "down" && c.project === `ys-${name}`);
const grantsOf = async (name: string) =>
  (await t.db.select({ name: knowledgeBase.name }).from(appKnowledgeBase).innerJoin(knowledgeBase, eq(appKnowledgeBase.knowledgeBaseId, knowledgeBase.id)).where(eq(appKnowledgeBase.appId, await appId(name)))).map((g) => g.name);

async function waitForJob(jobId: string): Promise<{ state: string }> {
  for (let i = 0; i < 200; i++) {
    const [job] = await t.db.select({ state: installJob.state }).from(installJob).where(eq(installJob.id, jobId));
    if (job && job.state !== "running") return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("The job didn't finish.");
}

async function install(name: string, knowledge: string[]): Promise<void> {
  const preview = await send("/api/kits/preview", { kitUrl: kitLink(name) });
  const { previewId } = (await preview.json()) as { previewId: string };
  const installed = await send("/api/apps", { previewId, knowledge });
  expect(installed.status).toBe(202);
  expect((await waitForJob(((await installed.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
}

/** Waits until an apply of the app is cut off. */
async function untilCutOff(name: string, before: number): Promise<void> {
  for (let i = 0; i < 200 && applies(name).length === before; i++) await new Promise((r) => setTimeout(r, 10));
  expect(applies(name).length).toBe(before + 1);
}

/** Your Space started again on the same database and engine: it ends the jobs the stopped one left first. */
async function restart(): Promise<AppsService> {
  const apps = new AppsService(t.db, runtime, { publicUrl: server.publicUrl, dataKey: TEST_DATA_KEY, fetch, github: { api: "https://api.github.test", raw: "https://raw.github.test" } });
  await apps.recoverJobs();
  return apps;
}

/** Waits until no job of the app runs in this Your Space. */
async function settled(apps: AppsService, name: string): Promise<void> {
  const id = await appId(name);
  for (let i = 0; i < 200 && apps.isBusy(id); i++) await new Promise((r) => setTimeout(r, 10));
  expect(apps.isBusy(id)).toBe(false);
}

/** Who each `knowledge.revoked` event of the app is recorded against, by knowledge base. */
async function revoked(name: string) {
  return t.db
    .select({ actorId: event.actorId, knowledgeBase: eventKnowledgeBase.name })
    .from(event)
    .innerJoin(eventKnowledgeBase, eq(eventKnowledgeBase.eventId, event.id))
    .where(and(eq(event.type, "knowledge.revoked"), eq(event.subjectAppId, await appId(name))))
    .orderBy(asc(eventKnowledgeBase.name));
}

describe("taking a knowledge base away when Your Space restarts during it", () => {
  it("applies again, once Your Space is back, a running app that still mounts one taken from it on its page", async () => {
    for (const name of ["course-notes", "recipes"]) expect((await send("/api/knowledge", { name })).status).toBe(201);
    await install("notes", ["course-notes", "recipes"]);
    // The owner takes one away, and Your Space stops before the apply that unmounts it ends.
    runtime.cutOff = true;
    const before = applies("notes").length;
    const taken = await send("/api/apps/notes/knowledge", { bases: ["recipes"] }, "PUT");
    expect(taken.status).toBe(202);
    await untilCutOff("notes", before);
    runtime.cutOff = false;
    expect(await grantsOf("notes")).toEqual(["recipes"]);
    expect((await runtime.knowledgeUsers("course-notes")).apps).toEqual(["notes"]);

    const apps = await restart();
    expect((await t.db.select({ state: installJob.state }).from(installJob).where(eq(installJob.id, ((await taken.json()) as { jobId: string }).jobId)))[0]!.state).toBe("failed");
    await apps.reconcile();
    await settled(apps, "notes");
    expect(applies("notes").length).toBe(before + 2);
    expect(runtime.lastApply("ys-notes")!.knowledge).toEqual({ path: "/knowledge", bases: ["recipes"] });
    expect((await runtime.knowledgeUsers("course-notes")).apps).toEqual([]);
    expect((await runtime.knowledgeUsers("recipes")).apps).toEqual(["notes"]);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "notes")))[0]!.state).toBe("running");
    // Recorded against Your Space, which finished it.
    expect(await revoked("notes")).toEqual([{ actorId: yourSpace, knowledgeBase: "course-notes" }]);

    // Done once: the next checks find nothing to do.
    await apps.reconcile();
    await apps.reconcile();
    expect(applies("notes").length).toBe(before + 2);
  });

  it("applies again an app a deletion took it from, so deleting it again works", async () => {
    expect((await send("/api/knowledge", { name: "drafts" })).status).toBe(201);
    await install("vault", ["drafts"]);
    runtime.cutOff = true;
    const before = applies("vault").length;
    // The deletion waits on the apply, which Your Space never sees end.
    const deleting = new KnowledgeBases(server.apps!).delete("drafts", owner);
    deleting.catch(() => undefined);
    await untilCutOff("vault", before);
    runtime.cutOff = false;
    expect(await grantsOf("vault")).toEqual([]);
    expect((await runtime.knowledgeUsers("drafts")).apps).toEqual(["vault"]);

    const apps = await restart();
    await apps.reconcile();
    await settled(apps, "vault");
    expect(runtime.lastApply("ys-vault")!.knowledge).toEqual({ path: "/knowledge", bases: [] });
    expect((await runtime.knowledgeUsers("drafts")).apps).toEqual([]);
    // The knowledge base is still there, as the deletion didn't end, and deleting it now works.
    expect(runtime.knowledge.has("drafts")).toBe(true);
    await new KnowledgeBases(apps).delete("drafts", owner);
    expect(runtime.knowledge.has("drafts")).toBe(false);
    expect(await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "drafts"))).toEqual([]);
  });

  it("leaves a stopped app as it is, and starts it with its current grants", async () => {
    expect((await send("/api/knowledge", { name: "maps" })).status).toBe(201);
    await install("atlas", ["maps"]);
    runtime.cutOff = true;
    const before = applies("atlas").length;
    expect((await send("/api/apps/atlas/knowledge", { bases: [] }, "PUT")).status).toBe(202);
    await untilCutOff("atlas", before);
    runtime.cutOff = false;
    // Its containers stopped with Your Space, and still mount it.
    runtime.running.set("ys-atlas", [
      { name: "web", role: "app", state: "exited", exitCode: 0 },
      { name: "ys-egress", role: "egress", state: "exited", exitCode: 0 },
    ]);
    expect((await runtime.knowledgeUsers("maps")).apps).toEqual(["atlas"]);

    const apps = await restart();
    await apps.reconcile();
    await settled(apps, "atlas");
    expect(applies("atlas").length).toBe(before + 1);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "atlas")))[0]!.state).toBe("failed");

    // Started by the owner, it gets the knowledge bases it has now.
    const { jobId } = await apps.start("atlas");
    expect((await waitForJob(jobId)).state).toBe("succeeded");
    expect(runtime.lastApply("ys-atlas")!.knowledge).toEqual({ path: "/knowledge", bases: [] });
    expect((await runtime.knowledgeUsers("maps")).apps).toEqual([]);
  });

  it("tries an apply that didn't take it away again later, waiting longer each time, and never a busy app", async () => {
    const atlas = await appId("atlas");
    // The server's own service still holds the app whose change it never saw end.
    const apps = await restart();
    const { jobId } = await apps.updateKnowledge("atlas", ["maps"], owner);
    expect((await waitForJob(jobId)).state).toBe("succeeded");
    await settled(apps, "atlas");
    // As after a restart in the middle of taking it away: the containers mount it, and no grant says so.
    await t.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, atlas));
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();

    // Held by another change, it isn't applied.
    const release = apps.hold([atlas]);
    const before = applies("atlas").length;
    await apps.reconcile();
    release();
    expect(applies("atlas").length).toBe(before);

    runtime.failApply = "The engine stopped.";
    const tries: number[] = [];
    for (const minutes of [0, 0.5, 1, 2, 2.5, 3, 7]) {
      vi.setSystemTime(start + minutes * 60_000 + 1);
      const count = applies("atlas").length;
      await apps.reconcile();
      await settled(apps, "atlas");
      if (applies("atlas").length > count) tries.push(minutes);
    }
    // At once, then a minute later, then two minutes after that, then four. Nothing is recorded yet.
    expect(tries).toEqual([0, 1, 3, 7]);
    expect(await revoked("atlas")).toEqual([]);

    // Once an apply works, it no longer mounts it, and nothing is applied again.
    runtime.failApply = undefined;
    vi.setSystemTime(start + 16 * 60_000);
    await apps.reconcile();
    await settled(apps, "atlas");
    expect((await runtime.knowledgeUsers("maps")).apps).toEqual([]);
    expect(await revoked("atlas")).toEqual([{ actorId: yourSpace, knowledgeBase: "maps" }]);
    const done = applies("atlas").length;
    vi.setSystemTime(start + 120 * 60_000);
    await apps.reconcile();
    expect(applies("atlas").length).toBe(done);
  });

  it("applies nothing without the runtime manager's answer about the mounts", async () => {
    const notes = await appId("notes");
    await t.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, notes));
    const original = runtime.knowledgeUsers.bind(runtime);
    runtime.knowledgeUsers = async () => {
      throw new Error("The runtime manager didn't answer.");
    };
    try {
      const apps = await restart();
      const before = applies("notes").length;
      await apps.reconcile();
      expect(applies("notes").length).toBe(before);
    } finally {
      runtime.knowledgeUsers = original;
    }
  });
  it("removes, once Your Space is back, an app the owner asked to remove whose removal a deletion couldn't finish", async () => {
    expect((await send("/api/knowledge", { name: "letters" })).status).toBe(201);
    await install("relay", ["letters"]);
    // An earlier removal didn't finish: the owner asked for it, and its containers still run.
    await t.db.update(app).set({ desired: "removed", state: "failed", stateReason: "Removing it failed." }).where(eq(app.name, "relay"));
    runtime.cutOff = true;
    const before = downs("relay").length;
    // The deletion removes it instead of starting it again, and Your Space stops before that ends.
    const deleting = new KnowledgeBases(server.apps!).delete("letters", owner);
    deleting.catch(() => undefined);
    for (let i = 0; i < 200 && downs("relay").length === before; i++) await new Promise((r) => setTimeout(r, 10));
    expect(downs("relay").length).toBe(before + 1);
    runtime.cutOff = false;
    expect(await grantsOf("relay")).toEqual([]);
    expect((await runtime.knowledgeUsers("letters")).apps).toEqual(["relay"]);

    const apps = await restart();
    await apps.reconcile();
    await settled(apps, "relay");
    expect(downs("relay").length).toBe(before + 2);
    expect(applies("relay").length).toBe(1);
    expect((await runtime.knowledgeUsers("letters")).apps).toEqual([]);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "relay")))[0]!.state).toBe("removed");
    expect(await revoked("relay")).toEqual([{ actorId: yourSpace, knowledgeBase: "letters" }]);
  });

  it("records nothing for an apply that worked but left a container that mounts it, and applies it again after the wait", async () => {
    expect((await send("/api/knowledge", { name: "invoices" })).status).toBe(201);
    await install("ledger", ["invoices"]);
    // As after a restart in the middle of taking it away, with a container of the app's, which the
    // apply doesn't replace, still mounting it.
    await t.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, await appId("ledger")));
    const original = runtime.knowledgeUsers.bind(runtime);
    runtime.knowledgeUsers = async (name: string) => (name === "invoices" ? { apps: ["ledger"] } : original(name));
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    try {
      const apps = await restart();
      const before = applies("ledger").length;
      await apps.reconcile();
      await settled(apps, "ledger");
      expect(applies("ledger").length).toBe(before + 1);
      expect(runtime.lastApply("ys-ledger")!.knowledge).toEqual({ path: "/knowledge", bases: [] });
      expect(await revoked("ledger")).toEqual([]);
      vi.setSystemTime(start + 30_000);
      await apps.reconcile();
      expect(applies("ledger").length).toBe(before + 1);
      vi.setSystemTime(start + 61_000);
      await apps.reconcile();
      await settled(apps, "ledger");
      expect(applies("ledger").length).toBe(before + 2);
      expect(await revoked("ledger")).toEqual([]);
    } finally {
      runtime.knowledgeUsers = original;
    }
  });
});
