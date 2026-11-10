// T024: no account, workspace, or membership can be created over HTTP (FR-002, FR-005).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";
import { counts } from "./helpers/state.ts";

let t: TestDatabase;
let server: TestServer;
beforeAll(async () => {
  t = await createTestDatabase();
  server = await startServer(t.db);
});
afterAll(async () => {
  await server.close();
  await t.destroy();
});

const signUp = (email: string) =>
  server.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, name: "Visitor", password: "a-long-enough-password" }),
  });

describe("closed sign-up", () => {
  it("refuses sign-up before the owner exists", async () => {
    const response = await signUp("visitor@example.com");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
    expect(await counts(t.db)).toMatchObject({ users: 0, organizations: 0, members: 0 });
  });

  it("refuses sign-up after the owner exists, including with the owner's email", async () => {
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const before = await counts(t.db);
    for (const email of ["visitor@example.com", OWNER.email]) {
      const response = await signUp(email);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
    }
    expect(await counts(t.db)).toEqual(before);
  });

  it("refuses creating a workspace over HTTP, signed out or signed in as the owner", async () => {
    const before = await counts(t.db);
    const body = JSON.stringify({ name: "Second space", slug: "second-space" });

    // The route is turned off on the public instance, so it is refused before any session check.
    const anonymous = await server.request("/api/auth/organization/create", { method: "POST", body });
    expect(anonymous.status).toBe(404);

    const signIn = await server.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
    });
    expect(signIn.status).toBe(200);
    const cookie = cookieHeader(signIn);

    const asOwner = await server.request("/api/auth/organization/create", { method: "POST", body, headers: { cookie } });
    expect(asOwner.status).toBe(404);

    // Naming another user as the creator is server-only; over HTTP the route is refused too.
    const asOther = await server.request("/api/auth/organization/create", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ name: "Third", slug: "third", userId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(asOther.status).toBe(404);

    expect(await counts(t.db)).toMatchObject({ users: before.users, organizations: 1, members: 1 });
  });

  it("does not expose adding members over HTTP", async () => {
    const response = await server.request("/api/auth/organization/add-member", {
      method: "POST",
      body: JSON.stringify({ userId: "x", role: "owner", organizationId: "y" }),
    });
    expect(response.status).toBe(404);
    expect(await counts(t.db)).toMatchObject({ members: 1 });
  });
});
