// Drives the Compose stack the journeys run against: the published compose.yaml with locally
// built images (deploy/compose.build.yaml). Set YS_E2E_COMPOSE to an executable that wraps
// `docker compose` to use a different setup.
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));

function composeCommand(): [string, string[]] {
  if (process.env.YS_E2E_COMPOSE) return [process.env.YS_E2E_COMPOSE, []];
  return [
    "docker",
    [
      "compose",
      "-p",
      "ys-e2e",
      "--env-file",
      `${root}e2e/stack.env`,
      "-f",
      `${root}deploy/compose.yaml`,
      "-f",
      `${root}deploy/compose.build.yaml`,
      "-f",
      `${root}e2e/compose.e2e.yaml`,
    ],
  ];
}

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export async function compose(
  args: string[],
  options: { allowFailure?: boolean; timeout?: number; env?: Record<string, string> } = {},
): Promise<Result> {
  const [program, base] = composeCommand();
  try {
    const { stdout, stderr } = await run(program, [...base, ...args], {
      timeout: options.timeout ?? 180_000,
      env: { ...process.env, ...options.env },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string };
    const result = { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    if (!options.allowFailure) {
      // A build writes each step's log to standard output and ends with the failing step's last
      // lines, the command's own error, which standard error doesn't repeat.
      const output = result.stdout.trimEnd().split("\n").slice(-60).join("\n");
      throw new Error(`docker compose ${args.join(" ")} failed (${result.code}):\n${output ? `${output}\n` : ""}${result.stderr}`);
    }
    return result;
  }
}

/** Runs a compose command with text on its standard input, as a heredoc in the guide does. */
export function composeWithInput(args: string[], input: string, env: Record<string, string> = {}): Promise<Result> {
  const [program, base] = composeCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(program, [...base, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ code, stdout, stderr });
      else reject(new Error(`docker compose ${args.join(" ")} failed (${code}):\n${stderr}`));
    });
    child.stdin.end(input);
  });
}

/** Runs the Docker CLI on the test machine, for what a test checks from outside the stack. */
export async function docker(args: string[], allowFailure = true): Promise<Result> {
  try {
    const { stdout, stderr } = await run("docker", args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string };
    if (!allowFailure) throw new Error(`docker ${args.join(" ")} failed: ${e.stderr}`);
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/**
 * Removes every app the test installation ran: their containers, volumes and networks are their
 * own Compose projects, which `docker compose down -v` of Your Space leaves alone.
 */
export async function removeApps(): Promise<void> {
  const label = "label=ai.your-space.installation=ys-e2e";
  const ids = (kind: string[]) => docker([...kind, "--filter", label]).then((r) => r.stdout.split("\n").filter(Boolean));
  const containers = await ids(["ps", "-aq"]);
  if (containers.length) await docker(["rm", "-f", ...containers]);
  const volumes = await ids(["volume", "ls", "-q"]);
  if (volumes.length) await docker(["volume", "rm", "-f", ...volumes]);
  const networks = await ids(["network", "ls", "-q"]);
  for (const network of networks) {
    await docker(["network", "disconnect", "-f", network, "ys-e2e-caddy-1"]);
    await docker(["network", "rm", network]);
  }
}

/** A fresh installation: removes the containers and volumes, then starts and waits for health. */
export async function resetStack(env: Record<string, string> = {}): Promise<void> {
  await removeApps();
  await compose(["down", "-v", "--remove-orphans"], { timeout: 120_000 });
  await compose(["up", "-d", "--wait"], { timeout: 240_000, env });
}

export async function up(env: Record<string, string> = {}): Promise<void> {
  await compose(["up", "-d", "--wait"], { timeout: 240_000, env });
}

export interface LinkOutput {
  ok: true;
  username: string;
  url: string;
  token: string;
  expiresAt: string;
}

export async function serverCommand(
  name: "create-owner" | "reset-link" | "show-secrets" | "install-app" | "list-apps",
  args: string[] = [],
): Promise<{ code: number; json: any; stdout: string; stderr: string }> {
  const result = await compose(["exec", "-T", "server", name, ...args, "--json"], { allowFailure: true });
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

export async function createOwner(username = "sam", name = "Sam Rivera"): Promise<LinkOutput> {
  const result = await serverCommand("create-owner", ["--username", username, "--name", name]);
  if (result.code !== 0) throw new Error(`create-owner exited ${result.code}: ${result.stdout}${result.stderr}`);
  return result.json as LinkOutput;
}

export async function resetLink(): Promise<LinkOutput> {
  const result = await serverCommand("reset-link");
  if (result.code !== 0) throw new Error(`reset-link exited ${result.code}: ${result.stdout}${result.stderr}`);
  return result.json as LinkOutput;
}

/** Runs SQL in the stack's database and returns the rows as tab-separated lines. */
export async function sql(query: string): Promise<string[]> {
  const result = await compose(["exec", "-T", "postgres", "psql", "-U", "yourspace", "-d", "yourspace", "-At", "-F", "\t", "-c", query]);
  return result.stdout.trim().split("\n").filter(Boolean);
}

export async function identities(): Promise<string[]> {
  return sql(`select u.id, o.id, m.id, m.role, i.state
    from installation i join organization o on o.id = i.workspace_id
    join member m on m.organization_id = o.id join "user" u on u.id = m.user_id order by m.id`);
}

export async function logs(services: string[] = []): Promise<string> {
  const result = await compose(["logs", "--no-color", ...services]);
  return result.stdout + result.stderr;
}
