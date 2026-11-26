import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { configureUpdater, createUpdates, readUpdateSettings } from "../src/updates.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), "ys-updates-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in for electron-updater's autoUpdater.
class FakeUpdater extends EventEmitter {
  constructor(results = []) {
    super();
    this.results = results;
    this.calls = [];
    this.computeFinalHeaders = headers => ({ ...headers, "x-user-staging-id": "per-install-id" });
  }
  async checkForUpdates() {
    this.calls.push("check");
    const next = this.results.shift();
    if (next instanceof Error) throw next;
    return next ?? { isUpdateAvailable: false, updateInfo: { version: "0.1.0-alpha.1" } };
  }
  async downloadUpdate() {
    this.calls.push("download");
    if (this.downloadError) throw this.downloadError;
    this.emit("download-progress", { percent: 50 });
  }
  quitAndInstall() { this.calls.push("quitAndInstall"); }
}

function timers() {
  const items = [];
  return {
    items,
    setTimeout: (fn, ms) => { const item = { fn, ms, kind: "once" }; items.push(item); return item; },
    setInterval: (fn, ms) => { const item = { fn, ms, kind: "every" }; items.push(item); return item; },
    clearTimeout: item => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); },
    clearInterval: item => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); },
  };
}

function setup(t, dir, { updater = new FakeUpdater(), answers = {} } = {}) {
  const shown = [];
  const installs = [];
  const clock = timers();
  const ui = {
    unavailable: async () => { shown.push("unavailable"); },
    upToDate: async () => { shown.push("up to date"); },
    busy: async () => { shown.push("busy"); },
    failed: async (error, stage) => { shown.push(`failed ${stage}: ${error.message}`); },
    available: async (info, manual) => { shown.push(`available ${info.version}${manual ? " (asked)" : ""}`); return answers.download ?? true; },
    downloaded: async info => { shown.push(`ready ${info.version}`); return answers.restart ?? true; },
    progress: fraction => shown.push(`progress ${fraction}`),
  };
  const updates = createUpdates({
    load: () => updater, settingsFile: join(dir, "updates.json"), ui, timers: clock,
    beforeInstall: async install => { installs.push("stopped workspace"); install(); }, delay: 30_000, interval: 86_400_000,
  });
  t.after(() => updates.stop());
  return { updates, updater, shown, installs, clock };
}

const available = version => ({ isUpdateAvailable: true, updateInfo: { version, files: [] } });

test("checks automatically by default, shortly after launch and then daily", async t => {
  const dir = await folder(t);
  const { updates, clock, updater } = setup(t, dir);
  assert.deepEqual(await readUpdateSettings(join(dir, "updates.json")), { automatic: true });
  await updates.start();
  assert.equal(updates.automatic, true);
  assert.deepEqual(clock.items.map(({ kind, ms }) => [kind, ms]), [["once", 30_000], ["every", 86_400_000]]);
  await clock.items[0].fn();
  assert.deepEqual(updater.calls, ["check"]);
});

test("turning automatic checks off makes no request until the owner checks by hand", async t => {
  const dir = await folder(t);
  const { updates, clock, updater, shown } = setup(t, dir);
  await updates.start();
  await updates.setAutomatic(false);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "updates.json"), "utf8")), { automatic: false });
  assert.deepEqual(clock.items, []);

  const later = setup(t, dir);
  await later.updates.start();
  assert.equal(later.updates.automatic, false);
  assert.deepEqual(later.clock.items, []);
  assert.deepEqual(later.updater.calls, []);

  await updates.check();
  assert.deepEqual(updater.calls, ["check"]);
  assert.deepEqual(shown, ["up to date"]);
  await updates.setAutomatic(true);
  assert.equal(clock.items.length, 2);
});

test("an automatic check stays quiet unless there is an update, and asks once per version", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater([new Error("offline"), { isUpdateAvailable: false, updateInfo: { version: "0.1.0" } },
    available("0.1.0-alpha.2"), available("0.1.0-alpha.2"), available("0.1.0-alpha.2")]);
  const { updates, clock, shown } = setup(t, dir, { updater, answers: { download: false } });
  await updates.start();
  const automatic = clock.items[0].fn;
  await automatic();
  await automatic();
  assert.deepEqual(shown, []);
  await automatic();
  await automatic();
  assert.deepEqual(shown, ["available 0.1.0-alpha.2"], "Not Now holds for the rest of the session");
  await updates.check();
  assert.deepEqual(shown, ["available 0.1.0-alpha.2", "available 0.1.0-alpha.2 (asked)"]);
  assert.deepEqual(updater.calls, ["check", "check", "check", "check", "check"]);
});

test("Check for Updates… reports each outcome, and runs only in the installed app", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater([new Error("offline")]);
  const { updates, shown } = setup(t, dir, { updater });
  await updates.check();
  await updates.check();
  assert.deepEqual(shown, ["failed check: offline", "up to date"]);

  const source = createUpdates({ load: () => null, settingsFile: join(dir, "other.json"), beforeInstall: async () => {},
    ui: { unavailable: async () => shown.push("unavailable") }, timers: timers() });
  await source.check();
  assert.equal(shown.at(-1), "unavailable");

  let attempts = 0;
  const broken = createUpdates({
    load: () => { if (++attempts === 1) throw new Error("missing updater"); return new FakeUpdater(); },
    settingsFile: join(dir, "broken.json"), beforeInstall: async () => {}, timers: timers(),
    ui: { failed: async (error, stage) => shown.push(`failed ${stage}: ${error.message}`), upToDate: async () => shown.push("up to date"), progress() {} },
  });
  await broken.check();
  await broken.check();
  assert.deepEqual(shown.slice(-2), ["failed check: missing updater", "up to date"]);
});

test("downloads only when the owner agrees, then stops the workspace before restarting into the update", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater([available("0.1.0-alpha.2")]);
  const { updates, shown, installs } = setup(t, dir, { updater });
  await updates.check();
  assert.deepEqual(updater.calls, ["check", "download", "quitAndInstall"]);
  assert.deepEqual(shown, ["available 0.1.0-alpha.2 (asked)", "progress 0.5", "progress -1", "ready 0.1.0-alpha.2"]);
  assert.deepEqual(installs, ["stopped workspace"]);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
});

test("offers the restart only once Squirrel.Mac has staged the update, and reports one it rejects", async t => {
  const dir = await folder(t);
  const squirrel = new EventEmitter();
  const updater = new FakeUpdater([available("0.1.0-alpha.2"), available("0.1.0-alpha.2")]);
  const shown = [];
  const installs = [];
  const clock = timers();
  const updates = createUpdates({
    load: () => updater, settingsFile: join(dir, "updates.json"), squirrel, timers: clock, staging: 300_000,
    beforeInstall: async install => { installs.push("stopped workspace"); install(); },
    ui: {
      available: async () => true, downloaded: async () => true, progress() {},
      failed: async (error, stage) => { shown.push(`failed ${stage}: ${error.message}`); },
    },
  });
  const rejected = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  squirrel.emit("error", new Error("Code signature did not pass validation"));
  await rejected;
  assert.deepEqual(shown, ["failed install: Code signature did not pass validation"]);
  assert.deepEqual(installs, []);
  assert.equal(squirrel.listenerCount("error"), 0);

  const accepted = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clock.items.at(-1).ms, 300_000);
  squirrel.emit("update-downloaded", {}, "notes", "0.1.0-alpha.2");
  await accepted;
  assert.deepEqual(installs, ["stopped workspace"]);
  assert.deepEqual(updater.calls.at(-1), "quitAndInstall");
});

test("a check while the owner decides waits, and any answer frees the next check", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater([available("0.1.0-alpha.2"), available("0.1.0-alpha.3"), available("0.1.0-alpha.3")]);
  let answer;
  const shown = [];
  const updates = createUpdates({
    load: () => updater, settingsFile: join(dir, "updates.json"), timers: timers(), beforeInstall: async () => {},
    ui: {
      available: info => { shown.push(`available ${info.version}`); return new Promise((resolve, reject) => { answer = { resolve, reject }; }); },
      busy: async () => shown.push("busy"), failed: async () => {}, downloaded: async () => false, progress() {},
    },
  });
  const first = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  await updates.check();
  assert.deepEqual(shown, ["available 0.1.0-alpha.2", "busy"]);
  assert.deepEqual(updater.calls, ["check"], "the pending update stays the one the owner is asked about");
  answer.resolve(false);
  await first;
  const second = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  answer.reject(new Error("dialog failed"));
  await assert.rejects(second, /dialog failed/);
  const third = updates.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shown.at(-1), "available 0.1.0-alpha.3", "an error in the prompt doesn't block later checks");
  answer.resolve(false);
  await third;
});

test("the file keeps the owner's last choice when changes overlap", async t => {
  const dir = await folder(t);
  const { updates } = setup(t, dir);
  await Promise.all([updates.setAutomatic(false), updates.setAutomatic(true), updates.setAutomatic(false)]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "updates.json"), "utf8")), { automatic: false });
  assert.equal(updates.automatic, false);
});

test("Later keeps the downloaded update for the next check or quit, and a failed download can be retried", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater([available("0.1.0-alpha.2"), available("0.1.0-alpha.2")]);
  updater.downloadError = new Error("connection reset");
  const { updates, shown, installs } = setup(t, dir, { updater, answers: { restart: false } });
  await updates.check();
  assert.equal(shown.at(-1), "failed download: connection reset");
  delete updater.downloadError;
  await updates.check();
  assert.equal(shown.at(-1), "ready 0.1.0-alpha.2");
  await updates.check();
  assert.deepEqual(updater.calls, ["check", "download", "check", "download"], "a ready update is offered, not fetched again");
  assert.equal(shown.at(-1), "ready 0.1.0-alpha.2");
  assert.deepEqual(installs, []);
});

// The real electron-updater, with the packaged app-update.yml and feeds from update-feed.mjs, behind a
// stand-in for GitHub: each release's latest-mac.yml and the releases.atom feed, newest first, or the
// fixture, in the form GitHub serves it. The rolling `alpha` and `canary` prereleases, which hold the
// channels' feeds, have no release feed of their own; the alpha feed fixture is served at its fixed
// address. Query strings,
// such as the generic provider's noCache, don't change what is served.
const fixtures = join(desktop, "../shared/release-channels/fixtures");
const alphaFeed = "https://github.com/your-space-ai/your-space/releases/download/alpha";

async function github(t, tags, { atom: recorded } = {}) {
  const dir = await folder(t);
  const feeds = new Map([[`${alphaFeed}/latest-mac.yml`, await readFile(join(fixtures, "alpha/latest-mac.yml"), "utf8")]]);
  for (const tag of tags.filter(tag => tag.startsWith("v"))) {
    const version = tag.slice(1);
    const release = join(dir, tag);
    await mkdir(release);
    for (const arch of ["arm64", "x64"]) await writeFile(join(release, `your-space-macos-${arch}-${version}.zip`), arch + version);
    execFileSync(process.execPath, [join(desktop, "scripts/update-feed.mjs"), version, release, "arm64", "x64"]);
    feeds.set(`https://github.com/your-space-ai/your-space/releases/download/${tag}/latest-mac.yml`,
      await readFile(join(release, "latest-mac.yml"), "utf8"));
  }
  const atom = recorded ?? `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    tags.map(tag => `<entry><id>${tag}</id><title>Your Space ${tag.slice(1)}</title>` +
      `<link rel="alternate" type="text/html" href="https://github.com/your-space-ai/your-space/releases/tag/${tag}"/>` +
      `<content type="html">notes</content></entry>`).join("") + "</feed>";
  const requests = [];
  const executor = {
    async request(options) {
      const url = `${options.protocol}//${options.hostname}${options.path}`.replace(/\?.*$/, "");
      requests.push({ url, headers: { ...options.headers } });
      if (url === "https://github.com/your-space-ai/your-space/releases.atom") return atom;
      if (url === "https://github.com/your-space-ai/your-space/releases/latest") {
        // GitHub's latest release is never a prerelease.
        return JSON.stringify({ tag_name: tags.find(tag => tag.startsWith("v") && !tag.includes("-")) });
      }
      if (feeds.has(url)) return feeds.get(url);
      throw Object.assign(new Error("Not found: " + url), { statusCode: 404 });
    },
  };
  const { AppUpdater } = require("electron-updater/out/AppUpdater.js");
  // An app of a version, reading the packaged app-update.yml (GitHub's releases) or the feed given.
  function app(version, feed) {
    const adapter = {
      version, name: "Your Space", isPackaged: true,
      appUpdateConfigPath: join(desktop, "app-update.yml"), userDataPath: dir, baseCachePath: dir,
      whenReady: async () => {}, relaunch() {}, quit() {}, onQuit() {},
    };
    const updater = configureUpdater(new AppUpdater(null, adapter));
    updater.logger = null;
    // As on a Mac, whatever this test runs on. setFeedURL makes its provider with these, so they come first.
    updater._testOnlyOptions = { platform: "darwin" };
    updater.httpExecutor = executor;
    if (feed) updater.setFeedURL(feed);
    return updater;
  }
  return { dir, requests, app };
}

test("electron-updater finds a newer alpha, picks the ZIP for each Mac and sends no installation ID", async t => {
  const next = "0.1.0-alpha.2";
  const { dir, requests, app } = await github(t, ["v0.1.0-alpha.2", "v0.1.0-alpha.1"]);
  const updater = app("0.1.0-alpha.1");
  const result = await updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.updateInfo.version, next);
  assert.equal(result.downloadPromise, null, "nothing downloads until the owner agrees");
  assert.deepEqual(requests.map(r => r.url), [
    "https://github.com/your-space-ai/your-space/releases.atom",
    `https://github.com/your-space-ai/your-space/releases/download/v${next}/alpha-mac.yml`,
    `https://github.com/your-space-ai/your-space/releases/download/v${next}/latest-mac.yml`,
  ]);
  for (const { headers } of requests) assert.ok(!Object.keys(headers ?? {}).some(name => /staging/i.test(name)), JSON.stringify(headers));
  assert.equal(existsSync(join(dir, ".updaterId")), false);

  const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
  const files = updater.updateInfoAndProvider.provider.resolveFiles(result.updateInfo);
  const pick = arm => MacUpdater.filterFilesForArch(files, arm).map(file => file.url.pathname.split("/").pop());
  assert.deepEqual(pick(true), [`your-space-macos-arm64-${next}.zip`]);
  assert.deepEqual(pick(false), [`your-space-macos-x64-${next}.zip`]);
  assert.match(files[0].info.sha512, /^[A-Za-z0-9+/]{86}==$/);

  assert.equal((await app(next).checkForUpdates()).isUpdateAvailable, false);
});

test("electron-updater offers an alpha app the stable release and betas, a beta app no alpha, a stable app no prerelease", async t => {
  const offered = async (tags, version) => {
    const result = await (await github(t, tags)).app(version).checkForUpdates();
    return result.isUpdateAvailable ? result.updateInfo.version : null;
  };
  assert.equal(await offered(["v0.1.0", "v0.1.0-alpha.2", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0");
  assert.equal(await offered(["v0.1.0-beta.1", "v0.1.0-alpha.2"], "0.1.0-alpha.2"), "0.1.0-beta.1");
  assert.equal(await offered(["v0.1.0-alpha.3", "v0.1.0-beta.1"], "0.1.0-beta.1"), null);
  assert.equal(await offered(["v0.2.0-alpha.1", "v0.1.1", "v0.1.0"], "0.1.0"), "0.1.1");
});

test("electron-updater skips the rolling alpha and canary prereleases, wherever they are in the feed", async t => {
  const offered = async (tags, version) => {
    const result = await (await github(t, tags)).app(version).checkForUpdates();
    return result.isUpdateAvailable ? result.updateInfo.version : null;
  };
  assert.equal(await offered(["canary", "v0.1.0-alpha.2", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0-alpha.2");
  assert.equal(await offered(["alpha", "canary", "v0.1.0-alpha.2", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0-alpha.2");
  assert.equal(await offered(["canary", "alpha", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), null);
  assert.equal(await offered(["alpha", "canary", "v0.1.0-beta.2", "v0.1.0-beta.1"], "0.1.0-beta.1"), "0.1.0-beta.2");
  assert.equal(await offered(["canary", "alpha", "v0.1.1", "v0.1.0"], "0.1.0"), "0.1.1");
  assert.equal(await offered(["v0.1.0-alpha.2", "alpha", "canary", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0-alpha.2");
});

test("the alpha.1 app, reading the releases feed fixture, finds the newest release and never a canary's files", async t => {
  const atom = await readFile(join(fixtures, "releases.atom"), "utf8");
  const { requests, app } = await github(t, ["v0.1.0-alpha.2", "v0.1.0-alpha.1"], { atom });
  const result = await app("0.1.0-alpha.1").checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.updateInfo.version, "0.1.0-alpha.2");
  assert.deepEqual(requests.map(r => r.url), [
    "https://github.com/your-space-ai/your-space/releases.atom",
    "https://github.com/your-space-ai/your-space/releases/download/v0.1.0-alpha.2/alpha-mac.yml",
    "https://github.com/your-space-ai/your-space/releases/download/v0.1.0-alpha.2/latest-mac.yml",
  ]);
  assert.ok(!requests.some(r => /\/download\/(alpha|canary)\//.test(r.url)));
});

test("the generic provider at the alpha feed reads latest-mac.yml and follows its full links into the v release, with downgrades off", async t => {
  const recorded = JSON.parse(await readFile(join(fixtures, "alpha/channel.json"), "utf8")).version;
  const canary = JSON.parse(await readFile(join(fixtures, "canary/channel.json"), "utf8")).version;
  const { requests, app } = await github(t, []);
  const feed = { provider: "generic", url: `${alphaFeed}/` };
  const updater = app("0.1.0-alpha.1", feed);
  const result = await updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.updateInfo.version, recorded);
  // No channel: only latest-mac.yml, at the feed's fixed address, and no releases feed.
  assert.deepEqual(requests.map(r => r.url), [`${alphaFeed}/latest-mac.yml`]);
  assert.equal(updater.channel, null);
  assert.equal(updater.allowDowngrade, false);

  const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
  const files = updater.updateInfoAndProvider.provider.resolveFiles(result.updateInfo);
  const release = `https://github.com/your-space-ai/your-space/releases/download/v${recorded}`;
  assert.deepEqual(files.map(file => file.url.href), [`${release}/your-space-macos-arm64-${recorded}.zip`, `${release}/your-space-macos-x64-${recorded}.zip`]);
  const pick = arm => MacUpdater.filterFilesForArch(files, arm).map(file => file.url.href);
  assert.deepEqual(pick(true), [`${release}/your-space-macos-arm64-${recorded}.zip`]);
  assert.deepEqual(pick(false), [`${release}/your-space-macos-x64-${recorded}.zip`]);
  assert.match(files[0].info.sha512, /^[A-Za-z0-9+/]{86}==$/);

  // Nothing for an app already on the release, or on a later canary, which contains -alpha. and sorts after it.
  for (const version of [recorded, canary, "0.1.0-alpha.3", "0.1.0"]) {
    const later = app(version, feed);
    assert.equal((await later.checkForUpdates()).isUpdateAvailable, false, version);
    assert.equal(later.allowDowngrade, false);
  }
});
