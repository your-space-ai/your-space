// create-owner --email <email> --name <name> [--json] (T028).
import { parseArgs } from "node:util";
import { errorFields, log } from "../log.ts";
import { createOwner } from "../owner/create-owner.ts";
import { EXIT, formatTime, openForCommand, output, STORAGE_MESSAGE } from "./output.ts";

const USAGE = 'Usage: create-owner --email <email> --name "<name>" [--json]';

async function main(argv: string[]): Promise<number> {
  let values: { email?: string; name?: string; json?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        email: { type: "string" },
        name: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const out = output(argv.includes("--json"));
    const message = error instanceof Error ? error.message : "Invalid arguments.";
    out.failure({ ok: false, error: "usage", message: `${message} ${USAGE}` }, `${message}\n${USAGE}`);
    return EXIT.usage;
  }

  const out = output(values.json === true);
  if (values.help) {
    out.success({ ok: true, usage: USAGE }, [USAGE]);
    return EXIT.ok;
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;

  try {
    const result = await createOwner({ config, db: database.db }, { email: values.email, name: values.name });
    if (result.ok) {
      const expires = formatTime(result.expiresAt);
      out.success({ ok: true, email: result.email, url: result.url, token: result.token, expiresAt: expires }, [
        `Owner created: ${result.name} <${result.email}>`,
        `Set your password here (expires ${expires}, works once):`,
        result.url,
        "If it expires, run: docker compose exec server reset-link",
      ]);
      return EXIT.ok;
    }
    switch (result.error) {
      case "invalid_input": {
        const lines = Object.entries(result.fields).map(([field, problem]) => `  --${field}: ${problem}`);
        out.failure({ ok: false, error: "invalid_input", fields: result.fields }, `Invalid input:\n${lines.join("\n")}\n${USAGE}`);
        return EXIT.usage;
      }
      case "owner_exists": {
        const message = "This installation already has an owner.";
        out.failure(
          { ok: false, error: "owner_exists", message },
          `${message} To reset the owner's password, run: docker compose exec server reset-link`,
        );
        return EXIT.notApplicable;
      }
      case "storage_unavailable": {
        const message = result.ownerCreated
          ? "The owner was created, but the database stopped answering before the set-password link was issued. " +
            "When it is back, run: docker compose exec server reset-link"
          : STORAGE_MESSAGE;
        out.failure(
          { ok: false, error: "storage_unavailable", message },
          result.ownerCreated ? message : `${message} Nothing was changed. Check the database with: docker compose ps`,
        );
        return EXIT.storage;
      }
    }
  } catch (error) {
    log("error", "create_owner.failed", errorFields(error));
    const message = "Something unexpected went wrong. Nothing was reported as done.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
