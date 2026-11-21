import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("inspects and upgrades by exact installation token and digest, sending the candidate only on stdin", () => {
  const dir = mkdtempSync(join(tmpdir(), "ys-cli-kit-"));
  const command = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const expected = ["--expect-kit", "sha256:" + "a".repeat(64), "--expect-installation", "install:" + "b".repeat(64)];
  const candidate = "\uFEFFkit: 2\r\n# local fixture\r\n";
  const capture = join(dir, "received.json");
  const call = (args: string[], input?: string, conflict = false) => {
    const result = spawnSync(process.execPath, [command, "--workdir", dir, "--json", "app", "upgrade-agent-kit", "records", ...args], {
      input, encoding: "utf8", env: { ...process.env, PATH: dir + ":" + process.env.PATH, CAPTURE: capture, CONFLICT: conflict ? "1" : "" },
    });
    expect(result.stdout + result.stderr).not.toContain("local fixture");
    return { code: result.status, json: JSON.parse(result.stdout) };
  };
  try {
    writeFileSync(join(dir, "compose.yaml"), "name: your-space\n");
    writeFileSync(join(dir, "stack.yaml"), "services: {}\n");
    const file = join(dir, "local kit.yaml");
    writeFileSync(file, candidate);
    writeFileSync(join(dir, "docker"), `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
writeFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(2), input: readFileSync(0, "utf8") }));
if (process.env.CONFLICT) {
  console.log(JSON.stringify({ ok: false, error: "upgrade_conflict", message: "Inspect the installed kit again." }));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ ok: true, name: "records", appId: "example-id", installation: "install:token", kitVersion: 2, kitSource: "example-source" }));
}
`, { mode: 0o700 });
    const received = () => JSON.parse(readFileSync(capture, "utf8"));
    const prefix = ["compose", "exec", "-T", "server", "upgrade-agent-kit", "records"];
    expect(call(["--inspect"]).json.appId).toBe("example-id");
    expect(received()).toEqual({ args: [...prefix, "--inspect", "--json"], input: "" });
    for (const source of [file, "-"]) {
      expect(call(["--kit", source, ...expected], source === "-" ? candidate : undefined).code).toBe(0);
      expect(received()).toEqual({ args: [...prefix, ...expected, "--kit", "-", "--json"], input: candidate });
    }
    expect(call(["--refresh", ...expected]).code).toBe(0);
    expect(received()).toEqual({ args: [...prefix, ...expected, "--refresh", "--json"], input: "" });
    expect(call(["--refresh", ...expected], undefined, true)).toMatchObject({ code: 2, json: { error: "upgrade_conflict" } });
    expect(call(["--inspect", "--kit", file]).json.error).toBe("usage");
    expect(call(["--kit", file, "--expect-kit", expected[1]!]).json.error).toBe("usage");
    expect(call(["--kit", "-", ...expected], "x".repeat(256 * 1024 + 1)).json.error).toBe("kit_file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
