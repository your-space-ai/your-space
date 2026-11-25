// Journey 015, slice 3: private Compose files. The Compose file a kit pins is read the same way as the
// kit: from public GitHub first, and through the GitHub connection only when GitHub shows no such
// repository without it (R1, R2). It may be in the kit's own repository or another one. The review
// labels it, says when the kit reads another repository with the connection (decision 7), and the
// installed app records how it was read (R4). A public Compose file never touches the connection.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../src/apps/settings.ts";
import { app, installJob, sourceCredential } from "../src/db/schema.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { COMMIT, fakeGithub, fakeGithubAccounts, FakeRuntime, kitLink } from "./helpers/runtime.ts";
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
const OTHER_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";
/** A kit that pins `path` in `repo` at `commit`. */
const kitFor = (name: string, repo: string, path = "compose.yaml", commit = COMMIT) =>
  `kit: 1\nsource: { repo: ${repo}, path: ${path}, commit: ${commit} }\nname: ${name}\ninterface: { service: web, port: 80 }\n`;
const privateKitLink = (name: string) => `https://github.com/ys-fixtures/private-kits/blob/main/kits/${name}.yaml`;

describe("private Compose files through the GitHub connection", () => {
  let t: TestDatabase;
  let server: TestServer;
  let cookie: string;
  let calls: { url: string; authorization: string | null; accept: string | null }[];
  let refused: Set<string>;
  let answer: ((url: URL, token: string | null) => Response | undefined) | undefined;
  let files: typeof fetch;
  const lines: string[] = [];

  beforeEach(async () => {
    t = await createTestDatabase();
    calls = [];
    refused = new Set();
    answer = undefined;
    files = fakeGithub(
      {
        "ys-fixtures/plain/compose.yaml": COMPOSE,
        "ys-fixtures/private-app/compose.yaml": COMPOSE,
        "ys-fixtures/private-kits/compose.yaml": COMPOSE,
        "ys-fixtures/private-other/compose.yaml": COMPOSE,
        // Public kits.
        "ys-fixtures/catalog/apps/ys-fixtures/private-app.yaml": kitFor("private-app", "ys-fixtures/private-app"),
        "ys-fixtures/catalog/apps/ys-fixtures/plain.yaml": kitFor("plain", "ys-fixtures/plain"),
        "ys-fixtures/catalog/apps/ys-fixtures/not-visible.yaml": kitFor("not-visible", "ys-fixtures/private-other"),
        "ys-fixtures/catalog/apps/ys-fixtures/no-file.yaml": kitFor("no-file", "ys-fixtures/private-app", "missing.yaml"),
        "ys-fixtures/catalog/apps/ys-fixtures/no-commit.yaml": kitFor("no-commit", "ys-fixtures/private-app", "compose.yaml", OTHER_COMMIT),
        "ys-fixtures/catalog/apps/ys-fixtures/public-no-file.yaml": kitFor("public-no-file", "ys-fixtures/plain", "missing.yaml"),
        "ys-fixtures/catalog/apps/ys-fixtures/public-no-commit.yaml": kitFor("public-no-commit", "ys-fixtures/plain", "compose.yaml", OTHER_COMMIT),
        // Private kits: one naming a Compose file in another private repository, one in its own.
        "ys-fixtures/private-kits/kits/both.yaml": kitFor("both", "ys-fixtures/private-app"),
        "ys-fixtures/private-kits/kits/same.yaml": kitFor("same", "ys-fixtures/private-kits"),
      },
      {
        private: { "ys-fixtures/private-app": [TOKEN], "ys-fixtures/private-kits": [TOKEN], "ys-fixtures/private-other": [] },
        refused,
        calls,
        answer: (url, token) => answer?.(url, token),
      },
    );
    const accounts = fakeGithubAccounts(new Map([[TOKEN, LOGIN]]));
    const github: typeof fetch = async (input, init) => {
      const answer = await files(input, init);
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
  const provenance = async (name: string) => (await t.db.select().from(app).where(eq(app.name, name)))[0]!.provenance;
  const withToken = () => calls.filter((c) => c.authorization !== null);

  it("asks the owner to connect GitHub for a Compose file public GitHub doesn't show", async () => {
    const hidden = await review(kitLink("private-app"));
    expect(hidden.status).toBe(404);
    expect(hidden.json).toEqual({
      error: "not_connected",
      message: "Your Space can't find ys-fixtures/private-app, where the kit's Compose file is, on public GitHub. If the repository is private, connect GitHub with a token that can read it, then try again.",
    });
    expect(withToken()).toEqual([]);
  });

  it("reads a public kit's private Compose file through the connection, labels it, and records how each file was read", async () => {
    await connect();
    const { status, text, json } = await review(kitLink("private-app"));
    expect(status, text).toBe(200);
    expect(json.kit.read).toEqual({ read: "anonymous" });
    expect(json.source).toEqual({
      link: `https://github.com/ys-fixtures/private-app/blob/${COMMIT}/compose.yaml`,
      repo: "ys-fixtures/private-app",
      path: "compose.yaml",
      ref: COMMIT,
      commit: COMMIT,
      pinnedLink: `https://github.com/ys-fixtures/private-app/blob/${COMMIT}/compose.yaml`,
      read: { read: "connection", login: LOGIN },
    });
    // The kit is public, so the Compose file is in another repository, read with the connection.
    expect(json.readsRepository).toBe("ys-fixtures/private-app");
    expect(text).not.toContain(TOKEN);

    // Public first: the raw file wasn't there, and the commits API said public GitHub doesn't show the
    // repository; then the connection confirmed the pinned commit and read the file with the contents
    // API. The kit, public, never had the token.
    expect(calls.map((c) => [c.url, c.authorization, c.accept])).toEqual([
      ["https://api.github.test/repos/ys-fixtures/catalog/commits/main", null, "application/vnd.github.sha"],
      ["https://raw.github.test/ys-fixtures/catalog/0123456789abcdef0123456789abcdef01234567/apps/ys-fixtures/private-app.yaml", null, "text/plain"],
      [`https://raw.github.test/ys-fixtures/private-app/${COMMIT}/compose.yaml`, null, "text/plain"],
      [`https://api.github.test/repos/ys-fixtures/private-app/commits/${COMMIT}`, null, "application/vnd.github.sha"],
      [`https://api.github.test/repos/ys-fixtures/private-app/commits/${COMMIT}`, `Bearer ${TOKEN}`, "application/vnd.github.sha"],
      [`https://api.github.test/repos/ys-fixtures/private-app/contents/compose.yaml?ref=${COMMIT}`, `Bearer ${TOKEN}`, "application/vnd.github.raw+json"],
    ]);

    const name = await install(json.previewId);
    expect(await provenance(name)).toEqual({ kit: { read: "anonymous" }, compose: { read: "connection", login: LOGIN } });
    const detail = (await (await api(`/api/apps/${name}`)).json()) as any;
    expect(detail.provenance).toEqual({ kit: { read: "anonymous" }, compose: { read: "connection", login: LOGIN } });
    expect(JSON.stringify(detail)).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("reads a private kit and its private Compose file, and names another repository only when it is one", async () => {
    await connect();
    const both = await review(privateKitLink("both"));
    expect(both.status, both.text).toBe(200);
    expect(both.json.kit.read).toEqual({ read: "connection", login: LOGIN });
    expect(both.json.source).toMatchObject({ repo: "ys-fixtures/private-app", read: { read: "connection", login: LOGIN } });
    expect(both.json.readsRepository).toBe("ys-fixtures/private-app");
    expect(await provenance(await install(both.json.previewId))).toEqual({ kit: { read: "connection", login: LOGIN }, compose: { read: "connection", login: LOGIN } });

    // A Compose file in the kit's own repository is labelled, with no line of its own.
    const same = await review(privateKitLink("same"));
    expect(same.status, same.text).toBe(200);
    expect(same.json.source).toMatchObject({ repo: "ys-fixtures/private-kits", read: { read: "connection", login: LOGIN } });
    expect(same.json.readsRepository).toBeNull();

    // A public kit and Compose file: no label, no line, no token.
    calls.length = 0;
    const open = await review(kitLink("plain"));
    expect(open.status, open.text).toBe(200);
    expect(open.json.source.read).toEqual({ read: "anonymous" });
    expect(open.json.readsRepository).toBeNull();
    expect(withToken()).toEqual([]);
  });

  it("says when GitHub doesn't show the Compose file's repository to the connection, or the file or commit isn't there", async () => {
    await connect();
    const notVisible = await review(kitLink("not-visible"));
    expect(notVisible.status).toBe(404);
    expect(notVisible.json).toMatchObject({
      error: "repository_not_visible",
      message: expect.stringMatching(/^GitHub doesn't show ys-fixtures\/private-other to your GitHub connection \(@ys-fixture-owner\)\./),
    });
    const noFile = await review(kitLink("no-file"));
    expect(noFile.status).toBe(404);
    expect(noFile.json).toEqual({ error: "file_missing", message: `There is no file missing.yaml in ys-fixtures/private-app at ${COMMIT}.` });
    const noCommit = await review(kitLink("no-commit"));
    expect(noCommit.status).toBe(404);
    expect(noCommit.json).toEqual({ error: "not_found", message: `Your Space can't find the commit the kit pins, ${OTHER_COMMIT}, in ys-fixtures/private-app.` });

    // In a public repository, a file or a commit that isn't there is missing; the connection isn't asked.
    calls.length = 0;
    const publicNoFile = await review(kitLink("public-no-file"));
    expect(publicNoFile.json).toEqual({ error: "file_missing", message: `There is no file missing.yaml in ys-fixtures/plain at ${COMMIT}.` });
    const publicNoCommit = await review(kitLink("public-no-commit"));
    expect(publicNoCommit.json).toEqual({ error: "not_found", message: `Your Space can't find the commit the kit pins, ${OTHER_COMMIT}, in ys-fixtures/plain.` });
    expect(withToken()).toEqual([]);

    // A branch or tag named like the pinned commit resolves to another one: the file isn't read there.
    answer = (url, token) => (token && url.pathname.endsWith(`/commits/${COMMIT}`) ? new Response(OTHER_COMMIT) : undefined);
    calls.length = 0;
    const moved = await review(kitLink("private-app"));
    expect(moved.json).toEqual({ error: "source", message: `GitHub answered ${COMMIT} in ys-fixtures/private-app with another commit, ${OTHER_COMMIT}.` });
    expect(calls.some((c) => c.url.includes("/contents/"))).toBe(false);
  });

  it("marks a token GitHub refuses for a Compose file, and still installs a public kit and Compose file", async () => {
    await connect();
    refused.add(TOKEN);
    const hidden = await review(kitLink("private-app"));
    expect(hidden.status).toBe(409);
    expect(hidden.json).toEqual({
      error: "token_refused",
      message: `GitHub no longer accepts your GitHub connection's token (@${LOGIN}): it expired, or it was deleted or revoked. Create a new token and connect GitHub again, then try again.`,
    });
    expect((await t.db.select().from(sourceCredential))[0]!.refusedAt).not.toBeNull();

    calls.length = 0;
    const open = await review(kitLink("plain"));
    expect(open.status, open.text).toBe(200);
    await install(open.json.previewId);
    expect(withToken()).toEqual([]);
  });

  it("tells the owner to reconnect when no data key reads the token, and still installs a public kit and Compose file", async () => {
    await connect();
    await t.db.update(sourceCredential).set({ token: encrypt("a-data-key-that-is-gone-0123456789abcdefgh", TOKEN) });
    const hidden = await review(kitLink("private-app"));
    expect(hidden.status).toBe(409);
    expect(hidden.json).toMatchObject({
      error: "token_unreadable",
      message: expect.stringMatching(/^Your Space can't find ys-fixtures\/private-app, where the kit's Compose file is, on public GitHub\. Your GitHub connection \(@ys-fixture-owner\) can't read it/),
    });
    const open = await review(kitLink("plain"));
    expect(open.status, open.text).toBe(200);
    await install(open.json.previewId);
    expect(withToken()).toEqual([]);
  });

  it("reads a kit file's private Compose file for install-app --kit - through the connection, and a public one without it", async () => {
    // The command runs as its own process, so the stand-in is served to it over HTTP.
    const bridge = createServer(async (req, res) => {
      const [, host, ...rest] = req.url!.split("/");
      const answer = await files(`https://${host}.github.test/${rest.join("/")}`, { headers: req.headers as Record<string, string> });
      res.writeHead(answer.status).end(Buffer.from(await answer.arrayBuffer()));
    });
    await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
    const command = (kit: string) =>
      runCommand("install-app", ["--kit", "-", "--json"], { databaseUrl: t.url, input: kit, env: { YS_E2E_GITHUB_API: `${at}/api`, YS_E2E_GITHUB_RAW: `${at}/raw` } });
    const privateKit = kitFor("local-private", "ys-fixtures/private-app");
    const publicKit = kitFor("local-public", "ys-fixtures/plain");
    try {
      // Not connected: the kit file was given, so only connecting helps.
      const unconnected = await command(privateKit);
      expect(unconnected.json).toEqual({
        ok: false,
        error: "not_connected",
        message:
          "Your Space can't find ys-fixtures/private-app, where the kit's Compose file is, on public GitHub. If the repository is private, connect GitHub with a token that can read it, then try again. Connect GitHub with: docker compose exec server github connect.",
      });
      // A public Compose file needs no connection. This test has no runtime manager, so the review
      // stops after the file is read.
      expect((await command(publicKit)).json.error).toBe("runtime_unavailable");
      expect(withToken()).toEqual([]);

      await connect();
      const connected = await command(privateKit);
      expect(connected.json.error).toBe("runtime_unavailable");
      expect(calls.map((c) => [c.url, c.authorization])).toContainEqual([`https://api.github.test/repos/ys-fixtures/private-app/contents/compose.yaml?ref=${COMMIT}`, `Bearer ${TOKEN}`]);
      expect(connected.stdout + connected.stderr).not.toContain(TOKEN);

      // A connection GitHub refuses stops only the private Compose file.
      refused.add(TOKEN);
      expect((await command(privateKit)).json).toMatchObject({ error: "token_refused", message: expect.stringMatching(/Reconnect with: docker compose exec server github connect$/) });
      calls.length = 0;
      expect((await command(publicKit)).json.error).toBe("runtime_unavailable");
      expect(withToken()).toEqual([]);
    } finally {
      bridge.close();
    }
  });
});
