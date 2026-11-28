// The declaration lives in the pinned installation kit. Agent access is per app (spec 018): a kit
// says where the app's API lives (`api`) and how its credentials are sent, and lists no roles or
// routes. A grant gives an agent that API with the bound credential the owner picks for it; the
// credential's own role in the app limits what the agent can do. This module checks an agent's call
// (its method, its path under the API, its query and body) and matches the owner's routes that ask.
// The app's JSON response reaches the agent unchanged (decision 2026-11-24).
export const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
export type Method = (typeof METHODS)[number];
/** The largest body, in bytes of JSON, that a call sends to the app. */
export const AGENT_BODY_LIMIT = 32 * 1024;
/** The largest app result, in bytes of JSON, that an agent gets; the transport stops reading past it. */
export const AGENT_RESULT_LIMIT = 256 * 1024;
const PATH_LIMIT = 2048;
type Inject = { location: "header"; name: string; scheme?: "Bearer" };
/**
 * A kit names one `credential`, or several `credentials` the owner binds separately, so different
 * agents can use different app keys, such as a record key and an admin key.
 */
export interface AgentAccess {
  /** The path the app's API lives under, without a trailing slash; `/` for the whole app. */
  api: string;
  credential?: { binding: string; inject: Inject };
  credentials?: Record<string, { inject: Inject }>;
}
export class AgentKitError extends Error {}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new AgentKitError(message);
}
const id = /^[a-z][a-z0-9-]{0,63}$/;
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
export const OLD_FORMAT =
  "Agent access is per app: a kit names the path its API lives under with api, such as api: /rest, and its credential or credentials, and lists no roles or routes. Remove roles and routes and add api.";
/** RFC 3986 path characters, less `;`, which some apps read as path parameters and strip before routing. */
const PATH_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,=:@%/]*$/;
/** One segment of a path the owner writes, such as in `api` or a route that asks: no escapes, no `;`. */
const LITERAL_SEGMENT = /^[A-Za-z0-9\-._~!$&'()*+,=:@]+$/;
function parseApi(value: unknown): string {
  check(typeof value === "string" && value.startsWith("/") && value.length <= 256, "api must be a path starting with /.");
  const segments = value.slice(1).split("/");
  if (segments.at(-1) === "") segments.pop();
  check(
    segments.every((segment) => LITERAL_SEGMENT.test(segment) && segment !== "." && segment !== ".."),
    "api must be a plain path, such as /rest.",
  );
  return "/" + segments.join("/");
}
export function parseAgentAccess(value: unknown): AgentAccess {
  const declared = mapping(value);
  check(!Object.hasOwn(declared, "roles") && !Object.hasOwn(declared, "routes") && declared.api !== undefined, OLD_FORMAT);
  const a = keys(value, ["api", "credential", "credentials"]);
  check((a.credential === undefined) !== (a.credentials === undefined), "Declare either credential or credentials.");
  const api = parseApi(a.api);
  if (a.credential !== undefined) {
    const credential = keys(a.credential, ["binding", "inject"]);
    check(allowedName(credential.binding, id), "Invalid credential binding.");
    return { api, credential: { binding: credential.binding, inject: parseInject(credential.inject) } };
  }
  const credentials: NonNullable<AgentAccess["credentials"]> = {};
  const entries = Object.entries(mapping(a.credentials));
  check(entries.length >= 1 && entries.length <= 8, "Declare between one and eight credentials.");
  for (const [name, entry] of entries) {
    check(allowedName(name, id), "Invalid credential name.");
    credentials[name] = { inject: parseInject(keys(entry, ["inject"]).inject) };
  }
  return { api, credentials };
}
/**
 * The agent access a stored kit gives, or why it gives none. A kit stored before spec 018 lists roles
 * and routes and names no api: it stays as it is, with its app's agent access unavailable until the
 * app runs a kit that names api (spec 018 decision 11).
 */
export function storedAgentAccess(kit: unknown): { access: AgentAccess } | { problem: "old_format" } | undefined {
  const declared = (kit as { agentAccess?: Record<string, unknown> } | null)?.agentAccess;
  if (!declared) return undefined;
  if (typeof declared.api !== "string" || Object.hasOwn(declared, "roles") || Object.hasOwn(declared, "routes"))
    return { problem: "old_format" };
  return { access: declared as unknown as AgentAccess };
}
/** The credentials a kit declares, by name in sorted order (a stored kit's keys don't keep theirs): a kit with one `credential` names it by its binding. */
export function credentialNames(access: AgentAccess): string[] {
  return access.credentials ? Object.keys(access.credentials).sort() : access.credential ? [access.credential.binding] : [];
}
/** How the named credential is sent, or nothing when the kit doesn't name it. */
export function credentialInject(access: AgentAccess, name: string): Inject | undefined {
  if (access.credentials) return Object.hasOwn(access.credentials, name) ? access.credentials[name]!.inject : undefined;
  return access.credential?.binding === name ? access.credential.inject : undefined;
}
/** An agent's call, checked: what is sent, and the decoded path routes that ask are matched against. */
export interface AgentCall {
  method: Method;
  /** The path as sent: the agent's path, and its query encoded again. */
  target: string;
  /** The path's segments, decoded once, without a trailing empty one. */
  segments: string[];
  /** The method and decoded path, for Activity and for the owner; never the query. */
  label: string;
  body?: string;
}
export function parseCall(access: AgentAccess, input: { method: unknown; path: unknown; body?: unknown }): AgentCall {
  const method = input.method;
  check(typeof method === "string" && (METHODS as readonly string[]).includes(method), "Use GET, POST, PATCH, PUT or DELETE.");
  const raw = input.path;
  check(typeof raw === "string" && raw.startsWith("/") && raw.length <= PATH_LIMIT, "The path must start with / and be at most 2048 characters.");
  const mark = raw.indexOf("?");
  const path = mark < 0 ? raw : raw.slice(0, mark);
  check(PATH_CHARS.test(path) && !/%(?![\da-fA-F]{2})/.test(path), "The path has a character Your Space doesn't send, such as ; or a space.");
  const parts = path === "/" ? [] : path.slice(1).split("/");
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  const segments = parts.map((part) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new AgentKitError("The path has an invalid escape.");
    }
    // An app that decodes again mustn't see a path Your Space didn't check.
    check(part.length > 0 && decoded !== "." && decoded !== ".." && !/[/\\\0%;]/.test(decoded), "The path has an empty, dot or escaped segment.");
    return decoded;
  });
  const apiSegments = access.api === "/" ? [] : access.api.slice(1).split("/");
  check(
    segments.length >= apiSegments.length && apiSegments.every((segment, index) => segments[index] === segment),
    `The path must be under ${access.api}, where this app's API lives.`,
  );
  let target = path;
  if (mark >= 0) {
    const query = new URLSearchParams(raw.slice(mark + 1)).toString();
    if (query) target += "?" + query;
  }
  let body: string | undefined;
  if (input.body !== undefined) {
    check(method !== "GET", "A GET takes no body.");
    try {
      body = JSON.stringify(input.body);
    } catch {
      // Not JSON.
    }
    check(typeof body === "string", "The body must be JSON.");
    check(Buffer.byteLength(body) <= AGENT_BODY_LIMIT, "The body is larger than 32 KiB.");
  }
  return { method: method as Method, target, segments, label: method + " /" + segments.join("/"), ...(body === undefined ? {} : { body }) };
}
/** A route the owner set to ask first: a method and a path whose segments are literal or `*`. */
export interface AskRule {
  method: Method;
  path: string;
}
export function parseAskRules(value: unknown): AskRule[] {
  // At most as many as a 017 kit had routes, so every grant the 0019 migration carries over fits.
  check(Array.isArray(value) && value.length <= 128, "List at most 128 routes that ask.");
  const rules: AskRule[] = [];
  for (const entry of value) {
    const rule = keys(entry, ["method", "path"]);
    check(typeof rule.method === "string" && (METHODS as readonly string[]).includes(rule.method), "A route that asks names GET, POST, PATCH, PUT or DELETE.");
    check(typeof rule.path === "string" && rule.path.startsWith("/") && rule.path.length <= 512, "A route that asks has a path starting with /.");
    const segments = rule.path === "/" ? [] : rule.path.slice(1).split("/");
    if (segments.length > 1 && segments.at(-1) === "") segments.pop();
    check(
      segments.every((segment) => segment === "*" || (LITERAL_SEGMENT.test(segment) && segment !== "." && segment !== "..")),
      "A route that asks has plain path segments, or * for one segment.",
    );
    const normalized = { method: rule.method as Method, path: "/" + segments.join("/") };
    if (!rules.some((r) => r.method === normalized.method && r.path === normalized.path)) rules.push(normalized);
  }
  return rules;
}
/**
 * Whether a call asks first. A rule matches its method and each decoded segment, `*` matching any
 * one, ignoring letter case and a trailing slash: matching too much only asks once more.
 */
export function asksFirst(rules: readonly AskRule[], call: AgentCall): boolean {
  return rules.some((rule) => {
    if (rule.method !== call.method) return false;
    const segments = rule.path === "/" ? [] : rule.path.slice(1).split("/");
    const called = call.segments;
    return (
      segments.length === called.length &&
      segments.every((segment, index) => segment === "*" || segment.toLowerCase() === called[index]!.toLowerCase())
    );
  });
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
