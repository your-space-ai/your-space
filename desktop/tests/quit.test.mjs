import assert from "node:assert/strict";
import test from "node:test";
import { createQuitControl } from "../src/quit.mjs";

function quitEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

// Fake timers: a deadline fires only when the test says so.
function clock() {
  const pending = new Map();
  let next = 0;
  return {
    timers: {
      setTimeout: (fn, ms) => { pending.set(++next, { fn, ms }); return next; },
      clearTimeout: id => pending.delete(id),
    },
    pending: () => [...pending.values()],
    fire() { for (const [id, { fn }] of pending) { pending.delete(id); fn(); } },
  };
}

function control({ running = true, stop, timeouts, onFailed, update } = {}) {
  const log = [];
  const time = clock();
  let resolveStop;
  const quit = createQuitControl({
    needsStop: () => running,
    ...(update ? { pendingUpdate: () => update.pending, stageUpdate: signal => { log.push("stage"); return update.stage(signal); } } : {}),
    stop: stop ?? (signal => new Promise((resolve, reject) => {
      log.push("stop");
      resolveStop = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    })),
    onStopping: () => log.push("stopping"),
    onFailed: onFailed ?? (async (error, timedOut) => { log.push(timedOut ? "failed: timed out" : "failed: " + error.message); }),
    quit: () => log.push("quit"),
    timers: time.timers,
    timeouts: timeouts ?? { quit: 120_000, systemEnding: 20_000 },
  });
  return { quit, log, time, finishStop: () => resolveStop() };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("quitting without a local workspace from this app exits at once", () => {
  const { quit, log } = control({ running: false });
  const event = quitEvent();
  quit.beforeQuit(event);
  assert.equal(event.prevented, false);
  assert.equal(quit.quitting, true);
  assert.deepEqual(log, []);
});

test("quitting holds the quit, shows that the workspace is stopping, stops it, then quits", async () => {
  const { quit, log, time, finishStop } = control();
  const first = quitEvent();
  quit.beforeQuit(first);
  assert.equal(first.prevented, true);
  assert.equal(quit.stopping, true);
  assert.equal(quit.quitting, false, "windows keep their close-to-hide behaviour while stopping");
  assert.deepEqual(time.pending().map(item => item.ms), [120_000]);

  const again = quitEvent();
  quit.beforeQuit(again);
  assert.equal(again.prevented, true, "a second Cmd+Q waits for the same stop");
  assert.deepEqual(log, ["stopping", "stop"]);

  finishStop();
  await settle();
  assert.deepEqual(log, ["stopping", "stop", "quit"]);
  assert.equal(quit.quitting, true);
  const last = quitEvent();
  quit.beforeQuit(last);
  assert.equal(last.prevented, false);
});

test("a stop that fails or runs out of time tells the owner, then quits anyway", async () => {
  const failing = control({ stop: async () => { throw new Error("engine_missing"); } });
  failing.quit.beforeQuit(quitEvent());
  await settle();
  assert.deepEqual(failing.log, ["stopping", "failed: engine_missing", "quit"]);

  const slow = control();
  slow.quit.beforeQuit(quitEvent());
  slow.time.fire();
  await settle();
  assert.deepEqual(slow.log, ["stopping", "stop", "failed: timed out", "quit"]);
});

test("logout, restart and shutdown cut the wait short and never show a dialog", async () => {
  const during = control();
  during.quit.beforeQuit(quitEvent());
  during.quit.systemEnding();
  assert.deepEqual(during.time.pending().map(item => item.ms), [20_000]);
  during.time.fire();
  await settle();
  assert.deepEqual(during.log, ["stopping", "stop", "quit"]);

  const before = control({ stop: async () => { throw new Error("engine gone"); } });
  before.quit.systemEnding();
  before.quit.beforeQuit(quitEvent());
  await settle();
  assert.deepEqual(before.log, ["stopping", "quit"]);
});

test("logout during the stop-failure message closes it and quits without waiting for the owner", async () => {
  const signals = [];
  const { quit, log } = control({
    stop: async () => { throw new Error("engine_missing"); },
    // The message stays open until its signal closes it, as a sheet does.
    onFailed: (error, timedOut, signal) => new Promise(resolve => { signals.push(signal); signal.addEventListener("abort", resolve); }),
  });
  quit.beforeQuit(quitEvent());
  await settle();
  assert.deepEqual(log, ["stopping"]);
  assert.equal(signals[0].aborted, false);
  quit.systemEnding();
  await settle();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(log, ["stopping", "quit"]);
});

test("installing an update stops the workspace first, then installs instead of quitting", async () => {
  const { quit, log, finishStop } = control();
  const installed = [];
  const installing = quit.beforeInstall(() => installed.push("install"));
  assert.deepEqual(log, ["stopping", "stop"]);
  finishStop();
  await installing;
  assert.deepEqual(installed, ["install"]);
  assert.deepEqual(log, ["stopping", "stop"]);
  const event = quitEvent();
  quit.beforeQuit(event);
  assert.equal(event.prevented, false, "the update's own quit goes through");

  const idle = control({ running: false });
  await idle.quit.beforeInstall(() => idle.log.push("install"));
  assert.deepEqual(idle.log, ["install"]);
});

test("a downloaded update holds the quit while it stages, with no workspace to stop and no stopping window", async () => {
  let staged;
  const update = { pending: true, stage: () => new Promise(resolve => { staged = resolve; }) };
  const { quit, log } = control({ running: false, update });
  const event = quitEvent();
  quit.beforeQuit(event);
  assert.equal(event.prevented, true);
  assert.deepEqual(log, ["stage"]);
  staged();
  await settle();
  assert.deepEqual(log, ["stage", "quit"]);
  assert.equal(quit.quitting, true);

  update.pending = false;
  const none = control({ running: false, update });
  const direct = quitEvent();
  none.quit.beforeQuit(direct);
  assert.equal(direct.prevented, false, "nothing to stage: the app quits at once");
});

test("staging runs beside the workspace's stop, within its deadline, and never raises the stop's warning", async () => {
  let staged;
  const update = { pending: true, stage: () => new Promise(resolve => { staged = resolve; }) };
  const both = control({ update });
  both.quit.beforeQuit(quitEvent());
  assert.deepEqual(both.log, ["stopping", "stop", "stage"]);
  both.finishStop();
  await settle();
  assert.deepEqual(both.log, ["stopping", "stop", "stage"], "the quit waits for staging too");
  staged();
  await settle();
  assert.deepEqual(both.log, ["stopping", "stop", "stage", "quit"]);

  // Staging that runs out of time is cut off at the deadline, which logout shortens; the stop finished.
  const signals = [];
  const slow = control({ update: { pending: true, stage: signal => { signals.push(signal); return new Promise(() => {}); } } });
  slow.quit.beforeQuit(quitEvent());
  slow.finishStop();
  slow.quit.systemEnding();
  assert.deepEqual(slow.time.pending().map(item => item.ms), [20_000]);
  slow.time.fire();
  await settle();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(slow.log, ["stopping", "stop", "stage", "quit"]);

  // A refused update, alone, says nothing.
  const refused = control({ update: { pending: true, stage: async () => { throw new Error("Code signature did not pass validation"); } } });
  refused.quit.beforeQuit(quitEvent());
  refused.finishStop();
  await settle();
  assert.deepEqual(refused.log, ["stopping", "stop", "stage", "quit"]);

  // A workspace that doesn't stop in time still warns, whether or not the update staged.
  const stuck = control({ update: { pending: true, stage: async () => {} } });
  stuck.quit.beforeQuit(quitEvent());
  stuck.time.fire();
  await settle();
  assert.deepEqual(stuck.log, ["stopping", "stop", "stage", "failed: timed out", "quit"]);
});

test("logout bounds a quit that only stages an update at 20 seconds, with no stopping window or warning", async () => {
  const signals = [];
  const never = { pending: true, stage: signal => { signals.push(signal); return new Promise(() => {}); } };
  const during = control({ running: false, update: never });
  during.quit.beforeQuit(quitEvent());
  assert.deepEqual(during.time.pending().map(item => item.ms), [120_000]);
  during.quit.systemEnding();
  assert.deepEqual(during.time.pending().map(item => item.ms), [20_000]);
  during.time.fire();
  await settle();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(during.log, ["stage", "quit"]);

  const before = control({ running: false, update: never });
  before.quit.systemEnding();
  before.quit.beforeQuit(quitEvent());
  assert.deepEqual(before.time.pending().map(item => item.ms), [20_000]);
  before.time.fire();
  await settle();
  assert.deepEqual(before.log, ["stage", "quit"]);
});
