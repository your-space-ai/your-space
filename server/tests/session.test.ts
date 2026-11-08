// T034: sign-in, sign-out, session expiry, cookies, and the sign-in limit (User Story 2;
// FR-008, FR-009, FR-011, FR-015, FR-021).
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { account, session, user } from "../src/db/auth-schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_SECRET } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";
import { counts, snapshot } from "./helpers/state.ts";

let t: TestDatabase;
let server: TestServer;
let ownerId: string;
beforeAll(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db);
  await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
  ownerId = (await t.db.select({ id: user.id }).from(user))[0]!.id;
});
afterAll(async () => {
  await server?.close();
  await t?.destroy();
});

const signIn = (s: TestServer, password = OWNER.password) =>
  s.request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: OWNER.email, password }),
  });

/** A response body as JSON, untyped like the command helper's `json`. */
const json = (response: Response): Promise<any> => response.json();

async function getSession(s: TestServer, cookie?: string) {
  const response = await s.request("/api/auth/get-session", cookie ? { headers: { cookie } } : {});
  return { status: response.status, body: await json(response) };
}

const listWorkspaces = (s: TestServer, cookie: string) =>
  s.request("/api/auth/organization/list", { headers: { cookie } });

/** Every cookie in a response's Set-Cookie headers, with its attributes keyed in lower case. */
function setCookies(response: Response) {
  return response.headers.getSetCookie().map((raw) => {
    const [pair, ...rest] = raw.split(";").map((part) => part.trim());
    const attributes = new Map(
      rest.map((part) => {
        const i = part.indexOf("=");
        return i === -1 ? [part.toLowerCase(), ""] : [part.slice(0, i).toLowerCase(), part.slice(i + 1)];
      }),
    );
    return { name: pair!.slice(0, pair!.indexOf("=")), value: pair!.slice(pair!.indexOf("=") + 1), attributes };
  });
}

/** The session cookie from a response's Set-Cookie headers. */
const sessionCookie = (response: Response) =>
  setCookies(response).find((c) => c.name.endsWith("better-auth.session_token"));

/** The names of cookies that set a Domain attribute, which would make them reach subdomains. */
const cookiesWithDomain = (response: Response) =>
  setCookies(response)
    .filter((c) => c.attributes.has("domain"))
    .map((c) => c.name);

/** Sessions last 7 days (plan). */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

async function sessionsFor(token: string) {
  return t.db.select().from(session).where(eq(session.token, token));
}

describe("sign-in", () => {
  it("creates a session row and returns a session cookie for the right password", async () => {
    const before = await counts(t.db);
    const response = await signIn(server);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.user).toMatchObject({ id: ownerId, email: OWNER.email, name: OWNER.name });

    const cookie = sessionCookie(response);
    expect(cookie).toBeDefined();
    expect(cookie!.value).not.toBe("");

    expect((await counts(t.db)).sessions).toBe(before.sessions + 1);
    const rows = await sessionsFor(body.token);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(ownerId);
    expect(Math.abs(rows[0]!.expiresAt.getTime() - (Date.now() + SESSION_LIFETIME_MS))).toBeLessThan(60_000);

    // The cookie authorizes the owner's session and workspace.
    const current = await getSession(server, cookieHeader(response));
    expect(current.status).toBe(200);
    expect(current.body.user).toMatchObject({ id: ownerId, email: OWNER.email });
    expect(current.body.session.token).toBe(body.token);
  });

  it("refuses a wrong password with 401, creates no session, changes nothing, and leaks nothing", async () => {
    const before = { counts: await counts(t.db), owner: await snapshot(t.db), accounts: await t.db.select().from(account) };

    const response = await signIn(server, "not the right password at all");
    expect(response.status).toBe(401);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    for (const key of ["user", "session", "token"]) expect(body).not.toHaveProperty(key);
    expect(text).not.toContain(ownerId);
    expect(text).not.toContain(OWNER.name);
    expect(response.headers.getSetCookie()).toEqual([]);

    expect(await counts(t.db)).toEqual(before.counts);
    expect(await snapshot(t.db)).toEqual(before.owner);
    expect(await t.db.select().from(account)).toEqual(before.accounts);
  });
});

describe("sessions", () => {
  it("returns no session without a cookie", async () => {
    expect(await getSession(server)).toEqual({ status: 200, body: null });
  });

  it("deletes the session on sign-out, and a replayed cookie is refused", async () => {
    const response = await signIn(server);
    expect(response.status).toBe(200);
    const { token } = await json(response);
    const cookie = cookieHeader(response);
    expect((await getSession(server, cookie)).body.user.id).toBe(ownerId);

    const signOut = await server.request("/api/auth/sign-out", { method: "POST", body: "{}", headers: { cookie } });
    expect(signOut.status).toBe(200);
    expect(await json(signOut)).toMatchObject({ success: true });
    expect(await sessionsFor(token)).toHaveLength(0);

    expect(await getSession(server, cookie)).toEqual({ status: 200, body: null });
    expect((await listWorkspaces(server, cookie)).status).toBe(401);
  });

  it("refuses an expired session", async () => {
    const response = await signIn(server);
    expect(response.status).toBe(200);
    const { token } = await json(response);
    const cookie = cookieHeader(response);

    const workspaces = await listWorkspaces(server, cookie);
    expect(workspaces.status).toBe(200);
    expect(await json(workspaces)).toMatchObject([{ name: "Sam Rivera's space" }]);

    // Written through Drizzle as the app writes dates (UTC), so the database time zone does not matter.
    const expired = await t.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(session.token, token))
      .returning();
    expect(expired).toHaveLength(1);

    expect(await getSession(server, cookie)).toEqual({ status: 200, body: null });
    const refused = await listWorkspaces(server, cookie);
    expect(refused.status).toBe(401);
    const text = await refused.text();
    expect(text).not.toContain(ownerId);
    expect(text).not.toContain("Sam Rivera's space");
  });
});

describe("session cookie", () => {
  it("is __Secure-, Secure, HttpOnly, and host-only with an https public address", async () => {
    const https = await startServer(t.db, { publicUrl: "https://space.example.test" });
    try {
      const response = await signIn(https);
      expect(response.status).toBe(200);
      const cookie = sessionCookie(response)!;
      expect(cookie.name).toBe("__Secure-better-auth.session_token");
      expect(cookie.attributes.has("secure")).toBe(true);
      expect(cookie.attributes.has("httponly")).toBe(true);
      expect(cookie.attributes.has("domain")).toBe(false);
      expect(cookiesWithDomain(response)).toEqual([]);
      expect((await getSession(https, cookieHeader(response))).body.user.id).toBe(ownerId);
    } finally {
      await https.close();
    }
  });

  it("is host-only and HttpOnly with the default localhost address", async () => {
    const response = await signIn(server);
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response)!;
    expect(cookie.attributes.has("httponly")).toBe(true);
    expect(cookie.attributes.has("domain")).toBe(false);
    expect(cookiesWithDomain(response)).toEqual([]);
  });
});

// Better Auth turns its rate limiter on only when NODE_ENV=production at load time, so this runs
// the real server as a separate process.
describe("sign-in limit in production", () => {
  let child: ChildProcess | undefined;
  let output = "";
  let base = "";
  let publicUrl = "";

  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as { port: number };
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  beforeAll(async () => {
    const port = await freePort();
    base = `http://localhost:${port}`;
    publicUrl = `http://localhost:${port}`;
    const script = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    child = spawn(process.execPath, [script], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        PORT: String(port),
        DATABASE_URL: t.url,
        YS_PORT: String(port),
        BETTER_AUTH_SECRET: TEST_SECRET,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));

    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server exited early:\n${output}`);
      const ok = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
      if (ok) break;
      if (Date.now() > deadline) throw new Error(`server did not become healthy:\n${output}`);
      await sleep(200);
    }
  });

  afterAll(async () => {
    // A process killed by a signal has signalCode set and exitCode null, and has already exited.
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child!.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child!.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  });

  // Caddy sends the client address as a single X-Forwarded-For value.
  const attempt = (password: string, ip = "203.0.113.7") =>
    fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: publicUrl, "x-forwarded-for": ip },
      body: JSON.stringify({ email: OWNER.email, password }),
    });

  it("refuses the 4th sign-in from one address within 10 seconds with 429, even with the right password, and changes nothing", async () => {
    const before = await counts(t.db);
    for (let i = 0; i < 3; i++) {
      const response = await attempt("not the right password at all");
      expect(response.status).toBe(401);
    }

    const limited = await attempt(OWNER.password);
    expect(limited.status).toBe(429);
    // Better Auth's limiter always says when to retry.
    expect(Number(limited.headers.get("x-retry-after"))).toBeGreaterThan(0);
    const body = await json(limited);
    for (const key of ["user", "session", "token"]) expect(body).not.toHaveProperty(key);
    expect(limited.headers.getSetCookie()).toEqual([]);
    expect(await counts(t.db)).toEqual(before);

    // The limit is per address. If X-Forwarded-For were ignored, Better Auth would put every client
    // in one shared bucket and this would get 429 too.
    const other = await attempt("not the right password at all", "203.0.113.8");
    expect(other.status).toBe(401);
    expect(other.headers.getSetCookie()).toEqual([]);
    expect(await counts(t.db)).toEqual(before);
  });
});
