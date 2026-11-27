import { describe, expect, it } from "vitest";
import { parseKit, KitError } from "../src/apps/kits.ts";
import { AGENT_RESULT_LIMIT, agentCredentialHeader, passAgentResult, renderAgentRequest } from "../src/apps/agent-kit.ts";

const fixture = {
  kit: 2,
  agentAccess: {
    credential: { binding: "service", inject: { location: "header", name: "Authorization", scheme: "Bearer" } },
    roles: { read: { title: "Read", routes: ["list"] }, inspect: { title: "Inspect", routes: ["list", "show"] } },
    routes: {
      list: { method: "GET", path: "/items", effect: "read", queryFields: { search: "string" } },
      show: {
        method: "GET",
        path: "/items/{id}",
        effect: "read",
        approval: "ask",
        pathParams: { id: "integer" },
      },
    },
  },
};
const access = parseKit(JSON.stringify(fixture)).agentAccess!;
const { show, list } = access.routes;
const write = {
  method: "PATCH",
  path: "/items/{id}",
  effect: "write",
  pathParams: { id: "integer" },
  bodyFields: { title: "string" },
  operationId: { in: "header", name: "Idempotency-Key" },
};

describe("a pinned agent-access kit", () => {
  it("keeps legacy kits browser-only and rejects a partial upgrade", () => {
    expect(parseKit("kit: 1\n").agentAccess).toBeUndefined();
    expect(() => parseKit(JSON.stringify({ ...fixture, kit: 1 }))).toThrow(KitError);
    expect(() => parseKit("kit: 2\n")).toThrow(KitError);
    expect(access.roles.inspect.routes).toEqual(["list", "show"]);
  });

  it("validates role references, credential bindings and overlapping routes", () => {
    for (const change of [
      { roles: { operator: { title: "Operator", routes: ["missing"] } } },
      { routes: { list: { ...list, path: "https://example.test" } } },
      { routes: { list, show, another: { ...show, path: "/items/current", pathParams: {} } } },
      { credential: { binding: "service", inject: { location: "header", name: "Host" } } },
      { vetted: true },
    ]) {
      expect(() => parseKit(JSON.stringify({ ...fixture, agentAccess: { ...fixture.agentAccess, ...change } }))).toThrow(
        KitError,
      );
    }
  });

  it("accepts a write route by its method alone and refuses what a cut write route declared", () => {
    const routes = {
      list,
      show,
      create: { method: "POST", path: "/items" },
      edit: { method: "PATCH", path: "/items/{id}", pathParams: { id: "integer" }, approval: "allow" },
      replace: { method: "PUT", path: "/items/{id}", pathParams: { id: "integer" } },
      remove: { method: "DELETE", path: "/items/{id}", pathParams: { id: "integer" } },
    };
    const parsed = parseKit(JSON.stringify({ ...fixture, agentAccess: { ...fixture.agentAccess, routes } })).agentAccess!;
    expect(parsed.routes.create).toEqual({ method: "POST", path: "/items" });
    expect(parsed.routes.edit!.approval).toBe("allow");
    for (const route of [
      write,
      { ...write, effect: "read" },
      { method: "POST", path: "/items", effect: "write" },
      { method: "POST", path: "/items", effect: "create" },
      { ...list, method: "POST" },
      { ...list, method: "OPTIONS", effect: undefined },
      { method: "POST", path: "/items", bodyFields: { title: "string" } },
      { method: "POST", path: "/items", operationId: { in: "header", name: "Idempotency-Key" } },
      { method: "PATCH", path: "/items", expectedRevision: { in: "header", name: "If-Match" } },
      { method: "POST", path: "/items", receipt: { route: "list", param: "id" } },
    ]) {
      expect(() =>
        parseKit(JSON.stringify({ ...fixture, agentAccess: { ...fixture.agentAccess, routes: { list, show, edit: route } } })),
      ).toThrow(/A route is a GET with effect: read, or a POST, PATCH, PUT or DELETE with no effect/);
    }
  });

  it("sends a write's body as the agent's JSON, up to 32 KiB, and no body on a read", () => {
    const create = { method: "POST" as const, path: "/items" };
    const body = { title: "new", company: { create: { name: "Nested" } }, tags: [1, null] };
    expect(renderAgentRequest(create, { body })).toEqual({
      method: "POST",
      path: "/items",
      headers: {},
      body: JSON.stringify(body),
    });
    expect(renderAgentRequest(create, {})).toEqual({ method: "POST", path: "/items", headers: {} });
    expect(() => renderAgentRequest(create, { body: { text: "x".repeat(32 * 1024) } })).toThrow(/32 KiB/);
    expect(() => renderAgentRequest(list, { body: {} })).toThrow(/A read takes no body/);
  });

  it("refuses outputFields, saying the app's response is passed through", () => {
    const routes = { list: { ...list, outputFields: ["id"] }, show };
    expect(() => parseKit(JSON.stringify({ ...fixture, agentAccess: { ...fixture.agentAccess, routes } }))).toThrow(
      /outputFields was removed: Your Space passes the app's JSON response to the agent unchanged/,
    );
  });

  it("renders only kit-declared input and sorted query parameters", () => {
    expect(renderAgentRequest(list, { query: { search: "blue & green" } }).path).toBe("/items?search=blue+%26+green");
    expect(renderAgentRequest(show, { path: { id: 7 } })).toEqual({ method: "GET", path: "/items/7", headers: {} });
    expect(agentCredentialHeader(access, "synthetic-key")).toEqual({ Authorization: "Bearer synthetic-key" });
  });

  it("rejects unknown fields, a body and unsafe parameter segments", () => {
    expect(() => renderAgentRequest(list, { headers: {} })).toThrow();
    expect(() => renderAgentRequest(list, { body: { title: "new" } })).toThrow();
    expect(() => renderAgentRequest(list, { query: { unexpected: "x" } })).toThrow();
    expect(() => renderAgentRequest(list, { query: null })).toThrow();
    expect(() => renderAgentRequest(show, { path: { id: "7" } })).toThrow();
    const textRoute = { ...show, pathParams: { id: "string" as const } };
    for (const id of ["..", "a/b", "a%2fb", "?x", "a\\b"]) {
      expect(() => renderAgentRequest(textRoute, { path: { id } })).toThrow();
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
