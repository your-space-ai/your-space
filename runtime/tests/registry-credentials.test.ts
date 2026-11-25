// Journey 015, slice 4: the registry credential. The runtime manager gives the engine the image token
// as Docker's X-Registry-Auth, on the lookup or pull of the images it is for alone, and never writes
// a Docker config file. A stand-in engine on a Unix socket records what each request sent.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "ys-engine-"));
process.env.YS_ENGINE_SOCKET_PATH = join(dir, "engine.sock");
const engine = await import("../src/engine.ts");
const { validateSpec, SpecError } = await import("../src/apps.ts");

const DIGEST = `sha256:${"d".repeat(64)}`;
const IMAGE = "ghcr.io/ys-fixtures/private-image:1";
const CREDENTIAL = { registry: "ghcr.io", username: "ys-fixture-owner", secret: "ghp_ys_fixture_packages", images: [IMAGE] };

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
}

let server: Server;
const seen: Seen[] = [];
let answer: (req: IncomingMessage, res: ServerResponse) => void;

/** What X-Registry-Auth holds: URL-safe base64 of the sign-in's JSON. */
function decoded(header: string): unknown {
  return JSON.parse(Buffer.from(header.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8"));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, auth: req.headers["x-registry-auth"] as string | undefined });
    answer(req, res);
  });
  await new Promise<void>((resolve) => server.listen(process.env.YS_ENGINE_SOCKET_PATH, resolve));
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  seen.length = 0;
});

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
const found = { Descriptor: { digest: DIGEST }, Platforms: [{ os: "linux", architecture: "amd64" }] };

describe("which requests a registry credential signs in", () => {
  it("names the registry an image reference names, Docker Hub for none", () => {
    expect(engine.registryOf("ghcr.io/owner/app:1")).toBe("ghcr.io");
    expect(engine.registryOf("127.0.0.1:5591/owner/app:1")).toBe("127.0.0.1:5591");
    expect(engine.registryOf("localhost/app")).toBe("localhost");
    expect(engine.registryOf("owner/app:1")).toBe("docker.io");
    expect(engine.registryOf("nginx")).toBe("docker.io");
    expect(engine.repositoryOf("ghcr.io/owner/app:1")).toBe("ghcr.io/owner/app");
    expect(engine.repositoryOf(`127.0.0.1:5591/owner/app@${DIGEST}`)).toBe("127.0.0.1:5591/owner/app");
  });

  it("is only for exactly the registry it was given for, and only the images it names", () => {
    const header = engine.signInFor(IMAGE, [CREDENTIAL]);
    expect(decoded(header!["X-Registry-Auth"]!)).toEqual({ username: "ys-fixture-owner", password: "ghp_ys_fixture_packages", serveraddress: "ghcr.io" });
    // The same repository at another tag, or pinned to a digest, is the same image.
    expect(engine.signInFor(`ghcr.io/ys-fixtures/private-image@${DIGEST}`, [CREDENTIAL])).toEqual(header);
    // An app's file is its author's: a look-alike host, a path that names the registry, another image
    // on the registry and an image on another registry get nothing.
    expect(engine.signInFor("ghcr.io.example.com/ys-fixtures/private-image:1", [CREDENTIAL])).toBeUndefined();
    expect(engine.signInFor("example.com/ghcr.io/ys-fixtures/private-image:1", [CREDENTIAL])).toBeUndefined();
    expect(engine.signInFor("ghcr.io/ys-fixtures/other:1", [CREDENTIAL])).toBeUndefined();
    expect(engine.signInFor("ys-fixtures/private-image:1", [CREDENTIAL])).toBeUndefined();
    expect(engine.signInFor(IMAGE, [{ ...CREDENTIAL, images: ["example.com/ys-fixtures/private-image:1"] }])).toBeUndefined();
    expect(engine.signInFor(IMAGE)).toBeUndefined();
  });

  it("tells a registry that wants a sign-in, in each registry's words, from one that can't answer", () => {
    // Recorded through Docker Engine 29.6.2: GHCR, Docker Hub, Quay and a registry with a password.
    expect(engine.wantsSignIn(403, 'Head "https://ghcr.io/v2/owner/app/manifests/1": denied')).toBe(true);
    expect(engine.wantsSignIn(403, "errors:\ndenied: requested access to the resource is denied\nunauthorized: authentication required\n")).toBe(true);
    expect(engine.wantsSignIn(401, "unauthorized: access to the requested resource is not authorized")).toBe(true);
    expect(engine.wantsSignIn(500, 'Head "http://127.0.0.1:5591/v2/owner/app/manifests/1": no basic auth credentials')).toBe(true);
    expect(engine.wantsSignIn(500, "toomanyrequests: You have reached your pull rate limit")).toBe(false);
    expect(engine.wantsSignIn(404, "manifest unknown: manifest unknown")).toBe(false);
  });
});

describe("looking an image up in its registry", () => {
  it("is anonymous for an image no credential is for", async () => {
    answer = (_req, res) => json(res, 200, found);
    expect(await engine.inspectImage("traefik/whoami:latest", "amd64", [CREDENTIAL])).toEqual({
      ref: "traefik/whoami:latest",
      registry: "docker.io",
      digest: DIGEST,
      platforms: ["linux/amd64"],
      runsHere: true,
    });
    expect(seen).toEqual([{ method: "GET", url: "/distribution/traefik/whoami:latest/json", auth: undefined }]);
  });

  it("says a registry wants a sign-in, and doesn't fall back to an image already on the engine", async () => {
    answer = (req, res) =>
      req.url!.startsWith("/distribution/") ? json(res, 403, { message: 'Head "https://ghcr.io/v2/ys-fixtures/private-image/manifests/1": denied' }) : json(res, 200, {});
    const image = await engine.inspectImage(IMAGE, "amd64");
    expect(image).toMatchObject({ ref: IMAGE, registry: "ghcr.io", signIn: "needed", runsHere: false });
    expect(image.digest).toBeUndefined();
    expect(seen.map((s) => s.url)).toEqual([`/distribution/${IMAGE}/json`]);
  });

  it("signs in with the credential for the image, and marks it private", async () => {
    answer = (req, res) => (req.headers["x-registry-auth"] ? json(res, 200, found) : json(res, 403, { message: "denied" }));
    expect(await engine.inspectImage(IMAGE, "amd64", [CREDENTIAL])).toEqual({
      ref: IMAGE,
      registry: "ghcr.io",
      digest: DIGEST,
      platforms: ["linux/amd64"],
      runsHere: true,
      private: true,
    });
    expect(seen).toHaveLength(1);
    expect(decoded(seen[0]!.auth!)).toMatchObject({ username: "ys-fixture-owner", serveraddress: "ghcr.io" });
  });

  it("says when the registry refused the credential", async () => {
    answer = (_req, res) => json(res, 401, { message: "unauthorized: authentication required" });
    expect(await engine.inspectImage(IMAGE, "amd64", [CREDENTIAL])).toMatchObject({ signIn: "refused", runsHere: false });
  });

  it("uses an image already on the engine when the registry can't answer otherwise", async () => {
    answer = (req, res) =>
      req.url!.startsWith("/distribution/")
        ? json(res, 500, { message: "toomanyrequests: rate limit" })
        : json(res, 200, { RepoDigests: [`traefik/whoami@${DIGEST}`], Os: "linux", Architecture: "amd64" });
    expect(await engine.inspectImage("traefik/whoami:latest", "amd64")).toEqual({
      ref: "traefik/whoami:latest",
      registry: "docker.io",
      digest: DIGEST,
      platforms: ["linux/amd64"],
      runsHere: true,
    });
  });
});

describe("pulling an image", () => {
  const pinned = `ghcr.io/ys-fixtures/private-image@${DIGEST}`;

  it("signs in for the image the credential is for, on that pull alone", async () => {
    answer = (_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(`{"status":"Digest: ${DIGEST}"}\n`);
    await engine.pullImage(pinned, () => {}, [CREDENTIAL]);
    await engine.pullImage("traefik/whoami:latest", () => {}, [CREDENTIAL]);
    expect(seen.map((s) => s.url)).toEqual([
      `/images/create?fromImage=ghcr.io%2Fys-fixtures%2Fprivate-image&tag=${encodeURIComponent(DIGEST)}`,
      "/images/create?fromImage=traefik%2Fwhoami%3Alatest",
    ]);
    expect(decoded(seen[0]!.auth!)).toEqual({ username: "ys-fixture-owner", password: "ghp_ys_fixture_packages", serveraddress: "ghcr.io" });
    expect(seen[1]!.auth).toBeUndefined();
  });

  it("says when the registry asks for a sign-in, with a code the server reads", async () => {
    answer = (_req, res) => json(res, 500, { message: 'Get "https://ghcr.io/v2/ys-fixtures/private-image/manifests/x": denied' });
    const failure = await engine.pullImage(pinned, () => {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(engine.EngineError);
    expect(failure).toMatchObject({ code: "sign_in", message: `Downloading ${pinned} failed: its registry asks for a sign-in, as for a private image.` });
    const refused = await engine.pullImage(pinned, () => {}, [CREDENTIAL]).catch((error: unknown) => error);
    expect((refused as Error).message).toContain("and refused the sign-in Your Space gave");
    expect((refused as Error).message).not.toContain(CREDENTIAL.secret);
  });
});

describe("the app spec's registry credentials", () => {
  const spec = (registryCredentials: unknown) => ({ project: "ys-notes", app: "notes", compose: "services: {}", env: {}, registryCredentials });

  it("are each for one registry, by its exact host, and the images named", () => {
    expect(validateSpec(spec([CREDENTIAL])).registryCredentials).toEqual([CREDENTIAL]);
    for (const bad of [
      [{ ...CREDENTIAL, registry: "https://ghcr.io" }],
      [{ ...CREDENTIAL, registry: "ghcr.io/owner" }],
      [{ ...CREDENTIAL, secret: "" }],
      [{ ...CREDENTIAL, secret: "two words" }],
      [{ ...CREDENTIAL, images: [] }],
      [{ ...CREDENTIAL, username: undefined }],
      CREDENTIAL,
    ]) {
      const refused = (() => {
        try {
          validateSpec(spec(bad));
        } catch (error) {
          return error;
        }
      })();
      expect(refused).toBeInstanceOf(SpecError);
      // A refusal never repeats the secret it was given.
      expect((refused as Error).message).not.toContain(CREDENTIAL.secret);
    }
  });
});
