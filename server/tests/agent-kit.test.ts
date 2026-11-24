import { describe, expect, it } from "vitest";
import { parseKit, KitError } from "../src/apps/kits.ts";
import { agentCredentialHeader, filterAgentResult, renderAgentRequest } from "../src/apps/agent-kit.ts";

const fixture = {
  kit: 2,
  agentAccess: {
    credential: { binding: "service", inject: { location: "header", name: "Authorization", scheme: "Bearer" } },
    roles: { read: { title: "Read", routes: ["list"] }, inspect: { title: "Inspect", routes: ["list", "show"] } },
    routes: {
      list: { method: "GET", path: "/items", effect: "read", queryFields: { search: "string" }, outputFields: ["id", "title"] },
      show: {
        method: "GET",
        path: "/items/{id}",
        effect: "read",
        approval: "ask",
        pathParams: { id: "integer" },
        outputFields: ["id", "title"],
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
  outputFields: ["id", "title"],
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

  it("returns selected scalar fields and fails closed on an upstream secret echo", () => {
    expect(filterAgentResult(list, [{ id: 1, title: "public", internal: "hidden" }], [])).toEqual([{ id: 1, title: "public" }]);
    expect(() => filterAgentResult(list, { title: { internal: "hidden" } }, [])).toThrow();
    expect(() => filterAgentResult(list, { title: "Bearer synthetic-secret" }, ["synthetic-secret"])).toThrow(
      "Unsafe app result",
    );
    expect(() => filterAgentResult(list, { title: JSON.stringify({ token: 'synthetic"token' }) }, ['synthetic"token'])).toThrow(
      "Unsafe app result",
    );
    expect(() => filterAgentResult(list, { id: 902341 }, ["902341"])).toThrow("Unsafe app result");
    expect(filterAgentResult(show, null, [])).toBe(null);
  });
});
