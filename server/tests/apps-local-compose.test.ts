// Installing an app from a Compose file on this machine, for an app whose own file doesn't fit Your
// Space's rules (install-app --compose <file | -> --kit <file | -> [--name <name>]). Every app
// installs with a kit (decision 2026-11-23), this one included.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { operatorActorId } from "../src/actors.ts";
import { SourceError } from "../src/apps/github.ts";
import { KitFileError, kitFromFile, parseKit, readLocalKit } from "../src/apps/kits.ts";
import { ComposeFileError, isLocalSource, localSource, readLocalCompose, sourcesProblem } from "../src/apps/local.ts";
import { AppError, AppsService } from "../src/apps/service.ts";
import { app, installJob } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY } from "./helpers/env.ts";
import { runCommand } from "./helpers/commands.ts";
import { COMMIT, fakeGithub, FakeRuntime } from "./helpers/runtime.ts";

const COMPOSE = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
`;
const DIGEST = `sha256:${createHash("sha256").update(COMPOSE).digest("hex")}`;
// A kit for a Compose file on this machine leaves out source.
const KIT = `kit: 1
name: notes
title: Notes
interface: { service: web, port: 80 }
outbound: [example.com]
`;
// A kit written for an app's file on GitHub, given with a Compose file adapted from it.
const GITHUB_KIT = `kit: 1
source: { repo: ys-fixtures/notes, path: compose.yaml, commit: ${COMMIT} }
name: notes
title: Notes
`;
const KIT_LINK = "https://github.com/ys-fixtures/kits/blob/main/apps/ys-fixtures/notes.yaml";
// A kit with no name, so the name comes from --name.
const NAMELESS = "kit: 1\n";

describe("install-app's sources", () => {
  it("are a kit's link, a kit file, or --compose with a kit file, with at most one of them on standard input", () => {
    expect(sourcesProblem({ link: KIT_LINK })).toBeNull();
    expect(sourcesProblem({ kit: "-" })).toBeNull();
    expect(sourcesProblem({ compose: "-", kit: "/tmp/kit.yaml", name: "notes" })).toBeNull();
    expect(sourcesProblem({ compose: "/tmp/compose.yaml", kit: "-" })).toBeNull();
    expect(sourcesProblem({})).toMatch(/link to the app's kit, or --kit/);
    expect(sourcesProblem({ compose: "compose.yaml" })).toMatch(/--compose needs --kit: every app installs with a kit/);
    expect(sourcesProblem({ link: KIT_LINK, kit: "-" })).toMatch(/not both/);
    expect(sourcesProblem({ link: KIT_LINK, compose: "-", kit: "/tmp/kit.yaml" })).toMatch(/not a link/);
    expect(sourcesProblem({ compose: "-", kit: "-" })).toMatch(/can't both be -/);
    expect(sourcesProblem({ compose: "-", kit: "https://github.com/o/r/blob/main/kit.yaml" })).toMatch(/--kit takes a kit file/);
    expect(sourcesProblem({ kit: "https://github.com/o/r/blob/main/kit.yaml" })).toMatch(/first argument/);
    expect(sourcesProblem({ link: KIT_LINK, name: "notes" })).toMatch(/--name goes with --compose/);
  });

  it("are checked by the command before it reads anything, and a file it can't read is named", async () => {
    const options = { databaseUrl: "postgres://nobody:wrong@127.0.0.1:1/none" };
    const both = await runCommand("install-app", ["--compose", "-", "--kit", "-", "--json"], options);
    expect(both.code).toBe(1);
    expect(both.json).toMatchObject({ ok: false, error: "usage", message: expect.stringMatching(/can't both be -/) });
    const kitless = await runCommand("install-app", ["--compose", "/nope/compose.yaml", "--name", "notes", "--json"], options);
    expect(kitless.code).toBe(1);
    expect(kitless.json).toMatchObject({ ok: false, error: "usage", message: expect.stringMatching(/--compose needs --kit/) });
    const missing = await runCommand("install-app", ["--compose", "/nope/compose.yaml", "--kit", "/nope/kit.yaml", "--name", "notes", "--json"], options);
    expect(missing.code).toBe(2);
    expect(missing.json).toEqual({ ok: false, error: "compose_file", message: "The Compose file /nope/compose.yaml can't be read (ENOENT)." });
    const noKit = await runCommand("install-app", ["--kit", "/nope/kit.yaml", "--json"], options);
    expect(noKit.code).toBe(2);
    expect(noKit.json).toEqual({ ok: false, error: "kit_file", message: "The kit file /nope/kit.yaml can't be read (ENOENT)." });
  });
});

describe("a Compose file on this machine", () => {
  let folder: string;
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "ys-compose-"));
    writeFileSync(join(folder, "compose.yaml"), COMPOSE);
    writeFileSync(join(folder, "big.yaml"), `${COMPOSE}#${"x".repeat(256 * 1024)}\n`);
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("is read from a file, with its name, or from standard input, without one", () => {
    expect(readLocalCompose(join(folder, "compose.yaml"))).toEqual({ text: COMPOSE, name: "compose.yaml" });
    expect(readLocalCompose("-", join(folder, "compose.yaml"))).toEqual({ text: COMPOSE, name: "" });
  });

  it("says which file it can't read", () => {
    expect(() => readLocalCompose(join(folder, "nope.yaml"))).toThrow(new ComposeFileError(`The Compose file ${join(folder, "nope.yaml")} can't be read (ENOENT).`));
    expect(() => readLocalCompose(folder)).toThrow(/is a folder/);
    expect(() => readLocalCompose(join(folder, "big.yaml"))).toThrow(/larger/);
  });

  it("is recorded by its digest and name, with no repository, branch or commit", () => {
    const source = localSource({ text: COMPOSE, name: "compose.yaml" });
    expect(source).toEqual({ link: DIGEST, repo: "", ref: "", path: "compose.yaml", commit: "", text: COMPOSE, pinnedLink: DIGEST });
    expect(isLocalSource(source)).toBe(true);
    expect(isLocalSource({ link: "https://github.com/ys-fixtures/notes/blob/main/compose.yaml" })).toBe(false);
    expect(() => localSource({ text: " \n", name: "" })).toThrow(SourceError);
  });

  it("takes the kit given with it, whose source isn't matched; a kit without source fits no GitHub file", () => {
    expect(parseKit(KIT).source).toBeUndefined();
    expect(kitFromFile(KIT, null).kit).toMatchObject({ name: "notes", outbound: ["example.com"] });
    expect(kitFromFile(GITHUB_KIT, null).kit.name).toBe("notes");
    expect(() => kitFromFile(KIT, { repo: "ys-fixtures/notes", path: "compose.yaml" })).toThrow(/names no Compose file in source/);
    // The kit is a file, never a folder of kits.
    expect(() => readLocalKit(folder)).toThrow(KitFileError);
  });
});

describe("installing from a Compose file on this machine", () => {
  let t: TestDatabase;
  let apps: AppsService;
  let actor: string;
  const runtime = new FakeRuntime();
  // GitHub, for the app installed from a link; the counter shows nothing else reads it.
  const github = fakeGithub({ "ys-fixtures/notes/compose.yaml": COMPOSE });
  let fetches = 0;
  const fetch = ((...args: Parameters<typeof github>) => {
    fetches += 1;
    return github(...args);
  }) as typeof github;

  async function settled(): Promise<void> {
    for (let i = 0; i < 500; i++) {
      const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("A job didn't finish.");
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    apps = new AppsService(t.db, runtime, { publicUrl: "http://space.localhost", dataKey: TEST_DATA_KEY, github: { api: "https://api.github.test", raw: "https://raw.github.test" }, fetch });
    actor = await operatorActorId(t.db);
  });
  afterAll(async () => {
    await t?.destroy();
  });

  it("installs from a file with its kit, records the file by its digest, and reads nothing from GitHub", async () => {
    const review = await apps.preview({ text: KIT }, { text: COMPOSE, name: "compose.yaml" });
    expect(review).toMatchObject({
      name: "notes",
      title: "Notes",
      outbound: ["example.com"],
      source: { link: DIGEST, repo: "", path: "compose.yaml", commit: "" },
      kit: { source: expect.stringMatching(/^sha256:/) },
    });
    const { done } = await apps.install(review.previewId, {}, false, actor);
    await done;
    const [row] = await t.db.select().from(app).where(eq(app.name, "notes"));
    expect(row).toMatchObject({ sourceUrl: DIGEST, repo: "", path: "compose.yaml", ref: "", commit: "", compose: COMPOSE, kitSource: review.kit.source, state: "running" });
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.compose).toBe(COMPOSE);
    expect(fetches).toBe(0);
  });

  it("starts again from the stored file when it isn't running, still without GitHub", async () => {
    runtime.running.delete("ys-notes");
    const before = runtime.calls.filter((c) => c.method === "apply").length;
    await apps.reconcile();
    await settled();
    const applies = runtime.calls.filter((c) => c.method === "apply");
    expect(applies.length).toBe(before + 1);
    expect(applies.at(-1)!.spec!.compose).toBe(COMPOSE);
    expect(fetches).toBe(0);
  });

  it("installs from standard input with --name, which comes before the kit's name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-stdin-"));
    writeFileSync(join(dir, "stdin"), COMPOSE);
    // A file stands in for standard input, as `--compose - < compose.yaml` gives it.
    const compose = readLocalCompose("-", join(dir, "stdin"));
    rmSync(dir, { recursive: true, force: true });
    const review = await apps.preview({ text: GITHUB_KIT }, compose, "journal");
    expect(review).toMatchObject({ name: "journal", title: "Notes", source: { link: DIGEST, path: "" } });
    await (await apps.install(review.previewId, {}, false, actor)).done;
    const [row] = await t.db.select().from(app).where(eq(app.name, "journal"));
    expect(row).toMatchObject({ sourceUrl: DIGEST, path: "", compose: COMPOSE, kit: { name: "notes" }, state: "running" });
    expect(fetches).toBe(0);
  });

  it("needs a valid name from --name or the kit", async () => {
    const compose = { text: COMPOSE, name: "" };
    await expect(apps.preview({ text: NAMELESS }, compose)).rejects.toMatchObject({ code: "name_required" });
    await expect(apps.preview({ text: NAMELESS }, compose, "Not A Name")).rejects.toMatchObject({ code: "bad_name" });
    await expect(apps.preview({ text: NAMELESS }, compose, "admin")).rejects.toMatchObject({ code: "name_reserved" });
    await expect(apps.preview({ text: NAMELESS }, compose, "notes")).rejects.toMatchObject({ code: "already_installed" });
    await expect(apps.preview({ text: NAMELESS }, { text: "", name: "" }, "empty")).rejects.toThrow(AppError);
    await expect(apps.preview({ text: "kit: 3\n" }, compose, "x")).rejects.toThrow(/kit format/);
    // A Compose file given as the kit says what a kit is.
    await expect(apps.preview({ text: COMPOSE }, compose, "x")).rejects.toMatchObject({ code: "kit_required" });
    expect(fetches).toBe(0);
  });

  it("can reuse data kept under its name, from an app installed from GitHub too, only when asked", async () => {
    // A kit file without source is for a Compose file on this machine, not for an app's file on GitHub.
    await expect(apps.preview({ text: KIT })).rejects.toThrow(/names no Compose file/);
    const linked = await apps.preview({ text: GITHUB_KIT.replace("name: notes", "name: shared") });
    await (await apps.install(linked.previewId, {}, false, actor)).done;
    await apps.remove("shared", actor);
    await settled();
    fetches = 0;

    const review = await apps.preview({ text: NAMELESS }, { text: COMPOSE, name: "" }, "shared");
    expect(review.retained).toBe(true);
    await expect(apps.install(review.previewId, {}, false, actor)).rejects.toMatchObject({ code: "retained_data" });
    const again = await apps.preview({ text: NAMELESS }, { text: COMPOSE, name: "" }, "shared");
    await (await apps.install(again.previewId, {}, true, actor)).done;
    const [row] = await t.db.select().from(app).where(eq(app.name, "shared"));
    expect(row).toMatchObject({ sourceUrl: DIGEST, repo: "", state: "running" });
    expect(fetches).toBe(0);
  });
});
