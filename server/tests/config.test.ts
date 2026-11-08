// T006: configuration is validated at startup with messages that say what to fix. Which key the
// owner writes picks the setup; everything else is derived (constitution principle II).
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const SECRETS = {
  DATABASE_URL: "postgres://yourspace:secret@postgres:5432/yourspace",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig({ ...SECRETS, ...env });
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

describe("loadConfig: which setup", () => {
  it("with nothing set, serves this machine at http://localhost", () => {
    expect(loadConfig(SECRETS)).toMatchObject({ mode: "local", publicUrl: "http://localhost" });
  });

  it("treats an empty line the same as no line", () => {
    expect(loadConfig({ ...SECRETS, YS_DOMAIN: "", YS_PROXY_URL: " ", YS_PORT: "" })).toMatchObject({
      mode: "local",
      publicUrl: "http://localhost",
    });
  });

  it.each([
    ["8081", "http://localhost:8081"],
    ["80", "http://localhost"],
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
    ["https://space.example.com/", "https://space.example.com"],
    ["https://space.example.com:8443", "https://space.example.com:8443"],
    ["https://space.example.com:443", "https://space.example.com"],
    ["https://Space.Example.com", "https://space.example.com"],
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
  ])("refuses the unknown setting %s, so a typo can't pick the wrong setup", (key, message) => {
    expect(only({ [key]: "space.example.com" })).toMatch(message);
  });

  it.each([
    ["YS_PUBLIC_URL", /YS_PUBLIC_URL is no longer used\. Instead, write YS_DOMAIN=space\.example\.com for your own domain/],
    ["YS_BIND_ADDRESS", /YS_BIND_ADDRESS is no longer used\. Remove it: YS_DOMAIN opens/],
    ["YS_SITE_ADDRESS", /YS_SITE_ADDRESS is no longer used\. Remove it/],
    ["YS_TRUSTED_PROXIES", /YS_TRUSTED_PROXIES is no longer used\. Remove it/],
  ])("refuses the retired setting %s and says what replaces it", (key, message) => {
    expect(only({ [key]: "x" })).toMatch(message);
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

  it("names a missing database URL and secret", () => {
    const found = problems({ DATABASE_URL: undefined, BETTER_AUTH_SECRET: undefined });
    expect(found.join("\n")).toMatch(/DATABASE_URL is not set/);
    expect(found.join("\n")).toMatch(/BETTER_AUTH_SECRET is not set\. Generate one with: openssl rand -base64 32/);
  });
});
