// Journey 002 on the server: installing and managing apps, with a fake runtime and a stand-in for
// GitHub. The runtime manager's own rules are tested in runtime/tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { operatorActorId } from "../src/actors.ts";
import { fetchSource, parseLink, SourceError } from "../src/apps/github.ts";
import { KitError, parseKit, parseMemory } from "../src/apps/kits.ts";
import { AppsService, stateFromServices } from "../src/apps/service.ts";
import { buildSettings, decrypt, encrypt, looksSecret } from "../src/apps/settings.ts";
import { app, appSetting, event, installJob } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_SECRET } from "./helpers/env.ts";
import { COMMIT, fakeGithub, FakeRuntime } from "./helpers/runtime.ts";

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

describe("app state", () => {
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

describe("installing an app", () => {
  let t: TestDatabase;
  let runtime: FakeRuntime;
  let apps: AppsService;
  let operator: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    runtime = new FakeRuntime();
    apps = new AppsService(t.db, runtime, {
      publicUrl: "http://localhost:4100",
      authSecret: TEST_SECRET,
      github: { api: "https://api.github.test", raw: "https://raw.github.test" },
      fetch: fakeGithub({
        "ys-fixtures/whoami/compose.yaml": WHOAMI,
        "your-space-ai/your-space-app-kits/apps/ys-fixtures/whoami.yaml": KIT,
        "ys-fixtures/plain/compose.yaml": WHOAMI,
      }),
    });
    operator = await operatorActorId(t.db);
  });
  afterAll(async () => {
    await t?.destroy();
  });

  it("reviews an app without showing generated secrets, then installs it", async () => {
    const review = await apps.preview(LINK);
    const text = JSON.stringify(review);
    expect(review).toMatchObject({ name: "whoami", title: "Who Am I", ok: true, origin: "http://whoami.localhost:4100", interface: { service: "web", port: 80 } });
    expect(review.source).toMatchObject({ repo: "ys-fixtures/whoami", commit: COMMIT });
    expect(review.kit!.source).toContain(`your-space-app-kits/blob/${COMMIT}/apps/ys-fixtures/whoami.yaml`);
    expect(review.settings.find((s) => s.name === "API_TOKEN")).toMatchObject({ secret: true, generated: true, set: true });
    expect(text).not.toContain("published-default-token");
    expect(review.warning).toMatch(/trusts it/);

    const { jobId, done } = await apps.install(review.previewId, {}, operator);
    await done;
    expect((await apps.job(jobId)).state).toBe("succeeded");

    const applied = runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!;
    expect(applied).toMatchObject({ project: "ys-whoami", interface: { service: "web", port: 80 }, limits: { web: { memory: 64 * 1024 ** 2, cpus: 0.5 } } });
    expect(applied.pins).toEqual({ "traefik/whoami:latest": "sha256:aaa" });
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
    expect((await apps.list()).apps).toEqual([expect.objectContaining({ name: "whoami", state: "running" })]);
    const detail = await apps.detail("whoami");
    expect(detail).toMatchObject({ name: "whoami", state: "running", source: { repo: "ys-fixtures/whoami", commit: COMMIT } });
    expect(JSON.stringify(detail)).not.toContain(runtime.calls.find((c) => c.method === "apply")!.spec!.env.API_TOKEN!);
  });

  it("refuses to install an app twice", async () => {
    await expect(apps.preview(LINK)).rejects.toMatchObject({ status: 409, code: "already_installed" });
  });

  it("starts apps that should run and don't, and ends interrupted jobs as failed", async () => {
    runtime.running.delete("ys-whoami");
    const before = runtime.calls.filter((c) => c.method === "apply").length;
    await apps.reconcile();
    await new Promise((r) => setTimeout(r, 100));
    expect(runtime.calls.filter((c) => c.method === "apply").length).toBe(before + 1);

    // While Your Space is being stopped, stopped apps are left stopped.
    runtime.running.delete("ys-whoami");
    runtime.stopping = true;
    const during = runtime.calls.length;
    await apps.reconcile();
    expect(runtime.calls.length).toBe(during);
    runtime.stopping = false;
    await apps.reconcile();
    await new Promise((r) => setTimeout(r, 100));

    const [row] = await t.db.select().from(app).where(eq(app.name, "whoami"));
    await t.db.insert(installJob).values({ appId: row!.id, kind: "apply" });
    await apps.recoverJobs();
    const jobs = await t.db.select().from(installJob).where(eq(installJob.state, "running"));
    expect(jobs).toEqual([]);
  });

  it("guesses the interface of an app without a kit, and generates its secret", async () => {
    const review = await apps.preview("https://github.com/ys-fixtures/plain/blob/main/compose.yaml");
    expect(review).toMatchObject({ name: "plain", kit: null, interface: { service: "web", port: 80 } });
    expect(review.settings.find((s) => s.name === "API_TOKEN")).toMatchObject({ generated: true, secret: true });
  });
});
