// Runs the server's operator commands with --json and keeps their exit statuses, which already
// follow the same pattern as the CLI's (001 contracts/operator-commands.md).
import { CliError, type ErrorCode } from "./errors.ts";
import type { Compose } from "./compose.ts";

export type ServerCommand = "create-owner" | "reset-link" | "show-secrets" | "show-owner" | "list-apps";

export interface ServerResult {
  status: number;
  json: Record<string, unknown> & { ok?: boolean; error?: string; message?: string };
}

export async function serverCommand(compose: Compose, name: ServerCommand, args: string[] = []): Promise<ServerResult> {
  const ran = await compose.run(["exec", "-T", "server", name, ...args, "--json"]);
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
  invalid_input: "invalid_input",
  no_owner: "no_owner",
  owner_exists: "owner_exists",
  storage_unavailable: "storage_unavailable",
};

/** Throws the server command's failure as the CLI's own. */
export function expectOk(result: ServerResult): Record<string, unknown> {
  if (result.status === 0 && result.json.ok) return result.json;
  const code = CODES[result.json.error ?? ""] ?? (result.status === 2 ? "owner_exists" : result.status === 3 ? "storage_unavailable" : "unexpected");
  const { ok: _ok, error: _error, message, ...fields } = result.json;
  // create-owner names each field that fails the account rules instead of one message.
  const problems = fields.fields ? Object.entries(fields.fields as Record<string, string>).map(([field, problem]) => `${field}: ${problem}`) : [];
  throw new CliError(code, String(message ?? (problems.join(" ") || "The server's command failed.")), fields);
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
}

export async function listApps(compose: Compose): Promise<App[]> {
  const json = expectOk(await serverCommand(compose, "list-apps"));
  return (json.apps as { name: string; state: string }[]).map(({ name, state }) => ({ name, state }));
}
