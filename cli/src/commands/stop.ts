// `your-space stop`: stops the apps through the runtime manager, then Your Space. Nothing is deleted
// (spec, User Story 2; FR-010).
import { CliError } from "../errors.ts";
import { listApps } from "../server.ts";
import type { Ui } from "../ui.ts";
import { open } from "./shared.ts";

export async function stop(ui: Ui, workdir: string): Promise<void> {
  ui.intro("Your Space");
  const { compose } = await open(ui, workdir);
  const services = await compose.ps();
  if (!services.some((s) => s.state === "running")) {
    ui.result({ stopped: [] }, () => ui.outro("Your Space is already stopped."));
    return;
  }
  const apps = (await compose.running("server")) ? await listApps(compose).catch(() => []) : [];
  const busy = apps.filter((a) => a.state === "installing" || a.state === "starting");
  if (busy.length) {
    const go = await ui.confirm({
      message: `${busy.map((a) => a.name).join(", ")} ${busy.length > 1 ? "are" : "is"} still being installed or started; stopping cuts that off. Stop anyway?`,
      flag: "--yes",
      initial: false,
    });
    if (!go) throw new CliError("cancelled", "Not stopped. Run it again when the install has finished.");
  }
  const running = apps.filter((a) => a.state !== "stopped" && a.state !== "removed").map((a) => a.name);
  await ui.step("Stopping Your Space and its apps", "Stopped. Your data is kept", async () => {
    if (await compose.running("runtime")) await compose.must(["exec", "-T", "runtime", "stop-apps"], "Couldn't stop the apps.");
    await compose.must(["stop"], "Couldn't stop Your Space.");
  });
  ui.result({ stopped: running }, () => ui.outro("Start it again with: your-space start"));
}
