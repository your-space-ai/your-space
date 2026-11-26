// Writes the Alpha channel's latest-mac.yml from a release's own (spec 016, decision 5):
//   node desktop/scripts/channel-feed.mjs 0.1.0-alpha.2 release/latest-mac.yml alpha/latest-mac.yml
// A release's latest-mac.yml, as update-feed.mjs writes it, names its update ZIPs by file name, which
// electron-updater finds next to the feed. The `alpha` prerelease holds only the feed, so its copy
// names them by their full links into the `v` release, which the updater follows as given. Only
// `url` and `path` change: the version, each ZIP's SHA-512 digest and size, and the release date are
// kept byte for byte. Anything else, such as another version, a canary or a file it doesn't name
// as update-feed.mjs does, is refused, since an Alpha app installs what this file lists.
// It needs only Node, so it runs in Release publish with no npm packages and in the unit tests alike.
import { readFileSync, writeFileSync } from "node:fs";

const downloads = "https://github.com/your-space-ai/your-space/releases/download";
const fail = message => { console.error(message); process.exit(2); };

const [version, source, destination, ...extra] = process.argv.slice(2);
if (!version || !source || !destination || extra.length) fail("Usage: channel-feed.mjs VERSION SOURCE DESTINATION");
// The version pattern update-feed.mjs accepts, and the CLI's rule for a canary: a `canary`
// prerelease identifier.
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/.exec(version);
if (!match) fail(`${version} isn't a release version such as 0.1.0-alpha.2.`);
if (match[4]?.split(".").includes("canary")) fail(`${version} is a canary build, which the Alpha feed never lists.`);

const lines = readFileSync(source, "utf8").split("\n");
if (lines.pop() !== "") fail(`${source} doesn't end with a line break.`);
const base = `${downloads}/v${version}/`;
const digest = "'[A-Za-z0-9+/]{86}=='";
const expected = [
  [new RegExp(`^version: '${version.replaceAll(".", "\\.")}'$`)],
  [/^files:$/],
  ...["arm64", "x64"].flatMap(arch => [
    [new RegExp(`^  - url: your-space-macos-${arch}-${version.replaceAll(".", "\\.")}\\.zip$`), "  - url: "],
    [new RegExp(`^    sha512: ${digest}$`)],
    [/^    size: [1-9]\d*$/],
  ]),
  [new RegExp(`^path: your-space-macos-arm64-${version.replaceAll(".", "\\.")}\\.zip$`), "path: "],
  [new RegExp(`^sha512: ${digest}$`)],
  [/^releaseDate: '\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z'$/],
];
if (lines.length !== expected.length) fail(`${source} has ${lines.length} lines, not the ${expected.length} update-feed.mjs writes for ${version}.`);
const written = lines.map((line, i) => {
  const [pattern, key] = expected[i];
  if (!pattern.test(line)) fail(`Line ${i + 1} of ${source} isn't one update-feed.mjs writes for ${version}: ${line}`);
  return key ? key + base + line.slice(key.length) : line;
});
// The top-level digest is the first ZIP's, as update-feed.mjs writes it.
if (lines[9].slice("sha512: ".length) !== lines[3].slice("    sha512: ".length)) fail(`${source}'s sha512 isn't its first ZIP's.`);

writeFileSync(destination, written.join("\n") + "\n");
console.log(`Wrote ${destination} for ${version}, with its update ZIPs at ${base}.`);
