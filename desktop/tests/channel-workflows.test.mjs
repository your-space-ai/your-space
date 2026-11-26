// Two of the guard's rules (spec 016, FR-007), checked in the workflows and the scripts they run:
// only Release publish writes to the `alpha` release, through deploy/alpha-feed.sh, and nothing a
// canary workflow runs uploads latest-mac.yml, the file an Alpha Mac app reads. A canary's version
// contains -alpha. and sorts after the alpha it follows, so either would offer Alpha apps a canary.
// And the Mac canary's own rules (FR-005, decision 4): it runs only on main once switched on, only its
// signing job reaches the canary's signing secrets, with no npm packages, and each canary workflow
// deletes only its own files on the shared prerelease.
// They read the files as text, so each check also runs on a planted offender to show it can fail.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const isFile = path => existsSync(join(root, path)) && statSync(join(root, path)).isFile();
const workflows = readdirSync(join(root, ".github/workflows")).filter(name => /\.ya?ml$/.test(name)).map(name => `.github/workflows/${name}`);
const listed = dir => existsSync(join(root, dir)) ? readdirSync(join(root, dir)).map(name => `${dir}/${name}`).filter(isFile) : [];

/**
 * The text of a file without its comments, so a comment that names a file isn't counted as using it,
 * and with a shell command continued over several lines (a line ending in \) on one.
 */
function code(path, text = read(path)) {
  const marker = /\.(m?js|cjs|ts)$/.test(path) ? /(^|\s)\/\/.*$/ : /(^|\s)#.*$/;
  return text.split("\n").map(line => line.replace(marker, "")).join("\n").replace(/\\\n\s*/g, " ");
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
// gh api sends a POST when it is given a field or an input file, with no method named.
const writesReleases = /\bgh\s+release\s+(?:upload|create|edit|delete)\b|\bgh\s+api\b[^\n]*(?:(?:--method|-X)[\s=]*["']?(?:POST|PATCH|PUT|DELETE)\b|\s(?:-[fF]|--(?:raw-)?field\b|--input\b))|softprops\/action-gh-release|ncipollo\/release-action|actions\/github-script/;
const writesAlpha = (path, text) => namesAlpha.test(code(path, text)) && writesReleases.test(code(path, text));

/** Every workflow and every script in the folders scripts live in, with everything they run. */
function everything() {
  const files = new Set([...workflows, ...listed("deploy"), ...listed("desktop/scripts"), ...listed("cli/scripts"), ...listed(".circleci")]);
  for (const file of [...files]) for (const ran of runs(file)) files.add(ran);
  return [...files].sort();
}

/** A workflow's job, as the lines from its key to the next job's. */
function job(path, name, text) {
  const lines = code(path, text).split("\n");
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
    "gh api --method=DELETE repos/x/y/git/refs/tags/alpha",
    "gh api -XPATCH repos/x/y/releases/tags/alpha",
    // No method named: gh api sends a POST for a field or an input file.
    "gh api repos/x/y/releases -f tag_name=alpha",
    "gh api repos/x/y/releases -F tag_name=alpha -F prerelease=true",
    "gh api repos/x/y/releases --raw-field tag_name=alpha",
    "gh api repos/x/y/releases/tags/alpha --input release.json",
    "gh api \\\n    repos/x/y/releases \\\n    -f tag_name=alpha",
    "gh api -X PATCH \"$api/releases/$id\" # the one at releases/tags/alpha",
  ]) {
    const comment = planted.includes("#");
    assert.equal(writesAlpha("planted.sh", `run: |\n  ${planted}\n`), !comment, planted);
  }
  for (const reading of [
    "curl -sSf https://github.com/o/r/releases/download/alpha/channel.json",
    "gh api repos/x/y/releases/tags/alpha --jq .id",
    "gh release download alpha --pattern channel.json",
  ]) {
    assert.equal(writesAlpha("planted.sh", `run: |\n  ${reading}\n`), false, `${reading}: reading the feed isn't writing it`);
  }
});

/** A workflow's jobs, by name, in order. */
const jobs = path => [...code(path).split("jobs:\n")[1].matchAll(/^ {2}([\w-]+):$/gm)].map(([, name]) => name);

// Two files the Mac canary runs name latest-mac.yml without being able to put it on a release, which
// these checks show of their text. Build macOS app, which every Mac build calls, checks an unsigned
// app's feed, latest-mac.yml unless it builds a canary, in scratch folders it never hands on: it can't
// write to a release, and its artifacts are only the packages and the DMG candidates.
// test-update-zip.sh only reads a feed.
const keepsFeedsToItself = {
  ".github/workflows/macos-app-build.yml": text => {
    const problems = [];
    if (!/^permissions:\n {2}contents: read$/m.test(text)) problems.push("its permissions aren't contents: read");
    if (/contents: write|secrets[.:]/.test(text) || writesReleases.test(text)) problems.push("it can write to a release or reads secrets");
    for (const [, folder] of text.matchAll(/^\s+path: (.+)$/gm)) {
      if (!/^\$\{\{ runner\.temp \}\}\/(packages|signing-input)\/$/.test(folder)) problems.push(`it hands on ${folder}`);
    }
    for (const line of text.split("\n").filter(line => /update-feed\.mjs|latest-mac\.yml|canary-mac\.yml/.test(line))) {
      const folders = [...line.matchAll(/\$RUNNER_TEMP\/([\w-]+)/g)].map(([, folder]) => folder);
      if (!folders.length || folders.some(folder => !/^update(-[\w-]+)?$/.test(folder))) problems.push(`its feed goes outside its scratch folders: ${line.trim()}`);
    }
    return problems;
  },
  "desktop/scripts/test-update-zip.sh": text =>
    /\bgh\s|\bcurl\b|update-feed|>\s*"?\$feed\b/.test(text) || writesReleases.test(text) ? ["it does more than read the feed"] : [],
};

// Whether a workflow or script, and everything it runs, could put latest-mac.yml on a release: it runs
// update-feed.mjs without --channel canary, names latest-mac.yml other than to stop on finding it, or
// uploads files by a pattern. update-feed.mjs itself never writes latest-mac.yml for a canary build.
function uploadsLatestMac(start, texts) {
  const problems = [];
  for (const path of runs(start, texts)) {
    if (path === "desktop/scripts/update-feed.mjs") continue;
    if (keepsFeedsToItself[path]) {
      problems.push(...keepsFeedsToItself[path](code(path, texts?.[path] ?? read(path))).map(problem => `${path}: ${problem}`));
      continue;
    }
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
  assert.ok(canaries.includes(".github/workflows/canary-macos.yml"));
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

  // Build macOS app and test-update-zip.sh pass only while they keep their feeds to themselves.
  const build = read(".github/workflows/macos-app-build.yml");
  const planted = (path, text) => uploadsLatestMac(".github/workflows/planted-canary.yml", {
    ".github/workflows/planted-canary.yml": "jobs:\n  build:\n    uses: ./.github/workflows/macos-app-build.yml\n",
    [path]: text,
  });
  assert.deepEqual(planted(".github/workflows/macos-app-build.yml", build), []);
  for (const [from, to] of [
    ["path: ${{ runner.temp }}/signing-input/", "path: ${{ runner.temp }}/update/"],
    ["path: ${{ runner.temp }}/packages/", "path: ${{ runner.temp }}/"],
    ["permissions:\n  contents: read", "permissions:\n  contents: write"],
    ['"$RUNNER_TEMP/update/latest-mac.yml" "$RUNNER_TEMP/update-canary/canary-mac.yml"', '"$RUNNER_TEMP/update/latest-mac.yml" "$RUNNER_TEMP/signing-input/latest-mac.yml"'],
    ['node desktop/scripts/update-feed.mjs "$version" "$RUNNER_TEMP/update"', 'node desktop/scripts/update-feed.mjs "$version" "$RUNNER_TEMP/packages"'],
    ["      - run: npm ci\n", "      - run: npm ci\n      - run: gh release upload canary \"$RUNNER_TEMP/update/canary-mac.yml\"\n"],
  ]) {
    assert.ok(build.includes(from), from);
    assert.notDeepEqual(planted(".github/workflows/macos-app-build.yml", build.replace(from, to)), [], to);
  }
  const check = read("desktop/scripts/test-update-zip.sh");
  assert.deepEqual(planted("desktop/scripts/test-update-zip.sh", check), []);
  for (const line of ['gh release upload canary "$feed"', 'cp "$work/feed" "$feed"\necho x > "$feed"', 'node desktop/scripts/update-feed.mjs "$version" "$(dirname "$zip")" arm64']) {
    assert.notDeepEqual(planted("desktop/scripts/test-update-zip.sh", `${check}\n${line}\n`), [], line);
  }
});

const macCanary = ".github/workflows/canary-macos.yml";

test("the Mac canary runs only on main once MACOS_CANARY_ENABLED is set, and every job waits for that check", () => {
  assert.match(read(macCanary), /^on:\n {2}schedule:\n {4}- cron: '[\d* ]+'\n {2}workflow_dispatch:\n\n/m, "once a day and by hand, never for a pull request or a push");
  assert.match(code(macCanary), /^permissions:\n {2}contents: read$/m);
  assert.match(code(macCanary), /^concurrency:\n {2}group: canary-macos\n {2}cancel-in-progress: false$/m);
  assert.deepEqual(jobs(macCanary), ["version", "build", "sign", "verify", "publish"]);
  const version = job(macCanary, "version");
  // A repository variable: a job's condition can't read an environment's variables.
  assert.match(version, /^ {4}if: github\.repository == 'your-space-ai\/your-space' && github\.ref == 'refs\/heads\/main' && vars\.MACOS_CANARY_ENABLED == 'true'$/m);
  assert.match(version, /^ {10}test "\$GITHUB_REF" = refs\/heads\/main\n {10}deploy\/mac-canary-version\.sh$/m);
  assert.match(version, /^ {10}fetch-depth: 0$/m, "the version script checks the build's commit against main's history");
  for (const name of ["build", "sign", "verify", "publish"]) assert.match(job(macCanary, name), /^ {4}needs: (?:version|\[version, [\w-]+\])$/m, name);
  assert.match(job(macCanary, "build"), /^ {4}if: needs\.version\.outputs\.build == 'true'$/m);
  // The canary's commit and version, from the version job, never inline in a script.
  assert.match(job(macCanary, "build"), /^ {6}ref: \$\{\{ needs\.version\.outputs\.commit \}\}\n {6}version: \$\{\{ needs\.version\.outputs\.version \}\}$/m);
  // The jobs after it check out that commit too, so what signs, checks and publishes a build is what
  // built it; only the version job reads main's newest commit.
  for (const name of ["sign", "verify", "publish"]) {
    const checkouts = [...job(macCanary, name).matchAll(/^ {6}- uses: actions\/checkout@.*\n {8}with:\n((?: {10}.*\n)+)/gm)].map(([, options]) => options);
    assert.deepEqual(checkouts, ["          ref: ${{ needs.version.outputs.commit }}\n          persist-credentials: false\n"], name);
  }
  assert.doesNotMatch(job(macCanary, "version"), /^ {10}ref:/m);
  for (const name of jobs(macCanary)) {
    for (const [, script] of job(macCanary, name).matchAll(/^ {8}run: (\|\n(?: {10}.*\n?)+|.+)/gm)) assert.doesNotMatch(script, /\$\{\{/, name);
  }
});

test("only the Mac canary's sign job reaches the macos-canary environment, and it runs no npm packages", () => {
  const environments = workflows.flatMap(path => jobs(path).flatMap(name => [...job(path, name).matchAll(/^ {4}environment: (\S+)$/gm)].map(([, environment]) => `${path} ${name} ${environment}`)));
  assert.deepEqual(environments.filter(entry => entry.endsWith(" macos-canary")), [`${macCanary} sign macos-canary`]);
  assert.deepEqual(environments.filter(entry => entry.startsWith(macCanary)), [`${macCanary} sign macos-canary`], "the release's environment isn't used here");
  for (const name of jobs(macCanary).filter(name => name !== "sign")) assert.doesNotMatch(job(macCanary, name), /secrets[.:]|environment:/, `${name} reads no secrets`);
  assert.doesNotMatch(code(macCanary), /secrets: inherit/, "the unsigned build it calls gets no secrets");

  // Neither the job nor anything it runs starts npm or npx, and setup-node restores no package cache.
  const sign = job(macCanary, "sign");
  const npm = /(?:^|[\s"'(;&|])(?:npm|npx)(?=$|[\s"');&|])/m;
  for (const path of runs("sign-job.yml", { "sign-job.yml": sign })) assert.doesNotMatch(code(path, path === "sign-job.yml" ? sign : undefined), npm, path);
  assert.match(sign, /^ {10}package-manager-cache: false$/m);
  assert.doesNotMatch(sign, /^ +cache:/m);
  assert.match(sign, /desktop\/scripts\/notarize-macos\.sh --update-only "\$\{candidates\[@\]\}" "\$out"\n {10}node desktop\/scripts\/update-feed\.mjs --channel canary "\$VERSION" "\$out" arm64 x64$/m);
  assert.match(sign, /^ {8}if: always\(\)\n {8}run: \|\n {10}security delete-keychain /m, "the keychain and keys are always deleted");
  for (const planted of ["      - run: npm ci", "        run: npx --yes something", '        run: node x.mjs && npm run build', "        with:\n          cache: npm"]) {
    const text = `${sign}\n${planted}\n`;
    assert.ok(npm.test(text) || /^ +cache:/m.test(text), planted);
  }
  assert.doesNotMatch(code("planted.yml", "          package-manager-cache: false\n      # no npm packages"), npm, "a comment or the cache setting isn't npm");
});

test("the Mac canary uploads only its build's two ZIPs and canary-mac.yml, from its publish job", () => {
  for (const name of jobs(macCanary)) assert.equal(/contents: write/.test(job(macCanary, name)), name === "publish", name);
  const publish = job(macCanary, "publish");
  assert.match(publish, /^ {8}run: deploy\/mac-canary-publish\.sh "\$VERSION" "\$RUNNER_TEMP\/notarized"$/m);
  assert.doesNotMatch(publish, /environment:/);
  // What it uploads, it names: one gh release upload, called for the two ZIPs and then canary-mac.yml.
  const script = code("deploy/mac-canary-publish.sh");
  assert.equal(script.match(/gh release upload/g).length, 1);
  assert.match(script, /^zips=\("your-space-macos-arm64-\$version\.zip" "your-space-macos-x64-\$version\.zip"\)$/m);
  assert.deepEqual([...script.matchAll(/^ *retry upload (.+)$/gm)].map(([, files]) => files), ['"${zips[@]}"', "canary-mac.yml"]);
  assert.doesNotMatch(script, /\bgh api\b[^\n]*uploads\.github\.com/);
});

test("each canary workflow checks and deletes only its own files on the canary prerelease", () => {
  const linuxOwn = read(".github/workflows/canary.yml").match(/^ *own='([^']+)'$/m)[1];
  const macOwn = `canary-mac\\.yml|${read("deploy/mac-canary-publish.sh").match(/^own_zip='([^']+)'$/m)[1]}`;
  const owned = (own, names) =>
    execFileSync("bash", ["-c", 'own=$1; shift; for name; do if [[ $name =~ ^($own)$ ]]; then echo "$name"; fi; done', "-", own, ...names], { encoding: "utf8" }).split("\n").filter(Boolean);
  const build = "0.1.0-alpha.2.canary.20261201.60";
  const linux = ["your-space.tar.gz", `your-space-ai-cli-${build}.tgz`, "your-space-linux-x64", "your-space-linux-arm64", "your-space-linux-licenses.txt", "SHA256SUMS", "channel.json"];
  const mac = [`your-space-macos-arm64-${build}.zip`, `your-space-macos-x64-${build}.zip`, "canary-mac.yml"];
  const neither = ["latest-mac.yml", `your-space-macos-arm64-${build}.dmg`, `your-space-macos-x64-${build}.zip.sha256`, "xcanary-mac.yml"];
  assert.deepEqual(owned(linuxOwn, [...linux, ...mac, ...neither]), linux);
  assert.deepEqual(owned(macOwn, [...linux, ...mac, ...neither]), mac);
  // The Mac canary deletes in two places only: a half-uploaded file of a name it is about to upload,
  // and a Mac ZIP canary-mac.yml doesn't list. Its tests (mac-canary.test.mjs) check both.
  assert.equal(code("deploy/mac-canary-publish.sh").match(/--method DELETE/g).length, 2);
  assert.doesNotMatch(code("deploy/mac-canary-publish.sh"), /--method PATCH|--method POST|gh release (?:create|edit|delete)\b/, "it never creates, edits or deletes the prerelease");
});
