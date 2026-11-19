// `your-space configure`: changes the setup after installing, with the same questions and checks as
// `init` and `start`, and restarts Your Space when it is running (FR-014).
import { setupLines, chooseSetup, type SetupFlags } from "../setup.ts";
import type { Ui } from "../ui.ts";
import { checkDomain, checkPorts, gather, open, showSummary, startStack, waitForCertificate } from "./shared.ts";

export async function configure(ui: Ui, workdir: string, flags: SetupFlags & { ignoreChecks?: boolean }): Promise<void> {
  ui.intro("Your Space");
  const { installation, compose, engine } = await open(ui, workdir);
  const before = installation.envText();
  let setup = await chooseSetup(ui, flags, installation.setup());
  await checkDomain(ui, setup, flags.ignoreChecks === true);
  const env = installation.writeEnv(setupLines(setup));
  const running = await compose.running("server");
  if (!running) {
    ui.result({ setup: { kind: setup.kind }, env, summary: null }, () => ui.outro("Saved. Start Your Space with: your-space start"));
    return;
  }
  try {
    setup = await checkPorts(ui, installation, compose, setup);
    await startStack(ui, compose);
  } catch (error) {
    // Keep the setup that worked, so a wrong answer doesn't leave Your Space unable to start.
    installation.writeEnvText(before);
    ui.warn("Your previous settings were put back in .env, and Your Space restarted with them.");
    await compose.run(["up", "-d", "--wait"]);
    throw error;
  }
  const certificate = await waitForCertificate(ui, compose, setup, 180);
  const summary = await gather(installation, compose, engine, { certificate });
  ui.result({ setup: { kind: setup.kind }, env, summary }, () => {
    showSummary(ui, summary);
    ui.outro("Your Space restarted with the new settings.");
  });
}
