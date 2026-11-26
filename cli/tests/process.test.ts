// Running another program and collecting what it printed (src/process.ts).
import { describe, expect, it } from "vitest";
import { run } from "../src/process.ts";

/** A script that prints "é" to each of `streams`, its two bytes in separate writes. */
const split = (streams: string[]) => `const write = (byte) => { for (const name of ${JSON.stringify(streams)}) process[name].write(Buffer.from([byte])); };
write(0xc3);
setTimeout(() => write(0xa9), 100);`;

describe("run", () => {
  it("keeps a character whole when its bytes arrive in separate reads", async () => {
    expect(await run(process.execPath, ["-e", split(["stdout", "stderr"])])).toEqual({ code: 0, stdout: "é", stderr: "é" });
    // As upgrade --channel collects the build's upgrade's output with --json.
    expect(await run(process.execPath, ["-e", split(["stdout"])], { inherit: true, collectStdout: true })).toEqual({ code: 0, stdout: "é", stderr: "" });
  });
});
