import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app, appReplacement, appSetting } from "../src/db/schema.ts";
import { AppsService } from "../src/apps/service.ts";
import { applyReplacement, previewReplacement, type ReplacementSnapshot } from "../src/apps/replacement.ts";
import type { AppSpec } from "../src/apps/runtime-client.ts";
import { encrypt } from "../src/apps/settings.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { FakeRuntime } from "./helpers/runtime.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";

const beforePin = "sha256:" + "a".repeat(64);
const afterPin = "sha256:" + "b".repeat(64);
const compose = (body: string, image = "sample/ui:1") =>
  JSON.stringify({
    volumes: { storage: {} },
    services: {
      web: {
        image,
        command: ["serve"],
        environment: { PAGE_BASE64: Buffer.from(body).toString("base64") },
        volumes: ["storage:/data"],
        expose: ["8080"],
      },
    },
  });
const source = (composeText: string): ReplacementSnapshot => ({
  repo: "sample/mine",
  repoId: "123",
  commit: "b".repeat(40),
  composePath: "compose.yaml",
  composeText,
  kitPath: "kit.yaml",
  kitText: "kit: 1\nname: dashboard\ninterface: {service: web, port: 8080}\n",
});
class Engine extends FakeRuntime {
  override async check(spec: AppSpec) {
    const report = await super.check(spec);
    report.images = Object.entries(spec.pins ?? {}).map(([ref, digest]) => ({
      ref,
      digest,
      runsHere: true,
      platforms: ["linux/arm64"],
    }));
    report.variables = [];
    return report;
  }
}
let t: TestDatabase, owner: string, id: string, engine: Engine, service: AppsService;
const base = compose("old");
const next = compose("new");
beforeEach(async () => {
  t = await createTestDatabase();
  await createOwnerWithPassword(t.db);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  engine = new Engine();
  service = new AppsService(t.db, engine, { publicUrl: "https://workspace.example.test", dataKey: TEST_DATA_KEY });
  const [row] = await t.db
    .insert(app)
    .values({
      name: "dashboard",
      title: "Dashboard",
      sourceUrl: "sha256:" + "c".repeat(64),
      repo: "",
      path: "compose.yaml",
      ref: "",
      commit: "",
      compose: base,
      kit: { kit: 1, interface: { service: "web", port: 8080 } },
      kitSource: "sha256:" + "d".repeat(64),
      images: { "sample/ui:1": { digest: beforePin } },
      adaptations: [],
      interface: { service: "web", port: 8080 },
      limits: {},
      installedBy: owner,
      state: "running",
    })
    .returning({ id: app.id });
  id = row!.id;
  await t.db
    .insert(appSetting)
    .values({ appId: id, name: "API_KEY", value: encrypt(TEST_DATA_KEY, "test-only-setting"), secret: true });
});
afterEach(async () => t.destroy());

it("pins packed app changes, keeps the install and storage, and retires old authority before dispatch", async () => {
  const p = await previewReplacement(service, id, owner, source(next));
  expect(p).toMatchObject({
    appId: id,
    repoId: "123",
    services: ["web"],
    images: { "sample/ui:1": { digest: beforePin } },
  });
  expect(JSON.stringify(p)).not.toContain("test-only-setting");
  const record = (await t.db.select().from(appReplacement))[0]!;
  expect(JSON.stringify(record)).not.toContain("test-only-setting");
  await t.pool.query(
    "insert into agent_binding(app_id,kit_digest,credential,revision,enabled_roles) values($1,'fixture','synthetic',1,array['reader'])",
    [id],
  );
  await t.pool.query(
    "insert into workspace_home(workspace_id, selected_id,generation,revision,grants) select workspace_id,$1,'fixture',1,'[]'::jsonb from installation where id=1",
    [id],
  );
  const run = engine.apply.bind(engine);
  vi.spyOn(engine, "apply").mockImplementation(async (spec, step) => {
    expect(
      (await t.pool.query("select credential from agent_binding where app_id=$1", [id])).rows[0].credential,
    ).toBeNull();
    expect((await t.pool.query("select selected_id from workspace_home")).rows[0].selected_id).toBeNull();
    expect(spec).toMatchObject({
      project: "ys-dashboard",
      compose: next,
      pins: { "sample/ui:1": beforePin },
      env: { API_KEY: "test-only-setting" },
    });
    await run(spec, step);
  });
  await expect(applyReplacement(service, id, owner, p.previewId, "999")).rejects.toMatchObject({
    code: "replacement_changed",
  });
  const result = await applyReplacement(service, id, owner, p.previewId, "123");
  expect(result).toMatchObject({ appId: id, commit: source(next).commit, status: "applied" });
  expect(await applyReplacement(service, id, owner, p.previewId, "123")).toEqual(result);
  expect(engine.apply).toHaveBeenCalledTimes(1);
  expect((await t.db.select().from(app))[0]).toMatchObject({
    id,
    repo: "sample/mine",
    commit: source(next).commit,
    state: "running",
  });
  expect(record.original).toMatchObject({ compose: base, repo: "" });
  expect(engine.calls.some((c) => ["down", "deleteVolumes"].includes(c.method))).toBe(false);
});

it("detects a stale preview, unchanged code, new mutable tags and incompatible volumes or service layout", async () => {
  await expect(previewReplacement(service, id, owner, source(base + "\n"))).rejects.toMatchObject({
    code: "unchanged_artifact",
  });
  for (const invalid of [
    next.replace("storage:/data", "storage:/other"),
    next.replace('"web":', '"other":'),
    compose("new", "sample/ui:latest"),
  ]) {
    await expect(previewReplacement(service, id, owner, source(invalid))).rejects.toMatchObject({
      code: "incompatible_replacement",
    });
  }
  const fixed = compose("new", "sample/ui:1@" + afterPin);
  const p = await previewReplacement(service, id, owner, source(fixed));
  expect(engine.calls.at(-1)?.spec).toMatchObject({ pins: { "sample/ui:1": afterPin }, verifyPins: ["sample/ui:1"] });
  await t.pool.query("update app_setting set value=$1", [encrypt(TEST_DATA_KEY, "updated")]);
  await expect(applyReplacement(service, id, owner, p.previewId, "123")).rejects.toMatchObject({
    code: "replacement_changed",
  });
  expect(engine.calls.filter((c) => c.method === "apply")).toHaveLength(0);
  await expect(
    previewReplacement(service, id, "00000000-0000-4000-8000-000000000001", source(fixed)),
  ).rejects.toMatchObject({ status: 403 });
});

it("recovers previous pinned artifacts on failure and serializes retries without deleting app data", async () => {
  const p = await previewReplacement(service, id, owner, source(next));
  vi.spyOn(engine, "apply").mockRejectedValueOnce(new Error("synthetic runtime failure"));
  await expect(applyReplacement(service, id, owner, p.previewId, "123")).rejects.toMatchObject({
    code: "previous_artifacts_restored",
  });
  expect((await t.db.select().from(app))[0]).toMatchObject({
    id,
    compose: base,
    images: { "sample/ui:1": { digest: beforePin } },
  });
  expect((await t.db.select().from(appReplacement))[0]).toMatchObject({ state: "failed" });
  await service.reconcile();
  const results = await Promise.allSettled([
    applyReplacement(service, id, owner, p.previewId, "123"),
    applyReplacement(service, id, owner, p.previewId, "123"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(engine.calls.filter((c) => c.method === "apply").map((c) => c.spec?.compose)).toEqual([base, next]);
});

it("keeps ambiguous deployment interrupted across restart and resumes the exact persisted candidate", async () => {
  const p = await previewReplacement(service, id, owner, source(next));
  engine.failApply = "fixture";
  await expect(applyReplacement(service, id, owner, p.previewId, "123")).rejects.toMatchObject({
    code: "deployment_interrupted",
  });
  const restarted = new AppsService(t.db, engine, service.config);
  const prevCount = engine.calls.filter((c) => c.method === "apply").length;
  await restarted.reconcile();
  await expect(restarted.start("dashboard")).rejects.toMatchObject({ code: "replacement_pending" });
  expect(engine.calls.filter((c) => c.method === "apply")).toHaveLength(prevCount);
  await t.db
    .update(appReplacement)
    .set({ expiresAt: new Date(0) })
    .where(eq(appReplacement.id, p.previewId));
  engine.failApply = undefined;
  expect(await applyReplacement(restarted, id, owner, p.previewId, "123")).toMatchObject({ status: "applied" });
});
