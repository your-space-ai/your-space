// The runtime manager (FR-001): the only part of Your Space that holds the engine connection. It has
// no network; the server reaches it on a Unix socket in the ys-runtime volume.
import { chmodSync, chownSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import {
  apply,
  check,
  checkPort,
  connectProxyToAll,
  deleteVolumes,
  denials,
  down,
  INSTALLATION,
  isStopping,
  listApps,
  resolveInterface,
  logs,
  SpecError,
  stats,
  stopAll,
  validatePortCheck,
  validateSpec,
} from "./apps.ts";
import { engineInfo, EngineError } from "./engine.ts";

import { SOCKET_PATH as SOCKET } from "./socket.ts";
/** The server runs as node (1000), which must be able to use the socket. */
const SERVER_UID = 1000;

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new SpecError("The request is too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SpecError("The request isn't JSON.");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function failure(res: ServerResponse, error: unknown): void {
  if (error instanceof SpecError) return send(res, 400, { error: "refused", message: error.message });
  if (error instanceof EngineError) {
    return send(res, error.status, { error: error.status === 503 ? "engine_unreachable" : "engine_error", message: error.message });
  }
  log("error", "runtime.unhandled", { errorName: (error as Error)?.name });
  send(res, 500, { error: "internal_error", message: "Something went wrong in the runtime manager." });
}

const PROJECT_PATH = /^\/apps\/(ys-[a-z][a-z0-9-]{0,29})(\/[a-z]+)?$/;

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://runtime");
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/engine") return send(res, 200, { ...(await engineInfo()), stopping: isStopping() });
  if (method === "GET" && pathname === "/apps") return send(res, 200, await listApps());
  if (method === "POST" && pathname === "/check") return send(res, 200, await check(validateSpec(await readBody(req))));
  if (method === "POST" && pathname === "/stop-all") return send(res, 200, { stopped: await stopAll() });
  if (method === "POST" && pathname === "/apply") {
    const spec = validateSpec(await readBody(req));
    // Progress as one JSON object per line; the last line says whether it worked.
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    const emit = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);
    try {
      await apply(spec, emit);
      emit({ done: true });
      log("info", "app.applied", { project: spec.project });
    } catch (error) {
      const message = error instanceof SpecError || error instanceof EngineError ? error.message : "Something went wrong in the runtime manager.";
      emit({ error: message });
      log("warn", "app.apply_failed", { project: spec.project, errorName: (error as Error)?.name });
    }
    res.end();
    return;
  }

  const match = PROJECT_PATH.exec(pathname);
  if (match) {
    const project = match[1]!;
    const action = match[2] ?? "";
    if (method === "POST" && action === "/down") return (await down(project), send(res, 200, { ok: true }));
    if (method === "DELETE" && action === "/volumes") return (await deleteVolumes(project), send(res, 200, { ok: true }));
    if (method === "GET" && action === "/stats") return send(res, 200, await stats(project));
    if (method === "GET" && action === "/denials") return send(res, 200, await denials(project));
    if (method === "POST" && action === "/port") {
      return send(res, 200, await checkPort(project, validatePortCheck(await readBody(req))));
    }
    if (method === "GET" && action === "/interface") {
      return send(res, 200, await resolveInterface(project, url.searchParams.get("id") ?? "", url.searchParams.get("service") ?? "", Number(url.searchParams.get("port"))));
    }
    if (method === "GET" && action === "/logs") {
      const service = url.searchParams.get("service") ?? "";
      return send(res, 200, { lines: await logs(project, service, Number(url.searchParams.get("tail") ?? 200)) });
    }
  }
  send(res, 404, { error: "not_found", message: "There is nothing at this address." });
}

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent) res.end();
    else failure(res, error);
  });
});

mkdirSync(dirname(SOCKET), { recursive: true });
rmSync(SOCKET, { force: true });
server.listen(SOCKET, () => {
  chmodSync(SOCKET, 0o660);
  try {
    chownSync(SOCKET, 0, SERVER_UID);
  } catch {
    // Not root, as in tests: the socket stays with the current user.
  }
  log("info", "runtime.listening", { installation: INSTALLATION });
});

// Keeps the proxy on every app's network; a failure here only delays a reconnection.
const timer = setInterval(() => {
  connectProxyToAll().catch((error) => log("warn", "runtime.connect_failed", { errorName: (error as Error)?.name }));
}, 10_000);

function shutdown(): void {
  clearInterval(timer);
  // Apps keep running: a restart or update of Your Space doesn't stop them (FR-008).
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
