// `your-space upgrade --channel <name>`: moves an installation to the newest build of a release
// channel, the one its channel.json names, by running that build's own CLI's `upgrade`, so the
// 2026-11-24 rule holds: an installation moves to the version of the CLI that runs `upgrade`, and
// each version's own upgrade steps run (spec 016, decision 6; contracts/cli-commands.md). It stores
// nothing: the version stack.yaml pins stays the one record of what is installed.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isSea } from "node:sea";
import { CHANNEL_NAMES, readChannel, type Channel, type ChannelBuild } from "../channel.ts";
import { CliError, EXIT } from "../errors.ts";
import { holdingLock } from "../installation-lock.ts";
import { Installation } from "../installation.ts";
import { run } from "../process.ts";
import { parseSums, releaseTag, releaseUrl } from "../release.ts";
import type { Ui } from "../ui.ts";
import { compareVersions, VERSION } from "../version.ts";
import { checkInterrupted, installedVersion, upgradeInstallation } from "./upgrade.ts";

/** The running CLI, as far as choosing the build's CLI goes. */
export interface RunningCli {
  /** A standalone executable (Node's single-executable application), not the npm package run by Node. */
  sea: boolean;
  platform: NodeJS.Platform;
  arch: string;
}

/** Which of a build's release files is its CLI for this machine. */
export interface BuildCli {
  /** The release file. */
  asset: string;
  /** `standalone`: the file is the executable. `npm`: the npm package, whose dist/your-space.cjs Node runs. */
  kind: "standalone" | "npm";
}

export function runningCli(): RunningCli {
  return { sea: isSea(), platform: process.platform, arch: process.arch };
}

/**
 * Refuses the CLI inside the Mac app, a standalone executable for macOS: the app moves its own local
 * workspace to its own version when it updates, following the app's channel (FR-009), and no
 * build has a standalone macOS CLI to download.
 */
export function refuseBundled(running: RunningCli): void {
  if (!running.sea || running.platform === "linux") return;
  if (running.platform === "darwin") {
    throw new CliError(
      "usage",
      "This is the your-space command inside the Mac app, which doesn't take --channel: the app moves its own local workspace to the app's version when it updates. To move another installation to a channel's newest build, run upgrade --channel with the your-space command from npm.",
    );
  }
  throw new CliError("usage", `There is no standalone your-space command for ${running.platform} to download. Run upgrade --channel with the your-space command from npm.`);
}

/** The build's CLI like the running one: the Linux executable for its processor, or the npm package. */
export function buildCli(version: string, running: RunningCli): BuildCli {
  refuseBundled(running);
  if (!running.sea) return { kind: "npm", asset: `your-space-ai-cli-${version}.tgz` };
  if (running.arch !== "x64" && running.arch !== "arm64") {
    throw new CliError("usage", `There is no standalone your-space command for Linux ${running.arch}. Run upgrade --channel with the your-space command from npm.`);
  }
  return { kind: "standalone", asset: `your-space-linux-${running.arch}` };
}

/** What a run of upgrade --channel that changes nothing says, for a canary that a newer build can replace part way. */
function runAgain(build: ChannelBuild): string {
  return build.channel === "canary" ? ", as when a newer canary build replaces the canary prerelease's files while this runs" : "";
}

/** Downloads one of the build's release files; a file that isn't there stops the run with nothing changed. */
async function download(build: ChannelBuild, file: string): Promise<Buffer> {
  const url = releaseUrl(build.version, file);
  let response: Response;
  let data: ArrayBuffer;
  try {
    response = await fetch(url, { redirect: "follow" });
    data = await response.arrayBuffer();
  } catch (error) {
    throw new CliError("download_failed", `Couldn't download ${url}. Check this machine's internet connection, then run this again. Nothing was changed.`, {}, String(error));
  }
  if (!response.ok) {
    const why = response.status === 404 ? "isn't there" : `answered ${response.status} ${response.statusText}`;
    throw new CliError("download_failed", `${url} ${why}${runAgain(build)}. Nothing was changed; run this again.`);
  }
  return Buffer.from(data);
}

/** The command that runs the build's CLI: the executable itself, or Node with the package's script. */
interface Program {
  command: string;
  args: string[];
}

/**
 * Downloads the build's CLI into `work`, checked against the SHA256SUMS of the build's release, and,
 * for the npm package, that the package is the build's version.
 */
async function fetchCli(build: ChannelBuild, cli: BuildCli, work: string): Promise<Program> {
  const release = releaseTag(build.version);
  const sums = parseSums((await download(build, "SHA256SUMS")).toString("utf8"));
  const data = await download(build, cli.asset);
  const expected = sums.get(cli.asset);
  if (!expected) {
    throw new CliError("checksum_mismatch", `The ${release} release's SHA256SUMS doesn't list ${cli.asset}${runAgain(build)}. Nothing was changed; run this again.`);
  }
  if (createHash("sha256").update(data).digest("hex") !== expected) {
    throw new CliError(
      "checksum_mismatch",
      `${cli.asset} doesn't match the ${release} release's SHA256SUMS: the download was damaged or changed${runAgain(build)}. Nothing was changed; run this again.`,
    );
  }
  if (cli.kind === "standalone") {
    const path = join(work, "your-space");
    writeFileSync(path, data, { mode: 0o700 });
    return { command: path, args: [] };
  }
  const tarball = join(work, cli.asset);
  writeFileSync(tarball, data, { mode: 0o600 });
  const script = "package/dist/your-space.cjs";
  const unpacked = await run("tar", ["--no-same-owner", "-xzf", tarball, "-C", work, "package/package.json", script]);
  const notPackage = () => new CliError("checksum_mismatch", `${cli.asset} isn't the npm package of Your Space ${build.version}'s CLI. Nothing was changed.`, {}, unpacked.stderr || undefined);
  if (unpacked.code !== 0) throw notPackage();
  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(readFileSync(join(work, "package", "package.json"), "utf8")) as typeof manifest;
  } catch {
    throw notPackage();
  }
  if (manifest.name !== "@your-space-ai/cli" || manifest.version !== build.version) throw notPackage();
  return { command: process.execPath, args: [join(work, script)] };
}

/** The owner's check: the downloaded CLI itself says it is the version channel.json names. */
async function checkVersion(build: ChannelBuild, program: Program, work: string): Promise<void> {
  let said: string;
  try {
    const ran = await run(program.command, [...program.args, "--version"]);
    said = ran.code === 0 ? ran.stdout.trim() : `nothing it could print (exit status ${ran.code})`;
  } catch (error) {
    throw new CliError(
      "permission_denied",
      `Couldn't run Your Space ${build.version}'s CLI from ${work}. If that folder doesn't allow running programs, set TMPDIR to one that does, then run this again. Nothing was changed.`,
      {},
      String(error),
    );
  }
  if (said !== build.version) {
    throw new CliError(
      "checksum_mismatch",
      `The CLI downloaded for Your Space ${build.version}, the ${CHANNEL_NAMES[build.channel]} channel's newest build, says it is ${said}${runAgain(build)}. Nothing was changed; run this again.`,
      { channel: build.channel },
    );
  }
}

export async function upgradeChannel(ui: Ui, workdir: string, channel: Channel): Promise<void> {
  ui.intro("Your Space");
  const running = runningCli();
  refuseBundled(running);
  const name = CHANNEL_NAMES[channel];
  // Read with the installation's lock held, so an upgrade running now, or one that stopped part
  // way, is reported as `upgrade` reports it. Given up before the build's upgrade takes it.
  const from = await holdingLock(workdir, "upgrade", async () => {
    const folder = resolve(workdir);
    if (existsSync(folder)) checkInterrupted(folder);
    return installedVersion(Installation.open(folder));
  });
  const build = await ui.step(`Reading the ${name} channel`, `Read the ${name} channel`, () => readChannel(channel));
  const order = compareVersions(from, build.version);
  const unchanged = { channel, newest: build.version, from, to: from, upToDate: true };
  if (order === 0) {
    ui.result(unchanged, () => ui.outro(`Your Space is already ${from}, the ${name} channel's newest build. Nothing was changed.`));
    return;
  }
  if (order > 0) {
    // Leaving Canary waits for the first alpha newer than the installation (decision 7).
    const waits = channel === "alpha" ? " It moves to Alpha with the first alpha newer than it." : "";
    ui.result(unchanged, () =>
      ui.outro(`Nothing on the ${name} channel is newer than this installation's Your Space ${from}: the channel's newest build is ${build.version}. Nothing was changed.${waits}`),
    );
    return;
  }
  if (build.version === VERSION) {
    await upgradeInstallation(ui, workdir, {});
    return;
  }

  const cli = buildCli(build.version, running);
  // Owner-only, and removed whatever happens.
  const work = mkdtempSync(join(tmpdir(), "your-space-channel-"));
  try {
    const program = await ui.step(`Downloading Your Space ${build.version}'s CLI`, `Checked Your Space ${build.version}'s CLI`, async () => {
      const program = await fetchCli(build, cli, work);
      await checkVersion(build, program, work);
      return program;
    });
    ui.outro(`Upgrading to Your Space ${build.version} with its own CLI`);
    const args = ["upgrade", "--workdir", resolve(workdir), ...(ui.yes ? ["--yes"] : []), ...(ui.json ? ["--json"] : []), ...(ui.verbose ? ["--verbose"] : [])];
    // Its output is the command's: with --json, its one JSON object. Ctrl-C reaches it, and this
    // process waits while it stops at its next step and puts the previous version back.
    const ran = await run(program.command, [...program.args, ...args], { inherit: true, forwardSignals: true });
    if (!Object.values(EXIT).includes(ran.code as (typeof EXIT)[keyof typeof EXIT])) {
      throw new CliError(
        "unexpected",
        `Your Space ${build.version}'s upgrade stopped without a result (exit status ${ran.code}). See where it left the installation with: your-space status`,
        { channel, from, to: build.version },
      );
    }
    process.exitCode = ran.code;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
