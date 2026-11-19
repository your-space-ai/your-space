// publish-app <name> [--port <n>] [--bind <address>] [--link <url>] [--off] [--json] (decision
// 2026-11-19, contracts/http-api.md). Publishes an installed app on a port of this machine, changes
// how, or stops, and waits until the app has restarted with it.
import { parseArgs } from "node:util";
import { operatorActorId } from "../actors.ts";
import { errorFields, log } from "../log.ts";
import { socketRuntime } from "../apps/runtime-client.ts";
import { AppError, AppsService } from "../apps/service.ts";
import { EXIT, openForCommand, output, publishedLine } from "./output.ts";

const USAGE = "Usage: publish-app <name> [--port <n>] [--bind <address>] [--link <url>] [--off] [--json]";

async function main(argv: string[]): Promise<number> {
  let values: { port?: string; bind?: string; link?: string; off?: boolean; json?: boolean; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        port: { type: "string" },
        bind: { type: "string" },
        link: { type: "string" },
        off: { type: "boolean", default: false },
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
  const choices = values.port !== undefined || values.bind !== undefined || values.link !== undefined;
  if (values.help || positionals.length !== 1 || (values.off && choices)) {
    if (values.help) out.success({ ok: true, usage: USAGE }, [USAGE]);
    else out.failure({ ok: false, error: "usage", message: USAGE }, USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  const apps = new AppsService(database.db, socketRuntime(), { publicUrl: config.publicUrl, dataKey: config.dataKey });
  const name = positionals[0]!;
  try {
    const publish = values.off
      ? null
      : { ...(values.port !== undefined ? { port: Number(values.port) } : {}), ...(values.bind !== undefined ? { bind: values.bind } : {}), ...(values.link !== undefined ? { link: values.link } : {}) };
    const actorId = await operatorActorId(database.db);
    const { jobId } = await apps.updatePublish(name, publish, actorId);
    // The job runs in this process, so the command waits for it like install-app does.
    let job = await apps.job(jobId);
    while (job.state === "running") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      job = await apps.job(jobId);
    }
    const detail = await apps.detail(name);
    if (job.state !== "succeeded") {
      out.failure({ ok: false, error: "apply_failed", name, publish: detail.publish, message: job.error }, `Restarting ${name} failed: ${job.error}`);
      return EXIT.notApplicable;
    }
    out.success(
      { ok: true, name, state: detail.state, publish: detail.publish },
      [detail.publish ? publishedLine(detail.title, detail.publish) : `${detail.title} isn't published on a port any more. It is still at ${detail.origin}.`],
    );
    return EXIT.ok;
  } catch (error) {
    if (error instanceof AppError) {
      out.failure({ ok: false, error: error.code, message: error.message }, error.message);
      return error.status >= 500 ? EXIT.storage : EXIT.notApplicable;
    }
    log("error", "publish_app.failed", errorFields(error));
    const message = "Something unexpected went wrong.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
