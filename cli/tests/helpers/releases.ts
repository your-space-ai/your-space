// A stand-in for GitHub's release downloads, served from a folder of `<tag>/<file>` (YS_E2E_RELEASES),
// and a way to run the CLI that leaves this process free to answer it.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

export interface Served {
  url: string;
  /** Each path asked for, in order. */
  requests: string[];
  close(): Promise<void>;
}

/** Serves `folder`; a request for a path in `hold` gets no answer, as a download under way. */
export async function serveReleases(folder: string, hold: string[] = []): Promise<Served> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    requests.push(path);
    if (hold.includes(path)) return;
    try {
      if (path.split("/").includes("..")) throw new Error("outside");
      response.end(readFileSync(join(folder, path)));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a program to its end without blocking this process, as spawnSync would; `started` gets it while it runs. */
export function spawnAsync(program: string, args: string[], env: NodeJS.ProcessEnv, started?: (child: ChildProcess) => void): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    started?.(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
