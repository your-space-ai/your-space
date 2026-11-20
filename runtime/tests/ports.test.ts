// Checking a port before the owner's choice to publish an app on it is saved (decision 2026-11-19).
import { describe, expect, it } from "vitest";
import { INSTALLATION, portHolder, portProbe, portTaken, proxyOutdated, SpecError, validatePortCheck } from "../src/apps.ts";
import type { ContainerSummary } from "../src/engine.ts";

/** Your Space's own Caddy's image, which a published app's Caddy runs too. */
const IMAGE = `sha256:${"e".repeat(64)}`;

function container(name: string, ports: ContainerSummary["Ports"], labels: Record<string, string> = {}): ContainerSummary {
  return { Id: `${name}-id-0123456789`, Names: [`/${name}`], State: "running", Status: "Up", Labels: labels, Ports: ports };
}

const own = { "ai.your-space.installation": INSTALLATION, "com.docker.compose.project": "ys-sure" };

describe("the container that publishes a port", () => {
  const web = container("web-1", [{ IP: "127.0.0.1", PrivatePort: 80, PublicPort: 8000, Type: "tcp" }]);
  const everywhere = container("proxy-1", [
    { IP: "0.0.0.0", PrivatePort: 80, PublicPort: 8080, Type: "tcp" },
    { IP: "::", PrivatePort: 80, PublicPort: 8080, Type: "tcp" },
  ]);
  const proxy = container("ys-sure-ys-publish-1", [{ IP: "127.0.0.1", PrivatePort: 8080, PublicPort: 3000, Type: "tcp" }], own);

  it("names a container that publishes the port on the same address, or on every address", () => {
    expect(portHolder([web, everywhere], "ys-sure", { port: 8000, bind: "127.0.0.1" })).toEqual({ container: "web-1", own: false });
    expect(portHolder([web, everywhere], "ys-sure", { port: 8000, bind: "0.0.0.0" })).toEqual({ container: "web-1", own: false });
    expect(portHolder([web, everywhere], "ys-sure", { port: 8080, bind: "::1" })).toEqual({ container: "proxy-1", own: false });
  });

  it("finds none for another address, another port or UDP", () => {
    expect(portHolder([web], "ys-sure", { port: 8000, bind: "127.0.0.2" })).toBeUndefined();
    expect(portHolder([web], "ys-sure", { port: 8001, bind: "127.0.0.1" })).toBeUndefined();
    expect(portHolder([container("dns-1", [{ IP: "0.0.0.0", PrivatePort: 53, PublicPort: 8000, Type: "udp" }])], "ys-sure", { port: 8000, bind: "127.0.0.1" })).toBeUndefined();
    expect(portHolder([container("db-1", [{ PrivatePort: 5432, Type: "tcp" }])], "ys-sure", { port: 5432, bind: "127.0.0.1" })).toBeUndefined();
  });

  it("knows the app's own Caddy, which frees the port when the app restarts, but names another container first", () => {
    expect(portHolder([proxy], "ys-sure", { port: 3000, bind: "0.0.0.0" })).toEqual({ container: "ys-sure-ys-publish-1", own: true });
    expect(portHolder([proxy], "ys-other", { port: 3000, bind: "127.0.0.1" })).toEqual({ container: "ys-sure-ys-publish-1", own: false });
    const other = container("tunnel-1", [{ IP: "0.0.0.0", PrivatePort: 3000, PublicPort: 3000, Type: "tcp" }]);
    expect(portHolder([proxy, other], "ys-sure", { port: 3000, bind: "127.0.0.1" })).toEqual({ container: "tunnel-1", own: false });
  });
});

describe("the short-lived container that tries the port", () => {
  const probe = portProbe(IMAGE, { port: 3000, bind: "::1" });

  it("publishes the port as the app's Caddy would, from its image, and exits at once", () => {
    expect(probe).toMatchObject({ Image: IMAGE, Cmd: ["true"], ExposedPorts: { "8080/tcp": {} } });
    expect((probe.HostConfig as Record<string, unknown>).PortBindings).toEqual({ "8080/tcp": [{ HostIp: "::1", HostPort: "3000" }] });
  });

  it("is hardened like the app's Caddy, on Docker's own bridge rather than the machine's network", () => {
    expect(probe).toMatchObject({ User: "65534:65534" });
    expect(probe.HostConfig).toMatchObject({ NetworkMode: "bridge", ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], Memory: 32 * 1024 * 1024 });
  });

  it("carries no app's labels, so no app counts it", () => {
    expect(probe.Labels).toEqual({ "ai.your-space.installation": INSTALLATION, "ai.your-space.role": "port-check" });
  });
});

describe("Docker's answer", () => {
  it("is a taken port only for its two bind errors", () => {
    expect(portTaken("driver failed programming external connectivity on endpoint x: Bind for 127.0.0.1:8000 failed: port is already allocated")).toBe(true);
    expect(portTaken("failed to set up container networking: failed to bind host port 127.0.0.1:8000/tcp: address already in use")).toBe(true);
    expect(portTaken("listen tcp4 192.0.2.7:8000: bind: cannot assign requested address")).toBe(false);
    expect(portTaken("No such image: busybox")).toBe(false);
  });
});

describe("a port check's request", () => {
  it("takes the port and the address", () => {
    expect(validatePortCheck({ publish: { port: 3000, bind: "127.0.0.1" } })).toEqual({ port: 3000, bind: "127.0.0.1" });
  });

  it("refuses anything else", () => {
    for (const body of [undefined, {}, { publish: { port: 0, bind: "127.0.0.1" } }, { publish: { port: 3000, bind: "localhost" } }, { publish: "3000" }]) {
      expect(() => validatePortCheck(body), JSON.stringify(body)).toThrow(SpecError);
    }
  });
});

describe("a published app's Caddy", () => {
  const caddy = { image: IMAGE, origin: "https://space.example.com" };
  const running = (image: string, framedBy?: string) => ({
    ...container("ys-sure-ys-publish-1", [], { ...own, "ai.your-space.role": "publish", ...(framedBy ? { "ai.your-space.frame-origin": framedBy } : {}) }),
    ImageID: image,
  });

  it("is current while it runs Your Space's own Caddy's image, and lets only Your Space's origin frame the app if any", () => {
    expect(proxyOutdated(running(IMAGE), caddy)).toBe(false);
    expect(proxyOutdated(running(IMAGE, "https://space.example.com"), caddy)).toBe(false);
    // One that frames nothing doesn't depend on the origin.
    expect(proxyOutdated(running(IMAGE), { image: IMAGE })).toBe(false);
  });

  it("is outdated after Your Space is updated or moved, or when it is the port forwarder an earlier Your Space ran", () => {
    // Your Space's previous image, or BusyBox's, which the forwarder ran.
    expect(proxyOutdated(running(`sha256:${"a".repeat(64)}`), caddy)).toBe(true);
    expect(proxyOutdated(running(IMAGE, "http://space.localhost:*"), caddy)).toBe(true);
    expect(proxyOutdated(running(IMAGE, "https://space.example.com"), { image: IMAGE })).toBe(true);
  });
});
