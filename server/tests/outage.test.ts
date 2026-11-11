// Behavior when storage fails mid-request, and the organization routes closed over HTTP
// (FR-009, FR-010, FR-005, FR-013, FR-016; found in the final review).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { member, session } from "../src/db/auth-schema.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";
import { snapshot } from "./helpers/state.ts";

let t: TestDatabase;
let server: TestServer;
beforeAll(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db);
  await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
});
afterAll(async () => {
  await server.close();
  await t.destroy();
});

async function signIn(): Promise<string> {
  const response = await server.request("/api/auth/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });
  expect(response.status).toBe(200);
  return cookieHeader(response);
}

/** Everything written to the console while `fn` runs. */
async function consoleDuring(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(capture));
  try {
    await fn();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return lines.join("\n");
}

describe("storage failing mid-request", () => {
  it("reports a reset during an outage as a storage problem and never logs the token", async () => {
    const issued = await runCommand("reset-link", ["--json"], { databaseUrl: t.url, publicUrl: server.publicUrl });
    expect(issued.code).toBe(0);
    const { token } = issued.json;

    let status = 0;
    let body = "";
    const output = await consoleDuring(async () => {
      await t.stop();
      try {
        const response = await server.request("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token, newPassword: "a new password during the outage" }),
        });
        status = response.status;
        body = await response.text();
      } finally {
        await t.restore();
      }
    });

    expect(status).toBe(503);
    expect(JSON.parse(body)).toMatchObject({ error: "storage_unavailable" });
    expect(body).not.toContain(token);
    expect(output).not.toContain(token);
    expect(output).not.toMatch(/SERVER_ERROR/);

    // The password didn't change: the old one still signs in.
    await signIn();
  });

  it("refuses sign-out during an outage instead of reporting it done, and the session is unchanged", async () => {
    const cookie = await signIn();
    const before = await t.db.select().from(session);

    await t.stop();
    let response: Response;
    try {
      response = await server.request("/api/auth/sign-out", { method: "POST", body: "{}", headers: { cookie } });
    } finally {
      await t.restore();
    }
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "storage_unavailable" });
    expect(response.headers.getSetCookie()).toEqual([]);

    expect(await t.db.select().from(session)).toEqual(before);
    const current = await server.request("/api/auth/get-session", { headers: { cookie } });
    expect(((await current.json()) as { user: { username: string } }).user.username).toBe(OWNER.username);

    // Once storage is back, sign-out works and the session is gone.
    const signOut = await server.request("/api/auth/sign-out", { method: "POST", body: "{}", headers: { cookie } });
    expect(signOut.status).toBe(200);
    const after = await server.request("/api/auth/get-session", { headers: { cookie } });
    expect(await after.json()).toBeNull();
  });

  it("refuses sign-out when the database can read but not delete, and the session is unchanged", async () => {
    const cookie = await signIn();
    const before = await t.db.select().from(session);
    // Like a read-only database: reads work, deleting a session fails.
    await t.db.execute(sql`create function refuse_delete() returns trigger language plpgsql as $$
      begin raise exception 'read-only for the test' using errcode = '25006'; end $$`);
    await t.db.execute(sql`create trigger refuse_delete before delete on session for each row execute function refuse_delete()`);
    try {
      const response = await server.request("/api/auth/sign-out", { method: "POST", body: "{}", headers: { cookie } });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "storage_unavailable" });
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      await t.db.execute(sql`drop trigger refuse_delete on session`);
      await t.db.execute(sql`drop function refuse_delete()`);
    }
    expect(await t.db.select().from(session)).toEqual(before);
    const signOut = await server.request("/api/auth/sign-out", { method: "POST", body: "{}", headers: { cookie } });
    expect(signOut.status).toBe(200);
    expect(await (await server.request("/api/auth/get-session", { headers: { cookie } })).json()).toBeNull();
  });

  it("survives losing the database while a connection is checked out", async () => {
    const client = await t.pool.connect();
    try {
      await client.query("begin");
      await t.stop();
      // The connection is gone; the process must still be running and reporting the outage.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await server.request("/api/status");
      expect(status.status).toBe(503);
    } finally {
      client.release(true);
      await t.restore();
    }
    const status = await server.request("/api/status");
    expect(await status.json()).toEqual({ owner: true });
  });
});

describe("organization routes over HTTP", () => {
  it.each([
    ["/organization/update-member-role", { memberId: "x", role: "member" }],
    ["/organization/remove-member", { memberIdOrEmail: "sam@users.invalid" }],
    ["/organization/leave", { organizationId: "x" }],
    ["/organization/delete", { organizationId: "x" }],
    ["/organization/update", { data: { name: "Renamed" } }],
    ["/organization/invite-member", { email: "guest@example.com", role: "member" }],
    ["/organization/accept-invitation", { invitationId: "x" }],
    ["/organization/create", { name: "Second", slug: "second" }],
  ])("refuses %s, even for the signed-in owner", async (path, body) => {
    const cookie = await signIn();
    const before = await snapshot(t.db);
    const response = await server.request(`/api/auth${path}`, { method: "POST", body: JSON.stringify(body), headers: { cookie } });
    expect(response.status).toBe(404);
    expect(await snapshot(t.db)).toEqual(before);
    const owners = await t.db.select().from(member).where(and(eq(member.role, "owner")));
    expect(owners).toHaveLength(1);
    // Spaces the sign-in limit (3 per 10 seconds per address in production; off in tests).
    await t.db.execute(sql`select 1`);
  });

  it("keeps listing the owner's workspace", async () => {
    const cookie = await signIn();
    const response = await server.request("/api/auth/organization/list", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ name: "Sam Rivera's space" }]);
  });
});
