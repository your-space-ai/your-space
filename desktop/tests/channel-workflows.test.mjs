// Two of the guard's rules (spec 016, FR-007), checked in the workflows and the scripts they run:
// only Release publish writes to the `alpha` release, through deploy/alpha-feed.sh, and nothing a
// canary workflow runs uploads latest-mac.yml, the file an Alpha Mac app reads. A canary's version
// contains -alpha. and sorts after the alpha it follows, so either would offer Alpha apps a canary.
// They read the files as text, so each check also runs on a planted offender to show it can fail.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const isFile = path => existsSync(join(root, path)) && statSync(join(root, path)).isFile();
const workflows = readdirSync(join(root, ".github/workflows")).filter(name => /\.ya?ml$/.test(name)).map(name => `.github/workflows/${name}`);
const listed = dir => existsSync(join(root, dir)) ? readdirSync(join(root, dir)).map(name => `${dir}/${name}`).filter(isFile) : [];

/** The text of a file without its comments, so a comment that names a file isn't counted as using it. */
function code(path, text = read(path)) {
  const marker = /\.(m?js|cjs|ts)$/.test(path) ? /(^|\s)\/\/.*$/ : /(^|\s)#.*$/;
  return text.split("\n").map(line => line.replace(marker, "")).join("\n");
}

/** Every repository file a workflow or script runs, calls or sources, and those files' own, with it. */
function runs(start, texts = {}) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const text = code(path, texts[path]);
    for (const [, called] of text.matchAll(/uses:\s*\.\/(\.github\/workflows\/[\w.-]+\.ya?ml)/g)) queue.push(called);
    // A path such as "$root/deploy/gh-retry.sh" names the repository file at its end.
    for (const [named] of text.matchAll(/(?:[\w$.{}-]+\/)+[\w.-]+\.(?:sh|mjs|cjs|js|ts)\b/g)) {
      const parts = named.split("/");
      const file = parts.map((_, i) => parts.slice(i).join("/")).find(path => isFile(path) || texts[path]);
      if (file) queue.push(file);
    }
  }
  return [...seen];
}

// The alpha release, as a script or workflow names it to write to it or read it.
const namesAlpha = /releases\/(?:download|tag|tags)\/alpha\b|\brelease\s+(?:upload|create|edit|delete|download|view)\s+["']?alpha\b|tag_name\s*(?:==?|:)\s*["']?alpha\b|refs\/tags\/alpha\b/;
// A change to a GitHub release: gh's release commands and API calls that write, or an action that does.
const writesReleases = /\bgh\s+release\s+(?:upload|create|edit|delete)\b|\bgh\s+api\b[^\n]*(?:--method|-X)\s*(?:POST|PATCH|PUT|DELETE)\b|softprops\/action-gh-release|ncipollo\/release-action|actions\/github-script/;
const writesAlpha = (path, text) => namesAlpha.test(code(path, text)) && writesReleases.test(code(path, text));

/** Every workflow and every script in the folders scripts live in, with everything they run. */
function everything() {
  const files = new Set([...workflows, ...listed("deploy"), ...listed("desktop/scripts"), ...listed("cli/scripts"), ...listed(".circleci")]);
  for (const file of [...files]) for (const ran of runs(file)) files.add(ran);
  return [...files].sort();
}

/** A workflow's job, as the lines from its key to the next job's. */
function job(path, name) {
  const lines = code(path).split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `${path} has no ${name} job`);
  const end = lines.findIndex((line, i) => i > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

test("only Release publish runs deploy/alpha-feed.sh, in its alpha-feed job, once the stranger check passes and only for v tags", () => {
  assert.deepEqual(workflows.filter(path => runs(path).includes("deploy/alpha-feed.sh")), [".github/workflows/release-publish.yml"]);
  assert.deepEqual(everything().filter(path => path !== "deploy/alpha-feed.sh" && runs(path).includes("deploy/alpha-feed.sh")), [".github/workflows/release-publish.yml"]);

  const publish = read(".github/workflows/release-publish.yml");
  assert.match(publish, /^on:\n {2}release:\n {4}types: \[published\]\n/m, "it runs only when a release is published");
  const feed = job(".github/workflows/release-publish.yml", "alpha-feed");
  assert.match(feed, /^ {4}needs: stranger$/m);
  assert.match(feed, /^ {4}if: github\.repository == 'your-space-ai\/your-space' && startsWith\(github\.event\.release\.tag_name, 'v'\)$/m);
  assert.match(feed, /^ {6}contents: write$/m);
  assert.match(feed, /^ {6}group: alpha-feed\n {6}cancel-in-progress: false$/m);
  assert.match(feed, /^ {10}ref: refs\/tags\/\$\{\{ github\.event\.release\.tag_name \}\}\n {10}persist-credentials: false$/m);
  assert.match(feed, /^ {8}run: deploy\/alpha-feed\.sh "\$TAG"$/m);
  assert.doesNotMatch(feed, /npm (ci|install)/, "it runs no npm packages");
  for (const other of ["stranger", "npm", "images"]) {
    assert.doesNotMatch(job(".github/workflows/release-publish.yml", other), /alpha-feed/, `${other} neither runs the feed nor waits for it`);
  }
});

test("only deploy/alpha-feed.sh writes to the alpha release", () => {
  assert.deepEqual(everything().filter(path => writesAlpha(path)), ["deploy/alpha-feed.sh"]);
  // Its uploads all go to the alpha release, and its downloads to the alpha release or the release.
  const script = code("deploy/alpha-feed.sh");
  assert.deepEqual([...script.matchAll(/gh release upload (\S+)/g)].map(([, tag]) => tag), ["alpha"]);
  assert.deepEqual([...new Set([...script.matchAll(/gh release download (\S+)/g)].map(([, tag]) => tag))], ['"$tag"', "alpha"]);

  // A planted writer is found, whichever way it names the release.
  for (const planted of [
    "gh release upload alpha latest-mac.yml --clobber",
    "gh api --method POST repos/x/y/releases -f tag_name=alpha",
    "gh api -X PATCH \"$api/releases/$id\" # the one at releases/tags/alpha",
  ]) {
    const comment = planted.includes("#");
    assert.equal(writesAlpha("planted.sh", `run: |\n  ${planted}\n`), !comment, planted);
  }
  assert.equal(writesAlpha("planted.sh", "curl -sSf https://github.com/o/r/releases/download/alpha/channel.json\n"), false, "reading the feed isn't writing it");
});

// Whether a workflow or script, and everything it runs, could put latest-mac.yml on a release: it runs
// update-feed.mjs without --channel canary, names latest-mac.yml other than to stop on finding it, or
// uploads files by a pattern. update-feed.mjs itself never writes latest-mac.yml for a canary build.
function uploadsLatestMac(start, texts) {
  const problems = [];
  for (const path of runs(start, texts)) {
    if (path === "desktop/scripts/update-feed.mjs") continue;
    for (const line of code(path, texts?.[path] ?? read(path)).split("\n")) {
      if (/update-feed\.mjs/.test(line) && !/update-feed\.mjs["']?\s+--channel\s+canary\b/.test(line)) problems.push(`${path}: ${line.trim()}`);
      if (/latest-mac\.yml/.test(line) && !/\bgrep\b|::error::/.test(line)) problems.push(`${path}: ${line.trim()}`);
      if (/gh\s+release\s+upload\b/.test(line) && /\*|\.yml\b(?<!canary-mac\.yml)/.test(line)) problems.push(`${path}: ${line.trim()}`);
      if (/softprops\/action-gh-release|ncipollo\/release-action/.test(line)) problems.push(`${path}: ${line.trim()}`);
    }
  }
  return problems;
}

test("nothing a canary workflow runs uploads latest-mac.yml", () => {
  const canaries = workflows.filter(path => /canary/i.test(path) || /^name:.*canary/im.test(read(path)));
  assert.ok(canaries.includes(".github/workflows/canary.yml"));
  for (const path of canaries) assert.deepEqual(uploadsLatestMac(path), [], path);
  // Release draft does make and upload latest-mac.yml, so the check finds it there.
  assert.notDeepEqual(uploadsLatestMac(".github/workflows/release-draft.yml"), []);

  // Planted in a canary workflow, each of these is found.
  for (const planted of [
    'node desktop/scripts/update-feed.mjs "$VERSION" macos arm64 x64',
    'gh release upload canary macos/latest-mac.yml --clobber',
    'gh release upload canary macos/* --clobber',
    "uses: ./.github/workflows/release-draft.yml",
  ]) {
    const texts = { ".github/workflows/planted-canary.yml": `name: Planted canary\njobs:\n  mac:\n    steps:\n      - run: ${planted}\n` };
    assert.notDeepEqual(uploadsLatestMac(".github/workflows/planted-canary.yml", texts), [], planted);
  }
  const allowed = { ".github/workflows/planted-canary.yml": 'jobs:\n  mac:\n    steps:\n      - run: |\n          node desktop/scripts/update-feed.mjs --channel canary "$VERSION" macos arm64 x64\n          gh release upload canary macos/canary-mac.yml --clobber\n' };
  assert.deepEqual(uploadsLatestMac(".github/workflows/planted-canary.yml", allowed), []);
});
