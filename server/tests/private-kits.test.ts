// Journey 015, slice 2: private kits. A kit's link is read from public GitHub first, and through the
// GitHub connection only when GitHub shows no such repository without it (R1, R2). The review labels
// a kit read through the connection, the installed app records how each file was read (R4), and each
// problem has its own message. A public kit never touches the connection.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSourceWith } from "../src/apps/github.ts";
import { encrypt } from "../src/apps/settings.ts";
import { app, installJob, sourceCredential } from "../src/db/schema.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { COMMIT, fakeGithub, fakeGithubAccounts, FakeRuntime, kitLink, plainKit } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

// Synthetic tokens with GitHub's prefix, far too short to be real ones.
const TOKEN = "github_pat_ys_fixture_contents_0001";
const LOGIN = "ys-fixture-owner";
const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    environment:
      GREETING: \${GREETING:-hello}
`;
const privateKit = (name: string) => `kit: 1\nsource: { repo: ys-fixtures/plain, path: compose.yaml, commit: ${COMMIT} }\nname: ${name}\ninterface: { service: web, port: 80 }\n`;
const PRIVATE_LINK = "https://github.com/ys-fixtures/private-kits/blob/main/kits/notes.yaml";
const PUBLIC_LINK = kitLink("plain");

describe("private kits through the GitHub connection", () => {
  let t: TestDatabase;
  let server: TestServer;
  let cookie: string;
  let calls: { url: string; authorization: string | null; accept: string | null }[];
  let refused: Set<string>;
  let answer: ((url: URL, token: string | null) => Response | undefined) | undefined;
  let hold: ((url: string) => Promise<void>) | undefined;
  let files: typeof fetch;
  const lines: string[] = [];

  beforeEach(async () => {
    t = await createTestDatabase();
    calls = [];
    refused = new Set();
    answer = undefined;
    hold = undefined;
    files = fakeGithub(
      {
        "ys-fixtures/plain/compose.yaml": COMPOSE,
        ...plainKit("plain"),
        "ys-fixtures/private-kits/kits/notes.yaml": privateKit("notes"),
        "ys-fixtures/private-kits/kits/second.yaml": privateKit("second"),
        "ys-fixtures/private-kits/kits/big.yaml": `${privateKit("big")}#${"x".repeat(256 * 1024)}\n`,
        "ys-fixtures/private-other/kit.yaml": privateKit("other"),
      },
      { private: { "ys-fixtures/private-kits": [TOKEN], "ys-fixtures/private-other": [] }, refused, calls, answer: (url, token) => answer?.(url, token) },
    );
    const accounts = fakeGithubAccounts(new Map([[TOKEN, LOGIN]]));
    // GitHub refuses a refused token on `GET /user` too.
    const github: typeof fetch = async (input, init) => {
      const answer = await files(input, init);
      await hold?.(String(input));
      return answer.status === 404 && String(input).endsWith("/user") ? accounts.fetch(input, init) : answer;
    };
    server = await startServer(t.db, { apps: { runtime: new FakeRuntime(), fetch: github } });
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

  const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
  async function review(link: string): Promise<{ status: number; text: string; json: any }> {
    const response = await api("/api/kits/preview", { method: "POST", body: JSON.stringify({ kitUrl: link }) });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  }
  async function connect(): Promise<void> {
    expect((await api("/api/github", { method: "PUT", body: JSON.stringify({ token: TOKEN }) })).status).toBe(200);
    calls.length = 0;
  }
  async function install(previewId: string): Promise<string> {
    const response = await api("/api/apps", { method: "POST", body: JSON.stringify({ previewId }) });
    expect(response.status).toBe(202);
    const { name } = (await response.json()) as { name: string };
    for (let i = 0; i < 500; i++) {
      const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
      if (running.length === 0) return name;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("The install didn't finish.");
  }
  const stored = async () => (await t.db.select().from(sourceCredential))[0]!;
  const withToken = () => calls.filter((c) => c.authorization !== null);

  it("asks the owner to connect GitHub for a kit public GitHub doesn't show", async () => {
    const hidden = await review(PRIVATE_LINK);
    expect(hidden.status).toBe(404);
    expect(hidden.json).toEqual({
      error: "not_connected",
      message: "Your Space can't find ys-fixtures/private-kits, or that branch, tag or commit in it, on public GitHub. If the repository is private, connect GitHub with a token that can read it, then try again.",
    });
    expect(withToken()).toEqual([]);
  });

  it("reads a private kit through the connection, labels it, and records how each file was read", async () => {
    await connect();
    const before = (await stored()).workedAt;
    const { status, text, json } = await review(PRIVATE_LINK);
    expect(status, text).toBe(200);
    expect(json.kit).toEqual({
      source: `https://github.com/ys-fixtures/private-kits/blob/${COMMIT}/kits/notes.yaml`,
      repo: "ys-fixtures/private-kits",
      path: "kits/notes.yaml",
      commit: COMMIT,
      read: { read: "connection", login: LOGIN },
    });
    // Its Compose file is public, so it is read anonymously.
    expect(json.source).toMatchObject({ repo: "ys-fixtures/plain", commit: COMMIT, read: { read: "anonymous" } });
    expect(text).not.toContain(TOKEN);

    // Public first: the anonymous read found nothing, then the connection resolved the ref with the
    // commits API and read the file with the contents API, as raw text. Nothing else had the token.
    expect(calls.map((c) => [c.url, c.authorization, c.accept])).toEqual([
      ["https://api.github.test/repos/ys-fixtures/private-kits/commits/main", null, "application/vnd.github.sha"],
      ["https://api.github.test/repos/ys-fixtures/private-kits/commits/main%2Fkits", null, "application/vnd.github.sha"],
      ["https://api.github.test/repos/ys-fixtures/private-kits/commits/main", `Bearer ${TOKEN}`, "application/vnd.github.sha"],
      [`https://api.github.test/repos/ys-fixtures/private-kits/contents/kits/notes.yaml?ref=${COMMIT}`, `Bearer ${TOKEN}`, "application/vnd.github.raw+json"],
      [`https://raw.github.test/ys-fixtures/plain/${COMMIT}/compose.yaml`, null, "text/plain"],
    ]);
    // The read is when the token last worked.
    expect((await stored()).workedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());

    const name = await install(json.previewId);
    const [row] = await t.db.select().from(app).where(eq(app.name, name));
    expect(row!.provenance).toEqual({ kit: { read: "connection", login: LOGIN }, compose: { read: "anonymous" } });
    expect(row!.kitSource).toBe(json.kit.source);
    const detail = (await (await api(`/api/apps/${name}`)).json()) as any;
    expect(detail.provenance).toEqual({ kit: { read: "connection", login: LOGIN }, compose: { read: "anonymous" } });
    expect(JSON.stringify(detail)).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("says when GitHub doesn't show the repository to the connection, or the file or ref isn't there", async () => {
    await connect();
    const notVisible = await review("https://github.com/ys-fixtures/private-other/blob/main/kit.yaml");
    expect(notVisible.status).toBe(404);
    expect(notVisible.json).toMatchObject({
      error: "repository_not_visible",
      message: expect.stringMatching(/^GitHub doesn't show ys-fixtures\/private-other to your GitHub connection \(@ys-fixture-owner\)\. Check the link, and that the token can read ys-fixtures\/private-other/),
    });
    const missing = await review("https://github.com/ys-fixtures/private-kits/blob/main/kits/missing.yaml");
    expect(missing.status).toBe(404);
    expect(missing.json).toEqual({ error: "file_missing", message: "There is no file kits/missing.yaml in ys-fixtures/private-kits at main." });
    const noRef = await review("https://github.com/ys-fixtures/private-kits/blob/nope/kits/notes.yaml");
    expect(noRef.status).toBe(404);
    expect(noRef.json).toEqual({ error: "not_found", message: "Your Space can't find that branch, tag or commit in ys-fixtures/private-kits." });
    // In a public repository, a file or a branch that isn't there is missing; the connection isn't asked.
    calls.length = 0;
    const publicMissing = await review(kitLink("nope"));
    expect(publicMissing.json).toEqual({ error: "file_missing", message: "There is no file apps/ys-fixtures/nope.yaml in ys-fixtures/catalog at main." });
    const publicNoRef = await review(PUBLIC_LINK.replace("/main/", "/nope/"));
    expect(publicNoRef.json).toEqual({ error: "not_found", message: "Your Space can't find that branch, tag or commit in ys-fixtures/catalog." });
    expect(withToken()).toEqual([]);
    // The same limits as a public kit's file.
    const big = await review("https://github.com/ys-fixtures/private-kits/blob/main/kits/big.yaml");
    expect(big.json).toEqual({ error: "source", message: "kits/big.yaml is larger than a kit or Compose file should be." });
  });

  it("tells GitHub's other answers to the token apart, and none of them marks it refused", async () => {
    await connect();
    const commits = (url: URL) => url.pathname.startsWith("/repos/ys-fixtures/private-kits/commits");
    const cases: [string, (url: URL, token: string | null) => Response | undefined, number, object][] = [
      // An organization that requires approving the token, or single sign-on, refuses the repository to it.
      [
        "organization",
        (_url, token) => (token ? Response.json({ message: "Resource protected by organization SAML enforcement." }, { status: 403 }) : undefined),
        404,
        { error: "repository_not_visible", message: expect.stringMatching(/^GitHub doesn't show ys-fixtures\/private-kits to your GitHub connection \(@ys-fixture-owner\)/) },
      ],
      [
        "rate limit",
        (_url, token) => (token ? Response.json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } }) : undefined),
        400,
        { error: "source", message: "GitHub is limiting requests from this machine. Try again in a few minutes." },
      ],
      // A secondary rate limit has requests left, and says when to retry.
      [
        "secondary rate limit",
        (_url, token) =>
          token ? Response.json({ message: "You have exceeded a secondary rate limit." }, { status: 403, headers: { "retry-after": "60", "x-ratelimit-remaining": "4999" } }) : undefined,
        400,
        { error: "source", message: "GitHub is limiting requests from this machine. Try again in a few minutes." },
      ],
      // Every ref answers 404, but the repository's latest commit is there: the ref is what's missing.
      [
        "missing ref",
        (url, token) => (token && commits(url) && !url.searchParams.has("per_page") ? new Response("", { status: 404 }) : undefined),
        404,
        { error: "not_found", message: "Your Space can't find that branch, tag or commit in ys-fixtures/private-kits." },
      ],
      [
        "empty repository",
        (url, token) => (token && commits(url) ? Response.json({ message: "Git Repository is empty." }, { status: 409 }) : undefined),
        404,
        { error: "not_found", message: "Your Space can't find that branch, tag or commit in ys-fixtures/private-kits." },
      ],
      // A renamed or transferred repository: the redirect isn't followed with the token.
      [
        "moved",
        (url, token) => (token && commits(url) ? new Response(null, { status: 301, headers: { location: "https://api.github.test/repositories/1/commits/main" } }) : undefined),
        400,
        { error: "source", message: "GitHub says ys-fixtures/private-kits has moved: it was renamed or transferred. Use the link from its new place on GitHub." },
      ],
    ];
    for (const [name, given, status, body] of cases) {
      answer = given;
      const { status: got, json } = await review(PRIVATE_LINK);
      expect([name, got, json]).toEqual([name, status, body]);
    }
    expect((await stored()).refusedAt).toBeNull();
  });

  it("refuses a link whose path steps out of its repository, before asking GitHub", async () => {
    await connect();
    for (const link of [
      "https://github.com/ys-fixtures/private-kits/blob/main/k%2F..%2F..%2F..%2F..%2F..%2Fuser%2Frepos",
      `https://github.com/ys-fixtures/catalog/blob/main/x%2F..%2F..%2F..%2F..%2Fys-fixtures%2Fplain%2F${COMMIT}%2Fcompose.yaml`,
      "https://raw.githubusercontent.com/ys-fixtures/private-kits/main/..%2Fkit.yaml",
      // %2e%2e parts the URL parser resolves would read ys-fixtures/private-other under this link.
      "https://github.com/ys-fixtures/private-kits/blob/main/%2e%2e/%2e%2e/%2e%2e/private-other/blob/main/kit.yaml",
    ]) {
      const { status, json } = await review(link);
      expect([link, status, json.error]).toEqual([link, 400, "source"]);
    }
    expect(calls).toEqual([]);
  });

  it("keeps a refusal that a read begun before it finishes after", async () => {
    await connect();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const held = new Promise<void>((resolve) => (reached = resolve));
    // The first read's file answers while GitHub still accepts the token, then waits.
    hold = async (url) => {
      if (!url.includes("/contents/")) return;
      hold = undefined;
      reached();
      await released;
    };
    const first = review(PRIVATE_LINK);
    await held;
    refused.add(TOKEN);
    expect((await review(PRIVATE_LINK)).json.error).toBe("token_refused");
    release();
    expect((await first).status).toBe(200);
    expect((await stored()).refusedAt).not.toBeNull();
  });

  it("marks a token GitHub refuses, shows Reconnect, and still installs a public kit", async () => {
    await connect();
    refused.add(TOKEN);
    const hidden = await review(PRIVATE_LINK);
    expect(hidden.status).toBe(409);
    expect(hidden.json).toEqual({
      error: "token_refused",
      message: `GitHub no longer accepts your GitHub connection's token (@${LOGIN}): it expired, or it was deleted or revoked. Create a new token and connect GitHub again, then try again.`,
    });
    expect((await stored()).refusedAt).not.toBeNull();
    // The GitHub page shows Reconnect.
    expect(((await (await api("/api/github")).json()) as any).contents).toMatchObject({ set: true, accepted: false, problem: "refused" });

    calls.length = 0;
    // A public link with a branch its repository doesn't have says so, rather than asking for a new token.
    expect((await review(PUBLIC_LINK.replace("/main/", "/nope/"))).json).toMatchObject({ error: "not_found" });
    const open = await review(PUBLIC_LINK);
    expect(open.status, open.text).toBe(200);
    expect(open.json.kit.read).toEqual({ read: "anonymous" });
    const name = await install(open.json.previewId);
    expect((await t.db.select().from(app).where(eq(app.name, name)))[0]!.provenance).toEqual({ kit: { read: "anonymous" }, compose: { read: "anonymous" } });
    expect(withToken()).toEqual([]);
  });

  it("tells the owner to reconnect when no data key reads the token, and still installs a public kit", async () => {
    await connect();
    await t.db.update(sourceCredential).set({ token: encrypt("a-data-key-that-is-gone-0123456789abcdefgh", TOKEN) });
    const hidden = await review(PRIVATE_LINK);
    expect(hidden.status).toBe(409);
    expect(hidden.json).toMatchObject({ error: "token_unreadable", message: expect.stringMatching(/Your GitHub connection \(@ys-fixture-owner\) can't read it: no data key here can read its token/) });
    const open = await review(PUBLIC_LINK);
    expect(open.status, open.text).toBe(200);
    await install(open.json.previewId);
    expect(withToken()).toEqual([]);
  });

  it("reads a private kit for the server command through the same connection, and says how to connect", async () => {
    // The command runs as its own process, so the stand-in is served to it over HTTP.
    const bridge = createServer(async (req, res) => {
      const [, host, ...rest] = req.url!.split("/");
      const answer = await files(`https://${host}.github.test/${rest.join("/")}`, { headers: req.headers as Record<string, string> });
      res.writeHead(answer.status).end(Buffer.from(await answer.arrayBuffer()));
    });
    await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
    const command = () =>
      runCommand("install-app", [PRIVATE_LINK, "--json"], { databaseUrl: t.url, env: { YS_E2E_GITHUB_API: `${at}/api`, YS_E2E_GITHUB_RAW: `${at}/raw` } });
    try {
      const unconnected = await command();
      expect(unconnected.json).toMatchObject({
        ok: false,
        error: "not_connected",
        message: expect.stringMatching(/connect GitHub with a token that can read it, then try again\. Connect GitHub with: docker compose exec server github connect\. Or give the kit file: install-app --kit - < kit\.yaml$/),
      });
      await connect();
      const connected = await command();
      // This test has no runtime manager, so the review stops after both files are read.
      expect(connected.json.error).toBe("runtime_unavailable");
      expect(calls.map((c) => [c.url, c.authorization])).toContainEqual([`https://api.github.test/repos/ys-fixtures/private-kits/contents/kits/notes.yaml?ref=${COMMIT}`, `Bearer ${TOKEN}`]);
      expect(connected.stdout + connected.stderr).not.toContain(TOKEN);
      refused.add(TOKEN);
      expect((await command()).json).toMatchObject({ error: "token_refused", message: expect.stringMatching(/Reconnect with: docker compose exec server github connect$/) });
    } finally {
      bridge.close();
    }
  });
});

describe("the GitHub connection's token", () => {
  it("never follows a redirect, and says the repository moved", async () => {
    const seen: { url: string; authorization: string | undefined }[] = [];
    const github = createServer((req, res) => {
      seen.push({ url: req.url!, authorization: req.headers.authorization });
      res.writeHead(301, { location: "/repositories/1/commits/main" }).end();
    });
    await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
    try {
      await expect(fetchSourceWith({ login: LOGIN, token: TOKEN }, PRIVATE_LINK, { api: at, raw: `${at}/raw` })).rejects.toThrow(
        "GitHub says ys-fixtures/private-kits has moved: it was renamed or transferred. Use the link from its new place on GitHub.",
      );
      expect(seen).toEqual([{ url: "/repos/ys-fixtures/private-kits/commits/main", authorization: `Bearer ${TOKEN}` }]);
    } finally {
      github.close();
    }
  });
});
