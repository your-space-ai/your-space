import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkSum, fetchRelease, parseSums, releaseUrl, safeEntries } from "../src/release.ts";

describe("release files", () => {
  it("are downloaded from the release of the CLI's version", () => {
    delete process.env.YS_E2E_RELEASES;
    expect(releaseUrl("0.3.0", "your-space.tar.gz")).toBe("https://github.com/your-space-ai/your-space/releases/download/v0.3.0/your-space.tar.gz");
    process.env.YS_E2E_RELEASES = "http://127.0.0.1:9000/";
    expect(releaseUrl("0.3.0", "SHA256SUMS")).toBe("http://127.0.0.1:9000/v0.3.0/SHA256SUMS");
    delete process.env.YS_E2E_RELEASES;
  });

  it("are unpacked only when they match the release's checksum", () => {
    const data = Buffer.from("release");
    const hash = createHash("sha256").update(data).digest("hex");
    const sums = parseSums(`${hash}  your-space.tar.gz\n${"0".repeat(64)} *your-space-linux-x64\n`);
    expect(sums.get("your-space-linux-x64")).toBe("0".repeat(64));
    expect(() => checkSum("your-space.tar.gz", data, sums)).not.toThrow();
    expect(() => checkSum("your-space.tar.gz", Buffer.from("changed"), sums)).toThrow(/doesn't match/);
    expect(() => checkSum("other.tar.gz", data, sums)).toThrow(/don't list/);
  });

  it("checks a packaged archive and its pinned version before extracting any files", async () => {
    const root = mkdtempSync(join(tmpdir(), "your-space-release-"));
    try {
      const assets = join(root, "release"), install = join(root, "install");
      mkdirSync(assets);
      mkdirSync(install);
      writeFileSync(join(root, "stack.yaml"), "image: example:${YS_VERSION:-0.1.0}\n");
      const archive = join(assets, "your-space.tar.gz");
      execFileSync("tar", ["-czf", archive, "-C", root, "stack.yaml"]);
      const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
      writeFileSync(join(assets, "SHA256SUMS"), digest + "  your-space.tar.gz\n");
      await expect(fetchRelease("0.2.0", install, assets)).rejects.toMatchObject({ code: "checksum_mismatch" });
      expect(readdirSync(install)).toEqual([]);
      await fetchRelease("0.1.0", install, assets);
      expect(readFileSync(join(install, "stack.yaml"), "utf8")).toBe(readFileSync(join(root, "stack.yaml"), "utf8"));
      writeFileSync(archive, "different");
      await expect(fetchRelease("0.1.0", install, assets)).rejects.toMatchObject({ code: "checksum_mismatch" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never write outside the folder", () => {
    expect(safeEntries("compose.yaml\nstack.yaml\nmodes/\nmodes/mode.yaml\nenv.example\n")).toBe(true);
    expect(safeEntries("compose.yaml\n../outside\n")).toBe(false);
    expect(safeEntries("/etc/passwd\n")).toBe(false);
    expect(safeEntries("")).toBe(false);
  });
});

describe("the guide's steps", () => {
  it("give PostgreSQL the database password with the guide's own command", async () => {
    const { readFileSync } = await import("node:fs");
    const { GIVE_POSTGRES_PASSWORD } = await import("../src/secrets.ts");
    const guide = readFileSync(new URL("../../docs/install/README.md", import.meta.url), "utf8");
    const section = guide.slice(guide.indexOf("### Give PostgreSQL the Database Password"));
    const heredoc = section.slice(section.indexOf("<<'EOF'\n") + "<<'EOF'\n".length, section.indexOf("\nEOF\n") + 1);
    expect(GIVE_POSTGRES_PASSWORD).toBe(heredoc);
  });
});
