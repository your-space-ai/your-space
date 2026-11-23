// A file that requires settings, with `${NAME:?message}` or `${NAME?message}`: a check that asks for
// placeholders resolves it before the owner gives them, and an apply never does.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apply, check, PLACEHOLDER, SpecError, validateSpec, withPlaceholders } from "../src/apps.ts";
import { docker, engineInfo, inspectImage, type CliResult } from "../src/engine.ts";

vi.mock("../src/engine.ts", async (load) => ({
  ...(await load<typeof import("../src/engine.ts")>()),
  docker: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
}));

const COMPOSE = `services:
  web:
    image: busybox:1.37
    environment:
      SECRET_KEY_BASE: \${SECRET_KEY_BASE:?Set SECRET_KEY_BASE}
      ADMIN_EMAIL: \${ADMIN_EMAIL?Set ADMIN_EMAIL}
      GREETING: \${GREETING:-hello}
`;

/** `docker compose config --variables --format json` for the file. */
const VARIABLES = {
  ADMIN_EMAIL: { Name: "ADMIN_EMAIL", DefaultValue: "", PresenceValue: "", Required: true },
  GREETING: { Name: "GREETING", DefaultValue: "hello", PresenceValue: "", Required: false },
  SECRET_KEY_BASE: { Name: "SECRET_KEY_BASE", DefaultValue: "", PresenceValue: "", Required: true },
};

/**
 * Compose on the file: `:?` needs a value that isn't empty, `?` only a value. Records each
 * resolution's settings.
 */
let resolutions: Record<string, string>[];
function compose(args: string[], env: Record<string, string> = {}): CliResult {
  if (args.includes("--variables")) return { code: 0, stdout: JSON.stringify(VARIABLES), stderr: "" };
  if (args.includes("up")) throw new Error("Nothing starts in these tests.");
  resolutions.push(env);
  const missing = !env.SECRET_KEY_BASE ? "SECRET_KEY_BASE" : env.ADMIN_EMAIL === undefined ? "ADMIN_EMAIL" : undefined;
  if (missing) {
    return { code: 1, stdout: "", stderr: `error while interpolating services.web.environment.${missing}: required variable ${missing} is missing a value: Set ${missing}\n` };
  }
  const environment = { SECRET_KEY_BASE: env.SECRET_KEY_BASE, ADMIN_EMAIL: env.ADMIN_EMAIL, GREETING: env.GREETING || "hello" };
  return { code: 0, stdout: JSON.stringify({ name: "ys-needs", services: { web: { image: "busybox:1.37", environment } } }), stderr: "" };
}

const spec = (body: Record<string, unknown> = {}) => validateSpec({ project: "ys-needs", app: "needs", compose: COMPOSE, ...body });

beforeEach(() => {
  resolutions = [];
  vi.mocked(inspectImage).mockClear();
  vi.mocked(docker).mockImplementation(async (args, env) => compose(args, env));
  vi.mocked(engineInfo).mockResolvedValue({ reachable: true, arch: "arm64", connection: "fixture" });
  vi.mocked(inspectImage).mockImplementation(async (ref) => ({ ref, digest: `sha256:${"a".repeat(64)}`, runsHere: true, platforms: ["linux/arm64"] }));
});

describe("placeholders for required settings", () => {
  it("fill each required setting without a value, and nothing else", () => {
    const variables = Object.values(VARIABLES).map((v) => ({ name: v.Name, required: v.Required, default: v.DefaultValue }));
    expect(withPlaceholders({}, variables)).toEqual({ ADMIN_EMAIL: PLACEHOLDER, SECRET_KEY_BASE: PLACEHOLDER });
    expect(withPlaceholders({ SECRET_KEY_BASE: "", ADMIN_EMAIL: "owner@example.com", GREETING: "hi" }, variables)).toEqual({
      SECRET_KEY_BASE: PLACEHOLDER,
      ADMIN_EMAIL: "owner@example.com",
      GREETING: "hi",
    });
    expect(withPlaceholders({}, [{ name: "constructor", required: true, default: "" }])).toEqual({ constructor: PLACEHOLDER });
  });

  it("let a check that asks for them resolve the file, keeping the values the spec gives", async () => {
    const answer = await check(spec({ placeholders: true }));
    expect(answer.ok).toBe(true);
    expect(answer.variables.filter((v) => v.required).map((v) => v.name)).toEqual(["ADMIN_EMAIL", "SECRET_KEY_BASE"]);
    expect(answer.services.map((s) => s.name)).toEqual(["web"]);
    expect(resolutions).toHaveLength(2);
    for (const env of resolutions) expect(env).toEqual({ ADMIN_EMAIL: PLACEHOLDER, SECRET_KEY_BASE: PLACEHOLDER });

    resolutions = [];
    expect((await check(spec({ placeholders: true, env: { ADMIN_EMAIL: "owner@example.com" } }))).ok).toBe(true);
    for (const env of resolutions) expect(env).toEqual({ ADMIN_EMAIL: "owner@example.com", SECRET_KEY_BASE: PLACEHOLDER });
  });

  it("aren't used by a check that doesn't ask for them", async () => {
    await expect(check(spec())).rejects.toThrow(SpecError);
    await expect(check(spec({ env: { SECRET_KEY_BASE: "a-real-secret" } }))).rejects.toThrow(/required variable ADMIN_EMAIL is missing a value/);
    expect(resolutions.flatMap((env) => Object.values(env))).not.toContain(PLACEHOLDER);
  });

  it("never reach an apply, even when its spec asks for them", async () => {
    const steps: unknown[] = [];
    await expect(apply(spec({ placeholders: true }), (event) => steps.push(event))).rejects.toThrow(/required variable SECRET_KEY_BASE is missing a value/);
    expect(steps).toEqual([{ step: "check" }]);
    expect(resolutions.length).toBeGreaterThan(0);
    expect(resolutions.flatMap((env) => Object.values(env))).not.toContain(PLACEHOLDER);
  });

  it("leave an image named with one for the install's check to look up", async () => {
    // `image: example/app:${TAG:?Set TAG}`
    vi.mocked(docker).mockImplementation(async (args, env = {}) => {
      if (args.includes("--variables")) return { code: 0, stdout: JSON.stringify({ TAG: { Name: "TAG", DefaultValue: "", PresenceValue: "", Required: true } }), stderr: "" };
      if (!env.TAG) return { code: 1, stdout: "", stderr: "required variable TAG is missing a value: Set TAG\n" };
      return { code: 0, stdout: JSON.stringify({ services: { web: { image: `example/app:${env.TAG}` } } }), stderr: "" };
    });
    const reviewed = await check(spec({ placeholders: true }));
    expect(reviewed.ok).toBe(true);
    expect(reviewed.images).toContainEqual({ ref: `example/app:${PLACEHOLDER}`, platforms: [], runsHere: true });
    expect(inspectImage).not.toHaveBeenCalledWith(`example/app:${PLACEHOLDER}`, "arm64");

    const installing = await check(spec({ env: { TAG: "2.1" } }));
    expect(installing.ok).toBe(true);
    expect(inspectImage).toHaveBeenCalledWith("example/app:2.1", "arm64");
    expect(installing.images).toContainEqual(expect.objectContaining({ ref: "example/app:2.1", digest: `sha256:${"a".repeat(64)}` }));
  });

  it("leave an image named like one looked up when no setting had one", async () => {
    vi.mocked(docker).mockImplementation(async (args) => ({
      code: 0,
      stdout: args.includes("--variables") ? "{}" : JSON.stringify({ services: { web: { image: `example/app:${PLACEHOLDER}` } } }),
      stderr: "",
    }));
    const answer = await check(spec({ placeholders: true }));
    expect(inspectImage).toHaveBeenCalledWith(`example/app:${PLACEHOLDER}`, "arm64");
    expect(answer.images).toContainEqual(expect.objectContaining({ ref: `example/app:${PLACEHOLDER}`, digest: `sha256:${"a".repeat(64)}` }));
  });

  it("are named when the file can't take one, such as for a port", async () => {
    vi.mocked(docker).mockImplementation(async (args) => {
      if (args.includes("--variables")) return { code: 0, stdout: JSON.stringify({ APP_PORT: { Name: "APP_PORT", DefaultValue: "", PresenceValue: "", Required: true } }), stderr: "" };
      return { code: 1, stdout: "", stderr: `invalid hostPort: ${PLACEHOLDER}\n` };
    });
    await expect(check(spec({ placeholders: true }))).rejects.toThrow(
      `The file isn't a Compose file Your Space can read: invalid hostPort: ${PLACEHOLDER} Your Space read it with a placeholder in place of APP_PORT, which the file requires and which has no value yet.`,
    );
  });

  it("are asked for with true or false", () => {
    expect(spec({ placeholders: true }).placeholders).toBe(true);
    expect(() => spec({ placeholders: "yes" })).toThrow(/placeholders must be true or false/);
  });
});
