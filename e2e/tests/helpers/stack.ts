// Drives the Compose stack the journeys run against: the published compose.yaml with locally
// built images (deploy/compose.build.yaml). Set YS_E2E_COMPOSE to an executable that wraps
// `docker compose` to use a different setup.
import { execFile } from "node:child_process";
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
    ],
  ];
}

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export async function compose(args: string[], options: { allowFailure?: boolean; timeout?: number } = {}): Promise<Result> {
  const [program, base] = composeCommand();
  try {
    const { stdout, stderr } = await run(program, [...base, ...args], {
      timeout: options.timeout ?? 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string };
    const result = { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    if (!options.allowFailure) {
      throw new Error(`docker compose ${args.join(" ")} failed (${result.code}):\n${result.stderr}`);
    }
    return result;
  }
}

/** A fresh installation: removes the containers and volumes, then starts and waits for health. */
export async function resetStack(): Promise<void> {
  await compose(["down", "-v", "--remove-orphans"], { timeout: 120_000 });
  await compose(["up", "-d", "--wait"], { timeout: 240_000 });
}

export async function up(): Promise<void> {
  await compose(["up", "-d", "--wait"], { timeout: 240_000 });
}

export interface LinkOutput {
  ok: true;
  email: string;
  url: string;
  token: string;
  expiresAt: string;
}

export async function serverCommand(
  name: "create-owner" | "reset-link",
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

export async function createOwner(email = "sam@example.com", name = "Sam Rivera"): Promise<LinkOutput> {
  const result = await serverCommand("create-owner", ["--email", email, "--name", name]);
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
