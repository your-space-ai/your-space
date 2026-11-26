// `your-space upgrade --channel alpha|canary` (spec 016, FR-006 to FR-008): it reads the channel's
// channel.json, downloads that build's CLI from its release, checks it against the release's
// SHA256SUMS and that it is the version channel.json names, and runs its `upgrade`. The command
// itself, from src/index.ts, against a stand-in for GitHub's release downloads; the build's CLI is a
// stand-in that records how it was run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseChannel } from "../src/channel.ts";
import { buildCli, refuseBundled } from "../src/commands/upgrade-channel.ts";
import { compareVersions } from "../src/version.ts";
import { serveReleases, spawnAsync, type Served } from "./helpers/releases.ts";

const command = fileURLToPath(new URL("../src/index.ts", import.meta.url));
/** The CLI as the Linux executable runs it (helpers/linux-executable.ts). */
const linuxExecutable = fileURLToPath(new URL("./helpers/linux-executable.ts", import.meta.url));
/** The release file that is the Linux executable for this machine's processor. */
const EXECUTABLE = `your-space-linux-${process.arch}`;
const fixture = (channel: string) => readFileSync(new URL(`../../shared/release-channels/fixtures/${channel}/channel.json`, import.meta.url), "utf8");
/** The recorded feeds: Alpha's names 0.1.0-alpha.2, Canary's a canary built after it. */
const ALPHA = JSON.parse(fixture("alpha")) as { version: string; commit: string };
const CANARY = JSON.parse(fixture("canary")) as { version: string; commit: string };
const OLD = "0.0.0-test.1";

/**
 * The build's CLI, as its npm package's script or as its Linux executable, a script Node runs
 * from the file itself. It records each run's arguments and the folder it was run from, prints
 * `says` for --version, or fails to run, and otherwise prints a result as `upgrade --json` would
 * and exits with FAKE_CLI_EXIT. With FAKE_CLI_WAIT it waits instead, as an upgrade under way
 * does, until SIGINT or SIGTERM stops it: with `bare`, before it has handlers for them, so the
 * signal ends it. FAKE_CLI_KILL ends it with that signal; FAKE_CLI_SILENT prints nothing.
 */
const BUILD_CLI = (build: Build, executable: boolean) => `const fs = require("node:fs");
const path = require("node:path");
const work = ${executable ? "__dirname" : 'path.resolve(__dirname, "..", "..")'};
const record = (args) => fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ args, work, mode: fs.statSync(work).mode & 0o777 }) + "\\n");
if (process.argv[2] === "--version") {
  record(process.argv.slice(2));
  if (${Boolean(build.fails)}) { console.error("SyntaxError: this build needs a newer Node.js"); process.exit(9); }
  console.log(${JSON.stringify(build.says ?? build.version)});
  process.exit(0);
}
if (process.env.FAKE_CLI_WAIT) {
  for (const signal of process.env.FAKE_CLI_WAIT === "bare" ? [] : ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { record(["stopped by", signal]); console.log(JSON.stringify({ ok: false, error: "cancelled", message: "Stopped by " + signal })); process.exit(1); });
  }
  // Never left running if no signal comes.
  setTimeout(() => process.exit(3), 10000);
}
record(process.argv.slice(2));
if (process.env.FAKE_CLI_KILL) process.kill(process.pid, process.env.FAKE_CLI_KILL);
else if (!process.env.FAKE_CLI_WAIT) {
  const status = Number(process.env.FAKE_CLI_EXIT || 0);
  if (!process.env.FAKE_CLI_SILENT) console.log(JSON.stringify(status ? { ok: false, error: "start_failed", message: "didn't start" } : { ok: true, from: ${JSON.stringify(OLD)}, to: ${JSON.stringify(build.version)}, backup: "/backups/x.sql" }));
  process.exitCode = status;
}
`;

const roots: string[] = [];
const servers: Served[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Build {
  version: string;
  /** What its CLI prints for --version; the version by default. */
  says?: string;
  /** Its CLI doesn't run here: --version fails. */
  fails?: boolean;
  /** The Node.js versions its npm package needs. */
  engines?: string;
  /** The version its package.json names; the version by default. */
  packaged?: string;
  /** Changed after SHA256SUMS was written. */
  damaged?: boolean;
  /** SHA256SUMS lists these files' names, with the package's checksum, in place of its CLI's. */
  listed?: string[];
  /** Files left out of the release. */
  missing?: string[];
}

/** The release of a build: its CLI as the npm package and as this processor's Linux executable, and SHA256SUMS, in `served/<tag>/`. */
function release(root: string, served: string, build: Build): void {
  const tag = build.version.includes(".canary.") ? "canary" : `v${build.version}`;
  const folder = join(served, tag);
  mkdirSync(folder, { recursive: true });
  const files = mkdtempSync(join(root, "package-"));
  mkdirSync(join(files, "package", "dist"), { recursive: true });
  writeFileSync(join(files, "package", "package.json"), JSON.stringify({ name: "@your-space-ai/cli", version: build.packaged ?? build.version, engines: { node: build.engines ?? ">=22.12" } }));
  writeFileSync(join(files, "package", "dist", "your-space.cjs"), BUILD_CLI(build, false));
  const asset = `your-space-ai-cli-${build.version}.tgz`;
  execFileSync("tar", ["-czf", join(folder, asset), "-C", files, "package"]);
  writeFileSync(join(folder, EXECUTABLE), `#!/usr/bin/env node\n${BUILD_CLI(build, true)}`, { mode: 0o755 });
  const digest = (name: string) => createHash("sha256").update(readFileSync(join(folder, name))).digest("hex");
  const sums = build.listed ? build.listed.map((name) => `${digest(asset)}  ${name}\n`) : [asset, EXECUTABLE].map((name) => `${digest(name)}  ${name}\n`);
  writeFileSync(join(folder, "SHA256SUMS"), sums.join(""));
  if (build.damaged) for (const name of [asset, EXECUTABLE]) writeFileSync(join(folder, name), "damaged");
  for (const name of build.missing ?? []) rmSync(join(folder, name));
}

interface Upgrading {
  installed?: string;
  feeds?: Record<string, string>;
  builds?: Build[];
  global?: string[];
  args?: string[];
  exit?: number;
  /** Sent to the command once the build's upgrade is under way, or once it asks for `hold`. */
  signal?: NodeJS.Signals;
  /** A release download the stand-in doesn't answer. */
  hold?: string;
  /** Run as the Linux executable, which downloads the build's Linux executable. */
  executable?: boolean;
  /** More of the build's CLI's FAKE_CLI_ settings. */
  fake?: Record<string, string>;
}

/** An installation of `installed`, the stand-in serving `feeds` and `builds`, then `your-space ... upgrade --channel <channel>` in it. */
async function upgrading(channel: string, options: Upgrading = {}) {
  const root = mkdtempSync(join(tmpdir(), "ys-cli-channel-"));
  roots.push(root);
  const folder = join(root, "install"), served = join(root, "served"), bin = join(root, "bin"), temp = join(root, "tmp");
  for (const path of [folder, served, bin, temp]) mkdirSync(path, { recursive: true });
  mkdirSync(join(folder, "modes"));
  writeFileSync(join(folder, "compose.yaml"), "name: your-space\n");
  writeFileSync(join(folder, "stack.yaml"), `image: ghcr.io/your-space-ai/your-space-server:${options.installed ?? OLD}\n`);
  writeFileSync(join(folder, "env.example"), "# YS_PORT=8081\n");
  writeFileSync(join(folder, ".env"), "YS_PORT=8081\n", { mode: 0o600 });
  for (const [name, text] of Object.entries(options.feeds ?? { alpha: fixture("alpha"), canary: fixture("canary") })) {
    mkdirSync(join(served, name), { recursive: true });
    writeFileSync(join(served, name, "channel.json"), text);
  }
  for (const build of options.builds ?? [{ version: ALPHA.version }, { version: CANARY.version }]) release(root, served, build);
  // Nothing here runs Docker: the build's own upgrade does.
  writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$@" >> ${join(root, "docker.log")}\nexit 1\n`, { mode: 0o700 });
  // The Node.js the Linux executable stand-in runs with.
  symlinkSync(process.execPath, join(bin, "node"));
  const before = readdirSync(folder).sort();
  const server = await serveReleases(served, options.hold ? [options.hold] : []);
  servers.push(server);
  const log = join(root, "cli.log");
  const { DOCKER_CONTEXT: _context, COMPOSE_PROJECT_NAME: _project, ...rest } = process.env;
  const global = options.global ?? ["--json"];
  const args = options.executable ? [linuxExecutable, folder, channel, ...global] : [command, "--workdir", folder, ...global, "upgrade", "--channel", channel, ...(options.args ?? [])];
  const ran = await spawnAsync(process.execPath, args, {
    ...rest,
    PATH: `${bin}:${process.env.PATH}`,
    YS_E2E_RELEASES: server.url,
    TMPDIR: temp,
    FAKE_CLI_LOG: log,
    FAKE_CLI_EXIT: String(options.exit ?? 0),
    ...(options.signal && !options.hold ? { FAKE_CLI_WAIT: "1" } : {}),
    ...options.fake,
  }, (child) => {
    // Once the build's upgrade is under way, or the download is, the signal goes to this command, as Ctrl-C or a kill would.
    if (!options.signal) return;
    const hold = options.hold;
    const waiting = setInterval(() => {
      if (hold ? server.requests.includes(hold) : existsSync(log) && readFileSync(log, "utf8").includes('"upgrade"')) {
        clearInterval(waiting);
        child.kill(options.signal);
      }
    }, 20);
    child.on("close", () => clearInterval(waiting));
  });
  let json;
  try {
    json = JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    json = undefined;
  }
  const runs = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; work: string; mode: number }) : [];
  return {
    ran,
    json,
    folder,
    requests: server.requests,
    runs,
    /** The build's CLI's runs other than --version. */
    upgrades: runs.filter((r) => r.args[0] !== "--version").map((r) => r.args),
    docker: existsSync(join(root, "docker.log")) ? readFileSync(join(root, "docker.log"), "utf8") : "",
    /** Nothing in the installation's folder changed, and nothing asked Docker. */
    unchanged: () => {
      expect(readdirSync(folder).sort()).toEqual(before);
      expect(existsSync(join(root, "docker.log"))).toBe(false);
    },
    /** The temporary folders the run made, all of which it removed. */
    temp: () => readdirSync(temp),
  };
}

describe("upgrade --channel", () => {
  it("takes the version the alpha release's channel.json names, and runs that build's own CLI from its release", async () => {
    // The recorded fixture: Alpha names the release, Canary a canary that sorts after it.
    expect(compareVersions(CANARY.version, ALPHA.version)).toBeGreaterThan(0);
    const up = await upgrading("alpha");
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    // Its one JSON object is the build's upgrade's.
    expect(up.ran.stdout.trim().split("\n")).toHaveLength(1);
    expect(up.json).toEqual({ ok: true, from: OLD, to: ALPHA.version, backup: "/backups/x.sql" });
    expect(up.requests).toEqual(["/alpha/channel.json", `/v${ALPHA.version}/SHA256SUMS`, `/v${ALPHA.version}/your-space-ai-cli-${ALPHA.version}.tgz`]);
    // The owner's check, then the build's upgrade, from an owner-only folder that is gone afterwards.
    expect(up.runs.map((r) => r.args)).toEqual([["--version"], ["upgrade", "--workdir", up.folder, "--json"]]);
    for (const r of up.runs) {
      expect(r.mode).toBe(0o700);
      expect(existsSync(r.work)).toBe(false);
    }
    expect(up.temp()).toEqual([]);
    expect(up.docker).toBe("");
  });

  it("takes the canary the canary release's channel.json names, from the canary prerelease", async () => {
    const up = await upgrading("canary");
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.json).toEqual({ ok: true, from: OLD, to: CANARY.version, backup: "/backups/x.sql" });
    expect(up.requests).toEqual(["/canary/channel.json", "/canary/SHA256SUMS", `/canary/your-space-ai-cli-${CANARY.version}.tgz`]);
    expect(up.upgrades).toEqual([["upgrade", "--workdir", up.folder, "--json"]]);
  });

  it("on the Linux executable, downloads the build's Linux executable and runs it directly", async () => {
    const up = await upgrading("canary", { executable: true });
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.ran.stdout.trim().split("\n")).toHaveLength(1);
    expect(up.json).toEqual({ ok: true, from: OLD, to: CANARY.version, backup: "/backups/x.sql" });
    expect(up.requests).toEqual(["/canary/channel.json", "/canary/SHA256SUMS", `/canary/${EXECUTABLE}`]);
    expect(up.runs.map((r) => r.args)).toEqual([["--version"], ["upgrade", "--workdir", up.folder, "--json"]]);
    for (const r of up.runs) {
      expect(r.mode).toBe(0o700);
      expect(existsSync(r.work)).toBe(false);
    }
    expect(up.temp()).toEqual([]);
  });

  it("passes on --yes and --verbose, and ends with the build's upgrade's exit status", async () => {
    const up = await upgrading("alpha", { global: ["--yes", "--verbose"], exit: 2 });
    expect(up.ran.status).toBe(2);
    expect(up.upgrades).toEqual([["upgrade", "--workdir", up.folder, "--yes", "--verbose"]]);
    expect(up.temp()).toEqual([]);
    // A status this CLI doesn't know, as a later CLI's might be, is passed on too, after the build's one JSON object.
    const later = await upgrading("alpha", { exit: 5 });
    expect(later.ran.status).toBe(5);
    expect(later.ran.stdout.trim().split("\n")).toHaveLength(1);
    expect(later.json).toEqual({ ok: false, error: "start_failed", message: "didn't start" });
  });

  it("passes SIGINT and SIGTERM on to the build's upgrade, waits for its result, then removes the download", async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const up = await upgrading("alpha", { signal });
      expect(up.ran.status, signal).toBe(1);
      expect(up.ran.stdout.trim().split("\n"), signal).toHaveLength(1);
      expect(up.json, signal).toEqual({ ok: false, error: "cancelled", message: `Stopped by ${signal}` });
      expect(up.runs.map((r) => r.args), signal).toEqual([["--version"], ["upgrade", "--workdir", up.folder, "--json"], ["stopped by", signal]]);
      expect(up.temp(), signal).toEqual([]);
    }
  });

  it("says the build's upgrade gave no result when a signal ends it, or with --json it prints nothing", async () => {
    const versions = { channel: "alpha", from: OLD, to: ALPHA.version };
    const see = "before it gave a result. See where it left the installation with: your-space status";
    // SIGINT or SIGTERM before the build's upgrade has its handlers for them.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const up = await upgrading("alpha", { signal, fake: { FAKE_CLI_WAIT: "bare" } });
      expect(up.ran.status, signal).toBe(1);
      expect(up.ran.stdout.trim().split("\n"), signal).toHaveLength(1);
      expect(up.json, signal).toEqual({ ok: false, error: "cancelled", ...versions, message: `Your Space ${ALPHA.version}'s upgrade was stopped by ${signal} ${see}` });
      expect(up.temp(), signal).toEqual([]);
    }
    const killed = await upgrading("alpha", { fake: { FAKE_CLI_KILL: "SIGKILL" } });
    expect(killed.ran.status).toBe(4);
    expect(killed.json).toEqual({ ok: false, error: "unexpected", ...versions, message: `Your Space ${ALPHA.version}'s upgrade was stopped by SIGKILL ${see}` });
    const silent = await upgrading("alpha", { fake: { FAKE_CLI_SILENT: "1" } });
    expect(silent.ran.status).toBe(4);
    expect(silent.json).toEqual({ ok: false, error: "unexpected", ...versions, message: `Your Space ${ALPHA.version}'s upgrade ended with exit status 0 ${see}` });
    // Without --json, the build's own output is its result, unless a signal ended it.
    const told = await upgrading("alpha", { global: ["--yes"], fake: { FAKE_CLI_KILL: "SIGKILL" } });
    expect(told.ran.status).toBe(4);
    expect(told.ran.stderr).toContain(`Your Space ${ALPHA.version}'s upgrade was stopped by SIGKILL ${see}`);
    expect((await upgrading("alpha", { global: ["--yes"], fake: { FAKE_CLI_SILENT: "1" } })).ran.status).toBe(0);
  });

  it("stops with nothing changed on SIGINT or SIGTERM while it downloads the build's CLI, and removes the download", async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const up = await upgrading("alpha", { signal, hold: `/v${ALPHA.version}/your-space-ai-cli-${ALPHA.version}.tgz` });
      expect(up.ran.status, signal).toBe(1);
      expect(up.json, signal).toEqual({ ok: false, error: "cancelled", channel: "alpha", message: `Stopped by ${signal} before Your Space ${ALPHA.version}'s upgrade started. Nothing was changed.` });
      expect(up.runs, signal).toEqual([]);
      expect(up.temp(), signal).toEqual([]);
      up.unchanged();
    }
  });

  it("changes nothing when the installation is already the channel's build", async () => {
    const up = await upgrading("alpha", { installed: ALPHA.version });
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.json).toEqual({ ok: true, channel: "alpha", newest: ALPHA.version, from: ALPHA.version, to: ALPHA.version, upToDate: true });
    expect(up.requests).toEqual(["/alpha/channel.json"]);
    expect(up.runs).toEqual([]);
    expect(up.docker).toBe("");
    up.unchanged();
  });

  it("leaving Canary waits for the next alpha: Alpha has nothing newer than a canary after its release, and nothing changes", async () => {
    const up = await upgrading("alpha", { installed: CANARY.version });
    expect(up.ran.status, up.ran.stdout + up.ran.stderr).toBe(0);
    expect(up.json).toEqual({ ok: true, channel: "alpha", newest: ALPHA.version, from: CANARY.version, to: CANARY.version, upToDate: true });
    expect(up.requests).toEqual(["/alpha/channel.json"]);
    expect(up.runs).toEqual([]);
    up.unchanged();
    const told = await upgrading("alpha", { installed: CANARY.version, global: [] });
    expect(told.ran.stdout).toContain(`Nothing on the Alpha channel is newer than this installation's Your Space ${CANARY.version}: the channel's newest build is ${ALPHA.version}. Nothing was changed. It moves to Alpha with the first alpha newer than it.`);
  });

  it("never moves an installation back: an older canary on Canary changes nothing", async () => {
    const newer = "0.1.0-alpha.2.canary.20261202.61";
    const up = await upgrading("canary", { installed: newer });
    expect(up.json).toMatchObject({ ok: true, channel: "canary", newest: CANARY.version, from: newer, to: newer, upToDate: true });
    expect(up.runs).toEqual([]);
    up.unchanged();
  });

  it("refuses a channel.json that isn't the channel's, before it downloads anything", async () => {
    const commit = ALPHA.commit;
    const feeds: [string, string, string][] = [
      // An Alpha client never gets a canary, and Canary names only one.
      ["alpha", JSON.stringify({ channel: "alpha", version: CANARY.version, commit }), "a canary build, which Alpha never does"],
      ["canary", JSON.stringify({ channel: "canary", version: ALPHA.version, commit }), "which isn't a canary build"],
      ["alpha", fixture("canary"), 'names another channel ("canary")'],
      ["alpha", JSON.stringify({ channel: "alpha", version: "latest", commit }), "doesn't name a version"],
      ["alpha", JSON.stringify({ channel: "alpha", version: ALPHA.version, commit: commit.slice(0, 7) }), "doesn't name the full commit"],
      ["alpha", JSON.stringify([ALPHA.version]), "isn't a channel's feed"],
      ["alpha", "<html>", "isn't JSON"],
    ];
    for (const [channel, text, why] of feeds) {
      const up = await upgrading(channel, { feeds: { [channel]: text } });
      expect(up.ran.status, text).toBe(2);
      expect(up.json, text).toMatchObject({ ok: false, error: "checksum_mismatch", channel });
      expect(up.json.message, text).toContain(why);
      expect(up.json.message, text).toContain("Nothing was changed");
      expect(up.requests, text).toEqual([`/${channel}/channel.json`]);
      expect(up.runs, text).toEqual([]);
      up.unchanged();
    }
  });

  it("stops with nothing changed when the channel has no feed", async () => {
    const up = await upgrading("canary", { feeds: {} });
    expect(up.ran.status).toBe(3);
    expect(up.json).toMatchObject({ ok: false, error: "download_failed", channel: "canary" });
    expect(up.json.message).toContain("/canary/channel.json, isn't there. Nothing was changed; run this again later.");
    up.unchanged();
  });

  it("runs nothing whose --version isn't the version channel.json names, as when a newer canary replaced the prerelease's files", async () => {
    const newer = "0.1.0-alpha.2.canary.20261202.61";
    // The Linux executable's name has no version, so only this check finds a newer canary's.
    for (const executable of [true, false]) {
      const up = await upgrading("canary", { executable, builds: [{ version: CANARY.version, says: newer }] });
      expect(up.ran.status, String(executable)).toBe(2);
      expect(up.json, String(executable)).toMatchObject({ ok: false, error: "checksum_mismatch", channel: "canary" });
      expect(up.json.message, String(executable)).toBe(
        `The CLI downloaded for Your Space ${CANARY.version}, the Canary channel's newest build, says it is ${newer}, as when a newer canary build replaces the canary prerelease's files while this runs. Nothing was changed; run this again.`,
      );
      expect(up.requests.at(-1), String(executable)).toBe(`/canary/${executable ? EXECUTABLE : `your-space-ai-cli-${CANARY.version}.tgz`}`);
      expect(up.runs.map((r) => r.args), String(executable)).toEqual([["--version"]]);
      expect(up.temp(), String(executable)).toEqual([]);
      up.unchanged();
    }
  });

  it("says a build's CLI that doesn't run here, with what it printed, and runs nothing", async () => {
    const up = await upgrading("alpha", { builds: [{ version: ALPHA.version, fails: true, engines: ">=99" }] });
    expect(up.ran.status).toBe(4);
    expect(up.json).toEqual({
      ok: false,
      error: "unexpected",
      channel: "alpha",
      message: `Your Space ${ALPHA.version}'s CLI, which matches its release's SHA256SUMS, didn't run here: its --version ended with exit status 9. It needs Node.js >=99, and this is Node.js ${process.versions.node}. Nothing was changed.`,
      detail: "SyntaxError: this build needs a newer Node.js",
    });
    expect(up.upgrades).toEqual([]);
    expect(up.temp()).toEqual([]);
    up.unchanged();
  });

  it("runs nothing from an npm package of another version", async () => {
    const up = await upgrading("alpha", { builds: [{ version: ALPHA.version, packaged: "0.1.0-alpha.3" }] });
    expect(up.json).toMatchObject({ ok: false, error: "checksum_mismatch" });
    expect(up.json.message).toContain(`isn't the npm package of Your Space ${ALPHA.version}'s CLI`);
    expect(up.runs).toEqual([]);
    expect(up.temp()).toEqual([]);
    up.unchanged();
  });

  it("runs nothing that doesn't match the release's SHA256SUMS", async () => {
    const damaged = await upgrading("alpha", { builds: [{ version: ALPHA.version, damaged: true }] });
    expect(damaged.ran.status).toBe(2);
    expect(damaged.json).toMatchObject({ ok: false, error: "checksum_mismatch" });
    expect(damaged.json.message).toBe(
      `your-space-ai-cli-${ALPHA.version}.tgz doesn't match the v${ALPHA.version} release's SHA256SUMS: the download was damaged or changed. Nothing was changed; run this again.`,
    );
    expect(damaged.runs).toEqual([]);
    damaged.unchanged();
    // A newer canary's SHA256SUMS, uploaded while this ran, lists the newer build's package.
    const replaced = await upgrading("canary", { builds: [{ version: CANARY.version, listed: ["your-space-ai-cli-0.1.0-alpha.2.canary.20261202.61.tgz"] }] });
    expect(replaced.json).toMatchObject({ ok: false, error: "checksum_mismatch" });
    expect(replaced.json.message).toBe(
      `The canary release's SHA256SUMS doesn't list your-space-ai-cli-${CANARY.version}.tgz, as when a newer canary build replaces the canary prerelease's files while this runs. Nothing was changed; run this again.`,
    );
    // Found before the package's download.
    expect(replaced.requests).toEqual(["/canary/channel.json", "/canary/SHA256SUMS"]);
    expect(replaced.runs).toEqual([]);
    replaced.unchanged();
  });

  it("stops with nothing changed when the build's files are missing", async () => {
    for (const missing of ["SHA256SUMS", `your-space-ai-cli-${CANARY.version}.tgz`]) {
      const up = await upgrading("canary", { builds: [{ version: CANARY.version, missing: [missing] }] });
      expect(up.ran.status, missing).toBe(3);
      expect(up.json, missing).toMatchObject({ ok: false, error: "download_failed" });
      expect(up.json.message, missing).toContain(`/canary/${missing} isn't there, as when a newer canary build replaces the canary prerelease's files while this runs. Nothing was changed; run this again.`);
      expect(up.runs, missing).toEqual([]);
      expect(up.temp(), missing).toEqual([]);
      up.unchanged();
    }
  });

  it("is refused with --release-dir and for a channel that isn't one", async () => {
    const both = await upgrading("alpha", { args: ["--release-dir", "/tmp"] });
    expect(both.ran.status).toBe(1);
    expect(both.json).toMatchObject({ ok: false, error: "usage" });
    const beta = await upgrading("beta");
    expect(beta.ran.status).toBe(1);
    expect(beta.json.message).toContain("Allowed choices are alpha, canary");
    expect([...both.requests, ...beta.requests]).toEqual([]);
  });

  it("refuses an installation it can't read the version of, before reading the channel", async () => {
    const up = await upgrading("alpha", { installed: "${YS_VERSION}" });
    expect(up.json).toMatchObject({ ok: false, error: "version_unknown" });
    expect(up.requests).toEqual([]);
  });
});

describe("the build's CLI", () => {
  it("is the one like the running CLI: the Linux executable for its processor, or the npm package", () => {
    expect(buildCli("0.1.0-alpha.2", { sea: true, platform: "linux", arch: "arm64" })).toEqual({ kind: "standalone", asset: "your-space-linux-arm64" });
    expect(buildCli("0.1.0-alpha.2", { sea: true, platform: "linux", arch: "x64" })).toEqual({ kind: "standalone", asset: "your-space-linux-x64" });
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(buildCli(CANARY.version, { sea: false, platform, arch: "arm64" })).toEqual({ kind: "npm", asset: `your-space-ai-cli-${CANARY.version}.tgz` });
    }
    expect(() => buildCli("0.1.0-alpha.2", { sea: true, platform: "linux", arch: "riscv64" })).toThrow(expect.objectContaining({ code: "usage" }));
  });

  it("isn't downloaded for the Mac app's own CLI, which moves its workspace with the app", () => {
    for (const arch of ["arm64", "x64"]) {
      expect(() => refuseBundled({ sea: true, platform: "darwin", arch })).toThrow(expect.objectContaining({ code: "usage", message: expect.stringContaining("inside the Mac app") }));
    }
    expect(() => refuseBundled({ sea: false, platform: "darwin", arch: "arm64" })).not.toThrow();
    expect(() => refuseBundled({ sea: true, platform: "linux", arch: "x64" })).not.toThrow();
  });
});

describe("channel.json", () => {
  it("is read in the form deploy/channel-json.sh writes, from the recorded fixtures", () => {
    expect(parseChannel(fixture("alpha"), "alpha")).toEqual({ channel: "alpha", ...ALPHA });
    expect(parseChannel(fixture("canary"), "canary")).toEqual({ channel: "canary", ...CANARY });
    // A later field doesn't stop an older CLI.
    expect(parseChannel(JSON.stringify({ channel: "alpha", version: ALPHA.version, commit: ALPHA.commit, notes: "x" }), "alpha").version).toBe(ALPHA.version);
  });
});
