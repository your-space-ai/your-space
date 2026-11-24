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

  it("refuses write routes and every field only a write used, naming why", () => {
    for (const route of [
      write,
      { ...write, effect: "read" },
      { ...list, method: "POST" },
      { ...list, bodyFields: { title: "string" } },
      { ...list, operationId: { in: "header", name: "Idempotency-Key" } },
      { ...list, expectedRevision: { in: "header", name: "If-Match" } },
      { ...list, receipt: { route: "list", param: "id" } },
    ]) {
      expect(() =>
        parseKit(JSON.stringify({ ...fixture, agentAccess: { ...fixture.agentAccess, routes: { list, show, edit: route } } })),
      ).toThrow(/Agents only read/);
    }
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
