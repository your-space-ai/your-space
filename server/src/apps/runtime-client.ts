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
  project: string;
  app: string;
  compose: string;
  env: Record<string, string>;
  pins?: Record<string, string>;
  interface?: { service: string; port: number } | null;
  limits?: Record<string, { memory?: number; cpus?: number }>;
  egress?: string[];
}

export interface CheckAnswer {
  ok: boolean;
  services: { name: string; image: string; interface: boolean; ports: number[]; volumes: string[]; dependsOn: string[] }[];
  variables: { name: string; required: boolean; default: string }[];
  adaptations: { service: string; kind: "changed" | "left_out" | "added"; detail: string }[];
  refusals: { service: string; setting: string; reason: string }[];
  images: { ref: string; digest?: string; runsHere: boolean; platforms: string[]; error?: string }[];
}

export interface ServiceState {
  name: string;
  role: "app" | "egress";
  state: string;
  health?: string;
  exitCode?: number;
  oomKilled?: boolean;
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
}

function call(method: string, path: string, body?: unknown, onLine?: (line: string) => void, socketPath = RUNTIME_SOCKET): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      { socketPath, method, path, headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {} },
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

async function json<T>(method: string, path: string, body?: unknown, socketPath?: string): Promise<T> {
  const { status, text } = await call(method, path, body, undefined, socketPath);
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
  };
}
