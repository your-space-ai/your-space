// An app whose file loads its settings with `env_file: .env` (decision 2026-11-23): its kit's env is
// the app's whole environment, which the review shows like any other, and Your Space hands it to the
// runtime manager, which gives it to that service. The runtime manager's part is tested in runtime/tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { operatorActorId } from "../src/actors.ts";
import { AppsService } from "../src/apps/service.ts";
import { app, appSetting, installJob } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { COMMIT, fakeGithub, FakeRuntime, kitLink } from "./helpers/runtime.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    env_file: .env
`;
const KIT = `kit: 1
source: { repo: ys-fixtures/notes, path: compose.yaml, commit: ${COMMIT} }
name: notes
interface: { service: web, port: 80 }
env:
  SESSION_SECRET: { generate: { bytes: 16 } }
  BASE_URL: { derive: app_origin }
  OWNER_LINE: { derive: { template: "\${OWNER_NAME} at \${BASE_URL}" } }
  MODE: production
  OWNER_NAME: { ask: true, secret: false }
  LICENSE_KEY: { ask: true }
  MAIL_PASSWORD: { ask: optional }
`;

/** Waits until no install job is running: jobs run in the background. */
async function settled(t: TestDatabase): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
    if (running.length === 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("A job didn't finish.");
}

describe("an app whose file loads .env", () => {
  let t: TestDatabase;
  let apps: AppsService;
  let actor: string;
  const runtime = new FakeRuntime();
  // `docker compose config --variables`: the file interpolates nothing.
  runtime.variables = [];

  beforeAll(async () => {
    t = await createTestDatabase();
    apps = new AppsService(t.db, runtime, {
      publicUrl: "http://space.localhost",
      dataKey: TEST_DATA_KEY,
      github: { api: "https://api.github.test", raw: "https://raw.github.test" },
      fetch: fakeGithub({ "ys-fixtures/notes/compose.yaml": COMPOSE, "ys-fixtures/catalog/apps/ys-fixtures/notes.yaml": KIT }),
    });
    actor = await operatorActorId(t.db);
  });
  afterAll(async () => {
    await t?.destroy();
  });

  it("is reviewed with the kit's env, and isn't installed until the values it asks for are given", async () => {
    const review = await apps.preview({ link: kitLink("notes") });
    expect(review.ok).toBe(true);
    const byName = Object.fromEntries(review.settings.map((s) => [s.name, s]));
    expect(Object.keys(byName)).toEqual(["BASE_URL", "LICENSE_KEY", "MAIL_PASSWORD", "MODE", "OWNER_LINE", "OWNER_NAME", "SESSION_SECRET"]);
    expect(byName.OWNER_NAME).toMatchObject({ required: true, secret: false, set: false });
    expect(byName.LICENSE_KEY).toMatchObject({ required: true, secret: true, set: false, value: undefined });
    expect(byName.MAIL_PASSWORD).toMatchObject({ required: false, secret: true, set: false });
    expect(byName.SESSION_SECRET).toMatchObject({ required: false, secret: true, generated: true, set: true, value: undefined });
    expect(byName.MODE).toMatchObject({ value: "production" });
    expect(byName.BASE_URL).toMatchObject({ derived: true, value: "http://notes.space.localhost" });
    // A template that uses a secret is shown only as set; this one uses none.
    expect(byName.OWNER_LINE).toMatchObject({ derived: true, secret: false });
    await expect(apps.install(review.previewId, { OWNER_NAME: "Sam" }, false, actor)).rejects.toMatchObject({
      status: 400,
      code: "settings_required",
      message: "These settings need a value: LICENSE_KEY.",
    });
    expect(runtime.calls.some((c) => c.method === "apply")).toBe(false);
  });

  it("runs with exactly the kit's env, kept encrypted, and keeps the values it asks for set", async () => {
    const review = await apps.preview({ link: kitLink("notes") });
    const { name, done } = await apps.install(review.previewId, { OWNER_NAME: "Sam", LICENSE_KEY: "license-7f3a" }, false, actor);
    await done;
    const apply = runtime.calls.filter((c) => c.method === "apply").at(-1)!;
    expect(apply.spec!.env).toEqual({
      OWNER_NAME: "Sam",
      LICENSE_KEY: "license-7f3a",
      MODE: "production",
      BASE_URL: "http://notes.space.localhost",
      OWNER_LINE: "Sam at http://notes.space.localhost",
      SESSION_SECRET: expect.stringMatching(/^[\w-]{22}$/),
    });

    const [row] = await t.db.select().from(app).where(eq(app.name, name));
    const stored = await t.db.select().from(appSetting).where(eq(appSetting.appId, row!.id));
    expect(JSON.stringify(stored)).not.toContain("license-7f3a");
    expect((await apps.detail(name)).settings.find((s) => s.name === "OWNER_NAME")).toMatchObject({ required: true, value: "Sam" });

    await expect(apps.updateSettings(name, { OWNER_NAME: "" }, actor)).rejects.toMatchObject({ status: 400, code: "setting_required" });
    await expect(apps.updateSettings(name, { LICENSE_KEY: null }, actor)).rejects.toMatchObject({ status: 400, code: "secret_required" });
    await expect(apps.updateSettings(name, { BASE_URL: "http://elsewhere" }, actor)).rejects.toMatchObject({ status: 400, code: "unknown_setting" });
  });

  it("keeps working for an app installed before env, from its kit's earlier fields", async () => {
    const [row] = await t.db.select().from(app).where(eq(app.name, "notes"));
    // The same kit as stored before env: its values in generate, derive and set, and secrets the owner could give.
    const { env, ...rest } = row!.kit!;
    await t.db
      .update(app)
      .set({
        kit: {
          ...rest,
          generate: { SESSION_SECRET: { bytes: 16, encoding: "base64url" } },
          derive: { BASE_URL: "app_origin", OWNER_LINE: { template: "${OWNER_NAME} at ${BASE_URL}" } },
          set: { MODE: "production" },
          secrets: ["LICENSE_KEY", "MAIL_PASSWORD"],
        },
      })
      .where(eq(app.id, row!.id));
    const detail = await apps.detail("notes");
    expect(detail.settings.find((s) => s.name === "BASE_URL")).toMatchObject({ derived: true });
    await expect(apps.updateSettings("notes", { BASE_URL: "http://elsewhere" }, actor)).rejects.toMatchObject({ code: "unknown_setting" });
    await apps.updateSettings("notes", { OWNER_NAME: "Alex" }, actor);
    await settled(t);
    const spec = await apps.specFor((await t.db.select().from(app).where(eq(app.name, "notes")))[0]!);
    expect(spec.env).toMatchObject({ OWNER_NAME: "Alex", OWNER_LINE: "Alex at http://notes.space.localhost" });
  });
});
