// An app whose file loads its settings with `env_file: .env` (2026-11-23): its kit names settings the
// file never reads, which the review shows like any other, and Your Space hands them to the runtime
// manager, which gives them to that service. The runtime manager's part is tested in runtime/tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { operatorActorId } from "../src/actors.ts";
import { KitError, parseKit } from "../src/apps/kits.ts";
import { AppsService } from "../src/apps/service.ts";
import { buildSettings, publicSetting } from "../src/apps/settings.ts";
import { app, appSetting } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { fakeGithub, FakeRuntime } from "./helpers/runtime.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    env_file: .env
`;
const LINK = "https://github.com/ys-fixtures/notes/blob/main/compose.yaml";
const KIT = `kit: 1
source: { repo: ys-fixtures/notes, path: compose.yaml }
name: notes
interface: { service: web, port: 80 }
generate:
  SESSION_SECRET: { bytes: 16 }
derive:
  BASE_URL: app_origin
  OWNER_LINE: { template: "\${OWNER_NAME} at \${BASE_URL}" }
set:
  MODE: production
required: [OWNER_NAME, LICENSE_KEY]
secrets: [LICENSE_KEY, MAIL_PASSWORD]
`;

describe("a kit's required settings", () => {
  const kit = (extra: string) => `kit: 1\nsource: { repo: a/b, path: c }\n${extra}`;

  it("are a list of setting names the owner gives, which templates can use", () => {
    expect(parseKit(KIT).required).toEqual(["OWNER_NAME", "LICENSE_KEY"]);
    expect(() => parseKit(kit("required: OWNER_NAME"))).toThrow(/required must be a list of setting names/);
    expect(() => parseKit(kit("required: [lower-case]"))).toThrow(KitError);
  });

  it("can't be values Your Space generates or works out", () => {
    expect(() => parseKit(kit("generate: { TOKEN: {} }\nrequired: [TOKEN]"))).toThrow("TOKEN can't be required: the kit generates it.");
    expect(() => parseKit(kit("derive: { URL: app_origin }\nrequired: [URL]"))).toThrow("URL can't be required: the kit derives it.");
  });
});

describe("the settings a kit names", () => {
  const address = { origin: "http://notes.space.localhost", host: "notes.space.localhost" };

  it("are the app's settings even when its file reads none of them, required ones marked and secrets hidden", () => {
    const settings = buildSettings([], parseKit(KIT), address);
    const byName = Object.fromEntries(settings.map((s) => [s.name, publicSetting(s)]));
    expect(Object.keys(byName)).toEqual(["BASE_URL", "LICENSE_KEY", "MAIL_PASSWORD", "MODE", "OWNER_LINE", "OWNER_NAME", "SESSION_SECRET"]);
    expect(byName.OWNER_NAME).toMatchObject({ required: true, secret: false, set: false });
    expect(byName.LICENSE_KEY).toMatchObject({ required: true, secret: true, set: false, value: undefined });
    expect(byName.MAIL_PASSWORD).toMatchObject({ required: false, secret: true, set: false });
    expect(byName.SESSION_SECRET).toMatchObject({ required: false, secret: true, generated: true, set: true, value: undefined });
    expect(byName.MODE).toMatchObject({ value: "production" });
    expect(byName.BASE_URL).toMatchObject({ derived: true, value: "http://notes.space.localhost" });
  });
});

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
      fetch: fakeGithub({ "ys-fixtures/notes/compose.yaml": COMPOSE }),
    });
    actor = await operatorActorId(t.db);
  });
  afterAll(async () => {
    await t?.destroy();
  });

  it("is reviewed with the kit's settings, and isn't installed until the required ones have a value", async () => {
    const review = await apps.preview(LINK, undefined, KIT);
    expect(review.ok).toBe(true);
    expect(review.settings.filter((s) => s.required).map((s) => s.name)).toEqual(["LICENSE_KEY", "OWNER_NAME"]);
    await expect(apps.install(review.previewId, { OWNER_NAME: "Sam" }, false, actor)).rejects.toMatchObject({
      status: 400,
      code: "settings_required",
      message: "These settings need a value: LICENSE_KEY.",
    });
    expect(runtime.calls.some((c) => c.method === "apply")).toBe(false);
  });

  it("runs with every setting the kit names, kept encrypted, and keeps the required ones set", async () => {
    const review = await apps.preview(LINK, undefined, KIT);
    const { name, done } = await apps.install(review.previewId, { OWNER_NAME: "Sam", LICENSE_KEY: "license-7f3a" }, false, actor);
    await done;
    const apply = runtime.calls.filter((c) => c.method === "apply").at(-1)!;
    expect(apply.spec!.env).toMatchObject({
      OWNER_NAME: "Sam",
      LICENSE_KEY: "license-7f3a",
      MODE: "production",
      BASE_URL: "http://notes.space.localhost",
      OWNER_LINE: "Sam at http://notes.space.localhost",
      SESSION_SECRET: expect.stringMatching(/^[\w-]{22}$/),
    });
    // A setting with no value isn't handed on, so the app gets no empty one.
    expect(Object.keys(apply.spec!.env)).not.toContain("MAIL_PASSWORD");

    const [row] = await t.db.select().from(app).where(eq(app.name, name));
    const stored = await t.db.select().from(appSetting).where(eq(appSetting.appId, row!.id));
    expect(JSON.stringify(stored)).not.toContain("license-7f3a");
    expect((await apps.detail(name)).settings.find((s) => s.name === "OWNER_NAME")).toMatchObject({ required: true, value: "Sam" });

    await expect(apps.updateSettings(name, { OWNER_NAME: "" }, actor)).rejects.toMatchObject({ status: 400, code: "setting_required" });
    await expect(apps.updateSettings(name, { LICENSE_KEY: null }, actor)).rejects.toMatchObject({ status: 400, code: "secret_required" });
  });
});
