// The Caddyfile a published app's Caddy runs (deploy/published.caddyfile): that it reads what the
// runtime manager sets, and passes the app's responses on unchanged. The browser tests check the same
// with Caddy itself.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapt, PUBLISH_TARGET } from "../src/adapter.ts";

const published = readFileSync(new URL("../../deploy/published.caddyfile", import.meta.url), "utf8");

/** The directives of a Caddyfile, without comments or blank lines. */
const directives = published
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe("a published app's Caddyfile", () => {
  const spec = { project: "ys-web", app: "web", installation: "your-space", compose: "", env: {}, interface: { service: "web", port: 80 }, publish: { port: 8081, bind: "127.0.0.1" } };
  const service = (adapt(spec, { services: { web: { image: "nginx" } } }, [], `sha256:${"f".repeat(64)}`).adapted!.services as Record<
    string,
    { command: string[]; environment: Record<string, string> }
  >)["ys-publish"]!;

  it("is the file the runtime manager runs, listening where Docker publishes the port", () => {
    expect(service.command).toContain("/etc/caddy/published.caddyfile");
    expect(directives).toContain(`:${PUBLISH_TARGET} {`);
    expect(directives).toContain(`servers :${PUBLISH_TARGET} {`);
  });

  it("reads only what the runtime manager sets", () => {
    const read = [...published.matchAll(/\{\$([A-Z_]+)\}/g)].map((m) => m[1]!);
    expect(read).toEqual(["YS_UPSTREAM"]);
    for (const name of read) expect(Object.keys(service.environment)).toContain(name);
    expect(directives).toContain("reverse_proxy {$YS_UPSTREAM} {");
  });

  it("changes nothing in the app's responses, its framing rules included", () => {
    const changes = directives.filter((l) => /^(import|header|header_down|header_up|request_header|encode|request_body|respond|redir|rewrite|handle_response|intercept)\b/.test(l));
    expect(changes).toEqual([]);
  });

  it("trusts forwarded headers only from this machine, private networks and Tailscale's addresses", () => {
    expect(directives).toContain("trusted_proxies static 127.0.0.0/8 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7 100.64.0.0/10");
    expect(directives.filter((l) => l.startsWith("trusted_proxies"))).toHaveLength(1);
  });

  it("streams responses, and has no admin API or certificates", () => {
    expect(directives).toEqual(expect.arrayContaining(["flush_interval -1", "admin off", "persist_config off", "auto_https off"]));
  });
});
