import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapt, imageRef, pinnedImage, type AppSpec } from "../src/adapter.ts";

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
  },
  interface: { service: "web", port: 3000 },
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
  });

  it("puts every service on the sealed app network", () => {
    expect(services.web!.networks).toEqual({ app: {} });
    expect(services.worker!.networks).toEqual({ app: {} });
    const networks = result.adapted!.networks as Record<string, Record<string, unknown>>;
    expect(networks.app).toMatchObject({ internal: true, driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" } });
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
