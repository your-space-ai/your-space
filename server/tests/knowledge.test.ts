// Journey 014, slice 1: local knowledge bases. The owner creates them and gives them to apps whose kits
// ask for knowledge; each change is recorded against the owner. Removing an app, or deleting its data,
// never deletes a knowledge base, and deleting one takes it away from its apps first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { KitError, parseKit } from "../src/apps/kits.ts";
import { actor, app, appKnowledgeBase, event, eventKnowledgeBase, knowledgeBase } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
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
    const agentAccess = "agentAccess: { credential: { binding: service, inject: { location: header, name: X-API-Key } }, roles: { read: { title: Read, routes: [list] } }, routes: { list: { method: GET, path: /items, effect: read, outputFields: [id] } } }";
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
      ["knowledge: { path: '/my notes' }", /folder names/],
      ["knowledge: { path: /.hidden }", /folder names/],
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

const runtime = new FakeRuntime();
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
    ...plainKit("notes", "knowledge: {}\n"),
    ...plainKit("vault", "knowledge: { path: /vault/ }\n"),
    ...plainKit("plain"),
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

async function install(name: string, knowledge?: unknown): Promise<Response> {
  const { previewId } = await review(name);
  const response = await send("/api/apps", { previewId, ...(knowledge === undefined ? {} : { knowledge }) });
  if (response.status === 202) expect((await waitForJob(((await response.clone().json()) as { jobId: string }).jobId)).state).toBe("succeeded");
  return response;
}

/** The knowledge bases of each event of a type, by name, with who it is recorded against. */
async function events(type: string) {
  return t.db
    .select({ actorId: event.actorId, subjectAppId: event.subjectAppId, knowledgeBase: knowledgeBase.name })
    .from(event)
    .leftJoin(eventKnowledgeBase, eq(eventKnowledgeBase.eventId, event.id))
    .leftJoin(knowledgeBase, eq(eventKnowledgeBase.knowledgeBaseId, knowledgeBase.id))
    .where(eq(event.type, type));
}

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
    expect(await created.json()).toMatchObject({ name: "course-notes", title: "Course notes" });
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
    expect((await send("/api/knowledge", { name: "x", title: " " })).status).toBe(400);
    expect(runtime.calls.filter((c) => c.method === "createKnowledge").length).toBe(calls);
  });

  it("change their title, never their name", async () => {
    const response = await send("/api/knowledge/recipes", { title: "Family recipes", name: "soups" }, "PATCH");
    expect(response.status).toBe(200);
    const [row] = await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "recipes"));
    expect(row).toMatchObject({ name: "recipes", title: "Family recipes" });
    expect(await events("knowledge.retitled")).toEqual([{ actorId: owner, subjectAppId: null, knowledgeBase: "recipes" }]);
    expect((await send("/api/knowledge/nope", { title: "x" }, "PATCH")).status).toBe(404);
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
});

describe("removing an app and deleting its data", () => {
  it("never deletes a knowledge base", async () => {
    const removed = await send("/api/apps/notes/remove", {});
    await waitForJob(((await removed.json()) as { jobId: string }).jobId);
    // A removed app uses no knowledge base, and installing it again starts with the owner's picks.
    expect(await t.db.select().from(appKnowledgeBase).where(eq(appKnowledgeBase.appId, await appId("notes")))).toEqual([]);
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
    // Recorded against the owner; the deleted knowledge base's link went with it.
    const vault = await appId("vault");
    expect((await events("knowledge.revoked")).filter((e) => e.subjectAppId === vault)).toEqual([{ actorId: owner, subjectAppId: vault, knowledgeBase: null }]);
    expect(await t.db.select({ actorId: event.actorId }).from(event).where(eq(event.type, "knowledge.deleted"))).toEqual([{ actorId: owner }]);
  });

  it("is kept, with the apps that couldn't be applied without it, until they can", async () => {
    runtime.failApply = "The engine stopped.";
    const refused = await api("/api/knowledge/course-notes", { method: "DELETE" });
    expect(refused.status).toBe(409);
    const { message } = (await refused.json()) as { message: string };
    expect(message).toMatch(/still mounted by vault/);
    expect(message).toMatch(/These apps couldn't be applied without it, so they keep it: vault: /);
    expect(await t.db.select().from(knowledgeBase).where(eq(knowledgeBase.name, "course-notes"))).toHaveLength(1);
    // The app still mounts it, so it keeps it, and the knowledge base still lists it.
    expect(await t.db.select().from(appKnowledgeBase).where(and(eq(appKnowledgeBase.appId, await appId("vault"))))).toHaveLength(1);
    const list = (await (await api("/api/knowledge")).json()) as { knowledgeBases: { name: string; apps: { name: string }[] }[] };
    expect(list.knowledgeBases.find((k) => k.name === "course-notes")!.apps.map((a) => a.name)).toEqual(["vault"]);

    // Once the app can be applied again, deleting it again takes it from the app and deletes it.
    runtime.failApply = undefined;
    expect((await api("/api/knowledge/course-notes", { method: "DELETE" })).status).toBe(204);
    expect(runtime.knowledge.size).toBe(0);
    expect(lastApply("vault").knowledge).toEqual({ path: "/vault", bases: [] });
    expect(await t.db.select().from(knowledgeBase)).toEqual([]);
  });
});
