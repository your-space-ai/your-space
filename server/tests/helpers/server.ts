// Starts the real Express app on a random port against a test database.
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app.ts";
import { createAuth, type Auth } from "../../src/auth.ts";
import type { Runtime } from "../../src/apps/runtime-client.ts";
import { AppsService } from "../../src/apps/service.ts";
import type { Db } from "../../src/db/client.ts";
import { TEST_SECRET } from "./env.ts";

export interface TestServer {
  /** e.g. http://localhost:51234 */
  url: string;
  /** The address Better Auth was configured with (derived from YS_PORT or YS_PROXY_URL). */
  publicUrl: string;
  auth: Auth;
  /** The apps service, when the server was started with a runtime. */
  apps?: AppsService;
  /** fetch against the server, with the Origin header a browser on publicUrl would send. */
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface AppsOptions {
  runtime: Runtime;
  /** Stands in for GitHub. */
  fetch: typeof fetch;
}

export async function startServer(db: Db, options: { publicUrl?: string; apps?: AppsOptions } = {}): Promise<TestServer> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  const publicUrl = options.publicUrl ?? url;
  const auth = createAuth({ config: { publicUrl, authSecret: TEST_SECRET }, db });
  const apps = options.apps
    ? new AppsService(db, options.apps.runtime, {
        publicUrl,
        authSecret: TEST_SECRET,
        fetch: options.apps.fetch,
        github: { api: "https://api.github.test", raw: "https://raw.github.test" },
      })
    : undefined;
  server.on("request", createApp({ auth, db, apps: apps ? { service: apps } : undefined }));
  return {
    url,
    publicUrl,
    auth,
    apps,
    request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("origin")) headers.set("origin", publicUrl);
      if (!headers.has("host")) headers.set("host", new URL(publicUrl).host);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      return send(`${url}${path}`, init.method ?? "GET", headers, init.body);
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * One HTTP request, without following redirects. Unlike fetch, it sends the Host header given, so
 * a test can be a browser on an https public address while the server listens on localhost.
 */
function send(url: string, method: string, headers: Headers, body: RequestInit["body"]): Promise<Response> {
  if (body !== undefined && body !== null && typeof body !== "string") throw new Error("send() takes a string body");
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: Object.fromEntries(headers) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item);
        }
        const status = res.statusCode ?? 0;
        resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers: responseHeaders }));
      });
    });
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}

/** The `name=value` pairs from a response's Set-Cookie headers, ready for a Cookie header. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
