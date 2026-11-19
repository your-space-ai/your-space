import { describe, expect, it } from "vitest";
import { canOpen } from "../src/browser.ts";
import { parseJsonLines, parsePs } from "../src/compose.ts";
import { expectOk } from "../src/server.ts";
import { buildSummary, forwardFor, summaryText } from "../src/summary.ts";

const services = parsePs(
  [
    { Service: "caddy", State: "running", Health: "", Publishers: [{ PublishedPort: 80 }, { PublishedPort: 0 }] },
    { Service: "server", State: "running", Health: "healthy" },
    { Service: "secrets", State: "exited", ExitCode: 0 },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n"),
);
const engine = { version: "29.9.2", os: "linux", arch: "amd64", endpoint: "unix:///var/run/docker.sock", compose: "5.6.1" };

describe("Compose's output", () => {
  it("reads ps as lines or as an array", () => {
    expect(services[0]).toEqual({ name: "caddy", state: "running", health: "", exitCode: 0, ports: [80] });
    expect(parseJsonLines('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseJsonLines("")).toEqual([]);
  });
});

describe("the summary", () => {
  it("shows this machine's address, the link and each app", () => {
    const summary = buildSummary({
      version: "0.3.0",
      folder: "/home/sam/your-space",
      setup: { kind: "this-machine", port: 80 },
      services,
      engine,
      owner: { username: "sam", name: "Sam Rivera" },
      link: { url: "http://space.localhost/reset-password#token=abc", expiresAt: "2026-11-17T12:30:00Z" },
      apps: [{ name: "sure", state: "running" }],
      certificate: null,
    });
    expect(summary).toMatchObject({
      running: true,
      setup: { kind: "this-machine", address: "http://space.localhost", port: 80 },
      apps: [{ name: "sure", state: "running", address: "http://sure.space.localhost" }],
      forward: null,
      engine: { version: "29.9.2", os: "linux", arch: "amd64", endpoint: "unix:///var/run/docker.sock" },
    });
    expect(summary.engine).not.toHaveProperty("compose");
    const text = summaryText(summary);
    expect(text.map((s) => s.title)).toEqual(["Your Space is running", "Set your password", "Services", "Apps", "Engine"]);
    expect(text[2]!.body).not.toMatch(/secrets/);
  });

  it("lists the names a proxy or tunnel forwards, each app's included", () => {
    expect(forwardFor({ kind: "proxy", url: "https://box.tail1.ts.net", port: 8090 }, ["sure", "twenty"])).toEqual({
      to: "http://127.0.0.1:8090",
      network: "your-space_edge",
      names: ["box.tail1.ts.net", "sure.box.tail1.ts.net", "twenty.box.tail1.ts.net"],
      wildcard: "*.box.tail1.ts.net",
    });
    expect(forwardFor({ kind: "domain", domain: "space.example.com" }, ["sure"])).toBeNull();
  });

  it("is stopped, with no apps, when the server isn't running", () => {
    const summary = buildSummary({
      version: null,
      folder: "/f",
      setup: { kind: "domain", domain: "space.example.com" },
      services: [],
      engine: null,
      owner: null,
      apps: null,
      certificate: null,
    });
    expect(summary).toMatchObject({ running: false, apps: null, setup: { kind: "domain", address: "https://space.example.com" } });
    expect(summary.setup).not.toHaveProperty("port");
    expect(summaryText(summary)[0]!.title).toBe("Your Space is stopped");
  });
});

describe("server commands", () => {
  it("keep their result, and their failures become the CLI's", () => {
    expect(expectOk({ status: 0, json: { ok: true, owner: null } })).toEqual({ ok: true, owner: null });
    expect(() => expectOk({ status: 2, json: { ok: false, error: "no_owner", message: "No owner." } })).toThrow("No owner.");
    try {
      expectOk({ status: 1, json: { ok: false, error: "invalid_input", fields: { username: "Not a valid username." } } });
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_input", message: "username: Not a valid username." });
    }
  });
});

describe("opening the link", () => {
  it("only with a desktop, and never over SSH", () => {
    expect(canOpen({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(canOpen({}, "linux")).toBe(false);
    expect(canOpen({ DISPLAY: ":0", SSH_CONNECTION: "1 2 3 4" }, "linux")).toBe(false);
    expect(canOpen({}, "darwin")).toBe(true);
  });
});
