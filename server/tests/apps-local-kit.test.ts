// Installing an app with a kit file from this machine, such as one from a private kits repository,
// which Your Space can't read from GitHub (install-app --kit <file | ->). The kit names the app's
// Compose file on GitHub.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { operatorActorId } from "../src/actors.ts";
import { KitError, KitFileError, kitFromFile, readLocalKit } from "../src/apps/kits.ts";
import { AppsService } from "../src/apps/service.ts";
import { app } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { COMMIT, fakeGithub, FakeRuntime } from "./helpers/runtime.ts";

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
describe("a kit file on this machine", () => {
  let folder: string;
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "ys-kits-"));
    writeFileSync(join(folder, "kit.yaml"), KIT);
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("is read from a file or from standard input", () => {
    expect(readLocalKit(join(folder, "kit.yaml"))).toBe(KIT);
    expect(readLocalKit("-", join(folder, "kit.yaml"))).toBe(KIT);
  });

  it("says which file it can't read, and that a folder isn't a kit", () => {
    expect(() => readLocalKit(join(folder, "nope.yaml"))).toThrow(new KitFileError(`The kit file ${join(folder, "nope.yaml")} can't be read (ENOENT).`));
    expect(() => readLocalKit(folder)).toThrow(new KitFileError(`${folder} is a folder. Give the kit file itself.`));
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

  it("reads the Compose file the kit names, uses the kit for the review and the install, and keeps its digest", async () => {
    const review = await apps.preview({ text: KIT });
    expect(review).toMatchObject({ name: "private-app", title: "Private App", outbound: ["example.com"], kit: { source: expect.stringMatching(/^sha256:/) } });
    // The kit names no commit, so the file is read at the head of its repository's default branch.
    expect(review.source).toMatchObject({ repo: "ys-fixtures/Private-App", path: "compose.yaml", commit: COMMIT });
    const { done } = await apps.install(review.previewId, {}, false, await operatorActorId(t.db));
    await done;
    const [row] = await t.db.select().from(app).where(eq(app.name, "private-app"));
    expect(row).toMatchObject({ kitSource: review.kit.source, kit: { name: "private-app" } });
  });

  it("refuses a kit file whose Compose file isn't on GitHub, or that names none", async () => {
    await expect(apps.preview({ text: KIT.replace("compose.yaml", "other.yaml") })).rejects.toThrow(/no file other.yaml/);
    await expect(apps.preview({ text: KIT.replace(/^source: .*\n/m, "") })).rejects.toMatchObject({ code: "source", message: expect.stringMatching(/--compose/) });
  });

  it("refuses a Compose file given as the kit, and says what a kit is", async () => {
    await expect(apps.preview({ text: COMPOSE })).rejects.toMatchObject({ code: "kit_required", message: expect.stringMatching(/not a Your Space kit/) });
  });
});
