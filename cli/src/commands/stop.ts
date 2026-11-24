// `your-space stop`: stops the apps through the runtime manager, then Your Space. Nothing is deleted
// (spec, User Story 2; FR-010).
import type { Compose } from "../compose.ts";
import { CliError } from "../errors.ts";
import { type App, listApps } from "../server.ts";
import { holdingLock } from "../installation-lock.ts";
import type { Ui } from "../ui.ts";
import { open } from "./shared.ts";

/**
 * The apps before stopping: none when the server isn't running, and null when it is running but
 * can't list them, for example right after a start, which is never read as "no apps".
 */
async function appsBeforeStop(compose: Compose): Promise<App[] | null> {
  if (!(await compose.running("server"))) return [];
  try {
    return await listApps(compose);
  } catch {
    return null;
  }
}

/** The question to ask before stopping, when stopping could cut an install off; null when none. */
export function stopQuestion(apps: App[] | null): string | null {
  if (apps === null) {
    return "Your Space couldn't say whether an app is still being installed or started, and stopping would cut that off. Stop anyway?";
  }
  const busy = apps.filter((a) => a.state === "installing" || a.state === "starting").map((a) => a.name);
  if (!busy.length) return null;
  return `${busy.join(", ")} ${busy.length > 1 ? "are" : "is"} still being installed or started; stopping cuts that off. Stop anyway?`;
}

/** The apps that stopping stops, for --json; null when they couldn't be listed. */
export function stoppedApps(apps: App[] | null): string[] | null {
  return apps === null ? null : apps.filter((a) => a.state !== "stopped" && a.state !== "removed").map((a) => a.name);
}

export async function stop(ui: Ui, workdir: string): Promise<void> {
  await holdingLock(workdir, "stop", () => stopHolding(ui, workdir));
}

async function stopHolding(ui: Ui, workdir: string): Promise<void> {
  ui.intro("Your Space");
  const { compose } = await open(ui, workdir);
  const services = await compose.ps();
  if (!services.some((s) => s.state === "running")) {
    ui.result({ stopped: [] }, () => ui.outro("Your Space is already stopped."));
    return;
  }
  const apps = await appsBeforeStop(compose);
  const question = stopQuestion(apps);
  if (question) {
    const go = await ui.confirm({ message: question, flag: "--yes", initial: false });
    if (!go) throw new CliError("cancelled", "Not stopped. Run it again when the install has finished.");
  }
  const stopped = stoppedApps(apps);
  await ui.step("Stopping Your Space and its apps", "Stopped. Your data is kept", async () => {
    if (await compose.running("runtime")) await compose.must(["exec", "-T", "runtime", "stop-apps"], "Couldn't stop the apps.");
    await compose.must(["stop"], "Couldn't stop Your Space.");
  });
  ui.result({ stopped }, () => ui.outro("Start it again with: your-space start"));
}
