import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("shows why the server refused a kit, and keeps its code", () => {
  const dir = mkdtempSync(join(tmpdir(), "ys-cli-install-local-"));
  const command = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const { DOCKER_CONTEXT: _context, ...env } = process.env;
  const install = (json: boolean) =>
    spawnSync(process.execPath, [command, "--workdir", dir, ...(json ? ["--json"] : []), "app", "install-local", join(dir, "app")], {
      encoding: "utf8",
      env: { ...env, PATH: dir + ":" + process.env.PATH, DOCKER_HOST: "unix:///var/run/docker.sock", NO_COLOR: "1" },
    });
  try {
    writeFileSync(join(dir, "compose.yaml"), "name: your-space\n");
    writeFileSync(join(dir, "stack.yaml"), "services: {}\n");
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "compose.yaml"), "services: {}\n");
    writeFileSync(join(dir, "app", "kit.yaml"), "kit: 2\n");
    // Docker answers the engine checks, and the server refuses the kit the way install-app does.
    writeFileSync(join(dir, "docker"), `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "version --format json") console.log(JSON.stringify({ Server: { Version: "29.1.0", Os: "linux", Arch: "x86_64" } }));
else if (args === "compose version --short") console.log("2.40.0");
else if (args.startsWith("compose ls")) console.log("[]");
else if (args.startsWith("compose exec -T server install-app")) {
  console.log(JSON.stringify({ ok: false, error: "refused", name: "notes", refusals: [{ service: "web", reason: "Uses the host's network." }] }));
  process.exitCode = 2;
} else process.exitCode = 1;
`, { mode: 0o700 });

    const human = install(false);
    expect(human.status).toBe(2);
    expect(human.stderr).toContain("Your Space can't run notes as it is:");
    expect(human.stderr).toContain("web: Uses the host's network.");
    expect(human.stderr).not.toContain("The server's command failed.");

    const json = install(true);
    expect(json.status).toBe(2);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, error: "refused", name: "notes", refusals: [{ service: "web", reason: "Uses the host's network." }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
