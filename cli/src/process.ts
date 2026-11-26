// Runs another program and collects what it printed. The only place the CLI starts processes.
import { spawn } from "node:child_process";

export interface Ran {
  code: number;
  /** The signal that ended the program, when one did; `code` is then 128. */
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Lets the program use the terminal directly, as `logs --follow` does. */
  inherit?: boolean;
  /** With `inherit`, its output is collected in `stdout` instead of reaching this process's. */
  collectStdout?: boolean;
  /** An open file the program reads as its input, in place of `input`, such as a database backup. */
  inputFile?: number;
  /** An open file the program writes its output to, byte for byte, in place of `stdout`. */
  outputFile?: number;
  /**
   * Passes SIGINT and SIGTERM on to the program while it runs, instead of ending this process, so
   * the program decides what they do and this process waits for its result.
   */
  forwardSignals?: boolean;
  /** Stops the program with SIGTERM after this many milliseconds. */
  timeout?: number;
  /** Stops the program with SIGTERM when this is aborted, and rejects. */
  signal?: AbortSignal;
}

/** Resolves with the exit code, or rejects with ENOENT when the program isn't installed. */
export function run(program: string, args: string[], options: RunOptions = {}): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inherit ? ["inherit", options.collectStdout ? "pipe" : "inherit", "inherit"] : [options.inputFile ?? "pipe", options.outputFile ?? "pipe", "pipe"],
      timeout: options.timeout,
      signal: options.signal,
    });
    let stdout = "";
    let stderr = "";
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const signals: NodeJS.Signals[] = options.forwardSignals ? ["SIGINT", "SIGTERM"] : [];
    for (const signal of signals) process.on(signal, forward);
    const done = () => {
      for (const signal of signals) process.off(signal, forward);
    };
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      done();
      reject(error);
    });
    child.on("close", (code, signal) => {
      done();
      resolve({ code: code ?? (signal ? 128 : 1), ...(signal ? { signal } : {}), stdout, stderr });
    });
    // Docker may exit before it reads the whole input (for example, when the server is stopped).
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin?.end(options.input ?? "");
  });
}

/** True when a program couldn't be started because it isn't installed. */
export function isMissingProgram(error: unknown): boolean {
  const e = error as NodeJS.ErrnoException | undefined;
  return e?.code === "ENOENT" && Boolean(e.syscall?.startsWith("spawn"));
}
