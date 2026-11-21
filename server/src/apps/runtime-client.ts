// The runtime manager's API (contracts/runtime-api.md), over its Unix socket in the ys-runtime volume.
import { request } from "node:http";

export const RUNTIME_SOCKET = process.env.YS_RUNTIME_SOCKET ?? "/run/ys-runtime/runtime.sock";

export class RuntimeError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "RuntimeError";
    this.status = status;
    this.code = code;
  }
}

export interface AppSpec {
  /** Stable server installation ID for a kit with agent access; identifies its declared interface. */
  appId?: string;
  project: string;
  app: string;
  compose: string;
  env: Record<string, string>;
  pins?: Record<string, string>;
  interface?: { service: string; port: number } | null;
  limits?: Record<string, { memory?: number; cpus?: number }>;
  egress?: string[];
  /** `frame`: the app's Caddy lets only Your Space's origin frame it (decision 2026-11-20). */
  publish?: { port: number; bind: string; frame: boolean } | null;
}

export interface CheckAnswer {
  ok: boolean;
  services: {
    name: string;
    image: string;
    interface: boolean;
    ports: number[];
    /** The machine's ports the file publishes, each with the container port it leads to. */
    published: { target: number; host: number }[];
    volumes: string[];
    dependsOn: string[];
  }[];
  variables: { name: string; required: boolean; default: string }[];
  adaptations: { service: string; kind: "changed" | "left_out" | "added"; detail: string }[];
  refusals: { service: string; setting: string; reason: string }[];
  images: { ref: string; digest?: string; runsHere: boolean; platforms: string[]; error?: string }[];
}

export interface ServiceState {
  name: string;
  role: "app" | "egress" | "publish";
  state: string;
  health?: string;
  exitCode?: number;
  oomKilled?: boolean;
  /** A service that runs once, such as a migration, and finished. */
  completed?: boolean;
  /**
   * A published app's Caddy that doesn't run Your Space's own Caddy's current image, or lets another
   * origin than Your Space's current one frame the app; the next start renews it.
   */
  outdated?: boolean;
  /**
   * A published app's Caddy that runs and lets Your Space's current origin frame the app: its short
   * container ID, new each time the Caddy is recreated.
   */
  framing?: string;
}

export interface EngineInfo {
  reachable: boolean;
  version?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memory?: number;
  connection: string;
  stopping?: boolean;
}

export interface ApplyEvent {
  step?: string;
  image?: string;
  progress?: number;
  done?: boolean;
  error?: string;
}

/** What the server needs from a runtime; tests give a fake. */
export interface Runtime {
  engine(): Promise<EngineInfo>;
  check(spec: AppSpec): Promise<CheckAnswer>;
  apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void): Promise<void>;
  down(project: string): Promise<void>;
  deleteVolumes(project: string): Promise<void>;
  apps(): Promise<{ project: string; app: string; services: ServiceState[] }[]>;
  logs(project: string, service: string, tail?: number): Promise<string[]>;
  stats(project: string): Promise<{ services: { name: string; memory: number; memoryLimit: number; cpuPercent: number }[] }>;
  denials(project: string): Promise<{ hosts: { host: string; attempts: number; lastSeen: string }[] }>;
  /** Whether the app can be published on bind:port of this machine; `by` names a container that uses it. */
  checkPort(project: string, publish: { port: number; bind: string }): Promise<{ inUse: boolean; by?: string }>;
}

function call(method: string, path: string, body?: unknown, onLine?: (line: string) => void, socketPath = RUNTIME_SOCKET, deadlineMs?: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      { socketPath, method, path, signal: deadlineMs === undefined ? undefined : AbortSignal.timeout(deadlineMs), headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {} },
      (res) => {
        let text = "";
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (!onLine) return void (text += chunk);
          buffer += chunk;
          let newline;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            onLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
          }
        });
        res.on("end", () => {
          if (onLine && buffer.trim()) onLine(buffer);
          resolve({ status: res.statusCode ?? 0, text });
        });
        res.on("error", reject);
      },
    );
    req.on("error", () => reject(new RuntimeError("Your Space's runtime manager isn't running.", 503, "runtime_unavailable")));
    req.setTimeout(30 * 60_000, () => req.destroy(new RuntimeError("The runtime manager stopped answering.", 504, "runtime_timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

async function json<T>(method: string, path: string, body?: unknown, socketPath?: string, deadlineMs?: number): Promise<T> {
  const { status, text } = await call(method, path, body, undefined, socketPath, deadlineMs);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RuntimeError("The runtime manager answered with something unreadable.", 502, "runtime_error");
  }
  if (status >= 400) {
    const { error, message } = data as { error?: string; message?: string };
    throw new RuntimeError(message ?? "The runtime manager refused the request.", status, error ?? "runtime_error");
  }
  return data as T;
}

/** Resolve through the private engine-owning runtime just before dispatch. */
export function installedInterface(project: string, id: string, service: string, port: number): Promise<{ address: string }> {
  const query = new URLSearchParams({ id, service, port: String(port) });
  return json("GET", `/apps/${encodeURIComponent(project)}/interface?${query}`, undefined, undefined, 5_000);
}

export function refreshRuntimeInterface(spec: AppSpec): Promise<{ status: "current" | "refreshed" }> {
  return json("POST", `/apps/${encodeURIComponent(spec.project)}/interface`, spec);
}

export function socketRuntime(socketPath = RUNTIME_SOCKET): Runtime {
  const p = (project: string) => `/apps/${encodeURIComponent(project)}`;
  return {
    engine: () => json("GET", "/engine", undefined, socketPath),
    check: (spec) => json("POST", "/check", spec, socketPath),
    async apply(spec, onEvent) {
      let failure: string | undefined;
      let done = false;
      const { status } = await call(
        "POST",
        "/apply",
        spec,
        (line) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as ApplyEvent;
          if (event.error) failure = event.error;
          if (event.done) done = true;
          onEvent(event);
        },
        socketPath,
      );
      if (status >= 400) throw new RuntimeError(failure ?? "The runtime manager refused the app.", status, "runtime_error");
      if (failure) throw new RuntimeError(failure, 502, "apply_failed");
      if (!done) throw new RuntimeError("The runtime manager stopped before the app started.", 502, "apply_interrupted");
    },
    down: async (project) => void (await json("POST", `${p(project)}/down`, undefined, socketPath)),
    deleteVolumes: async (project) => void (await json("DELETE", `${p(project)}/volumes`, undefined, socketPath)),
    apps: () => json("GET", "/apps", undefined, socketPath),
    logs: async (project, service, tail = 200) =>
      (await json<{ lines: string[] }>("GET", `${p(project)}/logs?service=${encodeURIComponent(service)}&tail=${tail}`, undefined, socketPath)).lines,
    stats: (project) => json("GET", `${p(project)}/stats`, undefined, socketPath),
    denials: (project) => json("GET", `${p(project)}/denials`, undefined, socketPath),
    checkPort: (project, publish) => json("POST", `${p(project)}/port`, { publish }, socketPath),
  };
}
