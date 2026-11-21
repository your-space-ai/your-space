// The release turns off Node's inspector. Drive its real rendered windows
// through Chromium's loopback-only test endpoint and a fresh disposable profile.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, _electron as electron } from "@playwright/test";

export async function launchDesktop(source, userData) {
  const executable = process.env.YS_DESKTOP_EXECUTABLE;
  if (!executable) return electron.launch({args:[source, "--user-data-dir=" + userData]});
  const proc = spawn(executable, [
    "--user-data-dir=" + userData, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  ], {
    // With RunAsNode enabled, this would enter the Node CLI instead of opening the launcher.
    env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},
    stdio:["ignore","ignore","pipe"],
  });
  const exited = once(proc,"exit");
  let browser;
  try {
    const endpoint = await new Promise((resolve,reject) => {
      let tail = "";
      // First launch can spend tens of seconds translating Electron on a Mac running Rosetta.
      const timer = setTimeout(() => reject(new Error("Packaged renderer debugging endpoint timed out")),60_000);
      proc.stderr.setEncoding("utf8").on("data", data => {
        tail = (tail + data).slice(-4096);
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z\d-]+)/i.exec(tail);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      exited.then(() => { clearTimeout(timer); reject(new Error("Packaged app exited before its renderer was ready")); },reject);
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Missing packaged renderer context");
    return {
      firstWindow: async () => context.pages()[0] ?? context.waitForEvent("page"),
      waitForEvent: name => {
        if (name !== "window") throw new Error("Expected a renderer window");
        return context.waitForEvent("page");
      },
      close: async () => {
        proc.kill("SIGTERM");
        await exited;
        await browser.close();
      },
    };
  } catch (error) {
    proc.kill("SIGKILL");
    await exited.catch(() => {});
    await browser?.close().catch(() => {});
    throw error;
  }
}
