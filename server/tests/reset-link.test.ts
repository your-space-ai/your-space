// T045: the reset-link command and the reset it issues (User Story 4; FR-017 to FR-019, SC-004,
// SC-007, SC-008; contracts/operator-commands.md).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { storedIdentifier } from "../src/auth.ts";
import { account, member, organization, session, user, verification } from "../src/db/auth-schema.ts";
import { actor, event, installation } from "../src/db/schema.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";
import { counts, snapshot } from "./helpers/state.ts";

const NEW_PASSWORD = "a brand new long passphrase";
const STORAGE_FAILURE = { ok: false, error: "storage_unavailable", message: "The database could not be read." };

let t: TestDatabase;
let server: TestServer;
beforeEach(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db);
});
afterEach(async () => {
  await server?.close();
  await t?.destroy();
});

const resetLink = (args: string[] = ["--json"]) =>
  runCommand("reset-link", args, { databaseUrl: t.url, publicUrl: server.publicUrl });

/** A response body as JSON, untyped like the command helper's `json`. */
const json = (response: Response): Promise<any> => response.json();

const signIn = (password: string) =>
  server.request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: OWNER.email, password }),
  });

const reset = (token: unknown, newPassword = NEW_PASSWORD, s = server) =>
  s.request("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ newPassword, token }) });

/** Signs in and returns the session cookie. */
async function signedIn(password = OWNER.password) {
  const response = await signIn(password);
  expect(response.status).toBe(200);
  return cookieHeader(response);
}

async function currentUserId(cookie: string): Promise<string | undefined> {
  const response = await server.request("/api/auth/get-session", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await json(response))?.user?.id;
}

/** Everything a reset could change: identities, ownership, the password hash, and sessions. */
async function protectedState() {
  return {
    owner: await snapshot(t.db),
    users: await t.db.select().from(user),
    accounts: await t.db.select().from(account),
    organizations: await t.db.select().from(organization),
    members: await t.db.select().from(member),
    installation: await t.db.select().from(installation),
    sessions: await t.db.select().from(session),
  };
}

/** Issues a link through the real command. */
async function issue() {
  const result = await resetLink();
  expect(result.code).toBe(0);
  return result.json as { ok: true; email: string; url: string; token: string; expiresAt: string };
}

const tokenRows = (token: string) =>
  t.db.select().from(verification).where(eq(verification.identifier, storedIdentifier(`reset-password:${token}`)));

describe("set-password link and reset-link", () => {
  it("cancels create-owner's unused set-password link when reset-link issues a new one", async () => {
    const created = await runCommand("create-owner", ["--email", OWNER.email, "--name", OWNER.name, "--json"], {
      databaseUrl: t.url,
      publicUrl: server.publicUrl,
    });
    expect(created.code).toBe(0);
    const issued = await resetLink();
    expect(issued.code).toBe(0);

    const stale = await reset(created.json.token);
    expect(stale.status).toBe(400);
    expect(await json(stale)).toMatchObject({ code: "INVALID_TOKEN" });
    expect((await reset(issued.json.token)).status).toBe(200);
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
  });
});

describe("reset-link", () => {
  it("exits 4 with one JSON object when the configuration is invalid, and issues nothing", async () => {
    const result = await runCommand("reset-link", ["--json"], {
      databaseUrl: t.url,
      publicUrl: server.publicUrl,
      env: { YS_PROXY_URL: "http://192.168.1.20" },
    });
    expect(result.code).toBe(4);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.json).toMatchObject({ ok: false, error: "unexpected" });
    expect(result.json.message).toMatch(/YS_PROXY_URL must start with https/);
    expect(await t.db.select().from(verification)).toEqual([]);
  });

  it("exits 2 with no_owner before the owner exists, and changes nothing", async () => {
    const before = await counts(t.db);

    const result = await resetLink();
    expect(result.code).toBe(2);
    expect(result.json).toEqual({
      ok: false,
      error: "no_owner",
      message: "This installation has no owner yet. Run create-owner.",
    });

    const human = await resetLink([]);
    expect(human.code).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("no owner yet");

    expect(await counts(t.db)).toEqual(before);
    expect(await t.db.select().from(verification)).toEqual([]);
    expect((await t.db.select().from(installation))[0]!.state).toBe("unclaimed");
  });

  describe("with an owner", () => {
    let ownerId: string;
    beforeEach(async () => {
      await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
      ownerId = (await t.db.select({ id: user.id }).from(user))[0]!.id;
    });

    it("keeps only the newest link working: a new link cancels an earlier unused one", async () => {
      const first = await resetLink();
      const second = await resetLink();
      expect(first.code).toBe(0);
      expect(second.code).toBe(0);
      expect(await tokenRows(first.json.token)).toEqual([]);
      expect(await t.db.select().from(verification)).toHaveLength(1);

      const stale = await reset(first.json.token, "a password from the stale link");
      expect(stale.status).toBe(400);
      expect(await json(stale)).toMatchObject({ code: "INVALID_TOKEN" });
      expect((await signIn(OWNER.password)).status).toBe(200);

      const fresh = await reset(second.json.token);
      expect(fresh.status).toBe(200);
      expect((await signIn(NEW_PASSWORD)).status).toBe(200);
    });

    it("exits 3 with storage_unavailable when the database is down, and changes nothing", async () => {
      const before = { state: await protectedState(), counts: await counts(t.db) };
      await t.stop();
      const result = await resetLink();
      expect(result.code).toBe(3);
      expect(result.json).toEqual(STORAGE_FAILURE);
      const human = await resetLink([]);
      expect(human.code).toBe(3);
      expect(human.stdout).toBe("");
      expect(human.stderr).toContain("could not be read");
      await t.restore();

      expect(await protectedState()).toEqual(before.state);
      expect(await counts(t.db)).toEqual(before.counts);
      expect(await t.db.select().from(verification)).toEqual([]);
    });

    it("exits 3 when the installation record is missing, rather than treating it as no owner", async () => {
      await t.db.delete(installation);
      const before = await counts(t.db);
      const result = await resetLink();
      expect(result.code).toBe(3);
      expect(result.json).toEqual(STORAGE_FAILURE);
      expect(await counts(t.db)).toEqual(before);
      expect(await t.db.select().from(verification)).toEqual([]);
    });

    it("prints a single-use link for the owner as JSON, valid for 30 minutes", async () => {
      const before = Date.now();
      const result = await resetLink();
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);

      // Same shape and formats as create-owner.
      expect(Object.keys(result.json).sort()).toEqual(["email", "expiresAt", "ok", "token", "url"]);
      expect(result.json.ok).toBe(true);
      expect(result.json.email).toBe(OWNER.email);
      expect(result.json.token).toMatch(/^[A-Za-z0-9]{24}$/);
      expect(result.json.url).toBe(`${server.publicUrl}/reset-password#token=${result.json.token}`);
      expect(result.json.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      const expires = Date.parse(result.json.expiresAt);
      expect(expires).toBeGreaterThanOrEqual(before + 29 * 60_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + 30 * 60_000);

      // The link is Better Auth's reset token for the owner, and the printed expiry matches it.
      const rows = await tokenRows(result.json.token);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.value).toBe(ownerId);
      expect(Math.abs(rows[0]!.expiresAt.getTime() - expires)).toBeLessThan(2_000);
    });

    it("prints the human-readable output by default", async () => {
      const before = Date.now();
      const result = await resetLink([]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toHaveLength(3);
      const heading = lines[0]!.match(
        /^Password reset link for sam@example\.com \(expires (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ), works once\):$/,
      );
      expect(heading, lines[0]).not.toBeNull();
      const link = lines[1]!.match(new RegExp(`^${server.publicUrl}/reset-password#token=([A-Za-z0-9]{24})$`));
      expect(link, lines[1]).not.toBeNull();
      expect(lines[2]).toBe("Using it signs out every existing session.");

      // The printed link and expiry are the stored token's, as in the JSON output.
      const expires = Date.parse(heading![1]!);
      expect(expires).toBeGreaterThanOrEqual(before + 29 * 60_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
      const rows = await tokenRows(link![1]!);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.value).toBe(ownerId);
      expect(Math.abs(rows[0]!.expiresAt.getTime() - expires)).toBeLessThan(2_000);
    });

    it("exits 1 on an unknown option or argument, and issues nothing", async () => {
      const before = { counts: await counts(t.db), tokens: await t.db.select().from(verification) };

      for (const args of [["--bogus", "--json"], ["extra", "--json"]]) {
        const result = await resetLink(args);
        expect(result.code, args[0]).toBe(1);
        expect(result.json).toMatchObject({ ok: false, error: "usage" });
        expect(result.json.message).toContain("Usage: reset-link [--json]");
      }
      const human = await resetLink(["--bogus"]);
      expect(human.code).toBe(1);
      expect(human.stdout).toBe("");
      expect(human.stderr).toContain("Usage: reset-link [--json]");

      expect(await counts(t.db)).toEqual(before.counts);
      expect(await t.db.select().from(verification)).toEqual(before.tokens);
    });

    it("changes nothing by issuing a link alone", async () => {
      const cookie = await signedIn();
      const before = await protectedState();

      await issue();

      expect(await protectedState()).toEqual(before);
      expect(await currentUserId(cookie)).toBe(ownerId);
      expect((await signIn(OWNER.password)).status).toBe(200);
    });

    it("resets the password once, and a second use fails without changing it", async () => {
      const link = await issue();

      const first = await reset(link.token);
      expect(first.status).toBe(200);
      expect(await json(first)).toEqual({ status: true });
      expect(await tokenRows(link.token)).toEqual([]);

      const after = await protectedState();
      const second = await reset(link.token, "yet another long passphrase");
      expect(second.status).toBe(400);
      expect(await json(second)).toMatchObject({ code: "INVALID_TOKEN" });
      expect(await protectedState()).toEqual(after);

      expect((await signIn(NEW_PASSWORD)).status).toBe(200);
      expect((await signIn("yet another long passphrase")).status).toBe(401);
    });

    it("signs out every session, requires the new password, and keeps every identity", async () => {
      const phone = await signedIn();
      const laptop = await signedIn();
      expect(await currentUserId(phone)).toBe(ownerId);
      expect(await currentUserId(laptop)).toBe(ownerId);
      const before = await snapshot(t.db);

      const link = await issue();
      const response = await reset(link.token);
      expect(response.status).toBe(200);
      // FR-019: the reset itself signs nobody in.
      expect(cookieHeader(response)).toBe("");

      // SC-004: the old sessions no longer work for anything.
      for (const cookie of [phone, laptop]) {
        expect(await currentUserId(cookie)).toBeUndefined();
        expect((await server.request("/api/auth/organization/list", { headers: { cookie } })).status).toBe(401);
      }
      expect(await t.db.select().from(session).where(eq(session.userId, ownerId))).toEqual([]);

      const old = await signIn(OWNER.password);
      expect(old.status).toBe(401);
      expect(await json(old)).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
      const fresh = await signedIn(NEW_PASSWORD);
      expect(await currentUserId(fresh)).toBe(ownerId);

      // SC-008: the same owner and workspace, no replacement, and the email stays unverified.
      const after = await snapshot(t.db);
      expect(after).toEqual(before);
      expect(after!.email_verified).toBe(false);
      expect(await counts(t.db)).toMatchObject({ users: 1, organizations: 1, members: 1, actors: 2 });
    });

    it("credits the link to the operator and the reset to the owner, and stores no secrets", async () => {
      const known = new Set((await t.db.select({ id: event.id }).from(event)).map((e) => e.id));
      const newEvents = async () => (await t.db.select().from(event)).filter((e) => !known.has(e.id));
      const actors = await t.db.select().from(actor);
      const operator = actors.find((a) => a.kind === "operator")!;
      const human = actors.find((a) => a.kind === "human")!;
      expect(operator.userId).toBeNull();
      expect(human.userId).toBe(ownerId);

      const link = await issue();
      const issued = await newEvents();
      expect(issued).toHaveLength(1);
      expect(issued[0]).toMatchObject({ type: "recovery.link_issued", actorId: operator.id, subjectUserId: ownerId });
      issued.forEach((e) => known.add(e.id));

      expect((await reset(link.token)).status).toBe(200);
      const recovered = await newEvents();
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({ type: "recovery.password_reset", actorId: human.id, subjectUserId: ownerId });

      const stored = JSON.stringify(await t.db.select().from(event));
      const [credential] = await t.db.select().from(account).where(eq(account.userId, ownerId));
      for (const secret of [link.token, link.url, NEW_PASSWORD, credential!.password!]) {
        expect(stored).not.toContain(secret);
      }
    });

    it("refuses an expired link without changing anything", async () => {
      const cookie = await signedIn();
      const link = await issue();
      const expired = await t.db
        .update(verification)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(verification.identifier, storedIdentifier(`reset-password:${link.token}`)))
        .returning();
      expect(expired).toHaveLength(1);
      const before = { state: await protectedState(), events: (await counts(t.db)).events };

      const response = await reset(link.token);
      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ code: "INVALID_TOKEN" });

      expect(await protectedState()).toEqual(before.state);
      expect((await counts(t.db)).events).toBe(before.events);
      expect(await currentUserId(cookie)).toBe(ownerId);
      expect((await signIn(NEW_PASSWORD)).status).toBe(401);
      expect((await signIn(OWNER.password)).status).toBe(200);
    });

    it("refuses missing, malformed, and unknown tokens without changing anything", async () => {
      const cookie = await signedIn();
      const link = await issue();
      const before = {
        state: await protectedState(),
        counts: await counts(t.db),
        tokens: await t.db.select().from(verification),
      };

      const altered = link.token.slice(0, -1) + (link.token.endsWith("A") ? "B" : "A");
      for (const token of [
        undefined,
        "",
        "not-a-token",
        "AAAAAAAAAAAAAAAAAAAAAAAA",
        altered,
        `${link.token}x`,
        ` ${link.token}`,
        link.url,
        "x".repeat(10_000),
      ]) {
        const response = await reset(token);
        expect(response.status, String(token).slice(0, 40)).toBe(400);
        expect(await json(response)).toMatchObject({ code: "INVALID_TOKEN" });
      }

      // A password outside 12 to 128 characters is refused before the link is spent.
      for (const [password, code] of [
        ["too short", "PASSWORD_TOO_SHORT"],
        ["x".repeat(129), "PASSWORD_TOO_LONG"],
      ]) {
        const response = await reset(link.token, password);
        expect(response.status).toBe(400);
        expect(await json(response)).toMatchObject({ code });
      }

      expect(await protectedState()).toEqual(before.state);
      expect(await counts(t.db)).toEqual(before.counts);
      expect(await t.db.select().from(verification)).toEqual(before.tokens);
      expect(await currentUserId(cookie)).toBe(ownerId);

      // The real link still works afterwards.
      expect((await reset(link.token)).status).toBe(200);
    });

    it("lets exactly one of several concurrent resets with the same link succeed", async () => {
      const link = await issue();
      const eventsBefore = (await counts(t.db)).events;
      // A second Better Auth instance on the same database, so the race is decided by storage.
      const other = await startServer(t.db);
      try {
        const passwords = ["first concurrent passphrase", "second concurrent passphrase", "third concurrent passphrase"];
        const responses = await Promise.all([
          reset(link.token, passwords[0]),
          reset(link.token, passwords[1]),
          reset(link.token, passwords[2], other),
        ]);
        const statuses = responses.map((r) => r.status);
        expect(statuses.filter((s) => s === 200)).toHaveLength(1);
        expect(statuses.filter((s) => s === 400)).toHaveLength(2);
        for (const response of responses.filter((r) => r.status === 400)) {
          expect(await json(response)).toMatchObject({ code: "INVALID_TOKEN" });
        }

        const winner = passwords[statuses.indexOf(200)]!;
        for (const password of passwords) {
          expect((await signIn(password)).status, password).toBe(password === winner ? 200 : 401);
        }
        expect((await counts(t.db)).events).toBe(eventsBefore + 1);
      } finally {
        await other.close();
      }
    });

    it("refuses requesting a reset link over HTTP and creates no token", async () => {
      const before = { counts: await counts(t.db), tokens: await t.db.select().from(verification) };
      const bodies: string[] = [];
      for (const email of [OWNER.email, "visitor@example.com"]) {
        const response = await server.request("/api/auth/request-password-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        expect(response.status).toBe(400);
        const text = await response.text();
        expect(JSON.parse(text)).toMatchObject({ code: "RESET_PASSWORD_DISABLED" });
        expect(text).not.toContain(ownerId);
        bodies.push(text);
      }
      // The owner's email and an unknown one get the same answer, so it reveals no account (FR-020).
      expect(bodies[1]).toBe(bodies[0]);
      expect(await t.db.select().from(verification)).toEqual(before.tokens);
      expect(await counts(t.db)).toEqual(before.counts);
    });
  });
});
