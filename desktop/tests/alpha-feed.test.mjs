// deploy/alpha-feed.sh, which Release publish runs to point the Alpha channel's feed at a published
// release (spec 016, FR-003). Nothing can run it against GitHub before alpha.2 is published, so these
// run it as it is against a stand-in for GitHub's releases (fake-github.mjs), through a `gh`, a `curl`
// and a `sleep` first on PATH, in the states a first run and its re-runs can meet.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = join(root, "shared/release-channels/fixtures");
const fake = fileURLToPath(new URL("fake-github.mjs", import.meta.url));
const feed = "https://github.com/your-space-ai/your-space/releases/download/alpha/channel.json";
const releases = "repos/your-space-ai/your-space/releases";
const title = "Alpha channel feed (not a release)";

// The alpha feed fixture names 0.1.0-alpha.2, and its latest-mac.yml is what the script writes from
// that release's own, which names the same ZIPs by file name.
const alphaFeed = readFileSync(join(fixtures, "alpha/latest-mac.yml"), "utf8");
const alphaChannel = readFileSync(join(fixtures, "alpha/channel.json"), "utf8");
const { version, commit } = JSON.parse(alphaChannel);
const releaseFeed = alphaFeed.replaceAll(`https://github.com/your-space-ai/your-space/releases/download/v${version}/`, "");
const channelJson = (channel, named, at) => `${JSON.stringify({ channel, version: named, commit: at })}\n`;
// The feed's latest-mac.yml as the script writes it for another release.
const feedFor = other => alphaFeed.replaceAll(version, other);
const sha256 = data => createHash("sha256").update(data).digest("hex");

/** A stand-in for GitHub holding the published v0.1.0-alpha.2 release and any `alpha` releases given. */
function github(t, { alpha = [], fail = [], served, feed: published = releaseFeed, commits = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ys-alpha-feed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, "assets"));
  for (const tool of ["gh", "curl", "sleep"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${tool} "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const state = { lastId: 100, releases: [], calls: [], slept: [], fail, served, commits: { [`v${version}`]: commit, ...commits } };
  const add = (release, files) => {
    const stored = { id: ++state.lastId, draft: false, prerelease: true, assets: [], ...release };
    for (const [name, data, assetState = "uploaded"] of files) {
      const id = ++state.lastId;
      writeFileSync(join(dir, "assets", String(id)), data);
      stored.assets.push({ id, name, state: assetState, size: data.length });
    }
    state.releases.push(stored);
  };
  const zips = ["arm64", "x64"].map(arch => [`your-space-macos-${arch}-${version}.zip`, arch + version]);
  // SHA256SUMS lists the release's own latest-mac.yml, as Release draft writes it.
  const sums = [...zips.map(([name, data]) => `${sha256(data)}  ${name}`), `${sha256(releaseFeed)}  latest-mac.yml`].join("\n") + "\n";
  add({ tag_name: `v${version}`, name: `Your Space ${version}` }, [...zips, ["latest-mac.yml", published], ["SHA256SUMS", sums]]);
  for (const [release, files] of alpha) add({ tag_name: "alpha", name: title, ...release }, files);
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));
  const readState = () => JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));

  return {
    state: readState,
    /** A file the published `alpha` release serves at its fixed address, as a client reads it. */
    served(name) {
      const current = readState();
      const release = current.releases.find(item => item.tag_name === "alpha" && !item.draft);
      const item = release?.assets.find(file => file.name === name && file.state === "uploaded");
      return item ? readFileSync(join(dir, "assets", String(item.id)), "utf8") : undefined;
    },
    run(tag = `v${version}`) {
      // Run as Release publish runs it, by its own shebang and executable bit.
      const result = spawnSync(join(root, "deploy/alpha-feed.sh"), [tag], {
        encoding: "utf8",
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GITHUB: dir, GITHUB_STEP_SUMMARY: join(dir, "summary"),
          // If the stand-in were ever missed, the real gh would have no credentials to change anything.
          GH_TOKEN: "not-a-token", GH_CONFIG_DIR: join(dir, "gh-config"),
        },
      });
      return { ...result, calls: readState().calls };
    },
  };
}

// Calls that change GitHub, as the stand-in records them.
const writes = calls => calls.filter(call => /^gh api (POST|PATCH|PUT|DELETE) |^gh release upload /.test(call));

test("a first run creates the alpha prerelease at the release's commit and uploads its feed, latest-mac.yml before channel.json", t => {
  const gh = github(t);
  const { status, stderr, stdout, calls } = gh.run();
  assert.equal(status, 0, stderr);
  assert.match(stdout, new RegExp(`The alpha feed points at v${version.replaceAll(".", "\\.")}\\.`));
  assert.ok(calls.includes(`curl ${feed}`), "it reads the feed at its fixed address first");

  const alpha = gh.state().releases.filter(release => release.tag_name === "alpha");
  assert.equal(alpha.length, 1);
  assert.deepEqual(
    { draft: alpha[0].draft, prerelease: alpha[0].prerelease, make_latest: alpha[0].make_latest, name: alpha[0].name, target_commitish: alpha[0].target_commitish },
    { draft: false, prerelease: true, make_latest: "false", name: title, target_commitish: commit },
  );
  assert.deepEqual(alpha[0].assets.map(file => [file.name, file.state]).sort(), [["channel.json", "uploaded"], ["latest-mac.yml", "uploaded"]]);
  // What clients read is the fixture: full links into the v release, and the release's channel.json.
  assert.equal(gh.served("latest-mac.yml"), alphaFeed);
  assert.equal(gh.served("channel.json"), alphaChannel);
  const uploads = calls.filter(call => call.startsWith("gh release upload "));
  assert.deepEqual(uploads, ["gh release upload alpha latest-mac.yml", "gh release upload alpha channel.json"]);
  assert.ok(calls.indexOf("gh release download alpha latest-mac.yml") < calls.indexOf(uploads[1]), "latest-mac.yml downloads unchanged before channel.json goes up");
  assert.equal(writes(calls).filter(call => call.startsWith(`gh api POST ${releases} `)).length, 1);
});

test("a re-run changes nothing once the feed names the release", t => {
  const gh = github(t);
  assert.equal(gh.run().status, 0);
  const before = gh.state().releases;
  const again = gh.run();
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, new RegExp(`already names ${version.replaceAll(".", "\\.")}`));
  const rerun = again.calls.slice(again.calls.lastIndexOf(`gh api GET repos/your-space-ai/your-space/commits/v${version}`));
  assert.deepEqual(writes(rerun), []);
  assert.deepEqual(gh.state().releases, before);
});

test("a feed that names a newer release is left as it is, and one that names an older release moves to this one", t => {
  const newer = channelJson("alpha", "0.1.0-alpha.3", commit);
  const gh = github(t, { alpha: [[{}, [["latest-mac.yml", "version: '0.1.0-alpha.3'\n"], ["channel.json", newer]]]] });
  const { status, stderr, stdout, calls } = gh.run();
  assert.equal(status, 0, stderr);
  assert.match(stdout, /already names 0\.1\.0-alpha\.3/);
  assert.deepEqual(writes(calls), []);
  assert.equal(gh.served("channel.json"), newer);

  // 0.1.0 is newer than every 0.1.0 alpha, and alpha.10 than alpha.2, by Semantic Versioning.
  for (const later of ["0.1.0", "0.1.0-beta.1", "0.1.0-alpha.10"]) {
    const other = github(t, { alpha: [[{}, [["channel.json", channelJson("alpha", later, commit)]]]] });
    assert.deepEqual(writes(other.run().calls), [], later);
  }

  const older = github(t, { alpha: [[{}, [["latest-mac.yml", "version: '0.1.0-alpha.1'\n"], ["channel.json", channelJson("alpha", "0.1.0-alpha.1", commit)]]]] });
  const moved = older.run();
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(older.served("latest-mac.yml"), alphaFeed);
  assert.equal(older.served("channel.json"), alphaChannel);
  assert.equal(older.state().releases.filter(release => release.tag_name === "alpha").length, 1);
});

test("a draft an attempt left is published and used, and a half-uploaded file on it is replaced", t => {
  const gh = github(t, { alpha: [[{ draft: true }, [["latest-mac.yml", "", "starter"]]]] });
  const { status, stderr, calls } = gh.run();
  assert.equal(status, 0, stderr);
  const alpha = gh.state().releases.filter(release => release.tag_name === "alpha");
  assert.equal(alpha.length, 1, "no second alpha release");
  assert.equal(alpha[0].draft, false);
  assert.deepEqual(alpha[0].assets.map(file => [file.name, file.state]).sort(), [["channel.json", "uploaded"], ["latest-mac.yml", "uploaded"]]);
  assert.equal(gh.served("latest-mac.yml"), alphaFeed);
  assert.ok(calls.some(call => call.startsWith(`gh api PATCH ${releases}/${alpha[0].id} {"draft":false`)));
  assert.equal(alpha[0].target_commitish, commit, "publishing the draft makes the alpha tag at the release's commit");
  assert.ok(!calls.some(call => call.startsWith(`gh api POST ${releases} `)));
  assert.ok(calls.some(call => call.startsWith("gh api DELETE ")), "the half-uploaded file is deleted before the upload");
});

test("a server error is retried, and a release GitHub made before failing is used, not made again", t => {
  const gh = github(t, { fail: [{ call: `gh api POST ${releases}`, status: 500, times: 1, apply: true }, { call: "gh release upload alpha", status: 502, times: 1 }] });
  const { status, stderr } = gh.run();
  assert.equal(status, 0, stderr);
  assert.match(stderr, /::warning::Attempt 1 of 5 failed/);
  assert.deepEqual(gh.state().slept, [10, 10]);
  assert.equal(gh.state().releases.filter(release => release.tag_name === "alpha").length, 1);
  assert.equal(gh.served("latest-mac.yml"), alphaFeed);
  assert.equal(gh.served("channel.json"), alphaChannel);
});

test("only GitHub's 404 means there is no feed yet: any other answer stops before anything changes", t => {
  const gh = github(t, { fail: [{ call: `curl ${feed}`, status: 500, times: 5 }] });
  const { status, calls } = gh.run();
  assert.notEqual(status, 0);
  assert.deepEqual(gh.state().slept, [10, 20, 40, 80]);
  assert.deepEqual(writes(calls), []);

  for (const named of [channelJson("canary", "0.1.0-alpha.2.canary.20261201.60", commit), '{"channel":"alpha","version":"0.1.0-alpha.3"}\n', JSON.stringify({ channel: "alpha", version: "0.1.0-alpha.1", commit }), "Not Found"]) {
    const other = github(t, { alpha: [[{}, [["channel.json", named]]]] });
    const result = other.run();
    assert.notEqual(result.status, 0, named);
    assert.match(result.stderr, /isn't one deploy\/channel-json\.sh writes for Alpha/);
    assert.deepEqual(writes(result.calls), [], named);
  }
});

test("a latest-mac.yml that doesn't match the release's SHA256SUMS stops before anything changes", t => {
  const gh = github(t, { feed: releaseFeed.replace("size: 18", "size: 19") });
  const { status, stderr, calls } = gh.run();
  assert.notEqual(status, 0);
  assert.match(stderr, /latest-mac\.yml is missing or doesn't match its SHA256SUMS/);
  assert.deepEqual(writes(calls), []);
  assert.equal(gh.state().releases.filter(release => release.tag_name === "alpha").length, 0);
});

test("the feed is read again just before writing, and a newer release named meanwhile is kept", t => {
  const gh = github(t, { served: { "channel.json": [{ status: 404, body: "Not Found" }, { status: 200, body: channelJson("alpha", "0.1.0-alpha.3", commit) }] } });
  const { status, stderr, stdout, calls } = gh.run();
  assert.equal(status, 0, stderr);
  assert.match(stdout, /already names 0\.1\.0-alpha\.3/);
  assert.equal(calls.filter(call => call === `curl ${feed}`).length, 2);
  assert.deepEqual(calls.filter(call => call.startsWith("gh release upload")), []);
});

// An attempt for a newer release that stopped between its two uploads leaves latest-mac.yml listing
// that release while channel.json names an older one, or none, since --clobber deletes a file before
// it uploads its replacement. An older release's run then leaves the feed alone too.
test("a feed whose latest-mac.yml lists a newer release is left as it is, whatever its channel.json names", t => {
  const newer = feedFor("0.1.0-alpha.3");
  for (const named of [[], [["channel.json", channelJson("alpha", "0.1.0-alpha.1", commit)]]]) {
    const gh = github(t, { alpha: [[{}, [["latest-mac.yml", newer], ...named]]] });
    const { status, stderr, stdout, calls } = gh.run();
    assert.equal(status, 0, stderr);
    assert.match(stdout, /latest-mac\.yml already lists 0\.1\.0-alpha\.3/);
    assert.match(stderr, /::warning::.*re-run v0\.1\.0-alpha\.3's alpha-feed job/);
    assert.deepEqual(writes(calls), []);
    assert.equal(gh.served("latest-mac.yml"), newer);
  }
});

test("an attempt for this release that stopped between its two uploads is finished by a re-run", t => {
  for (const named of [[], [["channel.json", channelJson("alpha", "0.1.0-alpha.1", commit)]]]) {
    const gh = github(t, { alpha: [[{}, [["latest-mac.yml", alphaFeed], ...named]]] });
    const { status, stderr, calls } = gh.run();
    assert.equal(status, 0, stderr);
    assert.equal(gh.served("latest-mac.yml"), alphaFeed);
    assert.equal(gh.served("channel.json"), alphaChannel);
    assert.ok(calls.includes("gh release upload alpha channel.json"));
  }
});

test("a latest-mac.yml the feed can't be read for, or that doesn't name an Alpha release as the script writes it, stops before anything changes", t => {
  const gh = github(t, { alpha: [[{}, [["latest-mac.yml", alphaFeed]]]], fail: [{ call: `curl ${feed.replace("channel.json", "latest-mac.yml")}`, status: 500, times: 5 }] });
  const { status, calls } = gh.run();
  assert.notEqual(status, 0);
  assert.deepEqual(writes(calls), []);

  for (const listed of ["Not Found", "version: 0.1.0-alpha.3\n", "", `version: '0.1.0-alpha.2.canary.20261201.60'\n`, "version: '0.1'\n", `files:\n${feedFor("0.1.0-alpha.3")}`]) {
    const other = github(t, { alpha: [[{}, [["latest-mac.yml", listed]]]] });
    const result = other.run();
    assert.notEqual(result.status, 0, listed);
    assert.match(result.stderr, /latest-mac\.yml doesn't list an Alpha release/, listed);
    assert.deepEqual(writes(result.calls), [], listed);
  }
});

test("a canary's tag, or a tag that isn't a version, never reaches the alpha feed", t => {
  for (const tag of ["v0.1.0-alpha.2.canary.20261201.60", "canary", "v0.1", "v0.1.0-alpha.2\n"]) {
    const gh = github(t, { commits: { [tag]: commit } });
    const { status, calls } = gh.run(tag);
    assert.notEqual(status, 0, tag);
    assert.deepEqual(writes(calls), [], tag);
    assert.ok(!calls.some(call => call.startsWith("curl ")), tag);
  }
});
