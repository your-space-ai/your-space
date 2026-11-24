// Closing a window leaves the app and its local workspace running, as on any Mac. Quitting the app
// stops the local workspace this app started, then exits. A workspace reached with Connect to a server
// is never stopped. Logout, restart and shutdown get a short bound and no dialog, so they never wait
// on Docker.

export const stopTimeouts = Object.freeze({ quit: 2 * 60_000, systemEnding: 20_000 });

/**
 * @param {object} options
 * @param {() => boolean} options.needsStop   whether a local workspace started by this app may be running
 * @param {(signal: AbortSignal) => Promise<unknown>} options.stop   stops it
 * @param {() => void} options.onStopping   shows that it is stopping
 * @param {(error: unknown, timedOut: boolean, signal: AbortSignal) => Promise<void>} options.onFailed   tells the
 *   owner it may still run; the signal closes that message if logout, restart or shutdown begins
 * @param {() => void} options.quit   quits the app again once stopping is over
 */
export function createQuitControl({ needsStop, stop, onStopping, onFailed, quit, timeouts = stopTimeouts,
  timers = { setTimeout, clearTimeout } }) {
  let state = "running"; // running → stopping → done
  let ending = false;
  let shorten;
  let dismiss;

  async function stopWorkspace() {
    const controller = new AbortController();
    let timer;
    let timedOut = false;
    const deadline = new Promise(resolve => {
      const arm = ms => {
        timers.clearTimeout(timer);
        timer = timers.setTimeout(() => { timedOut = true; controller.abort(); resolve(); }, ms);
      };
      arm(ending ? timeouts.systemEnding : timeouts.quit);
      shorten = () => arm(timeouts.systemEnding);
    });
    let failure;
    try {
      await Promise.race([stop(controller.signal), deadline]);
    } catch (error) { failure = error; }
    finally {
      timers.clearTimeout(timer);
      shorten = undefined;
    }
    if ((failure || timedOut) && !ending) {
      const warning = new AbortController();
      dismiss = () => warning.abort();
      const dismissed = new Promise(resolve => warning.signal.addEventListener('abort', resolve, { once: true }));
      await Promise.race([onFailed(failure, timedOut, warning.signal).catch(() => {}), dismissed]);
      dismiss = undefined;
    }
  }

  async function finish(after) {
    state = "stopping";
    try { onStopping(); } catch { /* Showing progress is best effort. */ }
    await stopWorkspace();
    state = "done";
    after();
  }

  return {
    /** For `before-quit`: holds the quit while the local workspace stops, then quits again. */
    beforeQuit(event) {
      if (state === "done") return;
      if (state === "running" && !needsStop()) { state = "done"; return; }
      event.preventDefault();
      if (state === "running") void finish(quit);
    },
    /** For powerMonitor `shutdown`: logout, restart or shutdown is under way. */
    systemEnding() {
      ending = true;
      shorten?.();
      dismiss?.();
    },
    /** Stops the workspace like a quit, then runs `install` (an update's quit and relaunch) instead. */
    async beforeInstall(install) {
      if (state !== "running") return;
      if (!needsStop()) { state = "done"; install(); return; }
      await finish(install);
    },
    /** Whether windows may close for good, because the app is quitting. */
    get quitting() { return state === "done"; },
    get stopping() { return state === "stopping"; },
  };
}
