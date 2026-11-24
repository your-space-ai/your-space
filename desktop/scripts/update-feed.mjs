// Writes latest-mac.yml, the update feed the app's updater (electron-updater) reads from a GitHub
// release, next to the update ZIPs it lists. Each ZIP holds the signed, notarized and stapled app for
// one architecture; the updater picks the one whose name matches the Mac's (arm64, or not arm64).
// Prereleases use the same file name: the updater asks for <channel>-mac.yml, then falls back to it.
// It needs only Node, so it runs on the release's macOS runner and in the unit tests alike.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, dir, ...arches] = process.argv.slice(2);
const fail = message => { console.error(message); process.exit(2); };
if (!version || !dir || !arches.length) fail("Usage: update-feed.mjs VERSION DIR ARCH...");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/.test(version)) {
  fail("Expected a release version, e.g. 0.1.0.");
}
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
writeFileSync(join(dir, "latest-mac.yml"), lines.join("\n") + "\n");
console.log(`Wrote latest-mac.yml for ${version} with ${files.length} update ZIPs.`);
