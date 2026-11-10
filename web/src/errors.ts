// The failure states the client can show (FR-016). None of them is ever shown as success or as
// an empty or ownerless workspace.
export type FailureKind = "storage_unavailable" | "server_unreachable" | "wrong_address" | "session_expired" | "unexpected";

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
  // 421: the server answered, but for another address (usually a proxy that rewrote Host).
  if (status === 421) return "wrong_address";
  return "unexpected";
}

/** What to do when the server is set up for another address than the one in the address bar. */
export const WRONG_ADDRESS_FIX =
  "If you run this server behind your own proxy, set the proxy to pass the original Host header " +
  "(nginx: `proxy_set_header Host $host`). Otherwise check that `YS_DOMAIN` or `YS_PROXY_URL` in `.env` " +
  "is the address you opened.";
