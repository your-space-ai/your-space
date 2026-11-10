// Shared output and exit codes for the operator commands (contracts/operator-commands.md).
import { ConfigError, loadConfig, type Config } from "../config.ts";
import { createDatabase, type Database } from "../db/client.ts";
import { setLogStream } from "../log.ts";

export const EXIT = {
  ok: 0,
  usage: 1,
  notApplicable: 2,
  storage: 3,
  unexpected: 4,
} as const;

export const STORAGE_MESSAGE = "The database could not be read.";

/** `2026-11-04T02:45:00Z`: whole seconds, UTC. */
export function formatTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface Output {
  json: boolean;
  /** Prints a result: JSON on stdout, or human lines on stdout. */
  success(json: Record<string, unknown>, lines: string[]): void;
  /** Prints a failure: JSON on stdout, or a message on stderr. */
  failure(json: Record<string, unknown>, message: string): void;
}

export function output(json: boolean): Output {
  return {
    json,
    success(body, lines) {
      process.stdout.write(json ? `${JSON.stringify(body)}\n` : `${lines.join("\n")}\n`);
    },
    failure(body, message) {
      if (json) process.stdout.write(`${JSON.stringify(body)}\n`);
      else process.stderr.write(`${message}\n`);
    },
  };
}

/** Loads configuration and opens the database for a command. Logs go to stderr so stdout stays clean. */
export function openForCommand(out: Output): { config: Config; database: Database } | undefined {
  setLogStream("stderr");
  try {
    const config = loadConfig();
    return { config, database: createDatabase(config.databaseUrl) };
  } catch (error) {
    if (error instanceof ConfigError) {
      out.failure({ ok: false, error: "unexpected", message: error.message }, error.message);
      return undefined;
    }
    throw error;
  }
}
