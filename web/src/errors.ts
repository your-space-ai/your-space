// The failure states the client can show (FR-016). None of them is ever shown as success or as
// an empty or ownerless workspace.
export type FailureKind = "storage_unavailable" | "server_unreachable" | "session_expired" | "unexpected";

export class AppError extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message?: string) {
    super(message ?? kind);
    this.name = "AppError";
    this.kind = kind;
  }
}

export function failureKind(error: unknown): FailureKind {
  if (error instanceof AppError) return error.kind;
  return "unexpected";
}

/** Maps an HTTP status from the server or Caddy to a failure. */
export function failureForStatus(status: number): FailureKind {
  if (status === 401) return "session_expired";
  // 0: the request never completed. 502/504: Caddy is up but the server is not.
  if (status === 0 || status === 502 || status === 504) return "server_unreachable";
  if (status === 503) return "storage_unavailable";
  return "unexpected";
}
