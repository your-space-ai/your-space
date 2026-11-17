// `your-space status`: the same summary as `start`, read from the running space (FR-011).
import { checkEngine } from "../engine.ts";
import { Compose } from "../compose.ts";
import { Installation } from "../installation.ts";
import type { Ui } from "../ui.ts";
import { gather, showSummary } from "./shared.ts";

export async function status(ui: Ui, workdir: string): Promise<void> {
  const installation = Installation.open(workdir);
  const engine = await checkEngine();
  const compose = new Compose(installation.folder);
  showSummary(ui, await gather(installation, compose, engine));
}
