// Runs `your-space [--json] [--yes] [--verbose] upgrade --channel <channel> --workdir <folder>` as the
// Linux executable runs it, which the CLI under test, Node running src/index.ts, isn't: it then
// downloads the build's Linux executable, not its npm package (upgrade-channel.ts, buildCli).
// Arguments: <folder> <channel> [--json] [--yes] [--verbose].
import type { Channel } from "../../src/channel.ts";
import { upgradeChannel } from "../../src/commands/upgrade-channel.ts";
import { CliError } from "../../src/errors.ts";
import { Ui } from "../../src/ui.ts";

const [folder, channel, ...flags] = process.argv.slice(2);
const ui = new Ui({ json: flags.includes("--json"), yes: flags.includes("--yes"), verbose: flags.includes("--verbose") });
try {
  await upgradeChannel(ui, folder!, channel as Channel, { sea: true, platform: "linux", arch: process.arch });
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  ui.failure(error);
  process.exitCode = error.status;
}
