// Stopping Your Space's apps (/stop-all) stops the syncs too: no run, step or proxy starts once the
// stop begins, a step under way is stopped as Ctrl+C stops bisync, and the stop waits for every run.
// Each test loads the runtime manager afresh, since a stop lasts until it restarts. The engine is a fake.
import { describe, expect, it, vi } from "vitest";
import type { DriveRemote } from "../src/sync.ts";

vi.mock("../src/engine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine.ts")>()),
  engine: vi.fn(),
  engineJson: vi.fn(),
  listContainers: vi.fn(),
  docker: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
  pullImage: vi.fn(),
}));

const TOKEN = JSON.stringify({ access_token: "ya29.access", token_type: "Bearer", refresh_token: "1//refresh", expiry: "2026-11-25T18:00:00Z" });
const remote: DriveRemote = { type: "drive", clientId: "1234-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret", token: TOKEN, folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz" };

/** A fresh runtime manager on a fake engine, with what each test can hold and what it saw. */
async function load(options: { holdAt?: (method: string, path: string) => boolean; holdStepUntilStopped?: boolean } = {}) {
  // Reached at the first request holdAt matches, to the engine's API or its JSON, or else once a
  // step's container waits.
  vi.resetModules();
  const engineModule = await import("../src/engine.ts");
  const apps = await import("../src/apps.ts");
  const sync = await import("../src/sync.ts");
  const { knowledgeStateVolume, knowledgeVolume } = await import("../src/adapter.ts");
  const labels = (role: string) => ({ "ai.your-space.installation": apps.INSTALLATION, "ai.your-space.role": role, "ai.your-space.knowledge": "notes" });
  const volumes = new Map([
    [knowledgeVolume(apps.INSTALLATION, "notes"), labels("knowledge")],
    [knowledgeStateVolume(apps.INSTALLATION, "notes"), labels("knowledge-sync")],
  ]);
  const seen = { created: [] as string[][], composed: [] as string[][], stopped: [] as string[], started: [] as string[], removed: [] as string[] };
  const running = new Set<string>();
  let reach: () => void = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let ended: (code: number) => void = () => {};
  const stepEnds = new Promise<number>((resolve) => (ended = resolve));
  let next = 0;

  vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "amd64", connection: "unix:///var/run/docker.sock" });
  vi.mocked(engineModule.inspectImage).mockResolvedValue({ ref: "ubuntu/squid:latest", digest: "sha256:squid", platforms: [], runsHere: true });
  vi.mocked(engineModule.listContainers).mockImplementation(async (filter) =>
    filter.includes("ai.your-space.role=knowledge-sync") ? [...running].map((Id) => ({ Id, Names: [], State: "running", Status: "", Labels: labels("knowledge-sync") })) : [],
  );
  vi.mocked(engineModule.engine).mockImplementation(async (method, path, body) => {
    if (options.holdAt?.(method, path)) {
      options.holdAt = undefined;
      reach();
      await held;
    }
    if (path.startsWith("/volumes/")) {
      const name = decodeURIComponent(path.slice("/volumes/".length));
      return volumes.has(name) ? { status: 200, body: JSON.stringify({ Name: name, Labels: volumes.get(name) }) } : { status: 404, body: "" };
    }
    if (method === "GET" && path.startsWith("/images/")) return { status: 200, body: "{}" };
    if (method === "POST" && path.startsWith("/containers/create?name=")) {
      const id = `step-${next++}`;
      seen.created.push((body as { Cmd: string[] }).Cmd);
      return { status: 201, body: JSON.stringify({ Id: id }) };
    }
    if (method === "POST" && /^\/containers\/[^/]+\/stop\?signal=SIGINT&t=\d+$/.test(path)) {
      const id = path.split("/")[2]!;
      seen.stopped.push(id);
      running.delete(id);
      // rclone stops, as bisync does once it has saved its state.
      ended(1);
      return { status: 204, body: "" };
    }
    if (method === "DELETE" && path.startsWith("/containers/")) {
      const id = path.split("/")[2]!.split("?")[0]!;
      seen.removed.push(id);
      running.delete(id);
      return { status: 204, body: "" };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  vi.mocked(engineModule.engineJson).mockImplementation(async (method, path) => {
    if (options.holdAt?.(method, path)) {
      options.holdAt = undefined;
      reach();
      await held;
    }
    if (method === "POST" && path.endsWith("/start")) {
      running.add(path.split("/")[2]!);
      seen.started.push(path.split("/")[2]!);
      return {} as never;
    }
    if (method === "POST" && path.endsWith("/wait")) {
      reach();
      return { StatusCode: options.holdStepUntilStopped ? await stepEnds : 0 } as never;
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  vi.mocked(engineModule.docker).mockImplementation(async (args) => {
    if (args[0] === "logs") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "compose") {
      seen.composed.push(args);
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected docker ${args.join(" ")}`);
  });
  return { apps, sync, seen, reached, release };
}

/** Whether a promise has settled, without waiting for it. */
async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((r) => setTimeout(r, 20));
  return done;
}

describe("stopping Your Space's apps", () => {
  it("starts no proxy or step for a run that passed its first check, and answers once the run has ended", async () => {
    // The run waits for the engine while rclone's image is checked, before its proxy and steps.
    const { apps, sync, seen, reached, release } = await load({ holdAt: (method, path) => method === "GET" && path.startsWith("/images/") });
    const run = sync.syncKnowledge("notes", { remote, mode: "sync" });
    void run.catch(() => {});
    await reached;
    await apps.stopAll();
    const stopping = sync.stopSyncs();
    expect(await settledYet(stopping)).toBe(false);
    release();
    await expect(run).rejects.toMatchObject({ status: 409, message: expect.stringContaining("stopping") });
    await stopping;
    expect(seen.composed.some((args) => args.includes("up"))).toBe(false);
    expect(seen.created).toEqual([]);
    // The proxy is stopped last, once nothing can start it again.
    expect(seen.composed.at(-1)).toEqual(expect.arrayContaining(["compose", "-p", `${apps.INSTALLATION}_knowledge-sync`, "stop"]));
    expect(() => sync.syncKnowledge("notes", { remote, mode: "sync" })).toThrow(expect.objectContaining({ status: 409 }));
  });

  it("starts no proxy whose image was still being readied when the stop began", async () => {
    const { apps, sync, seen, reached, release } = await load({ holdAt: (method, path) => method === "GET" && path.startsWith("/images/") && path.includes("squid") });
    const run = sync.syncKnowledge("notes", { remote, mode: "sync" });
    void run.catch(() => {});
    await reached;
    await apps.stopAll();
    const stopping = sync.stopSyncs();
    release();
    await expect(run).rejects.toMatchObject({ status: 409 });
    await stopping;
    expect(seen.composed.some((args) => args.includes("up"))).toBe(false);
    expect(seen.created).toEqual([]);
  });

  it("doesn't start a step whose container the stop began while it was made, and removes it", async () => {
    const { apps, sync, seen, reached, release } = await load({ holdAt: (method, path) => method === "POST" && path.startsWith("/containers/create?name="), holdStepUntilStopped: true });
    const run = sync.syncKnowledge("notes", { remote, mode: "sync" });
    await reached;
    await apps.stopAll();
    const stopping = sync.stopSyncs();
    release();
    expect(await run).toMatchObject({ result: "failed", message: expect.stringContaining("stopping") });
    await stopping;
    expect(seen.started).toEqual([]);
    expect(seen.removed).toEqual(["step-0"]);
    expect(seen.created.map((cmd) => cmd[0])).toEqual(["bisync"]);
  });

  it("stops a step whose container the stop began while it was started, as Ctrl+C stops it", async () => {
    // Started after the stop's own pass found nothing running.
    const { apps, sync, seen, reached, release } = await load({ holdAt: (method, path) => method === "POST" && path.endsWith("/start"), holdStepUntilStopped: true });
    const run = sync.syncKnowledge("notes", { remote, mode: "sync" });
    await reached;
    await apps.stopAll();
    const stopping = sync.stopSyncs();
    release();
    expect(await run).toMatchObject({ result: "failed" });
    await stopping;
    expect(seen.stopped).toEqual(["step-0"]);
    expect(seen.created.map((cmd) => cmd[0])).toEqual(["bisync"]);
  });

  it("stops a step under way as Ctrl+C stops it, starts no other, and answers once the run has ended", async () => {
    const { apps, sync, seen, reached } = await load({ holdStepUntilStopped: true });
    const run = sync.syncKnowledge("notes", { remote, mode: "sync" });
    await reached;
    expect(seen.created.map((cmd) => cmd[0])).toEqual(["bisync"]);
    await apps.stopAll();
    const stopped = await Promise.all([sync.stopSyncs().then(() => "stopped"), run]);
    expect(seen.stopped).toEqual(["step-0"]);
    expect(stopped[1]).toMatchObject({ result: "failed" });
    // Not the listing either: nothing starts once the stop begins.
    expect(seen.created.map((cmd) => cmd[0])).toEqual(["bisync"]);
    expect(stopped[1].listed).toBeUndefined();
  });
});
