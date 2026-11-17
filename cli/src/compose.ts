// Runs Docker Compose in the installation's folder, with no -f or -p, so it reads compose.yaml and
// .env exactly as `docker compose` does when a person runs it there.
import { realpathSync } from "node:fs";
import { CliError } from "./errors.ts";
import { engineProblem } from "./engine.ts";
import { run, type Ran } from "./process.ts";

export interface ServiceState {
  name: string;
  state: string;
  health: string;
  exitCode: number;
  /** Ports published on this machine. */
  ports: number[];
}

/** Compose prints one JSON object per line since 2.21, and one array before that. */
export function parseJsonLines<T>(stdout: string): T[] {
  const text = stdout.trim();
  if (!text) return [];
  if (text.startsWith("[")) return JSON.parse(text) as T[];
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

export function parsePs(stdout: string): ServiceState[] {
  return parseJsonLines<{ Service: string; State: string; Health?: string; ExitCode?: number; Publishers?: { PublishedPort: number }[] }>(stdout).map(
    (row) => ({
      name: row.Service,
      state: row.State,
      health: row.Health ?? "",
      exitCode: row.ExitCode ?? 0,
      ports: (row.Publishers ?? []).map((p) => p.PublishedPort).filter((p) => p > 0),
    }),
  );
}

export class Compose {
  readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  async run(args: string[], options: { input?: string; inherit?: boolean } = {}): Promise<Ran> {
    const ran = await run("docker", ["compose", ...args], { cwd: this.folder, ...options });
    if (ran.code !== 0 && /Cannot connect to the Docker daemon|permission denied while trying to connect/i.test(ran.stderr)) {
      throw engineProblem(ran.stderr);
    }
    return ran;
  }

  /** Runs a command that must succeed; its output becomes the error's detail otherwise. */
  async must(args: string[], message: string, options: { input?: string } = {}): Promise<Ran> {
    const ran = await this.run(args, options);
    if (ran.code !== 0) throw new CliError("start_failed", message, {}, `${ran.stdout}${ran.stderr}`);
    return ran;
  }

  async ps(): Promise<ServiceState[]> {
    const ran = await this.run(["ps", "--all", "--format", "json"]);
    if (ran.code !== 0) return [];
    return parsePs(ran.stdout);
  }

  async running(service: string): Promise<boolean> {
    return (await this.ps()).some((s) => s.name === service && s.state === "running");
  }

  logs(args: string[]): Promise<Ran> {
    return this.run(["logs", "--no-color", ...args]);
  }
}

/** The folder another installation runs from, when the engine already runs `project` from elsewhere. */
export async function otherInstallation(project: string, folder: string): Promise<string | null> {
  const ran = await run("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (ran.code !== 0) return null;
  const mine = realpathSync(folder);
  for (const entry of parseJsonLines<{ Name: string; ConfigFiles: string }>(ran.stdout)) {
    if (entry.Name !== project) continue;
    const dirs = entry.ConfigFiles.split(",").map((file) => file.replace(/\/[^/]+$/, ""));
    if (!dirs.some((dir) => dir === mine || dir === folder)) return dirs[0] ?? null;
  }
  return null;
}
