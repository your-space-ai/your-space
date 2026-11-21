import { describe, expect, it } from "vitest";
import { parseKit, KitError } from "../src/apps/kits.ts";
import { agentCredentialHeader, filterAgentResult, renderAgentRequest } from "../src/apps/agent-kit.ts";

const fixture = {
  kit: 2,
  agentAccess: {
    credential: { binding: "service", inject: { location: "header", name: "Authorization", scheme: "Bearer" } },
    roles: { read: { title: "Read", routes: ["list"] }, manage: { title: "Manage", routes: ["list", "edit"] } },
    routes: {
      list: { method: "GET", path: "/items", effect: "read", queryFields: { search: "string" }, outputFields: ["id", "title"] },
      edit: {
        method: "PATCH",
        path: "/items/{id}",
        effect: "write",
        approval: "ask",
        pathParams: { id: "integer" },
        bodyFields: { title: "string" },
        operationId: { in: "header", name: "Idempotency-Key" },
        expectedRevision: { in: "body", name: "revision" },
        outputFields: ["id", "title"],
      },
    },
  },
};
const access = parseKit(JSON.stringify(fixture)).agentAccess!;
const { edit, list } = access.routes;

describe("a pinned agent-access kit", () => {
  it("keeps legacy kits browser-only and rejects a partial upgrade", () => {
    expect(parseKit("kit: 1\n").agentAccess).toBeUndefined();
    expect(() => parseKit(JSON.stringify({ ...fixture, kit: 1 }))).toThrow(KitError);
    expect(() => parseKit("kit: 2\n")).toThrow(KitError);
    expect(access.roles.manage.routes).toEqual(["list", "edit"]);
  });

  it("validates role references, method/effect, metadata, credential bindings and overlapping routes", () => {
    for (const change of [
      { roles: { operator: { title: "Operator", routes: ["missing"] } } },
      { routes: { list: { ...list, path: "https://example.test" } } },
      { routes: { list, edit: { ...edit, effect: "read" } } },
      { routes: { list, edit: { ...edit, operationId: undefined } } },
      { routes: { list, edit: { ...edit, expectedRevision: { in: "body", name: "title" } } } },
      { routes: { list, edit: { ...edit, operationId: { in: "header", name: "Host" } } } },
      { routes: { list, edit, another: { ...edit, path: "/items/current", pathParams: {} } } },
      { credential: { binding: "service", inject: { location: "header", name: "Host" } } },
      { vetted: true },
    ]) {
      expect(() => parseKit(JSON.stringify({ ...fixture, agentAccess: { ...fixture.agentAccess, ...change } }))).toThrow(
        KitError,
      );
    }
  });

  it("limits write receipts to a granted single-parameter read", () => {
    const withReceipt = { ...edit, receipt: { route: "receipt", param: "op" } };
    const receipt = { ...list, path: "/receipts/{op}", pathParams: { op: "string" } };
    const declarations = {
      ...fixture.agentAccess,
      routes: { list, edit: withReceipt, receipt },
      roles: { manage: { title: "Manage", routes: ["edit", "receipt"] } },
    };
    expect(parseKit(JSON.stringify({ kit: 2, agentAccess: declarations })).agentAccess!.routes.edit.receipt).toEqual(
      withReceipt.receipt,
    );
    expect(() =>
      parseKit(
        JSON.stringify({ kit: 2, agentAccess: { ...declarations, roles: { manage: { title: "Manage", routes: ["edit"] } } } }),
      ),
    ).toThrow(KitError);
    expect(() =>
      parseKit(
        JSON.stringify({
          kit: 2,
          agentAccess: { ...declarations, routes: { ...declarations.routes, receipt: { ...receipt, path: "/receipts" } } },
        }),
      ),
    ).toThrow(KitError);
    expect(() => renderAgentRequest(withReceipt, { path: { id: 1 } }, "cannot/map", "r1")).toThrow();
  });

  it("renders only kit-declared input, sorted query parameters and trusted write metadata", () => {
    expect(renderAgentRequest(list, { query: { search: "blue & green" } }).path).toBe("/items?search=blue+%26+green");
    const request = renderAgentRequest(edit, { path: { id: 7 }, body: { title: "new" } }, "request-1", "v2");
    expect(request.path).toBe("/items/7");
    expect(request.method).toBe("PATCH");
    expect(request.headers).toEqual({ "Content-Type": "application/json", "Idempotency-Key": "request-1" });
    expect(JSON.parse(request.body!)).toEqual({ title: "new", revision: "v2" });
    expect(agentCredentialHeader(access, "synthetic-key")).toEqual({ Authorization: "Bearer synthetic-key" });
  });

  it("rejects unknown fields, unsafe parameter segments, metadata collisions and stale-token shortcuts", () => {
    expect(() => renderAgentRequest(list, { headers: {} })).toThrow();
    expect(() => renderAgentRequest(list, { query: { unexpected: "x" } })).toThrow();
    expect(() => renderAgentRequest(list, { query: null })).toThrow();
    expect(() => renderAgentRequest(edit, { path: { id: "7" } }, "op", "2")).toThrow();
    expect(() => renderAgentRequest(edit, { path: { id: 7 }, body: { revision: "2" } }, "op", "2")).toThrow();
    const textRoute = { ...edit, pathParams: { id: "string" as const } };
    for (const id of ["..", "a/b", "a%2fb", "?x", "a\\b"]) {
      expect(() => renderAgentRequest(textRoute, { path: { id } }, "op", "2")).toThrow();
    }
    const etagRoute = { ...edit, expectedRevision: { in: "header" as const, name: "If-Match" } };
    expect(() => renderAgentRequest(etagRoute, { path: { id: 7 } }, "op", "*")).toThrow();
    expect(renderAgentRequest(etagRoute, { path: { id: 7 } }, "op", '"v2"').headers["If-Match"]).toBe('"v2"');
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
    expect(filterAgentResult(edit, null, [])).toBe(null);
  });
});
