import { describe, expect, it } from "vitest";
import { parseKit, KitError } from "../src/apps/kits.ts";
import {
  AGENT_RESULT_LIMIT,
  agentCredentialHeader,
  asksFirst,
  parseAgentAccess,
  parseAskRules,
  parseCall,
  passAgentResult,
  storedAgentAccess,
} from "../src/apps/agent-kit.ts";

const bearer = { location: "header", name: "Authorization", scheme: "Bearer" };
const fixture = { kit: 2, agentAccess: { api: "/rest", credential: { binding: "service", inject: bearer } } };
const access = parseKit(JSON.stringify(fixture)).agentAccess!;
const call = (method: string, path: string, body?: unknown) => parseCall(access, { method, path, body });

describe("a kit's agent access (spec 018)", () => {
  it("names the API's path and its credentials, and nothing else", () => {
    expect(access).toEqual({ api: "/rest", credential: { binding: "service", inject: bearer } });
    expect(parseAgentAccess({ api: "/", credentials: { records: { inject: bearer }, setup: { inject: bearer } } })).toEqual({
      api: "/",
      credentials: { records: { inject: bearer }, setup: { inject: bearer } },
    });
    expect(parseAgentAccess({ api: "/rest/", credential: fixture.agentAccess.credential }).api).toBe("/rest");
    expect(parseKit("kit: 1\n").agentAccess).toBeUndefined();
    expect(() => parseKit(JSON.stringify({ ...fixture, kit: 1 }))).toThrow(KitError);
    expect(agentCredentialHeader(access.credential!.inject, "synthetic-key")).toEqual({ Authorization: "Bearer synthetic-key" });
  });

  it("refuses a kit in 017's format, with roles or routes or no api, saying what to change", () => {
    for (const agentAccess of [
      { credential: fixture.agentAccess.credential, roles: {}, routes: {} },
      { api: "/rest", credential: fixture.agentAccess.credential, routes: {} },
      { api: "/rest", credential: fixture.agentAccess.credential, roles: {} },
      { credential: fixture.agentAccess.credential },
    ]) {
      expect(() => parseKit(JSON.stringify({ kit: 2, agentAccess }))).toThrow(/Agent access is per app: a kit names the path its API lives under with api/);
    }
    for (const api of ["rest", "/rest/../admin", "/rest/%2e", "/a;b", "/a b", 7]) {
      expect(() => parseAgentAccess({ api, credential: fixture.agentAccess.credential }), String(api)).toThrow();
    }
    for (const change of [
      { credential: undefined },
      { credentials: {} },
      { credential: { binding: "service", inject: { location: "header", name: "Host" } } },
      { vetted: true },
    ]) {
      expect(() => parseAgentAccess({ ...fixture.agentAccess, ...change })).toThrow();
    }
  });

  it("reads a stored 017 kit as giving no access, and a 018 kit as it is", () => {
    expect(storedAgentAccess({ kit: 2, agentAccess: { credential: {}, roles: {}, routes: {} } })).toEqual({ problem: "old_format" });
    expect(storedAgentAccess({ kit: 2, agentAccess: access })).toEqual({ access });
    expect(storedAgentAccess({ kit: 1 })).toBeUndefined();
  });

  it("takes a call under the API, with its query encoded again and its body as JSON", () => {
    expect(call("GET", "/rest/companies?limit=5&filter=name%5Beq%5D%3AAcme&tag=a&tag=b")).toEqual({
      method: "GET",
      target: "/rest/companies?limit=5&filter=name%5Beq%5D%3AAcme&tag=a&tag=b",
      segments: ["rest", "companies"],
      label: "GET /rest/companies",
    });
    const body = { name: "Acme", company: { create: { name: "Nested" } } };
    expect(call("POST", "/rest/companies", body)).toMatchObject({ target: "/rest/companies", body: JSON.stringify(body) });
    expect(call("GET", "/rest/users/alice@example.com/").segments).toEqual(["rest", "users", "alice@example.com"]);
    expect(call("PATCH", "/rest/a%20b").segments).toEqual(["rest", "a b"]);
    expect(parseCall({ ...access, api: "/" }, { method: "GET", path: "/" }).segments).toEqual([]);
  });

  it("refuses a call outside the API, or one an app could read as another path", () => {
    for (const path of [
      "/restricted/x",
      "/REST/companies",
      "/other",
      "rest/companies",
      "/rest/../admin",
      "/rest/%2e%2e/admin",
      "/rest/a%2fb",
      "/rest/a%5cb",
      "/rest/a%00",
      "/rest/%2561dmin",
      "/rest//companies",
      "/rest/a;v=1",
      "/rest/a b",
      "/rest/%zz",
      "/rest/" + "x".repeat(2048),
    ]) {
      expect(() => call("GET", path), path).toThrow();
    }
    expect(() => call("OPTIONS", "/rest/x")).toThrow(/GET, POST, PATCH, PUT or DELETE/);
    expect(() => call("GET", "/rest/x", {})).toThrow(/A GET takes no body/);
    expect(() => call("POST", "/rest/x", { text: "x".repeat(32 * 1024) })).toThrow(/32 KiB/);
  });

  it("asks first only for a call that matches a route that asks, case and trailing slash aside", () => {
    const rules = parseAskRules([
      { method: "DELETE", path: "/rest/people/*" },
      { method: "POST", path: "/rest/metadata/*/" },
      { method: "DELETE", path: "/rest/people/*" },
    ]);
    expect(rules).toEqual([
      { method: "DELETE", path: "/rest/people/*" },
      { method: "POST", path: "/rest/metadata/*" },
    ]);
    expect(asksFirst(rules, call("DELETE", "/rest/people/3f8a2c1e"))).toBe(true);
    expect(asksFirst(rules, call("DELETE", "/rest/People/3f8a2c1e/"))).toBe(true);
    expect(asksFirst(rules, call("DELETE", "/rest/people/3f8a2c1e?soft=true"))).toBe(true);
    expect(asksFirst(rules, call("DELETE", "/rest/people"))).toBe(false);
    expect(asksFirst(rules, call("DELETE", "/rest/people/a/b"))).toBe(false);
    expect(asksFirst(rules, call("GET", "/rest/people/3f8a2c1e"))).toBe(false);
    expect(asksFirst(rules, call("POST", "/rest/metadata/fields"))).toBe(true);
    expect(asksFirst([], call("DELETE", "/rest/people/x"))).toBe(false);
    for (const rules of [[{ method: "TRACE", path: "/x" }], [{ method: "GET", path: "x" }], [{ method: "GET", path: "/a;b" }], [{ method: "GET", path: "/%2e" }], "x"]) {
      expect(() => parseAskRules(rules)).toThrow();
    }
  });

  it("passes the app's JSON response through unchanged", () => {
    // A wrapped list with nested fields, as REST APIs such as Twenty's return it.
    const wrapped = {
      data: { companies: [{ id: "c1", name: { firstName: "Ada", lastName: "Lovelace" }, tags: ["a", null], employees: 3 }] },
      pageInfo: { hasNextPage: false, endCursor: null },
      totalCount: 1,
    };
    expect(passAgentResult(wrapped, ["synthetic-secret"])).toEqual(wrapped);
    expect(passAgentResult([{ id: 1, internal: { kept: true } }], [])).toEqual([{ id: 1, internal: { kept: true } }]);
    for (const value of [null, "text", 7, false, []]) expect(passAgentResult(value, [])).toEqual(value);
  });

  it("fails closed on an upstream secret echo anywhere in the response", () => {
    for (const [body, secret] of [
      [{ title: "Bearer synthetic-secret" }, "synthetic-secret"],
      [{ data: { items: [{ note: { deep: ["synthetic-secret"] } }] } }, "synthetic-secret"],
      [{ "synthetic-secret": true }, "synthetic-secret"],
      [{ id: 902341 }, "902341"],
      [{ title: 'synthetic"token' }, 'synthetic"token'],
      [{ title: JSON.stringify({ token: 'synthetic"token' }) }, 'synthetic"token'],
      [{ title: JSON.stringify({ token: "back\\slash" }) }, "back\\slash"],
      // JSON text inside a string that escapes the secret's characters.
      [{ debug: '{"token":"\\u0073ynthetic-secret"}' }, "synthetic-secret"],
      [{ debug: '{"token":"synthetic\\/secret"}' }, "synthetic/secret"],
      [{ debug: JSON.stringify({ inner: '{"token":"\\u0073ynthetic-secret"}' }) }, "synthetic-secret"],
    ] as const) {
      expect(() => passAgentResult(body, ["", secret])).toThrow("Unsafe app result");
    }
  });

  it("finds an escaped secret at any depth of JSON text inside text that fits the limit", () => {
    for (const [inner, secret] of [
      ['synthetic"token', 'synthetic"token'],
      ["back\\slash", "back\\slash"],
      ['{"token":"\\u0073ynthetic-secret"}', "synthetic-secret"],
    ] as const) {
      let body: unknown = { debug: inner };
      let depth = 0;
      while (Buffer.byteLength(JSON.stringify(body)) <= AGENT_RESULT_LIMIT) {
        expect(() => passAgentResult(body, [secret])).toThrow("Unsafe app result");
        body = { debug: JSON.stringify(body) };
        depth++;
      }
      expect(depth).toBeGreaterThan(10);
    }
  });

  it("refuses a result escaped deeper than a JSON writer nests, and passes an honest one", () => {
    // Writing each backslash as \u005c and each quote as \u0022 doesn't double the backslashes, so
    // the secret hides deeper than nested JSON within the limit can.
    let hidden = '{"token":"\\u0073ynthetic-secret"}';
    for (let depth = 1; depth <= 40; depth++) {
      hidden = `{"inner":"${hidden}"}`.replace(/\\/g, "\\u005c").replace(/"/g, "\\u0022");
      expect(() => passAgentResult({ debug: hidden }, ["synthetic-secret"])).toThrow("Unsafe app result");
    }
    // The deepest escaping a JSON writer leaves within the limit: 18 passes.
    const path = { path: "\\".repeat(2 ** 16) + "n" };
    expect(passAgentResult(path, ["synthetic-secret"])).toEqual(path);
  });

  it("refuses a response that is too large or isn't JSON", () => {
    expect(() => passAgentResult({ text: "x".repeat(AGENT_RESULT_LIMIT) }, [])).toThrow("App result is too large");
    expect(passAgentResult({ text: "x".repeat(AGENT_RESULT_LIMIT - 20) }, [])).toBeTruthy();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [undefined, () => 1, 1n, cycle]) {
      expect(() => passAgentResult(value, [])).toThrow("Unsupported app result");
    }
  });
});
