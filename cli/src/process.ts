// Runs another program and collects what it printed. The only place the CLI starts processes.
import { spawn } from "node:child_process";

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Lets the program use the terminal directly, as `logs --follow` does. */
  inherit?: boolean;
}

/** Resolves with the exit code, or rejects with ENOENT when the program isn't installed. */
export function run(program: string, args: string[], options: RunOptions = {}): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr }));
    if (!options.inherit) child.stdin?.end(options.input ?? "");
  });
}

/** True when a program couldn't be started because it isn't installed. */
export function isMissingProgram(error: unknown): boolean {
  const e = error as NodeJS.ErrnoException | undefined;
  return e?.code === "ENOENT" && Boolean(e.syscall?.startsWith("spawn"));
}
