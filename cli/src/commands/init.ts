// `your-space init`: makes the current folder an installation. It downloads the release files for the
// CLI's own version, checks them, writes `.env` from env.example, and sets the setup's lines
// (spec, User Story 1; contracts/cli-commands.md).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliError } from "../errors.ts";
import { Installation } from "../installation.ts";
import { fetchRelease } from "../release.ts";
import { chooseSetup, setupLines, type SetupFlags } from "../setup.ts";
import type { Ui } from "../ui.ts";
import { VERSION } from "../version.ts";
import { engineFor, rememberSocket } from "./shared.ts";

export async function init(ui: Ui, workdir: string, flags: SetupFlags, releaseDir?: string): Promise<void> {
  const folder = resolve(workdir);
  ui.intro("Your Space");
  if (Installation.isOne(folder)) {
    throw new CliError("already_initialised", `${folder} is already a Your Space installation. Change its setup with \`your-space configure\`, or start it with \`your-space start\`.`);
  }
  mkdirSync(folder, { recursive: true });
  const others = readdirSync(folder).filter((name) => !name.startsWith("."));
  if (others.length > 0) {
    const go = await ui.confirm({ message: `${folder} already has other files. Put Your Space's files here too?`, flag: "--yes", initial: true });
    if (!go) throw new CliError("folder_not_empty", `${folder} isn't empty. Run init in a new folder, or confirm with --yes.`);
  }

  const installation = new Installation(folder);
  // Checked before downloading anything, so a missing engine is found first (FR-005).
  const engine = await engineFor(ui, installation);
  const setup = await chooseSetup(ui, flags, { kind: "this-machine", port: 80 });

  await ui.step(
    releaseDir ? `Checking bundled Your Space ${VERSION}` : `Downloading Your Space ${VERSION}`,
    `Checked Your Space ${VERSION}`,
    () => fetchRelease(VERSION, folder, releaseDir),
  );
  if (!existsSync(installation.envPath)) copyFileSync(join(folder, "env.example"), installation.envPath);
  const env = installation.writeEnv(setupLines(setup));
  rememberSocket(ui, installation, engine);

  ui.result({ folder, version: VERSION, setup: { kind: setup.kind }, env }, () => {
    ui.note(env.length ? env.join("\n") : "Nothing: this machine is the default.", "Settings written to .env");
    ui.outro(`Ready. Start it with: ${workdir === "." ? "" : `cd ${workdir} && `}your-space start`);
  });
}
