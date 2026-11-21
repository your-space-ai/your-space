#!/usr/bin/env node
// your-space: install and run Your Space (journey 003). Every command acts on the installation in the
// current folder, or the one --workdir names (contracts/cli-commands.md).
import { Command, CommanderError, Option } from "commander";
import { registerAgentCommands } from "./commands/agent.ts";
import { upgradeAgentKit, type UpgradeFlags } from "./commands/app-kit.ts";
import { configure } from "./commands/configure.ts";
import { init } from "./commands/init.ts";
import { logs } from "./commands/logs.ts";
import { ownerCreate, ownerResetLink } from "./commands/owner.ts";
import { secretsReplace, secretsShow } from "./commands/secrets.ts";
import { start } from "./commands/start.ts";
import { status } from "./commands/status.ts";
import { stop } from "./commands/stop.ts";
import { CliError, EXIT } from "./errors.ts";
import { checkEngine } from "./engine.ts";
import { isMissingProgram } from "./process.ts";
import { Ui } from "./ui.ts";
import { VERSION } from "./version.ts";

interface Globals {
  workdir: string;
  json: boolean;
  verbose: boolean;
  yes: boolean;
}

const wantsJson = process.argv.includes("--json");

function failed(ui: Ui, error: unknown): void {
  let failure: CliError;
  if (error instanceof CliError) failure = error;
  else if (isMissingProgram(error)) failure = new CliError("engine_missing", "Docker isn't installed. Your Space needs a Docker-compatible engine.", {}, String(error));
  else failure = new CliError("unexpected", "Something unexpected went wrong.", {}, error instanceof Error ? (error.stack ?? error.message) : String(error));
  ui.failure(failure);
  process.exitCode = failure.status;
}

/** Runs a command's work with its options, and turns any failure into its exit status. */
function action<A extends unknown[]>(work: (ui: Ui, globals: Globals, ...args: A) => Promise<void>) {
  return async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const globals = command.optsWithGlobals() as Globals & Record<string, unknown>;
    const ui = new Ui({ json: globals.json === true, verbose: globals.verbose === true, yes: globals.yes === true });
    try {
      await work(ui, globals, ...(args.slice(0, -1) as A));
    } catch (error) {
      failed(ui, error);
    }
  };
}

const setupOptions = (command: Command) =>
  command
    .addOption(new Option("--this-machine", "use it on this machine only, at http://space.localhost").conflicts(["domain", "proxyUrl"]))
    .addOption(new Option("--domain <name>", "your own domain, with HTTPS from Let's Encrypt").conflicts(["proxyUrl"]))
    .option("--proxy-url <url>", "the HTTPS address your own proxy or tunnel serves")
    .option("--port <n>", "another local port, when 80 (or 8080 behind a proxy) is taken");

const program = new Command()
  .name("your-space")
  .description("Install and run Your Space on this machine.")
  .version(VERSION, "--version", "print the CLI's version")
  .option("--workdir <folder>", "the installation's folder", ".")
  .option("--json", "print one JSON object; never ask")
  .option("--verbose", "show Docker Compose's own output")
  .option("--yes", "answer yes, and take the defaults, instead of asking")
  .showHelpAfterError()
  .exitOverride()
  .configureOutput({
    // With --json, stdout holds only the JSON object, and errors are part of it.
    writeErr: (text) => {
      if (!wantsJson) process.stderr.write(text);
    },
  });

setupOptions(program.command("init").description("make this folder a Your Space installation: download the release and write .env"))
  .option("--require-project-check", "fail if Docker cannot list existing installation folders")
  .option("--release-dir <folder>", "use packaged release files and SHA256SUMS from this folder")
  .action(
  action(async (ui, g) => {
    const o = program.commands.find((c) => c.name() === "init")!.opts();
    await init(ui, g.workdir, { thisMachine: o.thisMachine, domain: o.domain, proxyUrl: o.proxyUrl, port: o.port, releaseDir: o.releaseDir, requireProjectCheck: o.requireProjectCheck });
  }),
);

program.command("engine").description("check the local Docker engine")
  .command("check").description("check engine and Compose compatibility without starting an installation")
  .action(action(async (ui) => {
    const engine = await checkEngine();
    ui.result({ engine }, () => ui.note(`Docker ${engine.version}, Compose ${engine.compose}`, "Local engine"));
  }));

program
  .command("start")
  .description("start Your Space, create the owner the first time, and show how to reach it")
  .option("--owner-name <name>", "the owner's name, when there is no owner yet")
  .option("--owner-username <username>", "the owner's username")
  .option("--owner-email <email>", "the owner's email address (optional)")
  .addOption(new Option("--defer-owner", "start the server and create the first owner separately").conflicts(["ownerName", "ownerUsername", "ownerEmail"]))
  .option("--no-open", "don't open the set-password link in the browser")
  .option("--ignore-checks", "start even when the domain's names don't resolve")
  .option("--require-project-check", "fail if Docker cannot list existing installation folders")
  .option("--new-secrets", "start with new secrets when they were lost (signs everyone out)")
  .action(
    action(async (ui, g) => {
      const o = program.commands.find((c) => c.name() === "start")!.opts();
      await start(ui, g.workdir, {
        ownerName: o.ownerName,
        ownerUsername: o.ownerUsername,
        ownerEmail: o.ownerEmail,
        open: o.open,
        ignoreChecks: o.ignoreChecks,
        newSecrets: o.newSecrets,
        deferOwner: o.deferOwner,
        requireProjectCheck: o.requireProjectCheck,
      });
    }),
  );

program
  .command("stop")
  .description("stop the apps, then Your Space; nothing is deleted")
  .action(action(async (ui, g) => stop(ui, g.workdir)));

program
  .command("status")
  .description("show what is running and how to reach it")
  .option("--require-running", "require a running workspace managed from this exact installation folder")
  .action(action(async (ui, g, flags: { requireRunning?: boolean }) => status(ui, g.workdir, flags.requireRunning)));

program
  .command("logs")
  .description("show Your Space's logs")
  .argument("[service]", "one service: server, caddy, postgres, runtime or secrets")
  .option("-f, --follow", "keep showing new lines")
  .option("--tail <n>", "only the last n lines")
  .action(
    action(async (_ui, g, service: string | undefined) => {
      const o = program.commands.find((c) => c.name() === "logs")!.opts();
      await logs(g.workdir, service, { follow: o.follow, tail: o.tail });
    }),
  );

const owner = program.command("owner").description("the owner's account");
owner
  .command("create")
  .description("create the owner, when start didn't")
  .requiredOption("--name <name>", "the owner's name")
  .requiredOption("--username <username>", "the owner's username")
  .option("--email <email>", "an email address (optional)")
  .action(
    action(async (ui, g) => {
      const o = owner.commands.find((c) => c.name() === "create")!.opts();
      await ownerCreate(ui, g.workdir, { name: o.name, username: o.username, email: o.email });
    }),
  );
owner
  .command("reset-link")
  .description("print a new set-password link for the owner")
  .action(action(async (ui, g) => ownerResetLink(ui, g.workdir)));

const app = program.command("app").description("manage an installed app");
app
  .command("upgrade-agent-kit <name>")
  .description("inspect the installed kit or add agent access declarations from a version 2 kit")
  .option("--inspect", "show the installation token, app ID, kit version and kit source")
  .option("--kit <file>", "read the new kit from a local file or - for stdin")
  .option("--refresh", "retry the interface refresh for an already upgraded kit")
  .option("--expect-kit <source>", "current kit source from --inspect")
  .option("--expect-installation <token>", "installation token from --inspect")
  .action(action(async (ui, g, name: string, flags: UpgradeFlags) => upgradeAgentKit(ui, g.workdir, name, flags)));

const secrets = program.command("secrets").description("the auth secret and the database password");
secrets
  .command("show")
  .description("show where each secret comes from")
  .option("--reveal", "also show the values")
  .action(action(async (ui, g) => secretsShow(ui, g.workdir, secrets.commands.find((c) => c.name() === "show")!.opts().reveal === true)));
secrets
  .command("replace")
  .description("replace a generated secret, with every step it needs")
  .argument("<name>", "auth-secret, database-password or data-key")
  .action(action(async (ui, g, name: string) => secretsReplace(ui, g.workdir, name)));

setupOptions(program.command("configure").description("change how Your Space is reached, and restart it"))
  .option("--ignore-checks", "go on even when the domain's names don't resolve")
  .action(
    action(async (ui, g) => {
      const o = program.commands.find((c) => c.name() === "configure")!.opts();
      await configure(ui, g.workdir, { thisMachine: o.thisMachine, domain: o.domain, proxyUrl: o.proxyUrl, port: o.port, ignoreChecks: o.ignoreChecks });
    }),
  );

registerAgentCommands(program, () => new Ui({ json: wantsJson, verbose: false, yes: false }));

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) process.exitCode = EXIT.ok;
    else {
      if (wantsJson) process.stdout.write(`${JSON.stringify({ ok: false, error: "usage", message: error.message.replace(/^error: /, "") })}\n`);
      process.exitCode = EXIT.usage;
    }
  } else {
    failed(new Ui({ json: wantsJson, verbose: process.argv.includes("--verbose"), yes: false }), error);
  }
});
