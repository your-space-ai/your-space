// Opens a link in the person's browser when this machine has a desktop, and not over SSH
// (research R10). The link is always printed as well.
import { run } from "./process.ts";

export function canOpen(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform === "darwin") return true;
  if (platform === "linux") return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return false;
}

export async function openLink(url: string): Promise<boolean> {
  if (!canOpen()) return false;
  const program = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    return (await run(program, [url])).code === 0;
  } catch {
    return false;
  }
}
