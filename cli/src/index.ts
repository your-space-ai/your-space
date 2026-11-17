#!/usr/bin/env node
// your-space: install and run Your Space (journey 003). Every command acts on the installation in the
// current folder, or the one --workdir names (contracts/cli-commands.md).
import { Command, CommanderError } from "commander";
import { init } from "./commands/init.ts";
import { start } from "./commands/start.ts";
import { CliError, EXIT } from "./errors.ts";
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
    .option("--this-machine", "use it on this machine only, at http://space.localhost")
    .option("--port <n>", "another local port, when 80 is taken");

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

setupOptions(program.command("init").description("make this folder a Your Space installation: download the release and write .env")).action(
  action(async (ui, g) => {
    const o = program.commands.find((c) => c.name() === "init")!.opts();
    await init(ui, g.workdir, { thisMachine: o.thisMachine, port: o.port });
  }),
);

program
  .command("start")
  .description("start Your Space, create the owner the first time, and show how to reach it")
  .option("--owner-name <name>", "the owner's name, when there is no owner yet")
  .option("--owner-username <username>", "the owner's username")
  .option("--owner-email <email>", "the owner's email address (optional)")
  .option("--no-open", "don't open the set-password link in the browser")
  .action(
    action(async (ui, g) => {
      const o = program.commands.find((c) => c.name() === "start")!.opts();
      await start(ui, g.workdir, {
        ownerName: o.ownerName,
        ownerUsername: o.ownerUsername,
        ownerEmail: o.ownerEmail,
        open: o.open,
      });
    }),
  );

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
