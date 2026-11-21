import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cookieHeader, startServer } from "./helpers/server.ts";
import { OWNER, createOwnerWithPassword } from "./helpers/owner.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { getGithubClient, githubConnections } from "../src/repositories/connection.ts";
import { GithubClient, publicGithubClient } from "../src/repositories/github.ts";

let database: TestDatabase;
let actor: string;
const key = "fixture-storage-key";
const device = {
  device_code: "fixture-device-secret",
  user_code: "TST-CODE",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};
beforeEach(async () => {
  database = await createTestDatabase();
  await createOwnerWithPassword(database.db);
  actor = (await database.pool.query("select id from actor where kind='human'")).rows[0].id;
  vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "fixture-client");
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await database.destroy();
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const ready = () =>
  database.pool.query("update github_device set next_poll_at=now()-interval '1 second' where owner_id=$1", [actor]);

it("binds device authorization to the owner's session, throttles polls, and stores ciphertext", async () => {
  const service = githubConnections(database.db, key);
  const owner = { actorId: actor, sessionId: "first" };
  const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(response(device));
  vi.stubGlobal("fetch", upstream);
  const start = await service.start(owner, false);
  expect(start).toMatchObject({ userCode: "TST-CODE", verificationUri: device.verification_uri });
  expect(JSON.stringify(start)).not.toContain(device.device_code);
  const stored = (await database.pool.query("select device_code from github_device where owner_id=$1", [actor])).rows[0]
    .device_code;
  expect(stored).toMatch(/^v2\./);
  expect(stored).not.toContain(device.device_code);
  await expect(service.poll({ ...owner, sessionId: "second" }, start.attemptId)).rejects.toMatchObject({
    code: "connection_expired",
  });
  expect(await service.poll(owner, start.attemptId)).toMatchObject({ status: "pending" });
  expect(upstream).toHaveBeenCalledTimes(1);

  await ready();
  upstream.mockResolvedValueOnce(response({ error: "slow_down", interval: 10 }));
  expect(await service.poll(owner, start.attemptId)).toEqual({ status: "pending", intervalSeconds: 10 });
  await ready();
  upstream
    .mockResolvedValueOnce(response({ token_type: "bearer", scope: "public_repo", access_token: "fixture-token" }))
    .mockResolvedValueOnce(response({ id: 13, login: "example" }));
  const result = await service.poll(owner, start.attemptId);
  expect(result).toEqual({ status: "connected", scope: "public_repo", login: "example" });
  const state = await service.state(owner);
  expect(state).toEqual({ configured: true, connected: true, scope: "public_repo", login: "example" });
  const secret = (await database.pool.query("select credential from github_connection where owner_id=$1", [actor]))
    .rows[0].credential;
  expect(secret).toMatch(/^v2\./);
  expect(secret).not.toContain("fixture-token");
  const client = await getGithubClient(database.db, actor, key);
  expect(client.accountId).toBe("13");
  expect(JSON.stringify(client)).not.toContain("fixture-token");
  await service.disconnect(owner);
  expect(await service.state(owner)).toEqual({ configured: true, connected: false });
  await expect(getGithubClient(database.db, actor, key)).rejects.toMatchObject({ code: "github_not_connected" });
});

it("rejects broader scopes and prevents a late upstream success from undoing a disconnect", async () => {
  const service = githubConnections(database.db, key),
    owner = { actorId: actor, sessionId: "fixture" };
  const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(response(device));
  vi.stubGlobal("fetch", upstream);
  const first = await service.start(owner, false);
  await ready();
  upstream.mockResolvedValueOnce(response({ token_type: "bearer", scope: "repo", access_token: "fixture-private" }));
  await expect(service.poll(owner, first.attemptId)).rejects.toMatchObject({ code: "github_scope_changed" });
  expect((await service.state(owner)).connected).toBe(false);

  upstream.mockResolvedValueOnce(response(device));
  const second = await service.start(owner, true);
  expect(String(upstream.mock.calls.at(-1)?.[1]?.body)).toContain("scope=repo");
  await ready();
  let resume!: (result: Response) => void;
  let received!: () => void;
  const requested = new Promise<void>((resolve) => {
    received = resolve;
  });
  upstream
    .mockImplementationOnce(async () => {
      received();
      return new Promise<Response>((resolve) => {
        resume = resolve;
      });
    })
    .mockResolvedValueOnce(response({ id: 82, login: "example" }));
  const polling = service.poll(owner, second.attemptId);
  await requested;
  await service.disconnect(owner);
  resume(response({ token_type: "bearer", scope: "repo", access_token: "fixture-private" }));
  await expect(polling).rejects.toMatchObject({ code: "connection_expired" });
  expect((await service.state(owner)).connected).toBe(false);
});

it("keeps public discovery uncredentialed and managed writes bound to the immutable ID", async () => {
  const upstream = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", upstream);
  const publicClient = publicGithubClient(),
    hash = "a".repeat(40);
  upstream.mockResolvedValueOnce(
    response({
      truncated: false,
      tree: [
        { type: "blob", mode: "100644", path: "apps/someone/sample.yaml" },
        { type: "blob", mode: "120000", path: "apps/someone/symlink.yaml" },
        { type: "blob", mode: "100644", path: "somewhere/other.yaml" },
      ],
    }),
  );
  expect(await publicClient.kitPaths("owner/catalog", hash)).toEqual(["apps/someone/sample.yaml"]);
  expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
  expect(upstream.mock.calls[0]?.[1]?.redirect).toBe("error");
  upstream.mockResolvedValueOnce(response({ truncated: true, tree: [] }));
  await expect(publicClient.kitPaths("owner/catalog", hash)).rejects.toMatchObject({ code: "catalog_incomplete" });
  const connected = new GithubClient("fixture-token", "13", "public_repo");
  const edit = { content: "example", message: "Update file", branch: "main", sha: hash };
  await expect(connected.put("name/changed", "app.yaml", edit)).rejects.toMatchObject({ status: 400 });
  await expect(connected.put("19", "../unsafe", edit)).rejects.toMatchObject({ status: 400 });
  await expect(connected.create("test", true)).rejects.toMatchObject({ status: 400 });
  upstream.mockResolvedValueOnce(response({ commit: { sha: hash }, content: { sha: hash } }));
  expect(await connected.put("19", "apps/app.yaml", edit)).toEqual({ commit: hash, sha: hash });
  const [url, options] = upstream.mock.calls.at(-1)!;
  expect(url).toBe("https://api.github.com/repositories/19/contents/apps/app.yaml");
  expect(JSON.parse(String(options?.body))).toMatchObject({ sha: hash, branch: "main" });
  upstream.mockResolvedValueOnce(response({ message: "fixture private internal detail" }, 409));
  await expect(connected.put("19", "app.yaml", edit)).rejects.toMatchObject({ code: "github_conflict" });
});

it("requires an owner and same-origin JSON at the mounted connection API", async () => {
  const server = await startServer(database.db);
  try {
    const base = "/api/repositories/connection";
    expect((await server.request(base)).status).toBe(401);
    const login = await server.request("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    });
    const headers = { cookie: cookieHeader(login) };
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    expect(await (await server.request(base, { headers })).json()).toMatchObject({
      configured: true,
      connected: false,
    });
    expect(
      (
        await server.request(base + "/start", {
          method: "POST",
          headers: { ...headers, origin: "https://elsewhere.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await server.request(base + "/start", {
          method: "POST",
          headers: { ...headers, "content-type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (await server.request(base + "/start", { method: "POST", headers, body: '{"privateRepos":"yes"}' })).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    upstream.mockResolvedValueOnce(response(device));
    const started = await server.request(base + "/start", { method: "POST", headers, body: '{"privateRepos":true}' });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({
      userCode: device.user_code,
      verificationUri: device.verification_uri,
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((await server.request(base, { method: "DELETE", headers, body: "{}" })).status).toBe(200);
  } finally {
    await server.close();
  }
});
