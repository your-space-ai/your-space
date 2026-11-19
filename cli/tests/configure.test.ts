import { describe, expect, it } from "vitest";
import { putBack } from "../src/commands/configure.ts";
import type { Ran } from "../src/process.ts";

/** `putBack` with a Compose whose `up` gives `up`, and what it wrote, ran and said. */
async function puttingBack(applied: boolean, up: () => Promise<Ran>) {
  const warnings: string[] = [];
  const written: string[] = [];
  const ran: string[][] = [];
  await putBack(
    { warn: (message) => warnings.push(message) },
    { writeEnvText: (text) => written.push(text) },
    {
      run: (args) => {
        ran.push(args);
        return up();
      },
    },
    "YS_PORT=8081\n",
    applied,
  );
  return { warnings, written, ran };
}

describe("configure puts the previous setup back", () => {
  it("without restarting when the new setup was never applied", async () => {
    const back = await puttingBack(false, () => Promise.reject(new Error("not called")));
    expect(back.written).toEqual(["YS_PORT=8081\n"]);
    expect(back.ran).toEqual([]);
    expect(back.warnings).toEqual(["Your previous settings were put back in .env. Your Space still runs with them."]);
  });

  it("and says it restarted only when it did", async () => {
    const back = await puttingBack(true, async () => ({ code: 0, stdout: "", stderr: "" }));
    expect(back.ran).toEqual([["up", "-d", "--wait"]]);
    expect(back.warnings).toEqual(["Your previous settings were put back in .env, and Your Space restarted with them."]);
  });

  it("and says when the previous setup didn't start either, whether Compose failed or threw", async () => {
    const failed = await puttingBack(true, async () => ({ code: 1, stdout: "", stderr: "dependency failed to start" }));
    const threw = await puttingBack(true, () => Promise.reject(new Error("engine unreachable")));
    for (const back of [failed, threw]) {
      expect(back.written).toEqual(["YS_PORT=8081\n"]);
      expect(back.warnings).toEqual([
        "Your previous settings were put back in .env, but Your Space didn't start with them either. See why with: your-space logs",
      ]);
    }
  });
});
