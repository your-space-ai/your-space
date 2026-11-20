// A one-time service, such as Plane's migration, runs again only when it should (2026-11-20): not on
// every apply, such as a change to the app's Caddy, while the app runs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apply, finishedOnce, INSTALLATION, type ServiceRun } from "../src/apps.ts";
import * as engineModule from "../src/engine.ts";
import type { CliResult, ContainerSummary } from "../src/engine.ts";

vi.mock("../src/engine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine.ts")>()),
  engine: vi.fn(),
  engineJson: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
  docker: vi.fn(),
  listContainers: vi.fn(),
  connectNetwork: vi.fn(),
}));

describe("the one-time services an apply leaves as they are", () => {
  const restarts = { migrator: "on-failure", seed: "no", api: "unless-stopped", "ys-egress": "unless-stopped" };
  const hashes = { migrator: "h1", seed: "h2" };
  const api: ServiceRun = { service: "api", state: "running", hash: "h3" };
  const migrator: ServiceRun = { service: "migrator", state: "exited", exitCode: 0, hash: "h1" };

  it("are those that finished with exit code 0 and are unchanged, while the app runs", () => {
    expect(finishedOnce(restarts, [api, migrator, { service: "seed", state: "exited", exitCode: 0, hash: "h2" }], hashes)).toEqual(["migrator", "seed"]);
    expect(finishedOnce(restarts, [{ ...api, state: "restarting" }, migrator], hashes)).toEqual(["migrator"]);
  });

  it("leave out one whose image, command or settings changed, so Compose recreates and runs it", () => {
    expect(finishedOnce(restarts, [api, migrator], { migrator: "h9" })).toEqual([]);
    expect(finishedOnce(restarts, [api, { ...migrator, hash: undefined }], hashes)).toEqual([]);
  });

  it("leave out one that failed, is still running, or never ran", () => {
    expect(finishedOnce(restarts, [api, { ...migrator, exitCode: 1 }], hashes)).toEqual([]);
    expect(finishedOnce(restarts, [api, { ...migrator, exitCode: undefined }], hashes)).toEqual([]);
    expect(finishedOnce(restarts, [api, { ...migrator, state: "running", exitCode: undefined }], hashes)).toEqual([]);
    expect(finishedOnce(restarts, [api, { ...migrator, state: "created", exitCode: undefined }], hashes)).toEqual([]);
    expect(finishedOnce(restarts, [api], hashes)).toEqual([]);
  });

  it("are none when the app is stopped, since a service stopped with it looks finished too", () => {
    // A long-running service the file restarts only on failure exits 0 when it is stopped.
    expect(finishedOnce(restarts, [{ ...api, state: "exited", exitCode: 0 }, migrator], hashes)).toEqual([]);
    expect(finishedOnce(restarts, [migrator, { service: "seed", state: "exited", exitCode: 0, hash: "h2" }], hashes)).toEqual([]);
    // Only the file's own services count: a container of a service it no longer has doesn't.
    expect(finishedOnce(restarts, [{ service: "old", state: "running" }, migrator], hashes)).toEqual([]);
  });
});

describe("applying an app with a one-time service", () => {
  const spec = { project: "ys-tasks", app: "tasks", installation: INSTALLATION, compose: "services: {}", env: {}, interface: null };
  const resolved = {
    name: "ys-tasks",
    services: {
      migrator: { image: "busybox:1.37", deploy: { restart_policy: { condition: "on-failure" } } },
      api: { image: "busybox:1.37" },
    },
  };
  let containers: ContainerSummary[];
  let up: string[] | undefined;
  let hashed: number;

  function container(service: string, state: string, hash: string, exitCode = 0): ContainerSummary {
    return {
      Id: `${service}-id`,
      Names: [`/ys-tasks-${service}-1`],
      State: state,
      Status: state,
      Labels: { "com.docker.compose.project": "ys-tasks", "com.docker.compose.service": service, "com.docker.compose.config-hash": hash, exit: String(exitCode) },
    };
  }

  beforeEach(() => {
    up = undefined;
    hashed = 0;
    vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "arm64", connection: "unix:///var/run/docker.sock" });
    vi.mocked(engineModule.inspectImage).mockImplementation(async (ref) => ({ ref, digest: "sha256:abc", platforms: [], runsHere: true }));
    vi.mocked(engineModule.engine).mockResolvedValue({ status: 200, body: "{}" });
    vi.mocked(engineModule.listContainers).mockImplementation(async (labels) => (labels.includes("com.docker.compose.project=ys-tasks") ? containers : []));
    vi.mocked(engineModule.engineJson).mockImplementation(async (_method, path) => {
      const found = containers.find((c) => path === `/containers/${c.Id}/json`);
      if (!found) throw new Error(`unexpected ${path}`);
      return { State: { ExitCode: Number(found.Labels.exit) } } as never;
    });
    vi.mocked(engineModule.docker).mockImplementation(async (args): Promise<CliResult> => {
      const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
      if (args.includes("--variables")) return ok("{}");
      if (args.includes("--format")) return ok(JSON.stringify(resolved));
      if (args.includes("--hash")) {
        hashed += 1;
        expect(args.at(-1)).toBe("migrator");
        return ok("migrator h1\n");
      }
      if (args.includes("up")) {
        up = args.slice(args.indexOf("up"));
        return ok("");
      }
      throw new Error(`unexpected docker ${args.join(" ")}`);
    });
  });

  it("starts every other service, without the migration, when it finished and is unchanged", async () => {
    containers = [container("api", "running", "h3"), container("ys-egress", "running", "h4"), container("migrator", "exited", "h1")];
    await apply(spec, () => {});
    expect(up).toEqual(["up", "-d", "--remove-orphans", "--pull", "never", "--no-deps", "api", "ys-egress"]);
  });

  it("runs it again when it changed or failed", async () => {
    containers = [container("api", "running", "h3"), container("migrator", "exited", "h0")];
    await apply(spec, () => {});
    expect(up).toEqual(["up", "-d", "--remove-orphans", "--pull", "never"]);
    containers = [container("api", "running", "h3"), container("migrator", "exited", "h1", 1)];
    await apply(spec, () => {});
    expect(up).toEqual(["up", "-d", "--remove-orphans", "--pull", "never"]);
  });

  it("runs it when the app is installed or started again", async () => {
    containers = [];
    await apply(spec, () => {});
    expect(up).toEqual(["up", "-d", "--remove-orphans", "--pull", "never"]);
    containers = [container("api", "exited", "h3"), container("ys-egress", "exited", "h4"), container("migrator", "exited", "h1")];
    await apply(spec, () => {});
    expect(up).toEqual(["up", "-d", "--remove-orphans", "--pull", "never"]);
  });

  it("asks Compose for no hashes when the app has no finished one-time service", async () => {
    containers = [container("api", "running", "h3"), container("migrator", "running", "h1")];
    await apply(spec, () => {});
    expect(hashed).toBe(0);
    expect(up).toEqual(["up", "-d", "--remove-orphans", "--pull", "never"]);
  });
});
