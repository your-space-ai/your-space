// Journey 014, slice 2: synced knowledge bases. The owner saves the operator's OAuth client, signs in
// with Google through a state and PKCE that only their session can finish, and connects knowledge
// bases to Drive folders. The client secret and token are stored encrypted with the data key, move to
// a new data key, reach only rclone's memory, through its remote control, and are never answered.
// The server's timer syncs each knowledge base about once a minute, each through an rclone of its own,
// side by side and never one knowledge base twice at once; a stopped run waits for the owner; a run's
// result outlives a server restart; Google's refusal disconnects the connection until the owner signs
// in again. The runtime manager and the rclones are fakes that record what they are asked.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { authorizationUrl, challengeOf, DRIVE_SCOPE, folderIdOf, GoogleError, rcloneToken, SignIns } from "../src/apps/google.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { bisyncParams, runFolder } from "../src/apps/bisync.ts";
import { KnowledgeSync, MAX_DELETIONS, RUN_LIMIT_MS, UNREACHABLE_MS } from "../src/apps/knowledge-sync.ts";
import { RcError } from "../src/apps/rclone.ts";
import { RuntimeError } from "../src/apps/runtime-client.ts";
import { decrypt, encrypt } from "../src/apps/settings.ts";
import { actor, event, eventKnowledgeBase, googleConnection, knowledgeBase, knowledgeSync, type SyncDeletion } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { FakeRcs } from "./helpers/rclone.ts";
import { FakeRuntime } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

const CLIENT_ID = "1234-abcd.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-test-client-secret";
const FOLDER = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
const ACCESS = "ya29.test-access-token";
const REFRESH = "1//test-refresh-token";

describe("Google's sign-in", () => {
  it("asks for offline access to all of Drive, with the consent screen, a state and an S256 challenge", () => {
    const url = new URL(authorizationUrl({ auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "" }, { clientId: CLIENT_ID, redirectUri: "https://space.example.com/api/google-drive/callback", state: "s", challenge: "c" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: "https://space.example.com/api/google-drive/callback",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive",
      access_type: "offline",
      prompt: "consent",
      state: "s",
      code_challenge: "c",
      code_challenge_method: "S256",
    });
  });

  it("finishes once, only in the session that started it, within ten minutes", () => {
    const signIns = new SignIns();
    const { state, challenge } = signIns.start("session-a", 0);
    expect(signIns.finish(state, "session-b", 1000)).toBeUndefined();
    const verifier = signIns.finish(state, "session-a", 1000)!;
    expect(challengeOf(verifier)).toBe(challenge);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(signIns.finish(state, "session-a", 1000)).toBeUndefined();
    const late = signIns.start("session-a", 0);
    expect(signIns.finish(late.state, "session-a", 10 * 60_000 + 1)).toBeUndefined();
  });

  it("gives rclone the token with its expiry time, and needs a refresh token and Drive", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(JSON.parse(rcloneToken({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer", scope: DRIVE_SCOPE }, now))).toEqual({
      access_token: ACCESS,
      token_type: "Bearer",
      refresh_token: REFRESH,
      expiry: "2026-11-25T12:59:59.000Z",
    });
    expect(() => rcloneToken({ access_token: ACCESS, expires_in: 3599 }, now)).toThrow(GoogleError);
    expect(() => rcloneToken({ access_token: ACCESS, refresh_token: REFRESH, scope: "openid" }, now)).toThrow(/Drive/);
  });

  it("reads a folder's ID from its link, and refuses a file's, My Drive's or another site's", () => {
    for (const link of [
      `https://drive.google.com/drive/folders/${FOLDER}`,
      `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`,
      `https://drive.google.com/drive/u/1/folders/${FOLDER}/`,
      `https://drive.google.com/open?id=${FOLDER}`,
      ` ${FOLDER} `,
    ]) {
      expect(folderIdOf(link), link).toBe(FOLDER);
    }
    for (const link of [
      "https://drive.google.com/drive/my-drive",
      `https://drive.google.com/file/d/${FOLDER}/view`,
      `https://docs.google.com/document/d/${FOLDER}/edit`,
      `http://drive.google.com/drive/folders/${FOLDER}`,
      `https://drive.google.com.example.com/drive/folders/${FOLDER}`,
      "https://drive.google.com/drive/folders/../x",
      "root",
    ]) {
      expect(folderIdOf(link), link).toBeUndefined();
    }
  });
});

const runtime = new FakeRuntime();
const rc = new FakeRcs();
let t: TestDatabase;
let server: TestServer;
let cookie: string;
let owner: string;
let operator: string;
/** What Google's token endpoint was sent, and what it answers. */
let exchanged: URLSearchParams[] = [];
let tokenAnswer: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
/** What happens while Google's token endpoint answers, as the operator acting meanwhile. */
let duringExchange: (() => Promise<void>) | undefined;

const fakeGoogle: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url !== "https://oauth2.google.test/token") throw new Error(`Unexpected request to ${url}`);
  const form = new URLSearchParams(String(init?.body));
  exchanged.push(form);
  await duringExchange?.();
  return new Response(JSON.stringify(tokenAnswer.body), { status: tokenAnswer.status, headers: { "content-type": "application/json" } });
};

beforeAll(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db, { apps: { runtime, fetch: fakeGoogle, rclone: rc.rcFor } });
  await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
  const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
  cookie = cookieHeader(signedIn);
  owner = (await t.db.select({ id: actor.id }).from(actor).where(eq(actor.kind, "human")))[0]!.id;
  operator = (await t.db.select({ id: actor.id }).from(actor).where(eq(actor.kind, "operator")))[0]!.id;
});

afterAll(async () => {
  await server?.close();
  await t?.destroy();
});

beforeEach(() => {
  exchanged = [];
  duringExchange = undefined;
  tokenAnswer = { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer", scope: DRIVE_SCOPE } };
});

const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
const send = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });
const sync = () => KnowledgeSync.for(server.apps!);
const connection = async () => (await t.db.select().from(googleConnection))[0];
/** The sync of the knowledge base with this name, "notes" unless said. */
const syncRow = async (name = "notes") => (await t.db.select({ sync: knowledgeSync }).from(knowledgeSync).innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeSync.knowledgeBaseId)).where(eq(knowledgeBase.name, name)))[0]?.sync;
const status = async (name = "notes") => ((await (await api(`/api/knowledge/${name}`)).json()) as { sync: Record<string, unknown> | null }).sync;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The events of a type, oldest first, so a test can tell the new ones by their place. */
const events = (type: string) =>
  t.db
    .select({ actorId: event.actorId, knowledgeBase: eventKnowledgeBase.name })
    .from(event)
    .leftJoin(eventKnowledgeBase, eq(eventKnowledgeBase.eventId, event.id))
    .where(eq(event.type, type))
    .orderBy(asc(event.createdAt), asc(event.id));

/** One tick of the server's timer. */
const tick = () => sync().tick();
/** Ticks until the knowledge base has no run under way or asked for. */
async function settled(name = "notes"): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await tick();
    if (!(await status(name))?.running) return;
  }
  throw new Error("The sync didn't finish.");
}
/** Every synced knowledge base, or those named, is due: its last run was over a minute ago. */
async function due(...names: string[]): Promise<void> {
  const ids = (await t.db.select({ id: knowledgeBase.id, name: knowledgeBase.name }).from(knowledgeBase)).filter((b) => names.length === 0 || names.includes(b.name)).map((b) => b.id);
  await t.db.update(knowledgeSync).set({ lastRunAt: new Date(Date.now() - 120_000) }).where(inArray(knowledgeSync.knowledgeBaseId, ids));
}
/** bisync's log line about a file deleted on a side, Path2 being the knowledge base. */
const deleted = (path: string, side = "Path2") => ({ level: "info", msg: `- ${side}             File was deleted                            - ${path}` });
const tooMany = { level: "error", msg: 'too many deletes (>50%, 2 of 3) on Path2 "/knowledge/notes/". Run with --force if desired.' };
const copied = (path: string) => ({ level: "info", msg: "Copied (new)", object: path });
const ok = { level: "info", msg: "Bisync successful" };
const SECRETS = [CLIENT_SECRET, ACCESS, REFRESH];

/** Signs in with Google as the owner's browser would: Google sends it back with the state and a code. */
/** The last sign-in page's PKCE challenge, which the code's exchange must answer. */
let challenge: string | null = null;
async function signInWithGoogle(): Promise<string> {
  const { url } = (await (await send("/api/google-drive/authorize", {})).json()) as { url: string };
  const asked = new URL(url);
  challenge = asked.searchParams.get("code_challenge");
  const back = await api(`/api/google-drive/callback?state=${encodeURIComponent(asked.searchParams.get("state")!)}&code=the-code`);
  expect(back.status).toBe(302);
  return back.headers.get("location")!;
}

describe("the Google connection", () => {
  it("shows the redirect URI to register, before anything is set up", async () => {
    const google = await (await api("/api/google-drive")).json();
    expect(google).toEqual({ redirectUri: `${server.publicUrl}/api/google-drive/callback`, clientId: null, state: "not_set_up", problem: null, connectedAt: null, knowledgeBases: 0 });
  });

  it("is the owner's only, from Your Space's own pages", async () => {
    expect((await server.request("/api/google-drive")).status).toBe(401);
    expect((await api("/api/google-drive", { method: "PUT", body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }), headers: { origin: "http://evil.test" } })).status).toBe(403);
    expect(await connection()).toBeUndefined();
  });

  it("keeps the client secret encrypted with the data key and never answers it", async () => {
    expect((await send("/api/google-drive", { clientId: "x", clientSecret: CLIENT_SECRET }, "PUT")).status).toBe(400);
    const saved = await send("/api/google-drive", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, "PUT");
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain(CLIENT_SECRET);
    expect(JSON.parse(text)).toMatchObject({ clientId: CLIENT_ID, state: "signed_out" });
    const row = (await connection())!;
    expect(row.clientSecret).not.toContain(CLIENT_SECRET);
    expect(decrypt(TEST_DATA_KEY, row.clientSecret)).toBe(CLIENT_SECRET);
    expect((await events("google.client_saved")).map((e) => e.actorId)).toEqual([owner]);
  });

  it("refuses a sign-in Google sends back with a state this session didn't start, or the owner denied", async () => {
    expect(await (await api("/api/google-drive/callback?state=made-up&code=x")).headers.get("location")).toBe(`${server.publicUrl}/knowledge?google=expired`);
    const { url } = (await (await send("/api/google-drive/authorize", {})).json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    // Another browser, without the owner's session, can't finish it.
    const stranger = await server.request(`/api/google-drive/callback?state=${state}&code=x`);
    expect(stranger.headers.get("location")).toBe(`${server.publicUrl}/knowledge?google=signed_out`);
    expect((await api(`/api/google-drive/callback?state=${state}&error=access_denied`)).headers.get("location")).toBe(`${server.publicUrl}/knowledge?google=denied`);
    expect(exchanged).toEqual([]);
    expect((await connection())!.token).toBeNull();
  });

  it("exchanges the code with the PKCE verifier and the client secret, and keeps the token encrypted", async () => {
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    expect(exchanged).toHaveLength(1);
    const form = exchanged[0]!;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form.get("redirect_uri")).toBe(`${server.publicUrl}/api/google-drive/callback`);
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    // The verifier of the sign-in Google was asked for.
    expect(challenge).toBeTruthy();
    expect(challengeOf(form.get("code_verifier")!)).toBe(challenge);
    const row = (await connection())!;
    expect(row.token).not.toContain(REFRESH);
    expect(JSON.parse(decrypt(TEST_DATA_KEY, row.token!))).toMatchObject({ access_token: ACCESS, refresh_token: REFRESH, expiry: expect.any(String) });
    const answered = await (await api("/api/google-drive")).text();
    for (const secret of [CLIENT_SECRET, ACCESS, REFRESH]) expect(answered).not.toContain(secret);
    expect(JSON.parse(answered)).toMatchObject({ state: "connected" });
  });

  it("keeps a token only for the client it was signed in with: one saved or removed during the exchange makes the sign-in expired", async () => {
    const connected = (await events("google.connected")).length;
    // The operator saves another client while Google answers: the token is the earlier client's.
    duringExchange = async () => void expect((await send("/api/google-drive", { clientId: "5678-efgh.apps.googleusercontent.com", clientSecret: "GOCSPX-another-secret" }, "PUT")).status).toBe(200);
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=expired`);
    expect(await connection()).toMatchObject({ clientId: "5678-efgh.apps.googleusercontent.com", token: null });
    // Removed while Google answers: nothing is kept.
    duringExchange = async () => void expect((await api("/api/google-drive", { method: "DELETE" })).status).toBe(204);
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=expired`);
    expect(await connection()).toBeUndefined();
    expect((await events("google.connected")).length).toBe(connected);

    duringExchange = undefined;
    expect((await send("/api/google-drive", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, "PUT")).status).toBe(200);
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    expect((await events("google.connected")).length).toBe(connected + 1);
  });

  it("keeps the connection when Google refuses a new sign-in, and says why", async () => {
    const before = (await connection())!.token;
    tokenAnswer = { status: 400, body: { error: "invalid_grant", error_description: "Bad Request" } };
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=refused`);
    tokenAnswer = { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, scope: "openid" } };
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=no_drive`);
    expect((await connection())!.token).toBe(before);
  });
});

describe("a knowledge base's sync", () => {
  beforeAll(async () => {
    expect((await send("/api/knowledge", { name: "notes", title: "Notes" })).status).toBe(201);
    expect((await send("/api/knowledge", { name: "recipes" })).status).toBe(201);
  });

  beforeEach(() => {
    rc.hold = false;
    rc.answers = [{ lines: [ok] }];
    rc.copies = [];
    runtime.onSyncRecreated = (name) => rc.restart(name);
  });

  it("connects only to a Drive folder's link, through the Google connection, never another remote", async () => {
    for (const body of [{ folder: "https://drive.google.com/drive/my-drive" }, { folder: FOLDER, type: "local" }, { folder: FOLDER, remote: { type: "alias", remote: "/" } }]) {
      const refused = await send("/api/knowledge/notes/sync", body, "PUT");
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
    expect(await syncRow()).toBeUndefined();
    expect(runtime.syncStarts).toEqual([]);
    expect(rc.calls).toEqual([]);
  });

  it("mounts it in the sync's service, makes its remote in rclone with the client and token, which reach nothing else, and resyncs first", async () => {
    const connected = await send("/api/knowledge/notes/sync", { folder: `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing` }, "PUT");
    expect(connected.status).toBe(202);
    // Its earlier sync state is removed first, then the service is started with it mounted.
    expect(runtime.removedSyncs).toEqual(["notes"]);
    expect(runtime.syncStarts.at(-1)).toEqual(["notes"]);
    expect(await status()).toMatchObject({ running: true, firstRun: true });
    await settled();

    const created = rc.calls.filter((c) => c.command === "config/create");
    expect(created).toHaveLength(1);
    expect(created[0]!.params).toMatchObject({
      name: "kb-notes",
      type: "drive",
      parameters: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: "drive", root_folder_id: FOLDER, skip_gdocs: true, skip_shortcuts: true },
      opt: { nonInteractive: true },
    });
    expect(JSON.parse((created[0]!.params.parameters as { token: string }).token)).toMatchObject({ refresh_token: REFRESH });
    // The marker is put at both roots: here first, then copied to Drive with the same time.
    expect(rc.calls.filter((c) => c.command.startsWith("operations/") && c.command !== "operations/stat" && c.command !== "operations/list").map((c) => c.command)).toEqual(["operations/uploadfile", "operations/copyfile"]);
    expect(rc.markers).toEqual(new Set(["/knowledge/notes", "kb-notes:"]));
    const [first] = rc.started();
    expect(first!.params).toMatchObject({ ...bisyncParams("notes", "x", { resync: true }), backupDir2: expect.stringMatching(/^\/state\/notes\/backups\/\d{4}-/), _async: true });
    expect(await status()).toMatchObject({ folderId: FOLDER, folderUrl: `https://drive.google.com/drive/folders/${FOLDER}`, result: "synced", firstRun: false, running: false });

    // The client secret and token went to rclone's memory only: never to the runtime manager, which
    // runs rclone's container, in any other call to rclone, or in an answer.
    expect(JSON.stringify(runtime.calls)).not.toMatch(new RegExp(SECRETS.map((x) => x.replace(/[/.]/g, "\\$&")).join("|")));
    for (const call of rc.calls.filter((c) => c.command !== "config/create")) for (const secret of SECRETS) expect(JSON.stringify(call), call.command).not.toContain(secret);
    const listed = await (await api("/api/knowledge")).text();
    for (const secret of SECRETS) expect(listed).not.toContain(secret);
    expect((await events("knowledge.connected")).map((e) => [e.actorId, e.knowledgeBase])).toEqual([[owner, "notes"]]);
    // Connected already: another folder needs a disconnect first.
    expect((await send("/api/knowledge/notes/sync", { folder: FOLDER }, "PUT")).status).toBe(409);
  });

  it("syncs each knowledge base about once a minute, each in its own rclone, side by side", async () => {
    const notes = rc.executeIdOf("notes");
    expect((await send("/api/knowledge/recipes/sync", { folder: FOLDER }, "PUT")).status).toBe(202);
    expect(runtime.syncStarts.at(-1)).toEqual(["notes", "recipes"]);
    await settled("recipes");
    // Connecting recipes left notes' rclone, and the remote in it, as they were.
    expect(rc.executeIdOf("notes")).toBe(notes);
    expect(rc.calls.filter((c) => c.command === "sync/bisync" && c.knowledgeBase === "recipes")).toHaveLength(1);
    const runs = () => rc.started().length;
    // Not due yet: both ran within the minute.
    const before = runs();
    await tick();
    expect(runs()).toBe(before);

    rc.hold = true;
    await due();
    await tick();
    // Both at once, each through its own rclone, which mounts only its own knowledge base.
    expect(rc.running().map((j) => [j.knowledgeBase, j.params.path2]).sort()).toEqual([
      ["notes", "/knowledge/notes"],
      ["recipes", "/knowledge/recipes"],
    ]);
    await tick();
    expect(runs()).toBe(before + 2);
    rc.finish("notes");
    await tick();
    expect(await status()).toMatchObject({ running: false, result: "synced" });
    expect(await status("recipes")).toMatchObject({ running: true });
    rc.finish();
    await tick();
    expect(rc.running()).toEqual([]);
    expect(rc.mostAtOnce).toBe(1);
  });

  it("never runs a knowledge base twice at once: Sync now during its run runs once more after it, and Resync waits", async () => {
    rc.hold = true;
    expect((await send("/api/knowledge/notes/sync", { action: "sync" })).status).toBe(202);
    await tick();
    expect(rc.running()).toHaveLength(1);
    expect(await status()).toMatchObject({ running: true });
    expect((await send("/api/knowledge/notes/sync", { action: "resync" })).status).toBe(409);
    expect((await send("/api/knowledge/notes/sync", { action: "sync" })).status).toBe(202);
    expect((await send("/api/knowledge/notes/sync", { action: "sync" })).status).toBe(202);
    const before = rc.started().length;
    await tick();
    expect(rc.started().length).toBe(before);
    rc.finish();
    await tick();
    await tick();
    expect(rc.started().length).toBe(before + 1);
    expect(rc.mostAtOnce).toBe(1);
    rc.finish();
    await settled();
    expect(rc.started().length).toBe(before + 1);
  });

  it("asks rclone nothing while no run is due, as each call it answers is kept for an hour", async () => {
    await settled();
    await settled("recipes");
    const calls = rc.calls.length;
    for (let i = 0; i < 5; i++) await tick();
    expect(rc.calls.length).toBe(calls);
  });

  it("resyncs until a first resync has succeeded, a Sync now included", async () => {
    expect((await send("/api/knowledge", { name: "first" })).status).toBe(201);
    // The first resync fails, as while offline: the knowledge base still has no listings.
    rc.answers = [{ success: false, error: "bisync aborted", lines: [{ level: "error", msg: "Bisync critical error: couldn't list directory: dial tcp: lookup www.googleapis.com: no such host" }] }];
    expect((await send("/api/knowledge/first/sync", { folder: FOLDER }, "PUT")).status).toBe(202);
    await settled("first");
    expect(await status("first")).toMatchObject({ result: "failed", firstRun: true });
    rc.answers = [{ lines: [ok] }];
    expect((await send("/api/knowledge/first/sync", { action: "sync" })).status).toBe(202);
    await settled("first");
    expect(rc.started().filter((j) => j.params.path2 === "/knowledge/first").at(-1)!.params).toMatchObject({ resync: true, resyncMode: "newer" });
    expect(await status("first")).toMatchObject({ result: "synced", firstRun: false });
    expect((await api("/api/knowledge/first", { method: "DELETE" })).status).toBe(204);
  });

  it("keeps following a run when rclone's answer about it fails for any reason but not having it", async () => {
    rc.hold = true;
    rc.answers = [{ lines: [copied("kept.md"), ok] }];
    const synced = (await events("knowledge.synced")).length;
    await due("notes");
    await tick();
    const job = (await syncRow())!.job;
    expect(job).not.toBeNull();
    rc.failures.set("job/status", new RcError("rclone answered job/status with something that isn't JSON.", 502));
    await tick();
    expect((await syncRow())!.job).toEqual(job);
    rc.finish();
    await tick();
    expect((await syncRow())!.job).toBeNull();
    expect((await events("knowledge.synced")).length).toBe(synced + 1);
  });

  it("starts no run before the sync's service has said which remote to make", async () => {
    runtime.syncFixture = true;
    runtime.failSyncService = new RuntimeError("The engine can't be reached.", 503, "engine_error");
    const made = () => rc.calls.filter((c) => c.command === "config/create");
    const before = made().length;
    const runs = rc.started().length;
    // A server that just started, while the runtime manager can't start the service: rclone, left
    // running, answers, but the server doesn't know yet that it is the browser tests'.
    const restarted = new KnowledgeSync(server.apps!);
    await due();
    await restarted.tick();
    expect(made().length).toBe(before);
    expect(rc.started().length).toBe(runs);
    await restarted.close();
    runtime.failSyncService = undefined;
    const started = new KnowledgeSync(server.apps!);
    await started.tick();
    expect(made().at(-1)!.params).toMatchObject({ type: "alias" });
    await started.close();
    runtime.syncFixture = false;
    await settled();
    await settled("recipes");
  });

  it("runs one tick at a time, and a tick asked for meanwhile waits once, not once for each", async () => {
    rc.hold = true;
    await due("notes");
    await tick();
    expect(rc.running()).toHaveLength(1);
    let open: () => void = () => {};
    rc.gates.set("job/status", new Promise<void>((resolve) => (open = resolve)));
    const asked = () => rc.calls.filter((c) => c.command === "job/status").length;
    const before = asked();
    // A tick that waits for rclone's answer, and twenty more meanwhile.
    const first = tick();
    await sleep(20);
    const more = Array.from({ length: 20 }, () => tick());
    rc.gates.delete("job/status");
    open();
    await first;
    await Promise.all(more);
    expect(asked() - before).toBe(2);
    rc.hold = false;
    rc.finish();
    await settled();
  });

  it("forgets every remote in rclone when the OAuth client changes, and makes them again after the next sign-in", async () => {
    await settled();
    expect(rc.remotes.has("kb-notes")).toBe(true);
    expect((await send("/api/google-drive", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, "PUT")).status).toBe(200);
    expect(rc.remotes.size).toBe(0);
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    await due();
    await settled();
    await settled("recipes");
    expect([...rc.remotes.keys()].sort()).toEqual(["kb-notes", "kb-recipes"]);
  });

  it("records nothing of a run bisync's lock refused, which is due again a minute later", async () => {
    const before = (await status())!;
    rc.answers = [{ success: false, error: "bisync aborted", lines: [{ level: "error", msg: "prior lock file found: /state/notes/bisync/x.lck" }] }];
    await due("notes");
    await tick();
    await tick();
    const after = (await syncRow())!;
    expect(after).toMatchObject({ job: null, result: before.result });
    expect(Date.now() - after.lastRunAt!.getTime()).toBeLessThan(10_000);
    const runs = rc.started().length;
    await tick();
    expect(rc.started().length).toBe(runs);
  });

  it("records each run against Your Space, the owner's actions against the owner, and only runs that changed something", async () => {
    const before = (await events("knowledge.synced")).length;
    await due("notes");
    await settled();
    expect((await events("knowledge.synced")).length).toBe(before);
    rc.answers = [{ lines: [copied("new.md"), ok] }];
    await due("notes");
    await settled();
    const synced = await events("knowledge.synced");
    expect(synced.length).toBe(before + 1);
    expect(synced.at(-1)).toEqual({ actorId: operator, knowledgeBase: "notes" });
  });

  it("keeps a stopped run's reason and deletions, waits for the owner, and applies the deletions confirmed once a dry run lists them again", async () => {
    const deletions = [{ side: "local", path: "a.md" }, { side: "local", path: "b.md" }] as const;
    rc.answers = [{ success: false, error: "too many deletes", lines: [deleted("a.md"), deleted("b.md"), tooMany] }];
    rc.listings.set("/knowledge/notes", [{ Path: "plan.md.conflict1", Size: 3 }]);
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    const stopped = (await status())!;
    expect(stopped).toMatchObject({ result: "stopped", reason: "max_delete", side: "local", deletions, deletionCounts: { local: 2, remote: 0 }, conflicts: ["plan.md.conflict1"], detail: tooMany.msg });
    expect(stopped.summary).toContain("More than half of the files were deleted in the knowledge base");
    expect((await events("knowledge.sync_stopped")).at(-1)).toEqual({ actorId: operator, knowledgeBase: "notes" });

    // The timer leaves it for the owner.
    const ofNotes = () => rc.started().filter((j) => j.params.path2 === "/knowledge/notes").length;
    const runs = ofNotes();
    await due("recipes");
    await settled("recipes");
    expect(ofNotes()).toBe(runs);

    // The owner confirms the run they saw and how many it listed; the server keeps the list itself.
    const confirm = { action: "apply_deletions", run: stopped.lastRunAt, count: 2 };
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", deletions: "all" })).status).toBe(400);
    expect((await send("/api/knowledge/notes/sync", { ...confirm, count: "2" })).status).toBe(400);
    for (const changed of [{ ...confirm, count: 1 }, { ...confirm, run: new Date(0).toISOString() }]) {
      const refused = await send("/api/knowledge/notes/sync", changed);
      expect(refused.status, JSON.stringify(changed)).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toBe("deletions_changed");
    }
    expect(ofNotes()).toBe(runs);
    // A dry run lists the same deletions, so the run that makes them follows it.
    rc.answers = [{ lines: [deleted("b.md"), deleted("a.md"), ok] }, { lines: [{ level: "info", msg: "Deleted", object: "a.md" }, ok] }];
    expect((await send("/api/knowledge/notes/sync", confirm)).status).toBe(202);
    await settled();
    const [preview, force] = rc.started().slice(-2);
    expect(preview!.params).toMatchObject({ force: true, dryRun: true });
    expect(force!.params).toMatchObject({ force: true });
    expect(force!.params.dryRun).toBeUndefined();
    expect(force!.params.backupDir2).toBe(preview!.params.backupDir2);
    expect(await status()).toMatchObject({ result: "synced", deletions: [], deletionCounts: { local: 0, remote: 0 } });
    expect((await events("knowledge.deletions_applied")).map((e) => e.actorId)).toEqual([owner]);
    // Nothing left to apply.
    expect((await send("/api/knowledge/notes/sync", confirm)).status).toBe(409);
  });

  it("applies nothing when the dry run lists other deletions than the owner confirmed, and shows the new list", async () => {
    rc.answers = [{ success: false, error: "too many deletes", lines: [deleted("a.md"), deleted("b.md"), tooMany] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    const stopped = (await status())!;
    // Another file was deleted after the owner looked.
    rc.answers = [{ lines: [deleted("a.md"), deleted("b.md"), deleted("c.md"), ok] }];
    const runs = rc.started().length;
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", run: stopped.lastRunAt, count: 2 })).status).toBe(202);
    await settled();
    expect(rc.started().length).toBe(runs + 1);
    expect(rc.started().at(-1)!.params).toMatchObject({ dryRun: true });
    expect(await status()).toMatchObject({ result: "stopped", reason: "changed", deletionCounts: { local: 3, remote: 0 } });
    expect((await status())!.summary).toContain("changed since you confirmed them");
  });

  it("keeps the owner's Apply these deletions when bisync's lock refused its dry run, and applies them once the lock is gone", async () => {
    rc.answers = [{ success: false, error: "too many deletes", lines: [deleted("a.md"), deleted("b.md"), tooMany] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    const stopped = (await status())!;
    rc.answers = [{ success: false, error: "bisync aborted", lines: [{ level: "error", msg: "prior lock file found: /state/notes/bisync/x.lck" }] }];
    const runs = rc.started().length;
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", run: stopped.lastRunAt, count: 2 })).status).toBe(202);
    await tick();
    await tick();
    expect(rc.started().length).toBe(runs + 1);
    // Asked for again, confirmed by the same deletions, and due a minute later.
    const waiting = (await syncRow())!;
    expect(waiting).toMatchObject({ job: null, result: "stopped", reason: "max_delete", requested: { mode: "force", by: owner, again: true, run: waiting.lastRunAt!.toISOString(), count: 2 } });
    expect(waiting.deletions).toHaveLength(2);
    await tick();
    expect(rc.started().length).toBe(runs + 1);
    rc.answers = [{ lines: [deleted("a.md"), deleted("b.md"), ok] }, { lines: [ok] }];
    const applied = (await events("knowledge.deletions_applied")).length;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      await tick();
    } finally {
      clock.mockRestore();
    }
    await settled();
    expect(rc.started().slice(runs + 1).map((j) => [j.params.dryRun === true, j.params.force === true])).toEqual([
      [true, true],
      [false, true],
    ]);
    expect(await status()).toMatchObject({ result: "synced", deletions: [] });
    expect((await events("knowledge.deletions_applied")).slice(applied).map((e) => e.actorId)).toEqual([owner]);
  });

  it("keeps the deletions for the owner when only the dry run was interrupted, and records them as the owner's when applying them was", async () => {
    rc.answers = [{ success: false, error: "too many deletes", lines: [deleted("a.md"), deleted("b.md"), tooMany] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    const stopped = (await status())!;
    const confirm = { action: "apply_deletions", run: stopped.lastRunAt, count: 2 };
    // Interrupted during the dry run, which changes nothing: the same run's deletions wait for the owner.
    rc.hold = true;
    expect((await send("/api/knowledge/notes/sync", confirm)).status).toBe(202);
    await tick();
    expect((await syncRow())!.job).toMatchObject({ step: "preview" });
    rc.restart("notes");
    await tick();
    expect(await status()).toMatchObject({ running: false, result: "stopped", reason: "max_delete", lastRunAt: stopped.lastRunAt, deletionCounts: { local: 2, remote: 0 } });
    // Interrupted while applying them: some may be deleted, by the owner, and the list is gone.
    rc.answers = [{ lines: [deleted("a.md"), deleted("b.md"), ok] }, { lines: [ok] }];
    const applied = (await events("knowledge.deletions_applied")).length;
    expect((await send("/api/knowledge/notes/sync", confirm)).status).toBe(202);
    await tick();
    rc.finish();
    await tick();
    expect((await syncRow())!.job).toMatchObject({ step: "force" });
    rc.restart("notes");
    await tick();
    expect(await status()).toMatchObject({ running: false, result: "failed", deletions: [], deletionCounts: { local: 0, remote: 0 } });
    expect((await events("knowledge.deletions_applied")).slice(applied).map((e) => e.actorId)).toEqual([owner]);
    rc.hold = false;
    rc.answers = [{ lines: [ok] }];
    await due("notes");
    await settled();
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("lists backups a run's folder at a time, newest first, only until the page has as many as it shows, and removes those over 30 days old", async () => {
    // rclone keeps each answer for an hour: never the whole of 30 days' backups at once.
    const recent = runFolder(new Date(Date.now() - 60_000));
    const older = runFolder(new Date(Date.now() - 24 * 60 * 60_000));
    const expired = runFolder(new Date(Date.now() - 31 * 24 * 60 * 60_000));
    rc.listings.set("/state/notes/backups", [
      ...Array.from({ length: 600 }, (_, i) => ({ Path: `${recent}/f-${i}.md`, Size: 1 })),
      { Path: `${older}/old.md`, Size: 2 },
      { Path: `${expired}/gone.md`, Size: 3 },
    ]);
    const from = rc.calls.length;
    rc.answers = [{ lines: [copied("x.md"), ok] }];
    await due("notes");
    await settled();
    const lists = rc.calls.slice(from).filter((c) => c.command === "operations/list" && String(c.params.fs).startsWith("/state/notes/backups"));
    expect(lists.map((c) => [c.params.fs, Boolean((c.params.opt as { dirsOnly?: boolean }).dirsOnly)])).toEqual([
      ["/state/notes/backups", true],
      [`/state/notes/backups/${recent}`, false],
    ]);
    expect(rc.purged).toContain(`/state/notes/backups/${expired}`);
    const shown = (await status())!.backups as { run: string }[];
    expect(shown).toHaveLength(500);
    expect(new Set(shown.map((b) => b.run))).toEqual(new Set([recent]));
    rc.listings.delete("/state/notes/backups");
    rc.answers = [{ lines: [copied("y.md"), ok] }];
    await due("notes");
    await settled();
    expect((await status())!.backups).toEqual([]);
  });

  it("keeps every deletion a stopped run listed, shows the first 500, and applies them all once confirmed", async () => {
    const many: SyncDeletion[] = Array.from({ length: 700 }, (_, i) => ({ side: i < 600 ? "local" : "remote", path: `course/week ${i}.md` }));
    const lines = [...many.map((d) => deleted(d.path, d.side === "local" ? "Path2" : "Path1")), tooMany];
    rc.answers = [{ success: false, error: "too many deletes", lines }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    const stopped = (await status())!;
    expect(stopped.deletions).toEqual(many.slice(0, 500));
    expect(stopped.deletionCounts).toEqual({ local: 600, remote: 100 });
    // Confirming the 500 shown isn't confirming the 700 listed.
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", run: stopped.lastRunAt, count: 500 })).status).toBe(409);
    rc.answers = [{ lines: [...lines.slice(0, -1), ok] }, { lines: [ok] }];
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", run: stopped.lastRunAt, count: 700 })).status).toBe(202);
    await settled();
    expect(rc.started().at(-1)!.params).toMatchObject({ force: true });
    expect(await status()).toMatchObject({ result: "synced", deletionCounts: { local: 0, remote: 0 } });
  });

  it("stops with more deletions than the owner can confirm, which can't be applied", async () => {
    const lines = [...Array.from({ length: MAX_DELETIONS + 1 }, (_, i) => deleted(`f-${i}.md`)), tooMany];
    rc.answers = [{ success: false, error: "too many deletes", lines }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    const stopped = (await status())!;
    expect(stopped).toMatchObject({ result: "stopped", reason: "too_many", side: "local", deletions: [], deletionCounts: { local: 0, remote: 0 } });
    expect(stopped.summary).toContain("more than Your Space can list for you to confirm");
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", run: stopped.lastRunAt, count: MAX_DELETIONS + 1 })).status).toBe(409);
    rc.answers = [{ lines: [ok] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("resyncs when the owner asks, which deletes nothing, and lets the knowledge base's copy win the ties a resync leaves", async () => {
    rc.answers = [{ success: false, error: "bisync aborted", lines: [{ level: "error", msg: "Access test failed: Path1 count 1, Path2 count 0 - .your-space-sync" }, { level: "error", msg: "-                   Access test failed: Path1 file not found in Path2 - .your-space-sync" }, { level: "error", msg: "Bisync critical error: check file check failed" }] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect((await status())!.summary).toContain("marker file, .your-space-sync, is missing in the knowledge base");
    rc.markers.delete("/knowledge/notes");
    const tie = (path: string) => ({ level: "error", msg: `-                   Checksum not equal in listing. Path1: aaa, Path2: bbb - ${path}` });
    const ties = Array.from({ length: 45 }, (_, i) => `same ${i}.md`);
    rc.answers = [
      { success: false, error: "bisync aborted", lines: [...ties.map(tie), { level: "error", msg: "Bisync critical error: path1 and path2 are out of sync, run --resync to recover" }, { level: "error", msg: "Bisync aborted. Must run --resync to recover." }] },
      { lines: [ok] },
    ];
    // Two copies, of 40 ties and of the other 5; one of the first was newer on Drive, so it was left.
    rc.copies = [{ copied: ties.slice(1, 40) }, { copied: ties.slice(40) }];
    const runs = rc.calls.length;
    expect((await send("/api/knowledge/notes/sync", { action: "resync" })).status).toBe(202);
    await settled();
    // The marker went back here, from Drive.
    expect(rc.calls.slice(runs).filter((c) => c.command === "operations/copyfile").map((c) => [c.params.srcFs, c.params.dstFs])).toEqual([["kb-notes:", "/knowledge/notes"]]);
    const steps = rc.calls.slice(runs).filter((c) => c.command === "sync/bisync" || c.command === "sync/copy");
    expect(steps.map((c) => c.command)).toEqual(["sync/bisync", "sync/copy", "sync/copy", "sync/bisync"]);
    expect(steps[0]!.params).toMatchObject({ resync: true, resyncMode: "newer" });
    expect((steps[1]!.params._filter as { IncludeRule: string[] }).IncludeRule).toHaveLength(40);
    expect(steps[1]!.params).toMatchObject({ srcFs: "/knowledge/notes", dstFs: "kb-notes:", _config: { UpdateOlder: true, CheckSum: true } });
    expect(steps[3]!.params).toMatchObject({ resync: true, resyncMode: "newer" });
    expect(await status()).toMatchObject({ result: "synced", ties: ties.slice(1) });
    expect((await events("knowledge.resync_requested")).map((e) => e.actorId)).toEqual([owner]);
  });

  it("takes a run's next step only once a job of a run its rclone runs, which the row doesn't name, has ended", async () => {
    const tie = (path: string) => ({ level: "error", msg: `-                   Checksum not equal in listing. Path1: aaa, Path2: bbb - ${path}` });
    rc.answers = [{ success: false, error: "bisync aborted", lines: [tie("same.md"), { level: "error", msg: "Bisync aborted. Must run --resync to recover." }] }, { lines: [ok] }];
    rc.copies = [{ copied: ["same.md"] }];
    rc.hold = true;
    expect((await send("/api/knowledge/notes/sync", { action: "resync" })).status).toBe(202);
    await tick();
    expect((await syncRow())!.job).toMatchObject({ step: "resync" });
    rc.finish();
    // The tie copy rclone runs, as when it took the copy but keeping it on the row failed.
    await rc.rcFor("notes").call("sync/copy", { srcFs: "/knowledge/notes", dstFs: "kb-notes:", _async: true, _group: "knowledge/notes/run/ties/stray" });
    const copies = rc.started("sync/copy").length;
    await tick();
    await tick();
    expect(rc.started("sync/copy").length).toBe(copies);
    expect((await syncRow())!.job).toMatchObject({ step: "resync" });
    rc.finish();
    rc.hold = false;
    await settled();
    expect(rc.started("sync/copy").length).toBe(copies + 1);
    expect(await status()).toMatchObject({ result: "synced", ties: ["same.md"] });
  });

  it("records a run that finished while the server was stopped once it starts again: rclone keeps the result", async () => {
    // The server that starts the run, and stops: nothing stops the run in rclone.
    const stopping = new KnowledgeSync(server.apps!);
    rc.hold = true;
    rc.answers = [{ lines: [copied("while-stopped.md"), ok] }];
    const synced = (await events("knowledge.synced")).length;
    await due();
    await stopping.tick();
    expect(rc.running()).toHaveLength(1);
    await stopping.close();
    expect(rc.calls.some((c) => c.command === "job/stop")).toBe(false);
    rc.finish();
    // The next server reads it from rclone by the job kept on the knowledge base's row.
    const before = (await syncRow())!;
    expect(before.job).toMatchObject({ step: "sync", executeId: rc.executeIdOf("notes") });
    const started = new KnowledgeSync(server.apps!);
    await started.tick();
    const after = (await syncRow())!;
    expect(after.job).toBeNull();
    expect(after.lastRunAt!.toISOString()).toBe(before.job!.startedAt);
    expect((await events("knowledge.synced")).length).toBe(synced + 1);
    await started.close();
  });

  it("records a run its rclone forgot, as after it restarted, as failed, and makes the remote again in the new rclone", async () => {
    rc.hold = true;
    await due("notes");
    await tick();
    const was = (await syncRow())!;
    expect(was.job).not.toBeNull();
    const made = rc.calls.filter((c) => c.command === "config/create").length;
    const failed = (await events("knowledge.sync_failed")).length;
    rc.restart("notes");
    await tick();
    const after = (await syncRow())!;
    // It may have changed files before it stopped: a failed run of Your Space's, as the run it was.
    expect(after).toMatchObject({ job: null, result: "failed", message: expect.stringContaining("interrupted") });
    expect(after.lastRunAt!.toISOString()).toBe(was.job!.startedAt);
    expect((await events("knowledge.sync_failed")).slice(failed)).toEqual([{ actorId: operator, knowledgeBase: "notes" }]);
    expect((await status())!.summary).toContain("didn't finish");
    rc.hold = false;
    await due("notes");
    await tick();
    expect(rc.calls.filter((c) => c.command === "config/create").length).toBe(made + 1);
    expect(rc.remotes.get("kb-notes")).toMatchObject({ type: "drive" });
    await settled();
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("stops a run past its time by restarting its own rclone as Ctrl+C stops it, says so, then carries on", async () => {
    // Recipes synced, as an earlier test's run of it stopped.
    await send("/api/knowledge/recipes/sync", { action: "sync" });
    await settled("recipes");
    expect(await status("recipes")).toMatchObject({ result: "synced" });
    rc.hold = true;
    await due();
    await tick();
    expect(rc.running().map((j) => j.knowledgeBase).sort()).toEqual(["notes", "recipes"]);
    const recipes = rc.executeIdOf("recipes");
    const row = (await syncRow())!;
    const startedAt = new Date(Date.now() - RUN_LIMIT_MS - 1_000).toISOString();
    await t.db.update(knowledgeSync).set({ job: { ...row.job!, startedAt } }).where(eq(knowledgeSync.knowledgeBaseId, row.knowledgeBaseId));
    const restarts = runtime.syncRestarts.length;
    await tick();
    // Only notes' rclone; recipes' run goes on.
    expect(runtime.syncRestarts.slice(restarts)).toEqual(["notes"]);
    expect(rc.executeIdOf("recipes")).toBe(recipes);
    expect(rc.running().map((j) => j.knowledgeBase)).toEqual(["recipes"]);
    await tick();
    // Recorded, so the owner sees why it didn't finish; the next run carries on at once.
    expect(await syncRow()).toMatchObject({ job: null, result: "failed", message: expect.stringContaining("longer than 2 hours"), lastRunAt: new Date(startedAt) });
    rc.hold = false;
    rc.finish();
    await settled();
    await settled("recipes");
    expect(rc.started().filter((j) => j.knowledgeBase === "notes" && j.executeId === rc.executeIdOf("notes"))).toHaveLength(1);
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("restarts a knowledge base's rclone that hasn't answered for a minute, and no other", async () => {
    rc.hold = true;
    await due("notes");
    await tick();
    expect(rc.running().map((j) => j.knowledgeBase)).toEqual(["notes"]);
    rc.unreachable.add("notes");
    const restarts = runtime.syncRestarts.length;
    // Not at once: a container that just started takes a moment to answer.
    await tick();
    await tick();
    expect(runtime.syncRestarts.length).toBe(restarts);
    const later = Date.now() + UNREACHABLE_MS + 1_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      await tick();
      expect(runtime.syncRestarts.slice(restarts)).toEqual(["notes"]);
      // The next restart waits as long again.
      await tick();
      expect(runtime.syncRestarts.slice(restarts)).toEqual(["notes"]);
    } finally {
      clock.mockRestore();
    }
    rc.unreachable.delete("notes");
    rc.hold = false;
    rc.finish();
    await tick();
    // The restarted rclone forgot the run, which is recorded as interrupted.
    expect(await syncRow()).toMatchObject({ job: null, result: "failed", message: expect.stringContaining("interrupted") });
    await due();
    await settled();
    await settled("recipes");
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("starts a knowledge base's container again when it is gone and its rclone doesn't answer", async () => {
    // Removed by hand: the runtime manager has no container of it to restart.
    runtime.syncBases = runtime.syncBases.filter((n) => n !== "notes");
    rc.unreachable.add("notes");
    await due("notes");
    await tick();
    const starts = runtime.syncStarts.length;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + UNREACHABLE_MS + 1_000);
    try {
      await tick();
    } finally {
      clock.mockRestore();
    }
    expect(runtime.syncRestarts.at(-1)).toBe("notes");
    rc.unreachable.delete("notes");
    await tick();
    expect(runtime.syncStarts.slice(starts)).toEqual([["notes", "recipes"]]);
    await settled();
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("starts no run while its rclone runs one the server doesn't follow, as a server that stopped as it started one leaves", async () => {
    rc.hold = true;
    // Started in notes' rclone, never kept on its row.
    await rc.of("notes").call("sync/bisync", { ...bisyncParams("notes", "left"), _async: true, _group: "knowledge/notes/left/sync/abcd1234" });
    const runs = rc.started().length;
    await due("notes");
    await tick();
    await tick();
    expect(rc.started().length).toBe(runs);
    rc.finish();
    rc.hold = false;
    await tick();
    expect(rc.started().length).toBe(runs + 1);
    await settled();
    expect(rc.mostAtOnce).toBe(1);
  });

  it("connects and disconnects a knowledge base without waiting for, or stopping, another's run; its own run is stopped with its rclone", async () => {
    rc.hold = true;
    await due("notes");
    await tick();
    expect(rc.running().map((j) => j.knowledgeBase)).toEqual(["notes"]);
    const notes = rc.executeIdOf("notes");
    // Disconnecting recipes doesn't wait for notes' run, which goes on in its own rclone.
    expect((await api("/api/knowledge/recipes/sync", { method: "DELETE" })).status).toBe(204);
    expect(runtime.syncStarts.at(-1)).toEqual(["notes"]);
    expect(rc.executeIdOf("notes")).toBe(notes);
    expect(rc.running().map((j) => j.knowledgeBase)).toEqual(["notes"]);
    // Nor does connecting it again.
    rc.hold = false;
    expect((await send("/api/knowledge/recipes/sync", { folder: FOLDER }, "PUT")).status).toBe(202);
    await settled("recipes");
    expect(runtime.syncStarts.at(-1)).toEqual(["notes", "recipes"]);
    expect(rc.executeIdOf("notes")).toBe(notes);
    rc.finish();
    await settled();
    expect(await syncRow()).toMatchObject({ job: null, result: "synced" });

    // Disconnecting a knowledge base whose own run is under way stops its rclone, as Ctrl+C stops it,
    // which stops the run; the disconnect doesn't wait for the run to end.
    rc.hold = true;
    expect((await send("/api/knowledge/recipes/sync", { action: "sync" })).status).toBe(202);
    await tick();
    expect(rc.running().map((j) => j.knowledgeBase)).toEqual(["recipes"]);
    expect((await api("/api/knowledge/recipes/sync", { method: "DELETE" })).status).toBe(204);
    expect(runtime.syncStarts.at(-1)).toEqual(["notes"]);
    expect(rc.running()).toEqual([]);
    rc.hold = false;
    expect((await send("/api/knowledge/recipes/sync", { folder: FOLDER }, "PUT")).status).toBe(202);
    await settled("recipes");
  });

  it("disconnects the Google connection when Google refuses the token, until the owner signs in again", async () => {
    rc.answers = [{ success: false, error: "bisync aborted", lines: [{ level: "error", msg: 'Bisync critical error: couldn\'t list directory: couldn\'t fetch token: invalid_grant: maybe token expired? - try refreshing with "rclone config reconnect kb-notes:"' }] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(await (await api("/api/google-drive")).json()).toMatchObject({ state: "disconnected", problem: expect.stringContaining("invalid_grant") });
    expect(await status()).toMatchObject({ disconnected: true, result: "unauthorized", running: false });
    expect((await events("google.refused")).map((e) => e.actorId)).toEqual([operator]);
    // Nothing runs, and Sync now says to reconnect.
    const runs = rc.started().length;
    await due();
    await tick();
    expect(rc.started().length).toBe(runs);
    const refused = await send("/api/knowledge/notes/sync", { action: "sync" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toContain("Reconnect");

    rc.answers = [{ lines: [ok] }];
    const made = rc.calls.filter((c) => c.command === "config/create").length;
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    expect(await (await api("/api/google-drive")).json()).toMatchObject({ state: "connected", problem: null });
    await settled();
    await settled("recipes");
    // A new sign-in is a new token: each remote is made again with it.
    expect(rc.calls.filter((c) => c.command === "config/create").length).toBe(made + 2);
    expect(await status()).toMatchObject({ disconnected: false, result: "synced" });
  });

  it("doesn't disconnect a sign-in the owner made while a run had the earlier one Google refused", async () => {
    rc.hold = true;
    rc.answers = [{ success: false, error: "bisync aborted", lines: [{ level: "error", msg: "Bisync critical error: couldn't fetch token: invalid_grant: maybe token expired?" }] }];
    expect((await send("/api/knowledge/notes/sync", { action: "sync" })).status).toBe(202);
    await tick();
    expect(rc.running()).toHaveLength(1);
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    rc.finish();
    await tick();
    expect(await (await api("/api/google-drive")).json()).toMatchObject({ state: "connected", problem: null });
    expect(await status()).toMatchObject({ disconnected: false, result: "failed", detail: expect.stringContaining("replaced since") });
    expect((await events("google.refused")).map((e) => e.actorId)).toEqual([operator]);
    rc.hold = false;
    rc.answers = [{ lines: [ok] }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(await status()).toMatchObject({ result: "synced" });
  });

  it("still syncs after the data key is replaced: the client secret and token move to the new key", async () => {
    const previous = "previous-data-key-for-these-tests-012345678";
    const row = (await connection())!;
    const token = decrypt(TEST_DATA_KEY, row.token!);
    // As a server with the previous key left them.
    await t.db.update(googleConnection).set({ clientSecret: encrypt(previous, CLIENT_SECRET), token: encrypt(previous, token) });
    expect(await moveSettingsToDataKey(t.db, { dataKey: TEST_DATA_KEY, previousDataKey: previous })).toMatchObject({ moved: 2, unreadable: 0 });
    const moved = (await connection())!;
    expect(decrypt(TEST_DATA_KEY, moved.clientSecret)).toBe(CLIENT_SECRET);
    expect(() => decrypt(previous, moved.token!)).toThrow();
    // rclone restarted meanwhile, so the remote is made again, from the moved values.
    rc.restart();
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(rc.calls.filter((c) => c.command === "config/create").at(-1)!.params.parameters).toMatchObject({ client_secret: CLIENT_SECRET, token });
    expect(await status()).toMatchObject({ result: "synced" });
    // A second start leaves values on the current key.
    expect(await moveSettingsToDataKey(t.db, { dataKey: TEST_DATA_KEY })).toMatchObject({ moved: 0 });
  });

  it("fails a run, without starting one in rclone, when the connection can't be read with the data key", async () => {
    const row = (await connection())!;
    await t.db.update(googleConnection).set({ token: encrypt("a-key-that-is-gone-0123456789abcdefghij", "x") });
    rc.restart();
    const runs = rc.started().length;
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(rc.started().length).toBe(runs);
    expect(await status()).toMatchObject({ result: "failed", detail: expect.stringContaining("data key") });
    await t.db.update(googleConnection).set({ token: row.token });
  });

  it("takes a knowledge base out of the sync's service before deleting it, and starts no run of it meanwhile", async () => {
    expect((await send("/api/knowledge", { name: "drafts" })).status).toBe(201);
    expect((await send("/api/knowledge/drafts/sync", { folder: FOLDER }, "PUT")).status).toBe(202);
    await settled("drafts");
    expect(runtime.syncBases).toEqual(["drafts", "notes", "recipes"]);

    // While the delete applies apps again, neither the timer nor the owner starts a run of it.
    let release: () => void = () => {};
    runtime.holdKnowledgeUsers = new Promise<void>((resolve) => (release = resolve));
    const asked = runtime.calls.filter((c) => c.method === "knowledgeUsers").length;
    const runs = rc.started().length;
    const deleting = api("/api/knowledge/drafts", { method: "DELETE" });
    try {
      for (let i = 0; i < 200 && runtime.calls.filter((c) => c.method === "knowledgeUsers").length === asked; i++) await sleep(5);
      expect(runtime.calls.filter((c) => c.method === "knowledgeUsers").length).toBe(asked + 1);
      // It left the service first.
      expect(runtime.syncBases).toEqual(["notes", "recipes"]);
      await due();
      await tick();
      for (const action of ["sync", "resync"]) expect((await send("/api/knowledge/drafts/sync", { action })).status, action).toBe(409);
      expect((await api("/api/knowledge/drafts/sync", { method: "DELETE" })).status).toBe(409);
    } finally {
      // Even when a check above fails, so the delete ends and holds nothing for the tests after it.
      release();
      runtime.holdKnowledgeUsers = undefined;
    }
    expect((await deleting).status).toBe(204);
    expect(rc.started().slice(runs).filter((j) => j.params.path2 === "/knowledge/drafts")).toEqual([]);
    expect(runtime.calls.filter((c) => c.method === "deleteKnowledge" && c.project === "drafts")).toHaveLength(1);
    // The timer doesn't put it back.
    await settled();
    expect(runtime.syncBases).toEqual(["notes", "recipes"]);
  });

  it("puts a knowledge base back in the sync's service when its deletion fails", async () => {
    const users = runtime.knowledgeUsers.bind(runtime);
    runtime.knowledgeUsers = async () => {
      throw new Error("The engine can't be reached.");
    };
    try {
      expect((await api("/api/knowledge/recipes", { method: "DELETE" })).status).toBeGreaterThanOrEqual(500);
    } finally {
      runtime.knowledgeUsers = users;
    }
    expect(runtime.syncBases).toEqual(["notes"]);
    await tick();
    expect(runtime.syncBases).toEqual(["notes", "recipes"]);
  });

  it("removes the container a connect that failed left behind, so the knowledge base can be deleted", async () => {
    expect((await send("/api/knowledge", { name: "drafts" })).status).toBe(201);
    // Its container was made, and then didn't answer in time.
    runtime.failSyncServiceAfter = new RuntimeError("rclone-drafts didn't answer in time.", 503, "engine_error");
    try {
      expect((await send("/api/knowledge/drafts/sync", { folder: FOLDER }, "PUT")).status).toBe(503);
    } finally {
      runtime.failSyncServiceAfter = undefined;
    }
    expect(await syncRow("drafts")).toBeUndefined();
    expect(runtime.syncBases).toEqual(["drafts", "notes", "recipes"]);
    await tick();
    expect(runtime.syncBases).toEqual(["notes", "recipes"]);
    expect((await api("/api/knowledge/drafts", { method: "DELETE" })).status).toBe(204);
  });

  it("refuses to forget the connection while a knowledge base syncs through it", async () => {
    const refused = await api("/api/google-drive", { method: "DELETE" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toContain("Notes");
  });

  it("disconnects: the sync's state goes and both sides keep their files; deleting a knowledge base ends its sync", async () => {
    runtime.removedSyncs = [];
    expect((await api("/api/knowledge/notes/sync", { method: "DELETE" })).status).toBe(204);
    expect(runtime.removedSyncs).toEqual(["notes"]);
    expect(runtime.syncBases).toEqual(["recipes"]);
    expect(await status()).toBeNull();
    expect(runtime.knowledge.has("notes")).toBe(true);
    const disconnected = (await events("knowledge.disconnected")).map((e) => [e.actorId, e.knowledgeBase]);
    // Notes now, and recipes twice before.
    expect(disconnected).toHaveLength(3);
    expect(disconnected).toEqual(expect.arrayContaining([[owner, "notes"], [owner, "recipes"]]));

    expect((await api("/api/knowledge/recipes", { method: "DELETE" })).status).toBe(204);
    expect(await t.db.select().from(knowledgeSync)).toEqual([]);
    expect(runtime.syncBases).toEqual([]);
    expect((await api("/api/google-drive", { method: "DELETE" })).status).toBe(204);
    expect(await connection()).toBeUndefined();
  });

  it("forgets the Google connection only with no knowledge base syncing through it, one connecting meanwhile included", async () => {
    expect((await send("/api/google-drive", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, "PUT")).status).toBe(200);
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    expect((await send("/api/knowledge", { name: "journal" })).status).toBe(201);
    let release: () => void = () => {};
    runtime.holdRemoveSync = new Promise<void>((resolve) => (release = resolve));
    const cleared = () => runtime.calls.filter((c) => c.method === "removeSync" && c.project === "journal").length;
    const connecting = send("/api/knowledge/journal/sync", { folder: FOLDER }, "PUT");
    try {
      for (let i = 0; i < 200 && cleared() === 0; i++) await sleep(5);
      // The connect is clearing the earlier sync now, or the forget below wouldn't race it.
      expect(cleared()).toBe(1);
      // Forgotten while the connect clears the knowledge base's earlier sync: the connect then finds none.
      expect((await api("/api/google-drive", { method: "DELETE" })).status).toBe(204);
    } finally {
      release();
      runtime.holdRemoveSync = undefined;
    }
    const connected = await connecting;
    expect(connected.status).toBe(409);
    expect(((await connected.json()) as { error: string }).error).toBe("google_not_set_up");
    expect(await syncRow("journal")).toBeUndefined();
    expect(await connection()).toBeUndefined();
    expect(runtime.syncBases).toEqual([]);
  });
});
