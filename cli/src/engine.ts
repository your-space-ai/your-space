// The engine connection: the engine Docker's own client reaches, its version and processor, and
// the socket the runtime manager mounts (research R5). Only this module and compose.ts run Docker.
import { CliError } from "./errors.ts";
import { isMissingProgram, run } from "./process.ts";

export interface Engine {
  version: string;
  os: string;
  arch: string;
  endpoint: string;
  compose: string;
}

/** The installation guide's minimums: Engine 28.3.3 (CVE-2025-54388) and Compose 2.26.0. */
export const MIN_ENGINE = "28.3.3";
export const MIN_COMPOSE = "2.26.0";
const DEFAULT_SOCKETS = ["/var/run/docker.sock", "/run/docker.sock"];

/** Compares dotted versions, ignoring a leading `v` and anything after a `-` or `+`. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(version);
  const b = parts(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** Turns what the Docker CLI printed when it couldn't reach the engine into what to do. */
export function engineProblem(stderr: string): CliError {
  if (/permission denied/i.test(stderr)) {
    return new CliError(
      "permission_denied",
      "You don't have permission to use the Docker engine. Add yourself to the docker group (sudo usermod -aG docker $USER, then sign in again), or run this as a user who can use Docker.",
      {},
      stderr,
    );
  }
  return new CliError(
    "engine_missing",
    "No Docker engine is running. Your Space needs a Docker-compatible engine: Docker Engine on Linux; OrbStack, Colima or Docker Desktop on a Mac. Start it, then run this again.",
    {},
    stderr,
  );
}

/** The client's endpoint: DOCKER_HOST, or the current context's. */
export async function endpoint(): Promise<string> {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST;
  const ran = await run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  return ran.code === 0 && ran.stdout.trim() ? ran.stdout.trim() : "unix:///var/run/docker.sock";
}

/**
 * The socket path the runtime manager should mount, when it isn't the default; null when the default
 * works. Remote engines are refused: Your Space publishes its ports on the engine's machine.
 */
export function engineSocket(host: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!host.startsWith("unix://")) {
    throw new CliError(
      "engine_unsupported",
      `Docker is set to use an engine on another machine (${host}). Your Space runs on the engine of the machine it serves; use this machine's engine (docker context use default), or run the CLI on that machine.`,
    );
  }
  const path = host.slice("unix://".length);
  // On a Mac the engine runs in a virtual machine, where /var/run/docker.sock is its own socket.
  if (platform === "darwin" || DEFAULT_SOCKETS.includes(path)) return null;
  return path;
}

/** Checks the engine and Compose, and returns what the summary shows. */
export async function checkEngine(): Promise<Engine> {
  // An engine on another machine is refused before trying to reach it.
  const host = await endpoint().catch(() => "unix:///var/run/docker.sock");
  engineSocket(host);
  let ran;
  try {
    ran = await run("docker", ["version", "--format", "json"]);
  } catch (error) {
    if (isMissingProgram(error)) {
      throw new CliError(
        "engine_missing",
        "Docker isn't installed. Your Space needs a Docker-compatible engine: Docker Engine on Linux (https://docs.docker.com/engine/install/); OrbStack, Colima or Docker Desktop on a Mac.",
      );
    }
    throw error;
  }
  let info: { Server?: { Version?: string; Os?: string; Arch?: string } | null } = {};
  try {
    info = JSON.parse(ran.stdout);
  } catch {
    // Older clients print nothing useful when the engine is down; the error says enough.
  }
  if (!info.Server?.Version) throw engineProblem(ran.stderr);
  const version = info.Server.Version;
  if (info.Server.Os === "linux" && !versionAtLeast(version, MIN_ENGINE)) {
    throw new CliError(
      "engine_unsupported",
      `Docker Engine ${version} is too old: Your Space needs ${MIN_ENGINE} or newer, since older versions can open ports meant for this machine to the network after a firewall reload (CVE-2025-54388). Update Docker, then run this again.`,
    );
  }
  const composeRan = await run("docker", ["compose", "version", "--short"]);
  const compose = composeRan.stdout.trim();
  if (composeRan.code !== 0 || !compose) {
    throw new CliError(
      "compose_missing",
      "Docker Compose isn't installed. Install the Docker Compose plugin (https://docs.docker.com/compose/install/linux/), then run this again.",
      {},
      composeRan.stderr,
    );
  }
  if (!versionAtLeast(compose, MIN_COMPOSE)) {
    throw new CliError("compose_missing", `Docker Compose ${compose} is too old: Your Space needs ${MIN_COMPOSE} or newer. Update it, then run this again.`);
  }
  return { version, os: info.Server.Os ?? "", arch: info.Server.Arch ?? "", endpoint: host, compose };
}
