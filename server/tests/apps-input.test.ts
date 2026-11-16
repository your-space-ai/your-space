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
import type { ApplyEvent, AppSpec } from "../src/apps/runtime-client.ts";

/** Holds each apply until released, so a test can catch the app while it's busy. */
class HeldRuntime extends FakeRuntime {
  hold = false;
  release: () => void = () => {};
  override async apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void) {
    if (this.hold) await new Promise<void>((resolve) => (this.release = resolve));
    return super.apply(spec, onEvent);
  }
}
const runtime = new HeldRuntime();
useServer(runtime);

describe("apps API input", () => {
  it("refuses settings that aren't text, and installs nothing", async () => {
    for (const settings of [{ GREETING: 123 }, { GREETING: { a: 1 } }, ["GREETING"], "GREETING=hi"]) {
      const review = (await (await send("/api/apps/preview", { link: LINK })).json()) as any;
      const response = await send("/api/apps", { previewId: review.previewId, settings });
      expect(response.status, JSON.stringify(settings)).toBe(400);
      expect(((await response.json()) as any).error).toBe("invalid_setting");
    }
    expect(await t.db.select().from(app)).toEqual([]);
  });

  it("refuses to start an app that is busy, without changing what it should be doing", async () => {
    await install();
    runtime.hold = true;
    const first = await send("/api/apps/plain/start", {});
    expect(first.status).toBe(202);
    await t.db.update(app).set({ desired: "stopped" }).where(eq(app.name, "plain"));
    const second = await send("/api/apps/plain/start", {});
    expect(second.status).toBe(409);
    expect(await desired()).toBe("stopped");
    runtime.hold = false;
    runtime.release();
    await waitForJob(((await first.json()) as any).jobId);
  });
});
