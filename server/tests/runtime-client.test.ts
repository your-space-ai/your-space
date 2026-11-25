// The runtime manager's client: a request that hears nothing for its timeout fails, but a sync run,
// which the runtime manager answers only when the run ends, waits for its own, longer timeout.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CALL_TIMEOUT_MS, RuntimeError, socketRuntime, SYNC_TIMEOUT_MS } from "../src/apps/runtime-client.ts";

const ANSWER_MS = 300;
const dir = mkdtempSync(join(tmpdir(), "ys-runtime-client-"));
const socket = join(dir, "runtime.sock");
let server: Server;

beforeAll(async () => {
  // A runtime manager that answers every request once ANSWER_MS have passed, saying nothing before.
  server = createServer((req, res) => {
    req.resume();
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url?.endsWith("/sync") ? JSON.stringify({ result: "synced", deletions: [], ties: [], conflicts: [], backups: [], changed: false }) : JSON.stringify({ reachable: true, connection: "test" }));
    }, ANSWER_MS);
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("the runtime client's timeouts", () => {
  it("waits for a sync run past the time any other request waits", async () => {
    const runtime = socketRuntime(socket, { callMs: 100, syncMs: 2_000 });
    const engine = await runtime.engine().catch((error: unknown) => error);
    expect(engine).toBeInstanceOf(RuntimeError);
    expect(engine).toMatchObject({ status: 504, code: "runtime_timeout" });
    const remote = { type: "drive" as const, clientId: "id", clientSecret: "secret", token: "{}", folderId: "folder" };
    expect(await runtime.syncKnowledge("notes", { remote, mode: "sync" })).toMatchObject({ result: "synced" });
  });

  it("gives a sync run longer than the runtime manager's two hours for a run", () => {
    expect(SYNC_TIMEOUT_MS).toBeGreaterThan(2 * 60 * 60_000);
    expect(SYNC_TIMEOUT_MS).toBeGreaterThan(CALL_TIMEOUT_MS);
  });
});
