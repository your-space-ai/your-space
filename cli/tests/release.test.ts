import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { checkSum, fetchRelease, parseSums, pinProblem, releasePins, releaseUrl, safeEntries } from "../src/release.ts";
import { compareVersions, isCanary, isVersion } from "../src/version.ts";

// Every program the CLI runs, still run for real.
const ran = vi.hoisted(() => [] as string[][]);
vi.mock("../src/process.ts", async (original) => {
  const actual = await original<typeof import("../src/process.ts")>();
  return { ...actual, run: (program: string, args: string[], options?: object) => (ran.push([program, ...args]), actual.run(program, args, options)) };
});

it("reads the release from stack.yaml's image pins, and from a file pinned before 2026-11-23", () => {
  expect(releasePins("image: ghcr.io/your-space-ai/your-space-server:0.2.0\n  image: ghcr.io/your-space-ai/your-space-web:0.2.0\n")).toEqual(["0.2.0", "0.2.0"]);
  expect(releasePins("image: ghcr.io/your-space-ai/your-space-server:${YS_VERSION:-0.1.0}\n")).toEqual(["0.1.0"]);
  expect(releasePins("image: postgres:18\n")).toEqual([]);
});

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
      writeFileSync(join(root, "stack.yaml"), "image: ghcr.io/your-space-ai/your-space-server:0.1.0\n");
      const archive = join(assets, "your-space.tar.gz");
      execFileSync("tar", ["-czf", archive, "-C", root, "stack.yaml"]);
      const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
      writeFileSync(join(assets, "SHA256SUMS"), digest + "  your-space.tar.gz\n");
      await expect(fetchRelease("0.2.0", install, assets)).rejects.toMatchObject({ code: "checksum_mismatch" });
      expect(readdirSync(install)).toEqual([]);
      await fetchRelease("0.1.0", install, assets);
      expect(readFileSync(join(install, "stack.yaml"), "utf8")).toBe(readFileSync(join(root, "stack.yaml"), "utf8"));
      // Unpacked as root, the files would otherwise keep the build machine's owner.
      expect(ran.filter(([program, ...args]) => program === "tar" && args.includes("-xzf"))).toEqual([
        ["tar", "--no-same-owner", "-xzf", expect.stringContaining(install), "-C", install],
      ]);
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

/** The version the Canary workflow gives a build of main after `tag`, from deploy/canary-version.sh. */
const canary = (tag: string, day = "20261125", build = "42") =>
  execFileSync(new URL("../../deploy/canary-version.sh", import.meta.url).pathname, [tag, day, build], { encoding: "utf8" }).trim();

/** your-space.tar.gz with a stack.yaml that runs `version`, and its SHA256SUMS, in `folder`. */
function bundle(root: string, folder: string, version: string): void {
  mkdirSync(folder, { recursive: true });
  const files = mkdtempSync(join(root, "files-"));
  writeFileSync(join(files, "stack.yaml"), `image: ghcr.io/your-space-ai/your-space-server:${version}\n`);
  execFileSync("tar", ["-czf", join(folder, "your-space.tar.gz"), "-C", files, "stack.yaml"]);
  const digest = createHash("sha256").update(readFileSync(join(folder, "your-space.tar.gz"))).digest("hex");
  writeFileSync(join(folder, "SHA256SUMS"), `${digest}  your-space.tar.gz\n`);
}

describe("canary builds", () => {
  it("follow the release before them, with valid Semantic Versioning", () => {
    expect(canary("v0.1.0-alpha.1")).toBe("0.1.0-alpha.1.canary.20261125.42");
    expect(canary("v0.1.0-beta.2", "20261201", "7")).toBe("0.1.0-beta.2.canary.20261201.7");
    // After a stable release, the next patch's, before any of its prereleases.
    expect(canary("v0.1.0")).toBe("0.1.1-0.canary.20261125.42");
    for (const tag of ["v0.1.0-alpha.1", "v0.1.0-beta.2", "v0.1.0", "v1.9.9"]) {
      expect(isVersion(canary(tag)), tag).toBe(true);
      expect(isCanary(canary(tag)), tag).toBe(true);
    }
    // Only numbered alphas and betas: after alpha, a canary (alpha.canary.…) would sort after alpha.1,
    // and after alpha.1.1 one would sort after alpha.1.2.
    for (const bad of [["canary"], ["v0.1.0-rc.1"], ["v0.1.0-alpha.01"], ["v0.1.0-alpha"], ["v0.1.0-alpha.1.1"], ["v0.1.0-beta.x"], ["v0.1.0", "01261125"], ["v0.1.0", "20261125", "0"], ["v0.1.0", "20261125", "007"]]) {
      expect(() => execFileSync(new URL("../../deploy/canary-version.sh", import.meta.url).pathname, [bad[0]!, bad[1] ?? "20261125", bad[2] ?? "1"], { stdio: "pipe" }), bad.join(" ")).toThrow();
    }
  });

  it("sort after the release they follow and before any later one, so upgrade moves onto one and on from it", () => {
    const ordered = [
      "0.1.0-alpha.1",
      canary("v0.1.0-alpha.1", "20261125", "9"),
      canary("v0.1.0-alpha.1", "20261125", "10"),
      canary("v0.1.0-alpha.1", "20261126", "11"),
      "0.1.0-alpha.2",
      canary("v0.1.0-alpha.2", "20261201", "12"),
      "0.1.0-beta.1",
      canary("v0.1.0-beta.1", "20261202", "13"),
      "0.1.0",
      canary("v0.1.0", "20261203", "14"),
      "0.1.1-alpha.1",
      "0.1.1",
      "0.2.0-alpha.1",
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        expect(Math.sign(compareVersions(ordered[i]!, ordered[j]!)), `${ordered[i]} vs ${ordered[j]}`).toBe(Math.sign(i - j));
      }
    }
  });

  it("are never a release: no release version counts as a canary", () => {
    for (const version of ["0.1.0", "0.1.0-alpha.1", "0.1.0-beta.2", "1.0.0", "0.1.0-alpha.1+canary"]) expect(isCanary(version), version).toBe(false);
    expect(isCanary("latest")).toBe(false);
  });

  it("download from the rolling canary prerelease, and a release from its own", () => {
    delete process.env.YS_E2E_RELEASES;
    expect(releaseUrl("0.1.0-alpha.1.canary.20261125.42", "SHA256SUMS")).toBe("https://github.com/your-space-ai/your-space/releases/download/canary/SHA256SUMS");
    expect(releaseUrl("0.1.0-alpha.1", "SHA256SUMS")).toBe("https://github.com/your-space-ai/your-space/releases/download/v0.1.0-alpha.1/SHA256SUMS");
  });

  it("say when the canary prerelease has moved on to another build", () => {
    const mine = "0.1.0-alpha.1.canary.20261125.42";
    const newer = "0.1.0-alpha.1.canary.20261126.43";
    expect(pinProblem([mine, mine], mine, false)).toBeNull();
    expect(pinProblem([newer, newer], mine, false)).toMatch(/^The canary release now holds Your Space 0\.1\.0-alpha\.1\.canary\.20261126\.43, not this CLI's 0\.1\.0-alpha\.1\.canary\.20261125\.42.*Run the canary build/);
    expect(pinProblem([newer], mine, true)).toBe("The bundled installation files belong to a different CLI version.");
    expect(pinProblem(["0.1.0-alpha.2"], "0.1.0-alpha.1", false)).toMatch(/doesn't run Your Space 0\.1\.0-alpha\.1/);
    expect(pinProblem([], "0.1.0-alpha.1", false)).not.toBeNull();
  });

  it("unpack only the canary build of the CLI's own version, checked against the prerelease's checksums", async () => {
    const root = mkdtempSync(join(tmpdir(), "your-space-canary-"));
    const served = join(root, "served");
    const server = createServer((request, response) => {
      try {
        response.end(readFileSync(join(served, decodeURIComponent(new URL(request.url!, "http://x").pathname))));
      } catch {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.YS_E2E_RELEASES = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const mine = "0.1.0-alpha.1.canary.20261125.42";
      const install = join(root, "install");
      mkdirSync(install);
      // A release's own files, under its tag, are never read for a canary.
      bundle(root, join(served, "v0.1.0-alpha.1"), "0.1.0-alpha.1");
      bundle(root, join(served, "canary"), "0.1.0-alpha.1.canary.20261126.43");
      await expect(fetchRelease(mine, install)).rejects.toMatchObject({ code: "checksum_mismatch", message: expect.stringContaining("The canary release now holds") });
      expect(readdirSync(install)).toEqual([]);
      bundle(root, join(served, "canary"), mine);
      writeFileSync(join(served, "canary", "your-space.tar.gz"), "changed");
      await expect(fetchRelease(mine, install)).rejects.toMatchObject({ code: "checksum_mismatch", message: expect.stringContaining("doesn't match") });
      expect(readdirSync(install)).toEqual([]);
      bundle(root, join(served, "canary"), mine);
      await fetchRelease(mine, install);
      expect(releasePins(readFileSync(join(install, "stack.yaml"), "utf8"))).toEqual([mine]);
    } finally {
      delete process.env.YS_E2E_RELEASES;
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** The channel.json deploy/channel-json.sh writes for a channel's build; it throws when the script refuses. */
const channelJson = (...args: string[]) =>
  execFileSync(new URL("../../deploy/channel-json.sh", import.meta.url).pathname, args, { encoding: "utf8", stdio: "pipe" });
const commit = "69525a9569f68a39b76598af86662a04b6fb2886";

describe("channel.json", () => {
  it("names a channel's build and its commit, in the one form every client reads", () => {
    expect(channelJson("canary", canary("v0.1.0-alpha.1"), commit)).toBe(`{"channel":"canary","version":"0.1.0-alpha.1.canary.20261125.42","commit":"${commit}"}\n`);
    expect(JSON.parse(channelJson("alpha", "0.1.0-alpha.2", commit))).toEqual({ channel: "alpha", version: "0.1.0-alpha.2", commit });
  });

  it("names only a canary for Canary and never one for Alpha, telling them apart as the CLI does", () => {
    const versions = [
      "0.1.0", "0.1.0-alpha.1", "0.1.0-beta.2", "1.0.0", "0.1.0-alpha.1+canary", "0.1.0-alpha.1.canaryx.1",
      canary("v0.1.0-alpha.1"), canary("v0.1.0"), canary("v0.1.0-beta.2"), "0.1.0-canary", "0.1.0-alpha.canary.1+build.5",
      "01.0.0", "0.1.0-alpha.01", "0.1.0-", "0.1", "v0.1.0", "latest", "",
    ];
    for (const version of versions) {
      for (const channel of ["alpha", "canary"]) {
        const accepted = isVersion(version) && isCanary(version) === (channel === "canary");
        if (accepted) expect(JSON.parse(channelJson(channel, version, commit))).toEqual({ channel, version, commit });
        else expect(() => channelJson(channel, version, commit), `${channel} ${version}`).toThrow();
      }
    }
  });

  it("refuses another channel and a commit that isn't a full one", () => {
    for (const bad of [["beta", "0.1.0-beta.1", commit], ["Canary", canary("v0.1.0-alpha.1"), commit], ["canary", canary("v0.1.0-alpha.1"), commit.slice(0, 7)], ["canary", canary("v0.1.0-alpha.1"), commit.toUpperCase()], ["alpha", "0.1.0-alpha.2", `${commit}0`]]) {
      expect(() => channelJson(...bad), bad.join(" ")).toThrow();
    }
  });

  it("is recorded, as the Canary workflow writes it, for the test that Alpha clients never get a canary", () => {
    const recorded = readFileSync(new URL("../../shared/release-channels/fixtures/canary/channel.json", import.meta.url), "utf8");
    const named = JSON.parse(recorded) as { channel: string; version: string; commit: string };
    expect(channelJson(named.channel, named.version, named.commit)).toBe(recorded);
    expect(named.channel).toBe("canary");
    // A canary whose version contains -alpha. and sorts after the release it follows.
    expect(named.version).toContain("-alpha.");
    expect(compareVersions(named.version, "0.1.0-alpha.1")).toBeGreaterThan(0);
  });
});

describe("the guide's steps", () => {
  it("unpack the release as the CLI does, owned by whoever unpacks it", () => {
    const guide = readFileSync(new URL("../../docs/install/manual.md", import.meta.url), "utf8");
    expect(guide).toContain("\ntar --no-same-owner -xzf your-space.tar.gz\n");
    expect(guide).not.toMatch(/^tar -xzf/m);
  });

  it("give PostgreSQL the database password with the guide's own command", async () => {
    const { readFileSync } = await import("node:fs");
    const { GIVE_POSTGRES_PASSWORD } = await import("../src/secrets.ts");
    const guide = readFileSync(new URL("../../docs/operate/recovery.md", import.meta.url), "utf8");
    const section = guide.slice(guide.indexOf("### Give PostgreSQL the Database Password"));
    const heredoc = section.slice(section.indexOf("<<'EOF'\n") + "<<'EOF'\n".length, section.indexOf("\nEOF\n") + 1);
    expect(GIVE_POSTGRES_PASSWORD).toBe(heredoc);
  });
});
