// What the CLI checks before starting: ports (research R7).
import { connect as tcpConnect } from "node:net";
import { run } from "./process.ts";

/** True when something answers on the port on this machine. */
export function portAnswers(port: number, host = "127.0.0.1", timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ port, host });
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The container that publishes the port, when it is one. */
export async function portUser(port: number): Promise<string | undefined> {
  const ran = await run("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"]).catch(() => undefined);
  const name = ran?.stdout.trim().split("\n")[0];
  return name ? `the container ${name}` : undefined;
}

/** The first port from `start` that nothing answers on. */
export async function freePort(start = 8081): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (!(await portAnswers(port))) return port;
  }
  return start;
}

