// `your-space status`: the same summary as `start`, read from the running space (FR-011).
import { checkEngine } from "../engine.ts";
import { Compose, otherInstallation } from "../compose.ts";
import { CliError } from "../errors.ts";
import { Installation } from "../installation.ts";
import type { Ui } from "../ui.ts";
import { gather, showSummary } from "./shared.ts";

export async function status(ui: Ui, workdir: string, requireRunning = false): Promise<void> {
  const installation = Installation.open(workdir);
  const engine = await checkEngine();
  const compose = new Compose(installation.folder);
  if (requireRunning) {
    const other = await otherInstallation(installation.project(), installation.folder, "require-match");
    if (other) throw new CliError("another_installation", "The running workspace belongs to another installation folder.", { folder: other });
  }
  const summary = await gather(installation, compose, engine, { requireRunning });
  showSummary(ui, summary);
}
