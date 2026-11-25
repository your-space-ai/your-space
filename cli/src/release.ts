// Downloads a release's files, checks them against the release's SHA256SUMS, and unpacks them with
// the system `tar` (research R4).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors.ts";
import { run } from "./process.ts";
import { isCanary } from "./version.ts";

const RELEASES = "https://github.com/your-space-ai/your-space/releases/download";
/** The one prerelease that holds the newest canary build's files, replaced by each build. */
export const CANARY_TAG = "canary";
export const TARBALL = "your-space.tar.gz";
/**
 * A Your Space image in stack.yaml and the release it runs. No variable can change it (decision
 * 2026-11-23, Alpha scope); files from before name it `${YS_VERSION:-<release>}`, read as the release.
 */
export const RELEASE_IMAGE = /ghcr\.io\/your-space-ai\/your-space-(?:server|web|runtime):(?:\$\{YS_VERSION:-([^}\s]+)\}|([^\s"'$]+))/g;

/** The releases stack.yaml's Your Space images run. */
export function releasePins(stack: string): string[] {
  return Array.from(stack.matchAll(RELEASE_IMAGE), (match) => (match[1] ?? match[2])!);
}

/**
 * Where a release's files are: its own GitHub release, or for a canary build the rolling `canary`
 * prerelease. YS_E2E_RELEASES points the browser tests at a local release.
 */
export function releaseUrl(version: string, file: string): string {
  const base = (process.env.YS_E2E_RELEASES ?? RELEASES).replace(/\/$/, "");
  return `${base}/${isCanary(version) ? CANARY_TAG : `v${version}`}/${file}`;
}

/**
 * Why the files' stack.yaml doesn't run `version`, or null when it does. The canary prerelease
 * only ever holds the newest build, so a CLI from an earlier one finds a later one there.
 */
export function pinProblem(pins: string[], version: string, bundled: boolean): string | null {
  if (pins.length && pins.every((pin) => pin === version)) return null;
  if (bundled) return "The bundled installation files belong to a different CLI version.";
  if (isCanary(version) && pins.length && pins.every((pin) => pin === pins[0] && isCanary(pin))) {
    return `The canary release now holds Your Space ${pins[0]}, not this CLI's ${version}: another canary build was published since. Get the newest canary's your-space command, as "Run the canary build" says (docs/install/canary.md), then run this again. Nothing was unpacked.`;
  }
  return `${TARBALL} doesn't run Your Space ${version}, the CLI's version. Nothing was unpacked.`;
}

async function download(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    throw new CliError("download_failed", `Couldn't download ${url}. Check this machine's internet connection, then run this again.`, {}, String(error));
  }
  if (response.status === 404) {
    throw new CliError("download_failed", `${url} doesn't exist. This CLI's release may not be published yet; try the latest CLI.`);
  }
  if (!response.ok) throw new CliError("download_failed", `Couldn't download ${url}: ${response.status} ${response.statusText}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** `SHA256SUMS`: `<hash>  <file>` per line, as sha256sum writes it. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim());
    if (match) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

export function checkSum(file: string, data: Buffer, sums: Map<string, string>): void {
  const expected = sums.get(file);
  if (!expected) throw new CliError("checksum_mismatch", `The release's checksums don't list ${file}, so it wasn't unpacked.`);
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    throw new CliError("checksum_mismatch", `${file} doesn't match the release's checksum: the download was damaged or changed. Nothing was unpacked; run this again.`);
  }
}

/** Only the release's own files, at the top level: never a path that leaves the folder. */
export function safeEntries(listing: string): boolean {
  const entries = listing.split("\n").map((e) => e.trim()).filter(Boolean);
  return entries.length > 0 && entries.every((e) => !e.startsWith("/") && !e.split("/").includes(".."));
}

/** Downloads and checks the release of `version`, then unpacks it into `folder`. */
export async function fetchRelease(version: string, folder: string, releaseDir?: string): Promise<void> {
  const asset = async (name: string): Promise<Buffer> => {
    if (!releaseDir) return download(releaseUrl(version, name));
    try {
      return readFileSync(join(releaseDir, name));
    } catch {
      throw new CliError("download_failed", "The bundled installation files are missing or unreadable.");
    }
  };
  const sums = parseSums((await asset("SHA256SUMS")).toString("utf8"));
  const tarball = await asset(TARBALL);
  checkSum(TARBALL, tarball, sums);
  const path = join(folder, `.${TARBALL}.${randomBytes(4).toString("hex")}`);
  writeFileSync(path, tarball);
  try {
    const listed = await run("tar", ["-tzf", path]);
    if (listed.code !== 0 || !safeEntries(listed.stdout)) {
      throw new CliError("checksum_mismatch", `${TARBALL} isn't a Your Space release. Nothing was unpacked.`, {}, listed.stderr);
    }
    // The files must run this version: a bundle from elsewhere, or a canary build that has moved on,
    // would pair this CLI with other images.
    const stack = await run("tar", ["-xzOf", path, "stack.yaml"]);
    const problem = pinProblem(stack.code === 0 ? releasePins(stack.stdout) : [], version, releaseDir !== undefined);
    if (problem) throw new CliError("checksum_mismatch", problem);
    // The files belong to whoever unpacks them, never to the build machine's user, even as root.
    const unpacked = await run("tar", ["--no-same-owner", "-xzf", path, "-C", folder]);
    if (unpacked.code !== 0) throw new CliError("unexpected", `Couldn't unpack ${TARBALL}.`, {}, unpacked.stderr);
  } finally {
    rmSync(path, { force: true });
  }
}
