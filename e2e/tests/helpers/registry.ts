// The browser tests' registry that stands in for GitHub's container registry (compose.e2e.yaml):
// puts an image in it through the engine's API, signed in with X-Registry-Auth on that request alone,
// so nothing writes a Docker config file on this machine, as `docker login` would.
import { request } from "node:http";
import { compose, docker } from "./stack.ts";

/** The engine's socket on this machine, as the Docker CLI finds it by default. */
function engineSocket(): string {
  const host = process.env.DOCKER_HOST;
  return host?.startsWith("unix://") ? host.slice("unix://".length) : "/var/run/docker.sock";
}

function push(name: string, tag: string, auth: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath: engineSocket(), method: "POST", path: `/images/${encodeURIComponent(name)}/push?tag=${encodeURIComponent(tag)}`, headers: { "X-Registry-Auth": auth } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          const events = body.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { error?: string; aux?: { Digest?: string } });
          const failed = res.statusCode !== 200 ? body : events.find((e) => e.error)?.error;
          const digest = events.find((e) => e.aux?.Digest)?.aux?.Digest;
          if (failed || !digest) reject(new Error(`Pushing ${name}:${tag} failed: ${failed ?? body}`));
          else resolve(digest);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Puts `source` in the registry as `image` (`host:port/name:tag`), signed in as `username`, and
 * removes it from the engine again, `source` included, so an install has to download all of it from
 * the registry. Returns its digest.
 */
export async function pushPrivateImage(source: string, image: string, username: string, password: string): Promise<string> {
  const colon = image.lastIndexOf(":");
  const [name, tag] = [image.slice(0, colon), image.slice(colon + 1)];
  const registry = name.slice(0, name.indexOf("/"));
  const auth = Buffer.from(JSON.stringify({ username, password, serveraddress: registry })).toString("base64").replaceAll("+", "-").replaceAll("/", "_");
  await docker(["pull", source], false);
  await docker(["tag", source, image], false);
  // The registry starts with the stack; give it a moment to listen.
  let digest = "";
  for (let attempt = 0; ; attempt++) {
    try {
      digest = await push(name, tag, auth);
      break;
    } catch (error) {
      if (attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  // Every name the image has goes, a digest an earlier journey pulled it by too, so no layer of it
  // stays on the engine.
  const id = (await docker(["image", "inspect", image, "--format", "{{.Id}}"], false)).stdout.trim();
  await docker(["image", "rm", "--force", id]);
  if ((await docker(["image", "inspect", id])).code === 0) throw new Error(`${source} is still on the engine: a container uses it.`);
  return digest;
}

/**
 * The blobs the registry served, from its log: each GET of a blob it completed. It asks every request
 * for a password and knows one account (e2e/registry/htpasswd), so each was signed in as that account.
 * A lookup reads an image's manifest and config; only a pull reads its layers.
 */
export async function blobsServed(): Promise<Set<string>> {
  const { stdout, stderr } = await compose(["logs", "--no-color", "--no-log-prefix", "registry"]);
  const served = new Set<string>();
  for (const line of `${stdout}\n${stderr}`.split("\n")) {
    const field = (key: string) => new RegExp(`(?:^|\\s)${key.replaceAll(".", "\\.")}="?([^"\\s]*)`).exec(line)?.[1];
    const blob = /^\/v2\/.+\/blobs\/(sha256:[0-9a-f]{64})$/.exec(field("http.request.uri") ?? "")?.[1];
    if (blob && line.includes('msg="response completed"') && field("http.request.method") === "GET" && field("http.response.status") === "200") served.add(blob);
  }
  return served;
}
