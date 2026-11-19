// `your-space configure`: changes the setup after installing, with the same questions and checks as
// `init` and `start`, and restarts Your Space when it is running (FR-014).
import type { Compose } from "../compose.ts";
import type { Installation } from "../installation.ts";
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
  let applied = false;
  try {
    setup = await checkPorts(ui, installation, compose, setup);
    applied = true;
    await startStack(ui, compose);
  } catch (error) {
    await putBack(ui, installation, compose, before, applied);
    throw error;
  }
  const certificate = await waitForCertificate(ui, compose, setup, 180);
  const summary = await gather(installation, compose, engine, { certificate });
  ui.result({ setup: { kind: setup.kind }, env, summary }, () => {
    showSummary(ui, summary);
    ui.outro("Your Space restarted with the new settings.");
  });
}

/**
 * Keeps the setup that worked, so a wrong answer doesn't leave Your Space unable to start: puts
 * `.env` back and, when Compose was already asked to apply the new setup, starts Your Space again
 * with the previous one, saying whether that worked. The caller then throws the failure that got
 * here, never one from this restart.
 */
export async function putBack(
  ui: Pick<Ui, "warn">,
  installation: Pick<Installation, "writeEnvText">,
  compose: Pick<Compose, "run">,
  before: string,
  applied: boolean,
): Promise<void> {
  installation.writeEnvText(before);
  if (!applied) {
    ui.warn("Your previous settings were put back in .env. Your Space still runs with them.");
    return;
  }
  const restarted = await compose.run(["up", "-d", "--wait"]).then((ran) => ran.code === 0, () => false);
  ui.warn(
    restarted
      ? "Your previous settings were put back in .env, and Your Space restarted with them."
      : "Your previous settings were put back in .env, but Your Space didn't start with them either. See why with: your-space logs",
  );
}
