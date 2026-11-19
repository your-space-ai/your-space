// The apps API (journey 002, contracts/http-api.md): types, a fetch helper, and queries.
import { queryOptions } from "@tanstack/react-query";
import { AppError, failureForStatus } from "./errors.ts";

/** A refusal from the apps API, with the server's message to show as it is. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Calls the API. 4xx answers with a message become ApiError; the rest become the shared failures. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AppError("server_unreachable");
  }
  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const { error, message, details } = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    if (response.status === 401) throw new AppError("session_expired");
    if (response.status === 421) throw new AppError("wrong_address");
    if (message && response.status !== 502 && response.status !== 504) {
      throw new ApiError(response.status, error ?? "error", message, details);
    }
    throw new AppError(failureForStatus(response.status));
  }
  return data as T;
}

/** The message to show for a failed call. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof AppError) {
    switch (error.kind) {
      case "server_unreachable":
        return "Your Space isn't reachable right now. Try again.";
      case "storage_unavailable":
        return "Your Space can't read its storage right now. Try again.";
      case "session_expired":
        return "Your session has ended. Sign in again.";
      case "wrong_address":
        return "Your Space is set up for another address than this one.";
      default:
        return "Something went wrong. Try again.";
    }
  }
  return "Something went wrong. Try again.";
}

export type AppState = "installing" | "starting" | "running" | "degraded" | "stopped" | "failed" | "removed";

/** An app published on a port of this machine, for the owner's own proxy or tunnel (decision 2026-11-19). */
export interface Publish {
  port: number;
  bind: string;
  link: string | null;
}

export interface AppSummary {
  name: string;
  title: string;
  state: AppState;
  stateReason: string | null;
  origin: string;
  pane: boolean;
  hasInterface: boolean;
  pendingRequests: number;
  publish: Publish | null;
}

export interface RetainedApp {
  name: string;
  title: string;
  repo: string;
  removedAt: string | null;
}

export interface AppList {
  apps: AppSummary[];
  retained: RetainedApp[];
}

export interface Adaptation {
  service: string;
  kind: "changed" | "left_out" | "added";
  detail: string;
}

export interface Refusal {
  service: string;
  setting: string;
  reason: string;
}

export interface PublicSetting {
  name: string;
  secret: boolean;
  generated: boolean;
  derived: boolean;
  required: boolean;
  set: boolean;
  value?: string | null;
  publishedDefault: string | null;
}

export interface Review {
  previewId: string;
  name: string;
  title: string;
  origin: string;
  source: { link: string; repo: string; path: string; ref: string; commit: string; pinnedLink: string };
  kit: { source: string } | null;
  ok: boolean;
  services: { name: string; image: string; interface: boolean; ports: number[]; published: { target: number; host: number }[]; volumes: string[]; dependsOn: string[] }[];
  images: { ref: string; digest?: string; runsHere: boolean }[];
  adaptations: Adaptation[];
  refusals: Refusal[];
  settings: PublicSetting[];
  outbound: string[];
  interface: { service: string; port: number } | null;
  publishPort: number | null;
  pane: boolean;
  retained: boolean;
  warning: string;
}

export interface JobStep {
  at: string;
  message: string;
}

export interface Job {
  id: string;
  kind: "install" | "apply" | "remove";
  state: "running" | "succeeded" | "failed";
  steps: JobStep[];
  error: string | null;
}

export interface ServiceState {
  name: string;
  role: "app" | "egress" | "publish";
  state: string;
  health?: string;
  exitCode?: number;
  oomKilled?: boolean;
  completed?: boolean;
  limit: { memory: number; cpus: number } | null;
}

export interface AppDetail {
  name: string;
  title: string;
  origin: string;
  state: AppState;
  stateReason: string | null;
  desired: "running" | "stopped" | "removed";
  pane: boolean;
  interface: { service: string; port: number } | null;
  publish: Publish | null;
  source: { link: string; repo: string; path: string; ref: string; commit: string };
  kitSource: string | null;
  images: Record<string, { digest: string }>;
  adaptations: Adaptation[];
  services: ServiceState[];
  limits: Record<string, { memory: number; cpus: number }>;
  settings: PublicSetting[];
  outbound: { host: string; source: "kit" | "owner"; createdAt: string }[];
  requests: { id: string; host: string; state: "pending" | "dismissed"; attempts: number; firstSeen: string; lastSeen: string }[];
  job: Job | null;
  installedAt: string;
  removedAt: string | null;
}

export interface EngineReport {
  reachable: boolean;
  version?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memory?: number;
  connection: string;
  stopping?: boolean;
  apps: { name: string; title: string; memory: number | null; cpuPercent: number | null }[];
}

export const appsQuery = queryOptions({
  queryKey: ["apps"],
  queryFn: () => api<AppList>("GET", "/api/apps"),
  // States change in the background (installs, the server's checks), so the list stays fresh.
  refetchInterval: 5_000,
  retry: false,
});

export const appQuery = (name: string) =>
  queryOptions({
    queryKey: ["apps", name],
    queryFn: () => api<AppDetail>("GET", `/api/apps/${encodeURIComponent(name)}`),
    refetchInterval: 5_000,
    retry: false,
  });

export const engineQuery = queryOptions({
  queryKey: ["engine"],
  queryFn: () => api<EngineReport>("GET", "/api/engine"),
  refetchInterval: 10_000,
  retry: false,
});

export const jobQuery = (id: string) =>
  queryOptions({
    queryKey: ["jobs", id],
    queryFn: () => api<Job>("GET", `/api/jobs/${encodeURIComponent(id)}`),
    // Polled every second while it runs.
    refetchInterval: (query) => (query.state.data && query.state.data.state !== "running" ? false : 1_000),
    retry: false,
  });

export const STATE_LABEL: Record<AppState, string> = {
  installing: "Installing",
  starting: "Starting",
  running: "Running",
  degraded: "Needs attention",
  stopped: "Stopped",
  failed: "Failed",
  removed: "Removed, data kept",
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}

export function shortDigest(digest: string | undefined): string {
  return digest ? digest.replace(/^sha256:/, "").slice(0, 12) : "unknown";
}
