// update-app <name> [--check] [--review <digest>] [--json] (journey 019, decision 6). Checks an
// installed app's kit, at its own location, for an update, and with --check prints the review: what
// changes, and the digest that binds an apply to it. Without --check it reviews the update and applies
// it in place as the operator, and waits until the app runs it or the update is rolled back. With
// --review, the update is applied only if its review has that digest, so a later apply applies what an
// earlier --check showed. The `your-space app check-update` and `update` commands run it; an agent
// with a shell on this machine drives them with --json. An update that asks for a setting's value is
// applied from the app's page, where it is given.
import { parseArgs } from "node:util";
import { operatorActorId } from "../actors.ts";
import { errorFields, log } from "../log.ts";
import { socketRuntime } from "../apps/runtime-client.ts";
import { AppError, AppsService, type UpdateChanges } from "../apps/service.ts";
import { GithubConnection } from "../github-connection.ts";
import { EXIT, openForCommand, output } from "./output.ts";

const USAGE = "Usage: update-app <name> [--check] [--review <digest>] [--json]";

/** What an update changes, as lines for a person; the CLI words the same changes from --json. */
function changeLines(changes: UpdateChanges): string[] {
  const lines: string[] = [];
  if (changes.compose) {
    const { from, to } = changes.compose;
    const where = from.repo === to.repo && from.path === to.path ? `${to.repo}/${to.path}` : `${from.repo}/${from.path} → ${to.repo}/${to.path}`;
    lines.push(`Compose file ${where}: ${from.commit.slice(0, 12)} → ${to.commit.slice(0, 12)}`);
  }
  for (const image of changes.images) lines.push(image.from === null ? `New image ${image.ref}` : image.to === null ? `Image ${image.ref} is no longer used` : `Image ${image.ref} moves to a new version`);
  for (const name of changes.settings.added) lines.push(`New setting ${name}`);
  for (const name of changes.settings.removed) lines.push(`Setting ${name} is removed`);
  for (const host of changes.outbound.added) lines.push(`May reach ${host}`);
  for (const host of changes.outbound.removed) lines.push(`No longer reaches ${host}`);
  for (const service of changes.services.added) lines.push(`New service ${service}`);
  for (const service of changes.services.removed) lines.push(`Service ${service} is removed`);
  if (changes.interface) lines.push(`Its interface moves to ${changes.interface.to ? `${changes.interface.to.service}:${changes.interface.to.port}` : "none"}`);
  return lines;
}

async function main(argv: string[]): Promise<number> {
  let values: { check?: boolean; review?: string; json?: boolean; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        check: { type: "boolean", default: false },
        review: { type: "string" },
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
  if (values.help || positionals.length !== 1 || (values.check && values.review !== undefined)) {
    if (values.help) out.success({ ok: true, usage: USAGE }, [USAGE]);
    else out.failure({ ok: false, error: "usage", message: USAGE }, USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  const connection = new GithubConnection(database.db, config.dataKey);
  const apps = new AppsService(database.db, socketRuntime(), {
    publicUrl: config.publicUrl,
    dataKey: config.dataKey,
    credentials: connection,
    registries: connection,
  });
  const name = positionals[0]!;
  try {
    const review = await apps.previewUpdate(name);
    const lines = changeLines(review.changes);
    if (values.check) {
      const { ok: runnable, ...rest } = review;
      out.success(
        { ok: true, ...rest, runnable },
        review.upToDate
          ? [`${name} is up to date with its kit.`]
          : [`An update for ${name} is available:`, ...lines.map((line) => `  ${line}`), `Apply it with: update-app ${name} --review ${review.digest}`],
      );
      return EXIT.ok;
    }
    if (review.upToDate) {
      out.success({ ok: true, name, upToDate: true }, [`${name} is up to date with its kit.`]);
      return EXIT.ok;
    }
    if (!review.ok) {
      const reasons = review.refusals.map((r) => r.reason).join(" ");
      out.failure({ ok: false, error: "refused", message: `Your Space can't run this update as it is: ${reasons}`, refusals: review.refusals }, `Your Space can't run this update as it is: ${reasons}`);
      return EXIT.notApplicable;
    }
    const asked = review.settings.filter((s) => s.required && !s.set).map((s) => s.name);
    if (asked.length) {
      const message = `This update needs a value for ${asked.join(", ")}. Apply it from the app's page in Your Space, where you give it.`;
      out.failure({ ok: false, error: "settings_required", message, settings: asked }, message);
      return EXIT.notApplicable;
    }
    const actorId = await operatorActorId(database.db);
    const { jobId, done } = await apps.applyUpdate(name, review.previewId, {}, actorId, values.review ?? review.digest);
    // The job runs in this process, so the command waits for it like install-app does.
    await done;
    const job = await apps.job(jobId);
    const detail = await apps.detail(name);
    if (job.state !== "succeeded") {
      out.failure({ ok: false, error: "update_failed", name, state: detail.state, message: job.error }, job.error ?? `Updating ${name} failed.`);
      return EXIT.notApplicable;
    }
    out.success({ ok: true, name, state: detail.state, digest: review.digest, changes: review.changes }, [`${name} is updated and ${detail.state}.`, ...lines.map((line) => `  ${line}`)]);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof AppError) {
      out.failure({ ok: false, error: error.code, message: error.message }, error.message);
      return error.status >= 500 ? EXIT.storage : EXIT.notApplicable;
    }
    log("error", "update_app.failed", errorFields(error));
    const message = "Something unexpected went wrong.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
