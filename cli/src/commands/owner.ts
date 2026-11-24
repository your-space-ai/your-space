// `your-space owner create | reset-link`: the server's own commands, with their rules and output
// (spec, User Story 3; 001 contracts/operator-commands.md).
import { Compose } from "../compose.ts";
import { Installation } from "../installation.ts";
import { expectOk, serverCommand } from "../server.ts";
import type { Ui } from "../ui.ts";

export async function ownerCreate(ui: Ui, workdir: string, flags: { name: string; username: string }): Promise<void> {
  const compose = new Compose(Installation.open(workdir).folder);
  const args = ["--name", flags.name, "--username", flags.username];
  const json = expectOk(await serverCommand(compose, "create-owner", args));
  const { ok: _ok, ...body } = json;
  ui.result(body, () => {
    ui.note(`${json.url}\nOpen it within 30 minutes; it works once.`, `Owner created: ${flags.name} (${json.username})`);
  });
}

export async function ownerResetLink(ui: Ui, workdir: string): Promise<void> {
  const compose = new Compose(Installation.open(workdir).folder);
  const json = expectOk(await serverCommand(compose, "reset-link"));
  const { ok: _ok, ...body } = json;
  ui.result(body, () => {
    ui.note(
      `${json.url}\nOpen it within 30 minutes; it works once and cancels earlier links. Using it signs out every device.`,
      `Password reset link for ${json.username}`,
    );
  });
}
