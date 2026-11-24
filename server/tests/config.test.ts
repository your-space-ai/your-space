// T006: configuration is validated at startup with messages that say what to fix. Which key the
// owner writes picks the setup; everything else is derived (constitution principle II).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

/** An empty ys-secrets volume, so no test depends on the machine it runs on. */
const NO_SECRETS = mkdtempSync(join(tmpdir(), "ys-config-test-"));

const SECRETS = {
  DATABASE_URL: "postgres://yourspace:secret@postgres:5432/yourspace",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  YS_DATA_KEY: "a-test-data-key-that-is-long-enough-0123456789",
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig({ ...SECRETS, ...env }, { secretsDir: NO_SECRETS });
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

function only(env: Record<string, string | undefined>): string {
  const found = problems(env);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("loadConfig: YS_PROXY_URL's form", () => {
  it.each(["https://Space.example.com", "https://space.example.com/", "https://space.example.com:443"])(
    "refuses %s, which Caddy couldn't match against requests",
    (value) => {
      expect(() => loadConfig({ ...SECRETS, YS_PROXY_URL: value })).toThrow(/must be written exactly as https:\/\/space\.example\.com/);
    },
  );

  it("accepts the origin as written, including another port", () => {
    expect(loadConfig({ ...SECRETS, YS_PROXY_URL: "https://space.example.com:8443" }).publicUrl).toBe("https://space.example.com:8443");
  });
});

describe("loadConfig: which setup", () => {
  it("with nothing set, serves this machine at http://space.localhost", () => {
    expect(loadConfig(SECRETS)).toMatchObject({ mode: "local", publicUrl: "http://space.localhost" });
  });

  it("treats an empty line the same as no line", () => {
    expect(loadConfig({ ...SECRETS, YS_DOMAIN: "", YS_PROXY_URL: " ", YS_PORT: "" })).toMatchObject({
      mode: "local",
      publicUrl: "http://space.localhost",
    });
  });

  it.each([
    ["8081", "http://space.localhost:8081"],
    ["80", "http://space.localhost"],
  ])("with YS_PORT=%s, serves this machine at %s", (port, url) => {
    expect(loadConfig({ ...SECRETS, YS_PORT: port })).toMatchObject({ mode: "local", publicUrl: url });
  });

  it.each([
    ["space.example.com", "https://space.example.com"],
    ["Space.Example.COM", "https://space.example.com"],
    [" space.example.com ", "https://space.example.com"],
    ["xn--bcher-kva.example", "https://xn--bcher-kva.example"],
  ])("with YS_DOMAIN=%s, serves %s", (domain, url) => {
    expect(loadConfig({ ...SECRETS, YS_DOMAIN: domain })).toMatchObject({ mode: "domain", publicUrl: url });
  });

  it.each([
    ["https://myserver.tail1234.ts.net", "https://myserver.tail1234.ts.net"],
    ["https://space.example.com:8443", "https://space.example.com:8443"],
  ])("with YS_PROXY_URL=%s, serves %s", (proxyUrl, url) => {
    expect(loadConfig({ ...SECRETS, YS_PROXY_URL: proxyUrl })).toMatchObject({ mode: "proxy", publicUrl: url });
  });

  it("accepts YS_PORT behind a proxy, where it moves the local port the proxy forwards to", () => {
    expect(loadConfig({ ...SECRETS, YS_PROXY_URL: "https://space.example.com", YS_PORT: "8090" })).toMatchObject({
      mode: "proxy",
      publicUrl: "https://space.example.com",
    });
  });

  it("refuses both YS_DOMAIN and YS_PROXY_URL", () => {
    expect(only({ YS_DOMAIN: "space.example.com", YS_PROXY_URL: "https://space.example.com" })).toMatch(
      /either YS_DOMAIN .* or YS_PROXY_URL .*, not both/,
    );
  });
});

describe("loadConfig: refused values", () => {
  it.each([
    ["https://space.example.com", /just the name, like space\.example\.com, without "https:\/\/"/],
    ["space.example.com:8443", /without "https:\/\/", a port, or a path/],
    ["space.example.com/app", /without "https:\/\/", a port, or a path/],
    ["off", /isn't a domain name/],
    ["space..example.com", /isn't a domain name/],
    ["-space.example.com", /isn't a domain name/],
    ["space_1.example.com", /isn't a domain name/],
    ["192.168.1.20", /not an IP address/],
    ["localhost", /for this machine, leave YS_DOMAIN out/],
    ["space.localhost", /for this machine, leave YS_DOMAIN out/],
    ["myserver.tail1234.ts.net", /for Tailscale, write YS_PROXY_URL=https:\/\/… instead/],
    ["nas.local", /can't get a public certificate/],
    ["router.home.arpa", /can't get a public certificate/],
    ["space.internal", /can't get a public certificate/],
  ])("refuses YS_DOMAIN=%s", (domain, message) => {
    expect(only({ YS_DOMAIN: domain })).toMatch(message);
  });

  it("refuses YS_PORT with your own domain, which needs ports 80 and 443", () => {
    expect(only({ YS_DOMAIN: "space.example.com", YS_PORT: "8081" })).toMatch(/YS_PORT doesn't apply to your own domain/);
  });

  it.each([
    ["http://192.168.1.20", /must start with https:\/\//],
    ["http://localhost:8080", /must start with https:\/\//],
    ["space.example.com", /isn't a valid address/],
    ["https://space.example.com/app", /no path, query, or credentials/],
    ["https://space.example.com/?a=1", /no path, query, or credentials/],
    ["https://user:pass@space.example.com", /no path, query, or credentials/],
  ])("refuses YS_PROXY_URL=%s", (proxyUrl, message) => {
    expect(only({ YS_PROXY_URL: proxyUrl })).toMatch(message);
  });

  it("leaves a YS_PROXY_URL it can't read out of the message, since it may hold a password", () => {
    const message = only({ YS_PROXY_URL: "https://user:private-password@space.example.com:bad" });
    expect(message).toMatch(/isn't a valid address/);
    expect(message).not.toMatch(/private-password/);
  });

  it.each(["0", "65536", "80a", "-1", "8.5"])("refuses YS_PORT=%s", (port) => {
    expect(only({ YS_PORT: port })).toMatch(/YS_PORT must be a port number from 1 to 65535/);
  });
});

describe("loadConfig: setting names", () => {
  it.each([
    ["YS_DOMIAN", /YS_DOMIAN isn't a setting\. Did you mean YS_DOMAIN\?/],
    ["ys_domain", /ys_domain isn't a setting\. Did you mean YS_DOMAIN\?/],
    ["YS_PROXYURL", /Did you mean YS_PROXY_URL\?/],
    ["YS_PORTS", /Did you mean YS_PORT\?/],
    ["YS_SOMETHING_ELSE", /YS_SOMETHING_ELSE isn't a setting\. Remove it from \.env\./],
    // No kit directory since 2026-11-23 (decisions: Alpha scope).
    ["YS_KITS_REPOSITORY", /YS_KITS_REPOSITORY isn't a setting\. Remove it from \.env\./],
  ])("refuses the unknown setting %s, so a typo can't pick the wrong setup", (key, message) => {
    expect(only({ [key]: "space.example.com" })).toMatch(message);
  });

  it("ignores settings that aren't Your Space's", () => {
    expect(problems({ PATH: "/usr/bin", POSTGRES_PASSWORD: "x", HOME: "/root", YS_VERSION: "1.0.0" })).toEqual([]);
  });

  it("lists every problem at once", () => {
    const found = problems({ YS_DOMIAN: "x", YS_PORT: "abc", DATABASE_URL: "mysql://x", BETTER_AUTH_SECRET: "short" });
    expect(found).toHaveLength(4);
    expect(found.join("\n")).toMatch(/Did you mean YS_DOMAIN/);
    expect(found.join("\n")).toMatch(/YS_PORT must be a port number/);
    expect(found.join("\n")).toMatch(/DATABASE_URL must be a postgres:\/\/ URL/);
    expect(found.join("\n")).toMatch(/BETTER_AUTH_SECRET must be at least 32 characters/);
  });

  it("names a missing database URL", () => {
    expect(only({ DATABASE_URL: undefined })).toMatch(/DATABASE_URL is not set/);
  });

  it.each(["BETTER_AUTH_SECRETS", "AUTH_SECRET"])("refuses %s, which Better Auth would read in place of the secret", (key) => {
    expect(only({ [key]: "x".repeat(40) })).toMatch(new RegExp(`${key} isn't a Your Space setting\\. Write BETTER_AUTH_SECRET`));
  });
});

describe("loadConfig: secrets", () => {
  function volume(auth?: string, password?: string, dataKey: string | undefined = auth === undefined ? undefined : "d".repeat(43)): string {
    const dir = mkdtempSync(join(tmpdir(), "ys-config-secrets-"));
    if (dataKey !== undefined) {
      mkdirSync(join(dir, "data"));
      writeFileSync(join(dir, "data", "key"), `${dataKey}\n`);
    }
    if (auth !== undefined) {
      mkdirSync(join(dir, "auth"));
      writeFileSync(join(dir, "auth", "secret"), `${auth}\n`);
    }
    if (password !== undefined) {
      mkdirSync(join(dir, "postgres"));
      writeFileSync(join(dir, "postgres", "password"), `${password}\n`);
    }
    return dir;
  }
  const COMPOSE_URL = "postgres://yourspace@postgres:5432/yourspace";
  const GENERATED_AUTH = "g".repeat(43);

  it("reads the generated secrets from ys-secrets when .env sets none", () => {
    const config = loadConfig({ DATABASE_URL: COMPOSE_URL }, { secretsDir: volume(GENERATED_AUTH, "generatedpw") });
    expect(config.authSecret).toBe(GENERATED_AUTH);
    expect(new URL(config.databaseUrl).password).toBe("generatedpw");
  });

  it("uses values set in .env over the generated ones", () => {
    const config = loadConfig(
      { DATABASE_URL: COMPOSE_URL, BETTER_AUTH_SECRET: "e".repeat(40), POSTGRES_PASSWORD: "frometc" },
      { secretsDir: volume(GENERATED_AUTH, "generatedpw") },
    );
    expect(config.authSecret).toBe("e".repeat(40));
    expect(new URL(config.databaseUrl).password).toBe("frometc");
  });

  it("passes a password with URL characters to PostgreSQL unchanged", () => {
    const password = "p@ss/w#rd:%41 ?&=";
    const config = loadConfig({ DATABASE_URL: COMPOSE_URL, POSTGRES_PASSWORD: password }, { secretsDir: volume(GENERATED_AUTH) });
    expect(decodeURIComponent(new URL(config.databaseUrl).password)).toBe(password);
    expect(new URL(config.databaseUrl).host).toBe("postgres:5432");
  });

  it("keeps a database URL that already carries a password", () => {
    const url = "postgres://yourspace:inurl@localhost:5432/yourspace";
    expect(loadConfig({ DATABASE_URL: url, POSTGRES_PASSWORD: "ignored" }, { secretsDir: volume(GENERATED_AUTH) }).databaseUrl).toBe(url);
  });

  it("says how to get a secret that is neither in .env nor generated yet", () => {
    let found: string[] = [];
    try {
      loadConfig({ DATABASE_URL: COMPOSE_URL }, { secretsDir: volume() });
    } catch (error) {
      found = (error as ConfigError).problems;
    }
    expect(found).toHaveLength(3);
    expect(found[0]).toMatch(/POSTGRES_PASSWORD isn't set in \.env, and Your Space hasn't generated the database password yet\. Start it with docker compose up -d/);
    expect(found[1]).toMatch(/BETTER_AUTH_SECRET isn't set in \.env, and Your Space hasn't generated the auth secret yet/);
    expect(found[2]).toMatch(/YS_DATA_KEY isn't set in \.env, and Your Space hasn't generated the data key yet/);
  });

  it("reads the data key, and the previous one a replacement left, from ys-secrets", () => {
    const dir = volume(GENERATED_AUTH, "generatedpw", "k".repeat(43));
    expect(loadConfig({ DATABASE_URL: COMPOSE_URL }, { secretsDir: dir }).previousDataKey).toBeUndefined();
    writeFileSync(join(dir, "data", "previous"), `${"p".repeat(43)}\n`);
    const config = loadConfig({ DATABASE_URL: COMPOSE_URL, YS_DATA_KEY: "e".repeat(40) }, { secretsDir: dir });
    expect(config.dataKey).toBe("e".repeat(40));
    expect(config.previousDataKey).toBe("p".repeat(43));
  });

  it("stops when the previous data key is there but can't be read, so its settings aren't left behind", () => {
    const dir = volume(GENERATED_AUTH, "generatedpw", "k".repeat(43));
    mkdirSync(join(dir, "data", "previous"));
    expect(() => loadConfig({ DATABASE_URL: COMPOSE_URL }, { secretsDir: dir })).toThrow(/The previous data key in the ys-secrets volume can't be read \(EISDIR\)/);
  });
});
