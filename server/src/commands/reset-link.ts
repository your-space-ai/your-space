// reset-link [--json] (T048).
import { parseArgs } from "node:util";
import { errorFields, log } from "../log.ts";
import { issueResetLink } from "../recovery/reset-link.ts";
import { EXIT, formatTime, openForCommand, output, STORAGE_MESSAGE } from "./output.ts";

const USAGE = "Usage: reset-link [--json]";

async function main(argv: string[]): Promise<number> {
  let values: { json?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
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
    const result = await issueResetLink({ config, db: database.db });
    if (result.ok) {
      const expires = formatTime(result.expiresAt);
      out.success({ ok: true, email: result.email, url: result.url, token: result.token, expiresAt: expires }, [
        `Password reset link for ${result.email} (expires ${expires}, works once):`,
        result.url,
        "Using it signs out every existing session.",
      ]);
      return EXIT.ok;
    }
    if (result.error === "no_owner") {
      const message = "This installation has no owner yet. Run create-owner.";
      out.failure(
        { ok: false, error: "no_owner", message },
        'This installation has no owner yet. Create one with: docker compose exec server create-owner --email <email> --name "<name>"',
      );
      return EXIT.notApplicable;
    }
    out.failure(
      { ok: false, error: "storage_unavailable", message: STORAGE_MESSAGE },
      // The database can fail after the new link is stored, which cancels an earlier unused link.
      `${STORAGE_MESSAGE} No link was printed, and an earlier unused link may have stopped working. ` +
        "Check the database with: docker compose ps, then run reset-link again.",
    );
    return EXIT.storage;
  } catch (error) {
    log("error", "reset_link.failed", errorFields(error));
    const message = "Something unexpected went wrong. Nothing was reported as done.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
