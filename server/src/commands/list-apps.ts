// list-apps [--json]: each app's name, source, commit and state (US1 scenario 2), as the server last
// recorded it; the server checks it against the runtime every 15 seconds.
import { parseArgs } from "node:util";
import { errorFields, log } from "../log.ts";
import { socketRuntime } from "../apps/runtime-client.ts";
import { AppsService } from "../apps/service.ts";
import { EXIT, openForCommand, output } from "./output.ts";

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } }, strict: true });
  const out = output(values.json === true);
  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  const apps = new AppsService(database.db, socketRuntime(), { publicUrl: config.publicUrl, dataKey: config.dataKey });
  try {
    const { apps: list, retained } = await apps.list();
    const details = await Promise.all(list.map((a) => apps.detail(a.name)));
    const rows = details.map((d) => ({ name: d.name, state: d.state, reason: d.stateReason, repo: d.source.repo, path: d.source.path, commit: d.source.commit, origin: d.origin }));
    out.success({ ok: true, apps: rows, retained }, [
      ...(rows.length ? rows.map((r) => `${r.name}  ${r.state}${r.reason ? ` (${r.reason})` : ""}  ${r.repo}/${r.path}@${r.commit.slice(0, 12)}  ${r.origin}`) : ["No app is installed."]),
      ...retained.map((r) => `${r.name}  removed, data kept`),
    ]);
    return EXIT.ok;
  } catch (error) {
    log("error", "list_apps.failed", errorFields(error));
    out.failure({ ok: false, error: "unexpected", message: "Something unexpected went wrong." }, "Something unexpected went wrong.");
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
