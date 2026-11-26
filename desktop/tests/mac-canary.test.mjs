// deploy/mac-canary-version.sh and deploy/mac-canary-publish.sh, the Mac canary workflow's version and
// publish jobs (spec 016, FR-005). Nothing runs them against GitHub until the owner adds the canary
// certificate, so these run them as they are against a stand-in for GitHub's releases
// (fake-github.mjs), through a `gh`, a `curl` and a `sleep` first on PATH, in the states a first run,
// a later one and their re-runs can meet.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fake = fileURLToPath(new URL("fake-github.mjs", import.meta.url));
const canaryFeed = "https://github.com/your-space-ai/your-space/releases/download/canary";
const releases = "repos/your-space-ai/your-space/releases";
const version = "0.1.0-alpha.2.canary.20261201.60";
const older = "0.1.0-alpha.2.canary.20261130.59";
const newer = "0.1.0-alpha.2.canary.20261202.61";
const zips = build => ["arm64", "x64"].map(arch => `your-space-macos-${arch}-${build}.zip`);
const channelJson = (channel, named, at) => `${JSON.stringify({ channel, version: named, commit: at })}\n`;
const sha256 = data => createHash("sha256").update(data).digest("hex");
// What the Linux canary keeps on the prerelease, which the Mac canary never changes.
const linuxFiles = (build, commit) => [
  ["your-space.tar.gz", "bundle"],
  [`your-space-ai-cli-${build}.tgz`, "package"],
  ["your-space-linux-x64", "x64"],
  ["your-space-linux-arm64", "arm64"],
  ["your-space-linux-licenses.txt", "licenses"],
  ["SHA256SUMS", `${sha256("package")}  your-space-ai-cli-${build}.tgz\n`],
  ["channel.json", channelJson("canary", build, commit)],
];
// A canary-mac.yml for another build, in update-feed.mjs's form.
const feedFor = build => `version: '${build}'\nfiles:\n${zips(build).map(name => `  - url: ${name}\n`).join("")}`;

// The version job's tests need git, which the Node image the Arm check runs these in doesn't have.
const withGit = spawnSync("git", ["--version"]).status === 0 ? {} : { skip: "git isn't installed" };

/** A git checkout whose origin/main holds one commit, and another commit that isn't on main. */
function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), "ys-mac-canary-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ident = { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test" };
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8", env: { ...gitless(), ...ident } }).trim();
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "main");
  const onMain = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", onMain);
  git("commit", "-q", "--allow-empty", "-m", "elsewhere");
  return { dir, onMain, offMain: git("rev-parse", "HEAD") };
}
// The environment without anything that would point git at another repository.
function gitless() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
  return env;
}

/** A stand-in for GitHub holding the `canary` releases given, each [release, files]. */
function github(t, { canary = [], fail = [], served } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ys-mac-canary-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, "assets"));
  for (const tool of ["gh", "curl", "sleep"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${tool} "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const state = { lastId: 100, releases: [], calls: [], slept: [], fail, served, commits: {} };
  for (const [release, files] of canary) {
    const stored = { id: ++state.lastId, draft: false, prerelease: true, name: `Canary ${newer} (not a release)`, body: "An unreleased build of main.", assets: [], tag_name: "canary", ...release };
    for (const [name, data, assetState = "uploaded"] of files) {
      const id = ++state.lastId;
      writeFileSync(join(dir, "assets", String(id)), data);
      stored.assets.push({ id, name, state: assetState, size: data.length });
    }
    state.releases.push(stored);
  }
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));
  const readState = () => JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  const env = {
    ...gitless(), PATH: `${bin}:${process.env.PATH}`, FAKE_GITHUB: dir, GITHUB_STEP_SUMMARY: join(dir, "summary"),
    // If the stand-in were ever missed, the real gh would have no credentials to change anything.
    GH_TOKEN: "not-a-token", GH_CONFIG_DIR: join(dir, "gh-config"),
  };
  return {
    state: readState,
    /** The published canary release's uploaded files, by name, with their contents. */
    files() {
      const release = readState().releases.find(item => item.tag_name === "canary" && !item.draft);
      return Object.fromEntries(release.assets.filter(item => item.state === "uploaded").map(item => [item.name, readFileSync(join(dir, "assets", String(item.id)), "utf8")]));
    },
    /** The version job's script, run in a checkout as the workflow runs it, with what it wrote to GITHUB_OUTPUT. */
    version(cwd) {
      const output = join(dir, "output");
      rmSync(output, { force: true });
      const result = spawnSync(join(root, "deploy/mac-canary-version.sh"), [], { cwd, encoding: "utf8", env: { ...env, GITHUB_OUTPUT: output } });
      const written = existsSync(output) ? Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => line.split("="))) : {};
      return { ...result, output: written, calls: readState().calls };
    },
    /** The publish job's script, for a build whose signed files are in folder. */
    publish(folder, build = version) {
      const result = spawnSync(join(root, "deploy/mac-canary-publish.sh"), [build, folder], { encoding: "utf8", env });
      return { ...result, calls: readState().calls };
    },
  };
}

// Calls that change GitHub, as the stand-in records them.
const writes = calls => calls.filter(call => /^gh api (POST|PATCH|PUT|DELETE) |^gh release upload /.test(call));

/** A folder with what the sign job makes for a build: its two update ZIPs, their .sha256 and canary-mac.yml. */
function signed(t, build = version) {
  const dir = mkdtempSync(join(tmpdir(), "ys-mac-canary-signed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of zips(build)) {
    writeFileSync(join(dir, name), `the app in ${name}`);
    writeFileSync(join(dir, `${name}.sha256`), `${sha256(`the app in ${name}`)}  ${name}\n`);
  }
  const wrote = spawnSync(process.execPath, [join(root, "desktop/scripts/update-feed.mjs"), "--channel", "canary", build, dir, "arm64", "x64"], { encoding: "utf8" });
  assert.equal(wrote.status, 0, wrote.stderr);
  return dir;
}

// The version job.

test("the version job builds the Linux canary channel.json names, at its commit, when canary-mac.yml isn't there yet or lists an older build", withGit, t => {
  const repo = checkout(t);
  for (const files of [[], [["canary-mac.yml", feedFor(older)]]]) {
    const gh = github(t, { canary: [[{}, [...linuxFiles(version, repo.onMain), ...files]]] });
    const { status, stderr, output, calls } = gh.version(repo.dir);
    assert.equal(status, 0, stderr);
    assert.deepEqual(output, { build: "true", version, commit: repo.onMain });
    assert.deepEqual(calls, ["channel.json", "SHA256SUMS", "canary-mac.yml"].map(name => `curl ${canaryFeed}/${name}`), "it reads the three files at their fixed address, and nothing else");
  }
});

test("the version job builds nothing when canary-mac.yml already lists that build or a newer one", withGit, t => {
  const repo = checkout(t);
  for (const listed of [version, newer, "0.1.0-alpha.3.canary.20261128.40"]) {
    const gh = github(t, { canary: [[{}, [...linuxFiles(version, repo.onMain), ["canary-mac.yml", feedFor(listed)]]]] });
    const { status, stderr, stdout, output } = gh.version(repo.dir);
    assert.equal(status, 0, stderr);
    assert.deepEqual(output, { build: "false" }, listed);
    assert.match(stdout, new RegExp(`already lists ${listed.replaceAll(".", "\\.")}`));
  }
});

test("the version job builds nothing when channel.json isn't there, or SHA256SUMS is missing or another build's", withGit, t => {
  const repo = checkout(t);
  const linux = linuxFiles(version, repo.onMain);
  const without = name => linux.filter(([file]) => file !== name);
  for (const [canary, reason] of [
    [[], /no channel\.json/],
    [[[{}, without("channel.json")]], /no channel\.json/],
    // Only a draft, which the public address doesn't serve.
    [[[{ draft: true }, linux]], /no channel\.json/],
    [[[{}, without("SHA256SUMS")]], /SHA256SUMS isn't/],
    [[[{}, [...without("SHA256SUMS"), ["SHA256SUMS", `${sha256("package")}  your-space-ai-cli-${newer}.tgz\n`]]]], /SHA256SUMS isn't/],
  ]) {
    const gh = github(t, { canary });
    const { status, stderr, stdout, output } = gh.version(repo.dir);
    assert.equal(status, 0, stderr);
    assert.deepEqual(output, { build: "false" });
    assert.match(stdout, reason);
  }
});

test("only a 404 means a file isn't there: any other answer, a file in another form or a commit off main stops the version job", withGit, t => {
  const repo = checkout(t);
  const linux = linuxFiles(version, repo.onMain);
  const gh = github(t, { canary: [[{}, linux]], fail: [{ call: `curl ${canaryFeed}/channel.json`, status: 500, times: 5 }] });
  const failed = gh.version(repo.dir);
  assert.notEqual(failed.status, 0);
  assert.deepEqual(failed.output, {});
  assert.deepEqual(gh.state().slept, [10, 20, 40, 80]);

  const flaky = github(t, { canary: [[{}, linux]], fail: [{ call: `curl ${canaryFeed}/canary-mac.yml`, status: 502, times: 1 }] });
  assert.deepEqual(flaky.version(repo.dir).output, { build: "true", version, commit: repo.onMain }, "a moment's failure is tried again");

  const replaced = (name, data) => [...linux.filter(([file]) => file !== name), [name, data]];
  for (const [files, reason] of [
    [replaced("channel.json", channelJson("alpha", "0.1.0-alpha.2", repo.onMain)), /channel\.json isn't one/],
    [replaced("channel.json", JSON.stringify({ channel: "canary", version, commit: repo.onMain })), /channel\.json isn't one/],
    [replaced("channel.json", "Not Found"), /channel\.json isn't one/],
    [replaced("channel.json", channelJson("canary", version, repo.offMain)), /isn't on main/],
    [replaced("channel.json", channelJson("canary", version, "0".repeat(40))), /isn't on main/],
    [[...linux, ["canary-mac.yml", "version: 0.1.0-alpha.2.canary.20261202.61\n"]], /canary-mac\.yml doesn't list a canary/],
    [[...linux, ["canary-mac.yml", feedFor("0.1.0-alpha.3")]], /canary-mac\.yml doesn't list a canary/],
    [[...linux, ["canary-mac.yml", ""]], /canary-mac\.yml doesn't list a canary/],
  ]) {
    const other = github(t, { canary: [[{}, files]] });
    const result = other.version(repo.dir);
    assert.notEqual(result.status, 0, reason.source);
    assert.match(result.stderr, reason);
    assert.deepEqual(result.output, {}, reason.source);
  }
});

// The publish job.

test("a first Mac canary uploads both ZIPs, then canary-mac.yml, and deletes nothing", t => {
  const linux = linuxFiles(newer, "a".repeat(40));
  const gh = github(t, { canary: [[{}, linux]] });
  const before = gh.state().releases[0];
  const dir = signed(t);
  const { status, stderr, calls } = gh.publish(dir);
  assert.equal(status, 0, stderr);

  const files = gh.files();
  for (const name of [...zips(version), "canary-mac.yml"]) assert.equal(files[name], readFileSync(join(dir, name), "utf8"), name);
  assert.equal(files["latest-mac.yml"], undefined);
  // The Linux canary's files, its title and its notes are as they were.
  for (const [name, data] of linux) assert.equal(files[name], data, name);
  const after = gh.state().releases[0];
  assert.deepEqual({ name: after.name, body: after.body, draft: after.draft, prerelease: after.prerelease }, { name: before.name, body: before.body, draft: false, prerelease: true });
  assert.deepEqual(after.assets.filter(item => linux.some(([name]) => name === item.name)), before.assets);

  assert.deepEqual(writes(calls), [`gh release upload canary ${zips(version).join(" ")}`, "gh release upload canary canary-mac.yml"]);
  // Each ZIP downloads unchanged before canary-mac.yml lists it.
  for (const name of zips(version)) {
    const checked = calls.indexOf(`gh release download canary ${name}`);
    assert.ok(checked !== -1 && checked < calls.indexOf("gh release upload canary canary-mac.yml"), name);
  }
  assert.ok(calls.includes("gh release download canary canary-mac.yml"));
});

test("older Mac ZIPs are deleted only once canary-mac.yml lists this build, and only the Mac canary's", t => {
  const linux = linuxFiles(version, "a".repeat(40));
  const old = zips(older).map(name => [name, `old ${name}`]);
  const gh = github(t, { canary: [[{}, [...linux, ...old, ["canary-mac.yml", feedFor(older)], [`your-space-macos-x64-${older}.zip.part`, "", "starter"]]]] });
  const { status, stderr, calls } = gh.publish(signed(t));
  assert.equal(status, 0, stderr);
  const files = gh.files();
  assert.deepEqual(Object.keys(files).filter(name => /^your-space-macos-|^canary-mac\.yml$/.test(name)).sort(), [...zips(version), "canary-mac.yml"].sort());
  for (const [name, data] of linux) assert.equal(files[name], data, name);
  assert.ok(gh.state().releases[0].assets.some(item => item.name.endsWith(".zip.part")), "a file whose name isn't a Mac ZIP stays");

  const deletes = calls.flatMap((call, i) => (call.startsWith("gh api DELETE ") ? [i] : []));
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every(i => i > calls.indexOf("gh release download canary canary-mac.yml")), "the older ZIPs go once canary-mac.yml downloads unchanged");
});

// The next day's version job then builds as for the first Mac canary, which finds no canary-mac.yml.
test("an upload of canary-mac.yml that keeps failing leaves none, and deletes no ZIP, until a re-run", t => {
  const old = zips(older).map(name => [name, `old ${name}`]);
  const linux = linuxFiles(version, "a".repeat(40));
  const gh = github(t, {
    canary: [[{}, [...linux, ...old, ["canary-mac.yml", feedFor(older)]]]],
    // gh's --clobber deletes the older canary-mac.yml, then its upload fails.
    fail: [{ call: "gh release upload canary canary-mac.yml", status: 502, times: 5, apply: "delete" }],
  });
  const dir = signed(t);
  assert.notEqual(gh.publish(dir).status, 0);
  let files = gh.files();
  assert.equal(files["canary-mac.yml"], undefined, "a Mac app on Canary checking now says it couldn't check");
  for (const [name, data] of old) assert.equal(files[name], data, `${name} stays: nothing is deleted before canary-mac.yml is there`);
  for (const name of zips(version)) assert.equal(files[name], readFileSync(join(dir, name), "utf8"), name);
  assert.deepEqual(gh.state().slept, [10, 20, 40, 80]);
  assert.deepEqual(writes(gh.state().calls).filter(call => call.startsWith("gh api DELETE ")), []);


  const again = gh.publish(dir);
  assert.equal(again.status, 0, again.stderr);
  files = gh.files();
  assert.equal(files["canary-mac.yml"], readFileSync(join(dir, "canary-mac.yml"), "utf8"));
  for (const [name] of old) assert.equal(files[name], undefined, name);
  for (const [name, data] of linux) assert.equal(files[name], data, name);
});

test("a re-run once canary-mac.yml lists this build uploads nothing and finishes the deletions", t => {
  const dir = signed(t);
  const ours = [...zips(version), "canary-mac.yml"].map(name => [name, readFileSync(join(dir, name), "utf8")]);
  const gh = github(t, { canary: [[{}, [...linuxFiles(version, "a".repeat(40)), ...ours, [zips(older)[0], "old"]]]] });
  const { status, stderr, stdout, calls } = gh.publish(dir);
  assert.equal(status, 0, stderr);
  assert.match(stdout, /already lists/);
  assert.deepEqual(writes(calls).filter(call => call.startsWith("gh release upload")), []);
  assert.equal(writes(calls).filter(call => call.startsWith("gh api DELETE ")).length, 1);
  assert.equal(gh.files()[zips(older)[0]], undefined);
});

test("a canary-mac.yml that another run signed for this build is left as it is, with its ZIPs", t => {
  // Run A stopped after uploading its ZIPs, run B of the same build published, then A is re-run.
  const theirs = [...zips(version).map(name => [name, `B's ${name}`]), ["canary-mac.yml", `${feedFor(version)}releaseDate: 'B'\n`]];
  const gh = github(t, { canary: [[{}, [...linuxFiles(version, "a".repeat(40)), ...theirs, [zips(older)[0], "old"]]]] });
  const { status, stderr, stdout, calls } = gh.publish(signed(t));
  assert.equal(status, 0, stderr);
  assert.match(stdout, /already lists .* as another run signed it/);
  assert.deepEqual(writes(calls), []);
  const files = gh.files();
  for (const [name, data] of theirs) assert.equal(files[name], data, name);

  // With this run's ZIPs there, it is this run's canary-mac.yml that didn't download as it was
  // uploaded, so the re-run uploads it again, and only it: the ZIPs it lists stay.
  const dir = signed(t);
  const ours = zips(version).map(name => [name, readFileSync(join(dir, name), "utf8")]);
  const own = github(t, { canary: [[{}, [...linuxFiles(version, "a".repeat(40)), ...ours, ["canary-mac.yml", `${feedFor(version)}garbled\n`], [zips(older)[0], "old"]]]] });
  const again = own.publish(dir);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(writes(again.calls).filter(call => call.startsWith("gh release upload")), ["gh release upload canary canary-mac.yml"]);
  for (const [name, data] of ours) assert.equal(own.files()[name], data, name);
  assert.equal(own.files()["canary-mac.yml"], readFileSync(join(dir, "canary-mac.yml"), "utf8"));
  assert.equal(own.files()[zips(older)[0]], undefined);
});

test("a canary-mac.yml or a Mac ZIP that names a newer build is left as it is", t => {
  for (const [files, warned] of [
    [[["canary-mac.yml", feedFor(newer)], ...zips(newer).map(name => [name, name])], false],
    // A newer build's run that stopped after uploading a ZIP, before canary-mac.yml.
    [[["canary-mac.yml", feedFor(older)], [zips(newer)[0], "", "starter"]], true],
    [[[zips(newer)[1], "newer"]], true],
  ]) {
    const gh = github(t, { canary: [[{}, [...linuxFiles(newer, "a".repeat(40)), ...files]]] });
    const { status, stderr, stdout, calls } = gh.publish(signed(t));
    assert.equal(status, 0, stderr);
    assert.match(stdout, new RegExp(`already name ${newer.replaceAll(".", "\\.")}, a newer build`));
    assert.equal(/::warning::/.test(stderr), warned, stderr);
    assert.deepEqual(writes(calls), []);
  }
});

test("with no published canary prerelease, or one holding latest-mac.yml, publishing fails and changes nothing", t => {
  for (const [canary, reason] of [
    [[], /no published canary prerelease/],
    [[[{ draft: true }, linuxFiles(version, "a".repeat(40))]], /no published canary prerelease/],
    [[[{}, [...linuxFiles(version, "a".repeat(40)), ["latest-mac.yml", feedFor(version)]]]], /holds latest-mac\.yml/],
  ]) {
    const gh = github(t, { canary });
    const before = gh.state().releases;
    const { status, stderr, calls } = gh.publish(signed(t));
    assert.notEqual(status, 0);
    assert.match(stderr, reason);
    assert.deepEqual(writes(calls), [], "it creates, publishes and uploads nothing");
    assert.deepEqual(gh.state().releases, before);
  }
});

test("a server error is retried, and a ZIP an upload left half there is replaced", t => {
  const gh = github(t, {
    canary: [[{}, [...linuxFiles(version, "a".repeat(40)), [zips(version)[0], "", "starter"]]]],
    fail: [{ call: "gh release upload canary your-space-macos-", status: 502, times: 1 }],
  });
  const dir = signed(t);
  const { status, stderr, calls } = gh.publish(dir);
  assert.equal(status, 0, stderr);
  assert.match(stderr, /::warning::Attempt 1 of 5 failed/);
  assert.deepEqual(gh.state().slept, [10]);
  assert.ok(calls.findIndex(call => call.startsWith("gh api DELETE ")) < calls.indexOf(`gh release upload canary ${zips(version).join(" ")}`));
  assert.equal(gh.files()[zips(version)[0]], readFileSync(join(dir, zips(version)[0]), "utf8"));
  assert.equal(gh.state().releases[0].assets.filter(item => item.name === zips(version)[0]).length, 1);
});

test("publishing refuses a build that isn't a canary, or a folder that isn't what the sign job makes, before reading GitHub", t => {
  const gh = github(t, { canary: [[{}, linuxFiles(version, "a".repeat(40))]] });
  const release = "0.1.0-alpha.2";
  const releaseDir = signed(t);
  assert.notEqual(gh.publish(releaseDir, release).status, 0);

  const extra = signed(t);
  writeFileSync(join(extra, "latest-mac.yml"), feedFor(version));
  const changed = signed(t);
  writeFileSync(join(changed, zips(version)[1]), "another app");
  const missing = signed(t);
  rmSync(join(missing, "canary-mac.yml"));
  const otherFeed = signed(t);
  writeFileSync(join(otherFeed, "canary-mac.yml"), feedFor(older));
  for (const dir of [extra, changed, missing, otherFeed]) {
    const { status, stderr } = gh.publish(dir);
    assert.notEqual(status, 0);
    assert.match(stderr, /doesn't hold .* two update ZIPs/);
  }
  assert.deepEqual(gh.state().calls, []);
});
