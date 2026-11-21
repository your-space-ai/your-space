import { createReadStream } from "node:fs";
import { Compose } from "../compose.ts";
import { CliError } from "../errors.ts";
import { Installation } from "../installation.ts";
import { expectOk, serverCommand } from "../server.ts";
import type { Ui } from "../ui.ts";

export interface UpgradeFlags {
  refresh?: boolean;
  inspect?: boolean;
  kit?: string;
  expectKit?: string;
  expectInstallation?: string;
}

/** Keep the operator's file on this machine and send its exact UTF-8 text on stdin. */
async function kitText(file: string): Promise<string> {
  if (file === "-" && process.stdin.isTTY) throw new CliError("usage", "Pipe the kit on stdin when using --kit -.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of file === "-" ? process.stdin : createReadStream(file)) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 256 * 1024) throw new CliError("kit_file", "The kit exceeds 256 KiB.");
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("kit_file", "The kit file could not be read.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new CliError("kit_file", "The kit must contain UTF-8 text.");
  }
}

export async function upgradeAgentKit(ui: Ui, workdir: string, name: string, flags: UpgradeFlags): Promise<void> {
  const args = [name];
  if (flags.inspect) {
    if (flags.refresh || flags.kit !== undefined || flags.expectKit !== undefined || flags.expectInstallation !== undefined) {
      throw new CliError("usage", "Use --inspect on its own.");
    }
    args.push("--inspect");
  } else {
    if (!flags.expectKit || !flags.expectInstallation || Boolean(flags.refresh) === Boolean(flags.kit)) {
      throw new CliError("usage", "Supply --expect-kit and --expect-installation, with either --kit <file> or --refresh.");
    }
    args.push("--expect-kit", flags.expectKit, "--expect-installation", flags.expectInstallation);
    if (flags.kit) args.push("--kit", "-");
    else args.push("--refresh");
  }
  const compose = new Compose(Installation.open(workdir).folder);
  const input = flags.kit ? await kitText(flags.kit) : undefined;
  const result = expectOk(await serverCommand(compose, "upgrade-agent-kit", args, input));
  const { ok: _ok, ...body } = result;
  ui.result(body, () => {
    ui.note(
      `App ID: ${result.appId}\nInstallation: ${result.installation}\nKit version: ${result.kitVersion ?? "none"}\nKit source: ${result.kitSource ?? "none"}` +
        (result.runtime ? `\nRuntime: ${result.runtime}` : ""),
      `Kit for ${result.name}`,
    );
  });
}
