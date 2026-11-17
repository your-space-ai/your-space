// Runs create-owner and reset-link as real processes, the way the operator does.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PUBLIC_URL, settingsFor, TEST_DATA_KEY, TEST_SECRET } from "./env.ts";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout parsed as JSON, when it is JSON. */
  json: any;
}

export function runCommand(
  name: "create-owner" | "reset-link" | "show-owner",
  args: string[],
  options: { databaseUrl: string; publicUrl?: string; env?: Record<string, string> },
): Promise<CommandResult> {
  const script = fileURLToPath(new URL(`../../src/commands/${name}.ts`, import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        DATABASE_URL: options.databaseUrl,
        ...settingsFor(options.publicUrl ?? PUBLIC_URL),
        BETTER_AUTH_SECRET: TEST_SECRET,
        YS_DATA_KEY: TEST_DATA_KEY,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}
