import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapt, egressConfig, imageRef, pinnedImage, type AppSpec } from "../src/adapter.ts";
import { parseDenials } from "../src/apps.ts";

// Sure's compose.example.yml at 70647cb, resolved by `docker compose -p ys-sure config --format json`.
const sure = JSON.parse(readFileSync(new URL("./sure-resolved.json", import.meta.url), "utf8")) as Record<string, unknown>;

const spec: AppSpec = {
  project: "ys-sure",
  app: "sure",
  installation: "your-space",
  compose: "",
  env: {},
  pins: {
    "ghcr.io/we-promise/sure:stable": "sha256:aaa",
    "postgres:16": "sha256:bbb",
    "redis:latest": "sha256:ccc",
    "ubuntu/squid:latest": "sha256:ddd",
  },
  interface: { service: "web", port: 3000 },
  egress: ["API.openai.com"],
};

type Service = Record<string, unknown> & { environment: Record<string, string> };

function withService(service: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return adapt({ ...spec, interface: null }, { services: { app: { image: "busybox:1.37", ...service } }, ...top });
}

describe("Sure's own file", () => {
  const result = adapt(spec, sure, ["backup", "backup-offsite"]);
  const services = result.adapted!.services as Record<string, Service>;

  it("is accepted, with the changes reported", () => {
    expect(result.refusals).toEqual([]);
    const details = result.adaptations.map((a) => `${a.service}: ${a.kind}`);
    expect(details).toContain("web: changed");
    expect(details).toContain("backup: left_out");
    expect(details).toContain("backup-offsite: left_out");
    expect(details).toContain("ys-egress: added");
    expect(result.adaptations.some((a) => a.service === "web" && /Published ports/.test(a.detail))).toBe(true);
    expect(result.adaptations.some((a) => a.service === "web" && /DNS/.test(a.detail))).toBe(true);
  });

  it("publishes no ports and keeps no fixed DNS servers", () => {
    for (const service of Object.values(services)) {
      expect(service.ports).toBeUndefined();
      expect(service.dns).toBeUndefined();
    }
  });

  it("pins every image by digest", () => {
    expect(services.web!.image).toBe("ghcr.io/we-promise/sure@sha256:aaa");
    expect(services.db!.image).toBe("postgres@sha256:bbb");
    expect(services.redis!.image).toBe("redis@sha256:ccc");
    expect(services["ys-egress"]!.image).toBe("ubuntu/squid@sha256:ddd");
  });

  it("puts every service on the sealed app network, with the interface's alias", () => {
    expect(services.web!.networks).toEqual({ app: { aliases: ["ys-sure-ui"] } });
    expect(services.worker!.networks).toEqual({ app: {} });
    const networks = result.adapted!.networks as Record<string, Record<string, unknown>>;
    expect(networks.app).toMatchObject({ internal: true, driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" } });
    expect(services["ys-egress"]!.networks).toEqual({ app: {}, egress: {} });
  });

  it("sends outbound requests through the egress proxy, but not requests between its own services", () => {
    expect(services.web!.environment.HTTPS_PROXY).toBe("http://ys-egress:3128");
    expect(services.web!.environment.no_proxy).toBe("localhost,127.0.0.1,db,redis,web,worker");
  });

  it("escapes $ so Compose doesn't interpolate the resolved file again", () => {
    const test = (services.db!.healthcheck as { test: string[] }).test;
    expect(test.join(" ")).toContain("$$POSTGRES_USER");
  });

  it("limits every service and makes apps the first to go when memory runs out", () => {
    for (const service of Object.values(services)) {
      expect(service.mem_limit).toBeGreaterThan(0);
      expect(service.cpus).toBeGreaterThan(0);
      expect(service.oom_score_adj).toBe(500);
      expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    }
  });

  it("labels everything with the installation and the app", () => {
    expect((services.web!.labels as Record<string, string>)["ai.your-space.installation"]).toBe("your-space");
    expect((result.adapted!.volumes as Record<string, { labels: Record<string, string> }>)["postgres-data"]!.labels["ai.your-space.app"]).toBe("sure");
  });

  it("gives the egress proxy only the approved hosts, in lower case", () => {
    const content = (result.adapted!.configs as { egress: { content: string } }).egress.content;
    expect(content).toContain("acl approved dstdomain api.openai.com");
  });
});

describe("refusals", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>?][] = [
    ["privileged", { privileged: true }],
    ["devices", { devices: [{ source: "/dev/kvm", target: "/dev/kvm" }] }],
    ["cap_add", { cap_add: ["NET_ADMIN"] }],
    ["network_mode", { network_mode: "host" }],
    ["pid", { pid: "host" }],
    ["volumes", { volumes: [{ type: "bind", source: "/", target: "/host" }] }],
    ["volumes", { volumes: [{ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }] }],
    ["sysctls", { sysctls: { "net.ipv4.ip_forward": "1" } }],
    ["security_opt", { security_opt: ["seccomp:unconfined"] }],
    ["something_new", { something_new: true }],
    ["volumes.data", {}, { volumes: { data: { driver_opts: { type: "none", o: "bind", device: "/etc" } } } }],
    ["volumes.data", {}, { volumes: { data: { external: true } } }],
    ["networks.shared", {}, { networks: { shared: { external: true } } }],
  ];
  for (const [setting, service, top] of cases) {
    it(`refuses ${setting} ${JSON.stringify(service)}${top ? JSON.stringify(top) : ""}`, () => {
      const result = withService(service, top);
      expect(result.adapted).toBeNull();
      expect(result.refusals.map((r) => r.setting)).toContain(setting);
      expect(result.refusals.every((r) => r.reason.length > 0)).toBe(true);
    });
  }

  it("refuses a build without an image, and uses the image when both are given", () => {
    expect(adapt(spec, { services: { app: { build: { context: "." } } } }).adapted).toBeNull();
    const both = withService({ build: { context: "." } });
    expect(both.refusals).toEqual([]);
    expect((both.adapted!.services as Record<string, Service>).app!.build).toBeUndefined();
  });

  it("keeps private namespaces, dropped capabilities and no-new-privileges", () => {
    const result = withService({ ipc: "private", cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], privileged: false });
    expect(result.refusals).toEqual([]);
  });

  it("reserves the egress proxy's name", () => {
    expect(adapt(spec, { services: { "ys-egress": { image: "busybox" } } }).refusals.map((r) => r.setting)).toContain("services");
  });

  it("refuses a kit whose interface service isn't in the file", () => {
    const result = adapt({ ...spec, interface: { service: "ui", port: 80 } }, { services: { app: { image: "busybox" } } });
    expect(result.refusals.map((r) => r.setting)).toContain("interface");
  });
});

describe("images", () => {
  it("names references with an explicit tag", () => {
    expect(imageRef("redis")).toBe("redis:latest");
    expect(imageRef("localhost:5000/app")).toBe("localhost:5000/app:latest");
    expect(imageRef("ghcr.io/a/b:1.2@sha256:x")).toBe("ghcr.io/a/b:1.2");
    expect(pinnedImage("ghcr.io/a/b:1.2", "sha256:x")).toBe("ghcr.io/a/b@sha256:x");
  });
});

describe("egress", () => {
  it("denies private addresses before anything is allowed, and everything else after", () => {
    const content = egressConfig(["example.com"]);
    expect(content.indexOf("http_access deny private")).toBeLessThan(content.indexOf("http_access allow approved"));
    expect(content.trim().endsWith("http_access deny all")).toBe(true);
    expect(egressConfig([])).not.toContain("allow");
  });

  it("reads denied hosts from Squid's log", () => {
    const log = [
      "1794681656.693      2 172.21.0.2 TCP_MISS/200 468 GET http://ok-web/ - HIER_DIRECT/172.20.0.2 text/plain",
      "1794681656.695      0 172.21.0.2 TCP_DENIED/403 3375 GET http://no-web/ - HIER_NONE/- text/html",
      "1794681657.000      0 172.21.0.2 TCP_DENIED/403 3375 CONNECT API.Example.com:443 - HIER_NONE/- text/html",
      "1794681658.000      0 172.21.0.2 TCP_DENIED/403 3375 CONNECT api.example.com:443 - HIER_NONE/- text/html",
      "1794681658.000      0 172.21.0.2 TCP_DENIED/403 3375 CONNECT 10.0.0.1:443 - HIER_NONE/- text/html",
    ].join("\n");
    expect(parseDenials(log)).toEqual([
      { host: "no-web", attempts: 1, lastSeen: new Date(1794681656695).toISOString() },
      { host: "api.example.com", attempts: 2, lastSeen: new Date(1794681658000).toISOString() },
    ]);
  });
});
