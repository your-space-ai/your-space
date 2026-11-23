// Failures in Your Space's terms, each with its exit status (contracts/cli-commands.md).

export const EXIT = { ok: 0, usage: 1, state: 2, unreachable: 3, unexpected: 4 } as const;

const STATUS = {
  usage: EXIT.usage,
  agent_request_failed: EXIT.state,
  kit_file: EXIT.state,
  invalid_kit: EXIT.state,
  app_not_found: EXIT.state,
  upgrade_conflict: EXIT.state,
  interface_refresh_failed: EXIT.unreachable,
  gateway_unavailable: EXIT.unreachable,
  invalid_input: EXIT.usage,
  cancelled: EXIT.usage,
  not_an_installation: EXIT.state,
  already_initialised: EXIT.state,
  folder_not_empty: EXIT.state,
  another_installation: EXIT.state,
  engine_missing: EXIT.state,
  engine_unsupported: EXIT.state,
  compose_missing: EXIT.state,
  permission_denied: EXIT.state,
  port_in_use: EXIT.state,
  check_failed: EXIT.state,
  not_running: EXIT.state,
  start_failed: EXIT.state,
  lost_secrets: EXIT.state,
  no_owner: EXIT.state,
  owner_exists: EXIT.state,
  secret_in_env: EXIT.state,
  checksum_mismatch: EXIT.state,
  download_failed: EXIT.unreachable,
  engine_unreachable: EXIT.unreachable,
  storage_unavailable: EXIT.unreachable,
  app_failed: EXIT.state,
  unexpected: EXIT.unexpected,
} as const;

export type ErrorCode = keyof typeof STATUS;

export class CliError extends Error {
  override name = "CliError";
  /** One of the codes above, or a server command's own code (ServerFailure). */
  readonly code: string;
  readonly status: number;
  /** Extra JSON fields, such as the port in use. */
  readonly fields: Record<string, unknown>;
  /** What Compose or the engine said, shown with --verbose and in JSON. */
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, fields: Record<string, unknown> = {}, detail?: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
    this.detail = detail;
  }
}

/** A server command's failure under its own code and exit status, which follow the same pattern (server.ts). */
export class ServerFailure extends CliError {
  override readonly code: string;
  override readonly status: number;

  constructor(code: string, status: number, message: string, fields: Record<string, unknown>) {
    super("app_failed", message, fields);
    this.code = code;
    this.status = status;
  }
}
