// Journey 002 on the server: installing, managing and reaching apps, with a fake runtime and a
// stand-in for GitHub. The runtime manager's own rules are tested in runtime/tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createGate, Handoffs, readCookie, safeReturn, signPass, verifyPass } from "../src/apps/gate.ts";
import { fetchSource, parseLink, SourceError } from "../src/apps/github.ts";
import { KitError, parseKit, parseMemory } from "../src/apps/kits.ts";
import { appNameFromHost, stateFromServices } from "../src/apps/service.ts";
import { buildSettings, decrypt, encrypt, looksSecret } from "../src/apps/settings.ts";
import { session } from "../src/db/auth-schema.ts";
import { app, appSetting, event, installJob } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_SECRET } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { COMMIT, fakeGithub, FakeRuntime } from "./helpers/runtime.ts";
import { cookieHeader, send, startServer, type TestServer } from "./helpers/server.ts";

const WHOAMI = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    environment:
      GREETING: \${GREETING:-hello}
      API_TOKEN: \${API_TOKEN:-published-default-token}
`;
const KIT = `kit: 1
source: { repo: ys-fixtures/whoami, path: compose.yaml }
name: whoami
title: Who Am I
interface: { service: web, port: 80 }
generate:
  API_TOKEN: { bytes: 24 }
outbound: [example.com]
limits:
  web: { memory: 64M, cpus: 0.5 }
`;
const LINK = "https://github.com/ys-fixtures/whoami/blob/main/compose.yaml";

describe("links, kits and settings", () => {
  it("reads GitHub file links and refuses anything else", () => {
    expect(parseLink(LINK)).toEqual({ repo: "ys-fixtures/whoami", rest: ["main", "compose.yaml"] });
    expect(parseLink("https://raw.githubusercontent.com/a/b/main/x/compose.yml").rest).toEqual(["main", "x", "compose.yml"]);
    for (const bad of ["not a link", "http://github.com/a/b/blob/main/c.yml", "https://gitlab.com/a/b/blob/main/c.yml", "https://github.com/a/b", "https://github.com/a/b/tree/main"]) {
      expect(() => parseLink(bad), bad).toThrow(SourceError);
    }
  });

  it("resolves a branch with a slash to its exact commit", async () => {
    const github = fakeGithub({ "a/b/deploy/compose.yaml": "services: {}" });
    const file = await fetchSource("https://github.com/a/b/blob/feature/x/deploy/compose.yaml", { api: "https://api.github.test", raw: "https://raw.github.test" }, github);
    expect(file).toMatchObject({ repo: "a/b", ref: "feature/x", path: "deploy/compose.yaml", commit: COMMIT });
    await expect(fetchSource("https://github.com/a/b/blob/nope/compose.yaml", { api: "https://api.github.test", raw: "https://raw.github.test" }, github)).rejects.toThrow(/branch, tag or commit/);
  });

  it("validates kits strictly", () => {
    const kit = parseKit(KIT);
    expect(kit).toMatchObject({ name: "whoami", interface: { service: "web", port: 80 }, outbound: ["example.com"], limits: { web: { memory: 64 * 1024 ** 2, cpus: 0.5 } } });
    expect(() => parseKit(`${KIT}\nextra: true`)).toThrow(KitError);
    expect(() => parseKit(KIT.replace("kit: 1", "kit: 2"))).toThrow(/format/);
    expect(() => parseKit(KIT.replace("[example.com]", "['http://x']"))).toThrow(/host name/);
    expect(() => parseKit(KIT.replace("bytes: 24", "bytes: 4"))).toThrow(/16 to 128/);
    expect(parseMemory("1.5G")).toBe(1.5 * 1024 ** 3);
    expect(() => parseMemory("lots")).toThrow(KitError);
  });

  it("never uses a published default for a secret", () => {
    const address = { origin: "http://x.space.localhost", host: "x.space.localhost" };
    const variables = [
      { name: "POSTGRES_PASSWORD", required: false, default: "sure_password" },
      { name: "GREETING", required: false, default: "hello" },
      { name: "OPENAI_ACCESS_TOKEN", required: false, default: "" },
    ];
    const withoutKit = buildSettings(variables, null, address);
    const password = withoutKit.find((s) => s.name === "POSTGRES_PASSWORD")!;
    expect(password).toMatchObject({ secret: true, generated: true, publishedDefault: null });
    expect(password.value).not.toBe("sure_password");
    expect(password.value!.length).toBeGreaterThanOrEqual(40);
    expect(withoutKit.find((s) => s.name === "GREETING")).toMatchObject({ secret: false, value: null, publishedDefault: "hello" });
    expect(withoutKit.find((s) => s.name === "OPENAI_ACCESS_TOKEN")).toMatchObject({ secret: true, generated: false, value: null });

    const kit = parseKit(`kit: 1\nsource: { repo: a/b, path: c }\ngenerate: { APP_SECRET: { encoding: hex } }\nderive: { SERVER_URL: app_origin }\nset: { STORAGE_TYPE: local }`);
    const withKit = buildSettings([{ name: "SERVER_URL", required: false, default: "http://localhost:3000" }, { name: "STORAGE_TYPE", required: false, default: "" }], kit, address);
    expect(withKit.find((s) => s.name === "STORAGE_TYPE")).toMatchObject({ value: "local", generated: false, secret: false });
    expect(withKit.find((s) => s.name === "SERVER_URL")).toMatchObject({ derived: true, value: "http://x.space.localhost" });
    expect(withKit.find((s) => s.name === "APP_SECRET")!.value).toMatch(/^[0-9a-f]{64}$/);
    expect(looksSecret("SECRET_KEY_BASE") && looksSecret("ENCRYPTION_KEY") && !looksSecret("DB_PORT") && !looksSecret("KEYBOARD")).toBe(true);
  });

  it("encrypts settings so the stored form never contains the value", () => {
    const stored = encrypt(TEST_SECRET, "hunter2-hunter2");
    expect(stored).not.toContain("hunter2");
    expect(decrypt(TEST_SECRET, stored)).toBe("hunter2-hunter2");
    expect(() => decrypt(`${TEST_SECRET}x`, stored)).toThrow();
  });
});

describe("the access gate's parts", () => {
  it("signs passes for one app and one session, until they expire", () => {
    const pass = signPass(TEST_SECRET, "sure", "session-1", 2_000_000_000);
    expect(verifyPass(TEST_SECRET, pass, "sure", 1_900_000_000)).toBe("session-1");
    expect(verifyPass(TEST_SECRET, pass, "twenty", 1_900_000_000)).toBeUndefined();
    expect(verifyPass(TEST_SECRET, pass, "sure", 2_100_000_000)).toBeUndefined();
    expect(verifyPass(`${TEST_SECRET}x`, pass, "sure", 1_900_000_000)).toBeUndefined();
    expect(verifyPass(TEST_SECRET, `${pass.slice(0, -2)}xx`, "sure", 1_900_000_000)).toBeUndefined();
  });

  it("returns only to paths on the same origin", () => {
    expect(safeReturn("/a?b=1")).toBe("/a?b=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", undefined, 3]) expect(safeReturn(bad)).toBe("/");
  });

  it("names an app only by a direct subdomain of Your Space's host", () => {
    expect(appNameFromHost("http://space.localhost", "sure.space.localhost:8081")).toBe("sure");
    expect(appNameFromHost("https://space.example.com", "Sure.Space.Example.com")).toBe("sure");
    for (const bad of ["space.localhost", "a.b.space.localhost", "sure.localhost", "evil-space.localhost", "1x.space.localhost"]) {
      expect(appNameFromHost("http://space.localhost", bad), bad).toBeUndefined();
    }
  });

  it("reads one cookie from a header", () => {
    expect(readCookie("a=1; ys-pass=abc.def; b=2", "ys-pass")).toBe("abc.def");
    expect(readCookie("xys-pass=1", "ys-pass")).toBeUndefined();
  });

  it("reports an app's state from its services", () => {
    expect(stateFromServices([{ name: "web", role: "app", state: "running" }]).state).toBe("running");
    expect(stateFromServices([{ name: "db", role: "app", state: "running", health: "starting" }]).state).toBe("starting");
    expect(stateFromServices([])).toEqual({ state: "stopped", reason: "Not running." });
    const oom = stateFromServices([
      { name: "web", role: "app", state: "running" },
      { name: "worker", role: "app", state: "exited", exitCode: 137, oomKilled: true },
    ]);
    expect(oom).toEqual({ state: "degraded", reason: "worker stopped: it ran out of memory." });
  });
});

describe("apps API", () => {
  let t: TestDatabase;
  let server: TestServer;
  let runtime: FakeRuntime;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    runtime = new FakeRuntime();
    server = await startServer(t.db, {
      apps: {
        runtime,
        fetch: fakeGithub({
          "ys-fixtures/whoami/compose.yaml": WHOAMI,
          "your-space-ai/your-space-app-kits/apps/ys-fixtures/whoami.yaml": KIT,
          "ys-fixtures/plain/compose.yaml": WHOAMI,
        }),
      },
    });
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
    cookie = cookieHeader(signedIn);
  });
  afterAll(async () => {
    await server?.close();
    await t?.destroy();
  });

  const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
  const post = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });

  /** Waits until no install job is running, however slow the machine: jobs run in the background. */
  async function settled(): Promise<void> {
    for (let i = 0; i < 500; i++) {
      const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("A job didn't finish.");
  }

  it("refuses everyone but the signed-in owner, and changes nothing", async () => {
    for (const [method, path] of [["GET", "/api/apps"], ["POST", "/api/apps/preview"], ["POST", "/api/apps"], ["GET", "/api/engine"]]) {
      const response = await server.request(path!, { method, body: method === "GET" ? undefined : "{}" });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(await t.db.select().from(app)).toEqual([]);
  });

  it("reviews an app without showing generated secrets, then installs it", async () => {
    const response = await post("/api/apps/preview", { link: LINK });
    expect(response.status).toBe(200);
    const text = await response.text();
    const review = JSON.parse(text);
    expect(review).toMatchObject({ name: "whoami", title: "Who Am I", ok: true, origin: `http://whoami.${new URL(server.publicUrl).host}`, outbound: ["example.com"], interface: { service: "web", port: 80 } });
    expect(review.source).toMatchObject({ repo: "ys-fixtures/whoami", commit: COMMIT });
    expect(review.kit.source).toContain(`your-space-app-kits/blob/${COMMIT}/apps/ys-fixtures/whoami.yaml`);
    expect(review.settings.find((s: { name: string }) => s.name === "API_TOKEN")).toMatchObject({ secret: true, generated: true, set: true });
    expect(text).not.toContain("published-default-token");
    expect(review.warning).toMatch(/trusts it/);

    const installed = await post("/api/apps", { previewId: review.previewId });
    expect(installed.status).toBe(202);
    const { jobId } = await installed.json() as any;
    let job;
    for (let i = 0; i < 50; i++) {
      job = await (await api(`/api/jobs/${jobId}`)).json() as any;
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job.state).toBe("succeeded");

    const applied = runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!;
    expect(applied).toMatchObject({ project: "ys-whoami", egress: ["example.com"], interface: { service: "web", port: 80 }, limits: { web: { memory: 64 * 1024 ** 2, cpus: 0.5 } } });
    expect(applied.pins).toEqual({ "traefik/whoami:latest": "sha256:aaa", "ubuntu/squid:latest": "sha256:bbb" });
    expect(applied.env.API_TOKEN).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(applied.env.API_TOKEN).not.toBe("published-default-token");

    const [row] = await t.db.select().from(app).where(eq(app.name, "whoami"));
    expect(row).toMatchObject({ state: "running", commit: COMMIT, repo: "ys-fixtures/whoami" });
    const stored = await t.db.select().from(appSetting).where(eq(appSetting.appId, row!.id));
    expect(JSON.stringify(stored)).not.toContain(applied.env.API_TOKEN!);
    const installedEvents = await t.db.select().from(event).where(eq(event.type, "app.installed"));
    expect(installedEvents).toHaveLength(1);
    expect(installedEvents[0]!.subjectAppId).toBe(row!.id);
  });

  it("lists the app and shows its details without secret values", async () => {
    const list = await (await api("/api/apps")).json() as any;
    expect(list.apps).toEqual([expect.objectContaining({ name: "whoami", state: "running", hasInterface: true, pendingRequests: 0 })]);
    const text = await (await api("/api/apps/whoami")).text();
    const detail = JSON.parse(text);
    const token = detail.settings.find((s: { name: string }) => s.name === "API_TOKEN");
    expect(token).toMatchObject({ set: true, secret: true });
    expect(token.value).toBeUndefined();
    expect(text).not.toContain(runtime.calls.find((c) => c.method === "apply")!.spec!.env.API_TOKEN!);
    expect(detail.outbound).toEqual([expect.objectContaining({ host: "example.com", source: "kit" })]);
  });

  it("refuses to install an app twice", async () => {
    const response = await post("/api/apps/preview", { link: LINK });
    expect(response.status).toBe(409);
    expect((await response.json() as any).error).toBe("already_installed");
  });

  it("turns blocked hosts into access requests; approving opens one host, dismissing keeps it quiet", async () => {
    runtime.denied.set("ys-whoami", [
      { host: "api.openai.com", attempts: 3, lastSeen: new Date().toISOString() },
      { host: "tracker.example", attempts: 1, lastSeen: new Date().toISOString() },
      { host: "example.com", attempts: 1, lastSeen: new Date().toISOString() },
    ]);
    await server.apps!.reconcile();
    let detail = await (await api("/api/apps/whoami")).json() as any;
    expect(detail.requests.map((r: { host: string }) => r.host).sort()).toEqual(["api.openai.com", "tracker.example"]);
    const openai = detail.requests.find((r: { host: string }) => r.host === "api.openai.com");
    const tracker = detail.requests.find((r: { host: string }) => r.host === "tracker.example");
    expect(openai.attempts).toBe(3);

    expect((await post(`/api/apps/whoami/requests/${tracker.id}/dismiss`, {})).status).toBe(204);
    const approved = await post(`/api/apps/whoami/requests/${openai.id}/approve`, {});
    expect(approved.status).toBe(202);
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.egress!.sort()).toEqual(["api.openai.com", "example.com"]);

    await server.apps!.reconcile();
    detail = await (await api("/api/apps/whoami")).json() as any;
    expect(detail.requests).toEqual([expect.objectContaining({ host: "tracker.example", state: "dismissed" })]);
    expect((await api("/api/apps")).ok).toBe(true);
    const events = (await t.db.select().from(event)).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["app.outbound_approved", "app.request_dismissed"]));
  });

  it("restarts the app with changed settings, and refuses derived or unknown ones", async () => {
    const changed = await post("/api/apps/whoami/settings", { values: { GREETING: "hi there" } }, "PUT");
    expect(changed.status).toBe(202);
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.env.GREETING).toBe("hi there");
    expect((await post("/api/apps/whoami/settings", { values: { NOPE: "x" } }, "PUT")).status).toBe(400);
  });

  it("changes limits within bounds", async () => {
    expect((await post("/api/apps/whoami/limits", { limits: { web: { memory: 1024 } } }, "PUT")).status).toBe(400);
    expect((await post("/api/apps/whoami/limits", { limits: { web: { memory: 128 * 1024 ** 2, cpus: 2 } } }, "PUT")).status).toBe(202);
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.limits).toEqual({ web: { memory: 128 * 1024 ** 2, cpus: 2 } });
  });

  it("starts apps that should run and don't, and ends interrupted jobs as failed", async () => {
    runtime.running.delete("ys-whoami");
    const before = runtime.calls.filter((c) => c.method === "apply").length;
    await server.apps!.reconcile();
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").length).toBe(before + 1);

    // While Your Space is being stopped, stopped apps are left stopped.
    runtime.running.delete("ys-whoami");
    runtime.stopping = true;
    const during = runtime.calls.length;
    await server.apps!.reconcile();
    expect(runtime.calls.length).toBe(during);
    runtime.stopping = false;
    await server.apps!.reconcile();
    await settled();

    const [row] = await t.db.select().from(app).where(eq(app.name, "whoami"));
    await t.db.insert(installJob).values({ appId: row!.id, kind: "apply" });
    await server.apps!.recoverJobs();
    const jobs = await t.db.select().from(installJob).where(eq(installJob.state, "running"));
    expect(jobs).toEqual([]);
  });

  it("shows the engine and each app's use", async () => {
    const engine = await (await api("/api/engine")).json() as any;
    expect(engine).toMatchObject({ reachable: true, cpus: 4, apps: [expect.objectContaining({ name: "whoami", memory: 20 * 1024 ** 2 })] });
  });

  it("guesses the interface of an app without a kit, and generates its secret", async () => {
    const review = await (await post("/api/apps/preview", { link: "https://github.com/ys-fixtures/plain/blob/main/compose.yaml" })).json() as any;
    expect(review).toMatchObject({ name: "plain", kit: null, interface: { service: "web", port: 80 }, outbound: [] });
    expect(review.settings.find((s: { name: string }) => s.name === "API_TOKEN")).toMatchObject({ generated: true, secret: true });
  });

  describe("gate", () => {
    let gateUrl: string;
    let close: () => void;
    beforeAll(async () => {
      const gate = createGate({ db: t.db, publicUrl: server.publicUrl, authSecret: TEST_SECRET, handoffs: server.handoffs! });
      await new Promise<void>((resolve) => {
        const listener = gate.listen(0, "127.0.0.1", () => {
          gateUrl = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
          close = () => listener.close();
          resolve();
        });
      });
    });
    afterAll(() => close?.());

    const appHost = () => `whoami.${new URL(server.publicUrl).host}`;
    const gate = (path: string, headers: Record<string, string> = {}) =>
      send(`${gateUrl}${path}`, "GET", new Headers({ "x-forwarded-host": appHost(), "x-forwarded-uri": "/inbox?x=1", ...headers }), undefined);

    it("sends a visitor without a pass to Your Space, then lets the owner in with one", async () => {
      const first = await gate("/gate");
      expect(first.status).toBe(302);
      expect(first.headers.get("location")).toBe(`${server.publicUrl}/api/apps/whoami/open?return=%2Finbox%3Fx%3D1`);

      const signedOut = await server.request("/api/apps/whoami/open?return=/inbox");
      expect(signedOut.status).toBe(302);
      expect(signedOut.headers.get("location")).toBe(`${server.publicUrl}/`);

      const open = await api("/api/apps/whoami/open?return=/inbox");
      expect(open.status).toBe(302);
      const handoff = new URL(open.headers.get("location")!);
      expect(handoff.host).toBe(appHost());
      expect(handoff.pathname).toBe("/__ys/handoff");

      expect(open.headers.get("referrer-policy")).toBe("no-referrer");
      const handed = await gate(`/handoff${handoff.search}`);
      expect(handed.status).toBe(302);
      expect(handed.headers.get("referrer-policy")).toBe("no-referrer");
      expect(handed.headers.get("location")).toBe("/inbox");
      const setCookie = handed.headers.get("set-cookie")!;
      expect(setCookie).toMatch(/^ys-pass=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
      expect(setCookie).not.toMatch(/domain/i);
      // A code works once.
      expect((await gate(`/handoff${handoff.search}`)).status).toBe(403);

      const pass = setCookie.split(";")[0]!;
      const through = await gate("/gate", { cookie: `app=1; ${pass}` });
      expect(through.status).toBe(200);
      expect(through.headers.get("x-ys-upstream")).toBe("ys-whoami-ui:80");

      // The pass names its app: another app's host doesn't accept it.
      expect((await gate("/gate", { cookie: pass, "x-forwarded-host": `other.${new URL(server.publicUrl).host}` })).status).toBe(404);

      // Signing out of Your Space closes the app.
      await t.db.delete(session);
      expect((await gate("/gate", { cookie: pass })).status).toBe(302);
    });

    it("allows certificates only for Your Space and its installed apps", async () => {
      const host = new URL(server.publicUrl).hostname;
      expect((await send(`${gateUrl}/tls-ask?domain=whoami.${host}`, "GET", new Headers(), undefined)).status).toBe(200);
      expect((await send(`${gateUrl}/tls-ask?domain=${host}`, "GET", new Headers(), undefined)).status).toBe(200);
      expect((await send(`${gateUrl}/tls-ask?domain=nope.${host}`, "GET", new Headers(), undefined)).status).toBe(404);
      expect((await send(`${gateUrl}/tls-ask?domain=evil.example`, "GET", new Headers(), undefined)).status).toBe(404);
    });
  });

});

describe("handoff codes", () => {
  it("notice a pane that keeps starting over, as when the browser blocks its cookies", () => {
    const handoffs = new Handoffs();
    expect([1, 2, 3].map(() => handoffs.looping("sure", "s1"))).toEqual([false, false, false]);
    expect(handoffs.looping("sure", "s1")).toBe(true);
    expect(handoffs.looping("twenty", "s1")).toBe(false);
  });

  it("expire, work once, and only for their app", () => {
    const handoffs = new Handoffs();
    const code = handoffs.issue("sure", "s1");
    expect(handoffs.consume(code, "twenty")).toBeUndefined();
    const again = handoffs.issue("sure", "s1");
    expect(handoffs.consume(again, "sure")).toBe("s1");
    expect(handoffs.consume(again, "sure")).toBeUndefined();
  });
});
