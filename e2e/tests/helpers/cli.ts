// Runs the your-space CLI the way a person does: from a release, in its own folder (journey 003).
// The release is made from this repository with deploy/release-files.sh and served locally
// (YS_E2E_RELEASES), and the locally built images are tagged with the CLI's version, so nothing is
// downloaded from GitHub or a registry. YS_E2E_CLI names a built executable to run instead of the
// bundle, as CI does.
import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { docker } from "./stack.ts";

const exec = promisify(execFile);
export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const CLI_VERSION = (JSON.parse(readFileSync(join(root, "cli/package.json"), "utf8")) as { version: string }).version;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The last line of stdout as JSON, when the command ran with --json. */
  json: any;
}

export interface Cli {
  folder: string;
  env: Record<string, string>;
  run(args: string[], options?: { env?: Record<string, string>; folder?: string }): Promise<CliResult>;
  compose(args: string[], options?: { input?: string }): Promise<CliResult>;
}

/** Tags the images the browser tests built with the CLI's version, as a release publishes them. */
export async function tagImages(): Promise<void> {
  for (const name of ["server", "web", "runtime"]) {
    await docker(["tag", `your-space-${name}:local`, `ghcr.io/your-space-ai/your-space-${name}:${CLI_VERSION}`], false);
  }
}

/** Makes the release files with SHA256SUMS and serves them as GitHub's release downloads would. */
export async function serveRelease(): Promise<{ url: string; close(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "ys-release-"));
  const release = join(dir, `v${CLI_VERSION}`);
  mkdirSync(release);
  await exec(join(root, "deploy/release-files.sh"), [CLI_VERSION, release]);
  const tarball = readFileSync(join(release, "your-space.tar.gz"));
  writeFileSync(join(release, "SHA256SUMS"), `${createHash("sha256").update(tarball).digest("hex")}  your-space.tar.gz\n`);
  const server: Server = createServer((request, response) => {
    const path = join(dir, decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    if (!path.startsWith(dir) || !existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200);
    createReadStream(path).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function command(): [string, string[]] {
  if (process.env.YS_E2E_CLI) return [process.env.YS_E2E_CLI, []];
  return [process.execPath, [join(root, "cli/dist/your-space.cjs")]];
}

function spawnResult(program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      let json: unknown;
      try {
        json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
      } catch {
        json = undefined;
      }
      resolve({ code: code ?? 1, stdout, stderr, json });
    });
    child.stdin.end(input ?? "");
  });
}

/**
 * A folder for an installation. `env` reaches every CLI run and Compose command: the release's
 * address, and COMPOSE_FILE when a test adds its own Compose file next to the release's.
 */
export function cliIn(folder: string, env: Record<string, string>): Cli {
  const base = () => {
    const { FORCE_COLOR: _color, ...rest } = process.env;
    return { ...rest, NO_COLOR: "1", ...env };
  };
  return {
    folder,
    env,
    run(args, options = {}) {
      const [program, prefix] = command();
      return spawnResult(program, [...prefix, ...args], options.folder ?? folder, { ...base(), ...options.env });
    },
    compose(args, options = {}) {
      return spawnResult("docker", ["compose", ...args], folder, base(), options.input);
    },
  };
}

export function newFolder(name: string): string {
  return mkdtempSync(join(tmpdir(), `ys-cli-${name}-`));
}

/** Removes an installation the CLI made, with its apps and data, so the next test starts clean. */
export async function removeInstallation(cli?: Cli): Promise<void> {
  const label = "label=ai.your-space.installation=your-space";
  const ids = (kind: string[]) => docker([...kind, "--filter", label]).then((r) => r.stdout.split("\n").filter(Boolean));
  for (const id of await ids(["ps", "-aq"])) await docker(["rm", "-f", id]);
  for (const id of await ids(["volume", "ls", "-q"])) await docker(["volume", "rm", "-f", id]);
  for (const id of await ids(["network", "ls", "-q"])) {
    await docker(["network", "disconnect", "-f", id, "your-space-caddy-1"]);
    await docker(["network", "rm", id]);
  }
  if (cli && existsSync(join(cli.folder, "compose.yaml"))) await cli.compose(["down", "-v", "--remove-orphans"]);
  // Whatever an earlier run left: containers and volumes of the your-space project, from any folder.
  const project = "label=com.docker.compose.project=your-space";
  for (const id of (await docker(["ps", "-aq", "--filter", project])).stdout.split("\n").filter(Boolean)) await docker(["rm", "-f", id]);
  for (const id of (await docker(["volume", "ls", "-q", "--filter", project])).stdout.split("\n").filter(Boolean)) await docker(["volume", "rm", "-f", id]);
}

