import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../server/src/config.ts";
import { CliError } from "../src/errors.ts";
import { address, appAddress, checkPort, chooseSetup, setupFromEnv, setupLines, setupPorts } from "../src/setup.ts";
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
    expect(await chooseSetup(script, {}, current)).toEqual(current);
    expect(await chooseSetup(script, { port: "8081" }, current)).toEqual({ kind: "this-machine", port: 8081 });
    await expect(chooseSetup(script, { port: "80a" }, current)).rejects.toThrow(/--port/);
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

  it("agrees on ports", () => {
    for (const port of ["8081", "0", "65536", "80a"]) expect(checkPort(port) === undefined, port).toBe(serverAccepts({ YS_PORT: port }));
  });
});
