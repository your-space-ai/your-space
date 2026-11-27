// The declaration lives in the pinned installation kit. Only this module turns a declared route,
// its validated scalar fields and the agent's body into an upstream request. A role grants a route at
// its HTTP method and nothing finer (spec 017): a write route declares no effect and no body, and the
// body passes to the app, which checks it. The app's JSON response reaches the agent unchanged
// (decision 2026-11-24), so a route declares no output.
type FieldType = "string" | "uuid" | "integer" | "boolean";
type Fields = Record<string, FieldType>;
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"] as const;
export interface AgentRoute {
  method: "GET" | (typeof WRITE_METHODS)[number];
  path: string;
  /** Only a GET declares it, as `read`. A stored route with `effect: write`, from before the cut, is left out of every role. */
  effect?: "read";
  approval?: "ask" | "allow";
  pathParams?: Fields;
  queryFields?: Fields;
  /** With named `credentials`, the one this route is sent with. */
  credential?: string;
}
/** Fields of the write routes cut on 2026-11-23: Your Space no longer checks bodies or matches retries. */
const CUT_FIELDS = ["bodyFields", "operationId", "expectedRevision", "receipt"];
const ROUTE_SHAPE =
  "A route is a GET with effect: read, or a POST, PATCH, PUT or DELETE with no effect. A role grants the route at its method: a route declares no body fields, operation ID, revision or receipt, and the app checks the body.";
/** The largest body, in bytes of JSON, that a write sends to the app. */
export const AGENT_BODY_LIMIT = 32 * 1024;
export const isWrite = (route: Pick<AgentRoute, "method">) => route.method !== "GET";
const NO_OUTPUT_FIELDS =
  "outputFields was removed: Your Space passes the app's JSON response to the agent unchanged. Remove outputFields from the route.";
/** The largest app result, in bytes of JSON, that an agent gets; the transport stops reading past it. */
export const AGENT_RESULT_LIMIT = 256 * 1024;
type Inject = { location: "header"; name: string; scheme?: "Bearer" };
/**
 * A kit names one `credential`, as before spec 017, or several `credentials`, each route naming the
 * one it is sent with, so a setup role can use an admin credential that no record role carries.
 */
export interface AgentAccess {
  credential?: { binding: string; inject: Inject };
  credentials?: Record<string, { inject: Inject }>;
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
function parseRoute(value: unknown): AgentRoute {
  const declared = mapping(value);
  check(!CUT_FIELDS.some((name) => Object.hasOwn(declared, name)), ROUTE_SHAPE);
  check(!Object.hasOwn(declared, "outputFields"), NO_OUTPUT_FIELDS);
  const r = keys(value, ["method", "path", "effect", "approval", "pathParams", "queryFields", "credential"]);
  const { method, path, effect, approval } = r;
  check(
    (method === "GET" && effect === "read") ||
      (WRITE_METHODS.includes(method as (typeof WRITE_METHODS)[number]) && effect === undefined),
    ROUTE_SHAPE,
  );
  check(approval === undefined || approval === "allow" || approval === "ask", "Unknown approval setting.");
  check(typeof path === "string" && path.startsWith("/") && path.length <= 512, "Expected a relative route path.");
  const route = { method, path, ...(effect ? { effect } : {}), approval } as AgentRoute;
  if (r.credential !== undefined) {
    check(allowedName(r.credential, id), "Invalid credential name.");
    route.credential = r.credential;
  }
  for (const slot of ["pathParams", "queryFields"] as const) {
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
  return route;
}
function parseInject(value: unknown): Inject {
  const inject = keys(value, ["location", "name", "scheme"]);
  check(inject.location === "header" && typeof inject.name === "string", "Invalid credential binding.");
  const authName = inject.name.toLowerCase();
  check(
    authName === "authorization"
      ? inject.scheme === "Bearer"
      : ["x-api-key", "api-key", "secretkey"].includes(authName) && inject.scheme === undefined,
    "Unsupported credential header or scheme.",
  );
  return { location: "header", name: inject.name, ...(authName === "authorization" ? { scheme: "Bearer" as const } : {}) };
}
export function parseAgentAccess(value: unknown): AgentAccess {
  const a = keys(value, ["credential", "credentials", "roles", "routes"]);
  check((a.credential === undefined) !== (a.credentials === undefined), "Declare either credential or credentials.");
  let single: AgentAccess["credential"];
  let named: AgentAccess["credentials"];
  if (a.credential !== undefined) {
    const credential = keys(a.credential, ["binding", "inject"]);
    check(allowedName(credential.binding, id), "Invalid credential binding.");
    single = { binding: credential.binding, inject: parseInject(credential.inject) };
  } else {
    named = {};
    const entries = Object.entries(mapping(a.credentials));
    check(entries.length >= 1 && entries.length <= 8, "Declare between one and eight credentials.");
    for (const [name, declared] of entries) {
      check(allowedName(name, id), "Invalid credential name.");
      named[name] = { inject: parseInject(keys(declared, ["inject"]).inject) };
    }
  }
  const routes: AgentAccess["routes"] = {};
  for (const [name, declaration] of Object.entries(mapping(a.routes))) {
    check(allowedName(name, id), "Invalid route ID.");
    const route = parseRoute(declaration);
    check(
      named ? route.credential !== undefined && Object.hasOwn(named, route.credential) : route.credential === undefined,
      "With credentials, each route names one of them; with one credential, routes name none.",
    );
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
    // A grant carries one app credential, so granting a record role never carries a setup role's key.
    check(new Set(roleRoutes.map((key) => routes[key]!.credential)).size <= 1, "A role's routes all use one credential.");
    roles[name] = { title: role.title, routes: roleRoutes };
  }
  return { ...(single ? { credential: single } : { credentials: named }), roles, routes };
}
/** The credentials a kit declares, by name in sorted order (a stored kit's keys don't keep theirs): a kit with one `credential` names it by its binding. */
export function credentialNames(access: AgentAccess): string[] {
  return access.credentials ? Object.keys(access.credentials).sort() : access.credential ? [access.credential.binding] : [];
}
/** The name and injection of the credential a route is sent with. */
export function routeCredential(access: AgentAccess, route: AgentRoute): { name: string; inject: Inject } {
  if (access.credentials) {
    const name = route.credential!;
    return { name, inject: access.credentials[name]!.inject };
  }
  return { name: access.credential!.binding, inject: access.credential!.inject };
}
/** The credential a role's routes use, or none for a role with no routes. */
export function roleCredential(access: AgentAccess, role: string): string | undefined {
  const first = access.roles[role]?.routes[0];
  return first && access.routes[first] ? routeCredential(access, access.routes[first]).name : undefined;
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
): { method: string; path: string; headers: Record<string, string>; body?: string } {
  const values = keys(input === undefined ? {} : input, ["path", "query", "body"]);
  // A write's body is the agent's JSON, sent as it is: the app checks it. Only its size is limited here.
  let body: string | undefined;
  if (values.body !== undefined) {
    check(isWrite(route), "A read takes no body.");
    try {
      body = JSON.stringify(values.body);
    } catch {
      // Not JSON.
    }
    check(typeof body === "string", "The body must be JSON.");
    check(Buffer.byteLength(body) <= AGENT_BODY_LIMIT, "The body is larger than 32 KiB.");
  }
  const params = validateInput(route.pathParams ?? {}, values.path === undefined ? {} : values.path);
  const query = validateInput(route.queryFields ?? {}, values.query === undefined ? {} : values.query);
  let path = route.path.replace(/\{([^{}]+)\}/g, (_, k: string) => {
    check(Object.hasOwn(params, k), "Missing path parameter.");
    const value = String(params[k]);
    check(/^[A-Za-z0-9_~-][A-Za-z0-9_.~-]{0,255}$/.test(value), "Invalid path parameter.");
    return value;
  });
  const search = new URLSearchParams();
  for (const key of Object.keys(query).sort()) search.set(key, String(query[key]));
  if (search.size) path += "?" + search.toString();
  return { method: route.method, path, headers: {}, ...(body === undefined ? {} : { body }) };
}
export function agentCredentialHeader(inject: Inject, secret: string): Record<string, string> {
  check(typeof secret === "string" && /^[\x21-\x7e]{1,8192}$/.test(secret), "Invalid app credential.");
  const { name, scheme } = inject;
  return { [name]: scheme ? scheme + " " + secret : secret };
}
const JSON_ESCAPE = /\\(?:u([\da-fA-F]{4})|(["\\/bfnrt]))/g;
const ESCAPED: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
/**
 * A JSON writer doubles the backslashes of each escape it nests, so undoing the escapes of a result
 * within AGENT_RESULT_LIMIT takes at most log2(AGENT_RESULT_LIMIT) = 18 passes. A result that still
 * changes after this many was escaped some other way, such as \ for each backslash, and is
 * refused, so a crafted one can't make the check run a pass per character.
 */
const ESCAPE_PASSES = 32;
/** Undoes one level of JSON string escaping wherever it appears in the text. */
function unescapeJson(text: string): string {
  return text.replace(JSON_ESCAPE, (_, hex: string | undefined, char: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : (ESCAPED[char] ?? char),
  );
}
/**
 * The app's response, for the agent, as it came: any JSON the app returns, of at most
 * AGENT_RESULT_LIMIT bytes, and never one that contains the app credential.
 */
export function passAgentResult(data: unknown, secrets: readonly string[]): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(data);
  } catch {
    // A cycle or a BigInt isn't JSON.
  }
  check(typeof text === "string", "Unsupported app result.");
  check(Buffer.byteLength(text) <= AGENT_RESULT_LIMIT, "App result is too large.");
  // Upstreams can echo a token anywhere: in a value or a key, in a diagnostic string, or in JSON
  // encoded as text, with any of JSON's escapes. Each pass undoes one level of escaping, so a secret
  // escaped as text inside text shows once the passes reach its level.
  let view = text;
  for (let pass = 0; ; pass++) {
    check(!secrets.some((secret) => secret && view.includes(secret)), "Unsafe app result.");
    const next = unescapeJson(view);
    if (next === view) break;
    check(pass < ESCAPE_PASSES, "Unsafe app result.");
    view = next;
  }
  // What the agent gets is exactly the JSON that was checked.
  return JSON.parse(text);
}
