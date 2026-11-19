// The platform secrets (research R16; the data key, spec 009): a value set in .env is used as given and never copied;
// otherwise the copy in ys-secrets; otherwise, for a new installation, a generated one. A missing
// secret next to an existing database stops start-up instead of making a new one.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { describeSecrets } from "../src/commands/show-secrets.ts";
import { AUTH_SECRET, DATA_KEY, DATABASE_PASSWORD, databaseExists, forgetPreviousDataKey, PREVIOUS_DATA_KEY, SecretsError, settleSecrets } from "../src/secrets.ts";

let secretsDir: string;
let databaseDir: string;
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "ys-secrets-test-"));
  secretsDir = join(root, "secrets");
  databaseDir = join(root, "pgdata");
  mkdirSync(secretsDir);
  mkdirSync(databaseDir);
});

const settle = (env: NodeJS.ProcessEnv = {}, replace = [] as (typeof AUTH_SECRET)[]) =>
  settleSecrets({ dir: secretsDir, databaseDir, env, replace, chown: false });
const stored = (spec: typeof AUTH_SECRET) => readFileSync(join(secretsDir, spec.dir, spec.file), "utf8").trim();
/** The auth secret's and database password's outcomes; the data key has its own tests below. */
const actions = (outcomes: ReturnType<typeof settle>) =>
  outcomes.filter(({ spec }) => spec !== DATA_KEY).map(({ spec, action }) => `${spec.env}:${action}`);
const makeDatabase = (...path: string[]) => {
  mkdirSync(join(databaseDir, ...path), { recursive: true });
  writeFileSync(join(databaseDir, ...path, "PG_VERSION"), "18\n");
};

describe("settleSecrets on a new installation", () => {
  it("generates both secrets as 43-character base64url values, readable only by their users", () => {
    expect(actions(settle())).toEqual(["BETTER_AUTH_SECRET:generated", "POSTGRES_PASSWORD:generated"]);
    for (const spec of [AUTH_SECRET, DATABASE_PASSWORD]) {
      expect(stored(spec)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(statSync(join(secretsDir, spec.dir, spec.file)).mode & 0o777).toBe(spec.fileMode);
      expect(statSync(join(secretsDir, spec.dir)).mode & 0o777).toBe(spec.dirMode);
    }
    expect(stored(AUTH_SECRET)).not.toBe(stored(DATABASE_PASSWORD));
  });

  it("keeps them on every later start and never overwrites them", () => {
    settle();
    const first = [stored(AUTH_SECRET), stored(DATABASE_PASSWORD)];
    makeDatabase("18", "docker");
    expect(actions(settle())).toEqual(["BETTER_AUTH_SECRET:kept", "POSTGRES_PASSWORD:kept"]);
    expect([stored(AUTH_SECRET), stored(DATABASE_PASSWORD)]).toEqual(first);
  });

  it("uses a value set in .env as given and copies it nowhere, but still makes the empty folders PostgreSQL mounts", () => {
    const outcomes = settle({ BETTER_AUTH_SECRET: "x".repeat(40), POSTGRES_PASSWORD: "p@ss/w#rd %41" });
    expect(actions(outcomes)).toEqual(["BETTER_AUTH_SECRET:from_env", "POSTGRES_PASSWORD:from_env"]);
    expect(readdirSync(secretsDir).sort()).toEqual(["auth", "data", "postgres"]);
    for (const spec of [AUTH_SECRET, DATABASE_PASSWORD]) {
      expect(readdirSync(join(secretsDir, spec.dir))).toEqual([]);
      expect(statSync(join(secretsDir, spec.dir)).mode & 0o777).toBe(spec.dirMode);
    }
  });

  it("treats an empty line in .env as no line", () => {
    expect(actions(settle({ BETTER_AUTH_SECRET: "", POSTGRES_PASSWORD: "" }))).toEqual([
      "BETTER_AUTH_SECRET:generated",
      "POSTGRES_PASSWORD:generated",
    ]);
  });

  it.each(["  ", " leading", "trailing "])("refuses a value in .env with spaces around it (%j), since PostgreSQL would get them too", (value) => {
    expect(() => settle({ POSTGRES_PASSWORD: value })).toThrow(/POSTGRES_PASSWORD in \.env starts or ends with a space/);
    expect(readdirSync(secretsDir)).toEqual([]);
  });

  it("refuses a too-short auth secret in .env before anything starts", () => {
    expect(() => settle({ BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET in \.env must be at least 32 characters/);
  });

  it("removes a temporary file left by an interrupted start instead of failing", () => {
    mkdirSync(join(secretsDir, "auth"));
    const leftover = join(secretsDir, "auth", ".secret.1.tmp");
    writeFileSync(leftover, "half");
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(leftover, old, old);
    settle();
    expect(readdirSync(join(secretsDir, "auth"))).toEqual(["secret"]);
  });

  it("leaves a temporary file another run is still writing", () => {
    mkdirSync(join(secretsDir, "auth"));
    writeFileSync(join(secretsDir, "auth", ".secret.2.tmp"), "half");
    settle();
    expect(readdirSync(join(secretsDir, "auth")).sort()).toEqual([".secret.2.tmp", "secret"]);
  });
});

describe("settleSecrets when a secret is missing next to an existing database", () => {
  beforeEach(() => makeDatabase("18", "docker"));

  it("stops with one message naming both secrets when the whole volume is gone, and writes nothing", () => {
    let error: unknown;
    try {
      settle();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SecretsError);
    expect((error as Error).message).toMatch(/^The auth secret and the database password aren't in \.env or in the ys-secrets volume/);
    expect((error as Error).message).toContain('"Lost Secrets"');
    expect(readdirSync(secretsDir)).toEqual([]);
  });

  it("offers a new auth secret when only that one is missing", () => {
    expect(() => settle({ POSTGRES_PASSWORD: "given" })).toThrow(/docker compose run --rm secrets --new auth-secret/);
    expect(readdirSync(secretsDir)).toEqual([]);
  });

  it("stops with recovery steps for the database password", () => {
    expect(() => settle({ BETTER_AUTH_SECRET: "x".repeat(40) })).toThrow(/only accepts the password it was created with/);
    expect(readdirSync(secretsDir)).toEqual([]);
  });

  it("still starts when .env supplies both", () => {
    expect(actions(settle({ BETTER_AUTH_SECRET: "x".repeat(40), POSTGRES_PASSWORD: "given" }))).toEqual([
      "BETTER_AUTH_SECRET:from_env",
      "POSTGRES_PASSWORD:from_env",
    ]);
  });

  it("replaces a secret only when asked with --new", () => {
    settle({ POSTGRES_PASSWORD: "given" }, [AUTH_SECRET]);
    expect(stored(AUTH_SECRET)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const before = stored(AUTH_SECRET);
    expect(actions(settle({ POSTGRES_PASSWORD: "given" }, [AUTH_SECRET]))).toEqual([
      "BETTER_AUTH_SECRET:replaced",
      "POSTGRES_PASSWORD:from_env",
    ]);
    expect(stored(AUTH_SECRET)).not.toBe(before);
  });

  it("leaves a secret that .env sets as it is when asked to replace it", () => {
    expect(actions(settle({ BETTER_AUTH_SECRET: "x".repeat(40), POSTGRES_PASSWORD: "given" }, [AUTH_SECRET]))).toEqual([
      "BETTER_AUTH_SECRET:not_replaced",
      "POSTGRES_PASSWORD:from_env",
    ]);
    expect(readdirSync(join(secretsDir, "auth"))).toEqual([]);
  });
});

describe("databaseExists", () => {
  it("is false for an empty volume and for empty folders", () => {
    expect(databaseExists(databaseDir)).toBe(false);
    mkdirSync(join(databaseDir, "18", "docker"), { recursive: true });
    expect(databaseExists(databaseDir)).toBe(false);
    expect(databaseExists(join(databaseDir, "missing"))).toBe(false);
  });

  it.each([[["18", "docker"]], [["data"]], [[]]])("finds a data directory at %j, whatever the PostgreSQL version's layout", (path) => {
    makeDatabase(...path);
    expect(databaseExists(databaseDir)).toBe(true);
  });
});

describe("describeSecrets (show-secrets)", () => {
  it("shows each value and where it comes from", () => {
    settle();
    const { shown, missing } = describeSecrets({ BETTER_AUTH_SECRET: "y".repeat(40) }, secretsDir);
    expect(missing).toEqual([]);
    expect(shown).toEqual([
      { name: "BETTER_AUTH_SECRET", label: "auth secret", source: "env", value: "y".repeat(40) },
      { name: "POSTGRES_PASSWORD", label: "database password", source: "generated", value: stored(DATABASE_PASSWORD) },
      { name: "YS_DATA_KEY", label: "data key", source: "generated", value: stored(DATA_KEY) },
    ]);
  });

  it("names the settings that have no value yet", () => {
    expect(describeSecrets({}, secretsDir).missing).toEqual(["BETTER_AUTH_SECRET", "POSTGRES_PASSWORD", "YS_DATA_KEY"]);
  });
});

describe("the data key (spec 009)", () => {
  const dataKey = () => settle().find(({ spec }) => spec === DATA_KEY)!.action;

  it("is generated with the others, readable only by the server", () => {
    expect(dataKey()).toBe("generated");
    expect(stored(DATA_KEY)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(join(secretsDir, DATA_KEY.dir, DATA_KEY.file)).mode & 0o777).toBe(0o400);
    expect(dataKey()).toBe("kept");
  });

  it("is generated for an installation that already has a database, which the server then moves onto it", () => {
    settle({ BETTER_AUTH_SECRET: "x".repeat(40), POSTGRES_PASSWORD: "given" });
    makeDatabase("18", "docker");
    const outcome = settle({ BETTER_AUTH_SECRET: "x".repeat(40), POSTGRES_PASSWORD: "given" }).find(({ spec }) => spec === DATA_KEY);
    expect(outcome!.action).toBe("kept");
    // The key is lost (read-only, so it is removed rather than emptied, as a non-root user can).
    rmSync(join(secretsDir, DATA_KEY.dir, DATA_KEY.file));
    expect(settle({ BETTER_AUTH_SECRET: "x".repeat(40), POSTGRES_PASSWORD: "given" }).find(({ spec }) => spec === DATA_KEY)!.action).toBe("generated");
  });

  it("keeps the replaced key until the server has moved everything, then forgets it", () => {
    settle();
    const first = stored(DATA_KEY);
    settle({}, [DATA_KEY]);
    expect(stored(PREVIOUS_DATA_KEY)).toBe(first);
    expect(stored(DATA_KEY)).not.toBe(first);
    const second = stored(DATA_KEY);
    // A second replacement while the previous key is kept is refused, along with the other secrets
    // asked for, and changes nothing: either key may hold the settings.
    const auth = stored(AUTH_SECRET);
    expect(() => settle({}, [AUTH_SECRET, DATA_KEY])).toThrow(/--forget previous-data-key/);
    expect([stored(AUTH_SECRET), stored(DATA_KEY), stored(PREVIOUS_DATA_KEY)]).toEqual([auth, second, first]);
    expect(forgetPreviousDataKey(secretsDir)).toBe(true);
    expect(readdirSync(join(secretsDir, DATA_KEY.dir))).toEqual(["key"]);
    expect(forgetPreviousDataKey(secretsDir)).toBe(false);
    // Once it is forgotten, the data key can be replaced again.
    settle({}, [DATA_KEY]);
    expect(stored(PREVIOUS_DATA_KEY)).toBe(second);
  });

  it("is left to .env when set there", () => {
    const outcome = settle({ YS_DATA_KEY: "k".repeat(40) }, [DATA_KEY]).find(({ spec }) => spec === DATA_KEY);
    expect(outcome!.action).toBe("not_replaced");
    expect(() => settle({ YS_DATA_KEY: "short" })).toThrow(/YS_DATA_KEY in \.env must be at least 32 characters/);
  });
});
