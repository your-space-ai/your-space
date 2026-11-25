// Journey 015, slice 1: the GitHub connection. The owner connects a contents token from the GitHub
// page or the `github` server command, sees its account and state, and disconnects. The token is
// stored under the data key and never returned, printed or logged (R5).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, decrypt } from "../src/apps/settings.ts";
import { sourceCredential } from "../src/db/schema.ts";
import { GITHUB_TOKENS_URL } from "../src/github-connection.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { fakeGithubAccounts } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

// Synthetic tokens, shaped like nothing GitHub issues.
const TOKEN = "ys-fixture-contents-token-0001";
const NEXT_TOKEN = "ys-fixture-contents-token-0002";
const LOGIN = "ys-fixture-owner";
// A managed user's login ends in `_<shortcode>`.
const MANAGED_TOKEN = "ys-fixture-contents-token-0003";

describe("the GitHub page's API", () => {
  let t: TestDatabase;
  let server: TestServer;
  let cookie: string;
  let accounts: Map<string, string>;
  let github: ReturnType<typeof fakeGithubAccounts>;
  let reachable: boolean;
  const lines: string[] = [];

  beforeEach(async () => {
    t = await createTestDatabase();
    accounts = new Map([[TOKEN, LOGIN], [NEXT_TOKEN, LOGIN], [MANAGED_TOKEN, "ys-fixture_example"]]);
    github = fakeGithubAccounts(accounts);
    reachable = true;
    const fetcher: typeof fetch = (input, init) => (reachable ? github.fetch(input, init) : Promise.reject(new TypeError("offline")));
    server = await startServer(t.db, { github: { fetch: fetcher } });
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const login = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
    cookie = cookieHeader(login);
    lines.length = 0;
    for (const method of ["log", "error", "warn", "info"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    await t?.destroy();
  });

  const api = (method: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
    server.request("/api/github", { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function read(method: string, body?: unknown): Promise<{ status: number; text: string; json: any }> {
    const response = await api(method, body);
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  }
  const stored = async () => (await t.db.select().from(sourceCredential))[0];

  it("is for the signed-in owner, and changes only from Your Space's own pages", async () => {
    expect((await api("GET", undefined, {})).status).toBe(401);
    expect((await api("PUT", { token: TOKEN }, {})).status).toBe(401);
    expect((await api("PUT", { token: TOKEN }, { cookie, origin: "https://other.example" })).status).toBe(403);
    expect((await api("DELETE", undefined, { cookie, origin: "https://other.example" })).status).toBe(403);
    const status = await api("GET");
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(await status.json()).toEqual({ contents: { set: false } });
    expect(github.calls).toEqual([]);
  });

  it("connects with a token GitHub accepts, shows its login, and never returns or logs the token", async () => {
    const connected = await read("PUT", { token: `  ${TOKEN}\n` });
    expect(connected.status).toBe(200);
    expect(connected.json).toEqual({ contents: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: true } });
    expect(connected.text).not.toContain(TOKEN);
    // GitHub was asked only which account the token is, with the token as a bearer token.
    expect(github.calls).toEqual([{ url: "https://api.github.test/user", authorization: `Bearer ${TOKEN}` }]);
    const row = await stored();
    expect(row!.token).not.toContain(TOKEN);
    expect(decrypt(TEST_DATA_KEY, row!.token)).toBe(TOKEN);
    expect(row!.account).toBe(LOGIN);

    const status = await read("GET");
    expect(status.json).toEqual({ contents: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: true } });
    expect(status.text).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("connects a managed user, whose login has an underscore", async () => {
    expect((await read("PUT", { token: MANAGED_TOKEN })).json.contents).toMatchObject({ set: true, login: "ys-fixture_example", accepted: true });
  });

  it("refuses a token GitHub doesn't accept, or one that isn't a token, and stores nothing", async () => {
    const refused = await read("PUT", { token: "ys-fixture-unknown-token" });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe("token_refused");
    expect(refused.text).not.toContain("ys-fixture-unknown-token");
    expect((await read("PUT", { token: "" })).json.error).toBe("token_required");
    expect((await read("PUT", { token: "two words" })).json.error).toBe("token_invalid");
    expect((await read("PUT", { token: TOKEN, scope: "repo" })).status).toBe(400);
    reachable = false;
    const offline = await read("PUT", { token: TOKEN });
    expect(offline.status).toBe(503);
    expect(offline.json.error).toBe("github_unavailable");
    expect(await stored()).toBeUndefined();
  });

  it("shows Reconnect once GitHub refuses the token, and connecting a new one clears it", async () => {
    await read("PUT", { token: TOKEN });
    accounts.delete(TOKEN); // The owner deleted it at GitHub, or it expired.
    expect((await read("GET")).json).toEqual({ contents: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: false, problem: "refused" } });
    expect((await stored())!.refusedAt).not.toBeNull();
    // While GitHub can't be asked, the refusal it gave stands.
    reachable = false;
    expect((await read("GET")).json.contents).toMatchObject({ accepted: false, problem: "refused" });
    reachable = true;
    expect((await read("PUT", { token: NEXT_TOKEN })).json.contents).toMatchObject({ set: true, login: LOGIN, accepted: true });
    expect((await stored())!.refusedAt).toBeNull();
    expect(decrypt(TEST_DATA_KEY, (await stored())!.token)).toBe(NEXT_TOKEN);
  });

  it("says when GitHub can't be asked, without calling the token refused", async () => {
    await read("PUT", { token: TOKEN });
    reachable = false;
    expect((await read("GET")).json).toEqual({ contents: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: null, problem: "unreachable" } });
    expect((await stored())!.refusedAt).toBeNull();
  });

  it("shows Reconnect for a token no data key here can read, without asking GitHub, and still connects and disconnects", async () => {
    await read("PUT", { token: TOKEN });
    await t.db.update(sourceCredential).set({ token: encrypt("a-data-key-that-is-gone-0123456789abcdef", TOKEN) });
    github.calls.length = 0;
    expect((await read("GET")).json).toEqual({ contents: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: false, problem: "unreadable" } });
    expect(github.calls).toEqual([]);
    expect((await read("PUT", { token: NEXT_TOKEN })).json.contents.accepted).toBe(true);
    expect((await read("DELETE")).json).toEqual({ removed: true, contents: { set: false } });
  });

  it("disconnects by forgetting the token here", async () => {
    await read("PUT", { token: TOKEN });
    expect((await read("DELETE")).json).toEqual({ removed: true, contents: { set: false } });
    expect(await stored()).toBeUndefined();
    expect((await read("GET")).json).toEqual({ contents: { set: false } });
    expect((await read("DELETE")).json).toEqual({ removed: false, contents: { set: false } });
  });
});

describe("the github server command", () => {
  let t: TestDatabase;
  let github: Server;
  let api: string;
  let accounts: Map<string, string>;

  beforeAll(async () => {
    t = await createTestDatabase();
    accounts = new Map([[TOKEN, LOGIN]]);
    // The command runs as its own process, so GitHub stands in over HTTP, as in the browser tests.
    github = createServer((req, res) => {
      const login = req.url === "/user" ? accounts.get(String(req.headers.authorization).replace(/^Bearer /, "")) : undefined;
      if (!login) return void res.writeHead(401, { "Content-Type": "application/json" }).end('{"message":"Bad credentials"}');
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ login }));
    });
    await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
    api = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => github?.close(resolve));
    await t?.destroy();
  });

  const run = (args: string[], input?: string) => runCommand("github", args, { databaseUrl: t.url, input, env: { YS_E2E_GITHUB_API: api } });
  const output = (result: { stdout: string; stderr: string }) => result.stdout + result.stderr;

  it("needs an owner, whose workspace the connection belongs to", async () => {
    const result = await run(["status", "--json"]);
    expect(result.code).toBe(2);
    expect(result.json).toMatchObject({ ok: false, error: "no_owner" });
  });

  it("refuses a token given as an argument, without repeating it", async () => {
    for (const args of [["connect", TOKEN], ["connect", `--token=${TOKEN}`], ["connect", "--json", TOKEN], [TOKEN]]) {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(output(result)).not.toContain(TOKEN);
    }
    expect((await run(["connect", TOKEN])).stderr).toContain("standard input");
  });

  it("connects from standard input, reports status and disconnects, as the GitHub page does", async () => {
    await createOwnerWithPassword(t.db);
    const connected = await run(["connect", "--json"], `${TOKEN}\n`);
    expect(connected.code).toBe(0);
    expect(connected.json).toEqual({ ok: true, contents: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: true } });
    expect(output(connected)).not.toContain(TOKEN);

    const human = await run(["status"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain(`Connected as @${LOGIN}. GitHub accepts the token`);
    expect(output(human)).not.toContain(TOKEN);

    // The page reads the same connection.
    const server = await startServer(t.db);
    try {
      const login = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
      const page = await server.request("/api/github", { headers: { cookie: cookieHeader(login) } });
      // This server's stand-in is offline, so it reports what it last knew.
      expect(((await page.json()) as { contents: unknown }).contents).toMatchObject({ set: true, login: LOGIN, accepted: null, problem: "unreachable" });
    } finally {
      await server.close();
    }

    accounts.delete(TOKEN);
    expect((await run(["status", "--json"])).json.contents).toMatchObject({ set: true, accepted: false, problem: "refused" });
    expect((await run(["status"])).stdout).toContain("GitHub no longer accepts the token");

    const refused = await run(["connect", "--json"], "ys-fixture-unknown-token");
    expect(refused.code).toBe(2);
    expect(refused.json).toMatchObject({ ok: false, error: "token_refused" });
    expect((await run(["connect", "--json"])).json).toMatchObject({ ok: false, error: "token_required" });

    const disconnected = await run(["disconnect", "--json"]);
    expect(disconnected.code).toBe(0);
    expect(disconnected.json).toEqual({ ok: true, removed: true, contents: { set: false }, deleteAt: GITHUB_TOKENS_URL });
    expect((await run(["disconnect"])).stdout).toContain("no token to remove");
    expect((await run(["status", "--json"])).json).toEqual({ ok: true, contents: { set: false } });
  });
});
