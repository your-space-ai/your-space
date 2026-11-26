import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { backupStamp, failedUpgrade, Moves, rollBack, sameDump } from "../src/commands/upgrade.ts";
import { holdingLock, lockInstallation, refuseWhileRestoreNeeded } from "../src/installation-lock.ts";
import { Installation } from "../src/installation.ts";
import { CliError } from "../src/errors.ts";
import { compareVersions, isCanary, isVersion, VERSION } from "../src/version.ts";
import { serveReleases, spawnAsync } from "./helpers/releases.ts";

describe("release versions", () => {
  it("are ordered by Semantic Versioning's precedence, prereleases before their release", () => {
    const ordered = [
      "0.0.0-test.1",
      "0.1.0-alpha",
      "0.1.0-alpha.1",
      "0.1.0-alpha.2",
      "0.1.0-alpha.10",
      "0.1.0-alpha.beta",
      "0.1.0-beta",
      "0.1.0-beta.2",
      "0.1.0-rc.1",
      "0.1.0",
      "0.1.1",
      "0.2.0-alpha.1",
      "0.10.0",
      "1.0.0",
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        expect(Math.sign(compareVersions(ordered[i]!, ordered[j]!)), `${ordered[i]} vs ${ordered[j]}`).toBe(Math.sign(i - j));
      }
    }
    // Build metadata doesn't change which release it is.
    expect(compareVersions("0.1.0+build.5", "0.1.0")).toBe(0);
  });

  it("are only release versions", () => {
    for (const version of ["0.1.0", "0.1.0-alpha.1", "1.2.3-rc.1+abc"]) expect(isVersion(version)).toBe(true);
    for (const version of ["0.1.0-alpha01", "0.1.0+001", "0.1.0-0"]) expect(isVersion(version)).toBe(true);
    for (const version of ["latest", "v0.1.0", "0.1", "01.0.0", "0.1.0-", "0.1.0-alpha.01", "0.1.0-01", ""]) expect(isVersion(version)).toBe(false);
    expect(() => compareVersions("latest", "0.1.0")).toThrow();
  });
});

describe("a failed upgrade", () => {
  const versions = { from: "0.1.0-alpha.1", to: "0.1.0-alpha.2", backup: "backups/20261123T154500Z-0.1.0-alpha.1.sql", previous: ".upgrade-x/previous" };
  const failure = new CliError("start_failed", "The server didn't become healthy. See its log with: your-space logs server");

  it("says the previous version is back, and whether its database was restored", () => {
    expect(failedUpgrade(failure, { filesBack: true, restored: false, running: true }, versions)).toBe(
      "The server didn't become healthy. See its log with: your-space logs server\nThe upgrade to 0.1.0-alpha.2 didn't finish, so Your Space 0.1.0-alpha.1 is back and running, with its data as it was; the database backup is at backups/20261123T154500Z-0.1.0-alpha.1.sql.",
    );
    expect(failedUpgrade(failure, { filesBack: true, restored: true, running: true }, versions)).toContain(
      "is back and running, with its database restored from the backup taken just before (backups/20261123T154500Z-0.1.0-alpha.1.sql), since 0.1.0-alpha.2 had already changed it.",
    );
    expect(failedUpgrade(failure, { filesBack: true, restored: false, running: false }, versions)).toContain("but it didn't start either. See why with: your-space logs");
  });

  it("says how to restore the backup by hand when that couldn't be done for the owner", () => {
    const message = failedUpgrade(failure, { filesBack: true, restored: false, running: false, restoreProblem: "the database couldn't be checked" }, versions);
    expect(message).toContain("files are back, but the database couldn't be checked. Restore backups/20261123T154500Z-0.1.0-alpha.1.sql as \"Restore the Backup by Hand\"");
    expect(failedUpgrade(failure, { filesBack: false, restored: false, running: false }, versions)).toContain("they are in .upgrade-x/previous. Move them back");
  });

  it("moves the release files back even when the swap stopped part way", () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-moves-"));
    roots.push(root);
    const [folder, held] = [join(root, "install"), join(root, "held")];
    mkdirSync(join(folder, "modes"), { recursive: true });
    mkdirSync(join(held, "modes"), { recursive: true });
    writeFileSync(join(folder, "compose.yaml"), "old");
    writeFileSync(join(held, "modes", "taken"), "a folder that isn't empty can't be replaced");
    const moves = new Moves();
    expect(() => moves.move(["compose.yaml", "modes"], folder, held)).toThrow();
    expect(moves.started).toBe(true);
    moves.undo();
    expect(readFileSync(join(folder, "compose.yaml"), "utf8")).toBe("old");
    expect(existsSync(join(folder, "modes"))).toBe(true);
    expect(moves.started).toBe(false);
  });

  it("puts nothing back when stopping the new version fails without a word", async () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-rollback-"));
    roots.push(root);
    const [folder, held] = [join(root, "install"), join(root, "held")];
    mkdirSync(folder);
    mkdirSync(held);
    releaseFiles(folder, VERSION);
    const moves = new Moves();
    const ran: string[][] = [];
    const compose = { run: async (args: string[]) => (ran.push(args), Promise.reject(new Error(""))) };
    const result = await rollBack(compose as never, new Installation(folder), { moves, envBefore: null, backup: { path: join(root, "backup.sql") } });
    expect(result).toMatchObject({ stopProblem: "Docker Compose couldn't stop them", filesBack: false, running: false });
    expect(ran).toEqual([["stop", "caddy", "server"]]);
  });

  it("compares dumps by what they hold, not by pg_dump's random restrict key", async () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-dumps-"));
    roots.push(root);
    const write = (name: string, key: string, data: string) =>
      writeFileSync(join(root, name), `\\restrict ${key}\n-- PostgreSQL database dump\n${data}\n-- PostgreSQL database dump complete\n\\unrestrict ${key}\n`);
    write("a.sql", "abc", "COPY owner (name) FROM stdin;\nsam\n\\.");
    write("b.sql", "xyz", "COPY owner (name) FROM stdin;\nsam\n\\.");
    write("c.sql", "abc", "COPY owner (name) FROM stdin;\nsam\nnew\n\\.");
    expect(await sameDump(join(root, "a.sql"), join(root, "b.sql"))).toBe(true);
    expect(await sameDump(join(root, "a.sql"), join(root, "c.sql"))).toBe(false);
  });

  it("names its backup by the time it was taken", () => {
    expect(backupStamp(new Date("2026-11-23T15:45:00.123Z"))).toBe("20261123T154500Z");
  });
});

// The command itself, from src/index.ts, with a stand-in for Docker that records what it was asked
// and plays a running installation: its database's recorded migrations change when the new
// version starts, and the new version can fail to start.
const OLD = "0.0.0-test.1";
const command = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const DOCKER = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.FAKE_DOCKER_DIR;
const scenario = JSON.parse(fs.readFileSync(path.join(dir, "scenario.json"), "utf8"));
const statePath = path.join(dir, "state.json");
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { changed: false, running: scenario.running };
const args = process.argv.slice(2);
const input = args.includes("-T") && !args.includes("pg_dump") ? fs.readFileSync(0, "utf8") : "";
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ args, input: input.slice(0, 1000) }) + "\\n");
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const line = args.join(" ");
const stack = () => fs.readFileSync(path.join(process.cwd(), "stack.yaml"), "utf8");
const isNew = () => stack().includes(":" + scenario.newVersion + "\\n");
if (line === "version --format json") console.log(JSON.stringify({ Server: { Version: "29.1.0", Os: "linux", Arch: "x86_64" } }));
else if (line === "compose version --short") console.log("2.40.0");
else if (line.startsWith("compose ls")) console.log("[]");
else if (line.startsWith("compose ps")) {
  const up = (name) => JSON.stringify({ Service: name, State: state.running ? "running" : "exited", Health: name === "server" || name === "postgres" ? "healthy" : "" });
  const rows = state.running ? ["postgres", "server", "caddy", "runtime"].map(up) : state.db ? [JSON.stringify({ Service: "postgres", State: "running", Health: "healthy" })] : [];
  if (state.failedServer) rows.push(JSON.stringify({ Service: "server", State: "restarting", Health: "", ExitCode: 1 }));
  console.log(rows.join("\\n"));
}
else if (args.includes("pull")) process.exitCode = scenario.pullFails ? 1 : 0;
else if (line === "compose up -d --wait postgres") { state.db = true; save(); }
else if (line.startsWith("compose stop")) {
  if (scenario.stopFails && state.failedServer) { process.stderr.write("Error response from daemon: cannot stop container"); process.exitCode = 1; }
  else { state.running = false; state.failedServer = false; save(); }
}
else if (args.includes("pg_dump")) {
  // Ctrl-C, or the desktop app quitting, while the database is backed up.
  if (scenario.signalled) process.kill(process.ppid, "SIGTERM");
  if (scenario.dumpFails || (scenario.unreadable && state.failed)) { process.stderr.write("pg_dump: error: connection failed"); process.exitCode = 1; }
  // Each dump has its own random key, as pg_dump's own do; the data is the same unless it changed.
  else process.stdout.write("\\\\restrict " + Math.random().toString(36).slice(2) + "\\n-- PostgreSQL database dump\\nCREATE TABLE owner (name text);\\n-- the owner: sam\\n" + (state.changed ? "-- changed by the new version\\n" : "") + "\\n--\\n-- PostgreSQL database dump complete\\n--\\n\\n\\\\unrestrict " + Math.random().toString(36).slice(2) + "\\n");
}
else if (args.includes("yourspace_restore")) { state.changed = false; save(); }
else if (args.includes("psql")) {}
else if (line === "compose up -d --wait" && isNew() && scenario.caddyFails) {
  process.stderr.write("Error response from daemon: failed to bind host port 127.0.0.1:80/tcp: address already in use");
  process.exitCode = 1;
}
else if (line === "compose up -d --wait" || line === "compose up -d --wait server") {
  if (isNew()) {
    if (scenario.migrates || scenario.rewrites) state.changed = true;
    if (scenario.newFails) { state.failedServer = true; state.failed = true; process.stderr.write("dependency failed to start: container your-space-server-1 is unhealthy"); process.exitCode = 1; }
    else state.running = true;
  } else if (scenario.oldFails) process.exitCode = 1;
  else state.running = true;
  save();
}
else if (line.startsWith("compose logs")) {}
else { process.stderr.write("unexpected docker " + line); process.exitCode = 1; }
`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function releaseFiles(folder: string, version: string): void {
  mkdirSync(join(folder, "modes"), { recursive: true });
  writeFileSync(join(folder, "compose.yaml"), "name: your-space\n");
  writeFileSync(join(folder, "stack.yaml"), `image: ghcr.io/your-space-ai/your-space-server:${version}\n`);
  writeFileSync(join(folder, "modes", "mode.yaml"), `# ${version}\n`);
  writeFileSync(join(folder, "env.example"), `# ${version}\n# YS_PORT=8081\n`);
}

interface Scenario {
  running?: boolean;
  /** The new version changes data as it starts, without a migration. */
  rewrites?: boolean;
  /** The previous version doesn't start again either. */
  oldFails?: boolean;
  /** The new version's server is ready, then Caddy doesn't start. */
  caddyFails?: boolean;
  /** The upgrade gets SIGTERM while the database is backed up. */
  signalled?: boolean;
  /** The new version's server can't be stopped for the rollback. */
  stopFails?: boolean;
  /** The database can't be read once the new version failed. */
  unreadable?: boolean;
  newFails?: boolean;
  migrates?: boolean;
  dumpFails?: boolean;
  pullFails?: boolean;
}

interface Options {
  installed?: string;
  env?: string;
  global?: string[];
  example?: string;
  lock?: number | string;
  leftover?: string[];
  missing?: string[];
  extra?: Record<string, string>;
  /** Backups that earlier upgrades left in backups/, by name, with what each holds. */
  backups?: Record<string, string>;
}

/** An installation of `installed`, a release of the CLI's version in `release`, and the stand-in for Docker. */
function installation(scenario: Scenario, options: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), "ys-cli-upgrade-"));
  roots.push(root);
  const folder = join(root, "install"), files = join(root, "files"), release = join(root, "release"), bin = join(root, "bin"), fake = join(root, "docker");
  for (const path of [folder, files, release, bin, fake]) mkdirSync(path, { recursive: true });
  releaseFiles(folder, options.installed ?? OLD);
  const env = options.env ?? "YS_PORT=8081\n# my own note\n";
  writeFileSync(join(folder, ".env"), env, { mode: 0o600 });
  writeFileSync(join(folder, "compose.e2e.yaml"), "services: {}\n");
  if (options.lock !== undefined) writeFileSync(join(folder, ".your-space.lock"), `${options.lock}\n`);
  if (options.leftover) {
    mkdirSync(join(folder, ".upgrade-left", "previous"), { recursive: true });
    for (const name of options.leftover) writeFileSync(join(folder, ".upgrade-left", "previous", name), "previous");
  }
  for (const name of options.missing ?? []) rmSync(join(folder, name));
  if (options.backups) {
    mkdirSync(join(folder, "backups"), { mode: 0o700 });
    for (const [name, text] of Object.entries(options.backups)) writeFileSync(join(folder, "backups", name), text, { mode: 0o600 });
  }
  releaseFiles(files, VERSION);
  if (options.example) writeFileSync(join(files, "env.example"), options.example);
  for (const [name, text] of Object.entries(options.extra ?? {})) writeFileSync(join(files, name), text);
  const archive = join(release, "your-space.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", files, "compose.yaml", "stack.yaml", "modes", "env.example", ...Object.keys(options.extra ?? {})]);
  writeFileSync(join(release, "SHA256SUMS"), `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  your-space.tar.gz\n`);
  writeFileSync(join(fake, "scenario.json"), JSON.stringify({ running: true, newVersion: VERSION, ...scenario }));
  writeFileSync(join(bin, "docker"), DOCKER, { mode: 0o700 });

  const { DOCKER_CONTEXT: _context, COMPOSE_PROJECT_NAME: _project, ...rest } = process.env;
  const variables: NodeJS.ProcessEnv = { ...rest, PATH: `${bin}:${process.env.PATH}`, DOCKER_HOST: "unix:///var/run/docker.sock", FAKE_DOCKER_DIR: fake };
  return { folder, release, env, fake, variables };
}

/** What `your-space upgrade` did in an installation: its output, and what it asked Docker. */
function outcome(made: ReturnType<typeof installation>, ran: { status: number | null; stdout: string; stderr: string }) {
  const { folder, env, fake } = made;
  const calls = existsSync(join(fake, "calls.jsonl"))
    ? readFileSync(join(fake, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; input: string })
    : [];
  const compose = calls.map((c) => c.args.join(" ")).filter((c) => c.startsWith("compose") && !/^compose (ls|version|ps)/.test(c));
  let json;
  try {
    json = JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    json = undefined;
  }
  return { ran, json, folder, env, calls, compose };
}

/** An installation of `installed` and a release of the CLI's version, then `your-space upgrade` in it. */
function upgrading(scenario: Scenario, options: Options = {}) {
  const made = installation(scenario, options);
  const ran = spawnSync(process.execPath, [command, "--workdir", made.folder, ...(options.global ?? ["--json"]), "upgrade", "--release-dir", made.release], {
    encoding: "utf8",
    env: made.variables,
  });
  return outcome(made, ran);
}

const stackOf = (folder: string) => readFileSync(join(folder, "stack.yaml"), "utf8");

describe("your-space upgrade", () => {
  it("reports an installation already at the CLI's version and changes nothing", () => {
    const up = upgrading({}, { installed: VERSION });
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.json).toEqual({ ok: true, from: VERSION, to: VERSION, upToDate: true });
    expect(up.compose).toEqual([]);
    expect(readdirSync(up.folder).sort()).toEqual([".env", "compose.e2e.yaml", "compose.yaml", "env.example", "modes", "stack.yaml"]);
  });

  it("refuses to move a newer installation back to the CLI's version", () => {
    const down = upgrading({}, { installed: "99.0.0" });
    expect(down.ran.status).toBe(2);
    expect(down.json).toMatchObject({ ok: false, error: "downgrade_refused", from: "99.0.0", to: VERSION });
    expect(down.json.message).toContain("Use the CLI 99.0.0 or later");
    expect(down.compose).toEqual([]);
    expect(stackOf(down.folder)).toContain("99.0.0");
  });

  it("moves a canary build on to a later release, and refuses a canary built after this CLI's release", () => {
    const script = fileURLToPath(new URL("../../deploy/canary-version.sh", import.meta.url));
    const canary = (tag: string) => execFileSync(script, [tag, "20261125", "42"], { encoding: "utf8" }).trim();
    // Back to releases: the next release's CLI upgrades a canary of the release before it.
    const before = canary("v0.0.0-alpha.1");
    const up = upgrading({}, { installed: before });
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.json).toMatchObject({ ok: true, from: before, to: VERSION });
    expect(stackOf(up.folder)).toContain(`:${VERSION}\n`);
    // A canary of this CLI's own release has code the release doesn't, so nothing goes back to it.
    const after = canary(`v${VERSION}`);
    const down = upgrading({}, { installed: after });
    expect(down.json).toMatchObject({ ok: false, error: "downgrade_refused", from: after, to: VERSION });
    expect(down.compose).toEqual([]);
  });

  it("backs up the database with Your Space stopped, then replaces the release files and starts the new version", () => {
    const up = upgrading({ migrates: true });
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.json).toEqual({ ok: true, from: OLD, to: VERSION, backup: expect.stringMatching(new RegExp(`/backups/\\d{8}T\\d{6}Z-${OLD.replaceAll(".", "\\.")}\\.sql$`)) });
    expect(up.json.backup.startsWith(up.folder)).toBe(true);
    expect(readFileSync(up.json.backup, "utf8")).toContain("-- the owner: sam");
    expect(statSync(up.json.backup).mode & 0o777).toBe(0o600);
    expect(statSync(join(up.folder, "backups")).mode & 0o777).toBe(0o700);
    // Images first, while the old version still runs; then the server stops before the dump.
    // The new release's own files, with this installation's .env: run from the installation, Compose
    // would read its stack.yaml and download nothing new.
    const release = /^compose --project-directory (\S+) /.exec(up.compose[0]!)?.[1];
    expect(release).toMatch(new RegExp(`^${up.folder}/\\.upgrade-[^/]+/release$`));
    expect(up.compose[0]).toBe(`compose --project-directory ${release} --env-file ${up.folder}/.env -f ${release}/compose.yaml pull --policy missing --quiet`);
    expect(up.compose.slice(1)).toEqual([
      "compose stop caddy server",
      "compose exec -T postgres pg_dump -U yourspace -d yourspace",
      // Caddy, the only way in, starts once everything else is ready.
      "compose up -d --wait server",
      "compose up -d --wait",
    ]);
    // The new release's files, and the owner's own .env and files untouched.
    expect(stackOf(up.folder)).toContain(`:${VERSION}\n`);
    expect(readFileSync(join(up.folder, "modes", "mode.yaml"), "utf8")).toBe(`# ${VERSION}\n`);
    expect(readFileSync(join(up.folder, ".env"), "utf8")).toBe(up.env);
    expect(readdirSync(up.folder).sort()).toEqual([".env", "backups", "compose.e2e.yaml", "compose.yaml", "env.example", "modes", "stack.yaml"]);
  });

  it("keeps every backup earlier upgrades left in backups/, whether it upgrades or puts the previous version back", () => {
    const earlier = { "20261101T120000Z-0.0.0-test.0.sql": "-- the first upgrade's backup\n", "20261115T120000Z-0.0.0-test.0.canary.20261115.1.sql": "-- the second's\n" };
    for (const scenario of [{ migrates: true }, { newFails: true }]) {
      const up = upgrading(scenario, { backups: earlier });
      expect(up.json?.backup, JSON.stringify(scenario)).toMatch(new RegExp(`/backups/\\d{8}T\\d{6}Z-${OLD.replaceAll(".", "\\.")}\\.sql$`));
      expect(readdirSync(join(up.folder, "backups")).sort(), JSON.stringify(scenario)).toEqual([...Object.keys(earlier), up.json.backup.split("/").at(-1)].sort());
      for (const [name, text] of Object.entries(earlier)) expect(readFileSync(join(up.folder, "backups", name), "utf8")).toBe(text);
    }
  });

  it("with --channel naming this CLI's own version, upgrades itself, downloading its release as plain upgrade does", async () => {
    const made = installation({ migrates: true });
    const channel = isCanary(VERSION) ? "canary" : "alpha";
    const served = mkdtempSync(join(tmpdir(), "ys-cli-served-"));
    roots.push(served);
    const tag = isCanary(VERSION) ? "canary" : `v${VERSION}`;
    cpSync(made.release, join(served, tag), { recursive: true });
    mkdirSync(join(served, channel), { recursive: true });
    const feed = execFileSync(fileURLToPath(new URL("../../deploy/channel-json.sh", import.meta.url)), [channel, VERSION, "69525a9569f68a39b76598af86662a04b6fb2886"], { encoding: "utf8" });
    writeFileSync(join(served, channel, "channel.json"), feed);
    const server = await serveReleases(served);
    try {
      const ran = await spawnAsync(process.execPath, [command, "--workdir", made.folder, "--json", "upgrade", "--channel", channel], { ...made.variables, YS_E2E_RELEASES: server.url });
      const up = outcome(made, ran);
      expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
      expect(up.ran.stdout.trim().split("\n")).toHaveLength(1);
      expect(up.json).toEqual({ ok: true, from: OLD, to: VERSION, backup: expect.stringMatching(/\/backups\/.+\.sql$/) });
      expect(server.requests).toEqual([`/${channel}/channel.json`, `/${tag}/SHA256SUMS`, `/${tag}/your-space.tar.gz`]);
      expect(up.compose.slice(1)).toEqual(["compose stop caddy server", "compose exec -T postgres pg_dump -U yourspace -d yourspace", "compose up -d --wait server", "compose up -d --wait"]);
      expect(stackOf(up.folder)).toContain(`:${VERSION}\n`);
      expect(existsSync(join(up.folder, ".your-space.lock"))).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("counts as done once the new server is ready, so a Caddy that doesn't start isn't rolled back", () => {
    const opened = upgrading({ migrates: true, caddyFails: true });
    expect(opened.ran.status).toBe(2);
    expect(opened.json).toMatchObject({ ok: false, error: "port_in_use", from: OLD, to: VERSION, upgraded: true, rolledBack: false, restored: false });
    expect(opened.json.message).toContain(`Your Space ${VERSION} is installed and its server runs on the updated database, but it didn't open. Fix the problem above, then run your-space start.`);
    expect(stackOf(opened.folder)).toContain(`:${VERSION}\n`);
    expect(opened.compose.slice(-2)).toEqual(["compose up -d --wait server", "compose up -d --wait"]);
    expect(readdirSync(opened.folder).filter((name) => name.startsWith(".upgrade") || name.startsWith(".your-space"))).toEqual([]);
  });

  it("replaces only the release's own files, whatever else its bundle holds", () => {
    const up = upgrading({}, { extra: { ".env": "YS_DOMAIN=elsewhere.example.com\n", "notes.txt": "extra" } });
    expect(up.ran.status, up.ran.stdout).toBe(0);
    expect(readFileSync(join(up.folder, ".env"), "utf8")).toBe(up.env);
    expect(existsSync(join(up.folder, "notes.txt"))).toBe(false);
  });

  it("starts the database alone to back up a stopped installation", () => {
    const up = upgrading({ running: false });
    expect(up.ran.status, up.ran.stdout).toBe(0);
    expect(up.compose.slice(1, 3)).toEqual(["compose up -d --wait postgres", "compose stop caddy server"]);
    expect(up.compose.at(-1)).toBe("compose up -d --wait");
  });

  it("adds a setting the new release requires, and changes none that are set", () => {
    const up = upgrading({}, { env: "YS_PORT=8081\nYS_NEW=mine\n", example: "# YS_PORT=8081\nYS_NEW=default\nYS_REQUIRED=yes\n" });
    expect(up.ran.status, up.ran.stdout).toBe(0);
    expect(readFileSync(join(up.folder, ".env"), "utf8")).toBe("YS_PORT=8081\nYS_NEW=mine\nYS_REQUIRED=yes\n");
  });

  it("puts the previous version back as it was when the new one doesn't start", () => {
    const failed = upgrading({ newFails: true });
    expect(failed.ran.status).toBe(2);
    expect(failed.json).toMatchObject({ ok: false, error: "start_failed", from: OLD, to: VERSION, rolledBack: true, restored: false });
    expect(failed.json.message).toContain(`so Your Space ${OLD} is back and running, with its data as it was; the database backup is at backups/`);
    expect(existsSync(failed.json.backup)).toBe(true);
    expect(stackOf(failed.folder)).toContain(`:${OLD}\n`);
    expect(readFileSync(join(failed.folder, "modes", "mode.yaml"), "utf8")).toBe(`# ${OLD}\n`);
    expect(readFileSync(join(failed.folder, ".env"), "utf8")).toBe(failed.env);
    // The database is the same as the backup, so it isn't restored; the previous version starts again.
    expect(failed.compose.slice(3)).toEqual([
      "compose up -d --wait server",
      "compose logs --no-color --no-log-prefix --tail 60 server",
      "compose stop caddy server",
      "compose up -d --wait postgres",
      "compose exec -T postgres pg_dump -U yourspace -d yourspace",
      "compose up -d --wait",
    ]);
    expect(readdirSync(join(failed.folder, "backups"))).toHaveLength(1);
    expect(readdirSync(failed.folder).filter((name) => name.startsWith(".upgrade"))).toEqual([]);
  });

  it("takes back a setting it added for the new version when it puts the previous one back", () => {
    const failed = upgrading({ newFails: true }, { example: "YS_REQUIRED=yes\n" });
    expect(failed.ran.status).toBe(2);
    expect(readFileSync(join(failed.folder, ".env"), "utf8")).toBe(failed.env);
  });

  it("puts nothing back while the new version can't be stopped, and keeps the previous files", () => {
    const failed = upgrading({ newFails: true, migrates: true, stopFails: true });
    expect(failed.ran.status).toBe(2);
    expect(failed.json).toMatchObject({ error: "start_failed", rolledBack: false, restored: false });
    const previous = readdirSync(failed.folder).find((name) => name.startsWith(".upgrade-") && name !== ".upgrade-restore")!;
    expect(failed.json.message).toContain(`couldn't be stopped (Error response from daemon: cannot stop container), so nothing was put back.`);
    expect(failed.json.message).toContain(`move Your Space ${OLD}'s files back from ${previous}/previous`);
    expect(stackOf(join(failed.folder, previous, "previous"))).toContain(`:${OLD}\n`);
    expect(failed.calls.some((c) => c.args.includes("yourspace_restore"))).toBe(false);
  });

  it("doesn't start the previous version on a database it couldn't check, and says so until someone has", () => {
    const failed = upgrading({ newFails: true, migrates: true, unreadable: true });
    expect(failed.ran.status).toBe(2);
    expect(failed.json).toMatchObject({ rolledBack: true, restored: false });
    expect(failed.json.message).toContain("files are back, but the database couldn't be checked, so whether the new version had already changed it is unknown. Restore backups/");
    expect(failed.json.message).toContain("delete .upgrade-restore, then run your-space start.");
    // start and upgrade refuse until the files and the database are known to agree.
    expect(JSON.parse(readFileSync(join(failed.folder, ".upgrade-restore"), "utf8"))).toEqual({ from: OLD, to: VERSION, backup: failed.json.backup });
    expect(() => refuseWhileRestoreNeeded(failed.folder)).toThrow(expect.objectContaining({ code: "upgrade_interrupted", message: expect.stringContaining(`If stack.yaml then names ${OLD}, restore ${failed.json.backup}`) }));
    expect(stackOf(failed.folder)).toContain(`:${OLD}\n`);
    expect(failed.compose.at(-1)).toBe("compose exec -T postgres pg_dump -U yourspace -d yourspace");
  });

  it("takes its lock with the process ID already in it, and gives it up", () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    const release = lockInstallation(root, "upgrade");
    expect(readFileSync(join(root, ".your-space.lock"), "utf8")).toBe(`${process.pid} upgrade\n`);
    expect(() => lockInstallation(root, "start")).toThrow(
      expect.objectContaining({ code: "installation_busy", fields: { pid: process.pid, command: "upgrade" }, message: expect.stringMatching(/^your-space upgrade is running on this installation/) }),
    );
    release();
    expect(readdirSync(root)).toEqual([]);
    // A lock without a process ID is never taken over.
    writeFileSync(join(root, ".your-space.lock"), "");
    expect(() => lockInstallation(root, "upgrade")).toThrow(expect.objectContaining({ code: "installation_busy", fields: {} }));
    expect(readdirSync(root)).toEqual([".your-space.lock"]);
  });

  it("takes over a lock whose process is gone by replacing it, one takeover at a time", () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
    writeFileSync(join(root, ".your-space.lock"), `${gone}\n`);
    // While another run is taking it over, this one doesn't touch it.
    mkdirSync(join(root, ".your-space.lock.takeover"));
    expect(() => lockInstallation(root, "upgrade")).toThrow(expect.objectContaining({ code: "installation_busy", message: expect.stringContaining("taking over the lock") }));
    expect(readFileSync(join(root, ".your-space.lock"), "utf8")).toBe(`${gone}\n`);
    rmSync(join(root, ".your-space.lock.takeover"), { recursive: true });
    const release = lockInstallation(root, "upgrade");
    expect(readFileSync(join(root, ".your-space.lock"), "utf8")).toBe(`${process.pid} upgrade\n`);
    expect(readdirSync(root)).toEqual([".your-space.lock"]);
    release();
    expect(readdirSync(root)).toEqual([]);
  });

  it("stops at the next step on a signal, and puts nothing in place", () => {
    const stopped = upgrading({ signalled: true });
    expect(stopped.ran.status).toBe(1);
    expect(stopped.json).toMatchObject({ error: "cancelled", message: `Stopped by SIGTERM before Your Space ${VERSION} started.` });
    expect(stackOf(stopped.folder)).toContain(`:${OLD}\n`);
    expect(stopped.compose.at(-1)).toBe("compose up -d --wait");
    expect(readdirSync(stopped.folder).filter((name) => name.startsWith(".upgrade"))).toEqual([]);
  });

  it("refuses to go on from an upgrade that was killed part way, and clears one that left nothing", () => {
    const left = upgrading({}, { leftover: ["compose.yaml"] });
    expect(left.ran.status).toBe(2);
    expect(left.json).toMatchObject({ error: "upgrade_interrupted", folder: join(left.folder, ".upgrade-left") });
    expect(left.json.message).toContain("left the previous version's release files in .upgrade-left/previous");
    expect(left.compose).toEqual([]);
    // Killed between moving the release files out and in: the folder isn't an installation now.
    const halfway = upgrading({}, { leftover: ["compose.yaml"], missing: ["compose.yaml"] });
    expect(halfway.json).toMatchObject({ error: "upgrade_interrupted" });
    const empty = upgrading({}, { leftover: [] });
    expect(empty.ran.status, empty.ran.stdout).toBe(0);
    expect(existsSync(join(empty.folder, ".upgrade-left"))).toBe(false);
  });

  it("keeps start, stop, configure and secrets replace out while an upgrade runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    const folder = join(root, "install");
    mkdirSync(folder);
    releaseFiles(folder, OLD);
    writeFileSync(join(folder, ".env"), "");
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    try {
      writeFileSync(join(folder, ".your-space.lock"), `${other.pid} upgrade\n`);
      for (const args of [["start", "--defer-owner"], ["stop"], ["configure", "--this-machine"], ["secrets", "replace", "auth-secret", "--yes"]]) {
        const ran = spawnSync(process.execPath, [command, "--workdir", folder, "--json", ...args], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
        expect(ran.status, `${args.join(" ")}: ${ran.stdout}`).toBe(2);
        expect(JSON.parse(ran.stdout), args.join(" ")).toMatchObject({ error: "installation_busy", pid: other.pid, command: "upgrade" });
      }
    } finally {
      other.kill();
      await new Promise((resolve) => other.on("exit", resolve));
    }
  });

  it("takes the lock even while an upgrade has moved the release files out", async () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    try {
      writeFileSync(join(root, ".your-space.lock"), `${other.pid} upgrade\n`);
      let ran = false;
      await expect(holdingLock(root, "stop", async () => void (ran = true))).rejects.toMatchObject({ code: "installation_busy", fields: { command: "upgrade" } });
      expect(ran).toBe(false);
    } finally {
      other.kill();
      await new Promise((resolve) => other.on("exit", resolve));
    }
  });

  it("lets exactly one of many runs take over a lock whose process is gone", async () => {
    const lock = fileURLToPath(new URL("../src/installation-lock.ts", import.meta.url));
    // Each run holds what it took until every run has answered, when its input closes.
    const script = `import { lockInstallation } from ${JSON.stringify(lock)};
let release;
try { release = lockInstallation(process.argv[1], "upgrade"); process.stdout.write("got\\n"); }
catch (error) { process.stdout.write((error.code ?? String(error)) + "\\n"); }
process.stdin.resume();
process.stdin.on("end", () => release?.());`;
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
    for (let round = 0; round < 3; round++) {
      const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
      roots.push(root);
      writeFileSync(join(root, ".your-space.lock"), `${gone} upgrade\n`);
      const runs = Array.from({ length: 8 }, () => spawn(process.execPath, ["--input-type=module", "-e", script, root]));
      const said = await Promise.all(
        runs.map((run) => new Promise<string>((resolve) => {
          let out = "";
          run.stdout.on("data", (chunk) => {
            out += chunk;
            if (out.endsWith("\n")) resolve(out.trim());
          });
        })),
      );
      for (const run of runs) run.stdin.end();
      await Promise.all(runs.map((run) => new Promise((resolve) => run.on("close", resolve))));
      expect(said.filter((s) => s === "got"), said.join(",")).toHaveLength(1);
      expect(said.filter((s) => s !== "got").every((s) => s === "installation_busy")).toBe(true);
      expect(readdirSync(root)).toEqual([]);
    }
  });

  it("leaves a run that found the lock stale busy when another took it over first", () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
    writeFileSync(join(root, ".your-space.lock"), `${gone} upgrade\n`);
    // Both runs read the same dead process; the second takes the lock over before the first goes on.
    let second: (() => void) | undefined;
    const first = () =>
      lockInstallation(root, "upgrade", {
        afterStale: () => {
          second = lockInstallation(root, "start");
          expect(readFileSync(join(root, ".your-space.lock"), "utf8")).toBe(`${process.pid} start\n`);
        },
      });
    expect(first).toThrow(expect.objectContaining({ code: "installation_busy", fields: { pid: process.pid, command: "start" } }));
    expect(readFileSync(join(root, ".your-space.lock"), "utf8")).toBe(`${process.pid} start\n`);
    second!();
    expect(readdirSync(root)).toEqual([]);
  });

  it("refuses an upgrade while another command holds the installation, and a command in an installation it can't lock", () => {
    const busy = upgrading({}, { lock: `${process.pid} start` });
    expect(busy.json).toMatchObject({ error: "installation_busy", command: "start" });
    expect(busy.compose).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    const installation = join(root, "install");
    mkdirSync(installation);
    releaseFiles(installation, OLD);
    const stop = (folder: string) => JSON.parse(spawnSync(process.execPath, [command, "--workdir", folder, "--json", "stop"], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } }).stdout);
    chmodSync(root, 0o555);
    chmodSync(installation, 0o555);
    try {
      // A folder this user can't write is refused rather than run without the lock, whether or not
      // its release files are there: an upgrade by its owner may have moved them. Root writes
      // anywhere, so takes the lock instead and gets as far as the folder's own check.
      if (process.getuid?.() === 0) expect(stop(root)).toMatchObject({ error: "not_an_installation" });
      else {
        for (const folder of [installation, root]) {
          expect(stop(folder)).toMatchObject({ error: "permission_denied", message: expect.stringContaining("Run this as the user who owns the installation.") });
        }
      }
    } finally {
      chmodSync(installation, 0o755);
      chmodSync(root, 0o755);
    }
  });

  it("gives up the lock when a command that held it fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "ys-cli-lock-"));
    roots.push(root);
    writeFileSync(join(root, "compose.yaml"), "name: your-space\n");
    await expect(holdingLock(root, "stop", async () => {
      expect(readFileSync(join(root, ".your-space.lock"), "utf8")).toBe(`${process.pid} stop\n`);
      throw new Error("failed");
    })).rejects.toThrow("failed");
    expect(readdirSync(root)).toEqual(["compose.yaml"]);
  });

  it("refuses to run beside another upgrade of the same installation", () => {
    const held = upgrading({}, { lock: process.pid });
    expect(held.ran.status).toBe(2);
    expect(held.json).toMatchObject({ error: "installation_busy", pid: process.pid });
    expect(held.compose).toEqual([]);
    expect(stackOf(held.folder)).toContain(`:${OLD}\n`);
    // A lock whose process is gone was left behind, and is taken over.
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    const stale = upgrading({}, { lock: Number(gone.stdout) });
    expect(stale.ran.status, stale.ran.stdout).toBe(0);
    expect(existsSync(join(stale.folder, ".your-space.lock"))).toBe(false);
  });

  it("restores the backup when the new version changed data without a migration", () => {
    // Say, settings moved into a format the previous version can't read, with the schema as it was.
    const failed = upgrading({ newFails: true, rewrites: true });
    expect(failed.json).toMatchObject({ error: "start_failed", rolledBack: true, restored: true });
    expect(failed.calls.some((c) => c.args.includes("yourspace_restore"))).toBe(true);
  });

  it("restores the backup when the new version had already migrated the database", () => {
    const failed = upgrading({ newFails: true, migrates: true });
    expect(failed.ran.status).toBe(2);
    expect(failed.json).toMatchObject({ error: "start_failed", rolledBack: true, restored: true, keptDatabase: expect.stringMatching(/^yourspace_upgrade_failed_\d{8}t\d{6}z$/) });
    expect(failed.json.message).toContain("with its database restored from the backup taken just before");
    // The database the new version left is kept, so nothing it took in is lost.
    expect(failed.json.message).toContain(`The database as ${VERSION} left it is kept as ${failed.json.keptDatabase}, so nothing it took in is lost.`);
    const restore = failed.calls.filter((c) => c.args.includes("psql")).map((c) => [c.args.slice(7, 9).join(" "), c.input]);
    expect(restore).toEqual([
      ["-d postgres", expect.stringContaining("CREATE DATABASE yourspace_restore OWNER yourspace TEMPLATE template0;")],
      ["-d yourspace_restore", expect.stringContaining("-- the owner: sam")],
      ["-d postgres", expect.stringMatching(new RegExp(`BEGIN;\nALTER DATABASE yourspace RENAME TO ${failed.json.keptDatabase};\nALTER DATABASE yourspace_restore RENAME TO yourspace;\nCOMMIT;\n$`))],
    ]);
    expect(restore.flat().join("\n")).not.toMatch(/DROP DATABASE yourspace(?!_restore)/);
    expect(failed.compose.at(-1)).toBe("compose up -d --wait");
    expect(stackOf(failed.folder)).toContain(`:${OLD}\n`);
  });

  it("changes nothing when the backup fails, and starts Your Space again", () => {
    const failed = upgrading({ dumpFails: true });
    expect(failed.ran.status).toBe(2);
    expect(failed.json).toMatchObject({ error: "backup_failed" });
    expect(failed.json.detail).toContain("pg_dump: error");
    expect(stackOf(failed.folder)).toContain(`:${OLD}\n`);
    expect(existsSync(join(failed.folder, "backups")) ? readdirSync(join(failed.folder, "backups")) : []).toEqual([]);
    expect(failed.compose.at(-1)).toBe("compose up -d --wait");
  });

  it("says so when Your Space doesn't start again after a failed backup", () => {
    const failed = upgrading({ dumpFails: true, oldFails: true });
    expect(failed.ran.status).toBe(2);
    expect(failed.json).toMatchObject({ error: "backup_failed", running: false });
    expect(failed.json.message).toContain(`Nothing was upgraded, but Your Space ${OLD} didn't start again either. See why with: your-space logs`);
  });

  it("stops nothing when the new images can't be downloaded", () => {
    const failed = upgrading({ pullFails: true });
    expect(failed.ran.status).toBe(3);
    expect(failed.json).toMatchObject({ error: "download_failed" });
    expect(failed.compose).toHaveLength(1);
    expect(stackOf(failed.folder)).toContain(`:${OLD}\n`);
  });

  it("asks first, unless --yes or --json answers", () => {
    // Without a terminal the question can't be asked, so it stops, naming --yes, and changes nothing.
    const asked = upgrading({}, { global: [] });
    expect(asked.ran.status).toBe(1);
    expect(asked.ran.stderr).toContain("Answer it with --yes");
    expect(asked.compose).toEqual([]);
    const yes = upgrading({}, { global: ["--yes"] });
    expect(yes.ran.status, yes.ran.stdout + yes.ran.stderr).toBe(0);
    expect(stackOf(yes.folder)).toContain(`:${VERSION}\n`);
  });
});
