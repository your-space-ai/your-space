// `your-space start`: checks, starts Your Space, creates the owner the first time, and prints the
// summary (spec, User Stories 1, 2 and 4; contracts/cli-commands.md).
import { CliError } from "../errors.ts";
import { givePostgresPassword, newSecrets } from "../secrets.ts";
import { expectOk, serverCommand, showOwner } from "../server.ts";
import { openLink } from "../browser.ts";
import type { Link } from "../summary.ts";
import type { Ui } from "../ui.ts";
import { checkPorts, gather, open, showSummary, startStack } from "./shared.ts";

export interface StartFlags {
  ownerName?: string;
  ownerUsername?: string;
  ownerEmail?: string;
  open: boolean;
  newSecrets?: boolean;
}

export async function start(ui: Ui, workdir: string, flags: StartFlags): Promise<void> {
  ui.intro("Your Space");
  const { installation, compose, engine } = await open(ui, workdir);
  await checkPorts(ui, installation, compose, installation.setup());

  if (flags.newSecrets) {
    await ui.step("Making new secrets", "New secrets made, and PostgreSQL given the new password", async () => {
      await newSecrets(compose, ["auth-secret", "database-password"]);
      await givePostgresPassword(compose);
    });
  }
  await startStack(ui, compose);

  let link: Link | undefined;
  if ((await showOwner(compose)) === null) link = await createOwner(ui, compose, flags);
  const summary = await gather(installation, compose, engine, { link });
  showSummary(ui, summary);
  if (link && flags.open && !ui.json) {
    if (await openLink(link.url)) ui.info("Opened the link in your browser.");
  }
  ui.outro(summary.running ? "Your Space is running." : "Your Space isn't running.");
}

async function createOwner(ui: Ui, compose: Parameters<typeof serverCommand>[0], flags: StartFlags): Promise<Link> {
  ui.info("Your Space has no owner yet. The owner is you: the one account that runs this space.");
  const name =
    flags.ownerName ??
    (await ui.text({ message: "Your name:", flag: "--owner-name <name>", placeholder: "Sam Rivera", validate: (v) => (v.trim() ? undefined : "Write your name.") }));
  const username =
    flags.ownerUsername ??
    (await ui.text({
      message: "Your username, to sign in with:",
      flag: "--owner-username <username>",
      placeholder: "sam",
      validate: (v) => (/^[A-Za-z0-9_.]{3,30}$/.test(v.trim()) ? undefined : "3 to 30 letters, digits, _ or ."),
    }));
  const args = ["--name", name, "--username", username, ...(flags.ownerEmail ? ["--email", flags.ownerEmail] : [])];
  const created = await serverCommand(compose, "create-owner", args);
  if (created.json.error === "owner_exists") throw new CliError("owner_exists", "This installation already has an owner.");
  const json = expectOk(created);
  return { url: String(json.url), expiresAt: String(json.expiresAt) };
}
