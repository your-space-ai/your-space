// Journey 002 on the server: installing, managing and reaching apps, with a fake runtime and a
// stand-in for GitHub. The runtime manager's own rules are tested in runtime/tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createGate, Handoffs, readCookie, safeReturn, signPass, verifyPass } from "../src/apps/gate.ts";
import { fetchSource, parseLink, SourceError } from "../src/apps/github.ts";
import { composeOf, KitError, kitIdentity, NotAKitError, parseKit, parseMemory } from "../src/apps/kits.ts";
import { appNameFromHost, stateFromServices, underOwnName } from "../src/apps/service.ts";
import { buildSettings, decrypt, encrypt, kitEnv, resolveTemplates, undefinedVariables, withEnv, withFileDefaults } from "../src/apps/settings.ts";
import { session } from "../src/db/auth-schema.ts";
import { app, appAccessRequest, appSetting, event, installJob } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY, TEST_SECRET } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { COMMIT, fakeGithub, FakeRuntime, kitLink, PINNED, plainKit } from "./helpers/runtime.ts";
import { cookieHeader, send, startServer, type TestServer } from "./helpers/server.ts";

const WHOAMI = `services:
  web:
    image: traefik/whoami:latest
    ports: ["8000:80"]
    environment:
      GREETING: \${GREETING:-hello}
      API_TOKEN: \${API_TOKEN:-published-default-token}
      PAGE: \${PAGE:-}
`;
const KIT = `kit: 1
source: { repo: ys-fixtures/whoami, path: compose.yaml, commit: ${COMMIT} }
name: whoami
title: Who Am I
interface: { service: web, port: 80 }
env:
  API_TOKEN: { generate: { bytes: 24 } }
  GREETING: hello
  PAGE: { derive: { template: "\${GREETING} from whoami" } }
outbound: [example.com]
limits:
  web: { memory: 64M, cpus: 0.5 }
`;
// Apps install from their kits' links (decision 2026-11-23); the kit names the app's Compose file.
const LINK = kitLink("whoami");
const COMPOSE_LINK = "https://github.com/ys-fixtures/whoami/blob/main/compose.yaml";
// A kit beside its app's Compose file, with no source: it names no Compose file, so it is refused.
const BESIDE = "kit: 1\nname: beside\ninterface: { service: web, port: 80 }\n";
// The Compose file at a newer commit than the one its kits pin.
const NEWER = `${WHOAMI}    labels: { newer: "true" }\n`;
// A kit beside its app's Compose file, pinning it to an older commit than the kit's own.
const PINNED_KIT = `kit: 1\nsource: { repo: ys-fixtures/pinned, path: compose.yaml, commit: ${PINNED} }\nname: pinned\ninterface: { service: web, port: 80 }\n`;

describe("links, kits and settings", () => {
  it("reads GitHub file links and refuses anything else", () => {
    expect(parseLink(COMPOSE_LINK)).toEqual({ repo: "ys-fixtures/whoami", rest: ["main", "compose.yaml"] });
    expect(parseLink("https://raw.githubusercontent.com/a/b/main/x/compose.yml").rest).toEqual(["main", "x", "compose.yml"]);
    for (const bad of [
      "not a link",
      "http://github.com/a/b/blob/main/c.yml",
      "https://gitlab.com/a/b/blob/main/c.yml",
      "https://github.com/a/b",
      "https://github.com/a/b/tree/main",
      // A path can't step out of its repository, hide a slash in a part, or fail to decode.
      "https://github.com/a/b/blob/main/x%2F..%2F..%2Fc.yml",
      "https://raw.githubusercontent.com/a/b/main/..%2Fc.yml",
      "https://github.com/a/b/blob/main/%E0%A4%A.yml",
    ]) {
      expect(() => parseLink(bad), bad).toThrow(SourceError);
    }
  });

  it("resolves a branch with a slash to its exact commit", async () => {
    const github = fakeGithub({ "a/b/deploy/compose.yaml": "services: {}" });
    const file = await fetchSource("https://github.com/a/b/blob/feature/x/deploy/compose.yaml", { api: "https://api.github.test", raw: "https://raw.github.test" }, github);
    expect(file).toMatchObject({ repo: "a/b", ref: "feature/x", path: "deploy/compose.yaml", commit: COMMIT });
    await expect(fetchSource("https://github.com/a/b/blob/nope/compose.yaml", { api: "https://api.github.test", raw: "https://raw.github.test" }, github)).rejects.toThrow(/branch, tag or commit/);
  });

  it("validates kits strictly", () => {
    const kit = parseKit(KIT);
    expect(kit).toMatchObject({ name: "whoami", interface: { service: "web", port: 80 }, outbound: ["example.com"], limits: { web: { memory: 64 * 1024 ** 2, cpus: 0.5 } } });
    expect(() => parseKit(`${KIT}\nextra: true`)).toThrow(KitError);
    expect(() => parseKit(KIT.replace("kit: 1", "kit: 3"))).toThrow(/format/);
    expect(() => parseKit(KIT.replace("[example.com]", "['http://x']"))).toThrow(/host name/);
    expect(() => parseKit(KIT.replace("bytes: 24", "bytes: 4"))).toThrow(/16 to 128/);
    expect(parseMemory("1.5G")).toBe(1.5 * 1024 ** 3);

    // Templates build a value from variables the kit's env defines, never from each other.
    const templated = (entries: string) =>
      `kit: 1\nsource: { repo: a/b, path: c, commit: ${COMMIT} }\nenv:\n  DB_PASSWORD: { generate: true }\n  DB_USER: app\n  DB_HOST: { ask: true }\n  APP_URL: { derive: app_origin }\n${entries}`;
    expect(parseKit(templated('  DATABASE_URL: { derive: { template: "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/app" } }')).env!.DATABASE_URL).toEqual({
      derive: { template: "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/app" },
    });
    expect(() => parseKit(templated('  DATABASE_URL: { derive: { template: "postgresql://${NOPE}@db" } }'))).toThrow(/uses NOPE, which the kit's env doesn't define/);
    expect(() => parseKit(templated('  A: { derive: { template: "${APP_URL}" } }\n  B: { derive: { template: "${A}" } }'))).toThrow(/uses A, another template/);
    expect(() => parseKit(templated('  A: { derive: { template: "${lower-case}" } }'))).toThrow(/placeholder/);
    expect(() => parseKit(templated('  A: { derive: { template: "x", extra: 1 } }'))).toThrow(/template/);
    expect(() => parseMemory("lots")).toThrow(KitError);
  });

  it("reads the app's whole environment from the kit's env, each variable with where its value comes from", () => {
    const env = (entries: string) => parseKit(`kit: 1\nsource: { repo: a/b, path: c, commit: ${COMMIT} }\nenv:\n${entries}`).env;
    expect(
      env(
        [
          "  SECRET_KEY_BASE: { generate: { bytes: 64, encoding: hex } }",
          "  POSTGRES_PASSWORD: { generate: true }",
          "  APP_URL: { derive: app_origin }",
          "  APP_DOMAIN: { derive: app_host }",
          "  OWNER_KEY: { ask: true }",
          "  ADMIN_EMAIL: { ask: true, secret: false }",
          "  OPENAI_API_KEY: { ask: optional }",
          "  LOG_LEVEL: info",
          "  WORKERS: 2",
          "  SIGNUPS: false",
          '  EMPTY: ""',
        ].join("\n"),
      ),
    ).toEqual({
      SECRET_KEY_BASE: { generate: { bytes: 64, encoding: "hex" } },
      POSTGRES_PASSWORD: { generate: { bytes: 32, encoding: "base64url" } },
      APP_URL: { derive: "app_origin" },
      APP_DOMAIN: { derive: "app_host" },
      // What the owner types is shown only as set unless the kit says it isn't secret.
      OWNER_KEY: { ask: true, secret: true },
      ADMIN_EMAIL: { ask: true, secret: false },
      OPENAI_API_KEY: { ask: "optional", secret: true },
      LOG_LEVEL: "info",
      WORKERS: "2",
      SIGNUPS: "false",
      EMPTY: "",
    });
    for (const [entry, message] of [
      ["  A: { generate: true, ask: true }", /exactly one of generate, derive or ask/],
      ["  A: {}", /exactly one of generate, derive or ask/],
      ["  A:", /must be a value, or generate, derive or ask/],
      ["  A: [x]", /must be a value, or generate, derive or ask/],
      ["  A: { ask: false }", /ask must be true, or optional/],
      ["  A: { ask: true, secret: maybe }", /secret must be true or false/],
      ["  A: { generate: true, secret: true }", /unknown field secret/],
      ["  A: { generate: { bytes: 4 } }", /16 to 128/],
      ["  A: { generate: { size: 32 } }", /generate has the unknown field size/],
      ["  A: { derive: app_url }", /app_origin, app_host or/],
      ["  lower-case: x", /isn't a variable name/],
      ["  __proto__: x", /isn't a variable name/],
    ] as const) {
      expect(() => env(entry), entry).toThrow(message);
    }
    // The fields kits named settings in before are refused with what to use instead, so an older kit
    // never half-applies.
    for (const field of ["generate: { A: {} }", "derive: { A: app_origin }", "set: { A: x }", "secrets: [A]"]) {
      expect(() => parseKit(`kit: 1\n${field}\n`), field).toThrow(/no longer have\. A kit gives the app's whole environment in env/);
    }
    expect(() => parseKit("kit: 1\nrequired: [A]\n")).toThrow(/unknown field required/);
  });

  it("explains kits when it is given a Compose file instead", () => {
    expect(() => parseKit(WHOAMI)).toThrow(NotAKitError);
    expect(() => parseKit(WHOAMI)).toThrow(/not a Your Space kit/);
    // A kit with a field it doesn't know is still a kit.
    expect(() => parseKit(`${KIT}services: {}\n`)).toThrow(/unknown field services/);
  });

  it("names the Compose file: the kit's source, at exactly the commit it pins", () => {
    expect(parseKit(KIT).source).toEqual({ repo: "ys-fixtures/whoami", path: "compose.yaml", commit: COMMIT });
    expect(composeOf(parseKit(KIT))).toEqual({ repo: "ys-fixtures/whoami", path: "compose.yaml", commit: COMMIT });
    expect(composeOf(parseKit(PINNED_KIT))).toEqual({ repo: "ys-fixtures/pinned", path: "compose.yaml", commit: PINNED });
    // Without source, a kit names no Compose file: not even the compose.yaml beside it.
    expect(() => composeOf(parseKit(BESIDE))).toThrow(/names no Compose file/);
    // A source without its exact commit is refused, in both kit formats, naming the field.
    for (const version of ["kit: 1", "kit: 2\nagentAccess: { roles: {}, routes: {} }"]) {
      expect(() => parseKit(`${version}\nsource: { repo: a/b, path: compose.yaml }\n`), version).toThrow(/source has no commit\. Add source\.commit/);
    }
    for (const commit of ["main", "v1.2.0", COMMIT.slice(0, 12), COMMIT.toUpperCase(), "1234"]) {
      expect(() => parseKit(`kit: 1\nsource: { repo: a/b, path: compose.yaml, commit: "${commit}" }\n`), commit).toThrow(/source\.commit must be a full 40-character commit/);
    }
    // A source names a file at a commit and nothing else, such as a branch to follow.
    expect(() => parseKit(`kit: 1\nsource: { repo: a/b, path: compose.yaml, commit: ${COMMIT}, ref: main }\n`)).toThrow(/source has the unknown field ref/);
    // The source is a repository and a file in it, which can't step out of the commit it is read at.
    for (const [repo, path] of [["a/b", "../dev/compose.yaml"], ["a/b", "deploy/./compose.yaml"], ["a/b", "/compose.yaml"], ["a/b/c", "compose.yaml"], ["../b", "compose.yaml"], ["a", "compose.yaml"]]) {
      expect(() => parseKit(`kit: 1\nsource: { repo: "${repo}", path: "${path}", commit: ${COMMIT} }\n`), `${repo} ${path}`).toThrow(/source\.(repo|path) must/);
    }
  });

  it("identifies a kit by its repository, path and commit, or by its digest", async () => {
    // A file whose name has a literal %20 keeps it: the pinned link encodes it, and the identity decodes it once.
    const github = fakeGithub({ "a/kits/x%20y.yaml": "kit: 1\n" });
    const file = await fetchSource("https://github.com/a/kits/blob/main/x%2520y.yaml", { api: "https://api.github.test", raw: "https://raw.github.test" }, github);
    expect(file.pinnedLink).toBe(`https://github.com/a/kits/blob/${COMMIT}/x%2520y.yaml`);
    expect(kitIdentity(file.pinnedLink).path).toBe("x%20y.yaml");
    expect(kitIdentity(`https://github.com/a/kits/blob/${COMMIT}/apps/x%20y.yaml`)).toEqual({ source: `https://github.com/a/kits/blob/${COMMIT}/apps/x%20y.yaml`, repo: "a/kits", path: "apps/x y.yaml", commit: COMMIT });
    expect(kitIdentity(`sha256:${"a".repeat(64)}`)).toEqual({ source: `sha256:${"a".repeat(64)}` });
  });

  it("are exactly the kit's env, with what Your Space generates or works out", () => {
    const address = { origin: "http://x.space.localhost", host: "x.space.localhost" };
    const kit = parseKit(
      `kit: 1\nenv:\n  APP_SECRET: { generate: { encoding: hex } }\n  SERVER_URL: { derive: app_origin }\n  STORAGE_TYPE: local\n  ADMIN_EMAIL: { ask: true, secret: false }\n  OPENAI_ACCESS_TOKEN: { ask: optional }\n`,
    );
    const settings = buildSettings(kit, address);
    expect(settings.map((s) => s.name)).toEqual(["ADMIN_EMAIL", "APP_SECRET", "OPENAI_ACCESS_TOKEN", "SERVER_URL", "STORAGE_TYPE"]);
    expect(settings.find((s) => s.name === "APP_SECRET")).toMatchObject({ secret: true, generated: true, required: false });
    expect(settings.find((s) => s.name === "APP_SECRET")!.value).toMatch(/^[0-9a-f]{64}$/);
    expect(settings.find((s) => s.name === "SERVER_URL")).toMatchObject({ derived: true, secret: false, value: "http://x.space.localhost" });
    expect(settings.find((s) => s.name === "STORAGE_TYPE")).toMatchObject({ value: "local", generated: false, secret: false, required: false });
    expect(settings.find((s) => s.name === "ADMIN_EMAIL")).toMatchObject({ value: null, secret: false, required: true });
    expect(settings.find((s) => s.name === "OPENAI_ACCESS_TOKEN")).toMatchObject({ value: null, secret: true, required: false });
    // No name decides what is secret: only the kit does.
    const named = buildSettings(parseKit("kit: 1\nenv: { DB_PASSWORD: hunter2 }\n"), address);
    expect(named[0]).toMatchObject({ name: "DB_PASSWORD", secret: false, generated: false, value: "hunter2" });

    // The app's file adds only what it says about a setting: that it requires it, and its default.
    withFileDefaults(settings, [
      { name: "OPENAI_ACCESS_TOKEN", required: true, default: "" },
      { name: "STORAGE_TYPE", required: false, default: "s3" },
      { name: "APP_SECRET", required: false, default: "published-secret" },
      { name: "NOT_IN_KIT", required: false, default: "x" },
    ]);
    expect(settings.find((s) => s.name === "OPENAI_ACCESS_TOKEN")).toMatchObject({ required: true });
    expect(settings.find((s) => s.name === "STORAGE_TYPE")).toMatchObject({ publishedDefault: "s3" });
    expect(settings.find((s) => s.name === "APP_SECRET")).toMatchObject({ publishedDefault: null });
    expect(settings.map((s) => s.name)).not.toContain("NOT_IN_KIT");

    // Data kept from a removed app was written with its settings then: a kept unset one stays unset,
    // even when the kit installed now generates or gives it, and a kept value stays as it was.
    const keptUnset = new Map([["POSTGRES_PASSWORD", null]]);
    for (const entry of ["{ generate: true }", "chosen", "{ ask: optional }"]) {
      const kept = buildSettings(parseKit(`kit: 1\nenv: { POSTGRES_PASSWORD: ${entry} }\n`), address, keptUnset);
      expect(kept[0], entry).toMatchObject({ value: null, generated: false });
    }
    expect(buildSettings(parseKit("kit: 1\nenv: { POSTGRES_PASSWORD: { generate: true } }\n"), address, new Map([["POSTGRES_PASSWORD", "kept"]]))[0]).toMatchObject({ value: "kept", generated: true });

    // A template is filled from the values it uses, and is secret when any of them is.
    const urlKit = parseKit(
      `kit: 1\nenv:\n  DB_PASSWORD: { generate: true }\n  DB_HOST: db\n  GREETING: hi\n  DATABASE_URL: { derive: { template: "postgresql://app:\${DB_PASSWORD}@\${DB_HOST}/app" } }\n  PAGE: { derive: { template: "\${GREETING} there" } }`,
    );
    const urlSettings = buildSettings(urlKit, address);
    const dbPassword = urlSettings.find((s) => s.name === "DB_PASSWORD")!.value!;
    expect(urlSettings.find((s) => s.name === "DATABASE_URL")).toMatchObject({ derived: true, secret: true, value: `postgresql://app:${dbPassword}@db/app` });
    expect(urlSettings.find((s) => s.name === "PAGE")).toMatchObject({ derived: true, secret: false, value: "hi there" });
    expect(resolveTemplates(kitEnv(urlKit), new Map([["DB_PASSWORD", "p"], ["DB_HOST", null], ["GREETING", "yo"]])).get("DATABASE_URL")).toBe("postgresql://app:p@/app");
  });

  it("refuse a variable the file needs that the kit doesn't define", () => {
    const env = kitEnv(parseKit("kit: 1\nenv: { ASKED: { ask: true }, GIVEN: x }\n"));
    const variables = [
      // Defined by the kit, with a value or not yet: fine.
      { name: "ASKED", required: true, default: "", unset: true },
      { name: "GIVEN", required: false, default: "", unset: false },
      // ${TOKEN} and ${NEEDED:?...}: no default, and the kit doesn't define them.
      { name: "TOKEN", required: false, default: "", unset: true },
      { name: "NEEDED", required: true, default: "", unset: false },
      // ${EMPTY:-} and ${TZ:-UTC}: the file's default is used.
      { name: "EMPTY", required: false, default: "", unset: false },
      { name: "TZ", required: false, default: "UTC", unset: false },
    ];
    expect(undefinedVariables(variables, env)).toEqual(["NEEDED", "TOKEN"]);
  });

  it("read a kit stored before env as env", () => {
    const stored = {
      kit: 1 as const,
      name: "old",
      generate: { SECRET: { bytes: 32, encoding: "base64url" as const } },
      derive: { URL: "app_origin" as const, DSN: { template: "x:${SECRET}" } },
      set: { MODE: "local" },
      secrets: ["TOKEN", "SECRET"],
    };
    expect(kitEnv(stored)).toEqual({
      TOKEN: { ask: "optional", secret: true },
      SECRET: { generate: { bytes: 32, encoding: "base64url" } },
      MODE: "local",
      URL: { derive: "app_origin" },
      DSN: { derive: { template: "x:${SECRET}" } },
    });
    expect(withEnv(stored)).toEqual({ kit: 1, name: "old", env: kitEnv(stored) });
    // A kit parsed from the same fields in env compares equal to the stored one.
    const parsed = parseKit(
      'kit: 1\nname: old\nenv:\n  TOKEN: { ask: optional }\n  SECRET: { generate: true }\n  MODE: local\n  URL: { derive: app_origin }\n  DSN: { derive: { template: "x:${SECRET}" } }\n',
    );
    expect(withEnv(stored)).toEqual(parsed);
    expect(withEnv({ kit: 1, name: "plain" })).toEqual({ kit: 1, name: "plain" });
    // Empty earlier fields named nothing, as a kit without env does.
    expect(withEnv({ kit: 1, name: "plain", generate: {}, secrets: [] })).toStrictEqual(parseKit("kit: 1\nname: plain\nenv: {}\n"));
  });

  it("encrypts settings so the stored form never contains the value", () => {
    const stored = encrypt(TEST_SECRET, "hunter2-hunter2");
    expect(stored).not.toContain("hunter2");
    expect(decrypt(TEST_SECRET, stored)).toBe("hunter2-hunter2");
    expect(() => decrypt(`${TEST_SECRET}x`, stored)).toThrow();
  });
});

describe("the access gate's parts", () => {
  it("signs passes for one app and one session, until they expire", () => {
    const pass = signPass(TEST_SECRET, "sure", "session-1", 2_000_000_000);
    expect(verifyPass(TEST_SECRET, pass, "sure", 1_900_000_000)).toBe("session-1");
    expect(verifyPass(TEST_SECRET, pass, "twenty", 1_900_000_000)).toBeUndefined();
    expect(verifyPass(TEST_SECRET, pass, "sure", 2_100_000_000)).toBeUndefined();
    expect(verifyPass(`${TEST_SECRET}x`, pass, "sure", 1_900_000_000)).toBeUndefined();
    expect(verifyPass(TEST_SECRET, `${pass.slice(0, -2)}xx`, "sure", 1_900_000_000)).toBeUndefined();
  });

  it("returns only to paths on the same origin", () => {
    expect(safeReturn("/a?b=1")).toBe("/a?b=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", undefined, 3]) expect(safeReturn(bad)).toBe("/");
  });

  it("names an app only by a direct subdomain of Your Space's host", () => {
    expect(appNameFromHost("http://space.localhost", "sure.space.localhost:8081")).toBe("sure");
    expect(appNameFromHost("https://space.example.com", "Sure.Space.Example.com")).toBe("sure");
    for (const bad of ["space.localhost", "a.b.space.localhost", "sure.localhost", "evil-space.localhost", "1x.space.localhost"]) {
      expect(appNameFromHost("http://space.localhost", bad), bad).toBeUndefined();
    }
    for (const under of ["sure.space.localhost", "Sure.Space.Localhost:8081", "a.b.space.localhost", "1x.space.localhost"]) {
      expect(underOwnName("http://space.localhost", under), under).toBe(true);
    }
    for (const other of ["space.localhost", "evil-space.localhost", "127.0.0.1:8080", "your-space:8080", "", undefined]) {
      expect(underOwnName("http://space.localhost", other), other).toBe(false);
    }
  });

  it("reads one cookie from a header", () => {
    expect(readCookie("a=1; ys-pass=abc.def; b=2", "ys-pass")).toBe("abc.def");
    expect(readCookie("xys-pass=1", "ys-pass")).toBeUndefined();
  });

  it("reports an app's state from its services", () => {
    expect(stateFromServices([{ name: "web", role: "app", state: "running" }]).state).toBe("running");
    expect(stateFromServices([{ name: "db", role: "app", state: "running", health: "starting" }]).state).toBe("starting");
    expect(stateFromServices([])).toEqual({ state: "stopped", reason: "Not running." });
    const oom = stateFromServices([
      { name: "web", role: "app", state: "running" },
      { name: "worker", role: "app", state: "exited", exitCode: 137, oomKilled: true },
    ]);
    expect(oom).toEqual({ state: "degraded", reason: "worker stopped: it ran out of memory." });
    // A service that ran once and finished, such as a migration, is neither a problem nor running.
    const migrated = [{ name: "migrator", role: "app" as const, state: "exited", exitCode: 0, completed: true }];
    expect(stateFromServices([{ name: "web", role: "app", state: "running" }, ...migrated]).state).toBe("running");
    expect(stateFromServices([{ name: "web", role: "app", state: "exited", exitCode: 143 }, ...migrated]).state).toBe("stopped");
    expect(stateFromServices([{ name: "web", role: "app", state: "restarting", exitCode: 1 }, ...migrated])).toEqual({ state: "degraded", reason: "web keeps restarting." });
  });
});

describe("apps API", () => {
  let t: TestDatabase;
  let server: TestServer;
  let runtime: FakeRuntime;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    runtime = new FakeRuntime();
    server = await startServer(t.db, {
      apps: {
        runtime,
        fetch: fakeGithub({
          "ys-fixtures/whoami/compose.yaml": WHOAMI,
          "ys-fixtures/catalog/apps/ys-fixtures/whoami.yaml": KIT,
          "ys-fixtures/plain/compose.yaml": WHOAMI,
          ...plainKit("plain"),
          "ys-fixtures/beside/kit.yaml": BESIDE,
          "ys-fixtures/beside/compose.yaml": WHOAMI,
          // main is at COMMIT, where the Compose file is newer than the one the kits pin.
          "ys-fixtures/pinned/kit.yaml": PINNED_KIT,
          "ys-fixtures/pinned/compose.yaml": NEWER,
          [`ys-fixtures/pinned@${PINNED}/compose.yaml`]: WHOAMI,
          "ys-fixtures/catalog/apps/ys-fixtures/pinned.yaml": PINNED_KIT.replace("name: pinned", "name: elsewhere"),
          "ys-fixtures/catalog/apps/ys-fixtures/unpinned.yaml": "kit: 1\nsource: { repo: ys-fixtures/pinned, path: compose.yaml }\n",
        }),
      },
    });
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const signedIn = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
    cookie = cookieHeader(signedIn);
  });
  afterAll(async () => {
    await server?.close();
    await t?.destroy();
  });

  const api = (path: string, init: RequestInit = {}) => server.request(path, { ...init, headers: { cookie, ...(init.headers as object) } });
  const post = (path: string, body: unknown, method = "POST") => api(path, { method, body: JSON.stringify(body) });

  /** Waits until no install job is running, however slow the machine: jobs run in the background. */
  async function settled(): Promise<void> {
    for (let i = 0; i < 500; i++) {
      const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("A job didn't finish.");
  }

  async function install(link = LINK): Promise<{ name: string; jobId: string }> {
    const review = await (await post("/api/kits/preview", { kitUrl: link })).json() as any;
    const installed = await post("/api/apps", { previewId: review.previewId });
    expect(installed.status).toBe(202);
    const body = await installed.json() as any;
    for (let i = 0; i < 50; i++) {
      const job = await (await api(`/api/jobs/${body.jobId}`)).json() as any;
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return body;
  }

  it("refuses everyone but the signed-in owner, and changes nothing", async () => {
    for (const [method, path] of [["GET", "/api/apps"], ["POST", "/api/kits/preview"], ["POST", "/api/apps"], ["GET", "/api/engine"], ["DELETE", "/api/apps/x/data"]]) {
      const response = await server.request(path!, { method, body: method === "GET" ? undefined : "{}" });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(await t.db.select().from(app)).toEqual([]);
  });

  it("reviews an app without showing generated secrets, then installs it", async () => {
    const response = await post("/api/kits/preview", { kitUrl: LINK });
    expect(response.status).toBe(200);
    const text = await response.text();
    const review = JSON.parse(text);
    expect(review).toMatchObject({ name: "whoami", title: "Who Am I", ok: true, origin: `http://whoami.${new URL(server.publicUrl).host}`, outbound: ["example.com"], interface: { service: "web", port: 80 } });
    expect(review.source).toMatchObject({ repo: "ys-fixtures/whoami", commit: COMMIT });
    expect(review.kit).toEqual({
      source: `https://github.com/ys-fixtures/catalog/blob/${COMMIT}/apps/ys-fixtures/whoami.yaml`,
      repo: "ys-fixtures/catalog",
      path: "apps/ys-fixtures/whoami.yaml",
      commit: COMMIT,
      read: { read: "anonymous" },
    });
    expect(review.settings.find((s: { name: string }) => s.name === "API_TOKEN")).toMatchObject({ secret: true, generated: true, set: true });
    expect(text).not.toContain("published-default-token");
    expect(review.warning).toMatch(/trusts it/);

    const installed = await post("/api/apps", { previewId: review.previewId });
    expect(installed.status).toBe(202);
    const { jobId } = await installed.json() as any;
    let job;
    for (let i = 0; i < 50; i++) {
      job = await (await api(`/api/jobs/${jobId}`)).json() as any;
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job.state).toBe("succeeded");

    const applied = runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!;
    expect(applied).toMatchObject({ project: "ys-whoami", egress: ["example.com"], interface: { service: "web", port: 80 }, limits: { web: { memory: 64 * 1024 ** 2, cpus: 0.5 } } });
    expect(applied.pins).toEqual({ "traefik/whoami:latest": "sha256:aaa", "ubuntu/squid:latest": "sha256:bbb" });
    expect(applied.env.API_TOKEN).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(applied.env.API_TOKEN).not.toBe("published-default-token");

    const [row] = await t.db.select().from(app).where(eq(app.name, "whoami"));
    expect(row).toMatchObject({ state: "running", commit: COMMIT, repo: "ys-fixtures/whoami" });
    const stored = await t.db.select().from(appSetting).where(eq(appSetting.appId, row!.id));
    expect(JSON.stringify(stored)).not.toContain(applied.env.API_TOKEN!);
    const installedEvents = await t.db.select().from(event).where(eq(event.type, "app.installed"));
    expect(installedEvents).toHaveLength(1);
    expect(installedEvents[0]!.subjectAppId).toBe(row!.id);
  });

  it("lists the app and shows its details without secret values", async () => {
    const list = await (await api("/api/apps")).json() as any;
    expect(list.apps).toEqual([expect.objectContaining({ name: "whoami", state: "running", hasInterface: true, pendingRequests: 0 })]);
    const text = await (await api("/api/apps/whoami")).text();
    const detail = JSON.parse(text);
    const token = detail.settings.find((s: { name: string }) => s.name === "API_TOKEN");
    expect(token).toMatchObject({ set: true, secret: true });
    expect(token.value).toBeUndefined();
    expect(text).not.toContain(runtime.calls.find((c) => c.method === "apply")!.spec!.env.API_TOKEN!);
    expect(detail.outbound).toEqual([expect.objectContaining({ host: "example.com", source: "kit" })]);
  });

  it("refuses to install an app twice", async () => {
    const response = await post("/api/kits/preview", { kitUrl: LINK });
    expect(response.status).toBe(409);
    expect((await response.json() as any).error).toBe("already_installed");
  });

  it("changes apps only from Your Space's own pages, not from an app's", async () => {
    const host = new URL(server.publicUrl).host;
    const calls = runtime.calls.length;
    // An app's page is on a name under Your Space's, so the browser sends the owner's cookie from it.
    // A form or a no-cors fetch needs no preflight, and sends no content type and no body.
    for (const origin of [`http://whoami.${host}`, "null", "https://elsewhere.example"]) {
      for (const [method, path] of [["POST", "/api/apps/whoami/remove"], ["POST", "/api/apps/whoami/start"], ["DELETE", "/api/apps/whoami/outbound/example.com"]]) {
        const response = await api(path!, { method, headers: { origin } });
        expect(response.status, `${method} ${path} from ${origin}`).toBe(403);
        expect(await response.json()).toEqual({ error: "forbidden", message: "Manage apps from Your Space itself." });
      }
    }
    // Without an Origin header, as from a client that isn't a browser on Your Space's page.
    expect((await send(`${server.url}/api/apps/whoami/remove`, "POST", new Headers({ cookie, host }), undefined)).status).toBe(403);
    expect(runtime.calls.length).toBe(calls);
    expect(await t.db.select({ desired: app.desired, removedAt: app.removedAt }).from(app).where(eq(app.name, "whoami"))).toEqual([{ desired: "running", removedAt: null }]);

    // Reading needs no Origin: a browser shows the answer only to Your Space's own pages.
    expect((await api("/api/apps/whoami", { headers: { origin: `http://whoami.${host}` } })).status).toBe(200);
    // Your Space's page sends the same bodyless POST with its own origin, and it works.
    expect((await api("/api/apps/whoami/start", { method: "POST" })).status).toBe(202);
    await settled();
  });

  it("turns blocked hosts into access requests; approving opens one host, dismissing keeps it quiet", async () => {
    runtime.denied.set("ys-whoami", [
      { host: "api.openai.com", attempts: 3, lastSeen: new Date().toISOString() },
      { host: "tracker.example", attempts: 1, lastSeen: new Date().toISOString() },
      { host: "example.com", attempts: 1, lastSeen: new Date().toISOString() },
    ]);
    await server.apps!.reconcile();
    let detail = await (await api("/api/apps/whoami")).json() as any;
    expect(detail.requests.map((r: { host: string }) => r.host).sort()).toEqual(["api.openai.com", "tracker.example"]);
    const openai = detail.requests.find((r: { host: string }) => r.host === "api.openai.com");
    const tracker = detail.requests.find((r: { host: string }) => r.host === "tracker.example");
    expect(openai.attempts).toBe(3);

    expect((await post(`/api/apps/whoami/requests/${tracker.id}/dismiss`, {})).status).toBe(204);
    const approved = await post(`/api/apps/whoami/requests/${openai.id}/approve`, {});
    expect(approved.status).toBe(202);
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.egress!.sort()).toEqual(["api.openai.com", "example.com"]);

    await server.apps!.reconcile();
    detail = await (await api("/api/apps/whoami")).json() as any;
    expect(detail.requests).toEqual([expect.objectContaining({ host: "tracker.example", state: "dismissed" })]);
    expect((await api("/api/apps")).ok).toBe(true);
    const events = (await t.db.select().from(event)).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["app.outbound_approved", "app.request_dismissed"]));
  });

  it("restarts the app with changed settings, and refuses derived or unknown ones", async () => {
    const changed = await post("/api/apps/whoami/settings", { values: { GREETING: "hi there" } }, "PUT");
    expect(changed.status).toBe(202);
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.env.GREETING).toBe("hi there");
    // A template setting follows the value it uses, and can't be changed itself.
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.env.PAGE).toBe("hi there from whoami");
    expect((await post("/api/apps/whoami/settings", { values: { PAGE: "x" } }, "PUT")).status).toBe(400);
    expect((await post("/api/apps/whoami/settings", { values: { NOPE: "x" } }, "PUT")).status).toBe(400);
  });

  it("changes limits within bounds", async () => {
    expect((await post("/api/apps/whoami/limits", { limits: { web: { memory: 1024 } } }, "PUT")).status).toBe(400);
    expect((await post("/api/apps/whoami/limits", { limits: { web: { memory: 128 * 1024 ** 2, cpus: 2 } } }, "PUT")).status).toBe(202);
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.limits).toEqual({ web: { memory: 128 * 1024 ** 2, cpus: 2 } });
  });

  it("starts apps that should run and don't, and ends interrupted jobs as failed", async () => {
    runtime.running.delete("ys-whoami");
    const before = runtime.calls.filter((c) => c.method === "apply").length;
    await server.apps!.reconcile();
    await settled();
    expect(runtime.calls.filter((c) => c.method === "apply").length).toBe(before + 1);

    // While Your Space is being stopped, stopped apps are left stopped.
    runtime.running.delete("ys-whoami");
    runtime.stopping = true;
    const during = runtime.calls.length;
    await server.apps!.reconcile();
    expect(runtime.calls.length).toBe(during);
    runtime.stopping = false;
    await server.apps!.reconcile();
    await settled();

    const [row] = await t.db.select().from(app).where(eq(app.name, "whoami"));
    await t.db.insert(installJob).values({ appId: row!.id, kind: "apply" });
    await server.apps!.recoverJobs();
    const jobs = await t.db.select().from(installJob).where(eq(installJob.state, "running"));
    expect(jobs).toEqual([]);
  });

  it("shows the engine and each app's use", async () => {
    const engine = await (await api("/api/engine")).json() as any;
    expect(engine).toMatchObject({ reachable: true, cpus: 4, apps: [expect.objectContaining({ name: "whoami", memory: 20 * 1024 ** 2 })] });
  });

  it("removes an app but keeps its data, offers to reuse it, and deletes it only when confirmed", async () => {
    expect((await post("/api/apps/whoami/remove", {})).status).toBe(202);
    await settled();
    expect(runtime.calls.at(-1)).toEqual({ method: "down", project: "ys-whoami" });
    let list = await (await api("/api/apps")).json() as any;
    expect(list.apps).toEqual([]);
    expect(list.retained).toEqual([expect.objectContaining({ name: "whoami" })]);
    const [kept] = await t.db.select().from(appSetting).where(eq(appSetting.name, "API_TOKEN"));
    expect(kept!.value).not.toBeNull();

    const review = await (await post("/api/kits/preview", { kitUrl: LINK })).json() as any;
    expect(review.retained).toBe(true);
    expect((await post("/api/apps", { previewId: review.previewId })).status).toBe(409);
    const reused = await post("/api/apps", { previewId: review.previewId, reuseData: true });
    expect(reused.status).toBe(202);
    await settled();
    const token = runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.env.API_TOKEN;
    expect(token).toBe(decrypt(TEST_DATA_KEY, kept!.value!));

    await post("/api/apps/whoami/remove", {});
    await settled();
    expect((await api("/api/apps/whoami/data", { method: "DELETE", body: JSON.stringify({ confirm: "nope" }) })).status).toBe(400);
    expect((await api("/api/apps/whoami/data", { method: "DELETE", body: JSON.stringify({ confirm: "whoami" }) })).status).toBe(204);
    expect(runtime.calls.at(-1)).toEqual({ method: "deleteVolumes", project: "ys-whoami" });
    list = await (await api("/api/apps")).json() as any;
    expect(list.retained).toEqual([]);
    expect(await t.db.select().from(appAccessRequest)).toEqual([]);
  });

  it("gives the app only the environment its kit defines, and takes the interface only from the kit", async () => {
    const review = await (await post("/api/kits/preview", { kitUrl: kitLink("plain") })).json() as any;
    expect(review).toMatchObject({ ok: true, name: "plain", title: "plain", interface: { service: "web", port: 80 }, outbound: [], settings: [] });
    // The file's variables have defaults, which the app gets: none is a setting, or generated.
    expect(runtime.calls.filter((c) => c.method === "check").at(-1)!.spec!.env).toEqual({});
  });

  it("refuses a file that needs a variable its kit doesn't define", async () => {
    const before = runtime.variables;
    runtime.variables = [...before, { name: "TOKEN", required: false, default: "", unset: true }, { name: "NEEDED", required: true, default: "" }];
    try {
      const review = await (await post("/api/kits/preview", { kitUrl: kitLink("plain") })).json() as any;
      expect(review.ok).toBe(false);
      expect(review.refusals).toEqual([
        { service: "", setting: "env", reason: "The kit doesn't define NEEDED, which the Compose file needs. Add it to the kit's env." },
        { service: "", setting: "env", reason: "The kit doesn't define TOKEN, which the Compose file needs. Add it to the kit's env." },
      ]);
      const refused = await post("/api/apps", { previewId: review.previewId });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "refused" });
    } finally {
      runtime.variables = before;
    }
  });

  it("resolves a kit's branch link to its commit, and reads the Compose file at the commit the kit pins", async () => {
    // The kit's link names main, which resolves to its commit now; the kit pins an older Compose commit.
    for (const [kitUrl, name, kitRepo, kitPath] of [
      ["https://github.com/ys-fixtures/pinned/blob/main/kit.yaml", "pinned", "ys-fixtures/pinned", "kit.yaml"],
      [kitLink("pinned"), "elsewhere", "ys-fixtures/catalog", "apps/ys-fixtures/pinned.yaml"],
    ] as const) {
      const review = await (await post("/api/kits/preview", { kitUrl })).json() as any;
      expect(review, kitUrl).toMatchObject({
        name,
        source: { repo: "ys-fixtures/pinned", path: "compose.yaml", commit: PINNED, pinnedLink: `https://github.com/ys-fixtures/pinned/blob/${PINNED}/compose.yaml` },
        kit: { source: `https://github.com/${kitRepo}/blob/${COMMIT}/${kitPath}`, repo: kitRepo, path: kitPath, commit: COMMIT },
      });
      expect((await post("/api/apps", { previewId: review.previewId })).status).toBe(202);
      await settled();
      const [row] = await t.db.select().from(app).where(eq(app.name, name));
      // The record keeps both exact commits, and the Compose file read at the pinned one.
      expect(row).toMatchObject({ commit: PINNED, compose: WHOAMI, kitSource: review.kit.source, kit: { source: { repo: "ys-fixtures/pinned", path: "compose.yaml", commit: PINNED } } });
      expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.compose).toBe(WHOAMI);
      await post(`/api/apps/${name}/remove`, {});
      await settled();
      await api(`/api/apps/${name}/data`, { method: "DELETE", body: JSON.stringify({ confirm: name }) });
    }
  });

  it("refuses a kit that doesn't pin its Compose file: no source, or a source without its commit", async () => {
    const beside = await post("/api/kits/preview", { kitUrl: "https://github.com/ys-fixtures/beside/blob/main/kit.yaml" });
    expect(beside.status).toBe(400);
    expect(await beside.json()).toMatchObject({ error: "source", message: expect.stringMatching(/names no Compose file\. Add source/) });
    const unpinned = await post("/api/kits/preview", { kitUrl: kitLink("unpinned") });
    expect(unpinned.status).toBe(400);
    expect(await unpinned.json()).toMatchObject({ error: "source", message: expect.stringMatching(/source has no commit\. Add source\.commit/) });
    expect(await t.db.select().from(app).where(eq(app.name, "beside"))).toEqual([]);
  });

  it("refuses a bare Compose link, and says what a kit is; the old Compose-link review is gone", async () => {
    const response = await post("/api/kits/preview", { kitUrl: COMPOSE_LINK });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "kit_required", message: expect.stringMatching(/not a Your Space kit.*Give the link to the app's kit/) });
    expect((await post("/api/kits/preview", { kitUrl: "https://example.com/kit.yaml" })).status).toBe(400);
    // A kit GitHub doesn't show this machine, as in a private repository, needs the GitHub connection (journey 015).
    const hidden = await post("/api/kits/preview", { kitUrl: "https://github.com/ys-fixtures/private-kits/blob/main/kit.yaml" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ error: "not_connected", message: expect.stringMatching(/on public GitHub\. If the repository is private, connect GitHub/) });
    expect((await post("/api/kits/preview", {})).status).toBe(400);
    expect((await post("/api/apps/preview", { link: COMPOSE_LINK })).status).toBe(404);
  });

  describe("gate", () => {
    let gateUrl: string;
    let close: () => void;
    beforeAll(async () => {
      await install();
      const gate = createGate({ db: t.db, publicUrl: server.publicUrl, authSecret: TEST_SECRET, handoffs: server.handoffs! });
      await new Promise<void>((resolve) => {
        const listener = gate.listen(0, "127.0.0.1", () => {
          gateUrl = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
          close = () => listener.close();
          resolve();
        });
      });
    });
    afterAll(() => close?.());

    const appHost = () => `whoami.${new URL(server.publicUrl).host}`;
    const gate = (path: string, headers: Record<string, string> = {}) =>
      send(`${gateUrl}${path}`, "GET", new Headers({ "x-forwarded-host": appHost(), "x-forwarded-uri": "/inbox?x=1", ...headers }), undefined);

    it("sends a visitor without a pass to Your Space, then lets the owner in with one", async () => {
      const first = await gate("/gate");
      expect(first.status).toBe(302);
      expect(first.headers.get("location")).toBe(`${server.publicUrl}/api/apps/whoami/open?return=%2Finbox%3Fx%3D1`);

      const signedOut = await server.request("/api/apps/whoami/open?return=/inbox");
      expect(signedOut.status).toBe(302);
      expect(signedOut.headers.get("location")).toBe(`${server.publicUrl}/`);

      const open = await api("/api/apps/whoami/open?return=/inbox");
      expect(open.status).toBe(302);
      const handoff = new URL(open.headers.get("location")!);
      expect(handoff.host).toBe(appHost());
      expect(handoff.pathname).toBe("/__ys/handoff");

      expect(open.headers.get("referrer-policy")).toBe("no-referrer");
      const handed = await gate(`/handoff${handoff.search}`);
      expect(handed.status).toBe(302);
      expect(handed.headers.get("referrer-policy")).toBe("no-referrer");
      expect(handed.headers.get("location")).toBe("/inbox");
      const setCookie = handed.headers.get("set-cookie")!;
      expect(setCookie).toMatch(/^ys-pass=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
      expect(setCookie).not.toMatch(/domain/i);
      // A code works once.
      expect((await gate(`/handoff${handoff.search}`)).status).toBe(403);

      const pass = setCookie.split(";")[0]!;
      const through = await gate("/gate", { cookie: `app=1; ${pass}` });
      expect(through.status).toBe(200);
      expect(through.headers.get("x-ys-upstream")).toBe("ys-whoami-ui:80");

      // The pass names its app: another app's host doesn't accept it.
      expect((await gate("/gate", { cookie: pass, "x-forwarded-host": `other.${new URL(server.publicUrl).host}` })).status).toBe(404);

      // Signing out of Your Space closes the app.
      await t.db.delete(session);
      expect((await gate("/gate", { cookie: pass })).status).toBe(302);
    });

    // Behind the owner's proxy, Caddy sends the gate every name that isn't exactly Your Space's own.
    it.each(["127.0.0.1:8080", "your-space:8080", "attacker.example", "evilspace.localhost", "", "own"])(
      "answers the name %j, which is neither Your Space's nor an app's, with the API's wrong_host answer",
      async (given) => {
        const host = given === "own" ? new URL(server.publicUrl).host : given;
        const api = await (await server.request("/api/status", { headers: { host: "127.0.0.1:8080" } })).json() as { error: string; message: string };
        expect(api.message).toContain(`set up for ${server.publicUrl}`);

        const page = await gate("/gate", { "x-forwarded-host": host, "x-forwarded-uri": "/" });
        expect(page.status).toBe(421);
        expect(page.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(page.headers.get("cache-control")).toBe("no-store");
        expect(await page.text()).toBe(api.message);

        const call = await gate("/gate", { "x-forwarded-host": host, "x-forwarded-uri": "/api/status" });
        expect(call.status).toBe(421);
        expect(await call.json()).toEqual(api);

        const handoff = await gate("/handoff?code=x", { "x-forwarded-host": host });
        expect(handoff.status).toBe(421);
        expect(await handoff.text()).toBe(api.message);
      },
    );

    it("keeps 'no app' for a name under Your Space's where no app is installed", async () => {
      const host = new URL(server.publicUrl).host;
      for (const name of [`nope.${host}`, `a.b.${host}`, `1x.${host}`]) {
        const response = await gate("/gate", { "x-forwarded-host": name });
        expect(response.status, name).toBe(404);
        expect(await response.text()).toBe("There is no app at this address.");
      }
      expect((await gate("/handoff?code=x", { "x-forwarded-host": `nope.${host}` })).status).toBe(403);
    });

    it("allows certificates only for Your Space and its installed apps", async () => {
      const host = new URL(server.publicUrl).hostname;
      expect((await send(`${gateUrl}/tls-ask?domain=whoami.${host}`, "GET", new Headers(), undefined)).status).toBe(200);
      expect((await send(`${gateUrl}/tls-ask?domain=${host}`, "GET", new Headers(), undefined)).status).toBe(200);
      expect((await send(`${gateUrl}/tls-ask?domain=nope.${host}`, "GET", new Headers(), undefined)).status).toBe(404);
      expect((await send(`${gateUrl}/tls-ask?domain=evil.example`, "GET", new Headers(), undefined)).status).toBe(404);
    });
  });

});

describe("handoff codes", () => {
  it("notice a pane that keeps starting over, as when the browser blocks its cookies", () => {
    const handoffs = new Handoffs();
    expect([1, 2, 3].map(() => handoffs.looping("sure", "s1"))).toEqual([false, false, false]);
    expect(handoffs.looping("sure", "s1")).toBe(true);
    expect(handoffs.looping("twenty", "s1")).toBe(false);
  });

  it("expire, work once, and only for their app", () => {
    const handoffs = new Handoffs();
    const code = handoffs.issue("sure", "s1");
    expect(handoffs.consume(code, "twenty")).toBeUndefined();
    const again = handoffs.issue("sure", "s1");
    expect(handoffs.consume(again, "sure")).toBe("s1");
    expect(handoffs.consume(again, "sure")).toBeUndefined();
  });
});
