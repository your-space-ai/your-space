// Starts the real Express app on a random port against a test database.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app.ts";
import { createAuth, type Auth } from "../../src/auth.ts";
import type { Db } from "../../src/db/client.ts";
import { TEST_SECRET } from "./env.ts";

export interface TestServer {
  /** e.g. http://localhost:51234 */
  url: string;
  /** The address Better Auth was configured with (YS_PUBLIC_URL). */
  publicUrl: string;
  auth: Auth;
  /** fetch against the server, with the Origin header a browser on publicUrl would send. */
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function startServer(db: Db, options: { publicUrl?: string } = {}): Promise<TestServer> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  const publicUrl = options.publicUrl ?? url;
  const auth = createAuth({ config: { publicUrl, authSecret: TEST_SECRET }, db });
  server.on("request", createApp({ auth, db }));
  return {
    url,
    publicUrl,
    auth,
    request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("origin")) headers.set("origin", publicUrl);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      return fetch(`${url}${path}`, { ...init, headers, redirect: "manual" });
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** The `name=value` pairs from a response's Set-Cookie headers, ready for a Cookie header. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
