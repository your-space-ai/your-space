// The API answers only requests that name Your Space's public address (contracts/http-api.md). This
// catches proxies that rewrite the Host header and pages that re-point their own name at this
// machine (DNS rebinding), whose requests would otherwise reach the sign-in route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { session } from "../src/db/auth-schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { startServer, type TestServer } from "./helpers/server.ts";

let t: TestDatabase;
let local: TestServer;
let proxied: TestServer;
beforeAll(async () => {
  t = await createTestDatabase();
  local = await startServer(t.db);
  proxied = await startServer(t.db, { publicUrl: "https://space.example.test" });
  await createOwnerWithPassword(t.db, OWNER, proxied.publicUrl);
});
afterAll(async () => {
  await local.close();
  await proxied.close();
  await t.destroy();
});

const signIn = (server: TestServer, host?: string) =>
  server.request("/api/auth/sign-in/username", {
    method: "POST",
    headers: host ? { host } : {},
    body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
  });

describe("Host guard", () => {
  it("answers requests that name the public address", async () => {
    expect((await local.request("/api/status")).status).toBe(200);
    expect((await proxied.request("/api/status")).status).toBe(200);
    expect((await proxied.request("/api/status", { headers: { host: "SPACE.example.test" } })).status).toBe(200);
  });

  it.each(["127.0.0.1:8080", "your-space:8080", "attacker.example", "space.example.test:8443"])(
    "refuses Host %s with 421 and says how to fix the proxy",
    async (host) => {
      const response = await proxied.request("/api/status", { headers: { host } });
      expect(response.status).toBe(421);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("wrong_host");
      expect(body.message).toContain("set up for https://space.example.test");
      expect(body.message).toContain("proxy_set_header Host $http_host");
    },
  );

  it("refuses sign-in under another name before Better Auth sees it, and creates no session", async () => {
    const before = await t.db.select().from(session);
    const response = await signIn(proxied, "127.0.0.1:8080");
    expect(response.status).toBe(421);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await t.db.select().from(session)).toEqual(before);
    expect((await signIn(proxied)).status).toBe(200);
  });

  it("refuses a localhost setup reached under another name", async () => {
    const port = new URL(local.publicUrl).port;
    expect((await local.request("/api/status", { headers: { host: `127.0.0.1:${port}` } })).status).toBe(421);
    expect((await local.request("/api/status", { headers: { host: "localhost" } })).status).toBe(421);
  });

  it("leaves /api/health open to Docker's health check under any name", async () => {
    const response = await proxied.request("/api/health", { headers: { host: "127.0.0.1:3000" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
