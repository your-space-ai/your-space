// Journey 014, slice 2: synced knowledge bases. The owner saves the operator's OAuth client, signs in
// with Google through a state and PKCE that only their session can finish, and connects knowledge
// bases to Drive folders. The client secret and token are stored encrypted with the data key, move to
// a new data key, reach only the runtime manager's sync, and are never answered. Runs are one at a
// time per knowledge base; a stopped one waits for the owner; Google's refusal disconnects the
// connection until the owner signs in again. The runtime is a fake that records each run.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { authorizationUrl, challengeOf, DRIVE_SCOPE, folderIdOf, GoogleError, rcloneToken, SignIns } from "../src/apps/google.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { KnowledgeSync } from "../src/apps/knowledge-sync.ts";
import { decrypt, encrypt } from "../src/apps/settings.ts";
import { actor, event, eventKnowledgeBase, googleConnection, knowledgeSync } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
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
let t: TestDatabase;
let server: TestServer;
let cookie: string;
let owner: string;
let operator: string;
/** What Google's token endpoint was sent, and what it answers. */
let exchanged: URLSearchParams[] = [];
let tokenAnswer: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };

const fakeGoogle: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url !== "https://oauth2.google.test/token") throw new Error(`Unexpected request to ${url}`);
  const form = new URLSearchParams(String(init?.body));
  exchanged.push(form);
  return new Response(JSON.stringify(tokenAnswer.body), { status: tokenAnswer.status, headers: { "content-type": "application/json" } });
};

beforeAll(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db, { apps: { runtime, fetch: fakeGoogle } });
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
  tokenAnswer = { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer", scope: DRIVE_SCOPE } };
});

const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
const send = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });
const sync = () => KnowledgeSync.for(server.apps!);
const connection = async () => (await t.db.select().from(googleConnection))[0];
const syncRow = async () => (await t.db.select().from(knowledgeSync))[0];
const status = async (name = "notes") => ((await (await api(`/api/knowledge/${name}`)).json()) as { sync: Record<string, unknown> | null }).sync;
const events = (type: string) =>
  t.db.select({ actorId: event.actorId, knowledgeBase: eventKnowledgeBase.name }).from(event).leftJoin(eventKnowledgeBase, eq(eventKnowledgeBase.eventId, event.id)).where(eq(event.type, type));

/** Waits for every run under way to end. */
async function settled(name = "notes"): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const current = await status(name);
    if (!current?.running) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("The sync didn't finish.");
}

/** Signs in with Google as the owner's browser would: Google sends it back with the state and a code. */
async function signInWithGoogle(): Promise<string> {
  const { url } = (await (await send("/api/google-drive/authorize", {})).json()) as { url: string };
  const asked = new URL(url);
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
    const row = (await connection())!;
    expect(row.token).not.toContain(REFRESH);
    expect(JSON.parse(decrypt(TEST_DATA_KEY, row.token!))).toMatchObject({ access_token: ACCESS, refresh_token: REFRESH, expiry: expect.any(String) });
    const answered = await (await api("/api/google-drive")).text();
    for (const secret of [CLIENT_SECRET, ACCESS, REFRESH]) expect(answered).not.toContain(secret);
    expect(JSON.parse(answered)).toMatchObject({ state: "connected" });
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

  it("connects only to a Drive folder's link, through the Google connection, never another remote", async () => {
    for (const body of [{ folder: "https://drive.google.com/drive/my-drive" }, { folder: FOLDER, type: "local" }, { folder: FOLDER, remote: { type: "alias", remote: "/" } }]) {
      const refused = await send("/api/knowledge/notes/sync", body, "PUT");
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
    expect(await syncRow()).toBeUndefined();
    expect(runtime.syncs).toEqual([]);
  });

  it("starts with a resync that gets the decrypted client and token, which nothing answers", async () => {
    const connected = await send("/api/knowledge/notes/sync", { folder: `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing` }, "PUT");
    expect(connected.status).toBe(202);
    await settled();
    expect(runtime.removedSyncs).toEqual(["notes"]);
    expect(runtime.syncs).toHaveLength(1);
    const { request } = runtime.syncs[0]!;
    expect(request.mode).toBe("resync");
    expect(request.remote).toMatchObject({ type: "drive", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, folderId: FOLDER });
    expect(JSON.parse(request.remote.token)).toMatchObject({ refresh_token: REFRESH });
    const shown = await status();
    expect(shown).toMatchObject({ folderId: FOLDER, folderUrl: `https://drive.google.com/drive/folders/${FOLDER}`, result: "synced", firstRun: false, running: false });
    const listed = await (await api("/api/knowledge")).text();
    for (const secret of [CLIENT_SECRET, ACCESS, REFRESH]) expect(listed).not.toContain(secret);
    expect((await events("knowledge.connected")).map((e) => [e.actorId, e.knowledgeBase])).toEqual([[owner, "notes"]]);
    // Connected already: another folder needs a disconnect first.
    expect((await send("/api/knowledge/notes/sync", { folder: FOLDER }, "PUT")).status).toBe(409);
  });

  it("runs once at a time, and a Sync now during a run runs once more after it", async () => {
    runtime.syncs = [];
    runtime.holdSync = true;
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await new Promise((r) => setTimeout(r, 20));
    expect((await status())!.running).toBe(true);
    // The scheduled run doesn't start another while it runs, and Resync waits for it.
    await sync().scheduled();
    expect((await send("/api/knowledge/notes/sync", { action: "resync" })).status).toBe(409);
    expect((await api("/api/knowledge/notes", { method: "DELETE" })).status).toBe(409);
    expect((await api("/api/knowledge/notes/sync", { method: "DELETE" })).status).toBe(409);
    expect((await send("/api/knowledge/notes/sync", { action: "sync" })).status).toBe(202);
    expect((await send("/api/knowledge/notes/sync", { action: "sync" })).status).toBe(202);
    expect(runtime.syncs).toHaveLength(1);
    runtime.holdSync = false;
    runtime.releaseSync();
    for (let i = 0; i < 100 && runtime.syncs.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    runtime.releaseSync();
    await settled();
    expect(runtime.syncs.map((s) => s.request.mode)).toEqual(["sync", "sync"]);
  });

  it("records each run against Your Space, the owner's actions against the owner, and only runs that changed something", async () => {
    const before = (await events("knowledge.synced")).length;
    runtime.syncAnswers = [{ changed: false }];
    await sync().scheduled();
    expect((await events("knowledge.synced")).length).toBe(before);
    runtime.syncAnswers = [{ changed: true }];
    await sync().scheduled();
    const synced = await events("knowledge.synced");
    expect(synced.length).toBe(before + 1);
    expect(synced.at(-1)).toEqual({ actorId: operator, knowledgeBase: "notes" });
  });

  it("keeps a stopped run's reason and deletions, waits for the owner, and applies only the deletions confirmed", async () => {
    const deletions = [{ side: "local", path: "a.md" }, { side: "local", path: "b.md" }] as const;
    runtime.syncAnswers = [{ result: "stopped", reason: "max_delete", side: "local", message: "too many deletes (>50%, 2 of 3) on Path2", deletions: [...deletions], conflicts: ["plan.md.conflict1"] }];
    await sync().scheduled();
    const stopped = (await status())!;
    expect(stopped).toMatchObject({ result: "stopped", reason: "max_delete", side: "local", deletions, conflicts: ["plan.md.conflict1"], detail: "too many deletes (>50%, 2 of 3) on Path2" });
    expect(stopped.summary).toContain("More than half of the files were deleted in the knowledge base");
    expect((await events("knowledge.sync_stopped")).at(-1)).toEqual({ actorId: operator, knowledgeBase: "notes" });

    // The schedule leaves it for the owner.
    runtime.syncs = [];
    await sync().scheduled();
    expect(runtime.syncs).toEqual([]);

    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", deletions: "all" })).status).toBe(400);
    runtime.syncAnswers = [{ result: "synced", changed: true }];
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", deletions })).status).toBe(202);
    await settled();
    expect(runtime.syncs.at(-1)!.request).toMatchObject({ mode: "force", confirm: deletions });
    expect(await status()).toMatchObject({ result: "synced", deletions: [] });
    expect((await events("knowledge.deletions_applied")).map((e) => e.actorId)).toEqual([owner]);
    // Nothing left to apply.
    expect((await send("/api/knowledge/notes/sync", { action: "apply_deletions", deletions })).status).toBe(409);
  });

  it("resyncs when the owner asks, which deletes nothing", async () => {
    runtime.syncAnswers = [{ result: "stopped", reason: "marker", side: "local" }];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect((await status())!.summary).toContain("marker file, .your-space-sync, is missing in the knowledge base");
    runtime.syncAnswers = [{ result: "synced", ties: ["same.md"] }];
    await send("/api/knowledge/notes/sync", { action: "resync" });
    await settled();
    expect(runtime.syncs.at(-1)!.request.mode).toBe("resync");
    expect(await status()).toMatchObject({ result: "synced", ties: ["same.md"] });
    expect((await events("knowledge.resync_requested")).map((e) => e.actorId)).toEqual([owner]);
  });

  it("disconnects the Google connection when Google refuses the token, until the owner signs in again", async () => {
    runtime.syncAnswers = [{ result: "unauthorized", message: "couldn't fetch token: invalid_grant: maybe token expired?" }];
    await sync().scheduled();
    expect(await (await api("/api/google-drive")).json()).toMatchObject({ state: "disconnected", problem: expect.stringContaining("invalid_grant") });
    expect(await status()).toMatchObject({ disconnected: true, result: "unauthorized" });
    expect((await events("google.refused")).map((e) => e.actorId)).toEqual([operator]);
    // Nothing runs, and Sync now says to reconnect.
    runtime.syncs = [];
    await sync().scheduled();
    expect(runtime.syncs).toEqual([]);
    const refused = await send("/api/knowledge/notes/sync", { action: "sync" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toContain("Reconnect");

    runtime.syncAnswers = [{ result: "synced" }];
    expect(await signInWithGoogle()).toBe(`${server.publicUrl}/knowledge?google=connected`);
    expect(await (await api("/api/google-drive")).json()).toMatchObject({ state: "connected", problem: null });
    await sync().scheduled();
    expect(runtime.syncs).toHaveLength(1);
    expect(await status()).toMatchObject({ disconnected: false, result: "synced" });
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
    runtime.syncs = [];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(runtime.syncs[0]!.request.remote).toMatchObject({ clientSecret: CLIENT_SECRET, token });
    expect(await status()).toMatchObject({ result: "synced" });
    // A second start leaves values on the current key.
    expect(await moveSettingsToDataKey(t.db, { dataKey: TEST_DATA_KEY })).toMatchObject({ moved: 0 });
  });

  it("fails a run, without calling the runtime, when the connection can't be read with the data key", async () => {
    const row = (await connection())!;
    await t.db.update(googleConnection).set({ token: encrypt("a-key-that-is-gone-0123456789abcdefghij", "x") });
    runtime.syncs = [];
    await send("/api/knowledge/notes/sync", { action: "sync" });
    await settled();
    expect(runtime.syncs).toEqual([]);
    expect(await status()).toMatchObject({ result: "failed", detail: expect.stringContaining("data key") });
    await t.db.update(googleConnection).set({ token: row.token });
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
    expect(await status()).toBeNull();
    expect(runtime.knowledge.has("notes")).toBe(true);
    expect((await events("knowledge.disconnected")).map((e) => [e.actorId, e.knowledgeBase])).toEqual([[owner, "notes"]]);

    expect((await send("/api/knowledge/recipes/sync", { folder: FOLDER }, "PUT")).status).toBe(202);
    await settled("recipes");
    expect((await api("/api/knowledge/recipes", { method: "DELETE" })).status).toBe(204);
    expect(await syncRow()).toBeUndefined();
    expect((await api("/api/google-drive", { method: "DELETE" })).status).toBe(204);
    expect(await connection()).toBeUndefined();
  });
});
