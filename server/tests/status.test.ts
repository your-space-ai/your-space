// T025: /api/status and /api/health tell "no owner yet" apart from "storage down" (FR-013).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installation } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { startServer, type TestServer } from "./helpers/server.ts";

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

async function get(path: string) {
  const response = await server.request(path);
  return { status: response.status, body: await response.json() };
}

describe("status and health", () => {
  it("reports no owner, then the owner", async () => {
    expect(await get("/api/status")).toEqual({ status: 200, body: { owner: false } });
    expect(await get("/api/health")).toEqual({ status: 200, body: { status: "ok" } });
    await createOwnerWithPassword(t.db, undefined, server.publicUrl);
    expect(await get("/api/status")).toEqual({ status: 200, body: { owner: true } });
  });

  it("reports storage_unavailable while the database is down, never no owner, and recovers without a restart", async () => {
    await t.stop();
    expect(await get("/api/status")).toEqual({ status: 503, body: { state: "storage_unavailable" } });
    expect(await get("/api/health")).toEqual({ status: 503, body: { status: "storage_unavailable" } });
    await t.restore();
    expect(await get("/api/status")).toEqual({ status: 200, body: { owner: true } });
    expect(await get("/api/health")).toEqual({ status: 200, body: { status: "ok" } });
  });

  it("reports storage_unavailable when the installation record is missing", async () => {
    await t.db.delete(installation);
    expect(await get("/api/status")).toEqual({ status: 503, body: { state: "storage_unavailable" } });
    expect(await get("/api/health")).toEqual({ status: 503, body: { status: "storage_unavailable" } });
  });

  it("answers unknown API paths with the error shape", async () => {
    expect(await get("/api/nothing-here")).toEqual({
      status: 404,
      body: { error: "not_found", message: "There is nothing at this address." },
    });
  });
});
