import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

test("the launcher bridge exposes fixed operations and projects their arguments", async () => {
  const source = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const calls = [];
  const listeners = [];
  let bridge;
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (name, methods) => {
          assert.equal(name, "yourSpace");
          bridge = methods;
        } },
        ipcRenderer: {
          invoke: (...args) => { calls.push(args); return "reply"; },
          on: (channel, listener) => listeners.push([channel, listener]),
        },
      };
    },
  });
  assert.ok(Object.isFrozen(bridge));
  assert.deepEqual(Object.keys(bridge).sort(), ["appearance", "connect", "createOwner", "engines", "onRefresh", "open", "openDockerGuide", "remove", "rename", "start", "workspaces"]);
  bridge.appearance("ignored");
  assert.equal(bridge.engines(), "reply");
  bridge.start({ engine: "local", expectedSocket: "/run/test.sock", extra: "ignored" });
  bridge.createOwner({ name: "Fixture", username: "fixture", extra: "ignored" });
  bridge.connect({ url: "https://workspace.example", name: "Home server", extra: "ignored" });
  bridge.workspaces("ignored");
  bridge.open({ origin: "https://workspace.example", extra: "ignored" });
  bridge.rename({ origin: "https://workspace.example", name: "Office", extra: "ignored" });
  bridge.remove({ origin: "https://workspace.example", extra: "ignored" });
  bridge.openDockerGuide("https://untrusted.example");
  // Recreate cross-realm objects before comparing their values.
  assert.deepEqual(structuredClone(calls), [
    ["launcher:appearance"],
    ["launcher:engines"],
    ["launcher:start", { engine: "local", expectedSocket: "/run/test.sock" }],
    ["launcher:createOwner", { name: "Fixture", username: "fixture" }],
    ["launcher:connect", { url: "https://workspace.example", name: "Home server" }],
    ["launcher:workspaces"],
    ["launcher:open", { origin: "https://workspace.example" }],
    ["launcher:rename", { origin: "https://workspace.example", name: "Office" }],
    ["launcher:remove", { origin: "https://workspace.example" }],
    ["launcher:openDockerGuide"],
  ]);

  // Only the refresh channel is listened to, and the page's callback gets no event details.
  const received = [];
  bridge.onRefresh("not a function");
  bridge.onRefresh((...args) => received.push(args));
  assert.deepEqual(listeners.map(([channel]) => channel), ["launcher:refresh"]);
  listeners[0][1]({ sender: "private" }, "payload");
  assert.deepEqual(received, [[]]);
});
