// The Caddyfile a published app's Caddy runs (deploy/published.caddyfile): that it reads what the
// runtime manager sets, and what it does to the app's responses, with and without the owner showing
// the app inside Your Space (decision 2026-11-20). The browser tests check the same with Caddy itself.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapt, PUBLISH_TARGET } from "../src/adapter.ts";

const deploy = (file: string) => readFileSync(new URL(`../../deploy/${file}`, import.meta.url), "utf8");
const published = deploy("published.caddyfile");
const builtIn = deploy("Caddyfile");

/** The directives of a Caddyfile, without comments or blank lines. */
function directives(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Where a top-level block, such as a snippet `(frame_on) {`, starts and ends among the directives. */
function span(lines: string[], opening: string): [number, number] {
  const start = lines.indexOf(opening);
  if (start === -1) throw new Error(`No ${opening} block.`);
  return [start, lines.indexOf("}", start)];
}

/** The directives inside a top-level block. */
function block(text: string, opening: string): string[] {
  const lines = directives(text);
  const [start, end] = span(lines, opening);
  return lines.slice(start + 1, end);
}

/** The directives without a top-level block. */
function without(lines: string[], opening: string): string[] {
  const [start, end] = span(lines, opening);
  return [...lines.slice(0, start), ...lines.slice(end + 1)];
}

/** The words of a directive, with Caddy's double quotes taken off. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

type Headers = [string, string][];

const ORIGIN = "https://space.example.com";
/** The header_down lines a snippet would add to the reverse proxy, as Caddy reads them with YS_ORIGIN set. */
const snippet = (name: string) =>
  block(published, `(${name}) {`).map((l) => {
    if (!l.startsWith("header_down ")) throw new Error(`Unexpected directive ${l}`);
    return words(l.replaceAll("{$YS_ORIGIN}", ORIGIN)).slice(1);
  });

/**
 * A snippet's header_down lines applied to a response's headers, in the order Caddy applies header
 * operations: add, then delete, then replace. Real Caddy gives the same answers in the browser tests.
 */
function respond(headers: Headers, mode: "frame_on" | "frame_off"): Headers {
  const ops = snippet(mode);
  let out: Headers = headers.map(([n, v]) => [n, v]);
  for (const op of ops) if (op[0]!.startsWith("+")) out.push([op[0]!.slice(1), op[1]!]);
  for (const op of ops) if (op[0]!.startsWith("-")) out = out.filter(([n]) => n.toLowerCase() !== op[0]!.slice(1).toLowerCase());
  for (const op of ops) {
    if (op.length !== 3) continue;
    const [name, search, replacement] = op as [string, string, string];
    out = out.map(([n, v]) => [n, n.toLowerCase() === name.toLowerCase() ? v.replace(new RegExp(search, "g"), replacement) : v]);
  }
  return out;
}

const all = (headers: Headers, name: string) => headers.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
/** Every frame-ancestors directive in the headers' policies. */
const ancestors = (headers: Headers) =>
  all(headers, "Content-Security-Policy").flatMap((p) =>
    p
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.startsWith("frame-ancestors")),
  );

// What apps send about framing: nothing, X-Frame-Options alone, a policy without frame-ancestors, and
// a policy that refuses every frame alongside X-Frame-Options.
const APPS: Record<string, Headers> = {
  "says nothing": [["Content-Type", "text/html"]],
  "sends X-Frame-Options: DENY": [["X-Frame-Options", "DENY"]],
  "sends X-Frame-Options: SAMEORIGIN": [["X-Frame-Options", "SAMEORIGIN"]],
  "has a policy without frame-ancestors": [["Content-Security-Policy", "default-src 'self'; img-src *"]],
  "refuses with frame-ancestors 'none'": [
    ["X-Frame-Options", "DENY"],
    ["Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; img-src *"],
    ["Set-Cookie", "sid=abc; Path=/; HttpOnly; SameSite=Lax"],
  ],
};

describe("a published app shown inside Your Space", () => {
  for (const [app, headers] of Object.entries(APPS)) {
    it(`lets only Your Space's origin frame an app that ${app}`, () => {
      const answer = respond(headers, "frame_on");
      expect(all(answer, "X-Frame-Options")).toEqual([]);
      const found = ancestors(answer);
      expect(found.length).toBeGreaterThan(0);
      // Every policy the browser enforces names only Your Space's origin: not 'self', not *.
      for (const directive of found) expect(directive).toBe(`frame-ancestors ${ORIGIN}`);
    });
  }

  it("keeps the rest of the app's policy, its cookies and its other headers", () => {
    const answer = respond(APPS["refuses with frame-ancestors 'none'"]!, "frame_on");
    expect(all(answer, "Content-Security-Policy")).toEqual([`default-src 'self'; frame-ancestors ${ORIGIN}; img-src *`, `frame-ancestors ${ORIGIN}`]);
    expect(all(answer, "Set-Cookie")).toEqual(["sid=abc; Path=/; HttpOnly; SameSite=Lax"]);
    expect(respond(APPS["has a policy without frame-ancestors"]!, "frame_on")).toEqual([
      ["Content-Security-Policy", "default-src 'self'; img-src *"],
      ["Content-Security-Policy", `frame-ancestors ${ORIGIN}`],
    ]);
    expect(respond(APPS["says nothing"]!, "frame_on")).toEqual([
      ["Content-Type", "text/html"],
      ["Content-Security-Policy", `frame-ancestors ${ORIGIN}`],
    ]);
  });

  it("follows the rule Your Space's own Caddy applies at an app's built-in address", () => {
    const framing = (lines: string[]) => lines.filter((l) => /^header_down [-+]?(X-Frame-Options|Content-Security-Policy)\b/.test(l));
    expect(block(published, "(frame_on) {")).toEqual(framing(directives(builtIn)));
    expect(framing(directives(builtIn))).toHaveLength(3);
  });
});

describe("a published app not shown inside Your Space", () => {
  for (const [app, headers] of Object.entries(APPS)) {
    it(`passes on the headers of an app that ${app} as the app sent them`, () => {
      expect(respond(headers, "frame_off")).toEqual(headers);
    });
  }

  it("is how the Caddy runs when nothing says otherwise", () => {
    expect(snippet("frame_off")).toEqual([]);
    expect(directives(published)).toContain("import frame_{$YS_FRAME:off}");
  });
});

describe("a published app's Caddyfile", () => {
  const spec = { project: "ys-web", app: "web", installation: "your-space", compose: "", env: {}, interface: { service: "web", port: 80 } };
  const caddy = { image: `sha256:${"f".repeat(64)}`, origin: ORIGIN };
  const service = (frame: boolean) =>
    (adapt({ ...spec, publish: { port: 8081, bind: "127.0.0.1", frame } }, { services: { web: { image: "nginx" } } }, [], caddy).adapted!.services as Record<
      string,
      { command: string[]; environment: Record<string, string> }
    >)["ys-publish"]!;

  it("is the file the runtime manager runs, listening where Docker publishes the port", () => {
    expect(service(true).command).toContain("/etc/caddy/published.caddyfile");
    expect(directives(published)).toContain(`:${PUBLISH_TARGET} {`);
    expect(directives(published)).toContain(`servers :${PUBLISH_TARGET} {`);
  });

  it("reads only what the runtime manager sets", () => {
    const read = [...new Set([...published.matchAll(/\{\$([A-Z_]+)(?::[^}]*)?\}/g)].map((m) => m[1]!))].sort();
    expect(read).toEqual(["YS_FRAME", "YS_ORIGIN", "YS_UPSTREAM"]);
    expect(service(true).environment).toMatchObject({ YS_UPSTREAM: "ys-web-ui:80", YS_FRAME: "on", YS_ORIGIN: ORIGIN });
    expect(service(false).environment).toMatchObject({ YS_UPSTREAM: "ys-web-ui:80", YS_FRAME: "off" });
    expect(service(false).environment.YS_ORIGIN).toBeUndefined();
    expect(directives(published)).toContain("reverse_proxy {$YS_UPSTREAM} {");
  });

  it("changes the app's responses only through the framing snippets", () => {
    const outside = without(without(directives(published), "(frame_on) {"), "(frame_off) {");
    const changes = outside.filter((l) => /^(header|header_down|header_up|request_header|encode|request_body|respond|redir|rewrite|handle_response|intercept)\b/.test(l));
    expect(changes).toEqual([]);
    expect(outside.filter((l) => l.startsWith("import"))).toEqual(["import frame_{$YS_FRAME:off}"]);
  });

  it("trusts forwarded headers only from this machine, private networks and Tailscale's addresses", () => {
    expect(directives(published)).toContain("trusted_proxies static 127.0.0.0/8 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7 100.64.0.0/10");
    expect(directives(published).filter((l) => l.startsWith("trusted_proxies"))).toHaveLength(1);
  });

  it("streams responses, and has no admin API or certificates", () => {
    expect(directives(published)).toEqual(expect.arrayContaining(["flush_interval -1", "admin off", "persist_config off", "auto_https off"]));
  });
});
