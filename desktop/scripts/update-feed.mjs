// Writes latest-mac.yml, the update feed the app's updater (electron-updater) reads from a GitHub
// release, next to the update ZIPs it lists. Each ZIP holds the signed, notarized and stapled app for
// one architecture; the updater picks the one whose name matches the Mac's (arm64, or not arm64).
// Prereleases use the same file name: the updater asks for <channel>-mac.yml, then falls back to it.
//   node desktop/scripts/update-feed.mjs [--channel canary] VERSION DIR ARCH...
// With --channel canary it writes canary-mac.yml instead, the Canary channel's feed on the `canary`
// prerelease, and only for a canary build. latest-mac.yml is the file an Alpha app reads, so it is
// never written for a canary build, whose version contains -alpha. and sorts after the alpha it
// follows (spec 016, the guard).
// It needs only Node, so it runs on the release's macOS runner and in the unit tests alike.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const fail = message => { console.error(message); process.exit(2); };
let channel = "latest";
if (args[0] === "--channel") {
  channel = args[1];
  args.splice(0, 2);
  if (channel !== "canary") fail("Only --channel canary has a feed of its own; an Alpha build writes latest-mac.yml, with no --channel.");
}
const [version, dir, ...arches] = args;
if (!version || !dir || !arches.length) fail("Usage: update-feed.mjs [--channel canary] VERSION DIR ARCH...");
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/.exec(version);
if (!match) fail("Expected a release version, e.g. 0.1.0.");
// A canary build has a `canary` prerelease identifier, as the CLI reads it (cli/src/version.ts).
const canary = match[4]?.split(".").includes("canary") ?? false;
if (canary && channel !== "canary") fail(`${version} is a canary build, so its feed is canary-mac.yml (--channel canary), never latest-mac.yml.`);
if (!canary && channel === "canary") fail(`${version} isn't a canary build, so it doesn't go in canary-mac.yml.`);
const files = arches.map(arch => {
  if (!["arm64", "x64"].includes(arch)) fail(`Unknown architecture ${arch}.`);
  const url = `your-space-macos-${arch}-${version}.zip`;
  const file = join(dir, url);
  let info;
  try { info = lstatSync(file); } catch { info = undefined; }
  if (!info?.isFile()) fail(`Missing ${file}.`);
  const sha512 = createHash("sha512").update(readFileSync(file)).digest("base64");
  return { url, sha512, size: info.size };
});
const lines = [
  `version: '${version}'`,
  "files:",
  ...files.flatMap(({ url, sha512, size }) => [`  - url: ${url}`, `    sha512: '${sha512}'`, `    size: ${size}`]),
  `path: ${files[0].url}`,
  `sha512: '${files[0].sha512}'`,
  `releaseDate: '${new Date().toISOString()}'`,
];
const feed = `${channel}-mac.yml`;
writeFileSync(join(dir, feed), lines.join("\n") + "\n");
console.log(`Wrote ${feed} for ${version} with ${files.length} update ZIPs.`);
