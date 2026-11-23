// A Compose file that requires settings, with `${NAME:?message}` or `${NAME?message}`: the review
// shows it with those settings for the owner to fill in, and installing needs a value for each.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operatorActorId } from "../src/actors.ts";
import { AppsService } from "../src/apps/service.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { fakeGithub, FakeRuntime } from "./helpers/runtime.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    environment:
      SECRET_KEY_BASE: \${SECRET_KEY_BASE:?Set SECRET_KEY_BASE}
      ADMIN_EMAIL: \${ADMIN_EMAIL?Set ADMIN_EMAIL}
      GREETING: \${GREETING:-hello}
`;
// The app's kit says nothing about these settings, so the file's own rules apply.
const KIT_LINK = "https://github.com/ys-fixtures/kits/blob/main/needs.yaml";
const KIT = "kit: 1\nsource: { repo: ys-fixtures/needs, path: compose.yaml }\n";

describe("an app whose file requires settings", () => {
  let t: TestDatabase;
  let apps: AppsService;
  let actor: string;
  const runtime = new FakeRuntime();
  // As `docker compose config --variables` reports the file: both forms are required.
  runtime.variables = [
    { name: "ADMIN_EMAIL", required: true, default: "" },
    { name: "GREETING", required: false, default: "hello" },
    { name: "SECRET_KEY_BASE", required: true, default: "" },
  ];

  beforeAll(async () => {
    t = await createTestDatabase();
    apps = new AppsService(t.db, runtime, {
      publicUrl: "http://space.localhost",
      dataKey: TEST_DATA_KEY,
      github: { api: "https://api.github.test", raw: "https://raw.github.test" },
      fetch: fakeGithub({ "ys-fixtures/needs/compose.yaml": COMPOSE, "ys-fixtures/kits/needs.yaml": KIT }),
    });
    actor = await operatorActorId(t.db);
  });
  afterAll(async () => {
    await t?.destroy();
  });

  it("is reviewed, with each required setting for the owner to fill in", async () => {
    const review = await apps.preview({ link: KIT_LINK });
    expect(review.ok).toBe(true);
    const setting = (name: string) => review.settings.find((s) => s.name === name);
    expect(setting("SECRET_KEY_BASE")).toMatchObject({ required: true, set: false, secret: true, generated: false });
    expect(setting("ADMIN_EMAIL")).toMatchObject({ required: true, set: false, secret: false, value: null });
    expect(setting("GREETING")).toMatchObject({ required: false, publishedDefault: "hello" });
    // Both checks ask for placeholders, which the server never sees or keeps.
    const checks = runtime.calls.filter((c) => c.method === "check");
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.spec!.placeholders === true)).toBe(true);
    expect(checks[1]!.spec!.env).toEqual({});
  });

  it("isn't installed until each required setting has a value", async () => {
    const review = await apps.preview({ link: KIT_LINK });
    await expect(apps.install(review.previewId, {}, false, actor)).rejects.toMatchObject({
      status: 400,
      code: "settings_required",
      message: "These settings need a value: ADMIN_EMAIL, SECRET_KEY_BASE.",
    });
    await expect(apps.install(review.previewId, { ADMIN_EMAIL: "", SECRET_KEY_BASE: "a-real-secret" }, false, actor)).rejects.toMatchObject({
      code: "settings_required",
      message: "These settings need a value: ADMIN_EMAIL.",
    });
    expect(runtime.calls.some((c) => c.method === "apply")).toBe(false);
  });

  it("is checked again with the owner's values, and isn't installed when that check refuses it", async () => {
    runtime.refuse = (spec) => (spec.env.ADMIN_EMAIL === "refused@example.com" ? [{ service: "web", setting: "image", reason: "No image has this tag." }] : []);
    const review = await apps.preview({ link: KIT_LINK });
    expect(review.ok).toBe(true);
    const checks = runtime.calls.filter((c) => c.method === "check").length;
    await expect(apps.install(review.previewId, { ADMIN_EMAIL: "refused@example.com", SECRET_KEY_BASE: "a-real-secret" }, false, actor)).rejects.toMatchObject({
      status: 400,
      code: "refused",
      message: "Your Space can't run this app with these settings: web: No image has this tag.",
    });
    const recheck = runtime.calls.filter((c) => c.method === "check").slice(checks);
    expect(recheck).toHaveLength(1);
    expect(recheck[0]!.spec).toMatchObject({ env: { ADMIN_EMAIL: "refused@example.com", SECRET_KEY_BASE: "a-real-secret" } });
    expect(recheck[0]!.spec!.placeholders).toBeUndefined();
    expect(runtime.calls.some((c) => c.method === "apply")).toBe(false);
    await expect(apps.detail("needs")).rejects.toMatchObject({ status: 404 });
    runtime.refuse = () => [];
  });

  it("runs with the owner's values, checked again without placeholders before it starts", async () => {
    const review = await apps.preview({ link: KIT_LINK });
    const { name, done } = await apps.install(review.previewId, { ADMIN_EMAIL: "owner@example.com", SECRET_KEY_BASE: "a-real-secret" }, false, actor);
    await done;
    expect((await apps.detail(name)).state).toBe("running");
    const [recheck, apply] = runtime.calls.slice(-2);
    expect(recheck).toMatchObject({ method: "check", spec: { env: { ADMIN_EMAIL: "owner@example.com", SECRET_KEY_BASE: "a-real-secret" } } });
    expect(recheck!.spec!.placeholders).toBeUndefined();
    expect(apply!.method).toBe("apply");
    expect(apply!.spec!.env).toMatchObject({ ADMIN_EMAIL: "owner@example.com", SECRET_KEY_BASE: "a-real-secret" });
    expect(apply!.spec!.placeholders).toBeUndefined();
  });
});
