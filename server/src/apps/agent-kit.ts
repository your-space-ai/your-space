// The declaration lives in the pinned installation kit. Only this module turns a
// declared route and validated scalar fields into an upstream request.
type FieldType = "string" | "uuid" | "integer" | "boolean";
type Fields = Record<string, FieldType>;
type Scalar = string | number | boolean | null;
type ResultRow = Record<string, Scalar>;
type MetadataBinding = { in: "header" | "body"; name: string };
export interface AgentRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  effect: "read" | "write";
  approval?: "ask" | "allow";
  pathParams?: Fields;
  queryFields?: Fields;
  bodyFields?: Fields;
  operationId?: MetadataBinding;
  expectedRevision?: MetadataBinding;
  receipt?: { route: string; param: string };
  outputFields: string[];
}
export interface AgentAccess {
  credential: { binding: string; inject: { location: "header"; name: string; scheme?: "Bearer" } };
  roles: Record<string, { title: string; routes: string[] }>;
  routes: Record<string, AgentRoute>;
}
export class AgentKitError extends Error {}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new AgentKitError(message);
}
const id = /^[a-z][a-z0-9-]{0,63}$/;
const field = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function allowedName(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value) && !Object.hasOwn(Object.prototype, value) && value !== "prototype";
}
function mapping(value: unknown): Record<string, unknown> {
  check(
    value && typeof value === "object" && [null, Object.prototype].includes(Object.getPrototypeOf(value)),
    "Expected a mapping.",
  );
  const obj = value as Record<string, unknown>;
  check(Object.keys(obj).length <= 128, "The mapping has too many entries.");
  return obj;
}
function keys(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const obj = mapping(value);
  check(
    Object.keys(obj).every((k) => allowed.includes(k)),
    "Unknown field in mapping.",
  );
  return obj;
}
function nameList(value: unknown, pattern: RegExp): string[] {
  check(
    Array.isArray(value) &&
      value.length <= 128 &&
      value.every((v) => allowedName(v, pattern)) &&
      new Set(value).size === value.length,
    "Invalid or duplicate field or route name.",
  );
  return value;
}
function parseFields(value: unknown): Fields {
  const fields: Fields = {};
  for (const [name, type] of Object.entries(mapping(value))) {
    check(
      allowedName(name, field) && (type === "uuid" || type === "integer" || type === "boolean" || type === "string"),
      "Invalid field declaration.",
    );
    fields[name] = type;
  }
  return fields;
}
function metadata(value: unknown, header: string, bodyFields?: Fields): MetadataBinding {
  const b = keys(value, ["in", "name"]);
  check(typeof b.name === "string", "Missing metadata field name.");
  if (b.in === "header") {
    check(b.name.toLowerCase() === header.toLowerCase(), "Unsupported metadata header.");
    return { in: "header", name: header };
  }
  check(
    b.in === "body" && allowedName(b.name, field) && !Object.hasOwn(bodyFields ?? {}, b.name),
    "Invalid or overlapping metadata body field.",
  );
  return { in: "body", name: b.name };
}
function parseRoute(value: unknown): AgentRoute {
  const r = keys(value, [
    "method",
    "path",
    "effect",
    "approval",
    "pathParams",
    "queryFields",
    "bodyFields",
    "outputFields",
    "operationId",
    "expectedRevision",
    "receipt",
  ]);
  const { method, path, effect, approval } = r;
  check(
    method === "GET" || method === "PUT" || method === "PATCH" || method === "POST" || method === "DELETE",
    "Unsupported HTTP method.",
  );
  check(effect === "write" || (effect === "read" && method === "GET"), "Write-capable routes must declare a write.");
  check(approval === undefined || approval === "allow" || approval === "ask", "Unknown approval setting.");
  check(typeof path === "string" && path.startsWith("/") && path.length <= 512, "Expected a relative route path.");
  const route: AgentRoute = { method, path, effect, approval, outputFields: nameList(r.outputFields, field) };
  for (const slot of ["pathParams", "queryFields", "bodyFields"] as const) {
    if (r[slot] !== undefined) route[slot] = parseFields(r[slot]);
  }
  const params = new Set(Object.keys(route.pathParams ?? {}));
  const segments = path.slice(1).split("/");
  if (segments.at(-1) === "") segments.pop();
  for (const segment of segments) {
    if (/^[a-z\d_~-][a-z\d_.~-]*$/i.test(segment)) continue;
    check(
      /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment) && params.delete(segment.slice(1, -1)),
      "Invalid path segment or undeclared parameter.",
    );
  }
  check(params.size === 0, "Unused path parameter.");
  if (method === "GET") check(!Object.keys(route.bodyFields ?? {}).length, "GET does not accept a request body.");
  if (effect === "write") {
    route.operationId = metadata(r.operationId, "Idempotency-Key", route.bodyFields);
    if (r.expectedRevision !== undefined || ["PUT", "PATCH", "DELETE"].includes(method))
      route.expectedRevision = metadata(r.expectedRevision, "If-Match", route.bodyFields);
    check(
      !(
        route.expectedRevision?.in === "body" &&
        route.operationId.in === "body" &&
        route.expectedRevision.name === route.operationId.name
      ),
      "Metadata fields overlap.",
    );
    if (method === "GET")
      check(route.operationId.in === "header" && route.expectedRevision?.in !== "body", "GET metadata must use headers.");
  } else {
    check(r.operationId === undefined && r.expectedRevision === undefined, "Read route cannot declare write metadata.");
  }
  if (r.receipt !== undefined) {
    const receipt = keys(r.receipt, ["route", "param"]);
    check(effect === "write" && allowedName(receipt.route, id) && allowedName(receipt.param, field), "Invalid receipt lookup.");
    route.receipt = { route: receipt.route, param: receipt.param };
  }
  return route;
}
export function parseAgentAccess(value: unknown): AgentAccess {
  const a = keys(value, ["credential", "roles", "routes"]);
  const credential = keys(a.credential, ["binding", "inject"]);
  const inject = keys(credential.inject, ["location", "name", "scheme"]);
  check(
    allowedName(credential.binding, id) && inject.location === "header" && typeof inject.name === "string",
    "Invalid credential binding.",
  );
  const authName = inject.name.toLowerCase();
  check(
    authName === "authorization"
      ? inject.scheme === "Bearer"
      : ["x-api-key", "api-key", "secretkey"].includes(authName) && inject.scheme === undefined,
    "Unsupported credential header or scheme.",
  );
  const routes: AgentAccess["routes"] = {};
  for (const [name, declaration] of Object.entries(mapping(a.routes))) {
    check(allowedName(name, id), "Invalid route ID.");
    const route = parseRoute(declaration);
    const segments = route.path.toLowerCase().replace(/\/$/, "").split("/");
    for (const other of Object.values(routes)) {
      if (other.method !== route.method) continue;
      const previous = other.path.toLowerCase().replace(/\/$/, "").split("/");
      const overlaps =
        previous.length === segments.length &&
        previous.every((s, i) => s === segments[i] || s.startsWith("{") || segments[i].startsWith("{"));
      check(!overlaps, "Ambiguous method and route.");
    }
    routes[name] = route;
  }
  for (const route of Object.values(routes)) {
    if (!route.receipt) continue;
    const lookup = routes[route.receipt.route];
    const params = lookup?.pathParams ?? {};
    check(
      lookup?.method === "GET" &&
        lookup.effect === "read" &&
        Object.keys(params).length === 1 &&
        params[route.receipt.param] === "string",
      "Receipt route needs a read with one string path parameter.",
    );
  }
  const roles: AgentAccess["roles"] = {};
  for (const [name, declaration] of Object.entries(mapping(a.roles))) {
    const role = keys(declaration, ["title", "routes"]);
    check(
      allowedName(name, id) &&
        typeof role.title === "string" &&
        role.title.trim().length > 0 &&
        role.title.length <= 80 &&
        !/[\x00-\x1f\x7f]/.test(role.title),
      "Invalid role ID or title.",
    );
    const roleRoutes = nameList(role.routes, id);
    check(
      roleRoutes.every((key) => Object.hasOwn(routes, key)),
      "Role includes an unknown route.",
    );
    for (const routeId of roleRoutes) {
      const receipt = routes[routeId].receipt;
      check(!receipt || roleRoutes.includes(receipt.route), "A role granting a write must include its receipt route.");
    }
    roles[name] = { title: role.title, routes: roleRoutes };
  }
  return {
    credential: {
      binding: credential.binding,
      inject: { location: "header", name: inject.name, ...(authName === "authorization" ? { scheme: "Bearer" as const } : {}) },
    },
    roles,
    routes,
  };
}
function validateInput(fields: Fields, values: unknown): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  const input = mapping(values);
  for (const name of Object.keys(input).sort()) {
    const v = input[name];
    check(Object.hasOwn(fields, name), "Undeclared input field.");
    const type = fields[name];
    if (type === "integer") check(typeof v === "number" && Number.isSafeInteger(v), "Expected integer.");
    else if (type === "boolean") check(typeof v === "boolean", "Expected boolean.");
    else {
      check(typeof v === "string" && v.length <= 8192, "Expected bounded text.");
      if (type === "uuid") check(uuid.test(v), "Expected UUID.");
    }
    result[name] = v;
  }
  return result;
}
export function renderAgentRequest(
  route: AgentRoute,
  input: unknown,
  operationId?: string,
  expectedRevision?: string,
): { method: string; path: string; headers: Record<string, string>; body?: string } {
  const values = keys(input === undefined ? {} : input, ["path", "query", "body"]);
  const params = validateInput(route.pathParams ?? {}, values.path === undefined ? {} : values.path);
  const query = validateInput(route.queryFields ?? {}, values.query === undefined ? {} : values.query);
  const body = validateInput(route.bodyFields ?? {}, values.body === undefined ? {} : values.body);
  let path = route.path.replace(/\{([^{}]+)\}/g, (_, k: string) => {
    check(Object.hasOwn(params, k), "Missing path parameter.");
    const value = String(params[k]);
    check(/^[A-Za-z0-9_~-][A-Za-z0-9_.~-]{0,255}$/.test(value), "Invalid path parameter.");
    return value;
  });
  const search = new URLSearchParams();
  for (const key of Object.keys(query).sort()) search.set(key, String(query[key]));
  if (search.size) path += "?" + search.toString();
  if (route.receipt)
    check(
      typeof operationId === "string" && /^[A-Za-z0-9_~-][A-Za-z0-9_.~-]{0,199}$/.test(operationId),
      "Operation ID must fit the declared receipt route.",
    );
  const headers: Record<string, string> = {};
  for (const [binding, v] of [
    [route.operationId, operationId],
    [route.expectedRevision, expectedRevision],
  ] as const) {
    if (!binding) {
      check(v === undefined, "Unexpected write metadata.");
      continue;
    }
    check(typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v), "Missing or invalid write metadata.");
    if (binding === route.expectedRevision && binding.in === "header")
      check(/^"[\x21\x23-\x7e]+"$/.test(v), "Expected one strong entity tag.");
    if (binding.in === "header") headers[binding.name] = v;
    else body[binding.name] = v;
  }
  if (Object.keys(body).length) {
    headers["Content-Type"] = "application/json";
    return { method: route.method, path, headers, body: JSON.stringify(body) };
  }
  return { method: route.method, path, headers };
}
export function agentCredentialHeader(access: AgentAccess, secret: string): Record<string, string> {
  check(typeof secret === "string" && /^[\x21-\x7e]{1,8192}$/.test(secret), "Invalid app credential.");
  const { name, scheme } = access.credential.inject;
  return { [name]: scheme ? scheme + " " + secret : secret };
}
export function filterAgentResult(
  route: AgentRoute,
  data: unknown,
  secrets: readonly string[],
): ResultRow | ResultRow[] | null {
  if (data === null) return null;
  function row(item: unknown): ResultRow {
    const src = mapping(item);
    const result: ResultRow = {};
    for (const name of route.outputFields) {
      if (!Object.hasOwn(src, name)) continue;
      const v = src[name];
      check(
        v === null ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          (typeof v === "string" && v.length <= 8192),
        "Unsupported app result.",
      );
      // Upstreams can echo a token even inside a diagnostic string or JSON-encoded text.
      const text = String(v);
      check(
        !secrets.some((secret) => secret && (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1)))),
        "Unsafe app result.",
      );
      result[name] = v;
    }
    return result;
  }
  if (!Array.isArray(data)) return row(data);
  check(data.length <= 500, "App result is too large.");
  return data.map(row);
}
