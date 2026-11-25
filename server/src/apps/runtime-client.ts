// The runtime manager's API (contracts/runtime-api.md), over its Unix socket in the ys-runtime volume.
import { request } from "node:http";
import { otherComposeFiles } from "./compose-file.ts";

export const RUNTIME_SOCKET = process.env.YS_RUNTIME_SOCKET ?? "/run/ys-runtime/runtime.sock";

/** How long a request waits for the runtime manager to say anything, an app's whole apply included. */
export const CALL_TIMEOUT_MS = 30 * 60_000;
/**
 * How long a sync run's request waits, which answers only when the run ends: past the runtime
 * manager's limit on a run (two hours, RUN_TIMEOUT_MS in runtime/src/sync.ts), which stops a step
 * still under way then and starts no other, so its answer comes before this.
 */
export const SYNC_TIMEOUT_MS = 2.5 * 60 * 60_000;

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
  /**
   * A check gives each setting the file requires and `env` has no value for a placeholder, so the
   * owner can review the file before filling those settings in. An apply ignores it.
   */
  placeholders?: boolean;
  /**
   * Signs the engine in to a registry for the images each credential names (journey 015, R9): on a
   * review's second check, for the images the first found private, and on an install, for those it
   * pulls. The runtime manager sends it as X-Registry-Auth on those lookups and pulls alone.
   */
  registryCredentials?: RegistryCredential[];
  /**
   * The knowledge bases the owner gave an app whose kit asks for knowledge, by name, which the runtime
   * manager mounts in its interface service at `<path>/<name>` (journey 014).
   */
  knowledge?: { path: string; bases: string[] } | null;
}

/** A registry credential (journey 015): `secret` signs `username` in to `registry` for `images`. */
export interface RegistryCredential {
  registry: string;
  username: string;
  secret: string;
  images: string[];
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
  /** `unset`: Compose had no value and no default for it, and left it blank. */
  variables: { name: string; required: boolean; default: string; unset?: boolean }[];
  adaptations: { service: string; kind: "changed" | "left_out" | "added"; detail: string }[];
  refusals: { service: string; setting: string; reason: string }[];
  /**
   * `registry` is the one the reference names; `private`, that its registry gave it only with the
   * credential; `signIn`, that its registry won't give it without one (`needed`), or refused the one
   * given (`refused`), which the check leaves for the server to word.
   */
  images: { ref: string; registry: string; digest?: string; runsHere: boolean; platforms: string[]; error?: string; private?: true; signIn?: "needed" | "refused" }[];
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
  /** `sign_in`: a registry asked for a sign-in to download an image, or refused the one given. */
  code?: string;
}

/** A file a sync run deletes, or would: deleted on this side, so deleted on the other. */
export interface SyncDeletion {
  side: "local" | "remote";
  path: string;
}

/** A sync run of a knowledge base with its Google Drive folder (journey 014). */
export interface SyncRequest {
  /** The remote's configuration, which reaches only rclone's container, for this run. */
  remote: { type: "drive"; clientId: string; clientSecret: string; token: string; folderId: string };
  /** A run; a resync, which copies both ways and deletes nothing; or the owner's confirmed deletions. */
  mode: "sync" | "resync" | "force";
  confirm?: SyncDeletion[];
}

export interface SyncRunResult {
  result: "synced" | "stopped" | "unauthorized" | "failed" | "busy";
  reason?: "max_delete" | "empty" | "marker" | "resync" | "changed";
  side?: "local" | "remote";
  message?: string;
  /** Every deletion a stopped run listed, however many. */
  deletions: SyncDeletion[];
  ties: string[];
  conflicts: string[];
  backups: { run: string; path: string; size: number }[];
  changed: boolean;
  /** Whether the conflict copies and backups were listed after the run. */
  listed?: boolean;
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
  /** Creates a knowledge base's storage, or keeps this installation's own that has its name. */
  createKnowledge(name: string): Promise<{ created: boolean }>;
  /**
   * The apps whose containers mount a knowledge base, running or not, with or without a grant, and
   * whether the runtime manager runs a sync of it now, one a server before a restart started included.
   */
  knowledgeUsers(name: string): Promise<{ apps: string[]; syncing: boolean }>;
  /** Deletes a knowledge base's storage and its files; refused while an app still mounts it, or while it syncs. */
  deleteKnowledge(name: string): Promise<void>;
  /** Runs a sync of a knowledge base with its Drive folder; another run of it answers busy. */
  syncKnowledge(name: string, request: SyncRequest): Promise<SyncRunResult>;
  /** Removes a knowledge base's sync state; it and the Drive folder keep their files. */
  removeSync(name: string): Promise<void>;
}

function call(method: string, path: string, body?: unknown, onLine?: (line: string) => void, socketPath = RUNTIME_SOCKET, deadlineMs?: number, idleMs = CALL_TIMEOUT_MS): Promise<{ status: number; text: string }> {
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
    // A timeout's own error says the runtime manager stopped answering, not that it isn't running.
    req.on("error", (error) => reject(error instanceof RuntimeError ? error : new RuntimeError("Your Space's runtime manager isn't running.", 503, "runtime_unavailable")));
    req.setTimeout(idleMs, () => req.destroy(new RuntimeError("The runtime manager stopped answering.", 504, "runtime_timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

async function answer<T>(method: string, path: string, body?: unknown, socketPath?: string, deadlineMs?: number, idleMs?: number): Promise<T> {
  const { status, text } = await call(method, path, body, undefined, socketPath, deadlineMs, idleMs);
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
  return answer("GET", `/apps/${encodeURIComponent(project)}/interface?${query}`, undefined, undefined, 5_000);
}

/** The app's spec, once its file names no other Compose file, which Compose would read (compose-file.ts). */
function oneFile(spec: AppSpec): AppSpec {
  const named = otherComposeFiles(spec.compose);
  if (named) throw new RuntimeError(named, 400, "refused");
  return spec;
}

/** `timeouts` are for tests: how long a request, and a sync run's, waits for the runtime manager. */
export function socketRuntime(socketPath = RUNTIME_SOCKET, timeouts: { callMs: number; syncMs: number } = { callMs: CALL_TIMEOUT_MS, syncMs: SYNC_TIMEOUT_MS }): Runtime {
  const p = (project: string) => `/apps/${encodeURIComponent(project)}`;
  const json = <T>(method: string, path: string, body?: unknown, sock?: string, deadlineMs?: number, idleMs = timeouts.callMs) => answer<T>(method, path, body, sock, deadlineMs, idleMs);
  return {
    engine: () => json("GET", "/engine", undefined, socketPath),
    check: async (spec) => json("POST", "/check", oneFile(spec), socketPath),
    async apply(spec, onEvent) {
      let failure: string | undefined;
      let code: string | undefined;
      let done = false;
      const { status } = await call(
        "POST",
        "/apply",
        oneFile(spec),
        (line) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as ApplyEvent;
          if (event.error) failure = event.error;
          if (event.code) code = event.code;
          if (event.done) done = true;
          onEvent(event);
        },
        socketPath,
        undefined,
        timeouts.callMs,
      );
      if (status >= 400) throw new RuntimeError(failure ?? "The runtime manager refused the app.", status, "runtime_error");
      if (failure) throw new RuntimeError(failure, 502, code ?? "apply_failed");
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
    createKnowledge: (name) => json("POST", "/knowledge", { name }, socketPath),
    knowledgeUsers: (name) => json("GET", `/knowledge/${encodeURIComponent(name)}`, undefined, socketPath),
    deleteKnowledge: async (name) => void (await json("DELETE", `/knowledge/${encodeURIComponent(name)}`, undefined, socketPath)),
    // No answer until the run ends, which can take longer than any other request.
    syncKnowledge: (name, run) => json("POST", `/knowledge/${encodeURIComponent(name)}/sync`, run, socketPath, undefined, timeouts.syncMs),
    removeSync: async (name) => void (await json("DELETE", `/knowledge/${encodeURIComponent(name)}/sync`, undefined, socketPath)),
  };
}
