// Each setup publishes exactly the ports it needs, and only where it needs them (FR-015, FR-028,
// constitution principle II). The line the owner writes in .env picks a file in deploy/modes/;
// these checks read the result through `docker compose config`, so a change that widens a port or
// lets the server and Caddy disagree fails here.
import { expect, test } from "@playwright/test";
import { compose } from "./helpers/stack.ts";

test.skip(({ browserName }) => browserName !== "chromium", "Compose checks don't use a browser; run them once.");

interface Port {
  host_ip?: string;
  published?: string;
  target: number;
  protocol?: string;
}
interface Service {
  ports?: Port[];
  environment?: Record<string, string>;
  networks?: Record<string, { aliases?: string[] } | null>;
  depends_on?: Record<string, { condition: string }>;
}

async function config(env: Record<string, string>) {
  const result = await compose(["config", "--format", "json"], { env: { YS_DOMAIN: "", YS_PROXY_URL: "", YS_PORT: "", ...env } });
  return JSON.parse(result.stdout) as { services: Record<string, Service>; networks?: Record<string, unknown> };
}

const ports = (service: Service) => (service.ports ?? []).map((p) => `${p.host_ip}:${p.published}->${p.target}/${p.protocol ?? "tcp"}`);

interface Setup {
  name: string;
  env: Record<string, string>;
  ports: string[];
  site: string;
  server: Record<string, string>;
}

const SETUPS: Setup[] = [
  {
    name: "this machine (nothing in .env)",
    env: {},
    ports: ["127.0.0.1:80->80/tcp"],
    site: "http://localhost",
    server: { YS_DOMAIN: "", YS_PROXY_URL: "", YS_PORT: "" },
  },
  {
    name: "this machine on another port (YS_PORT=8081)",
    env: { YS_PORT: "8081" },
    ports: ["127.0.0.1:8081->80/tcp"],
    site: "http://localhost",
    server: { YS_DOMAIN: "", YS_PROXY_URL: "", YS_PORT: "8081" },
  },
  {
    name: "your own domain (YS_DOMAIN)",
    env: { YS_DOMAIN: "space.example.com" },
    ports: ["0.0.0.0:80->80/tcp", "0.0.0.0:443->443/tcp", "0.0.0.0:443->443/udp"],
    site: "https://space.example.com",
    server: { YS_DOMAIN: "space.example.com", YS_PROXY_URL: "", YS_PORT: "" },
  },
  {
    name: "your own proxy or Tailscale (YS_PROXY_URL)",
    env: { YS_PROXY_URL: "https://myserver.tail1234.ts.net" },
    ports: ["127.0.0.1:8080->8080/tcp"],
    site: "http://:8080",
    server: { YS_DOMAIN: "", YS_PROXY_URL: "https://myserver.tail1234.ts.net", YS_PORT: "" },
  },
  {
    name: "your own proxy on another port (YS_PROXY_URL, YS_PORT=8090)",
    env: { YS_PROXY_URL: "https://space.example.com", YS_PORT: "8090" },
    ports: ["127.0.0.1:8090->8080/tcp"],
    site: "http://:8080",
    server: { YS_DOMAIN: "", YS_PROXY_URL: "https://space.example.com", YS_PORT: "8090" },
  },
];

for (const setup of SETUPS) {
  test(`${setup.name} publishes only ${setup.ports.join(", ")}`, async () => {
    const { services } = await config(setup.env);
    expect(ports(services.caddy!)).toEqual(setup.ports);
    expect(services.caddy!.environment!.YS_SITE).toBe(setup.site);
    // The server and the database are reachable only from inside the stack.
    expect(services.server!.ports ?? []).toEqual([]);
    expect(services.postgres!.ports ?? []).toEqual([]);
    // The server sees the same values Compose used to pick the mode file.
    expect(services.server!.environment).toMatchObject(setup.server);
    // Caddy opens its ports only after the server has accepted the settings.
    expect(services.caddy!.depends_on?.server?.condition).toBe("service_healthy");
  });
}

test("only the proxy setup joins the edge network, where a proxy in a container finds it as your-space", async () => {
  const proxy = await config({ YS_PROXY_URL: "https://space.example.com" });
  expect(proxy.services.caddy!.networks?.edge?.aliases).toEqual(["your-space"]);
  expect(Object.keys(proxy.services.server!.networks ?? { default: null })).toEqual(["default"]);
  const others: Record<string, string>[] = [{}, { YS_DOMAIN: "space.example.com" }];
  for (const env of others) {
    const other = await config(env);
    expect(Object.keys(other.networks ?? {})).not.toContain("edge");
  }
});

test("the secrets step has no network, and PostgreSQL and the server get only what they read", async () => {
  const { services } = await config({});
  const secrets = services.secrets as Service & { network_mode?: string; read_only?: boolean; cap_drop?: string[] };
  expect(secrets.network_mode).toBe("none");
  expect(secrets.ports ?? []).toEqual([]);
  expect(secrets.read_only).toBe(true);
  expect(secrets.cap_drop).toEqual(["ALL"]);
  const mounts = (service: string) =>
    ((services[service] as Service & { volumes?: { source: string; target: string; read_only?: boolean; volume?: { subpath?: string } }[] }).volumes ?? [])
      .filter((v) => v.source === "ys-secrets")
      .map((v) => ({ target: v.target, readOnly: v.read_only ?? false, subpath: v.volume?.subpath }));
  expect(mounts("postgres")).toEqual([{ target: "/run/ys-secrets", readOnly: true, subpath: "postgres" }]);
  expect(mounts("server")).toEqual([{ target: "/run/ys-secrets", readOnly: true, subpath: undefined }]);
  expect(mounts("caddy")).toEqual([]);
  expect(services.postgres!.depends_on?.secrets?.condition).toBe("service_completed_successfully");
  expect(services.server!.depends_on?.secrets?.condition).toBe("service_completed_successfully");
});

test("setting both YS_DOMAIN and YS_PROXY_URL stops Compose with a message", async () => {
  const result = await compose(["config"], {
    allowFailure: true,
    env: { YS_DOMAIN: "space.example.com", YS_PROXY_URL: "https://space.example.com", YS_PORT: "" },
  });
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Set YS_DOMAIN (your own domain) or YS_PROXY_URL (your own proxy or Tailscale) in .env, not both");
});
