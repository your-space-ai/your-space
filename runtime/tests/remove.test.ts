// Removing an app (FR-023) against a fake engine: the proxy's reconnection never keeps the app's network
// alive, and the app's anonymous volumes go with it while its named volumes stay.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anonymousVolumes, connectProxyToAll, down } from "../src/apps.ts";
import * as engineModule from "../src/engine.ts";
import type { CliResult, ContainerSummary } from "../src/engine.ts";

vi.mock("../src/engine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine.ts")>()),
  engine: vi.fn(),
  engineJson: vi.fn(),
  docker: vi.fn(),
  listContainers: vi.fn(),
  connectNetwork: vi.fn(),
  disconnectNetwork: vi.fn(),
}));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ANON = "a".repeat(64);
const OTHER_ANON = "b".repeat(64);
const NETWORK = "ys-tasks_app";

/** The fake engine: Your Space's Caddy, the networks it joined, and an app's containers and volumes. */
let joined: Set<string>;
let networks: Set<string>;
let containers: ContainerSummary[];
let volumes: Set<string>;
let events: string[];
/** Runs while `docker compose down` stops the containers, before Compose removes the network. */
let duringDown: () => Promise<void>;
let downCode: number;
/** Holds a connection to a network until the test lets it through. */
let connectGate: Promise<void>;

beforeEach(() => {
  joined = new Set([NETWORK]);
  networks = new Set([NETWORK]);
  containers = [
    {
      Id: "db-id",
      Names: ["/ys-tasks-db-1"],
      State: "running",
      Status: "Up",
      Labels: { "com.docker.compose.project": "ys-tasks", "com.docker.compose.service": "db" },
      Mounts: [{ Type: "volume", Name: "ys-tasks_pgdata" }, { Type: "tmpfs" }],
    },
    {
      Id: "egress-id",
      Names: ["/ys-tasks-ys-egress-1"],
      State: "running",
      Status: "Up",
      Labels: { "com.docker.compose.project": "ys-tasks", "com.docker.compose.service": "ys-egress" },
      Mounts: [{ Type: "volume", Name: ANON }],
    },
  ];
  // Another anonymous volume on the engine, such as another app's or Your Space's own.
  volumes = new Set(["ys-tasks_pgdata", ANON, OTHER_ANON]);
  events = [];
  duringDown = async () => {};
  downCode = 0;
  connectGate = Promise.resolve();

  vi.mocked(engineModule.listContainers).mockImplementation(async (labels) => {
    if (labels.includes("com.docker.compose.service=caddy")) {
      return [{ Id: "caddy-id", Names: ["/your-space-caddy-1"], State: "running", Status: "Up", Labels: {} }];
    }
    return labels.includes("com.docker.compose.project=ys-tasks") ? containers : [];
  });
  vi.mocked(engineModule.engineJson).mockImplementation(async (_method, path) => {
    if (path === "/containers/caddy-id/json") return { NetworkSettings: { Networks: Object.fromEntries([...joined].map((n) => [n, {}])) } } as never;
    if (path.startsWith("/networks?")) return [...networks].map((Name) => ({ Name })) as never;
    if (path.startsWith("/volumes?")) {
      expect(decodeURIComponent(path)).toContain('"label":["com.docker.volume.anonymous"]');
      return { Volumes: [ANON, OTHER_ANON].filter((v) => volumes.has(v)).map((Name) => ({ Name, Labels: { "com.docker.volume.anonymous": "" } })) } as never;
    }
    throw new Error(`unexpected ${path}`);
  });
  vi.mocked(engineModule.engine).mockImplementation(async (method, path) => {
    const name = decodeURIComponent(path.replace("/volumes/", ""));
    events.push(`${method} ${name}`);
    volumes.delete(name);
    return { status: 204, body: "" };
  });
  vi.mocked(engineModule.connectNetwork).mockImplementation(async (network) => {
    events.push(`connect ${network}`);
    await connectGate;
    if (networks.has(network)) joined.add(network);
    events.push(`connected ${network}`);
  });
  vi.mocked(engineModule.disconnectNetwork).mockImplementation(async (network) => {
    events.push(`disconnect ${network}`);
    joined.delete(network);
  });
  vi.mocked(engineModule.docker).mockImplementation(async (args): Promise<CliResult> => {
    expect(args).toEqual(["compose", "-p", "ys-tasks", "down", "--remove-orphans"]);
    events.push("compose down");
    await duringDown();
    if (downCode !== 0) return { code: downCode, stdout: "", stderr: "failed" };
    containers = [];
    // Docker refuses to remove a network a container is still connected to.
    if (!joined.has(NETWORK)) networks.delete(NETWORK);
    events.push("compose down done");
    return { code: 0, stdout: "", stderr: "" };
  });
});

describe("removing an app's network", () => {
  it("isn't undone by the proxy's reconnection while Compose stops the app", async () => {
    duringDown = async () => {
      // The runtime manager's ten-second timer fires while the containers stop.
      await connectProxyToAll();
    };
    await down("ys-tasks");
    expect(events).not.toContain(`connect ${NETWORK}`);
    expect(networks.has(NETWORK)).toBe(false);
  });

  it("waits for a reconnection already under way before the proxy leaves the network", async () => {
    joined.clear();
    let release!: () => void;
    connectGate = new Promise((resolve) => (release = resolve));
    // The engine takes a moment to stop the containers, and the reconnection lands meanwhile.
    duringDown = () => sleep(50);
    const reconnecting = connectProxyToAll();
    await vi.waitFor(() => expect(events).toContain(`connect ${NETWORK}`));
    const removal = down("ys-tasks");
    setTimeout(release, 20);
    await Promise.all([reconnecting, removal]);
    expect(events.indexOf(`connected ${NETWORK}`)).toBeLessThan(events.indexOf(`disconnect ${NETWORK}`));
    expect(networks.has(NETWORK)).toBe(false);
  });

  it("is joined again once a removal fails, so the app keeps working", async () => {
    downCode = 1;
    await expect(down("ys-tasks")).rejects.toThrow("Removing the app failed");
    expect(joined.has(NETWORK)).toBe(false);
    await connectProxyToAll();
    expect(joined.has(NETWORK)).toBe(true);
  });
});

describe("removing an app's volumes", () => {
  it("deletes the anonymous volumes its containers mounted after they are gone, and keeps its named ones", async () => {
    await down("ys-tasks");
    expect(events.filter((e) => e.startsWith("DELETE"))).toEqual([`DELETE ${ANON}`]);
    expect(events.indexOf(`DELETE ${ANON}`)).toBeGreaterThan(events.indexOf("compose down done"));
    expect([...volumes].sort()).toEqual([OTHER_ANON, "ys-tasks_pgdata"].sort());
  });

  it("deletes nothing when Compose can't remove the containers", async () => {
    downCode = 1;
    await expect(down("ys-tasks")).rejects.toThrow();
    expect(events.some((e) => e.startsWith("DELETE"))).toBe(false);
    expect(volumes.size).toBe(3);
  });

  it("are only volumes the engine made anonymous and the containers mount", () => {
    const mounts = (...m: NonNullable<ContainerSummary["Mounts"]>): ContainerSummary => ({ Id: "x", Names: [], State: "exited", Status: "", Labels: {}, Mounts: m });
    const anonymous = new Set([ANON, OTHER_ANON]);
    expect(anonymousVolumes([mounts({ Type: "volume", Name: ANON }, { Type: "volume", Name: "ys-tasks_pgdata" }), mounts({ Type: "volume", Name: ANON })], anonymous)).toEqual([ANON]);
    expect(anonymousVolumes([mounts({ Type: "bind", Name: OTHER_ANON }, { Type: "tmpfs" }), { ...mounts(), Mounts: undefined }], anonymous)).toEqual([]);
  });
});
