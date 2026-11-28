// Journey 014, slice 1: local knowledge bases. The owner creates them and gives them to apps whose kits
// ask for knowledge; each change is recorded against the owner. Removing an app, or deleting its data,
// never deletes a knowledge base, and deleting one takes it away from its apps first.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { KitError, parseKit } from "../src/apps/kits.ts";
import { KnowledgeBases } from "../src/apps/knowledge.ts";
import { actor, app, appKnowledgeBase, event, eventKnowledgeBase, knowledgeBase } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import type { ApplyEvent, AppSpec } from "../src/apps/runtime-client.ts";
import { COMMIT, fakeGithub, FakeRuntime, kitLink, plainKit } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
`;
const SOURCE = `source: { repo: a/b, path: compose.yaml, commit: ${COMMIT} }`;

describe("a kit's knowledge", () => {
  const kit = (more: string, version = 1) => parseKit(`kit: ${version}\n${SOURCE}\ninterface: { service: web, port: 80 }\n${more}`);

  it("asks for knowledge bases at /knowledge, or at the kit's own normalised path", () => {
    expect(kit("knowledge: {}").knowledge).toEqual({ path: "/knowledge" });
    expect(kit("knowledge: { path: /vault }").knowledge).toEqual({ path: "/vault" });
    expect(kit("knowledge: { path: /data/vault/ }").knowledge).toEqual({ path: "/data/vault" });
    expect(kit("knowledge: { path: //data/./vault }").knowledge).toEqual({ path: "/data/vault" });
    // Both kit formats take it: a Your Space that doesn't know it refuses it as an unknown field.
    const agentAccess = "agentAccess: { credential: { binding: service, inject: { location: header, name: X-API-Key } }, roles: { read: { title: Read, routes: [list] } }, routes: { list: { method: GET, path: /items, effect: read } } }";
    expect(kit(`knowledge: {}\n${agentAccess}`, 2).knowledge).toEqual({ path: "/knowledge" });
    // A kit without the field asks for none.
    expect(kit("").knowledge).toBeUndefined();
  });

  it("refuses an unknown field, or a path that is relative, /, names .. or is a system folder", () => {
    for (const [field, message] of [
      ["knowledge: { path: /knowledge, readOnly: true }", /unknown field readOnly/],
      ["knowledge: { path: knowledge }", /absolute/],
      ["knowledge: { path: / }", /can't be \//],
      ["knowledge: { path: /./ }", /can't be \//],
      ["knowledge: { path: /data/../etc }", /\.\./],
      ["knowledge: { path: /.. }", /\.\./],
      ["knowledge: { path: /proc/notes }", /system folder/],
      ["knowledge: { path: /dev }", /system folder/],
      ["knowledge: { path: /etc/resolv.conf }", /in \/etc\/resolv\.conf, a system folder or file/],
      ["knowledge: { path: /etc/hosts/notes }", /in \/etc\/hosts, a system folder or file/],
      ["knowledge: { path: /etc/hostname }", /system folder or file/],
      ["knowledge: { path: '/my notes' }", /folder names/],
      ["knowledge: { path: /.hidden }", /folder names/],
      ["knowledge: { path: /-vault }", /starting with a letter, digit or underscore/],
      ["knowledge: { path: /a/b/c/d/e/f/g/h/i }", /at most 8 folder names deep/],
      [`knowledge: { path: /${"a".repeat(65)} }`, /each 1 to 64/],
      ["knowledge: { path: 7 }", /absolute/],
      ["knowledge: true", /mapping/],
      ["knowledge:", /mapping/],
    ] as const) {
      expect(() => kit(field), field).toThrow(KitError);
      expect(() => kit(field), field).toThrow(message);
    }
  });

  it("needs an interface, where the knowledge bases are mounted", () => {
    expect(() => parseKit(`kit: 1\n${SOURCE}\nknowledge: {}\n`)).toThrow(/needs an interface/);
  });
});

/** Holds each apply while `hold` is on, until released, so a test can catch an app while it's busy. */
class HeldRuntime extends FakeRuntime {
  hold = false;
  private waiting: (() => void)[] = [];
  override async apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void) {
    if (this.hold) await new Promise<void>((resolve) => this.waiting.push(resolve));
    return super.apply(spec, onEvent);
  }
  /** Lets every apply that waits go on. */
  release(): void {
    for (const resolve of this.waiting.splice(0)) resolve();
  }
  /** Waits until an apply waits. */
  async untilHeld(): Promise<void> {
    for (let i = 0; i < 200 && this.waiting.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    if (this.waiting.length === 0) throw new Error("No apply is waiting.");
  }
}

const runtime = new HeldRuntime();
let t: TestDatabase;
let server: TestServer;
let cookie: string;
let owner: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const fetch = fakeGithub({
    "ys-fixtures/notes/compose.yaml": COMPOSE,
    "ys-fixtures/vault/compose.yaml": COMPOSE,
    "ys-fixtures/plain/compose.yaml": COMPOSE,
    "ys-fixtures/atlas/compose.yaml": COMPOSE,
    "ys-fixtures/twice/compose.yaml": COMPOSE,
    "ys-fixtures/etc/compose.yaml": COMPOSE,
    ...plainKit("notes", "knowledge: {}\n"),
    ...plainKit("atlas", "knowledge: {}\n"),
    ...plainKit("vault", "knowledge: { path: /vault/ }\n"),
    ...plainKit("plain"),
    ...plainKit("twice"),
    ...plainKit("etc", "knowledge: { path: /etc }\n"),
  });
  server = await startServer(t.db, { apps: { runtime, fetch } });
  await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
  const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
  cookie = cookieHeader(signedIn);
  owner = (await t.db.select({ id: actor.id }).from(actor).where(eq(actor.kind, "human")))[0]!.id;
});

afterAll(async () => {
  await server?.close();
  await t?.destroy();
});

const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
const send = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });

async function waitForJob(jobId: string): Promise<{ state: string; error: string | null }> {
  for (let i = 0; i < 100; i++) {
    const job = (await (await api(`/api/jobs/${jobId}`)).json()) as { state: string; error: string | null };
    if (job.state !== "running") return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("The job didn't finish.");
}

async function review(name: string) {
  const response = await send("/api/kits/preview", { kitUrl: kitLink(name) });
  expect(response.status).toBe(200);
  return (await response.json()) as { previewId: string; knowledge: { path: string } | null };
}

/** Installs the app, reusing the data kept from an earlier install of it. */
async function install(name: string, knowledge?: unknown): Promise<Response> {
  const { previewId } = await review(name);
  const response = await send("/api/apps", { previewId, reuseData: true, ...(knowledge === undefined ? {} : { knowledge }) });
  if (response.status === 202) expect((await waitForJob(((await response.clone().json()) as { jobId: string }).jobId)).state).toBe("succeeded");
  return response;
}

/**
 * The knowledge base of each event of a type, by the name the event keeps, with who it is recorded
 * against, in the order of the knowledge bases' names.
 */
async function events(type: string) {
  return t.db
    .select({ actorId: event.actorId, subjectAppId: event.subjectAppId, knowledgeBase: eventKnowledgeBase.name })
    .from(event)
    .leftJoin(eventKnowledgeBase, eq(eventKnowledgeBase.eventId, event.id))
    .where(eq(event.type, type))
    .orderBy(asc(eventKnowledgeBase.name));
}

/** Holds every apply while `during` runs, then lets them go, even when an assertion in it fails. */
async function holdingApplies(during: () => Promise<void>): Promise<void> {
  runtime.hold = true;
  try {
    await during();
  } finally {
    runtime.hold = false;
    runtime.release();
  }
}

const knowledgeId = async (name: string) => (await t.db.select({ id: knowledgeBase.id }).from(knowledgeBase).where(eq(knowledgeBase.name, name)))[0]!.id;
const grantsOf = async (name: string) =>
  (await t.db.select({ name: knowledgeBase.name }).from(appKnowledgeBase).innerJoin(knowledgeBase, eq(appKnowledgeBase.knowledgeBaseId, knowledgeBase.id)).where(eq(appKnowledgeBase.appId, await appId(name))))
    .map((g) => g.name)
    .sort();

const appId = async (name: string) => (await t.db.select({ id: app.id }).from(app).where(eq(app.name, name)))[0]!.id;
const lastApply = (name: string) => runtime.lastApply(`ys-${name}`)!;

describe("the knowledge API", () => {
  it("refuses everyone but the signed-in owner, and changes nothing", async () => {
    const calls = runtime.calls.length;
    for (const [method, path] of [
      ["GET", "/api/knowledge"],
      ["POST", "/api/knowledge"],
      ["PATCH", "/api/knowledge/notes"],
      ["DELETE", "/api/knowledge/notes"],
      ["PUT", "/api/apps/notes/knowledge"],
    ] as const) {
      const response = await server.request(path, { method, body: method === "GET" ? undefined : JSON.stringify({ name: "notes", title: "x", bases: [] }) });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(runtime.calls.length).toBe(calls);
    expect(await t.db.select().from(knowledgeBase)).toEqual([]);
  });

  it("changes knowledge bases only from Your Space's own pages, not from an app's", async () => {
    const host = new URL(server.publicUrl).host;
    for (const origin of [`http://notes.${host}`, "null", "https://elsewhere.example"]) {
      for (const [method, path] of [["POST", "/api/knowledge"], ["PATCH", "/api/knowledge/notes"], ["DELETE", "/api/knowledge/notes"], ["PUT", "/api/apps/notes/knowledge"]] as const) {
        const response = await api(path, { method, headers: { origin }, body: JSON.stringify({ name: "notes", title: "x", bases: [] }) });
        expect(response.status, `${method} ${path} from ${origin}`).toBe(403);
      }
    }
    expect(runtime.knowledge.size).toBe(0);
    expect(await t.db.select().from(knowledgeBase)).toEqual([]);
  });
});

describe("knowledge bases", () => {
  it("are created with a fixed name and a title, recorded against the owner", async () => {
    const created = await send("/api/knowledge", { name: "course-notes", title: "Course notes" });
    expect(created.status).toBe(201);
    // Names only: the API never answers with a knowledge base's internal ID.
    expect(await created.json()).toEqual({ name: "course-notes", title: "Course notes" });
    // Without a title, the name is its title.
    expect((await send("/api/knowledge", { name: "recipes" })).status).toBe(201);
    expect([...runtime.knowledge].sort()).toEqual(["course-notes", "recipes"]);
    expect(await events("knowledge.created")).toEqual([
      { actorId: owner, subjectAppId: null, knowledgeBase: "course-notes" },
      { actorId: owner, subjectAppId: null, knowledgeBase: "recipes" },
    ]);
    const list = (await (await api("/api/knowledge")).json()) as { knowledgeBases: unknown[] };
    expect(list.knowledgeBases).toEqual([
      expect.objectContaining({ name: "course-notes", title: "Course notes", apps: [] }),
      expect.objectContaining({ name: "recipes", title: "recipes", apps: [] }),
    ]);
  });

  it("refuses a name that isn't a folder's, or one that exists, before making anything", async () => {
    const calls = runtime.calls.filter((c) => c.method === "createKnowledge").length;
    for (const name of ["Course", "-notes", "notes-", "a/b", "..", "", "a".repeat(41), 7]) {
      const response = await send("/api/knowledge", { name });
      expect(response.status, JSON.stringify(name)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("bad_name");
    }
    const taken = await send("/api/knowledge", { name: "recipes" });
    expect(taken.status).toBe(409);
    for (const title of [" ", "x".repeat(81), 7]) {
      const response = await send("/api/knowledge", { name: "x", title });
      expect(response.status, JSON.stringify(title)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("bad_title");
    }
    expect(runtime.calls.filter((c) => c.method === "createKnowledge").length).toBe(calls);
  });

  it("change their title, never their name", async () => {
    const response = await send("/api/knowledge/recipes", { title: "Family recipes", name: "soups" }, "PATCH");
    expect(response.status).toBe(200);
    const [row] = await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "recipes"));
    expect(row).toMatchObject({ name: "recipes", title: "Family recipes" });
    expect(await events("knowledge.retitled")).toEqual([{ actorId: owner, subjectAppId: null, knowledgeBase: "recipes" }]);
    expect((await send("/api/knowledge/nope", { title: "x" }, "PATCH")).status).toBe(404);
    for (const title of [undefined, "", "x".repeat(81)]) {
      const response = await send("/api/knowledge/recipes", { title }, "PATCH");
      expect(response.status, JSON.stringify(title)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("bad_title");
    }
  });
});

describe("giving knowledge bases to apps", () => {
  it("reviews a kit that asks for knowledge with its path, and checks the file with it", async () => {
    expect((await review("notes")).knowledge).toEqual({ path: "/knowledge" });
    expect(runtime.calls.filter((c) => c.method === "check").at(-1)!.spec!.knowledge).toEqual({ path: "/knowledge", bases: [] });
    expect((await review("vault")).knowledge).toEqual({ path: "/vault" });
    expect((await review("plain")).knowledge).toBeNull();
    expect(runtime.calls.filter((c) => c.method === "check").at(-1)!.spec!.knowledge).toBeNull();
  });

  it("installs an app with the knowledge bases the owner picks, mounted at its path", async () => {
    expect((await install("notes", ["course-notes"])).status).toBe(202);
    expect(lastApply("notes").knowledge).toEqual({ path: "/knowledge", bases: ["course-notes"] });
    expect((await install("vault", ["recipes", "course-notes"])).status).toBe(202);
    expect(lastApply("vault").knowledge).toEqual({ path: "/vault", bases: ["course-notes", "recipes"] });
    expect(await events("knowledge.granted")).toEqual(
      expect.arrayContaining([
        { actorId: owner, subjectAppId: await appId("notes"), knowledgeBase: "course-notes" },
        { actorId: owner, subjectAppId: await appId("vault"), knowledgeBase: "course-notes" },
        { actorId: owner, subjectAppId: await appId("vault"), knowledgeBase: "recipes" },
      ]),
    );
    const detail = (await (await api("/api/apps/vault")).json()) as { knowledge: unknown };
    expect(detail.knowledge).toEqual({ path: "/vault", bases: [{ name: "course-notes", title: "Course notes" }, { name: "recipes", title: "Family recipes" }] });
    const list = (await (await api("/api/knowledge")).json()) as { knowledgeBases: { name: string; apps: { name: string }[] }[] };
    expect(list.knowledgeBases.find((k) => k.name === "course-notes")!.apps.map((a) => a.name).sort()).toEqual(["notes", "vault"]);
  });

  it("gives none to an app whose kit doesn't ask for knowledge, and refuses ones that don't exist", async () => {
    const { previewId } = await review("plain");
    const refused = await send("/api/apps", { previewId, knowledge: ["recipes"] });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("no_knowledge");
    const unknown = await send("/api/apps", { previewId: (await review("plain")).previewId, knowledge: "recipes" });
    expect(unknown.status).toBe(400);
    expect((await install("plain")).status).toBe(202);
    expect(lastApply("plain").knowledge).toBeNull();
    expect(((await (await api("/api/apps/plain")).json()) as { knowledge: unknown }).knowledge).toBeNull();
    const editor = await send("/api/apps/plain/knowledge", { bases: [] }, "PUT");
    expect(editor.status).toBe(400);
    expect(((await editor.json()) as { error: string }).error).toBe("no_knowledge");
    const missing = await send("/api/apps/notes/knowledge", { bases: ["nope"] }, "PUT");
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("unknown_knowledge_base");
    expect(await t.db.select().from(appKnowledgeBase).where(eq(appKnowledgeBase.appId, await appId("plain")))).toEqual([]);
  });

  it("changes an app's knowledge bases on its page, which applies it again", async () => {
    const added = await send("/api/apps/notes/knowledge", { bases: ["course-notes", "recipes"] }, "PUT");
    expect(added.status).toBe(202);
    expect((await waitForJob(((await added.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply("notes").knowledge).toEqual({ path: "/knowledge", bases: ["course-notes", "recipes"] });
    const removed = await send("/api/apps/notes/knowledge", { bases: ["recipes"] }, "PUT");
    await waitForJob(((await removed.json()) as { jobId: string }).jobId);
    expect(lastApply("notes").knowledge).toEqual({ path: "/knowledge", bases: ["recipes"] });
    expect(await events("knowledge.revoked")).toEqual([{ actorId: owner, subjectAppId: await appId("notes"), knowledgeBase: "course-notes" }]);
  });

  it("keeps a knowledge base taken away when the apply that would unmount it fails", async () => {
    const revoked = (await events("knowledge.revoked")).length;
    runtime.failApply = "The engine stopped.";
    const taken = await send("/api/apps/notes/knowledge", { bases: [] }, "PUT");
    expect(taken.status).toBe(202);
    const job = await waitForJob(((await taken.json()) as { jobId: string }).jobId);
    runtime.failApply = undefined;
    expect(job.state).toBe("failed");
    // Its containers still mount it, so it keeps its grant, and nothing records it as taken away.
    const detail = (await (await api("/api/apps/notes")).json()) as { knowledge: { bases: { name: string }[] } };
    expect(detail.knowledge.bases.map((base) => base.name)).toEqual(["recipes"]);
    expect((await events("knowledge.revoked")).length).toBe(revoked);
    // Replaced, it keeps what its containers mount: the one taken away, and not the one added, so a
    // failed change never leaves it more than it can mount.
    const granted = (await events("knowledge.granted")).length;
    runtime.failApply = "The engine stopped.";
    const replaced = await send("/api/apps/notes/knowledge", { bases: ["course-notes"] }, "PUT");
    expect((await waitForJob(((await replaced.json()) as { jobId: string }).jobId)).state).toBe("failed");
    runtime.failApply = undefined;
    const kept = (await (await api("/api/apps/notes")).json()) as { knowledge: { bases: { name: string }[] } };
    expect(kept.knowledge.bases.map((base) => base.name)).toEqual(["recipes"]);
    expect((await events("knowledge.granted")).length).toBe(granted);
    expect((await events("knowledge.revoked")).length).toBe(revoked);
    // Applied again as it is, it starts with it.
    const again = await send("/api/apps/notes/knowledge", { bases: ["recipes"] }, "PUT");
    expect((await waitForJob(((await again.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply("notes").knowledge).toEqual({ path: "/knowledge", bases: ["recipes"] });
  });

  it("refuses a knowledge base whose folder in the app would be one of the files Docker mounts", async () => {
    // Refused by its name and the kit's path alone, before the knowledge base is looked for.
    const { previewId } = await review("etc");
    const refused = await send("/api/apps", { previewId, knowledge: ["hosts"] });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string; message: string })).toMatchObject({ error: "reserved_knowledge_path", message: expect.stringContaining("/etc/hosts") });
  });

  it("installs from a review once, even when two requests read it before either used it", async () => {
    const { previewId } = await review("twice");
    const [first, second] = await Promise.allSettled([server.apps!.install(previewId, {}, false, owner), server.apps!.install(previewId, {}, false, owner)]);
    expect(second).toMatchObject({ status: "rejected", reason: { code: "preview_expired" } });
    expect(first.status).toBe("fulfilled");
    if (first.status === "fulfilled") await first.value.done;
    expect((await t.db.select().from(app).where(eq(app.name, "twice")))[0]).toMatchObject({ state: "running" });
  });
});

describe("removing an app and deleting its data", () => {
  it("never deletes a knowledge base", async () => {
    const notes = await appId("notes");
    expect(await grantsOf("notes")).toEqual(["recipes"]);
    const fromNotes = async () => (await events("knowledge.revoked")).filter((e) => e.subjectAppId === notes && e.knowledgeBase === "recipes");
    expect(await fromNotes()).toEqual([]);
    const removed = await send("/api/apps/notes/remove", {});
    await waitForJob(((await removed.json()) as { jobId: string }).jobId);
    // A removed app uses no knowledge base, and installing it again starts with the owner's picks.
    expect(await t.db.select().from(appKnowledgeBase).where(eq(appKnowledgeBase.appId, notes))).toEqual([]);
    // Each it had is recorded as taken away, against the owner who removed it, so its grant ends in the knowledge base's history.
    expect(await fromNotes()).toEqual([{ actorId: owner, subjectAppId: notes, knowledgeBase: "recipes" }]);
    expect((await api("/api/apps/notes/data", { method: "DELETE", body: JSON.stringify({ confirm: "notes" }) })).status).toBe(204);
    expect(runtime.calls.some((c) => c.method === "deleteKnowledge")).toBe(false);
    expect([...runtime.knowledge].sort()).toEqual(["course-notes", "recipes"]);
    expect((await t.db.select({ name: knowledgeBase.name }).from(knowledgeBase)).map((k) => k.name).sort()).toEqual(["course-notes", "recipes"]);
  });
});

describe("deleting a knowledge base", () => {
  it("takes it away from its apps and applies them again before deleting its storage", async () => {
    const calls = runtime.calls.length;
    const deleted = await api("/api/knowledge/recipes", { method: "DELETE" });
    expect(deleted.status).toBe(204);
    const after = runtime.calls.slice(calls);
    const apply = after.findIndex((c) => c.method === "apply" && c.spec?.project === "ys-vault");
    expect(apply).toBeGreaterThanOrEqual(0);
    expect(after[apply]!.spec!.knowledge).toEqual({ path: "/vault", bases: ["course-notes"] });
    expect(after.findIndex((c) => c.method === "deleteKnowledge" && c.project === "recipes")).toBeGreaterThan(apply);
    expect(runtime.knowledge.has("recipes")).toBe(false);
    expect(await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "recipes"))).toEqual([]);
    // Recorded against the owner. Each event keeps the knowledge base's name, so the record outlives it.
    const vault = await appId("vault");
    expect((await events("knowledge.revoked")).filter((e) => e.subjectAppId === vault)).toEqual([{ actorId: owner, subjectAppId: vault, knowledgeBase: "recipes" }]);
    expect(await events("knowledge.deleted")).toEqual([{ actorId: owner, subjectAppId: null, knowledgeBase: "recipes" }]);
    const history = await t.db
      .select({ type: event.type, actorId: event.actorId, knowledgeBaseId: eventKnowledgeBase.knowledgeBaseId })
      .from(eventKnowledgeBase)
      .innerJoin(event, eq(event.id, eventKnowledgeBase.eventId))
      .where(eq(eventKnowledgeBase.name, "recipes"));
    // Given to two apps, and taken from each: from notes when it was removed, and from vault now.
    expect(history.map((e) => e.type).sort()).toEqual(["knowledge.created", "knowledge.deleted", "knowledge.granted", "knowledge.granted", "knowledge.retitled", "knowledge.revoked", "knowledge.revoked"]);
    for (const e of history) expect(e).toMatchObject({ actorId: owner, knowledgeBaseId: null });
  });

  it("is kept, with the apps that couldn't be applied without it, until they can", async () => {
    runtime.failApply = "The engine stopped.";
    const refused = await api("/api/knowledge/course-notes", { method: "DELETE" });
    runtime.failApply = undefined;
    expect(refused.status).toBe(409);
    const { error, message } = (await refused.json()) as { error: string; message: string };
    expect(error).toBe("apps_failed");
    expect(message).toMatch(/The knowledge base course-notes wasn't deleted/);
    expect(message).toMatch(/These apps keep it, since they couldn't be applied again without it, or removed: vault: /);
    expect(runtime.knowledge.has("course-notes")).toBe(true);
    expect(await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "course-notes"))).toHaveLength(1);
    // The app still mounts it, so it keeps it, and the knowledge base still lists it.
    expect(await t.db.select().from(appKnowledgeBase).where(and(eq(appKnowledgeBase.appId, await appId("vault"))))).toHaveLength(1);
    const list = (await (await api("/api/knowledge")).json()) as { knowledgeBases: { name: string; apps: { name: string }[] }[] };
    expect(list.knowledgeBases.find((k) => k.name === "course-notes")!.apps.map((a) => a.name)).toEqual(["vault"]);

    // Once the app can be applied again, deleting it again takes it from the app and deletes it.
    expect((await api("/api/knowledge/course-notes", { method: "DELETE" })).status).toBe(204);
    expect(runtime.knowledge.size).toBe(0);
    expect(lastApply("vault").knowledge).toEqual({ path: "/vault", bases: [] });
    expect(await t.db.select().from(knowledgeBase)).toEqual([]);
  });
});

describe("deleting a knowledge base when its apps and their grants disagree", () => {
  it("applies again an app whose containers still mount it without a grant", async () => {
    expect((await send("/api/knowledge", { name: "drafts" })).status).toBe(201);
    const given = await send("/api/apps/vault/knowledge", { bases: ["drafts"] }, "PUT");
    expect((await waitForJob(((await given.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply("vault").knowledge!.bases).toEqual(["drafts"]);
    // As after a restart in the middle of an earlier delete, or a change that took the grant but
    // couldn't be applied: the container mounts it, and no grant says so.
    await t.db.delete(appKnowledgeBase).where(eq(appKnowledgeBase.knowledgeBaseId, await knowledgeId("drafts")));
    const list = (await (await api("/api/knowledge")).json()) as { knowledgeBases: { name: string; apps: unknown[] }[] };
    expect(list.knowledgeBases.find((k) => k.name === "drafts")!.apps).toEqual([]);

    const calls = runtime.calls.length;
    expect((await api("/api/knowledge/drafts", { method: "DELETE" })).status).toBe(204);
    const after = runtime.calls.slice(calls);
    expect(after.map((c) => c.method)).toEqual(["knowledgeUsers", "apply", "deleteKnowledge"]);
    expect(lastApply("vault").knowledge).toEqual({ path: "/vault", bases: [] });
    expect(runtime.knowledge.has("drafts")).toBe(false);
    expect(await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "drafts"))).toEqual([]);
  });

  it("removes an app the owner asked to remove, whose removal didn't finish, rather than start it again", async () => {
    expect((await send("/api/knowledge", { name: "inbox" })).status).toBe(201);
    expect((await install("notes", ["inbox"])).status).toBe(202);
    // A removal that failed: the app is failed, should be removed, and keeps its grants.
    await t.db.update(app).set({ state: "failed", desired: "removed", stateReason: "The engine stopped." }).where(eq(app.name, "notes"));
    expect(await grantsOf("notes")).toEqual(["inbox"]);

    const calls = runtime.calls.length;
    expect((await api("/api/knowledge/inbox", { method: "DELETE" })).status).toBe(204);
    const after = runtime.calls.slice(calls);
    expect(after.some((c) => c.method === "apply" && c.spec?.project === "ys-notes")).toBe(false);
    expect(after.filter((c) => c.method === "down").map((c) => c.project)).toEqual(["ys-notes"]);
    expect(runtime.running.has("ys-notes")).toBe(false);
    expect((await t.db.select({ state: app.state, desired: app.desired }).from(app).where(eq(app.name, "notes")))[0]).toEqual({ state: "removed", desired: "removed" });
    expect(runtime.knowledge.has("inbox")).toBe(false);
  });

  it("starts a stopped app that mounts it without it, as the engine keeps a volume a stopped container mounts", async () => {
    expect((await send("/api/knowledge", { name: "shelf" })).status).toBe(201);
    const given = await send("/api/apps/vault/knowledge", { bases: ["shelf"] }, "PUT");
    expect((await waitForJob(((await given.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    // Its containers stopped, and still mount it.
    runtime.running.set("ys-vault", [
      { name: "web", role: "app", state: "exited", exitCode: 1 },
      { name: "ys-egress", role: "egress", state: "exited", exitCode: 0 },
    ]);
    await t.db.update(app).set({ state: "failed", stateReason: "web stopped (exit code 1)." }).where(eq(app.name, "vault"));

    const calls = runtime.calls.length;
    expect((await api("/api/knowledge/shelf", { method: "DELETE" })).status).toBe(204);
    const after = runtime.calls.slice(calls);
    expect(after.map((c) => c.method)).toEqual(["knowledgeUsers", "apply", "deleteKnowledge"]);
    expect(lastApply("vault").knowledge).toEqual({ path: "/vault", bases: [] });
    expect(runtime.running.get("ys-vault")!.every((s) => s.state === "running")).toBe(true);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "vault")))[0]!.state).toBe("running");
    expect(runtime.knowledge.has("shelf")).toBe(false);
  });

  it("saves only the change whose job starts, when two arrive for an app at once", async () => {
    expect((await send("/api/knowledge", { name: "soon" })).status).toBe(201);
    expect((await send("/api/knowledge", { name: "later" })).status).toBe(201);
    let answers: Response[] = [];
    let won = 0;
    await holdingApplies(async () => {
      answers = await Promise.all([send("/api/apps/vault/knowledge", { bases: ["soon"] }, "PUT"), send("/api/apps/vault/knowledge", { bases: ["later"] }, "PUT")]);
      expect(answers.map((a) => a.status).sort()).toEqual([202, 409]);
      won = answers[0]!.status === 202 ? 0 : 1;
      // The refused change saved nothing: the grants are the ones the job under way applies.
      expect(await grantsOf("vault")).toEqual([["soon"], ["later"]][won]);
    });
    expect((await waitForJob(((await answers[won]!.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply("vault").knowledge!.bases).toEqual([["soon"], ["later"]][won]);
    const cleared = await send("/api/apps/vault/knowledge", { bases: [] }, "PUT");
    await waitForJob(((await cleared.json()) as { jobId: string }).jobId);
    expect((await api("/api/knowledge/soon", { method: "DELETE" })).status).toBe(204);
  });

  it("changes nothing while an app that has it is busy, on the app's page or the Knowledge page", async () => {
    let first: Response | undefined;
    await holdingApplies(async () => {
      first = await send("/api/apps/vault/knowledge", { bases: ["later"] }, "PUT");
      expect(first.status).toBe(202);
      const second = await send("/api/apps/vault/knowledge", { bases: [] }, "PUT");
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: string }).error).toBe("busy");
      // The first change's grant is kept, so it matches the apply under way.
      expect(await grantsOf("vault")).toEqual(["later"]);

      const deletes = runtime.calls.filter((c) => c.method === "deleteKnowledge").length;
      const refused = await api("/api/knowledge/later", { method: "DELETE" });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toBe("busy");
      expect(await grantsOf("vault")).toEqual(["later"]);
      expect(runtime.calls.filter((c) => c.method === "deleteKnowledge").length).toBe(deletes);
    });
    expect((await waitForJob(((await first!.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect((await api("/api/knowledge/later", { method: "DELETE" })).status).toBe(204);
    expect(await grantsOf("vault")).toEqual([]);
  });
});

describe("deleting a knowledge base while the owner changes its apps", () => {
  const jobOf = async (response: Response) => ((await response.json()) as { jobId: string }).jobId;

  it("keeps it, and the grant of an app that couldn't be applied, even when no container of the app mounts it", async () => {
    expect((await send("/api/knowledge", { name: "unmounted" })).status).toBe(201);
    // As after an install whose apply failed: vault has the grant, and no container of vault's mounts
    // it. (A change on the app's page whose apply fails takes back the grants it added.)
    const [unmounted] = await t.db.select({ id: knowledgeBase.id }).from(knowledgeBase).where(eq(knowledgeBase.name, "unmounted"));
    await t.db.insert(appKnowledgeBase).values({ appId: await appId("vault"), knowledgeBaseId: unmounted!.id, grantedBy: owner });
    runtime.failApply = "The engine stopped.";
    try {
      expect(runtime.lastApply("ys-vault")!.knowledge!.bases).toEqual([]);
      const refused = await api("/api/knowledge/unmounted", { method: "DELETE" });
      expect(refused.status).toBe(409);
      const { error, message } = (await refused.json()) as { error: string; message: string };
      expect(error).toBe("apps_failed");
      expect(message).toMatch(/These apps keep it, since they couldn't be applied again without it, or removed: vault: /);
    } finally {
      runtime.failApply = undefined;
    }
    // Nothing was deleted: the storage, its record and vault's grant are all kept.
    expect(runtime.calls.some((c) => c.method === "deleteKnowledge" && c.project === "unmounted")).toBe(false);
    expect(runtime.knowledge.has("unmounted")).toBe(true);
    expect(await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "unmounted"))).toHaveLength(1);
    expect(await grantsOf("vault")).toEqual(["unmounted"]);

    // Once vault can be applied again, the delete goes through.
    expect((await api("/api/knowledge/unmounted", { method: "DELETE" })).status).toBe(204);
    expect(await grantsOf("vault")).toEqual([]);
    expect(runtime.knowledge.has("unmounted")).toBe(false);
  });

  it("holds each app it applies again until it ends, so the owner's changes to them meanwhile are refused", async () => {
    expect((await send("/api/knowledge", { name: "shared" })).status).toBe(201);
    expect((await install("atlas", ["shared"])).status).toBe(202);
    expect((await waitForJob(await jobOf(await send("/api/apps/vault/knowledge", { bases: ["shared"] }, "PUT")))).state).toBe("succeeded");
    const ofType = (type: string) => t.db.select().from(event).where(eq(event.type, type));
    const removals = (await ofType("app.removed")).length;

    let deleting: Promise<Response> | undefined;
    await holdingApplies(async () => {
      deleting = api("/api/knowledge/shared", { method: "DELETE" });
      // atlas is applied again first, and waits there; vault is next.
      await runtime.untilHeld();
      const change = await send("/api/apps/vault/knowledge", { bases: [] }, "PUT");
      expect(change.status).toBe(409);
      expect(((await change.json()) as { error: string }).error).toBe("busy");
      const removal = await send("/api/apps/vault/remove", {});
      expect(removal.status).toBe(409);
      expect(((await removal.json()) as { error: string }).error).toBe("busy");
    });
    expect((await deleting!).status).toBe(204);
    // Neither refused change did anything: vault still runs, applied again without the knowledge base.
    expect((await t.db.select({ state: app.state, desired: app.desired }).from(app).where(eq(app.name, "vault")))[0]).toEqual({ state: "running", desired: "running" });
    expect(lastApply("vault").knowledge).toEqual({ path: "/vault", bases: [] });
    expect(lastApply("atlas").knowledge).toEqual({ path: "/knowledge", bases: [] });
    expect((await ofType("app.removed")).length).toBe(removals);
    expect(runtime.knowledge.has("shared")).toBe(false);
  });

  it("records a removal only once its job holds the app, so one refused as busy changes nothing", async () => {
    // Another change takes vault right after the removal finds it free, as deleting a knowledge base can.
    const apps = server.apps! as unknown as { liveRow: (name: string) => Promise<{ id: string }> };
    const liveRow = apps.liveRow.bind(apps);
    let other: { done: Promise<void> } | undefined;
    await holdingApplies(async () => {
      apps.liveRow = async (name) => {
        const row = await liveRow(name);
        other = await server.apps!.startJob(row.id, "apply");
        return row;
      };
      try {
        const removal = await send("/api/apps/vault/remove", {});
        expect(removal.status).toBe(409);
        expect(((await removal.json()) as { error: string }).error).toBe("busy");
      } finally {
        apps.liveRow = liveRow;
      }
      expect((await t.db.select({ desired: app.desired }).from(app).where(eq(app.name, "vault")))[0]!.desired).toBe("running");
      expect(await t.db.select().from(event).where(and(eq(event.type, "app.removed"), eq(event.subjectAppId, await appId("vault"))))).toEqual([]);
    });
    await other?.done;
  });

  it("saves an app's change against the grants it has once its job holds it", async () => {
    for (const name of ["first", "second", "third"]) expect((await send("/api/knowledge", { name })).status).toBe(201);
    expect((await waitForJob(await jobOf(await send("/api/apps/vault/knowledge", { bases: ["first"] }, "PUT")))).state).toBe("succeeded");
    // The change to third reads vault's grants, then waits, while another change to vault is asked for.
    const apps = server.apps!;
    const grants = apps.grants.bind(apps);
    let reached = () => {};
    const atGrants = new Promise<void>((resolve) => (reached = resolve));
    let go = () => {};
    const resume = new Promise<void>((resolve) => (go = resolve));
    let pause = true;
    apps.grants = async (id, db) => {
      const found = await grants(id, db);
      if (pause) {
        pause = false;
        reached();
        await resume;
      }
      return found;
    };
    try {
      const late = send("/api/apps/vault/knowledge", { bases: ["third"] }, "PUT");
      await atGrants;
      const other = await send("/api/apps/vault/knowledge", { bases: ["second"] }, "PUT");
      // Refused because the waiting change holds vault, or, if it didn't, saved and applied.
      if (other.status === 202) expect((await waitForJob(await jobOf(other))).state).toBe("succeeded");
      else expect([other.status, ((await other.json()) as { error: string }).error]).toEqual([409, "busy"]);
      go();
      const answer = await late;
      expect(answer.status).toBe(202);
      expect((await waitForJob(await jobOf(answer))).state).toBe("succeeded");
    } finally {
      apps.grants = grants;
      go();
    }
    // The grants are exactly one change's, never a mix of both, and they are what vault runs with.
    const saved = await grantsOf("vault");
    expect([["second"], ["third"]]).toContainEqual(saved);
    expect(lastApply("vault").knowledge!.bases).toEqual(saved);
  });

  it("saves nothing when the job that would apply a change can't be recorded", async () => {
    const before = await grantsOf("vault");
    const granted = (await events("knowledge.granted")).length;
    await t.pool.query("create function refuse_jobs() returns trigger language plpgsql as $$ begin raise exception 'no jobs'; end $$");
    await t.pool.query("create trigger refuse_jobs before insert on install_job for each row execute function refuse_jobs()");
    try {
      expect((await send("/api/apps/vault/knowledge", { bases: ["first"] }, "PUT")).status).toBe(500);
    } finally {
      await t.pool.query("drop trigger refuse_jobs on install_job");
      await t.pool.query("drop function refuse_jobs()");
    }
    expect(await grantsOf("vault")).toEqual(before);
    expect((await events("knowledge.granted")).length).toBe(granted);
    // The app isn't left busy: the change works once its job can be recorded.
    expect((await waitForJob(await jobOf(await send("/api/apps/vault/knowledge", { bases: ["first"] }, "PUT")))).state).toBe("succeeded");
    expect(await grantsOf("vault")).toEqual(["first"]);
  });

  it("doesn't start an app removed after it read the apps, before it held them", async () => {
    expect((await waitForJob(await jobOf(await send("/api/apps/atlas/knowledge", { bases: ["first"] }, "PUT")))).state).toBe("succeeded");
    let deleting: Promise<Response> | undefined;
    const calls = runtime.calls.length;
    await holdingApplies(async () => {
      deleting = api("/api/knowledge/first", { method: "DELETE" });
      await runtime.untilHeld();
      // vault as a removal that finished just before the delete held it leaves it: removed, with no containers.
      await t.db.update(app).set({ state: "removed", desired: "removed" }).where(eq(app.name, "vault"));
      runtime.applied.delete("ys-vault");
      runtime.running.delete("ys-vault");
    });
    expect((await deleting!).status).toBe(204);
    expect(runtime.calls.slice(calls).some((c) => c.method === "apply" && c.spec?.project === "ys-vault")).toBe(false);
    expect(runtime.running.has("ys-vault")).toBe(false);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "vault")))[0]!.state).toBe("removed");
  });
});

describe("giving and deleting a knowledge base at once", () => {
  const jobOf = async (response: Response) => ((await response.json()) as { jobId: string }).jobId;

  it("refuses to give a knowledge base to an app while it is being deleted", async () => {
    expect((await install("vault")).status).toBe(202);
    expect((await send("/api/knowledge", { name: "moving" })).status).toBe(201);
    expect((await waitForJob(await jobOf(await send("/api/apps/atlas/knowledge", { bases: ["moving"] }, "PUT")))).state).toBe("succeeded");

    let deleting: Promise<Response> | undefined;
    await holdingApplies(async () => {
      deleting = api("/api/knowledge/moving", { method: "DELETE" });
      // atlas, which has it, is applied again without it, and waits there.
      await runtime.untilHeld();
      const change = await send("/api/apps/vault/knowledge", { bases: ["moving"] }, "PUT");
      expect([change.status, ((await change.json()) as { error: string }).error]).toEqual([409, "busy"]);
      const { previewId } = await review("notes");
      const installing = await send("/api/apps", { previewId, reuseData: true, knowledge: ["moving"] });
      expect([installing.status, ((await installing.json()) as { error: string }).error]).toEqual([409, "busy"]);
    });
    expect((await deleting!).status).toBe(204);
    expect(await grantsOf("vault")).toEqual([]);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "notes")))[0]!.state).toBe("removed");
    expect(runtime.knowledge.has("moving")).toBe(false);
  });

  it("refuses to delete a knowledge base while it is being given to an app", async () => {
    expect((await send("/api/knowledge", { name: "arriving" })).status).toBe(201);
    // The change that gives it to vault waits once it holds vault, before it saves the grant.
    const apps = server.apps!;
    const grants = apps.grants.bind(apps);
    let reached = () => {};
    const atGrants = new Promise<void>((resolve) => (reached = resolve));
    let go = () => {};
    const resume = new Promise<void>((resolve) => (go = resolve));
    apps.grants = async (id, db) => {
      apps.grants = grants;
      const found = await grants(id, db);
      reached();
      await resume;
      return found;
    };
    let giving: Promise<Response> | undefined;
    try {
      giving = send("/api/apps/vault/knowledge", { bases: ["arriving"] }, "PUT");
      // A change that answers before it reads the grants fails the test now, rather than at its timeout.
      const early = giving.then(async (answer) => {
        throw new Error(`The change answered ${answer.status} before reading vault's grants: ${await answer.clone().text()}`);
      });
      await Promise.race([atGrants, early]);
      early.catch(() => {});
      const refused = await api("/api/knowledge/arriving", { method: "DELETE" });
      expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([409, "busy"]);
      expect(runtime.knowledge.has("arriving")).toBe(true);
    } finally {
      apps.grants = grants;
      go();
    }
    expect((await waitForJob(await jobOf(await giving!))).state).toBe("succeeded");
    expect(lastApply("vault").knowledge!.bases).toEqual(["arriving"]);
    // Once it is given, deleting it takes it from vault first.
    expect((await api("/api/knowledge/arriving", { method: "DELETE" })).status).toBe(204);
    expect(lastApply("vault").knowledge!.bases).toEqual([]);
  });

  it("keeps it, and the grant, when an app's state can't be read before it is applied again", async () => {
    expect((await send("/api/knowledge", { name: "flaky" })).status).toBe(201);
    expect((await waitForJob(await jobOf(await send("/api/apps/vault/knowledge", { bases: ["flaky"] }, "PUT")))).state).toBe("succeeded");
    const current = vi
      .spyOn(KnowledgeBases.prototype as unknown as { current: (appId: string) => Promise<unknown> }, "current")
      .mockRejectedValueOnce(new Error("The database stopped answering."));
    try {
      const refused = await api("/api/knowledge/flaky", { method: "DELETE" });
      expect(refused.status).toBe(409);
      const { error, message } = (await refused.json()) as { error: string; message: string };
      expect(error).toBe("apps_failed");
      expect(message).toMatch(/or removed: vault: /);
    } finally {
      current.mockRestore();
    }
    expect(await grantsOf("vault")).toEqual(["flaky"]);
    expect(runtime.knowledge.has("flaky")).toBe(true);
    expect((await api("/api/knowledge/flaky", { method: "DELETE" })).status).toBe(204);
    expect(await grantsOf("vault")).toEqual([]);
  });

  it("saves nothing of an install whose job can't be recorded", async () => {
    const installed = (await t.db.select().from(event).where(eq(event.type, "app.installed"))).length;
    await t.pool.query("create function refuse_jobs() returns trigger language plpgsql as $$ begin raise exception 'no jobs'; end $$");
    await t.pool.query("create trigger refuse_jobs before insert on install_job for each row execute function refuse_jobs()");
    try {
      const { previewId } = await review("notes");
      expect((await send("/api/apps", { previewId, reuseData: true, knowledge: ["second"] })).status).toBe(500);
    } finally {
      await t.pool.query("drop trigger refuse_jobs on install_job");
      await t.pool.query("drop function refuse_jobs()");
    }
    // notes is still removed, with no grant and no install recorded, so installing it again works.
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "notes")))[0]!.state).toBe("removed");
    expect(await grantsOf("notes")).toEqual([]);
    expect((await t.db.select().from(event).where(eq(event.type, "app.installed"))).length).toBe(installed);
    expect((await install("notes", ["second"])).status).toBe(202);
    expect(await grantsOf("notes")).toEqual(["second"]);
  });

  it("doesn't start again an app removed while its change was being checked", async () => {
    // atlas is removed after its change finds it free, before the change's job holds it.
    const apps = server.apps! as unknown as { knowledgeBases: (...args: unknown[]) => Promise<unknown> };
    const knowledgeBases = apps.knowledgeBases.bind(apps);
    apps.knowledgeBases = async (...args) => {
      apps.knowledgeBases = knowledgeBases;
      const found = await knowledgeBases(...args);
      expect((await waitForJob(await jobOf(await send("/api/apps/atlas/remove", {})))).state).toBe("succeeded");
      return found;
    };
    const calls = runtime.calls.length;
    let change: Response;
    try {
      change = await send("/api/apps/atlas/knowledge", { bases: ["second"] }, "PUT");
    } finally {
      apps.knowledgeBases = knowledgeBases;
    }
    expect([change.status, ((await change.json()) as { error: string }).error]).toEqual([409, "removed"]);
    expect(runtime.calls.slice(calls).some((c) => c.method === "apply" && c.spec?.project === "ys-atlas")).toBe(false);
    expect(runtime.running.has("ys-atlas")).toBe(false);
    expect((await t.db.select({ state: app.state }).from(app).where(eq(app.name, "atlas")))[0]!.state).toBe("removed");
    expect(await grantsOf("atlas")).toEqual([]);
  });
});

describe("knowledge bases changed while a request is checked", () => {
  const jobOf = async (response: Response) => ((await response.json()) as { jobId: string }).jobId;
  const errorOf = async (response: Response) => [response.status, ((await response.json()) as { error: string }).error];

  /** Runs `meanwhile` once a request has checked the knowledge bases it names, before its job holds the app. */
  async function afterTheCheck<T>(meanwhile: () => Promise<void>, request: () => Promise<T>): Promise<T> {
    const apps = server.apps! as unknown as { knowledgeBases: (...args: unknown[]) => Promise<unknown> };
    const knowledgeBases = apps.knowledgeBases.bind(apps);
    apps.knowledgeBases = async (...args) => {
      apps.knowledgeBases = knowledgeBases;
      const found = await knowledgeBases(...args);
      await meanwhile();
      return found;
    };
    try {
      return await request();
    } finally {
      apps.knowledgeBases = knowledgeBases;
    }
  }

  it("refuses renaming it, or creating its name again, while it is being deleted", async () => {
    let deleting: Promise<Response> | undefined;
    await holdingApplies(async () => {
      // notes has second, so deleting it waits on notes' apply.
      deleting = api("/api/knowledge/second", { method: "DELETE" });
      await runtime.untilHeld();
      expect(await errorOf(await send("/api/knowledge/second", { title: "Second" }, "PATCH"))).toEqual([409, "busy"]);
      expect(await errorOf(await send("/api/knowledge", { name: "second" }))).toEqual([409, "busy"]);
    });
    expect((await deleting!).status).toBe(204);
    expect(await events("knowledge.retitled")).not.toContainEqual(expect.objectContaining({ knowledgeBase: "second" }));
    expect(runtime.knowledge.has("second")).toBe(false);
  });

  it("gives no knowledge base deleted after the request named it", async () => {
    expect((await send("/api/knowledge", { name: "fleeting" })).status).toBe(201);
    const change = await afterTheCheck(
      async () => expect((await api("/api/knowledge/fleeting", { method: "DELETE" })).status).toBe(204),
      () => send("/api/apps/vault/knowledge", { bases: ["fleeting"] }, "PUT"),
    );
    expect(await errorOf(change)).toEqual([400, "unknown_knowledge_base"]);
    expect(await grantsOf("vault")).toEqual([]);
  });

  it("gives none to an app installed again, since the request read it, from a kit that doesn't ask for knowledge", async () => {
    expect((await send("/api/knowledge", { name: "steady" })).status).toBe(201);
    const kit = (await t.db.select({ kit: app.kit }).from(app).where(eq(app.name, "vault")))[0]!.kit!;
    const { knowledge: _knowledge, ...without } = kit;
    let change: Response;
    try {
      change = await afterTheCheck(
        async () => void (await t.db.update(app).set({ kit: without }).where(eq(app.name, "vault"))),
        () => send("/api/apps/vault/knowledge", { bases: ["steady"] }, "PUT"),
      );
    } finally {
      await t.db.update(app).set({ kit }).where(eq(app.name, "vault"));
    }
    expect(await errorOf(change)).toEqual([400, "no_knowledge"]);
    expect(await grantsOf("vault")).toEqual([]);
    expect((await api("/api/knowledge/steady", { method: "DELETE" })).status).toBe(204);
  });

  it("refuses more knowledge bases than the runtime manager mounts, before saving anything", async () => {
    const names = Array.from({ length: 101 }, (_, i) => `kb-${i}`);
    expect(await errorOf(await send("/api/apps/vault/knowledge", { bases: names }, "PUT"))).toEqual([400, "too_many_knowledge_bases"]);
    expect(await grantsOf("vault")).toEqual([]);
    expect((await waitForJob(await jobOf(await send("/api/apps/vault/knowledge", { bases: [] }, "PUT")))).state).toBe("succeeded");
  });
});
