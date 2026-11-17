import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { certificateProblem, checkNames, explain, portAnswers } from "../src/checks.ts";

describe("ports", () => {
  it("finds a port something listens on", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    expect(await portAnswers(port)).toBe(true);
    server.close();
    await new Promise((r) => server.once("close", r));
    expect(await portAnswers(port)).toBe(false);
  });
});

describe("a domain's names", () => {
  const records: Record<string, string[]> = {
    "space.example.com": ["203.0.113.5"],
    "probe.space.example.com": ["203.0.113.5"],
    "probe.other.example.com": ["198.51.100.1"],
    "other.example.com": ["203.0.113.5"],
  };
  const lookup = async (name: string) => {
    const found = records[name];
    if (!found) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return found;
  };

  it("pass when the domain and a wildcard name point at the same place", async () => {
    const result = await checkNames("space.example.com", "probe.space.example.com", lookup);
    expect(result.ok).toBe(true);
    expect(result.checks[0]).toEqual({ name: "space.example.com", addresses: ["203.0.113.5"] });
  });

  it("say which record is missing or points elsewhere", async () => {
    const noWildcard = await checkNames("space.example.com", "nothing.space.example.com", lookup);
    expect(noWildcard.ok).toBe(false);
    expect(noWildcard.problems).toEqual([expect.stringMatching(/\*\.space\.example\.com doesn't resolve/)]);
    expect(noWildcard.checks[1]!.error).toBe("ENOTFOUND");
    const elsewhere = await checkNames("other.example.com", "probe.other.example.com", lookup);
    expect(elsewhere.problems[0]).toMatch(/different addresses/);
    const none = await checkNames("missing.example.com", "probe.missing.example.com", lookup);
    expect(none.problems).toHaveLength(2);
  });
});

describe("Caddy's log about the certificate", () => {
  const line = (entry: Record<string, unknown>) => JSON.stringify({ ts: 1, logger: "tls.obtain", ...entry });

  it("turns the latest failure into what to do", () => {
    const logs = [
      "not json",
      line({ level: "info", msg: "obtaining certificate", identifier: "space.example.com" }),
      line({
        level: "error",
        msg: "could not get certificate from issuer",
        identifier: "space.example.com",
        error: "HTTP 400 urn:ietf:params:acme:error:connection - 203.0.113.5: Timeout during connect (likely firewall problem)",
      }),
    ].join("\n");
    expect(certificateProblem(logs, "space.example.com")).toMatch(/ports 80 and 443/);
    expect(certificateProblem(logs, "other.example.com")).toBeUndefined();
  });

  it("forgets a failure once the certificate is obtained", () => {
    const logs = [
      line({ level: "error", msg: "could not get certificate from issuer", identifier: "space.example.com", error: "urn:ietf:params:acme:error:dns" }),
      line({ level: "info", msg: "certificate obtained successfully", identifier: "space.example.com" }),
    ].join("\n");
    expect(certificateProblem(logs, "space.example.com")).toBeUndefined();
  });

  it("names each kind of failure", () => {
    expect(explain("urn:ietf:params:acme:error:rateLimited: too many certificates")).toMatch(/rate limit/);
    expect(explain("urn:ietf:params:acme:error:dns - NXDOMAIN looking up A")).toMatch(/DNS/);
    expect(explain("urn:ietf:params:acme:error:caa")).toMatch(/CAA/);
    expect(explain("something new")).toBe("Caddy couldn't get a certificate: something new");
  });
});
