import { describe, expect, it } from "vitest";
import { stoppedApps, stopQuestion } from "../src/commands/stop.ts";

describe("stop", () => {
  it("asks before cutting an install off", () => {
    expect(stopQuestion([{ name: "sure", state: "installing" }, { name: "twenty", state: "running" }])).toBe(
      "sure is still being installed or started; stopping cuts that off. Stop anyway?",
    );
    expect(stopQuestion([{ name: "sure", state: "running" }])).toBeNull();
    expect(stopQuestion([])).toBeNull();
  });

  it("asks when the apps couldn't be listed, rather than reading that as no apps", () => {
    expect(stopQuestion(null)).toMatch(/couldn't say whether an app is still being installed/);
    expect(stoppedApps(null)).toBeNull();
  });

  it("names the apps it stops", () => {
    expect(stoppedApps([{ name: "sure", state: "running" }, { name: "old", state: "stopped" }, { name: "gone", state: "removed" }])).toEqual(["sure"]);
  });
});
