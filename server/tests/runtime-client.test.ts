// The runtime manager's client: a request that hears nothing for its timeout fails as one the runtime
// manager stopped answering, not as one it isn't running for; and the knowledge bases' sync service
// (journey 014) is asked for by its knowledge bases' names alone.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RuntimeError, socketRuntime } from "../src/apps/runtime-client.ts";

const ANSWER_MS = 300;
const dir = mkdtempSync(join(tmpdir(), "ys-runtime-client-"));
const socket = join(dir, "runtime.sock");
let server: Server;
const asked: { method: string; url: string; body: string }[] = [];

beforeAll(async () => {
  // A runtime manager that answers every request once ANSWER_MS have passed, saying nothing before.
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      asked.push({ method: req.method ?? "", url: req.url ?? "", body });
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(req.url?.startsWith("/knowledge-sync") ? JSON.stringify({ running: true, knowledgeBases: ["notes"], fixture: false, socket: "/run/ys-sync/rc.sock" }) : JSON.stringify({ reachable: true, connection: "test" }));
      }, ANSWER_MS);
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("the runtime client", () => {
  it("says the runtime manager stopped answering when a request hears nothing for its timeout", async () => {
    const engine = await socketRuntime(socket, 100)
      .engine()
      .catch((error: unknown) => error);
    expect(engine).toBeInstanceOf(RuntimeError);
    expect(engine).toMatchObject({ status: 504, code: "runtime_timeout" });
  });

  it("asks for the sync's service by the knowledge bases' names, and nothing else", async () => {
    const runtime = socketRuntime(socket, 2_000);
    expect(await runtime.ensureSyncService(["notes"])).toMatchObject({ running: true, knowledgeBases: ["notes"] });
    expect(asked.at(-1)).toEqual({ method: "PUT", url: "/knowledge-sync", body: JSON.stringify({ knowledgeBases: ["notes"] }) });
    await runtime.restartSyncService();
    expect(asked.at(-1)).toMatchObject({ method: "POST", url: "/knowledge-sync/restart" });
    await runtime.syncService();
    expect(asked.at(-1)).toMatchObject({ method: "GET", url: "/knowledge-sync" });
  });
});
