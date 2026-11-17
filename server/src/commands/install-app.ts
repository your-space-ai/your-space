// install-app <github-link> [--kit <link>] [--reuse-data] [--json] (FR-009, contracts/http-api.md).
// Reviews the app, installs it as the operator, and waits until it runs or the install fails.
import { parseArgs } from "node:util";
import { operatorActorId } from "../actors.ts";
import { errorFields, log } from "../log.ts";
import { socketRuntime } from "../apps/runtime-client.ts";
import { AppError, AppsService } from "../apps/service.ts";
import { EXIT, openForCommand, output } from "./output.ts";

const USAGE = "Usage: install-app <github-link-to-compose-file> [--kit <link>] [--reuse-data] [--json]";

async function main(argv: string[]): Promise<number> {
  let values: { kit?: string; json?: boolean; help?: boolean; "reuse-data"?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        kit: { type: "string" },
        "reuse-data": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    const out = output(argv.includes("--json"));
    const message = error instanceof Error ? error.message : "Invalid arguments.";
    out.failure({ ok: false, error: "usage", message: `${message} ${USAGE}` }, `${message}\n${USAGE}`);
    return EXIT.usage;
  }
  const out = output(values.json === true);
  if (values.help || positionals.length !== 1) {
    if (values.help) out.success({ ok: true, usage: USAGE }, [USAGE]);
    else out.failure({ ok: false, error: "usage", message: USAGE }, USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  const apps = new AppsService(database.db, socketRuntime(), { publicUrl: config.publicUrl, dataKey: config.dataKey });
  try {
    const review = await apps.preview(positionals[0]!, values.kit);
    if (!review.ok) {
      const reasons = review.refusals.map((r) => `  - ${r.service ? `${r.service}: ` : ""}${r.reason}`);
      out.failure({ ok: false, error: "refused", name: review.name, refusals: review.refusals }, [`Your Space can't run ${review.title} as it is:`, ...reasons].join("\n"));
      return EXIT.notApplicable;
    }
    if (!out.json) {
      process.stderr.write(
        [
          `${review.title} from ${review.source.repo} at ${review.source.commit.slice(0, 12)}${review.kit ? ", with its installation kit" : ""}`,
          ...review.services.map((s) => `  ${s.name}: ${s.image}${s.interface ? " (interface)" : ""}`),
          ...review.adaptations.map((a) => `  ${a.service}: ${a.detail}`),
          review.warning,
          "",
        ].join("\n"),
      );
    }
    const actorId = await operatorActorId(database.db);
    const { name, jobId, done } = await apps.install(review.previewId, {}, values["reuse-data"] === true, actorId);
    await done;
    const job = await apps.job(jobId);
    const detail = await apps.detail(name);
    if (job.state !== "succeeded") {
      out.failure({ ok: false, error: "install_failed", name, message: job.error }, `Installing ${name} failed: ${job.error}`);
      return EXIT.notApplicable;
    }
    out.success(
      { ok: true, name, state: detail.state, origin: detail.origin, commit: review.source.commit },
      [`Installed ${review.title} (${detail.state}). Open it from Your Space, or at ${detail.origin}`],
    );
    return EXIT.ok;
  } catch (error) {
    if (error instanceof AppError) {
      out.failure({ ok: false, error: error.code, message: error.message }, error.message);
      return error.status >= 500 ? EXIT.storage : EXIT.notApplicable;
    }
    log("error", "install_app.failed", errorFields(error));
    const message = "Something unexpected went wrong.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
