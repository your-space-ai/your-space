import { afterAll, beforeAll, expect } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { fakeGithub, FakeRuntime, kitLink, plainKit } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

// An app whose kit names its interface and nothing else.
const PLAIN = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    environment:
      GREETING: \${GREETING:-hello}
      API_TOKEN: \${API_TOKEN:-published-default-token}
`;
const LINK = kitLink("plain");

let t: TestDatabase;
let server: TestServer;
let cookie: string;

function useServer(runtime: FakeRuntime): void {
  beforeAll(async () => {
    t = await createTestDatabase();
    server = await startServer(t.db, { apps: { runtime, fetch: fakeGithub({ "ys-fixtures/plain/compose.yaml": PLAIN, ...plainKit("plain") }) } });
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
  const review = (await (await send("/api/kits/preview", { kitUrl: LINK })).json()) as any;
  const installed = await send("/api/apps", { previewId: review.previewId });
  expect(installed.status).toBe(202);
  await waitForJob(((await installed.json()) as any).jobId);
}

import { describe, it } from "vitest";
import { RuntimeError } from "../src/apps/runtime-client.ts";

class FailingDown extends FakeRuntime {
  override async down(): Promise<void> {
    throw new RuntimeError("Removing the app failed: compose down failed.", 502, "engine_error");
  }
}
const runtime = new FailingDown();
useServer(runtime);

describe("a failed removal", () => {
  it("shows the app as failed with the reason, and it can be removed again", async () => {
    await install();
    const removed = await send("/api/apps/plain/remove", {});
    expect(removed.status).toBe(202);
    const job = await waitForJob(((await removed.json()) as any).jobId);
    expect(job.state).toBe("failed");
    const detail = (await (await api("/api/apps/plain")).json()) as any;
    expect(detail.state).toBe("failed");
    expect(detail.stateReason).toMatch(/compose down failed/);
    const again = await send("/api/apps/plain/remove", {});
    expect(again.status).toBe(202);
    await waitForJob(((await again.json()) as any).jobId);
  });
});
