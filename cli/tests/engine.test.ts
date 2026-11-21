import { afterEach, describe, expect, it, vi } from "vitest";
import * as processRunner from "../src/process.ts";
import { otherInstallation } from "../src/compose.ts";
import { checkEngine, engineProblem, engineSocket, versionAtLeast } from "../src/engine.ts";
import { CliError } from "../src/errors.ts";

describe("the engine connection", () => {
  it("compares versions as the guide's minimums need", () => {
    expect(versionAtLeast("29.9.2", "28.3.3")).toBe(true);
    expect(versionAtLeast("28.3.3", "28.3.3")).toBe(true);
    expect(versionAtLeast("28.3.2", "28.3.3")).toBe(false);
    expect(versionAtLeast("v2.26.0", "2.26.0")).toBe(true);
    expect(versionAtLeast("2.25.9-desktop.1", "2.26.0")).toBe(false);
    expect(versionAtLeast("5.6.1", "2.26.0")).toBe(true);
  });

  it("keeps the default socket, writes another one, and refuses a remote engine", () => {
    expect(engineSocket("unix:///var/run/docker.sock", "linux")).toBeNull();
    expect(engineSocket("unix:///run/docker.sock", "linux")).toBe("/run/docker.sock");
    expect(engineSocket("unix:///run/user/1000/docker.sock", "linux")).toBe("/run/user/1000/docker.sock");
    // A Mac's engine runs in a virtual machine, where its own socket is the default.
    expect(engineSocket("unix:///Users/sam/.colima/default/docker.sock", "darwin")).toBeNull();
    for (const host of ["tcp://10.0.0.5:2376", "ssh://sam@server"]) {
      expect(() => engineSocket(host, "linux")).toThrow(CliError);
      try {
        engineSocket(host, "linux");
      } catch (error) {
        expect((error as CliError).code).toBe("engine_unsupported");
      }
    }
  });

  it("says what to do when the engine can't be reached", () => {
    expect(engineProblem("permission denied while trying to connect to the docker API").code).toBe("permission_denied");
    const missing = engineProblem("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?");
    expect(missing.code).toBe("engine_missing");
    expect(missing.message).toMatch(/OrbStack, Colima or Docker Desktop/);
    expect(missing.status).toBe(2);
  });
});


describe("the desktop engine preflight", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("inspects an explicit context before any engine contact, even with a local DOCKER_HOST", async () => {
    vi.stubEnv("DOCKER_CONTEXT", "configured");
    vi.stubEnv("DOCKER_HOST", "unix:///var/run/docker.sock");
    const run = vi.spyOn(processRunner, "run")
      .mockResolvedValueOnce({ code: 0, stdout: "ssh://other.example", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "context is unavailable" });
    await expect(checkEngine()).rejects.toMatchObject({ code: "engine_unsupported" });
    await expect(checkEngine()).rejects.toMatchObject({ code: "engine_unsupported" });
    expect(run.mock.calls.map(call => call[1][0])).toEqual(["context", "context"]);
  });

  it("makes the listing optional for ordinary commands and mandatory for desktop setup", async () => {
    const run = vi.spyOn(processRunner, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "unavailable" });
    await expect(otherInstallation("your-space", process.cwd())).resolves.toBeNull();
    for (const policy of ["require-list", "require-match"] as const) {
      await expect(otherInstallation("your-space", process.cwd(), policy)).rejects.toMatchObject({ code: "engine_missing" });
    }
    run.mockResolvedValue({ code: 0, stdout: "[]", stderr: "" });
    await expect(otherInstallation("your-space", process.cwd(), "require-list")).resolves.toBeNull();
    await expect(otherInstallation("your-space", process.cwd(), "require-match")).rejects.toMatchObject({ code: "not_running" });
    run.mockResolvedValue({ code: 0, stdout: JSON.stringify([{ Name: "your-space", ConfigFiles: "/other/compose.yaml" }]), stderr: "" });
    await expect(otherInstallation("your-space", process.cwd(), "require-list")).resolves.toBe("/other");
  });
});
