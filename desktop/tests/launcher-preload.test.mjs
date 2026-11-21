import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

test("the launcher bridge exposes fixed operations and projects their arguments", async () => {
  const source = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const calls = [];
  let bridge;
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (name, methods) => {
          assert.equal(name, "yourSpace");
          bridge = methods;
        } },
        ipcRenderer: { invoke: (...args) => { calls.push(args); return "reply"; } },
      };
    },
  });
  assert.ok(Object.isFrozen(bridge));
  assert.deepEqual(Object.keys(bridge).sort(), ["connect", "createOwner", "engines", "openDockerGuide", "start"]);
  assert.equal(bridge.engines(), "reply");
  bridge.start({ engine: "local", expectedSocket: "/run/test.sock", extra: "ignored" });
  bridge.createOwner({ name: "Fixture", username: "fixture", extra: "ignored" });
  bridge.connect({ url: "https://workspace.example", extra: "ignored" });
  bridge.openDockerGuide("https://untrusted.example");
  // Recreate cross-realm objects before comparing their values.
  assert.deepEqual(structuredClone(calls), [
    ["launcher:engines"],
    ["launcher:start", { engine: "local", expectedSocket: "/run/test.sock" }],
    ["launcher:createOwner", { name: "Fixture", username: "fixture" }],
    ["launcher:connect", { url: "https://workspace.example" }],
    ["launcher:openDockerGuide"],
  ]);
});
