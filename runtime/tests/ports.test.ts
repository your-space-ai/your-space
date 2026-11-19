// Checking a port before the owner's choice to publish an app on it is saved (decision 2026-11-19).
import { describe, expect, it } from "vitest";
import { INSTALLATION, portHolder, portProbe, portTaken, SpecError, validatePortCheck } from "../src/apps.ts";
import type { ContainerSummary } from "../src/engine.ts";

const DIGEST = `sha256:${"e".repeat(64)}`;

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
  const forwarder = container("ys-sure-ys-publish-1", [{ IP: "127.0.0.1", PrivatePort: 8080, PublicPort: 3000, Type: "tcp" }], own);

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

  it("knows the app's own forwarder, which frees the port when the app restarts, but names another container first", () => {
    expect(portHolder([forwarder], "ys-sure", { port: 3000, bind: "0.0.0.0" })).toEqual({ container: "ys-sure-ys-publish-1", own: true });
    expect(portHolder([forwarder], "ys-other", { port: 3000, bind: "127.0.0.1" })).toEqual({ container: "ys-sure-ys-publish-1", own: false });
    const other = container("tunnel-1", [{ IP: "0.0.0.0", PrivatePort: 3000, PublicPort: 3000, Type: "tcp" }]);
    expect(portHolder([forwarder, other], "ys-sure", { port: 3000, bind: "127.0.0.1" })).toEqual({ container: "tunnel-1", own: false });
  });
});

describe("the short-lived container that tries the port", () => {
  const probe = portProbe(`busybox@${DIGEST}`, { port: 3000, bind: "::1" });

  it("publishes the port as the forwarder would, from its pinned image, and exits at once", () => {
    expect(probe).toMatchObject({ Image: `busybox@${DIGEST}`, Cmd: ["true"], ExposedPorts: { "8080/tcp": {} } });
    expect((probe.HostConfig as Record<string, unknown>).PortBindings).toEqual({ "8080/tcp": [{ HostIp: "::1", HostPort: "3000" }] });
  });

  it("is hardened like the forwarder, on Docker's own bridge rather than the machine's network", () => {
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
  it("takes the port, the address and the forwarder's pinned digest", () => {
    expect(validatePortCheck({ publish: { port: 3000, bind: "127.0.0.1" }, pins: { "busybox:latest": DIGEST, "other:latest": "x" } })).toEqual({
      publish: { port: 3000, bind: "127.0.0.1" },
      digest: DIGEST,
    });
  });

  it("refuses anything else", () => {
    const publish = { port: 3000, bind: "127.0.0.1" };
    for (const body of [
      undefined,
      { publish },
      { publish, pins: { "busybox:latest": "latest" } },
      { publish: { port: 0, bind: "127.0.0.1" }, pins: { "busybox:latest": DIGEST } },
      { publish: { port: 3000, bind: "localhost" }, pins: { "busybox:latest": DIGEST } },
      { publish: "3000", pins: { "busybox:latest": DIGEST } },
    ]) {
      expect(() => validatePortCheck(body), JSON.stringify(body)).toThrow(SpecError);
    }
  });
});
