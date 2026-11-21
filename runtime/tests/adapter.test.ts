import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapt, egressConfig, imageRef, pinnedImage, restartPolicy, type AppSpec } from "../src/adapter.ts";
import { parseDenials, SpecError, validateSpec } from "../src/apps.ts";

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

  it("changes only the declared interface service when opting an existing app into agent access", () => {
    const id = "656f43f0-8780-42a2-ac44-0b8e546a8c51";
    const next = adapt({ ...spec, appId: id }, sure, ["backup", "backup-offsite"]).adapted!.services as Record<string, Service>;
    expect(next.web).toEqual({
      ...services.web,
      labels: { ...(services.web!.labels as object), "ai.your-space.app-id": id, "ai.your-space.interface-port": "3000" },
    });
    for (const name of Object.keys(services).filter((name) => name !== "web")) {
      expect(next[name]).toEqual(services[name]);
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

  it("starts each service once the outbound proxy answers, keeping the file's own order", () => {
    expect(services.web!.depends_on).toMatchObject({
      db: { condition: "service_healthy" },
      redis: { condition: "service_healthy" },
      "ys-egress": { condition: "service_healthy" },
    });
    expect(services.redis!.depends_on).toEqual({ "ys-egress": { condition: "service_healthy", required: true } });
    expect(services["ys-egress"]!.depends_on).toBeUndefined();
    expect(services["ys-egress"]!.healthcheck).toBeDefined();
  });

  it("labels everything with the installation and the app", () => {
    expect((services.web!.labels as Record<string, string>)["ai.your-space.installation"]).toBe("your-space");
    expect((result.adapted!.volumes as Record<string, { labels: Record<string, string> }>)["postgres-data"]!.labels["ai.your-space.app"]).toBe("sure");
  });

  it("recreates the egress proxy when its approved hosts change", () => {
    const label = (hosts: string[]) =>
      ((adapt({ ...spec, egress: hosts }, sure).adapted!.services as Record<string, Service>)["ys-egress"]!.labels as Record<string, string>)["ai.your-space.egress-config"];
    expect(label(["a.example"])).toBe(label(["a.example"]));
    expect(label(["a.example"])).not.toBe(label(["a.example", "b.example"]));
  });

  it("caps the egress proxy's open files, whatever the machine's Docker allows", () => {
    expect(services["ys-egress"]!.ulimits).toEqual({ nofile: { soft: 4096, hard: 4096 } });
    expect((result.adapted!.configs as { egress: { content: string } }).egress.content).toContain("max_filedescriptors 4096");
  });

  it("gives the egress proxy only the approved hosts, in lower case", () => {
    const content = (result.adapted!.configs as { egress: { content: string } }).egress.content;
    expect(content).toContain("acl approved dstdomain api.openai.com");
  });
});

describe("publishing the interface on a port", () => {
  const caddy = { image: `sha256:${"f".repeat(64)}`, origin: "https://space.example.com" };
  const published = adapt({ ...spec, publish: { port: 3000, bind: "127.0.0.1" } }, sure, [], caddy);
  const services = published.adapted!.services as Record<string, Service>;
  const networks = published.adapted!.networks as Record<string, Record<string, unknown>>;

  it("reports the machine's ports the file publishes for each service", () => {
    expect(published.services.find((s) => s.name === "web")!.published).toEqual([{ target: 3000, host: 3000 }]);
    expect(published.services.find((s) => s.name === "db")!.published).toEqual([]);
  });

  it("publishes only a Caddy of Your Space's, never an app's own service", () => {
    expect(published.refusals).toEqual([]);
    const proxy = services["ys-publish"]!;
    expect(proxy.ports).toEqual([{ target: 8080, published: "3000", host_ip: "127.0.0.1", protocol: "tcp" }]);
    expect((proxy.labels as Record<string, string>)["ai.your-space.role"]).toBe("publish");
    for (const [name, service] of Object.entries(services)) if (name !== "ys-publish") expect(service.ports).toBeUndefined();
  });

  it("runs Your Space's own Caddy image with the published Caddyfile, to the interface, framed by nobody else's rules", () => {
    const proxy = services["ys-publish"]!;
    expect(proxy.image).toBe(caddy.image);
    expect(proxy.command).toEqual(["caddy", "run", "--config", "/etc/caddy/published.caddyfile", "--adapter", "caddyfile"]);
    // Without `frame`, the app's own framing rules stand.
    expect(proxy.environment).toEqual({ YS_UPSTREAM: "ys-sure-ui:3000", YS_FRAME: "off", XDG_DATA_HOME: "/tmp/data", XDG_CONFIG_HOME: "/tmp/config" });
    expect((proxy.labels as Record<string, string>)["ai.your-space.frame-origin"]).toBeUndefined();
  });

  it("lets only Your Space's origin frame an app the owner shows inside Your Space, and labels the Caddy with it", () => {
    const framed = adapt({ ...spec, publish: { port: 3000, bind: "127.0.0.1", frame: true } }, sure, [], caddy);
    const proxy = (framed.adapted!.services as Record<string, Service>)["ys-publish"]!;
    expect(proxy.environment).toEqual({ YS_UPSTREAM: "ys-sure-ui:3000", YS_FRAME: "on", YS_ORIGIN: "https://space.example.com", XDG_DATA_HOME: "/tmp/data", XDG_CONFIG_HOME: "/tmp/config" });
    expect((proxy.labels as Record<string, string>)["ai.your-space.frame-origin"]).toBe("https://space.example.com");
    // Not the app's outbound proxy: it only answers on the machine's port.
    expect(proxy.environment.HTTP_PROXY).toBeUndefined();
    expect(framed.adaptations.find((a) => a.service === "ys-publish")!.detail).toBe("Added Your Space's Caddy, which publishes the app's interface on 127.0.0.1:3000 and lets only Your Space frame it.");
    // An app not shown inside Your Space needs no origin.
    expect(adapt({ ...spec, publish: { port: 3000, bind: "127.0.0.1", frame: false } }, sure, [], { image: caddy.image }).refusals).toEqual([]);
  });

  it("refuses to show an app inside Your Space when Your Space's Caddy names no origin", () => {
    const refused = adapt({ ...spec, publish: { port: 3000, bind: "127.0.0.1", frame: true } }, sure, [], { image: caddy.image });
    expect(refused.adapted).toBeNull();
    expect(refused.refusals).toEqual([{ service: "", setting: "publish", reason: "Your Space's Caddy has no origin set, so the app can't be shown inside Your Space. Turn that off for it." }]);
  });

  it("is hardened: nobody's user, a read-only root with memory for Caddy's files, no capabilities, its own limits", () => {
    expect(services["ys-publish"]).toMatchObject({
      user: "65534:65534",
      read_only: true,
      tmpfs: ["/tmp"],
      environment: { XDG_DATA_HOME: "/tmp/data", XDG_CONFIG_HOME: "/tmp/config" },
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      mem_limit: 128 * 1024 * 1024,
      cpus: 0.5,
      restart: "unless-stopped",
    });
  });

  it("keeps the app's services on the sealed network, and only Your Space's Caddy on the network Docker publishes from", () => {
    expect(services["ys-publish"]!.networks).toEqual({ app: {}, publish: {} });
    expect(networks.publish).toMatchObject({ driver: "bridge" });
    expect(networks.publish!.internal).toBeUndefined();
    expect(networks.app).toMatchObject({ internal: true });
    expect(services.web!.networks).toEqual({ app: { aliases: ["ys-sure-ui"] } });
  });

  it("adds nothing for an app that isn't published", () => {
    const plain = adapt(spec, sure, [], caddy).adapted!;
    expect((plain.services as Record<string, Service>)["ys-publish"]).toBeUndefined();
    expect((plain.networks as Record<string, unknown>).publish).toBeUndefined();
  });

  it("refuses to publish an app without an interface, or without Your Space's Caddy, and reserves its name", () => {
    expect(adapt({ ...spec, interface: null, publish: { port: 80, bind: "127.0.0.1" } }, sure, [], caddy).refusals.map((r) => r.setting)).toContain("publish");
    const withoutCaddy = adapt({ ...spec, publish: { port: 3000, bind: "127.0.0.1" } }, sure);
    expect(withoutCaddy.adapted).toBeNull();
    expect(withoutCaddy.refusals).toEqual([{ service: "", setting: "publish", reason: "Your Space's Caddy isn't running, so the app can't be published until it is." }]);
    expect(adapt(spec, { services: { "ys-publish": { image: "busybox" } } }).refusals.map((r) => r.setting)).toContain("services");
  });

  it("checks the port, address and framing it is sent", () => {
    const base = { project: "ys-sure", app: "sure", compose: "services: {}" };
    expect(validateSpec({ ...base, publish: { port: 80, bind: "::1" } }).publish).toEqual({ port: 80, bind: "::1" });
    expect(validateSpec({ ...base, publish: { port: 80, bind: "::1", frame: true } }).publish).toEqual({ port: 80, bind: "::1", frame: true });
    for (const publish of [{ port: 0, bind: "127.0.0.1" }, { port: 70000, bind: "127.0.0.1" }, { port: 80, bind: "localhost" }, { port: "80", bind: "127.0.0.1" }, { port: 80, bind: "::1", frame: "yes" }]) {
      expect(() => validateSpec({ ...base, publish }), JSON.stringify(publish)).toThrow(SpecError);
    }
  });
});

describe("restarts", () => {
  it("keeps services running, except one its file says runs once", () => {
    expect(restartPolicy({})).toBe("unless-stopped");
    expect(restartPolicy({ restart: "always" })).toBe("always");
    expect(restartPolicy({ restart: "no" })).toBe("no");
    expect(restartPolicy({ restart: "on-failure:5" })).toBe("on-failure:5");
    // Compose's deploy settings are replaced, but their restart policy is kept.
    expect(restartPolicy({ deploy: { replicas: 1, restart_policy: { condition: "on-failure" } } })).toBe("on-failure");
    expect(restartPolicy({ deploy: { restart_policy: { condition: "on-failure", max_attempts: 3 } } })).toBe("on-failure:3");
    expect(restartPolicy({ deploy: { restart_policy: { condition: "none" } } })).toBe("no");
    expect(restartPolicy({ deploy: { restart_policy: { condition: "any" } } })).toBe("unless-stopped");
    expect(restartPolicy({ restart: "unless-stopped", deploy: { restart_policy: { condition: "none" } } })).toBe("unless-stopped");
  });

  it("runs a migration like Plane's once, and its other services until they are stopped", () => {
    const result = adapt(
      { ...spec, interface: null },
      {
        services: {
          migrator: { image: "busybox", deploy: { replicas: 1, restart_policy: { condition: "on-failure" } } },
          api: { image: "busybox", depends_on: { migrator: { condition: "service_completed_successfully" } } },
        },
      },
    );
    const services = result.adapted!.services as Record<string, Service>;
    expect(services.migrator!.restart).toBe("on-failure");
    expect(services.migrator!.deploy).toBeUndefined();
    expect(services.api!.restart).toBe("unless-stopped");
    expect(services.api!.depends_on).toMatchObject({ migrator: { condition: "service_completed_successfully" } });
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
