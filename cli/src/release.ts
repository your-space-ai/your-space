// Downloads a release's files, checks them against the release's SHA256SUMS, and unpacks them with
// the system `tar` (research R4).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors.ts";
import { run } from "./process.ts";

const RELEASES = "https://github.com/your-space-ai/your-space/releases/download";
export const TARBALL = "your-space.tar.gz";

/** Where a release's files are. YS_E2E_RELEASES points the browser tests at a local release. */
export function releaseUrl(version: string, file: string): string {
  const base = (process.env.YS_E2E_RELEASES ?? RELEASES).replace(/\/$/, "");
  return `${base}/v${version}/${file}`;
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
    if (releaseDir) {
      const stack = await run("tar", ["-xzOf", path, "stack.yaml"]);
      const pins = Array.from(stack.stdout.matchAll(/\$\{YS_VERSION:-([^}]+)\}/g), (match) => match[1]);
      if (stack.code !== 0 || !pins.length || pins.some((pin) => pin !== version)) {
        throw new CliError("checksum_mismatch", "The bundled installation files belong to a different CLI version.");
      }
    }
    const unpacked = await run("tar", ["-xzf", path, "-C", folder]);
    if (unpacked.code !== 0) throw new CliError("unexpected", `Couldn't unpack ${TARBALL}.`, {}, unpacked.stderr);
  } finally {
    rmSync(path, { force: true });
  }
}
