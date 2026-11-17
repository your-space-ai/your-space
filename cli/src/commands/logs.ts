// `your-space logs`: Your Space's logs through Compose, for one service or all (FR-012).
import { CliError } from "../errors.ts";
import { Installation } from "../installation.ts";
import { run } from "../process.ts";

export async function logs(workdir: string, service: string | undefined, options: { follow?: boolean; tail?: string }): Promise<void> {
  const installation = Installation.open(workdir);
  if (options.tail !== undefined && !/^\d+$/.test(options.tail)) throw new CliError("invalid_input", "--tail takes a number of lines, like 100.");
  const args = ["compose", "logs", ...(options.follow ? ["--follow"] : []), ...(options.tail ? ["--tail", options.tail] : []), ...(service ? [service] : [])];
  const ran = await run("docker", args, { cwd: installation.folder, inherit: true });
  if (ran.code !== 0) process.exitCode = ran.code;
}
