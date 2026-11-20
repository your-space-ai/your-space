// Installing an app with a kit file from this machine, such as one from a private kits repository,
// which Your Space can't read from GitHub (install-app --kit <file | folder | ->).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { operatorActorId } from "../src/actors.ts";
import { KitError, KitFileError, kitFromFile, readLocalKit } from "../src/apps/kits.ts";
import { AppError, AppsService } from "../src/apps/service.ts";
import { app } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { fakeGithub, FakeRuntime } from "./helpers/runtime.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
`;
const KIT = `kit: 1
source: { repo: ys-fixtures/Private-App, path: compose.yaml }
name: private-app
title: Private App
interface: { service: web, port: 80 }
outbound: [example.com]
`;
const LINK = "https://github.com/ys-fixtures/Private-App/blob/main/compose.yaml";

describe("a kit file on this machine", () => {
  let folder: string;
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "ys-kits-"));
    mkdirSync(join(folder, "apps", "ys-fixtures"), { recursive: true });
    writeFileSync(join(folder, "apps", "ys-fixtures", "private-app.yaml"), KIT);
    writeFileSync(join(folder, "kit.yaml"), KIT);
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("is read from a file, from a kits folder by the app's repository, or from standard input", () => {
    expect(readLocalKit(join(folder, "kit.yaml"), LINK)).toBe(KIT);
    expect(readLocalKit(folder, LINK)).toBe(KIT);
    expect(readLocalKit("-", LINK, join(folder, "kit.yaml"))).toBe(KIT);
  });

  it("says which file it can't read", () => {
    expect(() => readLocalKit(join(folder, "nope.yaml"), LINK)).toThrow(new KitFileError(`The kit file ${join(folder, "nope.yaml")} can't be read (ENOENT).`));
    expect(() => readLocalKit(folder, "https://github.com/ys-fixtures/other/blob/main/compose.yaml")).toThrow(KitFileError);
  });

  it("is checked like a kit from GitHub, and recorded by its digest rather than its path", () => {
    const found = kitFromFile(KIT, { repo: "ys-fixtures/private-app", path: "compose.yaml" });
    expect(found.kit).toMatchObject({ name: "private-app", outbound: ["example.com"] });
    expect(found.source).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => kitFromFile(KIT, { repo: "ys-fixtures/private-app", path: "other.yaml" })).toThrow(/not ys-fixtures\/private-app\/other.yaml/);
    expect(() => kitFromFile(`${KIT}extra: 1\n`, { repo: "ys-fixtures/private-app", path: "compose.yaml" })).toThrow(KitError);
    expect(() => kitFromFile(`${KIT}#${"x".repeat(256 * 1024)}\n`, { repo: "ys-fixtures/private-app", path: "compose.yaml" })).toThrow(/larger/);
  });
});

describe("installing with a kit file", () => {
  let t: TestDatabase;
  let apps: AppsService;
  const runtime = new FakeRuntime();

  beforeAll(async () => {
    t = await createTestDatabase();
    // The kits repository has no kit for this app, as for a private one.
    const fetch = fakeGithub({ "ys-fixtures/Private-App/compose.yaml": COMPOSE });
    apps = new AppsService(t.db, runtime, { publicUrl: "http://space.localhost", dataKey: TEST_DATA_KEY, github: { api: "https://api.github.test", raw: "https://raw.github.test" }, fetch });
  });
  afterAll(async () => {
    await t?.destroy();
  });

  it("uses the kit for the review and the install, and keeps its digest", async () => {
    const review = await apps.preview(LINK, undefined, KIT);
    expect(review).toMatchObject({ name: "private-app", title: "Private App", outbound: ["example.com"], kit: { source: expect.stringMatching(/^sha256:/) } });
    const { done } = await apps.install(review.previewId, {}, false, await operatorActorId(t.db));
    await done;
    const [row] = await t.db.select().from(app).where(eq(app.name, "private-app"));
    expect(row).toMatchObject({ kitSource: review.kit!.source, kit: { name: "private-app" } });
  });

  it("refuses a kit file for another app", async () => {
    await expect(apps.preview("https://github.com/ys-fixtures/Private-App/blob/main/compose.yaml", undefined, KIT.replace("compose.yaml", "other.yaml"))).rejects.toThrow(AppError);
  });
});
