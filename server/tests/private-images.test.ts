// Journey 015, slice 4: private images. The GitHub connection's optional image token, a classic token
// with only read:packages (decision 4), is added, replaced and removed on its own, and refused before
// it is stored when its scopes are more (R2). A review checks the app's images anonymously first; only
// when GHCR won't show one is the image token read, and the file checked again with it for that image
// alone (R9). The review labels it Private image, the install pulls it with the token, and each
// problem has its own message. The token is never returned, printed or logged (R5).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeError, type AppSpec, type CheckAnswer } from "../src/apps/runtime-client.ts";
import { decrypt, encrypt } from "../src/apps/settings.ts";
import { app, installJob, registryCredential, sourceCredential } from "../src/db/schema.ts";
import { GITHUB_CLASSIC_TOKENS_URL, GithubConnection } from "../src/github-connection.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { fakeGithub, fakeGithubAccounts, FakeRuntime, kitLink, plainKit } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

// Synthetic tokens with GitHub's prefixes, far too short to be real ones.
const CONTENTS_TOKEN = "github_pat_ys_fixture_contents_0001";
const IMAGE_TOKEN = "ghp_ys_fixture_packages_0001";
const NEXT_IMAGE_TOKEN = "ghp_ys_fixture_packages_0002";
/** GitHub accepts it with only read:packages, but GHCR doesn't let its account read the image. */
const OTHER_IMAGE_TOKEN = "ghp_ys_fixture_packages_0003";
const WIDE_TOKEN = "ghp_ys_fixture_packages_wide";
const REPO_TOKEN = "ghp_ys_fixture_repo";
const NO_SCOPES_TOKEN = "ghp_ys_fixture_no_scopes";
/** GitHub's answer has no X-OAuth-Scopes header at all. */
const NO_HEADER_TOKEN = "ghp_ys_fixture_no_header";
const OAUTH_TOKEN = "gho_ys_fixture_oauth";
const LOGIN = "ys-fixture-owner";
const OTHER_LOGIN = "ys-fixture-other";

const PRIVATE_IMAGE = "ghcr.io/ys-fixtures/private-image:1";
const PUBLIC_GHCR_IMAGE = "ghcr.io/ys-fixtures/public-image:1";
const OTHER_REGISTRY_IMAGE = "quay.io/ys-fixtures/private-image:1";
const DIGEST = `sha256:${"d".repeat(64)}`;

function accountsAndScopes() {
  const accounts = new Map([
    [CONTENTS_TOKEN, LOGIN],
    [IMAGE_TOKEN, LOGIN],
    [NEXT_IMAGE_TOKEN, LOGIN],
    [OTHER_IMAGE_TOKEN, OTHER_LOGIN],
    [WIDE_TOKEN, LOGIN],
    [REPO_TOKEN, LOGIN],
    [NO_SCOPES_TOKEN, LOGIN],
    [NO_HEADER_TOKEN, LOGIN],
    [OAUTH_TOKEN, LOGIN],
  ]);
  const scopes = new Map([
    [IMAGE_TOKEN, "read:packages"],
    [NEXT_IMAGE_TOKEN, "read:packages"],
    [OTHER_IMAGE_TOKEN, "read:packages"],
    [WIDE_TOKEN, "read:packages, write:packages"],
    [REPO_TOKEN, "repo"],
    [NO_SCOPES_TOKEN, ""],
    [OAUTH_TOKEN, "read:packages"],
  ]);
  return { accounts, scopes };
}

describe("the image token on the GitHub page", () => {
  let t: TestDatabase;
  let server: TestServer;
  let cookie: string;
  let github: ReturnType<typeof fakeGithubAccounts>;
  let accounts: Map<string, string>;
  const lines: string[] = [];

  beforeEach(async () => {
    t = await createTestDatabase();
    const fixtures = accountsAndScopes();
    accounts = fixtures.accounts;
    github = fakeGithubAccounts(accounts, fixtures.scopes);
    server = await startServer(t.db, { github: { fetch: github.fetch } });
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

  async function read(method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) {
    const response = await server.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  }
  const stored = async () => (await t.db.select().from(registryCredential))[0];

  it("adds a classic token with only read:packages, shows its login, and never returns or logs it", async () => {
    const added = await read("PUT", "/api/github/image-token", { token: `${IMAGE_TOKEN}\n` });
    expect(added.status).toBe(200);
    expect(added.json).toEqual({ images: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: true } });
    expect(added.text).not.toContain(IMAGE_TOKEN);
    // GitHub was asked only which account the token is, which also lists its scopes.
    expect(github.calls).toEqual([{ url: "https://api.github.test/user", authorization: `Bearer ${IMAGE_TOKEN}` }]);
    const row = await stored();
    expect(row!.token).not.toContain(IMAGE_TOKEN);
    expect(decrypt(TEST_DATA_KEY, row!.token)).toBe(IMAGE_TOKEN);

    // It is a slot of its own: the page shows it without a contents token.
    const status = await read("GET", "/api/github");
    expect(status.json).toEqual({ contents: { set: false }, images: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: true } });
    expect(status.text).not.toContain(IMAGE_TOKEN);
    expect(lines.join("\n")).not.toContain(IMAGE_TOKEN);
  });

  it("refuses, before storing it, a token whose scopes are more or less than read:packages, or that isn't classic", async () => {
    for (const [token, has] of [
      [WIDE_TOKEN, "the scopes read:packages, write:packages"],
      [REPO_TOKEN, "the scopes repo"],
      [NO_SCOPES_TOKEN, "no scopes"],
      [NO_HEADER_TOKEN, "no scopes"],
    ] as const) {
      const refused = await read("PUT", "/api/github/image-token", { token });
      expect(refused.status).toBe(400);
      expect(refused.json).toEqual({ error: "token_scopes", message: expect.stringContaining(`This token has ${has}. The image token must have only read:packages`) });
      expect(refused.text).not.toContain(token);
    }
    // A fine-grained token can't read packages, and an OAuth app's token isn't the owner's classic
    // one: neither is sent to GitHub.
    github.calls.length = 0;
    const fineGrained = await read("PUT", "/api/github/image-token", { token: CONTENTS_TOKEN });
    expect(fineGrained.json).toMatchObject({ error: "token_not_classic", message: expect.stringContaining("That's a fine-grained token") });
    expect((await read("PUT", "/api/github/image-token", { token: OAUTH_TOKEN })).json.error).toBe("token_not_classic");
    expect(github.calls).toEqual([]);
    expect((await read("PUT", "/api/github/image-token", { token: "ghp_ys_fixture_unknown" })).json.error).toBe("token_refused");
    expect((await read("PUT", "/api/github/image-token", { token: "" })).json.error).toBe("token_required");
    expect(await stored()).toBeUndefined();
    expect(lines.join("\n")).not.toContain(WIDE_TOKEN);
  });

  it("is replaced and removed on its own, and Disconnect removes both tokens", async () => {
    await read("PUT", "/api/github", { token: CONTENTS_TOKEN });
    await read("PUT", "/api/github/image-token", { token: IMAGE_TOKEN });
    await read("PUT", "/api/github/image-token", { token: NEXT_IMAGE_TOKEN });
    expect(decrypt(TEST_DATA_KEY, (await stored())!.token)).toBe(NEXT_IMAGE_TOKEN);
    expect(await t.db.select().from(registryCredential)).toHaveLength(1);

    expect((await read("DELETE", "/api/github/image-token")).json).toEqual({ removed: true, images: { set: false } });
    expect((await read("GET", "/api/github")).json).toMatchObject({ contents: { set: true, login: LOGIN }, images: { set: false } });
    expect((await read("DELETE", "/api/github/image-token")).json).toEqual({ removed: false, images: { set: false } });

    await read("PUT", "/api/github/image-token", { token: IMAGE_TOKEN });
    expect((await read("DELETE", "/api/github")).json).toEqual({ removed: true, contents: { set: false }, images: { set: false } });
    expect(await t.db.select().from(sourceCredential)).toEqual([]);
    expect(await t.db.select().from(registryCredential)).toEqual([]);
  });

  it("shows Reconnect once GitHub refuses it, and changes only from Your Space's own pages", async () => {
    await read("PUT", "/api/github/image-token", { token: IMAGE_TOKEN });
    accounts.delete(IMAGE_TOKEN); // The owner deleted it at GitHub, or it expired.
    expect((await read("GET", "/api/github")).json.images).toEqual({ set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: false, problem: "refused" });
    expect((await read("PUT", "/api/github/image-token", { token: IMAGE_TOKEN }, { cookie, origin: "https://other.example" })).status).toBe(403);
    expect((await read("DELETE", "/api/github/image-token", undefined, { cookie, origin: "https://other.example" })).status).toBe(403);
    expect((await read("PUT", "/api/github/image-token", { token: IMAGE_TOKEN }, {})).status).toBe(401);
    expect(await stored()).toBeDefined();
  });

  it("keeps a refusal GitHub gave while an earlier check of the same token was still waiting for GitHub", async () => {
    await read("PUT", "/api/github/image-token", { token: IMAGE_TOKEN });
    // The first check's answer arrives last: GitHub accepting the token from before it was deleted, or
    // no answer at all. The second check, in between, got GitHub's refusal.
    for (const late of ["accepted", "unreachable"] as const) {
      await t.db.update(registryCredential).set({ refusedAt: null });
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => (release = resolve));
      let calls = 0;
      const gated: typeof fetch = async (input, init) => {
        if (++calls > 1) return Response.json({ message: "Bad credentials" }, { status: 401 });
        await waiting;
        if (late === "unreachable") throw new TypeError("fetch failed");
        return github.fetch(input, init);
      };
      const connection = new GithubConnection(t.db, TEST_DATA_KEY, { endpoints: { api: "https://api.github.test", raw: "https://raw.github.test" }, fetch: gated });
      const first = connection.status();
      await vi.waitFor(() => expect(calls).toBe(1));
      expect((await connection.status()).images).toMatchObject({ accepted: false, problem: "refused" });
      release();
      expect((await first).images).toMatchObject({ accepted: false, problem: "refused" });
      expect((await stored())!.refusedAt).not.toBeNull();
    }
  });
});

describe("the github server command's image token", () => {
  let t: TestDatabase;
  let github: Server;
  let api: string;
  const { accounts, scopes } = accountsAndScopes();

  beforeAll(async () => {
    t = await createTestDatabase();
    await createOwnerWithPassword(t.db);
    // The command runs as its own process, so GitHub stands in over HTTP, as in the browser tests.
    github = createServer((req, res) => {
      const token = String(req.headers.authorization).replace(/^Bearer /, "");
      const login = req.url === "/user" ? accounts.get(token) : undefined;
      if (!login) return void res.writeHead(401, { "Content-Type": "application/json" }).end('{"message":"Bad credentials"}');
      res.writeHead(200, { "Content-Type": "application/json", ...(scopes.has(token) ? { "X-OAuth-Scopes": scopes.get(token) } : {}) }).end(JSON.stringify({ login }));
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

  it("adds, replaces and removes the image token from standard input, never from an argument", async () => {
    for (const args of [["image-token", IMAGE_TOKEN], ["image-token", "--json", IMAGE_TOKEN]]) {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(output(result)).not.toContain(IMAGE_TOKEN);
      expect(output(result)).toContain("github image-token doesn't take the token on the command line");
    }

    const added = await run(["image-token", "--json"], `${IMAGE_TOKEN}\n`);
    expect(added.code).toBe(0);
    expect(added.json).toEqual({ ok: true, images: { set: true, login: LOGIN, lastWorkedAt: expect.any(String), accepted: true } });
    expect(output(added)).not.toContain(IMAGE_TOKEN);
    expect((await run(["connect"], CONTENTS_TOKEN)).code).toBe(0);

    const human = await run(["status"]);
    expect(human.stdout).toContain(`Connected as @${LOGIN}. GitHub accepts the token`);
    expect(human.stdout).toContain(`Images: @${LOGIN}. GitHub accepts the token`);
    expect((await run(["status", "--json"])).json).toMatchObject({ ok: true, contents: { set: true }, images: { set: true, login: LOGIN } });

    const wide = await run(["image-token", "--json"], WIDE_TOKEN);
    expect(wide.code).toBe(2);
    expect(wide.json).toMatchObject({ ok: false, error: "token_scopes" });
    expect(output(wide)).not.toContain(WIDE_TOKEN);
    expect((await run(["image-token"], NEXT_IMAGE_TOKEN)).stdout).toContain(`Images: @${LOGIN}`);

    const removed = await run(["disconnect", "--image-token", "--json"]);
    expect(removed.json).toEqual({ ok: true, removed: true, images: { set: false }, deleteAt: GITHUB_CLASSIC_TOKENS_URL });
    const status = await run(["status"]);
    expect(status.stdout).toContain(`Connected as @${LOGIN}`);
    expect(status.stdout).toContain("No image token, for private images on GitHub's container registry. Add one with: docker compose exec server github image-token");
    expect((await run(["disconnect", "--image-token"])).stdout).toContain("There was no image token to remove");

    await run(["image-token"], IMAGE_TOKEN);
    expect((await run(["disconnect"])).stdout).toContain("Delete the tokens at GitHub too");
    expect((await run(["status", "--json"])).json).toEqual({ ok: true, contents: { set: false }, images: { set: false } });
  });
});

describe("a kit with a private image on GHCR", () => {
  let t: TestDatabase;
  let server: TestServer;
  let cookie: string;
  let runtime: FakeRuntime;
  let github: ReturnType<typeof fakeGithubAccounts>;
  const lines: string[] = [];
  /** What GHCR lets each image token read. */
  const readers = new Map([[PRIVATE_IMAGE, [IMAGE_TOKEN]]]);

  /** The images a check reports, as GHCR, a public registry and another registry answer it. */
  function images(spec: AppSpec): CheckAnswer["images"] {
    const signIn = (ref: string) => spec.registryCredentials?.find((c) => c.registry === "ghcr.io" && c.images.includes(ref));
    const ghcr = (ref: string): CheckAnswer["images"][number] => {
      const credential = signIn(ref);
      if (!readers.has(ref)) return { ref, registry: "ghcr.io", digest: DIGEST, runsHere: true, platforms: ["linux/amd64"] };
      if (!credential) return { ref, registry: "ghcr.io", runsHere: false, platforms: [], error: "denied", signIn: "needed" };
      if (!readers.get(ref)!.includes(credential.secret)) return { ref, registry: "ghcr.io", runsHere: false, platforms: [], error: "denied", signIn: "refused" };
      return { ref, registry: "ghcr.io", digest: DIGEST, runsHere: true, platforms: ["linux/amd64"], private: true };
    };
    const refs = /image: (\S+)/g;
    const named = [...spec.compose.matchAll(refs)].map((m) => m[1]!);
    return [
      ...named.map((ref) =>
        ref.startsWith("ghcr.io/")
          ? ghcr(ref)
          : ref.startsWith("quay.io/")
            ? { ref, registry: "quay.io", runsHere: false, platforms: [], error: "unauthorized", signIn: "needed" as const }
            : { ref, registry: "docker.io", digest: DIGEST, runsHere: true, platforms: ["linux/amd64"] },
      ),
      { ref: "ubuntu/squid:latest", registry: "docker.io", digest: "sha256:bbb", runsHere: true, platforms: ["linux/amd64"] },
    ];
  }

  beforeEach(async () => {
    t = await createTestDatabase();
    runtime = new FakeRuntime();
    runtime.images = images;
    const files = fakeGithub({
      ...plainKit("private-image"),
      ...plainKit("mixed"),
      ...plainKit("public-image"),
      ...plainKit("other-registry"),
      "ys-fixtures/private-image/compose.yaml": `services:\n  web:\n    image: ${PRIVATE_IMAGE}\n`,
      "ys-fixtures/mixed/compose.yaml": `services:\n  web:\n    image: ${PRIVATE_IMAGE}\n  api:\n    image: ${PUBLIC_GHCR_IMAGE}\n`,
      "ys-fixtures/public-image/compose.yaml": `services:\n  web:\n    image: ${PUBLIC_GHCR_IMAGE}\n`,
      "ys-fixtures/other-registry/compose.yaml": `services:\n  web:\n    image: ${OTHER_REGISTRY_IMAGE}\n`,
    });
    const fixtures = accountsAndScopes();
    github = fakeGithubAccounts(fixtures.accounts, fixtures.scopes);
    const fetcher: typeof fetch = async (input, init) => (String(input).endsWith("/user") ? github.fetch(input, init) : files(input, init));
    server = await startServer(t.db, { apps: { runtime, fetch: fetcher } });
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
  async function review(name: string): Promise<{ status: number; text: string; json: any }> {
    const response = await api("/api/kits/preview", { method: "POST", body: JSON.stringify({ kitUrl: kitLink(name) }) });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  }
  async function addImageToken(token: string): Promise<void> {
    expect((await api("/api/github/image-token", { method: "PUT", body: JSON.stringify({ token }) })).status).toBe(200);
    github.calls.length = 0;
  }
  async function install(previewId: string): Promise<string> {
    const response = await api("/api/apps", { method: "POST", body: JSON.stringify({ previewId }) });
    expect(response.status).toBe(202);
    const { name } = (await response.json()) as { name: string };
    await settled();
    return name;
  }
  async function settled(): Promise<void> {
    for (let i = 0; i < 500; i++) {
      const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("The job didn't finish.");
  }
  const checks = () => runtime.calls.filter((c) => c.method === "check").map((c) => c.spec!.registryCredentials);
  const applies = () => runtime.calls.filter((c) => c.method === "apply").map((c) => c.spec!.registryCredentials);
  const reasons = (json: { refusals: { reason: string }[] }) => json.refusals.map((r) => r.reason);

  it("asks for an image token when GHCR doesn't show an image anonymously", async () => {
    const hidden = await review("private-image");
    expect(hidden.status).toBe(200);
    expect(hidden.json.ok).toBe(false);
    expect(reasons(hidden.json)).toEqual([
      `GitHub's container registry doesn't show ${PRIVATE_IMAGE} without signing in: it is private, or it doesn't exist. If it's private, add an image token, a classic token with only read:packages, on Your Space's GitHub page, or with docker compose exec server github image-token, then review the kit again.`,
    ]);
    expect(checks()).toEqual([undefined]);
    expect((await api("/api/apps", { method: "POST", body: JSON.stringify({ previewId: hidden.json.previewId }) })).status).toBe(400);
  });

  it("checks again with the image token for the private image alone, labels it, and pulls it with the token on install", async () => {
    await addImageToken(IMAGE_TOKEN);
    const [before] = await t.db.select({ workedAt: registryCredential.workedAt }).from(registryCredential);
    const reviewed = await review("mixed");
    expect(reviewed.json.ok).toBe(true);
    expect(reviewed.json.images).toEqual([
      { ref: PRIVATE_IMAGE, digest: DIGEST, runsHere: true, private: true },
      { ref: PUBLIC_GHCR_IMAGE, digest: DIGEST, runsHere: true, private: false },
      { ref: "ubuntu/squid:latest", digest: "sha256:bbb", runsHere: true, private: false },
    ]);
    // Anonymous first; then the token, for the image GHCR didn't show, and nothing else.
    const signIn = { registry: "ghcr.io", username: LOGIN, secret: IMAGE_TOKEN, images: [PRIVATE_IMAGE] };
    expect(checks()).toEqual([undefined, [signIn]]);
    // GitHub isn't asked about the token; GHCR giving the image with it says it works.
    expect(github.calls).toEqual([]);
    const [after] = await t.db.select({ workedAt: registryCredential.workedAt }).from(registryCredential);
    expect(after!.workedAt.getTime()).toBeGreaterThanOrEqual(before!.workedAt.getTime());
    expect(reviewed.text).not.toContain(IMAGE_TOKEN);

    const name = await install(reviewed.json.previewId);
    const [row] = await t.db.select().from(app).where(eq(app.name, name));
    expect(row!.images).toEqual({
      [PRIVATE_IMAGE]: { digest: DIGEST, private: true },
      [PUBLIC_GHCR_IMAGE]: { digest: DIGEST },
      "ubuntu/squid:latest": { digest: "sha256:bbb" },
    });
    expect(row!.state).toBe("running");
    // The install pulls the private image signed in, for it alone; a later start doesn't sign in.
    expect(applies()).toEqual([[signIn]]);
    expect((await api(`/api/apps/${name}/start`, { method: "POST" })).status).toBe(202);
    await settled();
    expect(applies()).toEqual([[signIn], undefined]);
    expect(lines.join("\n")).not.toContain(IMAGE_TOKEN);
  });

  it("keeps an image private when the engine answers the signed-in lookup with its own copy", async () => {
    await addImageToken(IMAGE_TOKEN);
    // GHCR can't answer the lookup with the token, a rate limit say, and the engine has the image.
    runtime.images = (spec) => images(spec).map(({ private: _signedIn, ...image }) => image);
    const [before] = await t.db.select({ workedAt: registryCredential.workedAt }).from(registryCredential);
    const reviewed = await review("private-image");
    expect(reviewed.json.images[0]).toEqual({ ref: PRIVATE_IMAGE, digest: DIGEST, runsHere: true, private: true });
    // GHCR didn't say the token works.
    const [after] = await t.db.select({ workedAt: registryCredential.workedAt }).from(registryCredential);
    expect(after!.workedAt).toEqual(before!.workedAt);
    const name = await install(reviewed.json.previewId);
    const [row] = await t.db.select().from(app).where(eq(app.name, name));
    expect(row!.images[PRIVATE_IMAGE]).toEqual({ digest: DIGEST, private: true });
    expect(applies()).toEqual([[{ registry: "ghcr.io", username: LOGIN, secret: IMAGE_TOKEN, images: [PRIVATE_IMAGE] }]]);
  });

  it("never reads the image token for public images, so one no key can read doesn't stop them", async () => {
    await addImageToken(IMAGE_TOKEN);
    await t.db.update(registryCredential).set({ token: encrypt("a-data-key-that-is-gone-0123456789abcdef", IMAGE_TOKEN) });
    const reviewed = await review("public-image");
    expect(reviewed.json.ok).toBe(true);
    expect(checks()).toEqual([undefined]);
    await install(reviewed.json.previewId);
    expect(applies()).toEqual([undefined]);

    const hidden = await review("private-image");
    expect(reasons(hidden.json)).toEqual([
      `GitHub's container registry doesn't show ${PRIVATE_IMAGE} without signing in: it is private, or it doesn't exist. Your image token (@${LOGIN}) can't be used: no data key here can read it, as when the data key was replaced without the one before it. Add the image token again on Your Space's GitHub page, or with docker compose exec server github image-token.`,
    ]);
  });

  it("says when the image token can't read the image", async () => {
    await addImageToken(OTHER_IMAGE_TOKEN);
    const refused = await review("private-image");
    expect(refused.json.ok).toBe(false);
    expect(reasons(refused.json)).toEqual([
      `Your image token (@${OTHER_LOGIN}) can't read ${PRIVATE_IMAGE}, or it doesn't exist. Check that @${OTHER_LOGIN} can see the package, that GitHub still accepts the token, and that an organization with SAML single sign-on has authorized it. To use another token, replace the image token on Your Space's GitHub page, or with docker compose exec server github image-token.`,
    ]);
    expect(refused.text).not.toContain(OTHER_IMAGE_TOKEN);
  });

  it("refuses a private image on another registry, which Your Space pulls public images from only", async () => {
    await addImageToken(IMAGE_TOKEN);
    const other = await review("other-registry");
    expect(other.json.ok).toBe(false);
    expect(reasons(other.json)).toEqual([
      `quay.io doesn't show ${OTHER_REGISTRY_IMAGE} without signing in: it is private, or it doesn't exist. Your Space pulls private images only from GitHub's container registry, ghcr.io, with an image token; from other registries it pulls public images only.`,
    ]);
    // The image token is for GHCR alone.
    expect(checks()).toEqual([undefined]);
  });

  it("says what to do when a private image's registry asks for a sign-in while downloading it", async () => {
    await addImageToken(IMAGE_TOKEN);
    const reviewed = await review("private-image");
    runtime.apply = async () => {
      throw new RuntimeError(`Downloading ${PRIVATE_IMAGE} failed: its registry asks for a sign-in, as for a private image, and refused the sign-in Your Space gave.`, 502, "sign_in");
    };
    const name = await install(reviewed.json.previewId);
    const [job] = await t.db.select().from(installJob).orderBy(installJob.createdAt);
    expect(job!.error).toBe(
      `Downloading ${PRIVATE_IMAGE} failed: its registry asks for a sign-in, as for a private image, and refused the sign-in Your Space gave. Check your image token on Your Space's GitHub page, or with docker compose exec server github image-token, then remove the app and install it again.`,
    );
    expect((await api(`/api/apps/${name}/start`, { method: "POST" })).status).toBe(202);
    await settled();
    const jobs = await t.db.select().from(installJob).orderBy(installJob.createdAt);
    expect(jobs.at(-1)!.error).toContain("Your Space signs in to download a private image only while installing the app: remove it, then install it again, reusing its data");
  });
});
