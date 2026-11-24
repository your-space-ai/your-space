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

function control({ running = true, stop, timeouts, onFailed } = {}) {
  const log = [];
  const time = clock();
  let resolveStop;
  const quit = createQuitControl({
    needsStop: () => running,
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
