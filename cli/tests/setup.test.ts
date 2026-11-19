import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../server/src/config.ts";
import { CliError } from "../src/errors.ts";
import { address, appAddress, checkDomain, checkPort, checkProxyUrl, chooseSetup, setupFromEnv, setupLines, setupPorts } from "../src/setup.ts";
import { Ui } from "../src/ui.ts";

const script = new Ui({ json: true, verbose: false, yes: false });

describe("setups", () => {
  it("reads each setup from .env and writes it back as the guide's lines", () => {
    const cases = [
      [{}, { kind: "this-machine", port: 80 }, { YS_DOMAIN: null, YS_PROXY_URL: null, YS_PORT: null }],
      [{ YS_PORT: "8081" }, { kind: "this-machine", port: 8081 }, { YS_DOMAIN: null, YS_PROXY_URL: null, YS_PORT: "8081" }],
      [{ YS_DOMAIN: "space.example.com" }, { kind: "domain", domain: "space.example.com" }, { YS_DOMAIN: "space.example.com", YS_PROXY_URL: null, YS_PORT: null }],
      [
        { YS_PROXY_URL: "https://box.tail1.ts.net", YS_PORT: "8090" },
        { kind: "proxy", url: "https://box.tail1.ts.net", port: 8090 },
        { YS_DOMAIN: null, YS_PROXY_URL: "https://box.tail1.ts.net", YS_PORT: "8090" },
      ],
    ] as const;
    for (const [env, setup, lines] of cases) {
      expect(setupFromEnv(env)).toEqual(setup);
      expect(setupLines(setup)).toEqual(lines);
    }
    expect(() => setupFromEnv({ YS_DOMAIN: "a.example.com", YS_PROXY_URL: "https://b.example.com" })).toThrow(CliError);
  });

  it("derives Your Space's and each app's address, and the ports it publishes", () => {
    expect(address({ kind: "this-machine", port: 80 })).toBe("http://space.localhost");
    expect(appAddress({ kind: "this-machine", port: 8081 }, "sure")).toBe("http://sure.space.localhost:8081");
    expect(appAddress({ kind: "domain", domain: "space.example.com" }, "sure")).toBe("https://sure.space.example.com");
    expect(appAddress({ kind: "proxy", url: "https://box.tail1.ts.net", port: 8080 }, "sure")).toBe("https://sure.box.tail1.ts.net");
    expect(setupPorts({ kind: "domain", domain: "space.example.com" })).toEqual([80, 443]);
    expect(setupPorts({ kind: "proxy", url: "https://a.example.com", port: 8080 })).toEqual([8080]);
  });

  it("chooses from flags without asking, and refuses what doesn't fit", async () => {
    const current = { kind: "this-machine", port: 80 } as const;
    await expect(chooseSetup(script, {}, current)).rejects.toThrow(/Answer it with/);
    expect(await chooseSetup(new Ui({ json: true, verbose: false, yes: true }), {}, current)).toEqual(current);
    expect(await chooseSetup(script, { port: "8081" }, current)).toEqual({ kind: "this-machine", port: 8081 });
    expect(await chooseSetup(script, { domain: "Space.Example.com" }, current)).toEqual({ kind: "domain", domain: "space.example.com" });
    expect(await chooseSetup(script, { proxyUrl: "https://a.example.com" }, current)).toEqual({ kind: "proxy", url: "https://a.example.com", port: 8080 });
    const proxy = { kind: "proxy", url: "https://a.example.com", port: 8080 } as const;
    expect(await chooseSetup(script, { port: "8090" }, proxy)).toEqual({ ...proxy, port: 8090 });
    await expect(chooseSetup(script, { domain: "space.example.com", port: "8081" }, current)).rejects.toThrow(/ports 80 and 443/);
    await expect(chooseSetup(script, { domain: "https://x.example.com" }, current)).rejects.toThrow(/--domain/);
    await expect(chooseSetup(script, { thisMachine: true, domain: "a.example.com" }, current)).rejects.toThrow(/Choose one/);
  });

  it("asks only in a terminal, naming the flag otherwise", async () => {
    const yes = new Ui({ json: false, verbose: false, yes: true });
    const current = { kind: "this-machine", port: 80 } as const;
    // --yes keeps the current setup. A question without a terminal fails, naming its flag.
    expect(await chooseSetup(yes, {}, { kind: "domain", domain: "a.example.com" })).toEqual({ kind: "domain", domain: "a.example.com" });
    await expect(chooseSetup(new Ui({ json: false, verbose: false, yes: false }), {}, current)).rejects.toThrow(/--this-machine, --domain <name> or --proxy-url <url>/);
  });
});

describe("the same rules as the server", () => {
  const secretsDir = mkdtempSync(join(tmpdir(), "ys-cli-rules-"));
  const serverAccepts = (env: Record<string, string>) => {
    try {
      loadConfig({ DATABASE_URL: "postgres://yourspace:s@postgres:5432/yourspace", BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789", ...env }, { secretsDir });
      return true;
    } catch (error) {
      if (error instanceof ConfigError) return false;
      throw error;
    }
  };

  it("agrees on domains", () => {
    for (const name of ["space.example.com", "a.b.example.org", "space.localhost", "box.tail1.ts.net", "x.test", "https://a.example.com", "a.example.com:443", "nodot", "1.2.3.4", "-bad.example.com"]) {
      expect(checkDomain(name) === undefined, name).toBe(serverAccepts({ YS_DOMAIN: name }));
    }
  });

  it("agrees on proxy addresses and ports", () => {
    for (const url of ["https://a.example.com", "http://a.example.com", "https://a.example.com/", "https://A.example.com", "https://a.example.com:8443", "https://a.example.com/path", "nonsense"]) {
      expect(checkProxyUrl(url) === undefined, url).toBe(serverAccepts({ YS_PROXY_URL: url }));
    }
    for (const port of ["8081", "0", "65536", "80a"]) expect(checkPort(port) === undefined, port).toBe(serverAccepts({ YS_PORT: port }));
  });
});
