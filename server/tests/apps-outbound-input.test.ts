import { afterAll, beforeAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { fakeGithub, FakeRuntime } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

// An app without a kit: its interface is the one service that publishes a port.
const PLAIN = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    environment:
      GREETING: \${GREETING:-hello}
      API_TOKEN: \${API_TOKEN:-published-default-token}
`;
const LINK = "https://github.com/ys-fixtures/plain/blob/main/compose.yaml";

let t: TestDatabase;
let server: TestServer;
let cookie: string;

function useServer(runtime: FakeRuntime): void {
  beforeAll(async () => {
    t = await createTestDatabase();
    server = await startServer(t.db, { apps: { runtime, fetch: fakeGithub({ "ys-fixtures/plain/compose.yaml": PLAIN }) } });
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
    cookie = cookieHeader(signedIn);
  });
  afterAll(async () => {
    await server?.close();
    await t?.destroy();
  });
}

const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
const send = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });

async function waitForJob(jobId: string): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const job = (await (await api(`/api/jobs/${jobId}`)).json()) as any;
    if (job.state !== "running") return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("The job didn't finish.");
}

async function install(): Promise<void> {
  const review = (await (await send("/api/apps/preview", { link: LINK })).json()) as any;
  const installed = await send("/api/apps", { previewId: review.previewId });
  expect(installed.status).toBe(202);
  await waitForJob(((await installed.json()) as any).jobId);
}

async function desired(): Promise<string> {
  return (await t.db.select({ desired: app.desired }).from(app).where(eq(app.name, "plain")))[0]!.desired;
}

import { describe, it } from "vitest";
import { appAccessRequest, appSetting } from "../src/db/schema.ts";
import { decrypt } from "../src/apps/settings.ts";
import { TEST_SECRET } from "./helpers/env.ts";

const runtime = new FakeRuntime();
useServer(runtime);

describe("outbound and settings input", () => {
  it("turns only real host names into access requests, and keeps at most 50 waiting", async () => {
    await install();
    const now = new Date().toISOString();
    const names = ["bad_host.example", "single", "-x.example", "a".repeat(300) + ".example", ...Array.from({ length: 60 }, (_, i) => `h${i}.example.com`)];
    runtime.denied.set("ys-plain", names.map((host) => ({ host, attempts: 1, lastSeen: now })));
    await server.apps!.reconcile();
    const stored = (await t.db.select().from(appAccessRequest)).map((r) => r.host);
    expect(stored).toHaveLength(50);
    expect(stored.every((h) => /^h\d+\.example\.com$/.test(h))).toBe(true);
    // A host already waiting still has its attempts counted when the list is full.
    runtime.denied.set("ys-plain", [{ host: stored[0]!, attempts: 9, lastSeen: now }]);
    await server.apps!.reconcile();
    const [first] = await t.db.select().from(appAccessRequest).where(eq(appAccessRequest.host, stored[0]!));
    expect(first!.attempts).toBe(9);
  });

  it("checks every setting before saving any", async () => {
    const before = await t.db.select().from(appSetting);
    const response = await send("/api/apps/plain/settings", { values: { GREETING: "changed", NOPE: "x" } }, "PUT");
    expect(response.status).toBe(400);
    expect(await t.db.select().from(appSetting)).toEqual(before);
  });

  it("refuses to clear a secret, which would bring back its published default", async () => {
    const response = await send("/api/apps/plain/settings", { values: { API_TOKEN: "" } }, "PUT");
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toBe("secret_required");
    const [token] = await t.db.select().from(appSetting).where(eq(appSetting.name, "API_TOKEN"));
    expect(decrypt(TEST_SECRET, token!.value!)).not.toBe("published-default-token");
  });
});
