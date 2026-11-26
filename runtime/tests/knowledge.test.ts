// Knowledge bases (journey 014): the volumes Your Space owns and mounts in the apps the owner gives
// them to. The adapter adds the mounts itself and refuses an app's file that names one; removing an
// app, or deleting its data, never deletes one. The engine is a fake that applies the label filters
// it is sent, as Docker does.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adapt, KNOWLEDGE_PREFIX, knowledgeLabels, knowledgeVolume, type AppSpec } from "../src/adapter.ts";
import {
  anonymousVolumes,
  apply,
  createKnowledge,
  deleteKnowledge,
  deleteVolumes,
  INSTALLATION,
  isKnowledge,
  knowledgeInit,
  knowledgeUsers,
  SpecError,
  validateSpec,
} from "../src/apps.ts";
import * as engineModule from "../src/engine.ts";
import type { CliResult, ContainerSummary } from "../src/engine.ts";

vi.mock("../src/engine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine.ts")>()),
  engine: vi.fn(),
  engineJson: vi.fn(),
  listContainers: vi.fn(),
  docker: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
  connectNetwork: vi.fn(),
}));

const sure = JSON.parse(readFileSync(new URL("./sure-resolved.json", import.meta.url), "utf8")) as Record<string, unknown>;

const spec: AppSpec = {
  project: "ys-sure",
  app: "sure",
  installation: "your-space",
  compose: "",
  env: {},
  pins: { "ubuntu/squid:latest": "sha256:ddd" },
  interface: { service: "web", port: 3000 },
};

type Json = Record<string, unknown>;
const services = (adapted: Json | null) => adapted!.services as Record<string, Json>;

describe("mounting knowledge bases", () => {
  it("leaves the file as it was for an app given none", () => {
    const plain = adapt(spec, sure, ["backup", "backup-offsite"]);
    expect(adapt({ ...spec, knowledge: null }, sure, ["backup", "backup-offsite"])).toEqual(plain);
    // An app whose kit asks for knowledge, given none yet, as its review checks it.
    expect(adapt({ ...spec, knowledge: { path: "/knowledge", bases: [] } }, sure, ["backup", "backup-offsite"])).toEqual(plain);
  });

  it("mounts each one in the interface service at <path>/<name>, from Your Space's own volume", () => {
    const plain = adapt(spec, sure, ["backup", "backup-offsite"]).adapted!;
    const result = adapt({ ...spec, knowledge: { path: "/knowledge", bases: ["course-notes", "recipes"] } }, sure, ["backup", "backup-offsite"]);
    expect(result.refusals).toEqual([]);
    const web = services(result.adapted).web!;
    const own = (services(plain).web!.volumes as unknown[]) ?? [];
    expect(web.volumes).toEqual([
      ...own,
      { type: "volume", source: "ys-knowledge.your-space.course-notes", target: "/knowledge/course-notes", volume: { nocopy: true } },
      { type: "volume", source: "ys-knowledge.your-space.recipes", target: "/knowledge/recipes", volume: { nocopy: true } },
    ]);
    // Only the interface service gets them.
    for (const name of Object.keys(services(plain)).filter((n) => n !== "web")) expect(services(result.adapted)[name]).toEqual(services(plain)[name]);
    // Compose uses each as it is, by its name, and never makes, labels or removes it.
    const volumes = result.adapted!.volumes as Json;
    expect(volumes["ys-knowledge.your-space.course-notes"]).toEqual({ external: true, name: "ys-knowledge.your-space.course-notes" });
    expect(volumes["ys-knowledge.your-space.recipes"]).toEqual({ external: true, name: "ys-knowledge.your-space.recipes" });
    expect(result.adaptations).toContainEqual({ service: "web", kind: "added", detail: expect.stringContaining("/knowledge/course-notes, /knowledge/recipes") });
  });

  it("uses the kit's knowledge path, and names each volume after this installation", () => {
    const result = adapt({ ...spec, installation: "ys-e2e", knowledge: { path: "/vault", bases: ["notes"] } }, { services: { web: { image: "busybox" } } });
    expect(services(result.adapted).web!.volumes).toEqual([{ type: "volume", source: "ys-knowledge.ys-e2e.notes", target: "/vault/notes", volume: { nocopy: true } }]);
  });

  it("refuses knowledge bases for an app without an interface", () => {
    const result = adapt({ ...spec, interface: null, knowledge: { path: "/knowledge", bases: ["notes"] } }, { services: { web: { image: "busybox" } } });
    expect(result.adapted).toBeNull();
    expect(result.refusals.map((r) => r.setting)).toContain("knowledge");
  });

  it("refuses a file that mounts anything of its own in the interface's knowledge path", () => {
    for (const service of [
      { volumes: [{ type: "volume", source: "data", target: "/knowledge" }] },
      { volumes: [{ type: "volume", source: "data", target: "/knowledge/notes/" }] },
      { tmpfs: ["/knowledge/cache:size=1m"] },
      // Compose leaves a short-form tmpfs as written, and the engine cleans it.
      { tmpfs: ["//knowledge"] },
      { tmpfs: ["/./knowledge/notes"] },
      { tmpfs: "/x/../knowledge" },
      { volumes: [{ type: "volume", source: "data", target: "/./knowledge//notes" }] },
    ]) {
      const result = adapt({ ...spec, knowledge: { path: "/knowledge", bases: [] } }, { services: { web: { image: "busybox", ...service } }, volumes: { data: {} } });
      expect(result.adapted, JSON.stringify(service)).toBeNull();
      expect(result.refusals[0]).toMatchObject({ service: "web", setting: "volumes", reason: expect.stringContaining("knowledge path, /knowledge") });
    }
    // A folder beside it, or another service's folder, is the app's own.
    const beside = adapt(
      { ...spec, knowledge: { path: "/knowledge", bases: [] } },
      {
        services: { web: { image: "busybox", volumes: [{ type: "volume", source: "data", target: "/knowledge-cache" }] }, db: { image: "busybox", volumes: [{ type: "volume", source: "data", target: "/knowledge" }] } },
        volumes: { data: {} },
      },
    );
    expect(beside.refusals).toEqual([]);
  });

  it("refuses a file that names a knowledge base's volume itself, or a host folder or another volume", () => {
    const volume = knowledgeVolume("your-space", "notes");
    const cases: Json[] = [
      // As a volume's name, so Compose would use the existing one.
      { services: { web: { image: "busybox", volumes: [{ type: "volume", source: "data", target: "/data" }] } }, volumes: { data: { name: volume } } },
      // As a volume's key in the file Your Space runs.
      { services: { web: { image: "busybox", volumes: [{ type: "volume", source: volume, target: "/data" }] } }, volumes: { [volume]: {} } },
      // As an external volume.
      { services: { web: { image: "busybox", volumes: [{ type: "volume", source: "data", target: "/data" }] } }, volumes: { data: { external: true, name: volume } } },
      // As the host folder the engine keeps it in.
      { services: { web: { image: "busybox", volumes: [{ type: "bind", source: `/var/lib/docker/volumes/${volume}/_data`, target: "/knowledge/notes" }] } } },
    ];
    for (const file of cases) {
      const result = adapt({ ...spec, knowledge: { path: "/knowledge", bases: ["notes"] } }, file);
      expect(result.adapted, JSON.stringify(file)).toBeNull();
      expect(result.refusals.length, JSON.stringify(file)).toBeGreaterThan(0);
    }
    // Even without knowledge, an app's file can't name one.
    expect(adapt({ ...spec, interface: null }, cases[0]!).adapted).toBeNull();
  });
});

describe("the app spec's knowledge", () => {
  const base = { project: "ys-notes", app: "notes", compose: "services: {}", env: {} };
  it("takes an absolute, normalised path and distinct names", () => {
    expect(validateSpec({ ...base, knowledge: { path: "/knowledge", bases: ["course-notes", "a1"] } }).knowledge).toEqual({ path: "/knowledge", bases: ["course-notes", "a1"] });
    expect(validateSpec({ ...base, knowledge: { path: "/data/vault", bases: [] } }).knowledge).toEqual({ path: "/data/vault", bases: [] });
  });

  it("refuses any other path or name", () => {
    const paths = ["knowledge", "/", "", "/knowledge/", "/a/../etc", "/a/./b", "/a//b", "/.hidden", "/proc", "/sys/fs", "/dev/shm", "/a b"];
    for (const path of paths) expect(() => validateSpec({ ...base, knowledge: { path, bases: [] } }), path).toThrow(SpecError);
    const names = [["Notes"], ["-notes"], ["notes-"], ["a/b"], [".."], ["a".repeat(41)], ["notes", "notes"], [1]];
    for (const bases of names) expect(() => validateSpec({ ...base, knowledge: { path: "/knowledge", bases } }), JSON.stringify(bases)).toThrow(SpecError);
  });
});

/** The fake engine's volumes and containers, and what was asked of it. */
let volumes: Map<string, Record<string, string>>;
let containers: (ContainerSummary & { volumes?: string[] })[];
let created: Json[];
let calls: string[];
let initExit: number;
/** Exit codes for the next setups, in order, before initExit. */
let initExits: number[];
/** Whether the engine fails to delete a volume, as when it stopped answering. */
let volumeDeleteFails: boolean;

function matches(labels: Record<string, string>, filters: string[]): boolean {
  return filters.every((filter) => {
    const [key, value] = filter.split("=");
    return value === undefined ? key! in labels : labels[key!] === value;
  });
}

beforeEach(() => {
  volumes = new Map();
  containers = [{ Id: "runtime-id", Names: ["/your-space-runtime-1"], State: "running", Status: "Up", Labels: {} }];
  created = [];
  calls = [];
  initExit = 0;
  initExits = [];
  volumeDeleteFails = false;
  vi.mocked(engineModule.engineJson).mockImplementation(async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (path === "/containers/runtime-id/json") return { Image: "sha256:runtime" } as never;
    if (method === "POST" && path === "/volumes/create") {
      const { Name, Labels } = body as { Name: string; Labels: Record<string, string> };
      volumes.set(Name, Labels);
      return {} as never;
    }
    if (method === "POST" && path === "/containers/create") {
      created.push(body as Json);
      return { Id: "init-id" } as never;
    }
    if (method === "POST" && path === "/containers/init-id/start") return {} as never;
    if (method === "POST" && path === "/containers/init-id/wait") return { StatusCode: initExits.shift() ?? initExit } as never;
    if (method === "GET" && path.startsWith("/volumes?")) {
      const filters = JSON.parse(decodeURIComponent(path.split("filters=")[1]!)) as { label: string[] };
      return { Volumes: [...volumes].filter(([, labels]) => matches(labels, filters.label)).map(([Name, Labels]) => ({ Name, Labels })) } as never;
    }
    if (method === "GET" && path.startsWith("/containers/json?")) {
      const filters = JSON.parse(decodeURIComponent(path.split("filters=")[1]!)) as { volume?: string[]; label?: string[] };
      expect(path).toContain("all=1");
      return containers.filter((c) => (filters.volume ?? []).every((v) => c.volumes?.includes(v)) && matches(c.Labels, filters.label ?? [])) as never;
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  vi.mocked(engineModule.listContainers).mockImplementation(async (labels) => {
    if (labels.includes("com.docker.compose.service=runtime")) return containers.filter((c) => c.Id === "runtime-id");
    return containers.filter((c) => matches(c.Labels, labels));
  });
  vi.mocked(engineModule.engine).mockImplementation(async (method, path) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (path.startsWith("/volumes/")) {
      const name = decodeURIComponent(path.slice("/volumes/".length));
      if (method === "GET") return volumes.has(name) ? { status: 200, body: JSON.stringify({ Name: name, Labels: volumes.get(name) }) } : { status: 404, body: "" };
      if (method === "DELETE") {
        if (volumeDeleteFails) return { status: 500, body: "the engine failed" };
        if (containers.some((c) => c.volumes?.includes(name))) return { status: 409, body: "volume is in use" };
        return volumes.delete(name) ? { status: 204, body: "" } : { status: 404, body: "" };
      }
    }
    if (method === "DELETE" && path.startsWith("/containers/init-id")) return { status: 204, body: "" };
    // Every image is on the engine already, so an apply pulls nothing.
    if (method === "GET" && path.startsWith("/images/")) return { status: 200, body: "{}" };
    throw new Error(`unexpected ${method} ${path}`);
  });
});

const NOTES = knowledgeVolume(INSTALLATION, "notes");

describe("a knowledge base's volume", () => {
  it("is Your Space's and knowledge, never an app's or a Compose project's", async () => {
    expect(await createKnowledge("notes")).toEqual({ created: true });
    expect(NOTES.startsWith(KNOWLEDGE_PREFIX)).toBe(true);
    const labels = volumes.get(NOTES)!;
    expect(labels).toEqual(knowledgeLabels(INSTALLATION, "notes"));
    expect(labels).toEqual({ "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "notes" });
    expect(Object.keys(labels).some((key) => key.startsWith("com.docker.compose."))).toBe(false);
    expect(labels["ai.your-space.app"]).toBeUndefined();
  });

  it("gets its folder set up by a short-lived container of the runtime manager's own image, which is removed", async () => {
    await createKnowledge("notes");
    expect(created).toEqual([knowledgeInit("sha256:runtime", NOTES)]);
    const init = created[0] as { Cmd: string[]; HostConfig: Json; User: string };
    expect(init.Cmd).toEqual(["chown 1000:1000 /knowledge && chmod 2777 /knowledge"]);
    expect(init.HostConfig).toMatchObject({
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "FOWNER", "FSETID"],
      SecurityOpt: ["no-new-privileges:true"],
      Mounts: [{ Type: "volume", Source: NOTES, Target: "/knowledge", VolumeOptions: { NoCopy: true } }],
    });
    expect(calls).toContain("DELETE /containers/init-id");
  });

  it("is kept, with its files, when it is this installation's already, and refused when it isn't", async () => {
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    expect(await createKnowledge("notes")).toEqual({ created: false });
    expect(calls).not.toContain("POST /volumes/create");
    // Its folder is set up again, which only gives it its owner and mode: its files stay as they are.
    expect(created).toEqual([knowledgeInit("sha256:runtime", NOTES)]);
    expect((created[0] as { Cmd: string[] }).Cmd).toEqual(["chown 1000:1000 /knowledge && chmod 2777 /knowledge"]);
    volumes.set(NOTES, { "ai.your-space.installation": "someone-else" });
    await expect(createKnowledge("notes")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Your Space didn't make it") });
  });

  it("isn't kept when its folder can't be set up", async () => {
    initExit = 1;
    await expect(createKnowledge("notes")).rejects.toThrow(/exit code 1/);
    expect(volumes.has(NOTES)).toBe(false);
  });

  it("gets its folder set up on the next try when a failed try's volume couldn't be deleted", async () => {
    initExit = 1;
    volumeDeleteFails = true;
    await expect(createKnowledge("notes")).rejects.toThrow(/exit code 1/);
    // The engine kept the volume, labelled as this installation's, with its folder not set up.
    expect(volumes.get(NOTES)).toEqual(knowledgeLabels(INSTALLATION, "notes"));
    initExit = 0;
    volumeDeleteFails = false;
    expect(await createKnowledge("notes")).toEqual({ created: false });
    expect(created).toEqual([knowledgeInit("sha256:runtime", NOTES), knowledgeInit("sha256:runtime", NOTES)]);
    expect(volumes.has(NOTES)).toBe(true);
  });

  it("is created once at a time per name, so a failed try never deletes the volume another made", async () => {
    // Two creates at once: the first sets up the folder, the second's setup fails.
    initExits = [0, 1];
    const [first, second] = await Promise.allSettled([createKnowledge("notes"), createKnowledge("notes")]);
    expect(first).toEqual({ status: "fulfilled", value: { created: true } });
    expect(second.status).toBe("rejected");
    // The second found the first's volume, so it kept it.
    expect(volumes.get(NOTES)).toEqual(knowledgeLabels(INSTALLATION, "notes"));
    expect(calls.filter((c) => c === "POST /volumes/create")).toHaveLength(1);
  });

  it("keeps a kept one, with its files, when its folder can't be set up again", async () => {
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    initExit = 1;
    await expect(createKnowledge("notes")).rejects.toThrow(/exit code 1/);
    expect(volumes.has(NOTES)).toBe(true);
    expect(calls).not.toContain("DELETE /volumes/" + NOTES);
  });

  it("isn't deleted while a container mounts it, even a stopped one", async () => {
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    containers.push({ Id: "app-id", Names: ["/ys-notes-web-1"], State: "exited", Status: "Exited (0)", Labels: { "ai.your-space.app": "notes" }, volumes: [NOTES] });
    await expect(deleteKnowledge("notes")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("still mounted by notes") });
    expect(volumes.has(NOTES)).toBe(true);
    containers.pop();
    await deleteKnowledge("notes");
    expect(volumes.has(NOTES)).toBe(false);
  });

  it("is deleted only when it is Your Space's own", async () => {
    volumes.set(NOTES, { "ai.your-space.installation": INSTALLATION });
    await expect(deleteKnowledge("notes")).rejects.toMatchObject({ status: 409 });
    expect(volumes.has(NOTES)).toBe(true);
    // One already gone is deleted.
    volumes.clear();
    await expect(deleteKnowledge("notes")).resolves.toBeUndefined();
  });

  it("is never deleted with an app's data", async () => {
    const own = { "ai.your-space.installation": INSTALLATION, "com.docker.compose.project": "ys-notes", "com.docker.compose.volume": "data" };
    volumes.set("ys-notes_data", own);
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    // Even one that somehow had the app's project's labels.
    const spoofed = knowledgeVolume(INSTALLATION, "spoofed");
    volumes.set(spoofed, { ...knowledgeLabels(INSTALLATION, "spoofed"), "com.docker.compose.project": "ys-notes" });
    volumes.set("ys-notes_odd", { ...own, "ai.your-space.role": "knowledge" });
    await deleteVolumes("ys-notes");
    expect([...volumes.keys()].sort()).toEqual([NOTES, spoofed, "ys-notes_odd"].sort());
    expect(isKnowledge({ Name: NOTES, Labels: null })).toBe(true);
  });

  it("names the apps of this installation whose containers mount it, running or stopped", async () => {
    expect(await knowledgeUsers("notes")).toEqual({ apps: [] });
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    const own = (app: string, state: string) => ({ "ai.your-space.installation": INSTALLATION, "ai.your-space.app": app, state });
    containers.push(
      { Id: "v", Names: ["/ys-vault-web-1"], State: "exited", Status: "Exited (0)", Labels: own("vault", "exited"), volumes: [NOTES] },
      { Id: "n", Names: ["/ys-notes-web-1"], State: "running", Status: "Up", Labels: own("notes", "running"), volumes: [NOTES] },
      { Id: "n2", Names: ["/ys-notes-worker-1"], State: "running", Status: "Up", Labels: own("notes", "running"), volumes: [NOTES] },
      // Another installation's app, or a container that isn't an app, is no app of this one.
      { Id: "o", Names: ["/other"], State: "running", Status: "Up", Labels: { "ai.your-space.installation": "someone-else", "ai.your-space.app": "other" }, volumes: [NOTES] },
      { Id: "x", Names: ["/shell"], State: "running", Status: "Up", Labels: {}, volumes: [NOTES] },
      { Id: "p", Names: ["/ys-plain-web-1"], State: "running", Status: "Up", Labels: own("plain", "running") },
    );
    expect(await knowledgeUsers("notes")).toEqual({ apps: ["notes", "vault"] });
    volumes.set(NOTES, { "ai.your-space.installation": "someone-else" });
    await expect(knowledgeUsers("notes")).rejects.toMatchObject({ status: 409 });
  });

  it("is never one of the anonymous volumes an app's removal deletes", () => {
    const app: ContainerSummary = { Id: "a", Names: [], State: "running", Status: "Up", Labels: {}, Mounts: [{ Type: "volume", Name: NOTES }, { Type: "volume", Name: "f".repeat(64) }] };
    expect(anonymousVolumes([app], new Set(["f".repeat(64)]))).toEqual(["f".repeat(64)]);
  });
});

describe("applying an app given knowledge bases", () => {
  const given: AppSpec = {
    project: "ys-notes",
    app: "notes",
    installation: INSTALLATION,
    compose: "services: {}",
    env: {},
    interface: { service: "web", port: 80 },
    knowledge: { path: "/knowledge", bases: ["notes"] },
  };
  /** What `docker compose up` was given, or undefined when the apply never reached it. */
  let up: { args: string[]; file: Json } | undefined;

  beforeEach(() => {
    up = undefined;
    vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "arm64", connection: "unix:///var/run/docker.sock" });
    vi.mocked(engineModule.inspectImage).mockImplementation(async (ref) => ({ ref, registry: "docker.io", digest: "sha256:abc", platforms: [], runsHere: true }));
    vi.mocked(engineModule.docker).mockImplementation(async (args): Promise<CliResult> => {
      const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
      if (args.includes("--variables")) return ok("{}");
      if (args.includes("--format")) return ok(JSON.stringify({ name: "ys-notes", services: { web: { image: "busybox:1.37" } } }));
      if (args.includes("up")) {
        const file = args[args.indexOf("-f") + 1]!;
        up = { args, file: JSON.parse(readFileSync(file, "utf8")) as Json };
        return ok("");
      }
      throw new Error(`unexpected docker ${args.join(" ")}`);
    });
  });

  async function refused(spec: AppSpec, message: RegExp) {
    const steps: unknown[] = [];
    await expect(apply(spec, (event) => steps.push(event)), message.source).rejects.toMatchObject({ status: 409, message: expect.stringMatching(message) });
    // Stopped before anything is pulled or started.
    expect(steps).toEqual([{ step: "check" }]);
    expect(calls.some((c) => c.startsWith("GET /images/"))).toBe(false);
    expect(up).toBeUndefined();
  }

  it("stops before Compose when a knowledge base's volume is missing", async () => {
    await refused(given, /The knowledge base notes isn't on this machine's engine, so notes can't mount it/);
    // Each knowledge base is checked, not only the first.
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    await refused({ ...given, knowledge: { path: "/knowledge", bases: ["notes", "recipes"] } }, /The knowledge base recipes isn't on this machine's engine/);
  });

  it("stops before Compose when a volume has the name but isn't this installation's knowledge base", async () => {
    const foreign: Record<string, string>[] = [
      // No labels, as a volume anything on the machine could make with that name.
      {},
      { ...knowledgeLabels(INSTALLATION, "notes"), "ai.your-space.installation": "someone-else" },
      { ...knowledgeLabels(INSTALLATION, "notes"), "ai.your-space.role": "app" },
      { ...knowledgeLabels(INSTALLATION, "notes"), "ai.your-space.knowledge": "recipes" },
      { "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "knowledge" },
    ];
    for (const labels of foreign) {
      volumes.set(NOTES, labels);
      calls = [];
      await refused(given, /exists on the engine, but Your Space didn't make it/);
    }
  });

  it("mounts this installation's own knowledge base, as an external volume Compose doesn't make", async () => {
    volumes.set(NOTES, knowledgeLabels(INSTALLATION, "notes"));
    const steps: unknown[] = [];
    await apply(given, (event) => steps.push(event));
    expect(steps.at(-1)).toEqual({ step: "started" });
    expect(calls).toContain(`GET /volumes/${NOTES}`);
    expect(up!.args).toContain("up");
    const web = (up!.file.services as Record<string, Json>).web!;
    expect(web.volumes).toContainEqual({ type: "volume", source: NOTES, target: "/knowledge/notes", volume: { nocopy: true } });
    expect((up!.file.volumes as Json)[NOTES]).toEqual({ external: true, name: NOTES });
  });

  it("checks nothing for an app given none", async () => {
    await apply({ ...given, knowledge: { path: "/knowledge", bases: [] } }, () => {});
    expect(calls.some((c) => c.startsWith("GET /volumes/"))).toBe(false);
    expect(Object.keys((up!.file.volumes as Json | undefined) ?? {}).some((name) => name.startsWith(KNOWLEDGE_PREFIX))).toBe(false);
  });
});
