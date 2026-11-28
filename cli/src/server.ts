// Runs the server's operator commands with --json and keeps their exit statuses, which already
// follow the same pattern as the CLI's (001 contracts/operator-commands.md).
import { CliError, EXIT, ServerFailure, type ErrorCode } from "./errors.ts";
import type { Compose } from "./compose.ts";

export type ServerCommand = "create-owner" | "reset-link" | "show-secrets" | "show-owner" | "list-apps" | "update-app";

export interface ServerResult {
  status: number;
  json: Record<string, unknown> & { ok?: boolean; error?: string; message?: string };
}

export async function serverCommand(compose: Compose, name: ServerCommand, args: string[] = [], input?: string): Promise<ServerResult> {
  const ran = await compose.run(["exec", "-T", "server", name, ...args, "--json"], { input });
  try {
    return { status: ran.code, json: JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "") };
  } catch {
    // `docker compose exec` failed before the command started: the server isn't running.
    if (/not running|No such container|is restarting/i.test(ran.stderr)) {
      throw new CliError("not_running", "Your Space isn't running. Start it with `your-space start`.", {}, ran.stderr);
    }
    throw new CliError("unexpected", `The server's ${name} command didn't answer.`, {}, `${ran.stdout}${ran.stderr}`);
  }
}

const CODES: Record<string, ErrorCode> = {
  usage: "invalid_input",
  kit_file: "kit_file",
  invalid_kit: "invalid_kit",
  app_not_found: "app_not_found",
  upgrade_conflict: "upgrade_conflict",
  interface_refresh_failed: "interface_refresh_failed",
  invalid_input: "invalid_input",
  no_owner: "no_owner",
  owner_exists: "owner_exists",
  storage_unavailable: "storage_unavailable",
  unexpected: "unexpected",
};

/** A plain snake_case code, as the server's commands write them. */
const SERVER_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** What went wrong, in the server's words, or from the fields it named. */
function failureMessage(message: unknown, fields: Record<string, unknown>): string {
  if (message !== undefined && message !== null) return String(message);
  // create-owner names each field that fails the account rules instead of one message.
  const problems = fields.fields ? Object.entries(fields.fields as Record<string, string>).map(([field, problem]) => `${field}: ${problem}`) : [];
  if (problems.length) return problems.join(" ");
  return "The server's command failed.";
}

/** Throws the server command's failure as the CLI's own. */
export function expectOk(result: ServerResult): Record<string, unknown> {
  if (result.status === 0 && result.json.ok) return result.json;
  const { ok: _ok, error, message, ...fields } = result.json;
  const said = failureMessage(message, fields);
  if (typeof error === "string" && Object.hasOwn(CODES, error)) throw new CliError(CODES[error]!, said, fields);
  // Any other code is the server's own, such as `name_taken`, kept with its exit status.
  if (typeof error === "string" && SERVER_CODE.test(error)) {
    throw new ServerFailure(error, result.status >= EXIT.usage && result.status <= EXIT.unexpected ? result.status : EXIT.unexpected, said, fields);
  }
  // Without one, the exit status still says what kind of failure it was: 2 the state, 3 storage.
  throw new CliError(result.status === EXIT.state ? "app_failed" : result.status === EXIT.unreachable ? "storage_unavailable" : "unexpected", said, fields);
}

export interface Owner {
  username: string;
  name: string;
}

export async function showOwner(compose: Compose): Promise<Owner | null> {
  return (expectOk(await serverCommand(compose, "show-owner")).owner as Owner | null) ?? null;
}

export interface App {
  name: string;
  state: string;
  /**
   * Published on a port of this machine for the owner's own proxy or tunnel (decision 2026-11-19): the
   * owner's choice to show it inside Your Space, and whether Your Space shows it in its pane at its
   * link (decision 2026-11-20).
   */
  publish?: { port: number; bind: string; link: string | null; inPane: boolean } | null;
}

export async function listApps(compose: Compose): Promise<App[]> {
  const json = expectOk(await serverCommand(compose, "list-apps"));
  // An app that isn't published keeps the shape it always had.
  return (json.apps as App[]).map(({ name, state, publish }) => ({ name, state, ...(publish ? { publish } : {}) }));
}
