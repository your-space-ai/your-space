// The Docker engine: its API over the socket for data, and the Docker CLI for Compose.
import { spawn } from "node:child_process";
import { request } from "node:http";

export const ENGINE_SOCKET = process.env.YS_ENGINE_SOCKET_PATH ?? "/var/run/docker.sock";

export class EngineError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "EngineError";
    this.status = status;
  }
}

interface Answer {
  status: number;
  body: string;
}

/** One engine API call. `onData` streams the body instead of collecting it. */
export function engine(method: string, path: string, body?: unknown, onData?: (chunk: string) => void): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: ENGINE_SOCKET,
        method,
        path,
        headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (onData ? onData(chunk) : (text += chunk)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
        res.on("error", reject);
      },
    );
    req.on("error", (error) => reject(new EngineError(`The engine can't be reached (${(error as NodeJS.ErrnoException).code ?? "error"}).`, 503)));
    if (payload) req.write(payload);
    req.end();
  });
}

export async function engineJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const answer = await engine(method, path, body);
  if (answer.status >= 400) {
    let message = answer.body;
    try {
      message = (JSON.parse(answer.body) as { message?: string }).message ?? answer.body;
    } catch {
      // not JSON
    }
    throw new EngineError(message.trim() || `The engine answered ${answer.status}.`, answer.status === 404 ? 404 : 502);
  }
  return (answer.body ? JSON.parse(answer.body) : {}) as T;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the Docker CLI with only the given environment, so nothing of the runtime manager's own
 * environment can be interpolated into an app's file.
 */
export function docker(args: string[], env: Record<string, string> = {}, cwd = "/tmp"): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd,
      env: { ...env, PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", DOCKER_HOST: `unix://${ENGINE_SOCKET}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Removes setting values from text that may be shown, such as a Compose error. Every value of three
 * characters or more is hidden wherever it stands on its own, longest first. Shorter values, such as
 * a "1", can't be told apart from the rest of a message, and a value inside a longer word is left.
 */
export function scrub(text: string, env: Record<string, string>): string {
  const values = [...new Set(Object.values(env).filter((v) => v.length >= 3))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of values) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g"), "[hidden]");
  }
  return out;
}

export interface EngineInfo {
  reachable: boolean;
  version?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memory?: number;
  connection: string;
}

const ARCH: Record<string, string> = { x86_64: "amd64", aarch64: "arm64" };

export async function engineInfo(): Promise<EngineInfo> {
  const connection = `unix://${ENGINE_SOCKET}`;
  try {
    const info = await engineJson<{ ServerVersion: string; OSType: string; Architecture: string; NCPU: number; MemTotal: number }>("GET", "/info");
    return {
      reachable: true,
      version: info.ServerVersion,
      os: info.OSType,
      arch: ARCH[info.Architecture] ?? info.Architecture,
      cpus: info.NCPU,
      memory: info.MemTotal,
      connection,
    };
  } catch {
    return { reachable: false, connection };
  }
}

export interface ImageCheck {
  ref: string;
  digest?: string;
  platforms: string[];
  runsHere: boolean;
  error?: string;
}

/** The image's index digest and platforms, from its registry, without downloading it. */
export async function inspectImage(ref: string, arch: string): Promise<ImageCheck> {
  try {
    const answer = await engineJson<{ Descriptor: { digest: string }; Platforms: { os: string; architecture: string }[] }>(
      "GET",
      `/distribution/${encodeURI(ref)}/json`,
    );
    const platforms = (answer.Platforms ?? []).filter((p) => p.os !== "unknown").map((p) => `${p.os}/${p.architecture}`);
    return {
      ref,
      digest: answer.Descriptor.digest,
      platforms,
      runsHere: platforms.length === 0 || platforms.includes(`linux/${arch}`),
    };
  } catch (error) {
    // The registry can't answer (offline, or a rate limit): an image already on the engine is used.
    const local = await localImage(ref, arch);
    return local ?? { ref, platforms: [], runsHere: false, error: (error as Error).message };
  }
}

/** The digest of an image already on the engine, from the registry it was pulled from. */
async function localImage(ref: string, arch: string): Promise<ImageCheck | undefined> {
  try {
    const image = await engineJson<{ RepoDigests?: string[]; Os: string; Architecture: string }>("GET", `/images/${encodeURIComponent(ref)}/json`);
    const name = ref.slice(0, ref.lastIndexOf(":"));
    const digest = image.RepoDigests?.map((d) => d.split("@")).find(([n]) => n === name || n === `docker.io/library/${name}` || n === `docker.io/${name}`)?.[1];
    if (!digest) return undefined;
    const platform = `${image.Os}/${image.Architecture}`;
    return { ref, digest, platforms: [platform], runsHere: platform === `linux/${arch}` };
  } catch {
    return undefined;
  }
}

/** Downloads one image, reporting progress as a fraction of bytes. */
export async function pullImage(image: string, onProgress: (fraction: number) => void): Promise<void> {
  const at = image.indexOf("@");
  const from = at === -1 ? image : image.slice(0, at);
  const tag = at === -1 ? undefined : image.slice(at + 1);
  const query = new URLSearchParams({ fromImage: from, ...(tag ? { tag } : {}) });
  const layers = new Map<string, { current: number; total: number }>();
  let failure: string | undefined;
  let buffer = "";
  let lastReport = 0;
  const answer = await engine("POST", `/images/create?${query}`, undefined, (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line) as { id?: string; error?: string; progressDetail?: { current?: number; total?: number } };
        if (event.error) failure = event.error;
        if (event.id && event.progressDetail?.total) {
          layers.set(event.id, { current: event.progressDetail.current ?? 0, total: event.progressDetail.total });
        }
      } catch {
        // partial line
      }
    }
    const now = Date.now();
    if (now - lastReport > 1000 && layers.size > 0) {
      lastReport = now;
      let current = 0;
      let total = 0;
      for (const layer of layers.values()) {
        current += layer.current;
        total += layer.total;
      }
      onProgress(total ? current / total : 0);
    }
  });
  if (answer.status >= 400) failure = answer.body || `The engine answered ${answer.status}.`;
  if (failure) throw new EngineError(`Downloading ${image} failed: ${failure}`);
}

export interface ContainerSummary {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Labels: Record<string, string>;
  /** The ID of the image it runs, `sha256:…`. */
  ImageID?: string;
  /** The machine's ports a running container publishes. */
  Ports?: { IP?: string; PrivatePort: number; PublicPort?: number; Type: string }[];
  /** What the container mounts; a volume's `Name` is set. */
  Mounts?: { Type: string; Name?: string }[];
}

export function listContainers(labels: string[]): Promise<ContainerSummary[]> {
  const filters = encodeURIComponent(JSON.stringify({ label: labels }));
  return engineJson<ContainerSummary[]>("GET", `/containers/json?all=1&filters=${filters}`);
}

export async function connectNetwork(network: string, container: string): Promise<void> {
  const answer = await engine("POST", `/networks/${encodeURIComponent(network)}/connect`, {
    Container: container,
    EndpointConfig: {},
  });
  if (answer.status >= 400 && !/already exists|already attached/i.test(answer.body)) {
    throw new EngineError(`Connecting to the app's network failed: ${answer.body.trim()}`);
  }
}

export async function disconnectNetwork(network: string, container: string): Promise<void> {
  await engine("POST", `/networks/${encodeURIComponent(network)}/disconnect`, { Container: container, Force: true });
}
