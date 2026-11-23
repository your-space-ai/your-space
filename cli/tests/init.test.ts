import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Installation } from "../src/installation.ts";
import { VERSION } from "../src/version.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

describe(".env", () => {
  it("is left owner-only by init, though env.example in the release is readable by everyone", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-cli-init-"));
    const command = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const { DOCKER_CONTEXT: _context, ...env } = process.env;
    try {
      const files = join(dir, "files"), release = join(dir, "release"), bin = join(dir, "bin"), folder = join(dir, "install");
      for (const path of [join(files, "modes"), release, bin]) mkdirSync(path, { recursive: true });
      writeFileSync(join(files, "compose.yaml"), "name: your-space\n");
      writeFileSync(join(files, "stack.yaml"), `image: example:\${YS_VERSION:-${VERSION}}\n`);
      writeFileSync(join(files, "modes", "mode.yaml"), "services: {}\n");
      writeFileSync(join(files, "env.example"), "# YS_PORT=8081\n");
      chmodSync(join(files, "env.example"), 0o644);
      const archive = join(release, "your-space.tar.gz");
      execFileSync("tar", ["-czf", archive, "-C", files, "compose.yaml", "stack.yaml", "modes", "env.example"]);
      writeFileSync(join(release, "SHA256SUMS"), `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  your-space.tar.gz\n`);
      // Docker answers the engine checks; nothing runs Your Space yet.
      writeFileSync(join(bin, "docker"), `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "version --format json") console.log(JSON.stringify({ Server: { Version: "29.1.0", Os: "linux", Arch: "x86_64" } }));
else if (args === "compose version --short") console.log("2.40.0");
else if (args.startsWith("compose ls")) console.log("[]");
else process.exitCode = 1;
`, { mode: 0o700 });

      const ran = spawnSync(process.execPath, [command, "--workdir", folder, "--json", "init", "--port", "8081", "--release-dir", release, "--yes"], {
        encoding: "utf8",
        env: { ...env, PATH: bin + ":" + process.env.PATH, DOCKER_HOST: "unix:///var/run/docker.sock" },
      });
      expect(ran.status, ran.stdout + ran.stderr).toBe(0);
      expect(JSON.parse(ran.stdout)).toMatchObject({ ok: true, env: ["YS_PORT=8081"] });
      expect(readFileSync(join(folder, ".env"), "utf8")).toBe("YS_PORT=8081\n");
      expect(mode(join(folder, "env.example"))).toBe(0o644);
      expect(mode(join(folder, ".env"))).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is made owner-only when configure writes or puts back one that existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-cli-env-"));
    try {
      const installation = new Installation(dir);
      writeFileSync(installation.envPath, "# YS_PORT=8081\n", { mode: 0o644 });
      chmodSync(installation.envPath, 0o644);
      expect(installation.writeEnv({ YS_PORT: "8082" })).toEqual(["YS_PORT=8082"]);
      expect(mode(installation.envPath)).toBe(0o600);
      chmodSync(installation.envPath, 0o644);
      installation.writeEnvText("# YS_PORT=8081\n");
      expect(readFileSync(installation.envPath, "utf8")).toBe("# YS_PORT=8081\n");
      expect(mode(installation.envPath)).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
