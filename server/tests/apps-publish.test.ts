// Publishing an app on a port of this machine (decision 2026-11-19): the owner's own proxy or tunnel
// reaches it there, at the link the owner gives, and the app's address settings follow the link. Your
// Space shows it in its pane unless the owner turns that off (decision 2026-11-20).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AppError, appOrigin, defaultPort, linkOrigin, publishFrom, publishOf, stateFromServices } from "../src/apps/service.ts";
import { app, event, installJob } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { fakeGithub, FakeRuntime } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    environment:
      GREETING: \${GREETING:-hello}
      API_TOKEN: \${API_TOKEN:-published-default-token}
`;
// A kit whose settings follow the app's address, as Plane's WEB_URL and CORS origins do.
const KIT = `kit: 1
source: { repo: ys-fixtures/linked, path: compose.yaml }
name: linked
title: Linked
interface: { service: web, port: 80 }
derive:
  APP_URL: app_origin
  APP_DOMAIN: app_host
  CORS_ORIGINS: { template: "\${APP_URL},https://extra.example" }
`;
// A kit for an app that can't run in a pane.
const NOPANE_KIT = `kit: 1
source: { repo: ys-fixtures/nopane, path: compose.yaml }
name: nopane
title: No pane
interface: { service: web, port: 80 }
pane: false
`;
const LINKED = "https://github.com/ys-fixtures/linked/blob/main/compose.yaml";
const OTHER = "https://github.com/ys-fixtures/other/blob/main/compose.yaml";
const PLAIN = "https://github.com/ys-fixtures/plain/blob/main/compose.yaml";
const THIRD = "https://github.com/ys-fixtures/third/blob/main/compose.yaml";

describe("publishing choices", () => {
  const current = { port: 8000, bind: "127.0.0.1", link: null, frame: true };

  it("keeps what the owner doesn't change, and checks what they do", () => {
    expect(publishFrom({}, current)).toEqual(current);
    expect(publishFrom({ port: 8443, bind: " ::1 ", link: "https://Plane.Example.com/", frame: false }, current)).toEqual({ port: 8443, bind: "::1", link: "https://plane.example.com", frame: false });
    expect(publishFrom({ link: "" }, { ...current, link: "https://a.example" }).link).toBeNull();
    expect(publishFrom({ link: null }, { ...current, link: "https://a.example" }).link).toBeNull();
    expect(publishFrom({ port: 8001 }, { ...current, frame: false }).frame).toBe(false);
    for (const bad of [null, [], { port: 0 }, { port: 70000 }, { port: "80" }, { port: 1.5 }, { bind: "localhost" }, { bind: 1 }, { link: 3 }, { frame: "no" }, { frame: null }, { frame: 0 }]) {
      expect(() => publishFrom(bad, current), JSON.stringify(bad)).toThrow(AppError);
    }
  });

  it("takes only a link to an address, never one with a path or credentials", () => {
    expect(linkOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    for (const bad of ["plane.example.com", "ftp://plane.example.com", "https://plane.example.com/app", "https://plane.example.com/?a=1", "https://u:p@plane.example.com", "javascript:alert(1)"]) {
      expect(() => linkOrigin(bad), bad).toThrow(AppError);
    }
  });

  it("shows whether Your Space frames the app only while it is published", () => {
    expect(publishOf({ publish: { port: 8000, bind: "127.0.0.1", link: null }, frame: false })).toEqual({ port: 8000, bind: "127.0.0.1", link: null, frame: false });
    expect(publishOf({ publish: null, frame: false })).toBeNull();
  });

  it("reaches an app published with a link at the link, and any other app at its built-in address", () => {
    const publicUrl = "https://space.example.com";
    expect(appOrigin(publicUrl, { name: "plane", publish: null })).toBe("https://plane.space.example.com");
    expect(appOrigin("http://space.localhost:8080", { name: "plane", publish: null })).toBe("http://plane.space.localhost:8080");
    expect(appOrigin(publicUrl, { name: "plane", publish: { port: 8000, bind: "127.0.0.1", link: null } })).toBe("https://plane.space.example.com");
    expect(appOrigin(publicUrl, { name: "plane", publish: { port: 8000, bind: "127.0.0.1", link: "https://plane.tail1234.ts.net" } })).toBe("https://plane.tail1234.ts.net");
  });

  it("defaults to the port the app's file publishes for its interface, else the interface's own", () => {
    const services = [{ name: "proxy", image: "x", interface: true, ports: [80, 443], published: [{ target: 443, host: 8443 }, { target: 80, host: 8080 }], volumes: [], dependsOn: [] }];
    expect(defaultPort(services, { service: "proxy", port: 80 })).toBe(8080);
    expect(defaultPort(services, { service: "proxy", port: 3000 })).toBe(3000);
    expect(defaultPort(services, null)).toBeNull();
  });

  it("shows an app whose published port isn't open as needing attention", () => {
    const app = { name: "web", role: "app" as const, state: "running" };
    expect(stateFromServices([app, { name: "ys-publish", role: "publish", state: "running" }]).state).toBe("running");
    expect(stateFromServices([app, { name: "ys-publish", role: "publish", state: "created" }])).toMatchObject({ state: "degraded", reason: expect.stringMatching(/published port/) });
    // A stopped app's Caddy is stopped too.
    expect(stateFromServices([{ ...app, state: "exited", exitCode: 143 }, { name: "ys-publish", role: "publish", state: "exited", exitCode: 137 }]).state).toBe("stopped");
  });
});

describe("publishing an app", () => {
  let t: TestDatabase;
  let server: TestServer;
  let cookie: string;
  const runtime = new FakeRuntime();

  beforeAll(async () => {
    t = await createTestDatabase();
    const fetch = fakeGithub({
      "ys-fixtures/linked/compose.yaml": COMPOSE,
      "your-space-ai/your-space-app-kits/apps/ys-fixtures/linked.yaml": KIT,
      "ys-fixtures/other/compose.yaml": COMPOSE,
      "ys-fixtures/plain/compose.yaml": COMPOSE,
      "ys-fixtures/third/compose.yaml": COMPOSE,
      "ys-fixtures/fourth/compose.yaml": COMPOSE,
      "ys-fixtures/nopane/compose.yaml": COMPOSE,
      "your-space-ai/your-space-app-kits/apps/ys-fixtures/nopane.yaml": NOPANE_KIT,
    });
    server = await startServer(t.db, { apps: { runtime, fetch } });
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
    cookie = cookieHeader(signedIn);
  });
  afterAll(async () => {
    await server?.close();
    await t?.destroy();
  });

  const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
  const send = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });
  const lastApply = () => runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!;
  const builtIn = () => `http://linked.${new URL(server.publicUrl).host}`;

  async function waitForJob(jobId: string): Promise<{ state: string; error: string | null }> {
    for (let i = 0; i < 200; i++) {
      const job = (await (await api(`/api/jobs/${jobId}`)).json()) as { state: string; error: string | null };
      if (job.state !== "running") return job;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("The job didn't finish.");
  }

  /** Waits until no job is running. */
  async function waitForIdle(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const jobs = await t.db.select().from(installJob).where(eq(installJob.state, "running"));
      if (jobs.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("A job didn't finish.");
  }

  async function install(link: string, publish?: unknown): Promise<Response> {
    const review = (await (await send("/api/apps/preview", { link })).json()) as { previewId: string; publishPort: number };
    return send("/api/apps", { previewId: review.previewId, ...(publish === undefined ? {} : { publish }) });
  }

  it("offers the port the app's file publishes, and installs it published with the owner's link", async () => {
    const review = (await (await send("/api/apps/preview", { link: LINKED })).json()) as { publishPort: number };
    expect(review.publishPort).toBe(8000);

    const installed = await install(LINKED, { link: "https://linked.tail1234.ts.net" });
    expect(installed.status).toBe(202);
    expect((await waitForJob(((await installed.json()) as { jobId: string }).jobId)).state).toBe("succeeded");

    const spec = lastApply();
    // Shown inside Your Space unless the owner says otherwise.
    expect(spec.publish).toEqual({ port: 8000, bind: "127.0.0.1", frame: true });
    expect(spec.env).toMatchObject({ APP_URL: "https://linked.tail1234.ts.net", APP_DOMAIN: "linked.tail1234.ts.net", CORS_ORIGINS: "https://linked.tail1234.ts.net,https://extra.example" });
    // Your Space's Caddy, which publishes it, runs Your Space's own image: nothing more to pin.
    expect(Object.keys(spec.pins!).sort()).toEqual(["traefik/whoami:latest", "ubuntu/squid:latest"]);
    // The port was checked before the choice was saved.
    expect(runtime.calls.filter((c) => c.method === "checkPort").at(-1)).toEqual({ method: "checkPort", project: "ys-linked", publish: { port: 8000, bind: "127.0.0.1" } });

    const detail = (await (await api("/api/apps/linked")).json()) as any;
    expect(detail.publish).toEqual({ port: 8000, bind: "127.0.0.1", link: "https://linked.tail1234.ts.net", frame: true });
    // Your Space sends the owner to the link, not to the built-in address it may not reach.
    expect(detail.origin).toBe("https://linked.tail1234.ts.net");
    expect(detail.settings.find((s: { name: string }) => s.name === "APP_URL").value).toBe("https://linked.tail1234.ts.net");
    const list = (await (await api("/api/apps")).json()) as any;
    expect(list.apps[0].publish).toEqual(detail.publish);
    expect(list.apps[0].origin).toBe("https://linked.tail1234.ts.net");
  });

  it("refuses a port another published app uses, naming it, and never suggests one", async () => {
    const refused = await install(OTHER, {});
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; message: string };
    expect(body.error).toBe("port_in_use");
    expect(body.message).toBe("Port 8000 on 127.0.0.1 is already used by Linked, which Your Space publishes on 127.0.0.1:8000. Choose another port.");
    // Every address overlaps a single one.
    expect((await install(OTHER, { port: 8000, bind: "0.0.0.0" })).status).toBe(409);
    // Another port works.
    const other = await install(OTHER, { port: 8001 });
    expect(other.status).toBe(202);
    await waitForJob(((await other.json()) as { jobId: string }).jobId);
    // Without a link, the pane frames the app at its built-in address, so its Caddy keeps the app's own rules.
    expect(lastApply().publish).toEqual({ port: 8001, bind: "127.0.0.1", frame: false });
    expect(((await (await api("/api/apps/other")).json()) as any).publish.frame).toBe(true);
    // Published without a link, the app stays at its built-in address.
    expect(((await (await api("/api/apps/other")).json()) as { origin: string }).origin).toBe(`http://other.${new URL(server.publicUrl).host}`);
    // A port on another single address doesn't collide.
    const moved = await send("/api/apps/other/publish", { publish: { port: 8000, bind: "127.0.0.2" } }, "PUT");
    expect(moved.status).toBe(202);
    await waitForJob(((await moved.json()) as { jobId: string }).jobId);
  });

  it("refuses, before saving, a port something else on this machine uses, naming the container when it is one", async () => {
    runtime.portsInUse.set(8100, "the container web-1").set(8101, undefined);
    const review = (await (await send("/api/apps/preview", { link: THIRD })).json()) as { previewId: string };
    const byContainer = await send("/api/apps", { previewId: review.previewId, publish: { port: 8100 } });
    expect(byContainer.status).toBe(409);
    expect(await byContainer.json()).toMatchObject({ error: "port_in_use", message: "Port 8100 on 127.0.0.1 is already used by the container web-1. Choose another port." });
    const byProgram = await send("/api/apps", { previewId: review.previewId, publish: { port: 8101 } });
    expect(byProgram.status).toBe(409);
    expect(((await byProgram.json()) as { message: string }).message).toBe("Port 8101 on 127.0.0.1 is already used by another program on this machine. Choose another port.");
    expect(runtime.calls.filter((c) => c.method === "checkPort").at(-1)).toMatchObject({ project: "ys-third", publish: { port: 8101, bind: "127.0.0.1" } });
    expect(await t.db.select().from(app).where(eq(app.name, "third"))).toEqual([]);

    // The review is kept, so the owner chooses another port and installs.
    const installed = await send("/api/apps", { previewId: review.previewId, publish: { port: 8102 } });
    expect(installed.status).toBe(202);
    expect((await waitForJob(((await installed.json()) as { jobId: string }).jobId)).state).toBe("succeeded");

    // Moving an installed app to a taken port is refused the same way, and it keeps its port.
    const moved = await send("/api/apps/third/publish", { publish: { port: 8100 } }, "PUT");
    expect(moved.status).toBe(409);
    expect(((await moved.json()) as { message: string }).message).toMatch(/^Port 8100 on 127\.0\.0\.1 is already used by the container web-1\./);
    const [row] = await t.db.select({ publish: app.publish }).from(app).where(eq(app.name, "third"));
    expect(row!.publish).toMatchObject({ port: 8102 });
    runtime.portsInUse.clear();
  });

  it("saves when the port can't be checked, and leaves a taken port to the start", async () => {
    runtime.failPortCheck = "The engine answered with an error.";
    try {
      const moved = await send("/api/apps/third/publish", { publish: { port: 8103 } }, "PUT");
      expect(moved.status).toBe(202);
      expect((await waitForJob(((await moved.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
      expect(lastApply().publish).toEqual({ port: 8103, bind: "127.0.0.1", frame: false });
    } finally {
      runtime.failPortCheck = undefined;
    }
  });

  it("restarts the app at a new link, and its address settings follow", async () => {
    const changed = await send("/api/apps/linked/publish", { publish: { link: "https://tasks.example.com" } }, "PUT");
    expect(changed.status).toBe(202);
    expect((await waitForJob(((await changed.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply()).toMatchObject({ publish: { port: 8000, bind: "127.0.0.1", frame: true }, env: { APP_URL: "https://tasks.example.com", APP_DOMAIN: "tasks.example.com" } });
    expect(((await (await api("/api/apps/linked")).json()) as { origin: string }).origin).toBe("https://tasks.example.com");
    const events = (await t.db.select().from(event)).map((e) => e.type);
    expect(events).toContain("app.publish_changed");
  });

  it("refuses bad choices and leaves the app as it was", async () => {
    for (const publish of [{ port: 0 }, { bind: "localhost" }, { link: "https://tasks.example.com/app" }, { frame: "off" }, "yes"]) {
      const response = await send("/api/apps/linked/publish", { publish }, "PUT");
      expect(response.status, JSON.stringify(publish)).toBe(400);
    }
    expect((await send("/api/apps/linked/publish", {}, "PUT")).status).toBe(400);
    const [row] = await t.db.select({ publish: app.publish, frame: app.frame }).from(app).where(eq(app.name, "linked"));
    expect(row).toEqual({ publish: { port: 8000, bind: "127.0.0.1", link: "https://tasks.example.com" }, frame: true });
  });

  it("stops showing the app inside Your Space, and shows it again, with only that changed", async () => {
    const off = await send("/api/apps/linked/publish", { publish: { frame: false } }, "PUT");
    expect(off.status).toBe(202);
    expect((await waitForJob(((await off.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    // The app restarts with the same spec but its Caddy's framing, which Compose recreates alone.
    expect(lastApply().publish).toEqual({ port: 8000, bind: "127.0.0.1", frame: false });
    expect(lastApply().env).toMatchObject({ APP_URL: "https://tasks.example.com" });
    const detail = (await (await api("/api/apps/linked")).json()) as any;
    expect(detail.publish).toEqual({ port: 8000, bind: "127.0.0.1", link: "https://tasks.example.com", frame: false });
    expect(detail.origin).toBe("https://tasks.example.com");
    const list = (await (await api("/api/apps")).json()) as any;
    expect(list.apps.find((a: { name: string }) => a.name === "linked").publish.frame).toBe(false);
    expect((await t.db.select().from(event)).filter((e) => e.type === "app.publish_changed").length).toBeGreaterThan(1);

    // Changing something else keeps it off.
    const moved = await send("/api/apps/linked/publish", { publish: { link: "https://tasks.example.com" } }, "PUT");
    await waitForJob(((await moved.json()) as { jobId: string }).jobId);
    expect(lastApply().publish).toEqual({ port: 8000, bind: "127.0.0.1", frame: false });

    const on = await send("/api/apps/linked/publish", { publish: { frame: true } }, "PUT");
    await waitForJob(((await on.json()) as { jobId: string }).jobId);
    expect(lastApply().publish).toEqual({ port: 8000, bind: "127.0.0.1", frame: true });
  });

  it("installs an app published with the owner's choice not to show it inside Your Space", async () => {
    const installed = await install("https://github.com/ys-fixtures/fourth/blob/main/compose.yaml", { port: 8104, link: "https://fourth.example.com", frame: false });
    expect(installed.status).toBe(202);
    expect((await waitForJob(((await installed.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply().publish).toEqual({ port: 8104, bind: "127.0.0.1", frame: false });
    expect(((await (await api("/api/apps/fourth")).json()) as any).publish).toEqual({ port: 8104, bind: "127.0.0.1", link: "https://fourth.example.com", frame: false });
    // Installed without publishing, an app is shown inside Your Space once it is published.
    const [plain] = await t.db.select({ frame: app.frame }).from(app).where(eq(app.name, "third"));
    expect(plain!.frame).toBe(true);
  });

  it("keeps the framing rules of an app whose kit says it can't run in a pane", async () => {
    const installed = await install("https://github.com/ys-fixtures/nopane/blob/main/compose.yaml", { port: 8106, link: "https://nopane.example.com" });
    expect((await waitForJob(((await installed.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    expect(lastApply().publish).toEqual({ port: 8106, bind: "127.0.0.1", frame: false });
  });

  it("stops publishing, and the app is back at its built-in address", async () => {
    const stopped = await send("/api/apps/linked/publish", { publish: null }, "PUT");
    expect(stopped.status).toBe(202);
    await waitForJob(((await stopped.json()) as { jobId: string }).jobId);
    expect(lastApply().publish).toBeNull();
    expect(lastApply().env.APP_URL).toBe(builtIn());
    const detail = (await (await api("/api/apps/linked")).json()) as any;
    expect(detail.publish).toBeNull();
    expect(detail.origin).toBe(builtIn());
    expect(detail.settings.find((s: { name: string }) => s.name === "APP_URL").value).toBe(builtIn());
  });

  it("starts from the defaults when an app is published again, showing it inside Your Space", async () => {
    const put = async (publish: unknown) => {
      const response = await send("/api/apps/linked/publish", { publish }, "PUT");
      expect(response.status).toBe(202);
      expect((await waitForJob(((await response.json()) as { jobId: string }).jobId)).state).toBe("succeeded");
    };
    await put({ port: 8105, link: "https://tasks.example.com", frame: false });
    expect(lastApply().publish).toEqual({ port: 8105, bind: "127.0.0.1", frame: false });
    await put(null);
    await put({ port: 8105, link: "https://tasks.example.com" });
    expect(lastApply().publish).toEqual({ port: 8105, bind: "127.0.0.1", frame: true });
    await put(null);
  });

  it("publishes an installed app on the port its file publishes", async () => {
    const installed = await install(PLAIN);
    await waitForJob(((await installed.json()) as { jobId: string }).jobId);
    expect(lastApply().publish).toBeNull();
    // 8000 is free again now that Linked isn't published.
    const published = await send("/api/apps/plain/publish", { publish: {} }, "PUT");
    expect(published.status).toBe(202);
    await waitForJob(((await published.json()) as { jobId: string }).jobId);
    expect(lastApply().publish).toEqual({ port: 8000, bind: "127.0.0.1", frame: false });
  });

  it("renews a published app's outdated Caddy once, as after Your Space is updated, and only that app", async () => {
    const applies = () => runtime.calls.filter((c) => c.method === "apply").length;
    const services = runtime.running.get("ys-plain")!;
    runtime.running.set(
      "ys-plain",
      services.map((s) => (s.role === "publish" ? { ...s, outdated: true } : s)),
    );
    const before = applies();
    await server.apps!.reconcile();
    await waitForIdle();
    expect(applies()).toBe(before + 1);
    expect(lastApply()).toMatchObject({ project: "ys-plain", publish: { port: 8000, bind: "127.0.0.1", frame: false } });
    expect(((await (await api("/api/apps/plain")).json()) as { state: string }).state).toBe("running");

    // A renewal that didn't help isn't repeated while this server runs.
    runtime.running.set("ys-plain", runtime.running.get("ys-plain")!.map((s) => (s.role === "publish" ? { ...s, outdated: true } : s)));
    await server.apps!.reconcile();
    await waitForIdle();
    expect(applies()).toBe(before + 1);
  });
});
