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

/**
 * A runtime manager whose applies and removals can be cut off, as when Your Space stops while one
 * runs: it never answers. An apply can also wait for `gate`, as a slow one does; `gated` counts the
 * applies that reached it, and `gateFails` fails one that waited before it reports anything.
 */
class StoppingRuntime extends FakeRuntime {
  cutOff = false;
  gate: Promise<void> | undefined;
  gated = 0;
  gateFails: string | undefined;
  override async apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void) {
    if (this.gate) {
      this.gated++;
      await this.gate;
      if (this.gateFails) {
        this.calls.push({ method: "apply", spec });
        throw new Error(this.gateFails);
      }
    }
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
  "ys-fixtures/scribe/compose.yaml": COMPOSE,
  "ys-fixtures/gallery/compose.yaml": COMPOSE,
  ...plainKit("notes", "knowledge: {}\n"),
  ...plainKit("atlas", "knowledge: {}\n"),
  ...plainKit("vault", "knowledge: {}\n"),
  ...plainKit("relay", "knowledge: {}\n"),
  ...plainKit("ledger", "knowledge: {}\n"),
  ...plainKit("scribe", "knowledge: {}\n"),
  ...plainKit("gallery", "knowledge: {}\n"),
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
  runtime.gate = undefined;
  runtime.gateFails = undefined;
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

/** Who each event of the type about the app is recorded against, by knowledge base. */
async function recorded(type: "knowledge.revoked" | "knowledge.granted", name: string) {
  return t.db
    .select({ actorId: event.actorId, knowledgeBase: eventKnowledgeBase.name })
    .from(event)
    .innerJoin(eventKnowledgeBase, eq(eventKnowledgeBase.eventId, event.id))
    .where(and(eq(event.type, type), eq(event.subjectAppId, await appId(name))))
    .orderBy(asc(eventKnowledgeBase.name));
}
const revoked = (name: string) => recorded("knowledge.revoked", name);
const granted = (name: string) => recorded("knowledge.granted", name);

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

  it("still takes one away when the runtime manager can't answer for another knowledge base", async () => {
    for (const name of ["sketches", "foreign"]) expect((await send("/api/knowledge", { name })).status).toBe(201);
    await install("scribe", ["sketches"]);
    // As after a restart in the middle of taking it away.
    await t.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, await appId("scribe")));
    const original = runtime.knowledgeUsers.bind(runtime);
    // As for a volume of that name Your Space didn't make, which the runtime manager refuses each time.
    runtime.knowledgeUsers = async (name: string) => {
      if (name === "foreign") throw new Error("A volume named ys-knowledge.test.foreign exists on the engine, but Your Space didn't make it, so it can't be a knowledge base.");
      return original(name);
    };
    try {
      const apps = await restart();
      const before = applies("scribe").length;
      await apps.reconcile();
      await settled(apps, "scribe");
      expect(applies("scribe").length).toBe(before + 1);
      expect(runtime.lastApply("ys-scribe")!.knowledge).toEqual({ path: "/knowledge", bases: [] });
      expect(await revoked("scribe")).toEqual([{ actorId: yourSpace, knowledgeBase: "sketches" }]);
    } finally {
      runtime.knowledgeUsers = original;
    }
  });

  it("waits the whole time after an apply that took longer than the wait", async () => {
    expect((await send("/api/knowledge", { name: "inks" })).status).toBe(201);
    const given = await send("/api/apps/scribe/knowledge", { bases: ["inks"] }, "PUT");
    expect((await waitForJob(((await given.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    const scribe = await appId("scribe");
    await t.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.appId, scribe));
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const apps = await restart();
    runtime.failApply = "The engine stopped.";
    let open = () => {};
    runtime.gate = new Promise((resolve) => (open = resolve));
    const before = applies("scribe").length;
    const gated = runtime.gated;
    await apps.reconcile();
    for (let i = 0; i < 200 && runtime.gated === gated; i++) await new Promise((r) => setTimeout(r, 10));
    expect(runtime.gated).toBe(gated + 1);
    // It takes five minutes, longer than the minute's wait, and fails.
    vi.setSystemTime(start + 5 * 60_000);
    open();
    await settled(apps, "scribe");
    runtime.gate = undefined;
    expect(applies("scribe").length).toBe(before + 1);
    await apps.reconcile();
    await settled(apps, "scribe");
    expect(applies("scribe").length).toBe(before + 1);
    // A minute after it ended, it is tried again.
    vi.setSystemTime(start + 6 * 60_000 + 1);
    await apps.reconcile();
    await settled(apps, "scribe");
    expect(applies("scribe").length).toBe(before + 2);
  });

  it("lets go of an app whose apply couldn't record its end, and the server goes on", async () => {
    const scribe = await appId("scribe");
    const apps = await restart();
    runtime.gateFails = "The engine stopped.";
    let open = () => {};
    runtime.gate = new Promise((resolve) => (open = resolve));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const gated = runtime.gated;
      await apps.reconcile();
      for (let i = 0; i < 200 && runtime.gated === gated; i++) await new Promise((r) => setTimeout(r, 10));
      expect(runtime.gated).toBe(gated + 1);
      // The database stops while the apply runs, so the failed job can't be recorded.
      await t.stop();
      open();
      for (let i = 0; i < 200 && apps.isBusy(scribe); i++) await new Promise((r) => setTimeout(r, 10));
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
      expect(apps.isBusy(scribe)).toBe(false);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await t.restore();
    }
  });

  it("leaves an app removed while the check of the apps read the mounts as removed", async () => {
    const scribe = await appId("scribe");
    // Its apply ends, and it is read as starting, so the check would record it as running.
    runtime.failApply = undefined;
    const { jobId } = await (await restart()).start("scribe");
    expect((await waitForJob(jobId)).state).toBe("succeeded");
    await t.db.update(app).set({ state: "starting" }).where(eq(app.id, scribe));
    const apps = await restart();
    const original = runtime.knowledgeUsers.bind(runtime);
    // Its removal ends while the check reads the mounts.
    runtime.knowledgeUsers = async (name: string) => {
      await t.db.update(app).set({ state: "removed", desired: "removed" }).where(eq(app.id, scribe));
      return original(name);
    };
    try {
      await apps.reconcile();
    } finally {
      runtime.knowledgeUsers = original;
    }
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.id, scribe)))[0]!.state).toBe("removed");
  });
});

describe("giving a knowledge base when Your Space restarts during it", () => {
  it("applies again, once Your Space is back, a running app that doesn't mount one given it on its page", async () => {
    for (const name of ["photos", "captions"]) expect((await send("/api/knowledge", { name })).status).toBe(201);
    await install("gallery", ["photos"]);
    // The owner gives it another, and Your Space stops before the apply that mounts it ends.
    runtime.cutOff = true;
    const before = applies("gallery").length;
    const given = await send("/api/apps/gallery/knowledge", { bases: ["captions", "photos"] }, "PUT");
    expect(given.status).toBe(202);
    await untilCutOff("gallery", before);
    runtime.cutOff = false;
    // Saved with the job, which never ended: the app's page lists it, its folder isn't there, and nothing records it as given.
    expect((await grantsOf("gallery")).sort()).toEqual(["captions", "photos"]);
    expect((await runtime.knowledgeUsers("captions")).apps).toEqual([]);
    expect(await granted("gallery")).toEqual([{ actorId: owner, knowledgeBase: "photos" }]);

    const apps = await restart();
    await apps.reconcile();
    await settled(apps, "gallery");
    expect(applies("gallery").length).toBe(before + 2);
    expect(runtime.lastApply("ys-gallery")!.knowledge).toEqual({ path: "/knowledge", bases: ["captions", "photos"] });
    expect((await runtime.knowledgeUsers("captions")).apps).toEqual(["gallery"]);
    // Recorded against the owner, who gave it.
    expect(await granted("gallery")).toEqual([
      { actorId: owner, knowledgeBase: "captions" },
      { actorId: owner, knowledgeBase: "photos" },
    ]);

    // Done once: the next checks find nothing to do.
    await apps.reconcile();
    await apps.reconcile();
    expect(applies("gallery").length).toBe(before + 2);
  });

  it("tries an apply that didn't mount it again later, waiting longer each time, and records its giving only once", async () => {
    expect((await send("/api/knowledge", { name: "albums" })).status).toBe(201);
    const apps = await restart();
    // The apply that gives it fails, and the runtime manager doesn't say what the app mounts: the
    // grant stays, recorded as given, without its folder.
    const original = runtime.knowledgeUsers.bind(runtime);
    runtime.failApply = "The engine stopped.";
    runtime.knowledgeUsers = async () => {
      throw new Error("The runtime manager didn't answer.");
    };
    try {
      const { jobId } = await apps.updateKnowledge("gallery", ["albums", "captions", "photos"], owner);
      expect((await waitForJob(jobId)).state).toBe("failed");
      await settled(apps, "gallery");
    } finally {
      runtime.knowledgeUsers = original;
    }
    expect((await grantsOf("gallery")).sort()).toEqual(["albums", "captions", "photos"]);
    expect((await runtime.knowledgeUsers("albums")).apps).toEqual([]);
    expect((await granted("gallery")).map((g) => g.knowledgeBase)).toEqual(["albums", "captions", "photos"]);

    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const tries: number[] = [];
    for (const minutes of [0, 0.5, 1, 2, 2.5, 3]) {
      vi.setSystemTime(start + minutes * 60_000 + 1);
      const count = applies("gallery").length;
      await apps.reconcile();
      await settled(apps, "gallery");
      if (applies("gallery").length > count) tries.push(minutes);
    }
    // At once, then a minute later, then two minutes after that.
    expect(tries).toEqual([0, 1, 3]);

    runtime.failApply = undefined;
    vi.setSystemTime(start + 8 * 60_000);
    await apps.reconcile();
    await settled(apps, "gallery");
    expect(runtime.lastApply("ys-gallery")!.knowledge).toEqual({ path: "/knowledge", bases: ["albums", "captions", "photos"] });
    expect((await runtime.knowledgeUsers("albums")).apps).toEqual(["gallery"]);
    expect((await granted("gallery")).map((g) => g.knowledgeBase)).toEqual(["albums", "captions", "photos"]);
  });
});
