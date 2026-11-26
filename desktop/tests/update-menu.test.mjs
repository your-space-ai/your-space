import assert from "node:assert/strict";
import test from "node:test";
import { canaryWarning, checkFailedDetail, chooseChannel, leavingCanary, updateMenu, upToDateMessage } from "../src/update-menu.mjs";

const canary = "0.1.0-alpha.2.canary.20261201.60";
const shape = items => items.map(({ type, label, checked, enabled, submenu }) =>
  ({ type, label, checked, enabled, ...(submenu ? { submenu: shape(submenu) } : {}) }));

test("Your Space › Update Channel offers Alpha and Canary as radio items, beside Check for Updates Automatically", () => {
  const calls = [];
  const menu = updateMenu({
    automatic: true, channel: "alpha", version: "0.1.0-alpha.2", installing: false,
    check: () => calls.push(["check"]), setAutomatic: value => calls.push(["automatic", value]), choose: channel => calls.push(["choose", channel]),
  });
  assert.deepEqual(shape(menu), [
    { type: undefined, label: "Check for Updates…", checked: undefined, enabled: undefined },
    { type: "checkbox", label: "Check for Updates Automatically", checked: true, enabled: undefined },
    { type: undefined, label: "Update Channel", checked: undefined, enabled: undefined, submenu: [
      { type: "radio", label: "Alpha", checked: true, enabled: true },
      { type: "radio", label: "Canary", checked: false, enabled: true },
    ] },
  ]);
  menu[0].click();
  menu[1].click({ checked: false });
  for (const item of menu[2].submenu) item.click();
  assert.deepEqual(calls, [["check"], ["automatic", false], ["choose", "alpha"], ["choose", "canary"]]);

  const following = updateMenu({ automatic: false, channel: "canary", version: canary, installing: true, check() {}, setAutomatic() {}, choose() {} });
  assert.deepEqual(shape(following[2].submenu), [
    { type: "radio", label: "Alpha", checked: false, enabled: false },
    { type: "radio", label: "Canary", checked: true, enabled: false },
  ], "the channel can't change once an update has gone to Squirrel.Mac");
  assert.equal(following[1].checked, false);
});

test("on a canary build set to Alpha, the menu says it moves to Alpha with the next alpha", () => {
  const menu = updateMenu({ automatic: true, channel: "alpha", version: canary, installing: false, check() {}, setAutomatic() {}, choose() {} });
  assert.deepEqual(shape(menu[2].submenu).slice(2), [
    { type: "separator", label: undefined, checked: undefined, enabled: undefined },
    { type: undefined, label: "You’ll move to Alpha with the next alpha", checked: undefined, enabled: false },
  ]);
  for (const [channel, version] of [["canary", canary], ["alpha", "0.1.0-alpha.2"]]) {
    const other = updateMenu({ automatic: true, channel, version, installing: false, check() {}, setAutomatic() {}, choose() {} });
    assert.equal(other[2].submenu.length, 2, `${channel} on ${version}`);
  }
});

function choosing({ current = "alpha", version = "0.1.0-alpha.2", answer = 0, refuse } = {}) {
  const asked = [];
  const stored = [];
  const options = {
    current, version,
    ask: async message => { asked.push(message); return answer; },
    setChannel: async channel => {
      if (refuse) throw refuse;
      stored.push(channel);
    },
  };
  return { asked, stored, options };
}

test("choosing Canary first warns that canaries are unsupported, and Cancel, the default, keeps Alpha", async () => {
  assert.equal(canaryWarning.type, "warning");
  assert.match(canaryWarning.detail, /aren’t supported/);
  assert.match(canaryWarning.detail, /may change your data in ways the next alpha doesn’t expect/);
  assert.deepEqual(canaryWarning.buttons, ["Cancel", "Use Canary"]);
  assert.equal(canaryWarning.defaultId, 0);
  assert.equal(canaryWarning.cancelId, 0);

  const cancelled = choosing({ answer: 0 });
  assert.equal(await chooseChannel("canary", cancelled.options), "alpha");
  assert.deepEqual(cancelled.asked, [canaryWarning]);
  assert.deepEqual(cancelled.stored, [], "nothing changes");

  const accepted = choosing({ answer: 1 });
  assert.equal(await chooseChannel("canary", accepted.options), "canary");
  assert.deepEqual(accepted.stored, ["canary"]);

  const same = choosing({ current: "canary" });
  assert.equal(await chooseChannel("canary", same.options), "canary");
  assert.deepEqual([same.asked, same.stored], [[], []], "choosing the channel already followed does nothing");
});

test("choosing Alpha on a canary build stores it at once and says it takes effect with the next alpha", async () => {
  const leaving = choosing({ current: "canary", version: canary });
  assert.equal(await chooseChannel("alpha", leaving.options), "alpha");
  assert.deepEqual(leaving.stored, ["alpha"]);
  assert.equal(leaving.asked.length, 1);
  assert.equal(leaving.asked[0].message, leavingCanary);
  assert.match(leaving.asked[0].detail, new RegExp(`canary ${canary.replaceAll(".", "\\.")}`));

  const release = choosing({ current: "canary", version: "0.1.0-alpha.2" });
  assert.equal(await chooseChannel("alpha", release.options), "alpha");
  assert.deepEqual(release.asked, [], "a release build moves with its next check");
});

test("while an update installs, the channel stays and the app says why; other failures reach the caller", async () => {
  const installing = choosing({ answer: 1, refuse: Object.assign(new Error("installing"), { code: "installing" }) });
  assert.equal(await chooseChannel("canary", installing.options), "alpha");
  assert.equal(installing.asked.at(-1).message, "Your Space is installing an update");

  const broken = choosing({ refuse: new Error("disk full") });
  await assert.rejects(chooseChannel("canary", { ...broken.options, ask: async () => 1 }), /disk full/);
});

test("Check for Updates… says when nothing is newer on the channel, and that an unreadable feed offered nothing", () => {
  assert.deepEqual(upToDateMessage("0.1.0-alpha.2", "alpha"),
    { message: "Your Space is up to date", detail: "Version 0.1.0-alpha.2 is the newest Alpha build." });
  assert.deepEqual(upToDateMessage(canary, "canary"),
    { message: "Your Space is up to date", detail: `Version ${canary} is the newest Canary build.` });
  assert.deepEqual(upToDateMessage(canary, "alpha"),
    { message: "No alpha is newer than this canary yet", detail: `This is canary ${canary}. You’ll move to Alpha with the next alpha.` });
  for (const [channel, name] of [["alpha", "Alpha"], ["canary", "Canary"]]) {
    assert.match(checkFailedDetail(channel), new RegExp(`couldn’t read the ${name} channel’s feed, so it offers nothing`));
  }
});
