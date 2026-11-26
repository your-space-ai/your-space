// The Mac feed files of the two channels (spec 016, decision 5): update-feed.mjs writes a release's
// latest-mac.yml and, with --channel canary, a canary's canary-mac.yml; channel-feed.mjs makes the
// Alpha channel's latest-mac.yml from a release's own. And the fixtures the guard's test reads, in
// the format of the files GitHub serves, are the files these scripts write.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareVersions, isCanary } from "../../cli/src/version.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = join(root, "shared/release-channels/fixtures");
const fixture = path => readFileSync(join(fixtures, path), "utf8");
const node = (script, args) => spawnSync(process.execPath, [join(root, "desktop/scripts", script), ...args], { encoding: "utf8" });
const canary = "0.1.0-alpha.2.canary.20261201.60";
const downloads = "https://github.com/your-space-ai/your-space/releases/download";

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), "ys-channel-feeds-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** A folder with the two update ZIPs of a version, as the fixtures' digests were made from. */
function zips(t, version) {
  const dir = folder(t);
  for (const arch of ["arm64", "x64"]) writeFileSync(join(dir, `your-space-macos-${arch}-${version}.zip`), arch + version);
  return dir;
}
const withoutDate = feed => feed.replace(/^releaseDate: .*$/m, "releaseDate:");

test("update-feed.mjs never writes latest-mac.yml for a canary build, and writes canary-mac.yml only for one", t => {
  const dir = zips(t, canary);
  const refused = node("update-feed.mjs", [canary, dir, "arm64", "x64"]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /canary build, so its feed is canary-mac\.yml/);
  assert.equal(existsSync(join(dir, "latest-mac.yml")), false);

  const written = node("update-feed.mjs", ["--channel", "canary", canary, dir, "arm64", "x64"]);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(existsSync(join(dir, "latest-mac.yml")), false);
  // The canary feed fixture, which lists the ZIPs beside it on the canary prerelease by file name.
  assert.equal(withoutDate(readFileSync(join(dir, "canary-mac.yml"), "utf8")), withoutDate(fixture("canary/canary-mac.yml")));

  const release = zips(t, "0.1.0-alpha.2");
  assert.match(node("update-feed.mjs", ["--channel", "canary", "0.1.0-alpha.2", release, "arm64", "x64"]).stderr, /isn't a canary build/);
  for (const channel of ["alpha", "latest", "beta"]) {
    assert.match(node("update-feed.mjs", ["--channel", channel, "0.1.0-alpha.2", release, "arm64"]).stderr, /Only --channel canary/, channel);
  }
  assert.equal(existsSync(join(release, "canary-mac.yml")), false);
  // A release's own feed is unchanged: latest-mac.yml, with no --channel.
  assert.equal(node("update-feed.mjs", ["0.1.0-alpha.2", release, "arm64", "x64"]).status, 0);
  assert.equal(withoutDate(readFileSync(join(release, "latest-mac.yml"), "utf8")),
    withoutDate(fixture("alpha/latest-mac.yml").replaceAll(`${downloads}/v0.1.0-alpha.2/`, "")));
});

test("channel-feed.mjs names a release's update ZIPs by their full links into its v release, keeping their digests and sizes", t => {
  const dir = zips(t, "0.1.0-alpha.2");
  assert.equal(node("update-feed.mjs", ["0.1.0-alpha.2", dir, "arm64", "x64"]).status, 0);
  const own = readFileSync(join(dir, "latest-mac.yml"), "utf8");
  const result = node("channel-feed.mjs", ["0.1.0-alpha.2", join(dir, "latest-mac.yml"), join(dir, "alpha.yml")]);
  assert.equal(result.status, 0, result.stderr);
  const alpha = readFileSync(join(dir, "alpha.yml"), "utf8");
  assert.equal(alpha.replaceAll(`${downloads}/v0.1.0-alpha.2/`, ""), own, "only url and path change");
  assert.equal(withoutDate(alpha), withoutDate(fixture("alpha/latest-mac.yml")));
  const sha512 = arch => createHash("sha512").update(arch + "0.1.0-alpha.2").digest("base64");
  assert.match(alpha, new RegExp(`  - url: ${downloads}/v0\\.1\\.0-alpha\\.2/your-space-macos-x64-0\\.1\\.0-alpha\\.2\\.zip\\n    sha512: '${sha512("x64").replaceAll("+", "\\+")}'\\n    size: 16\\n`));

  // The alpha feed fixture is what it writes from that release's own latest-mac.yml.
  const recorded = join(dir, "recorded.yml");
  writeFileSync(recorded, fixture("alpha/latest-mac.yml").replaceAll(`${downloads}/v0.1.0-alpha.2/`, ""));
  assert.equal(node("channel-feed.mjs", ["0.1.0-alpha.2", recorded, join(dir, "again.yml")]).status, 0);
  assert.equal(readFileSync(join(dir, "again.yml"), "utf8"), fixture("alpha/latest-mac.yml"));
});

test("channel-feed.mjs refuses a canary, another version, and a feed update-feed.mjs didn't write", t => {
  const dir = zips(t, "0.1.0-alpha.2");
  node("update-feed.mjs", ["0.1.0-alpha.2", dir, "arm64", "x64"]);
  const own = readFileSync(join(dir, "latest-mac.yml"), "utf8");
  const refused = (version, text) => {
    writeFileSync(join(dir, "in.yml"), text);
    const result = node("channel-feed.mjs", [version, join(dir, "in.yml"), join(dir, "out.yml")]);
    return result.status === 2 && !existsSync(join(dir, "out.yml"));
  };
  assert.ok(refused(canary, own.replaceAll("0.1.0-alpha.2", canary)), "a canary");
  assert.ok(refused("0.1.0-alpha.3", own), "another version");
  assert.ok(refused("0.1.0-alpha.2", fixture("alpha/latest-mac.yml")), "a feed that already has full links");
  assert.ok(refused("0.1.0-alpha.2", own.replace("your-space-macos-x64-0.1.0-alpha.2.zip", "../v0.1.0-alpha.1/your-space-macos-x64-0.1.0-alpha.1.zip")), "a ZIP elsewhere");
  assert.ok(refused("0.1.0-alpha.2", own.replace("your-space-macos-x64-", "your-space-macos-arm64-")), "the same ZIP twice");
  assert.ok(refused("0.1.0-alpha.2", own + "stagingPercentage: 10\n"), "a line it doesn't write");
  assert.ok(refused("0.1.0-alpha.2", own.replace(/^sha512: '.{88}'$/m, `sha512: '${"A".repeat(86)}=='`)), "a top-level digest that isn't the first ZIP's");
  assert.ok(refused("0.1.0-alpha.2", own.trimEnd()), "no final line break");
  assert.ok(!refused("0.1.0-alpha.2", own), "the release's own feed is accepted");
});

test("the channel fixtures name one alpha release and one canary that sorts after it", () => {
  const alpha = JSON.parse(fixture("alpha/channel.json"));
  const canaryChannel = JSON.parse(fixture("canary/channel.json"));
  assert.equal(alpha.channel, "alpha");
  assert.equal(canaryChannel.channel, "canary");
  assert.equal(alpha.version, "0.1.0-alpha.2");
  assert.equal(canaryChannel.version, canary);
  // The canary's version contains -alpha. and sorts after the release, as the CLI orders versions, so
  // only the guard keeps it from an Alpha app.
  assert.ok(isCanary(canary) && !isCanary(alpha.version) && canary.includes("-alpha."));
  assert.ok(compareVersions(canary, alpha.version) > 0);
  assert.match(fixture("alpha/latest-mac.yml"), new RegExp(`^version: '${alpha.version.replaceAll(".", "\\.")}'$`, "m"));
  assert.match(fixture("canary/canary-mac.yml"), new RegExp(`^version: '${canary.replaceAll(".", "\\.")}'$`, "m"));
  // Each is one line in the form deploy/channel-json.sh writes.
  for (const named of [alpha, canaryChannel]) {
    const written = spawnSync(join(root, "deploy/channel-json.sh"), [named.channel, named.version, named.commit], { encoding: "utf8" });
    assert.equal(written.stdout, fixture(`${named.channel}/channel.json`));
  }
  // The releases feed fixture lists the two rolling releases before the newest v release.
  const tags = [...fixture("releases.atom").matchAll(/releases\/tag\/([^"]+)"/g)].map(([, tag]) => tag);
  assert.deepEqual(tags, ["alpha", "canary", "v0.1.0-alpha.2", "v0.1.0-alpha.1"]);
});
