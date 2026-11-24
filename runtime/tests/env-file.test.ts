// An app whose file loads its settings with `env_file: .env` (2026-11-23): Your Space gives that
// service the environment its kit defines, and Compose reads no settings or label file an app's file names.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adapt, envFiles, resetFiles, UNRESOLVED, type AppSpec } from "../src/adapter.ts";
import { apply, check, SpecError, validateSpec } from "../src/apps.ts";
import * as engineModule from "../src/engine.ts";
import type { CliResult } from "../src/engine.ts";

vi.mock("../src/engine.ts", async (load) => ({
  ...(await load<typeof import("../src/engine.ts")>()),
  engine: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
  docker: vi.fn(),
  listContainers: vi.fn(),
  connectNetwork: vi.fn(),
}));

describe("the settings and label files an app's file names", () => {
  const read = (services: Record<string, unknown>) => envFiles({ services });

  it("mark a service that loads .env, in each of Compose's forms, required or not", () => {
    for (const env_file of [".env", "./.env", [".env"], [{ path: ".env", required: true }], [{ path: ".env", required: false }], [".env", { path: ".env" }]]) {
      expect(read({ web: { image: "busybox", env_file } })).toEqual({ settings: ["web"], reset: { web: ["env_file"] }, refusals: [] });
    }
  });

  it("refuse any other settings file, and every label file, naming each", () => {
    const files = read({
      passwd: { env_file: "/etc/passwd" },
      parent: { env_file: [{ path: "../x", required: false }] },
      two: { env_file: [".env", "other.env"] },
      named: { env_file: "${CONFIG_DIR}/.env" },
      labels: { label_file: "/etc/hostname" },
      plain: { image: "busybox" },
    });
    expect(files.settings).toEqual([]);
    expect(files.reset).toEqual({ passwd: ["env_file"], parent: ["env_file"], two: ["env_file"], named: ["env_file"], labels: ["label_file"] });
    expect(files.refusals.map((r) => [r.service, r.setting, r.reason.split(" can't")[0]])).toEqual([
      ["passwd", "env_file", "Settings file /etc/passwd"],
      ["parent", "env_file", "Settings file ../x"],
      ["two", "env_file", "Settings file other.env"],
      ["named", "env_file", "Settings file ${CONFIG_DIR}/.env"],
      ["labels", "label_file", "Label file /etc/hostname"],
    ]);
  });

  it("refuse a label file next to .env, and still give the service the settings", () => {
    const files = read({ web: { env_file: ".env", label_file: ["labels"] } });
    expect(files.settings).toEqual(["web"]);
    expect(files.reset).toEqual({ web: ["env_file", "label_file"] });
    expect(files.refusals).toEqual([{ service: "web", setting: "label_file", reason: "Label file labels can't be read: apps can't read files on the machine." }]);
  });

  it("are none for a file without any", () => {
    expect(read({ web: { image: "busybox", env_file: [] } })).toEqual({ settings: [], reset: {}, refusals: [] });
    expect(envFiles({})).toEqual({ settings: [], reset: {}, refusals: [] });
  });

  it("are reset for a service of any name, __proto__ included", () => {
    const files = envFiles(JSON.parse('{"services":{"__proto__":{"env_file":"/etc/passwd"}}}'));
    expect(Object.keys(files.reset)).toEqual(["__proto__"]);
    expect(resetFiles(files.reset)).toBe('services:\n  "__proto__":\n    env_file: !reset []\n');
    expect(files.refusals.map((r) => r.service)).toEqual(["__proto__"]);
  });

  it("are left unread by a Compose file of names only", () => {
    expect(resetFiles({ web: ["env_file"], "db.1": ["env_file", "label_file"] })).toBe(
      'services:\n  "web":\n    env_file: !reset []\n  "db.1":\n    env_file: !reset []\n    label_file: !reset []\n',
    );
  });
});

describe("a service that loads .env", () => {
  const spec: AppSpec = {
    project: "ys-notes",
    app: "notes",
    installation: "your-space",
    compose: "",
    env: { SESSION_SECRET: "s3cr$t", GREETING: "from-the-kit", HTTP_PROXY: "http://elsewhere" },
    interface: null,
  };
  const resolved = {
    services: {
      web: { image: "busybox:1.37", environment: { GREETING: "from-the-file", BARE: null } },
      db: { image: "postgres:17", environment: { POSTGRES_DB: "notes" } },
    },
  };
  const files = { settings: ["web", "worker"], reset: { web: ["env_file"], worker: ["env_file"] }, refusals: [] };

  it("gets the app's settings under its file's own environment, and Your Space's proxy over both", () => {
    const result = adapt(spec, resolved, ["worker"], undefined, files);
    expect(result.refusals).toEqual([]);
    const services = result.adapted!.services as Record<string, { environment: Record<string, unknown> }>;
    expect(services.web!.environment).toMatchObject({
      // `$` is escaped like any resolved value, so Compose takes it as it is.
      SESSION_SECRET: "s3cr$$t",
      GREETING: "from-the-file",
      BARE: null,
      HTTP_PROXY: "http://ys-egress:3128",
    });
    expect(Object.keys(services.db!.environment)).not.toContain("SESSION_SECRET");
  });

  it("is reported, unless it is left out with its profile", () => {
    const reported = adapt(spec, resolved, ["worker"], undefined, files).adaptations.filter((a) => /^Settings file \.env replaced/.test(a.detail));
    expect(reported.map((a) => a.service)).toEqual(["web"]);
  });

  it("isn't run when another file is refused", () => {
    const refusals = [{ service: "db", setting: "env_file", reason: "Settings file /etc/passwd can't be read." }];
    const result = adapt(spec, resolved, [], undefined, { ...files, refusals });
    expect(result.refusals).toEqual(refusals);
    expect(result.adapted).toBeNull();
  });

  it("runs when only a service left out with its profile names another file, which Compose still doesn't read", () => {
    const refusals = [{ service: "worker", setting: "env_file", reason: "Settings file backup.env can't be read." }];
    const result = adapt(spec, resolved, ["worker"], undefined, { ...files, refusals });
    expect(result.refusals).toEqual([]);
    expect(result.adapted).not.toBeNull();
  });
});

describe("checking and applying a file that names settings files", () => {
  const COMPOSE = "services:\n  web:\n    image: busybox:1.37\n    env_file: .env\n";
  const SECRET = "never-on-disk-7f3a";
  /** Compose's own reading of the file as written. */
  let asWritten: Record<string, unknown>;
  let calls: { args: string[]; env: Record<string, string>; files: Record<string, string> }[];
  let started: Record<string, unknown> | undefined;

  /** The files of the folder Compose was given, as they were when it ran. */
  function filesOf(args: string[]): Record<string, string> {
    const dir = dirname(args[args.indexOf("-f") + 1]!);
    return Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
  }

  beforeEach(() => {
    asWritten = { services: { web: { image: "busybox:1.37", env_file: [{ path: ".env", required: true }] } } };
    calls = [];
    started = undefined;
    vi.mocked(engineModule.engineInfo).mockResolvedValue({ reachable: true, arch: "arm64", connection: "fixture" });
    vi.mocked(engineModule.inspectImage).mockImplementation(async (ref) => ({ ref, digest: `sha256:${"a".repeat(64)}`, platforms: [], runsHere: true }));
    vi.mocked(engineModule.engine).mockResolvedValue({ status: 200, body: "{}" });
    vi.mocked(engineModule.listContainers).mockResolvedValue([]);
    vi.mocked(engineModule.docker).mockImplementation(async (args, env = {}): Promise<CliResult> => {
      const files = filesOf(args);
      calls.push({ args, env, files });
      const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
      if (args.includes("--no-interpolate")) return ok(JSON.stringify(asWritten));
      if (args.includes("--variables")) return ok("{}");
      if (args.includes("up")) {
        started = JSON.parse(files["compose.json"]!) as Record<string, unknown>;
        return ok("");
      }
      // Like Compose, a settings file it was told to read and that isn't there stops it.
      if (!args.some((a) => a.endsWith("unread.yaml"))) return { code: 1, stdout: "", stderr: "env file /tmp/ys-check-x/.env not found\n" };
      return ok(JSON.stringify({ name: "ys-notes", services: { web: { image: "busybox:1.37" } } }));
    });
  });

  const spec = (compose = COMPOSE) => validateSpec({ project: "ys-notes", app: "notes", compose, env: { SESSION_SECRET: SECRET } });

  it("reads the file as written first, with no settings, then never reads the files it names", async () => {
    const answer = await check(spec());
    expect(answer.ok).toBe(true);
    const [first, ...rest] = calls;
    expect(first!.args).toEqual(expect.arrayContaining(["--profile", "*", "config", ...UNRESOLVED]));
    expect(first!.env).toEqual({});
    expect(rest).toHaveLength(3);
    for (const call of rest) expect(call.args.some((a) => a.endsWith("unread.yaml"))).toBe(true);
    expect(answer.adaptations.map((a) => a.detail)).toContainEqual(expect.stringMatching(/^Settings file \.env replaced/));
  });

  it("writes no setting's value to a file while it checks", async () => {
    await check(spec());
    for (const call of calls) {
      expect(Object.keys(call.files).sort()).toEqual(call === calls[0] ? ["compose.yaml"] : ["compose.yaml", "unread.yaml"]);
      for (const text of Object.values(call.files)) expect(text).not.toContain(SECRET);
    }
    // The settings reach Compose as its environment, as they always have.
    expect(calls.at(-1)!.env).toEqual({ SESSION_SECRET: SECRET });
  });

  it("gives the service the settings when the app starts", async () => {
    await apply(spec(), () => {});
    const web = (started!.services as Record<string, { environment: Record<string, string> }>).web!;
    expect(web.environment.SESSION_SECRET).toBe(SECRET);
  });

  it("refuses a file that names another settings file or a label file, which Compose didn't read", async () => {
    asWritten = { services: { web: { image: "busybox:1.37", env_file: ["/etc/passwd", "../x"], label_file: "/etc/hostname" } } };
    const answer = await check(spec("services:\n  web:\n    image: busybox:1.37\n    env_file: [/etc/passwd, ../x]\n    label_file: /etc/hostname\n"));
    expect(answer.ok).toBe(false);
    expect(answer.refusals.map((r) => r.reason.split(" can't")[0])).toEqual(["Settings file /etc/passwd", "Settings file ../x", "Label file /etc/hostname"]);
    expect(calls.slice(1).every((call) => call.files["unread.yaml"] === resetFiles({ web: ["env_file", "label_file"] }))).toBe(true);
    await expect(apply(spec(), () => {})).rejects.toThrow(/Settings file \/etc\/passwd can't be read/);
    expect(started).toBeUndefined();
  });

  it("stops at a file Compose can't read as written, before anything else runs", async () => {
    vi.mocked(engineModule.docker).mockImplementationOnce(async (args) => {
      calls.push({ args, env: {}, files: {} });
      return { code: 1, stdout: "", stderr: `yaml: line 2: mapping values are not allowed in this context (${SECRET})\n` };
    });
    await expect(check(spec("services: [\n"))).rejects.toThrow(SpecError);
    expect(calls).toHaveLength(1);
  });

  it("is the same as before for a file without settings or label files", async () => {
    asWritten = { services: { web: { image: "busybox:1.37" } } };
    vi.mocked(engineModule.docker).mockImplementation(async (args, env = {}) => {
      calls.push({ args, env, files: filesOf(args) });
      return { code: 0, stdout: args.includes("--variables") ? "{}" : JSON.stringify(asWritten), stderr: "" };
    });
    const answer = await check(spec("services:\n  web:\n    image: busybox:1.37\n"));
    expect(answer.ok).toBe(true);
    for (const call of calls) expect(Object.keys(call.files)).toEqual(["compose.yaml"]);
    expect(answer.adaptations.some((a) => /Settings file/.test(a.detail))).toBe(false);
  });
});
