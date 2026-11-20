// The Caddyfiles a published app's Caddy runs (deploy/published.caddyfile, and the framing rules it
// shares with Your Space's own Caddy in deploy/frame.caddyfile): what it does to an app's responses,
// and that it reads what the runtime manager sets. The browser tests check the same with Caddy itself.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapt, PUBLISH_TARGET } from "../src/adapter.ts";

const deploy = (file: string) => readFileSync(new URL(`../../deploy/${file}`, import.meta.url), "utf8");
const published = deploy("published.caddyfile");
const frame = deploy("frame.caddyfile");
const builtIn = deploy("Caddyfile");

/** The directives of a Caddyfile, without comments or blank lines. */
function directives(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** The words of a directive, with Caddy's double quotes taken off. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

type Headers = [string, string][];

/**
 * The only_framed_by snippet's header_down lines applied to a response's headers, imported with
 * `sources`, in the order Caddy applies header operations: add, then delete, then replace.
 */
function framed(headers: Headers, sources: string): Headers {
  const ops = directives(frame.slice(frame.indexOf("(only_framed_by) {"))).filter((l) => l.startsWith("header_down ")).map((l) => words(l).slice(1));
  const value = (v: string) => v.replaceAll("{args[0]}", sources);
  let out: Headers = headers.map(([n, v]) => [n, v]);
  for (const op of ops) if (op[0]!.startsWith("+")) out.push([op[0]!.slice(1), value(op[1]!)]);
  for (const op of ops) if (op[0]!.startsWith("-")) out = out.filter(([n]) => n.toLowerCase() !== op[0]!.slice(1).toLowerCase());
  for (const op of ops) {
    if (op.length !== 3) continue;
    const [name, search, replacement] = op as [string, string, string];
    out = out.map(([n, v]) => [n, n.toLowerCase() === name.toLowerCase() ? v.replace(new RegExp(search, "g"), value(replacement)) : v]);
  }
  return out;
}

const all = (headers: Headers, name: string) => headers.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
/** Every frame-ancestors directive in the headers' policies. */
const ancestors = (headers: Headers) => all(headers, "Content-Security-Policy").flatMap((p) => p.split(";").map((d) => d.trim()).filter((d) => d.startsWith("frame-ancestors")));

describe("a published app's responses", () => {
  // As published.caddyfile imports the rules, with the origin the runtime manager sets.
  const sources = /import only_framed_by "([^"]*)"/.exec(published)![1]!.replace("{$YS_ORIGIN}", "https://space.example.com");

  it("lets only Your Space's origin, and the app itself, frame an app that refuses to be framed", () => {
    const answer = framed(
      [
        ["X-Frame-Options", "DENY"],
        ["Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; img-src *"],
        ["Content-Type", "text/html"],
      ],
      sources,
    );
    expect(all(answer, "X-Frame-Options")).toEqual([]);
    expect(ancestors(answer)).toEqual(["frame-ancestors https://space.example.com 'self'", "frame-ancestors https://space.example.com 'self'"]);
    // The rest of the app's policy and its other headers stay as they were.
    expect(all(answer, "Content-Security-Policy")[0]).toBe("default-src 'self'; frame-ancestors https://space.example.com 'self'; img-src *");
    expect(all(answer, "Content-Type")).toEqual(["text/html"]);
  });

  it("gives an app that says nothing about framing a policy that lets only Your Space and the app frame it", () => {
    const answer = framed([["X-Frame-Options", "SAMEORIGIN"]], sources);
    expect(answer).toEqual([["Content-Security-Policy", "frame-ancestors https://space.example.com 'self'"]]);
  });

  it("changes nothing else about the app's responses", () => {
    const changes = directives(published).filter((l) => /^(header|header_down|header_up|request_header|encode|request_body|respond|redir|rewrite)\b/.test(l));
    expect(changes).toEqual([]);
    expect(directives(frame).filter((l) => l.startsWith("header"))).toEqual([
      "header_down -X-Frame-Options",
      'header_down Content-Security-Policy "frame-ancestors[^;]*" "frame-ancestors {args[0]}"',
      'header_down +Content-Security-Policy "frame-ancestors {args[0]}"',
    ]);
  });
});

describe("the two ways to an app", () => {
  it("share the framing rules; an app's built-in address lets only Your Space frame it", () => {
    for (const file of [published, builtIn]) expect(directives(file)).toContain("import frame.caddyfile");
    expect(directives(builtIn)).toContain("import only_framed_by {$YS_ORIGIN}");
    expect(directives(published)).toContain(`import only_framed_by "{$YS_ORIGIN} 'self'"`);
    expect(builtIn).not.toMatch(/header_down\s+-X-Frame-Options/);
  });
});

describe("a published app's Caddyfile", () => {
  const caddy = { image: `sha256:${"f".repeat(64)}`, origin: "https://space.example.com" };
  const spec = { project: "ys-web", app: "web", installation: "your-space", compose: "", env: {}, interface: { service: "web", port: 80 }, publish: { port: 8081, bind: "127.0.0.1" } };
  const service = (adapt(spec, { services: { web: { image: "nginx" } } }, [], caddy).adapted!.services as Record<string, { command: string[]; environment: Record<string, string> }>)["ys-publish"]!;

  it("is the file the runtime manager runs, listening where Docker publishes the port", () => {
    expect(service.command).toContain("/etc/caddy/published.caddyfile");
    expect(directives(published)).toContain(`:${PUBLISH_TARGET} {`);
    expect(directives(published)).toContain(`servers :${PUBLISH_TARGET} {`);
  });

  it("reads the upstream and origin the runtime manager sets", () => {
    for (const name of [...published.matchAll(/\{\$([A-Z_]+)\}/g)].map((m) => m[1]!)) expect(Object.keys(service.environment)).toContain(name);
    expect(directives(published)).toContain("reverse_proxy {$YS_UPSTREAM} {");
  });

  it("passes the proxy's forwarded headers on, streams responses, and has no admin API", () => {
    expect(directives(published)).toEqual(expect.arrayContaining(["trusted_proxies static 0.0.0.0/0 ::/0", "flush_interval -1", "admin off", "auto_https off"]));
  });
});
