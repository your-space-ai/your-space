import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isCanary } from "../../cli/src/version.ts";
import { buildChannel, channelFeed, configureUpdater, createUpdates, isCanaryBuild, readUpdateSettings } from "../src/updates.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const canaryBuild = "0.1.0-alpha.2.canary.20261201.60";

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), "ys-updates-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const settle = () => new Promise(resolve => setImmediate(resolve));
// Waits for the updater's file and network work, which takes more than a turn of the event loop.
async function until(condition, ms = 10_000) {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(condition(), "timed out waiting");
}

// A stand-in for a cancellation token, as each check that finds an update returns one.
class Token {
  cancelled = false;
  cancel() { this.cancelled = true; this.onCancel?.(); }
}

// A stand-in for electron-updater's autoUpdater.
class FakeUpdater extends EventEmitter {
  constructor(results = []) {
    super();
    this.results = results;
    this.calls = [];
    this.feeds = [];
    this.computeFinalHeaders = headers => ({ ...headers, "x-user-staging-id": "per-install-id" });
  }
  setFeedURL(feed) { this.feeds.push(feed); }
  async checkForUpdates() {
    this.calls.push("check");
    const next = this.results.shift();
    if (next instanceof Error) throw next;
    // Nothing newer: the newest build of the feed it was last pointed at.
    return next ?? { isUpdateAvailable: false, updateInfo: { version: this.feeds.at(-1)?.channel === "canary" ? canaryBuild : "0.1.0-alpha.1" } };
  }
  async downloadUpdate(token) {
    this.calls.push("download");
    if (this.downloadError) throw this.downloadError;
    this.emit("download-progress", { percent: 50 });
    if (this.downloadGate) {
      await new Promise((resolve, reject) => {
        this.release = resolve;
        token.onCancel = () => reject(Object.assign(new Error("cancelled"), { name: "CancellationError" }));
      });
    }
  }
  quitAndInstall() { this.calls.push("quitAndInstall"); }
}

// A stand-in for Squirrel.Mac (Electron's autoUpdater): checkForUpdates() stages the update, then it
// emits update-downloaded, or error, at once or when the test says.
class FakeSquirrel extends EventEmitter {
  constructor({ answer = "staged" } = {}) {
    super();
    this.answer = answer;
    this.calls = [];
  }
  setFeedURL(feed) { this.feed = feed; this.calls.push("setFeedURL"); }
  checkForUpdates() {
    this.calls.push("stage");
    if (this.answer === "staged") queueMicrotask(() => this.emit("update-downloaded", {}));
    else if (this.answer instanceof Error) queueMicrotask(() => this.emit("error", this.answer));
    // A refusal reported at once, before checkForUpdates() returns.
    else if (this.answer === "throws") throw new Error("Squirrel.Mac refused at once");
    else if (this.answer === "emits") this.emit("error", new Error("Squirrel.Mac refused at once"));
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

function recordingUi(shown, answers = {}) {
  return {
    unavailable: async () => { shown.push("unavailable"); },
    upToDate: async channel => { shown.push(`up to date on ${channel}`); },
    busy: async () => { shown.push("busy"); },
    failed: async (error, stage, channel) => {
      shown.push(`failed ${stage}${channel ? ` on ${channel}` : ""}: ${error.message}`);
      answers.failed?.(error);
    },
    available: async (info, manual) => {
      shown.push(`available ${info.version}${manual ? " (asked)" : ""}`);
      return typeof answers.download === "function" ? answers.download(info) : answers.download ?? true;
    },
    downloaded: async info => {
      shown.push(`ready ${info.version}`);
      return typeof answers.restart === "function" ? answers.restart(info) : answers.restart ?? true;
    },
    dropped: async info => { shown.push(`dropped ${info.version}`); },
    progress: fraction => shown.push(`progress ${fraction}`),
  };
}

function setup(t, dir, { updater = new FakeUpdater(), answers = {}, version = "0.1.0-alpha.1", squirrel } = {}) {
  const shown = [];
  const installs = [];
  const clock = timers();
  const updates = createUpdates({
    load: () => updater, settingsFile: join(dir, "updates.json"), version, ui: recordingUi(shown, answers), timers: clock, squirrel,
    beforeInstall: async install => { installs.push("stopped workspace"); install(); }, delay: 30_000, interval: 86_400_000,
  });
  t.after(() => updates.stop());
  return { updates, updater, shown, installs, clock };
}

const available = version => ({ isUpdateAvailable: true, updateInfo: { version, files: [] }, cancellationToken: new Token() });
const saved = async dir => JSON.parse(await readFile(join(dir, "updates.json"), "utf8"));

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

test("a release build with no channel stored stores Alpha at its first start, a canary build Canary, and a stored channel stays", async t => {
  const dir = await folder(t);
  const release = setup(t, dir, { version: "0.1.0-alpha.2" });
  assert.equal(release.updates.channel, "alpha");
  await release.updates.start();
  assert.deepEqual(await saved(dir), { automatic: true, channel: "alpha" }, "stored at once, with no check");
  assert.deepEqual(release.updater.calls, []);
  await release.updates.check();
  assert.deepEqual(release.updater.feeds, [channelFeed("alpha")]);

  // An installation updated from alpha.1 stores only automatic checks, and only once the owner changed them.
  await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: false }));
  const canary = setup(t, dir, { version: canaryBuild });
  await canary.updates.start();
  assert.deepEqual(await saved(dir), { automatic: false, channel: "canary" });
  assert.equal(canary.updates.channel, "canary");
  await canary.updates.check();
  assert.deepEqual(canary.updater.feeds, [channelFeed("canary")]);

  // A canary installed by hand over an app set to Alpha stays on Alpha until the owner chooses Canary;
  // a release installed over one set to Canary stays on Canary.
  for (const [stored, version] of [["alpha", canaryBuild], ["canary", "0.1.0-alpha.3"]]) {
    await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: true, channel: stored }));
    const later = setup(t, dir, { version });
    await later.updates.start();
    assert.equal(later.updates.channel, stored);
    assert.deepEqual(await saved(dir), { automatic: true, channel: stored });
  }

  // Only a file with no channel in it counts as none stored. One that names a channel this build
  // doesn't know, or can't be read, doesn't, and one that can't be read at all turns automatic checks off.
  await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: false, channel: "beta" }));
  assert.deepEqual(await readUpdateSettings(join(dir, "updates.json")), { automatic: false, unreadable: true });
  for (const damaged of ["{", "null", "[]", '"alpha"']) {
    await writeFile(join(dir, "updates.json"), damaged);
    assert.deepEqual(await readUpdateSettings(join(dir, "updates.json")), { automatic: false, unreadable: true }, damaged);
  }
  await rm(join(dir, "updates.json"));
  await mkdir(join(dir, "updates.json"));
  assert.deepEqual(await readUpdateSettings(join(dir, "updates.json")), { automatic: false, unreadable: true }, "a read error");
});

test("a settings file that can't be read is left as it is: the session follows Alpha and checks only when asked", async t => {
  for (const damaged of ["{", JSON.stringify({ automatic: true, channel: "beta" })]) {
    const dir = await folder(t);
    await writeFile(join(dir, "updates.json"), damaged);
    const { updates, updater, clock } = setup(t, dir, { version: canaryBuild });
    await updates.start();
    assert.equal(updates.channel, "alpha", "a canary build doesn't go back to Canary");
    assert.equal(await readFile(join(dir, "updates.json"), "utf8"), damaged, "nothing is written at start");
    await updates.check();
    assert.deepEqual(updater.feeds, [channelFeed("alpha")]);
    if (damaged === "{") assert.deepEqual(clock.items, [], "no automatic check while the file can't be read");
    else assert.equal(clock.items.length, 2);
    // The owner's next choice replaces the file with what the menu shows, Alpha included.
    await updates.setAutomatic(true);
    assert.deepEqual(await saved(dir), { automatic: true, channel: "alpha" });
  }
  // A read error, such as a folder in the file's place, is the same.
  const dir = await folder(t);
  await mkdir(join(dir, "updates.json"));
  const { updates } = setup(t, dir, { version: canaryBuild });
  await updates.start();
  assert.equal(updates.channel, "alpha");
  assert.equal(updates.automatic, false);
});

test("the first start still applies the build's channel and schedules checks when it can't save it", async t => {
  const dir = await folder(t);
  await writeFile(join(dir, "blocked"), "a file where the folder should be");
  const clock = timers();
  const updates = createUpdates({ load: () => null, settingsFile: join(dir, "blocked/updates.json"), version: canaryBuild,
    ui: recordingUi([]), timers: clock, beforeInstall: async () => {} });
  t.after(() => updates.stop());
  await assert.rejects(updates.start());
  assert.equal(updates.channel, "canary");
  assert.equal(clock.items.length, 2);
});

test("a canary build is one whose version has a canary prerelease identifier, as the CLI decides", () => {
  for (const version of [canaryBuild, "0.1.1-0.canary.20261125.42", "0.1.0-alpha.1.canary.20261125.42+build.7",
    "0.1.0-alpha.2", "0.1.0", "0.1.0-canaryish.1", "0.1.0-alpha.1+canary", "canary", "0.1.0-alpha.01.canary.1"]) {
    assert.equal(isCanaryBuild(version), isCanary(version), version);
    assert.equal(buildChannel(version), isCanary(version) ? "canary" : "alpha", version);
  }
});

test("each channel's feed is the generic provider at its fixed address, with the channel in the feed's options", () => {
  assert.deepEqual(channelFeed("alpha"), { provider: "generic", url: "https://github.com/your-space-ai/your-space/releases/download/alpha/", channel: undefined });
  assert.deepEqual(channelFeed("canary"), { provider: "generic", url: "https://github.com/your-space-ai/your-space/releases/download/canary/", channel: "canary" });
});

test("turning automatic checks off makes no request until the owner checks by hand, and keeps the channel", async t => {
  const dir = await folder(t);
  const { updates, clock, updater, shown } = setup(t, dir);
  await updates.start();
  await updates.setChannel("canary");
  await updates.setAutomatic(false);
  assert.deepEqual(await saved(dir), { automatic: false, channel: "canary" });
  assert.deepEqual(clock.items, []);

  const later = setup(t, dir);
  await later.updates.start();
  assert.equal(later.updates.automatic, false);
  assert.equal(later.updates.channel, "canary");
  assert.deepEqual(later.clock.items, []);
  assert.deepEqual(later.updater.calls, []);

  await updates.check();
  assert.deepEqual(updater.calls, ["check"]);
  assert.deepEqual(shown, ["up to date on canary"]);
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
  assert.deepEqual(shown, ["failed check on alpha: offline", "up to date on alpha"]);

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
  assert.equal(updater.autoInstallOnAppQuit, false, "nothing goes to Squirrel.Mac until the owner restarts or quits");
  assert.equal(updater.allowDowngrade, false);
});

test("Restart Now stages the update with Squirrel.Mac first, and stops the workspace only once it is staged", async t => {
  const dir = await folder(t);
  const squirrel = new FakeSquirrel({ answer: new Error("Code signature did not pass validation") });
  const updater = new FakeUpdater([available("0.1.0-alpha.2"), available("0.1.0-alpha.2")]);
  const { updates, shown, installs, clock } = setup(t, dir, { updater, squirrel });
  await updates.check();
  assert.deepEqual(shown.slice(-4), ["ready 0.1.0-alpha.2", "progress 2", "progress -1",
    "failed install on alpha: Code signature did not pass validation"], "the Dock's bar moves while Squirrel.Mac stages");
  assert.deepEqual(squirrel.calls, ["stage"]);
  assert.deepEqual(installs, []);
  assert.equal(squirrel.listenerCount("error"), 0);
  assert.equal(updates.installing, false, "a refused update frees the channel");

  squirrel.answer = "later";
  const accepted = updates.check();
  await until(() => squirrel.calls.length === 2);
  assert.equal(clock.items.at(-1).ms, 300_000);
  assert.equal(updates.installing, true);
  assert.deepEqual(installs, []);
  squirrel.emit("update-downloaded", {}, "notes", "0.1.0-alpha.2");
  await accepted;
  assert.deepEqual(installs, ["stopped workspace"]);
  assert.deepEqual(updater.calls.at(-1), "quitAndInstall");
});

test("an update Squirrel.Mac refuses at once doesn't stop the next one from staging", async t => {
  for (const answer of ["throws", "emits"]) {
    const dir = await folder(t);
    const squirrel = new FakeSquirrel({ answer });
    const updater = new FakeUpdater([available("0.1.0-alpha.2"), available("0.1.0-alpha.3")]);
    const { updates, shown, installs } = setup(t, dir, { updater, squirrel });
    await updates.check();
    assert.equal(shown.at(-1), "failed install on alpha: Squirrel.Mac refused at once", answer);
    assert.equal(updates.installing, false);
    squirrel.answer = "staged";
    await updates.check();
    assert.deepEqual(squirrel.calls, ["stage", "stage"], `${answer}: Restart Now asks Squirrel.Mac again`);
    assert.deepEqual(installs, ["stopped workspace"]);
    assert.equal(updater.calls.at(-1), "quitAndInstall");
  }
});

test("once an update has gone to Squirrel.Mac the channel stays, even if staging runs out of time", async t => {
  const dir = await folder(t);
  const squirrel = new FakeSquirrel({ answer: "later" });
  const updater = new FakeUpdater([available("0.1.0-alpha.2")]);
  const codes = [];
  const { updates, shown, installs, clock } = setup(t, dir, { updater, squirrel, answers: { restart: true, failed: error => codes.push(error.code) } });
  await updates.start();
  const checking = updates.check();
  await until(() => squirrel.calls.includes("stage"));
  await assert.rejects(updates.setChannel("canary"), { code: "installing" });
  assert.equal(updates.channel, "alpha");
  assert.deepEqual(await saved(dir), { automatic: true, channel: "alpha" });
  clock.items.find(item => item.ms === 300_000).fn();
  await checking;
  assert.equal(shown.at(-1), "failed install on alpha: The update was not ready in time.");
  assert.deepEqual(codes, ["ERR_YS_STAGING_TIMEOUT"], "told apart from Squirrel's refusal");
  // Squirrel may still stage it, and then installs it at quit: the channel stays.
  await assert.rejects(updates.setChannel("canary"), { code: "installing" });
  squirrel.emit("update-downloaded", {});
  await updates.check();
  assert.deepEqual(installs, ["stopped workspace"]);
  assert.deepEqual(squirrel.calls, ["stage"], "staged once");
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
  await settle();
  await updates.check();
  assert.deepEqual(shown, ["available 0.1.0-alpha.2", "busy"]);
  assert.deepEqual(updater.calls, ["check"], "the pending update stays the one the owner is asked about");
  answer.resolve(false);
  await first;
  const second = updates.check();
  await settle();
  answer.reject(new Error("dialog failed"));
  await assert.rejects(second, /dialog failed/);
  const third = updates.check();
  await settle();
  assert.equal(shown.at(-1), "available 0.1.0-alpha.3", "an error in the prompt doesn't block later checks");
  answer.resolve(false);
  await third;
});

test("the file keeps the owner's last choice when changes overlap", async t => {
  const dir = await folder(t);
  const { updates } = setup(t, dir);
  await Promise.all([updates.setAutomatic(false), updates.setChannel("canary"), updates.setAutomatic(true),
    updates.setChannel("alpha"), updates.setAutomatic(false)]);
  assert.deepEqual(await saved(dir), { automatic: false, channel: "alpha" });
  assert.equal(updates.automatic, false);
  assert.equal(updates.channel, "alpha");
  await assert.rejects(updates.setChannel("beta"), /Unknown channel/);
});

test("Later keeps the downloaded update for the next check or quit, and a failed download can be retried", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater([available("0.1.0-alpha.2"), available("0.1.0-alpha.2")]);
  updater.downloadError = new Error("connection reset");
  const { updates, shown, installs } = setup(t, dir, { updater, answers: { restart: false } });
  await updates.check();
  assert.equal(shown.at(-1), "failed download on alpha: connection reset");
  delete updater.downloadError;
  await updates.check();
  assert.equal(shown.at(-1), "ready 0.1.0-alpha.2");
  await updates.check();
  assert.deepEqual(updater.calls, ["check", "download", "check", "download"], "a ready update is offered, not fetched again");
  assert.equal(shown.at(-1), "ready 0.1.0-alpha.2");
  assert.deepEqual(installs, []);
});

test("a check, an update found or a download from before a change of channel is neither offered nor installed", async t => {
  const dir = await folder(t);
  // The check: its result comes after the owner chose Alpha.
  let release;
  const slow = new FakeUpdater();
  slow.checkForUpdates = async function () {
    this.calls.push("check");
    await new Promise(resolve => { release = resolve; });
    return available(canaryBuild);
  };
  const checking = setup(t, dir, { updater: slow });
  await checking.updates.setChannel("canary");
  const pending = checking.updates.check();
  await until(() => release);
  await checking.updates.setChannel("alpha");
  release();
  await pending;
  assert.deepEqual(checking.shown, []);
  assert.deepEqual(slow.calls, ["check"]);

  // The update found: the owner switched while asked whether to download it.
  let answer;
  const found = setup(t, dir, { updater: new FakeUpdater([available(canaryBuild)]), answers: { download: () => new Promise(resolve => { answer = resolve; }) } });
  await found.updates.setChannel("canary");
  const asking = found.updates.check();
  await until(() => answer);
  await found.updates.setChannel("alpha");
  answer(true);
  await asking;
  assert.deepEqual(found.updater.calls, ["check"], "nothing downloads");
  assert.deepEqual(found.shown, [`available ${canaryBuild} (asked)`, `dropped ${canaryBuild}`], "Download says why nothing downloads");

  // The download: it is cancelled, and nothing is said about it, its late progress included.
  const downloading = new FakeUpdater([available(canaryBuild)]);
  downloading.downloadGate = true;
  const download = setup(t, dir, { updater: downloading, squirrel: new FakeSquirrel() });
  await download.updates.setChannel("canary");
  const fetching = download.updates.check();
  await until(() => downloading.release);
  await download.updates.setChannel("alpha");
  downloading.emit("download-progress", { percent: 80 });
  await fetching;
  assert.deepEqual(download.shown, [`available ${canaryBuild} (asked)`, "progress 0.5", "progress -1"]);
  assert.deepEqual(downloading.calls, ["check", "download"]);
  assert.equal(download.updates.installsAtQuit, false);

  // The update downloaded: the owner chose Later, then Alpha.
  const squirrel = new FakeSquirrel();
  const ready = setup(t, dir, { updater: new FakeUpdater([available(canaryBuild)]), squirrel, answers: { restart: false } });
  await ready.updates.setChannel("canary");
  await ready.updates.check();
  assert.equal(ready.shown.at(-1), `ready ${canaryBuild}`);
  assert.equal(ready.updates.installsAtQuit, true);
  await ready.updates.setChannel("alpha");
  assert.equal(ready.updates.installsAtQuit, false);
  await ready.updates.stageAtQuit();
  await ready.updates.check();
  assert.deepEqual(squirrel.calls, [], "nothing goes to Squirrel.Mac, not even at quit");
  assert.deepEqual(ready.updater.calls, ["check", "download", "check"], "the next check reads Alpha's feed afresh");
  assert.equal(ready.shown.at(-1), "up to date on alpha");

  // The update downloaded: the owner switched while asked to restart, then chose Restart Now.
  let restart;
  const staging = new FakeSquirrel();
  const asked = setup(t, dir, { updater: new FakeUpdater([available(canaryBuild)]), squirrel: staging,
    answers: { restart: () => new Promise(resolve => { restart = resolve; }) } });
  await asked.updates.setChannel("canary");
  const restarting = asked.updates.check();
  await until(() => restart);
  await asked.updates.setChannel("alpha");
  restart(true);
  await restarting;
  assert.equal(asked.shown.at(-1), `dropped ${canaryBuild}`, "Restart Now says why nothing installs");
  assert.deepEqual(staging.calls, []);
  assert.deepEqual(asked.installs, []);
});

test("a check that fails after a change of channel says nothing about it", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater();
  const plain = updater.checkForUpdates;
  let fail;
  updater.checkForUpdates = async function () {
    this.calls.push("check");
    updater.checkForUpdates = plain;
    await new Promise((resolve, reject) => { fail = reject; });
  };
  const { updates, shown } = setup(t, dir, { updater });
  await updates.setChannel("canary");
  const before = updates.check();
  await until(() => fail);
  await updates.setChannel("alpha");
  const after = updates.check();
  await settle();
  fail(new Error("offline"));
  await Promise.all([before, after]);
  assert.deepEqual(shown, ["up to date on alpha"], "nothing about the Canary check");
});

test("a check overtaken by a second change of channel while it waits never reads its feed", async t => {
  const dir = await folder(t);
  const updater = new FakeUpdater();
  const plain = updater.checkForUpdates;
  let open;
  updater.checkForUpdates = async function () {
    updater.checkForUpdates = plain;
    const result = plain.call(this);
    await new Promise(resolve => { open = resolve; });
    return result;
  };
  const { updates, shown } = setup(t, dir, { updater });
  await updates.setChannel("canary");
  const first = updates.check();
  await until(() => open);
  await updates.setChannel("alpha");
  const second = updates.check();
  await settle();
  await updates.setChannel("canary");
  const third = updates.check();
  await settle();
  open();
  await Promise.all([first, second, third]);
  assert.deepEqual(updater.feeds, [channelFeed("canary"), channelFeed("canary")], "the Alpha check, overtaken, read nothing");
  assert.deepEqual(shown, ["up to date on canary"]);
});

test("the guard refuses a feed's version that isn't plain SemVer, which electron-updater still reads, on either channel", async t => {
  const dir = await folder(t);
  for (const [channel, version] of [["alpha", `v${canaryBuild}`], ["alpha", ` ${canaryBuild}`], ["alpha", "v0.1.0-alpha.3"],
    ["alpha", "0.1.0-alpha.3 "], ["canary", `v${canaryBuild}`], ["canary", `${canaryBuild}\n`]]) {
    const { updates, updater, shown } = setup(t, dir, { updater: new FakeUpdater([available(version)]) });
    await updates.setChannel(channel);
    await updates.check();
    assert.deepEqual(shown, [`failed check on ${channel}: The ${channel} feed names ${version}.`], JSON.stringify(version));
    assert.deepEqual(updater.calls, ["check"], "nothing downloads");
  }
});

test("at quit, a downloaded update of the channel followed now is staged, so it installs once the app has quit", async t => {
  const dir = await folder(t);
  const squirrel = new FakeSquirrel();
  const { updates, installs, shown } = setup(t, dir, { updater: new FakeUpdater([available("0.1.0-alpha.2")]), squirrel, answers: { restart: false } });
  assert.equal(updates.installsAtQuit, false);
  await updates.stageAtQuit();
  assert.deepEqual(squirrel.calls, []);
  await updates.check();
  assert.equal(updates.installsAtQuit, true);
  await updates.stageAtQuit();
  assert.deepEqual(squirrel.calls, ["stage"]);
  assert.equal(shown.at(-1), "progress 2", "the Dock's bar stays until the app has quit, the workspace's stop may still show it");
  assert.equal(updates.installsAtQuit, false, "staged: Squirrel.Mac installs it as the app quits");
  assert.deepEqual(installs, [], "quitting doesn't relaunch");

  // A quit cut short leaves it unstaged, and never rejects.
  const slow = new FakeSquirrel({ answer: "later" });
  const other = setup(t, dir, { updater: new FakeUpdater([available("0.1.0-alpha.2")]), squirrel: slow, answers: { restart: false } });
  await other.updates.check();
  const controller = new AbortController();
  const staging = other.updates.stageAtQuit(controller.signal);
  controller.abort();
  await staging;
  assert.deepEqual(slow.calls, ["stage"]);
});

// The real electron-updater, behind a stand-in for GitHub that serves the channels' recorded feeds at
// their fixed addresses, each release's own latest-mac.yml as update-feed.mjs writes it, and the
// releases Atom feed, as GitHub serves them. Query strings, such as the generic provider's noCache,
// don't change what is served. `gate` holds back a file until the test releases it, `missing`
// answers 404 for a file, as GitHub does while a feed's file is being replaced, and `serve` replaces
// a file's content.
const fixtures = join(desktop, "../shared/release-channels/fixtures");
const downloads = "https://github.com/your-space-ai/your-space/releases/download";
const alphaFeed = `${downloads}/alpha`;
const canaryFeed = `${downloads}/canary`;
const alpha1Config = join(fixtures, "alpha.1/app-update.yml");
const recordedAlpha = JSON.parse(await readFile(join(fixtures, "alpha/channel.json"), "utf8")).version;
const recordedCanary = JSON.parse(await readFile(join(fixtures, "canary/channel.json"), "utf8")).version;

// The real MacUpdater takes Electron's autoUpdater, Squirrel.Mac, from require("electron"); here it
// gets the stand-in of the test that makes it.
let squirrelForMac;
const electron = require.resolve("electron");
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { get autoUpdater() { return squirrelForMac; } } };

async function github(t, tags = [], { atom: recorded, gate = new Map(), missing = new Set(), offline = false, serve = {} } = {}) {
  const dir = await folder(t);
  const feeds = new Map([
    [`${alphaFeed}/latest-mac.yml`, await readFile(join(fixtures, "alpha/latest-mac.yml"), "utf8")],
    [`${canaryFeed}/canary-mac.yml`, await readFile(join(fixtures, "canary/canary-mac.yml"), "utf8")],
  ]);
  for (const [url, body] of Object.entries(serve)) feeds.set(url, body);
  for (const tag of tags.filter(tag => tag.startsWith("v"))) {
    const version = tag.slice(1);
    const release = join(dir, tag);
    await mkdir(release);
    for (const arch of ["arm64", "x64"]) await writeFile(join(release, `your-space-macos-${arch}-${version}.zip`), arch + version);
    execFileSync(process.execPath, [join(desktop, "scripts/update-feed.mjs"), version, release, "arm64", "x64"]);
    feeds.set(`${downloads}/${tag}/latest-mac.yml`, await readFile(join(release, "latest-mac.yml"), "utf8"));
  }
  const atom = recorded ?? `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    tags.map(tag => `<entry><id>${tag}</id><title>Your Space ${tag.slice(1)}</title>` +
      `<link rel="alternate" type="text/html" href="https://github.com/your-space-ai/your-space/releases/tag/${tag}"/>` +
      `<content type="html">notes</content></entry>`).join("") + "</feed>";
  const requests = [];
  const fetched = [];
  // GitHub's answer for a file that isn't there, as the real executor reports it.
  const notFound = () => new (require("builder-util-runtime").HttpError)(404);
  const executor = {
    async request(options) {
      const url = `${options.protocol}//${options.hostname}${options.path}`.replace(/\?.*$/, "");
      requests.push({ url, headers: { ...options.headers } });
      await gate.get(url)?.promise;
      if (offline) throw Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" });
      if (missing.has(url)) throw notFound();
      if (url === "https://github.com/your-space-ai/your-space/releases.atom") return atom;
      if (url === "https://github.com/your-space-ai/your-space/releases/latest") {
        // GitHub's latest release is never a prerelease.
        return JSON.stringify({ tag_name: tags.find(tag => tag.startsWith("v") && !tag.includes("-")) });
      }
      if (feeds.has(url)) return feeds.get(url);
      throw notFound();
    },
    // An update ZIP, as each feed's digest was made: its architecture and version. Like the real
    // executor, it checks the digest and stops when the download is cancelled.
    async download(url, destination, options) {
      fetched.push(url.href);
      const name = url.pathname.split("/").pop();
      const [, arch, version] = /^your-space-macos-(arm64|x64)-(.+)\.zip$/.exec(name) ?? [];
      if (!arch) throw notFound();
      await new Promise((resolve, reject) => {
        const held = gate.get(url.href);
        options.cancellationToken.onCancel(() => reject(new (require("builder-util-runtime").CancellationError)()));
        if (held) held.promise.then(resolve); else resolve();
      });
      const content = arch + version;
      if (createHash("sha512").update(content).digest("base64") !== options.sha512) {
        throw Object.assign(new Error("sha512 checksum mismatch"), { code: "ERR_CHECKSUM_MISMATCH" });
      }
      options.onProgress?.({ percent: 100 });
      await writeFile(destination, content);
      return destination;
    },
  };
  const { AppUpdater } = require("electron-updater/out/AppUpdater.js");
  const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
  // An app of a version, reading the app-update.yml given, as electron-updater makes its autoUpdater.
  // `mac` makes the real MacUpdater, which downloads and hands the ZIP to Squirrel.Mac.
  function app(version, { config = join(desktop, "app-update.yml"), mac } = {}) {
    const adapter = {
      version, name: "Your Space", isPackaged: true,
      appUpdateConfigPath: config, userDataPath: dir, baseCachePath: dir,
      whenReady: async () => {}, relaunch() {}, quit() {}, onQuit() {},
    };
    squirrelForMac = mac;
    const updater = mac ? new MacUpdater(null, adapter) : new AppUpdater(null, adapter);
    updater.logger = null;
    // As on a Mac, whatever this test runs on. setFeedURL makes its provider with these, so they come first.
    updater._testOnlyOptions = { platform: "darwin" };
    updater.httpExecutor = executor;
    if (mac) t.after(() => updater.closeServerIfExists());
    return updater;
  }
  return { dir, requests, fetched, app };
}

/** A gate for `github`: a file held back until `open()`. */
function gateOn(gates, url) {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  gates.set(url, { promise });
  return open;
}

// Squirrel.Mac as it takes an update from MacUpdater: it asks the local server MacUpdater set as its
// feed, with the credentials given, for the ZIP's address, downloads it and stages it.
class MacSquirrel extends FakeSquirrel {
  constructor() {
    super({ answer: "fetch" });
    this.staged = [];
  }
  checkForUpdates() {
    this.calls.push("stage");
    (async () => {
      const { url } = await (await fetch(this.feed.url, { headers: this.feed.headers })).json();
      this.staged.push(await (await fetch(url)).text());
      this.emit("update-downloaded", {});
    })().catch(error => this.emit("error", error));
  }
}

function channelApp(t, dir, updater, { version, answers, squirrel } = {}) {
  const shown = [];
  const installs = [];
  const updates = createUpdates({
    load: () => updater, settingsFile: join(dir, "updates.json"), version: version ?? updater.app.version, timers: timers(), squirrel,
    ui: recordingUi(shown, answers), beforeInstall: async install => { installs.push("stopped workspace"); install(); },
  });
  t.after(() => updates.stop());
  return { updates, shown, installs };
}

test("on Alpha, the app reads only the alpha feed's latest-mac.yml and offers its release only when it is newer", async t => {
  const { dir, requests, app } = await github(t);
  const updater = app("0.1.0-alpha.1");
  const { updates, shown } = channelApp(t, dir, updater, { answers: { download: false } });
  await updates.start();
  assert.equal(updates.channel, "alpha");
  await updates.check();
  assert.deepEqual(shown, [`available ${recordedAlpha} (asked)`]);
  // No channel: only latest-mac.yml at the feed's fixed address, with no installation ID.
  assert.deepEqual(requests.map(r => r.url), [`${alphaFeed}/latest-mac.yml`]);
  for (const { headers } of requests) assert.ok(!Object.keys(headers ?? {}).some(name => /staging/i.test(name)), JSON.stringify(headers));
  assert.equal(existsSync(join(dir, ".updaterId")), false);
  assert.equal(updater.channel, null, "the updater's own channel, which turns on downgrades, is never set");
  assert.equal(updater.allowDowngrade, false);

  // It follows the feed's full links into the v release.
  const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
  const files = updater.updateInfoAndProvider.provider.resolveFiles(updater.updateInfoAndProvider.info);
  const release = `${downloads}/v${recordedAlpha}`;
  const pick = arm => MacUpdater.filterFilesForArch(files, arm).map(file => file.url.href);
  assert.deepEqual(pick(true), [`${release}/your-space-macos-arm64-${recordedAlpha}.zip`]);
  assert.deepEqual(pick(false), [`${release}/your-space-macos-x64-${recordedAlpha}.zip`]);

  // Nothing for an app already on the release, or on a later canary set to Alpha, whose version
  // contains -alpha. and sorts after it.
  for (const version of [recordedAlpha, recordedCanary, "0.1.0-alpha.3", "0.1.0"]) {
    const later = await github(t);
    await writeFile(join(later.dir, "updates.json"), JSON.stringify({ automatic: true, channel: "alpha" }));
    const other = later.app(version);
    const { updates: laterUpdates, shown: laterShown } = channelApp(t, later.dir, other);
    await laterUpdates.start();
    await laterUpdates.check();
    assert.deepEqual(later.requests.map(r => r.url), [`${alphaFeed}/latest-mac.yml`], version);
    assert.deepEqual(laterShown, ["up to date on alpha"], version);
    assert.equal(other.allowDowngrade, false);
  }
});

test("on Canary, the app reads only the canary feed's canary-mac.yml, and its ZIPs beside it", async t => {
  const { dir, requests, app } = await github(t, ["v0.1.0-alpha.2", "v0.1.0-alpha.1"]);
  const updater = app("0.1.0-alpha.2");
  await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: true, channel: "canary" }));
  const { updates, shown } = channelApp(t, dir, updater, { answers: { download: false } });
  await updates.start();
  await updates.check();
  assert.deepEqual(shown, [`available ${recordedCanary} (asked)`]);
  assert.deepEqual(requests.map(r => r.url), [`${canaryFeed}/canary-mac.yml`]);
  assert.equal(updater.channel, null);
  assert.equal(updater.allowDowngrade, false);
  const files = updater.updateInfoAndProvider.provider.resolveFiles(updater.updateInfoAndProvider.info);
  assert.deepEqual(files.map(file => file.url.href), ["arm64", "x64"].map(arch => `${canaryFeed}/your-space-macos-${arch}-${recordedCanary}.zip`));

  // A canary app on Canary isn't offered its own build again.
  const same = channelApp(t, dir, app(recordedCanary));
  await same.updates.start();
  await same.updates.check();
  assert.deepEqual(same.shown, ["up to date on canary"]);
});

test("a check started after a change of channel waits for one from before it, and reads only its own feed", async t => {
  const gates = new Map();
  const openCanary = gateOn(gates, `${canaryFeed}/canary-mac.yml`);
  const { dir, requests, app } = await github(t, [], { gate: gates });
  await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: false, channel: "canary" }));
  const { updates, shown } = channelApp(t, dir, app("0.1.0-alpha.1"), { answers: { download: false } });
  await updates.start();
  const before = updates.check();
  await until(() => requests.length === 1);
  await updates.setChannel("alpha");
  // electron-updater would hand this check the canary check's promise, still in flight.
  const after = updates.check();
  await settle();
  assert.equal(requests.length, 1);
  openCanary();
  await Promise.all([before, after]);
  assert.deepEqual(requests.map(r => r.url), [`${canaryFeed}/canary-mac.yml`, `${alphaFeed}/latest-mac.yml`]);
  assert.deepEqual(shown, [`available ${recordedAlpha} (asked)`], "the canary found before the change isn't offered");
});

test("with the real MacUpdater, nothing goes to Squirrel.Mac before Restart Now or quit, and a change of channel drops a download", async t => {
  const gates = new Map();
  const canaryZip = arch => `${canaryFeed}/your-space-macos-${arch}-${recordedCanary}.zip`;
  const openZips = ["arm64", "x64"].map(arch => gateOn(gates, canaryZip(arch)));
  const { dir, fetched, app } = await github(t, [], { gate: gates });
  await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: false, channel: "canary" }));
  const squirrel = new MacSquirrel();
  const updater = app("0.1.0-alpha.1", { mac: squirrel });
  const { updates, shown, installs } = channelApp(t, dir, updater, { squirrel, answers: { restart: false } });
  await updates.start();

  // A canary download in flight when the owner chooses Alpha is cancelled and never offered.
  const downloading = updates.check();
  await until(() => fetched.length === 1);
  await updates.setChannel("alpha");
  await downloading;
  assert.equal(updater.autoInstallOnAppQuit, false);
  for (const open of openZips) open();
  assert.deepEqual(shown, [`available ${recordedCanary} (asked)`, "progress -1"]);
  assert.equal(updates.installsAtQuit, false);
  await updates.stageAtQuit();
  assert.deepEqual(squirrel.calls, [], "nothing was handed to Squirrel.Mac");

  // Alpha's release downloads, and Later leaves it unstaged until the app quits.
  await updates.check();
  assert.deepEqual(shown.slice(2), [`available ${recordedAlpha} (asked)`, "progress 1", "progress -1", `ready ${recordedAlpha}`]);
  assert.match(fetched.at(-1), new RegExp(`/v${recordedAlpha.replaceAll(".", "\\.")}/your-space-macos-(arm64|x64)-`));
  assert.deepEqual(squirrel.calls, ["setFeedURL"], "MacUpdater pointed Squirrel.Mac at the download, and nothing more");
  assert.equal(updates.installsAtQuit, true);
  await updates.stageAtQuit();
  assert.deepEqual(squirrel.calls, ["setFeedURL", "stage"]);
  assert.match(squirrel.staged[0], new RegExp(`^(arm64|x64)${recordedAlpha.replaceAll(".", "\\.")}$`));
  assert.deepEqual(installs, []);
});

test("with the real MacUpdater, a downloaded update of the channel left is forgotten, and Restart Now stages before it stops the workspace", async t => {
  const { dir, app } = await github(t);
  await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: false, channel: "canary" }));
  const squirrel = new MacSquirrel();
  const updater = app("0.1.0-alpha.1", { mac: squirrel });
  let restart = false;
  const { updates, shown, installs } = channelApp(t, dir, updater, { squirrel, answers: { restart: () => restart } });
  await updates.start();
  await updates.check();
  assert.equal(shown.at(-1), `ready ${recordedCanary}`);
  await updates.setChannel("alpha");
  await updates.stageAtQuit();
  assert.deepEqual(squirrel.calls, ["setFeedURL"], "the canary is never staged, not even at quit");

  restart = true;
  const order = [];
  squirrel.on("update-downloaded", () => order.push("staged"));
  const quitAndInstall = squirrel.quitAndInstall.bind(squirrel);
  squirrel.quitAndInstall = () => { order.push("install"); quitAndInstall(); };
  const beforeInstall = installs.push.bind(installs);
  installs.push = value => { order.push(value); return beforeInstall(value); };
  await updates.check();
  assert.deepEqual(shown.slice(-3), [`ready ${recordedAlpha}`, "progress 2", "progress -1"]);
  assert.deepEqual(order, ["staged", "stopped workspace", "install"]);
  assert.match(squirrel.staged.at(-1), new RegExp(`${recordedAlpha.replaceAll(".", "\\.")}$`));
});

test("a feed that can't be read selects nothing and says so, as does one that names another channel's build", async t => {
  for (const [channel, file] of [["alpha", `${alphaFeed}/latest-mac.yml`], ["canary", `${canaryFeed}/canary-mac.yml`]]) {
    const { dir, requests, app } = await github(t, [], { missing: new Set([file]) });
    await writeFile(join(dir, "updates.json"), JSON.stringify({ automatic: true, channel }));
    const updater = app("0.1.0-alpha.1");
    const { updates, shown } = channelApp(t, dir, updater);
    await updates.start();
    await updates.check();
    assert.equal(shown.length, 1);
    assert.match(shown[0], new RegExp(`^failed check on ${channel}: Cannot find channel`));
    assert.deepEqual(requests.map(r => r.url), [file]);
    assert.equal(updater.updateInfoAndProvider, null, "nothing selected");
  }
  const { dir: away, app: offlineApp } = await github(t, [], { offline: true });
  const { updates: offline, shown: said } = channelApp(t, away, offlineApp("0.1.0-alpha.1"));
  await offline.start();
  await offline.check();
  assert.deepEqual(said, ["failed check on alpha: getaddrinfo ENOTFOUND github.com"]);

  // Alpha's feed naming a canary, or Canary's a release, is refused as the guard requires.
  const { dir, app } = await github(t);
  const wrong = app("0.1.0-alpha.1");
  wrong.setFeedURL = function () { Object.getPrototypeOf(this).setFeedURL.call(this, { provider: "generic", url: `${canaryFeed}/`, channel: "canary" }); };
  const { updates, shown } = channelApp(t, dir, wrong);
  await updates.start();
  await updates.check();
  assert.deepEqual(shown, [`failed check on alpha: The alpha feed names ${recordedCanary}.`]);

  // So is one naming a canary with a leading v or a space, which electron-updater reads as newer.
  const alphaYml = await readFile(join(fixtures, "alpha/latest-mac.yml"), "utf8");
  for (const version of [`v${recordedCanary}`, ` ${recordedCanary}`]) {
    const yml = alphaYml.replace(/^version: .*$/m, `version: '${version}'`);
    const { dir: odd, app: oddApp } = await github(t, [], { serve: { [`${alphaFeed}/latest-mac.yml`]: yml } });
    const updater = oddApp(recordedAlpha);
    const found = [];
    const checkForUpdates = updater.checkForUpdates.bind(updater);
    updater.checkForUpdates = async () => { const result = await checkForUpdates(); found.push(result); return result; };
    const { updates: oddUpdates, shown: oddShown } = channelApp(t, odd, updater);
    await oddUpdates.start();
    await oddUpdates.check();
    assert.equal(found[0].isUpdateAvailable, true, `electron-updater offers ${JSON.stringify(version)}`);
    assert.deepEqual(oddShown, [`failed check on alpha: The alpha feed names ${version}.`], JSON.stringify(version));
  }
});

test("the packaged app-update.yml is the alpha feed, so an app that hasn't chosen a feed reads only it", async t => {
  const { requests, app } = await github(t, ["v0.1.0-alpha.2", "v0.1.0-alpha.1"]);
  const result = await configureUpdater(app("0.1.0-alpha.1")).checkForUpdates();
  assert.equal(result.updateInfo.version, recordedAlpha);
  assert.deepEqual(requests.map(r => r.url), [`${alphaFeed}/latest-mac.yml`]);
  assert.match(await readFile(join(desktop, "app-update.yml"), "utf8"), /^updaterCacheDirName: ai\.your-space\.desktop-updater$/m);
});

// The alpha.1 app, as released: the GitHub provider, from the app-update.yml recorded from its tag.
test("electron-updater in the alpha.1 app finds a newer alpha, picks the ZIP for each Mac and sends no installation ID", async t => {
  const next = "0.1.0-alpha.2";
  const { dir, requests, app } = await github(t, ["v0.1.0-alpha.2", "v0.1.0-alpha.1"]);
  const updater = configureUpdater(app("0.1.0-alpha.1", { config: alpha1Config }));
  const result = await updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.updateInfo.version, next);
  assert.equal(result.downloadPromise, null, "nothing downloads until the owner agrees");
  assert.deepEqual(requests.map(r => r.url), [
    "https://github.com/your-space-ai/your-space/releases.atom",
    `${downloads}/v${next}/alpha-mac.yml`,
    `${downloads}/v${next}/latest-mac.yml`,
  ]);
  for (const { headers } of requests) assert.ok(!Object.keys(headers ?? {}).some(name => /staging/i.test(name)), JSON.stringify(headers));
  assert.equal(existsSync(join(dir, ".updaterId")), false);

  const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
  const files = updater.updateInfoAndProvider.provider.resolveFiles(result.updateInfo);
  const pick = arm => MacUpdater.filterFilesForArch(files, arm).map(file => file.url.pathname.split("/").pop());
  assert.deepEqual(pick(true), [`your-space-macos-arm64-${next}.zip`]);
  assert.deepEqual(pick(false), [`your-space-macos-x64-${next}.zip`]);
  assert.match(files[0].info.sha512, /^[A-Za-z0-9+/]{86}==$/);

  assert.equal((await configureUpdater(app(next, { config: alpha1Config })).checkForUpdates()).isUpdateAvailable, false);
});

test("the alpha.1 app is offered the stable release and betas, a beta app no alpha, a stable app no prerelease", async t => {
  const offered = async (tags, version) => {
    const result = await configureUpdater((await github(t, tags)).app(version, { config: alpha1Config })).checkForUpdates();
    return result.isUpdateAvailable ? result.updateInfo.version : null;
  };
  assert.equal(await offered(["v0.1.0", "v0.1.0-alpha.2", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0");
  assert.equal(await offered(["v0.1.0-beta.1", "v0.1.0-alpha.2"], "0.1.0-alpha.2"), "0.1.0-beta.1");
  assert.equal(await offered(["v0.1.0-alpha.3", "v0.1.0-beta.1"], "0.1.0-beta.1"), null);
  assert.equal(await offered(["v0.2.0-alpha.1", "v0.1.1", "v0.1.0"], "0.1.0"), "0.1.1");
});

test("the alpha.1 app skips the rolling alpha and canary prereleases, wherever they are in the feed", async t => {
  const offered = async (tags, version) => {
    const result = await configureUpdater((await github(t, tags)).app(version, { config: alpha1Config })).checkForUpdates();
    return result.isUpdateAvailable ? result.updateInfo.version : null;
  };
  assert.equal(await offered(["canary", "v0.1.0-alpha.2", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0-alpha.2");
  assert.equal(await offered(["alpha", "canary", "v0.1.0-alpha.2", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0-alpha.2");
  assert.equal(await offered(["canary", "alpha", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), null);
  assert.equal(await offered(["alpha", "canary", "v0.1.0-beta.2", "v0.1.0-beta.1"], "0.1.0-beta.1"), "0.1.0-beta.2");
  assert.equal(await offered(["canary", "alpha", "v0.1.1", "v0.1.0"], "0.1.0"), "0.1.1");
  assert.equal(await offered(["v0.1.0-alpha.2", "alpha", "canary", "v0.1.0-alpha.1"], "0.1.0-alpha.1"), "0.1.0-alpha.2");
});

test("the alpha.1 app, reading the releases feed fixture, resolves to the newest v release and never a canary's files", async t => {
  const atom = await readFile(join(fixtures, "releases.atom"), "utf8");
  const { requests, app } = await github(t, ["v0.1.0-alpha.2", "v0.1.0-alpha.1"], { atom });
  const result = await configureUpdater(app("0.1.0-alpha.1", { config: alpha1Config })).checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.updateInfo.version, "0.1.0-alpha.2");
  assert.deepEqual(requests.map(r => r.url), [
    "https://github.com/your-space-ai/your-space/releases.atom",
    `${downloads}/v0.1.0-alpha.2/alpha-mac.yml`,
    `${downloads}/v0.1.0-alpha.2/latest-mac.yml`,
  ]);
  assert.ok(!requests.some(r => /\/download\/(alpha|canary)\//.test(r.url)));
});
