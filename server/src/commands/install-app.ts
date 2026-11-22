// install-app <github-link> [--kit <link | file | folder | ->] | --compose <file | -> [--kit <file | ->]
// [--name <name>], then [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>]
// [--no-frame]] [--json] (FR-009, contracts/http-api.md). Reviews the app, installs it as the
// operator, and waits until it runs or the install fails.
import { parseArgs } from "node:util";
import { operatorActorId } from "../actors.ts";
import { errorFields, log } from "../log.ts";
import { MAX_FILE_BYTES, SourceError } from "../apps/github.ts";
import { KitFileError, readLocalKit } from "../apps/kits.ts";
import { ComposeFileError, isLocalSource, readLocalCompose, sourcesProblem } from "../apps/local.ts";
import { socketRuntime } from "../apps/runtime-client.ts";
import { AppError, AppsService } from "../apps/service.ts";
import { EXIT, localFileLine, openForCommand, output, publishedLine } from "./output.ts";

const USAGE =
  "Usage: install-app --files-stdin | <github-link-to-compose-file> [--kit <link | file | folder | ->] | --compose <file | -> [--kit <file | ->] [--name <name>], then [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>] [--no-frame]] [--json]";

async function readPairedFiles(input: NodeJS.ReadableStream): Promise<{compose:string; kit:string}> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const part = Buffer.from(chunk);
    bytes += part.length;
    if (bytes > 4 * MAX_FILE_BYTES) throw new ComposeFileError("The input package is too large.");
    chunks.push(part);
  }
  try {
    const pair = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
    if (typeof pair?.compose !== "string" || typeof pair.kit !== "string" ||
        Buffer.byteLength(pair.compose) > MAX_FILE_BYTES || Buffer.byteLength(pair.kit) > MAX_FILE_BYTES) throw new Error();
    return pair;
  } catch { throw new ComposeFileError("Supply a UTF-8 JSON object with bounded compose and kit text."); }
}

async function main(argv: string[]): Promise<number> {
  let values: {
    kit?: string;
    compose?: string;
    "files-stdin"?: boolean;
    name?: string;
    json?: boolean;
    help?: boolean;
    "reuse-data"?: boolean;
    publish?: boolean;
    port?: string;
    bind?: string;
    link?: string;
    "no-frame"?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        kit: { type: "string" },
        compose: { type: "string" },
        "files-stdin": { type: "boolean" },
        name: { type: "string" },
        "reuse-data": { type: "boolean", default: false },
        publish: { type: "boolean", default: false },
        port: { type: "string" },
        bind: { type: "string" },
        link: { type: "string" },
        "no-frame": { type: "boolean", default: false },
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
  if (!values.publish && (values.port !== undefined || values.bind !== undefined || values.link !== undefined || values["no-frame"])) {
    out.failure({ ok: false, error: "usage", message: `--port, --bind, --link and --no-frame need --publish. ${USAGE}` }, `--port, --bind, --link and --no-frame need --publish.\n${USAGE}`);
    return EXIT.usage;
  }
  if (values.help || positionals.length > 1) {
    if (values.help) out.success({ ok: true, usage: USAGE }, [USAGE]);
    else out.failure({ ok: false, error: "usage", message: USAGE }, USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }
  const link = positionals[0];
  const bundled = values["files-stdin"] === true;
  const problem = bundled
    ? (link || values.compose !== undefined || values.kit !== undefined ? "Use --files-stdin on its own to supply a Compose file and kit." : null)
    : sourcesProblem({ link, compose: values.compose, kit: values.kit, name: values.name });
  if (problem) {
    out.failure({ ok: false, error: "usage", message: `${problem} ${USAGE}` }, `${problem}\n${USAGE}`);
    return EXIT.usage;
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  const apps = new AppsService(database.db, socketRuntime(), { publicUrl: config.publicUrl, dataKey: config.dataKey, kitsRepository: config.kitsRepository });
  try {
    // A kit link is read from GitHub; anything else is a kit on this machine.
    const kitLink = values.kit !== undefined && /^https?:\/\//i.test(values.kit) ? values.kit : undefined;
    // The command runs in the server's container, so standard input (`--kit -` or `--compose -`) is
    // how a file on the host reaches it.
    const files = bundled ? await readPairedFiles(process.stdin) : undefined;
    const kitText = files ? files.kit : values.kit !== undefined && !kitLink ? readLocalKit(values.kit, link ?? null) : undefined;
    const from = files ? {name:"compose.yaml", text:files.compose} : values.compose !== undefined ? readLocalCompose(values.compose) : link!;
    const review = await apps.preview(from, kitLink, kitText, values.name);
    if (!review.ok) {
      const reasons = review.refusals.map((r) => `  - ${r.service ? `${r.service}: ` : ""}${r.reason}`);
      out.failure({ ok: false, error: "refused", name: review.name, refusals: review.refusals }, [`Your Space can't run ${review.title} as it is:`, ...reasons].join("\n"));
      return EXIT.notApplicable;
    }
    if (!out.json) {
      process.stderr.write(
        [
          `${review.title} from ${isLocalSource(review.source) ? localFileLine(review.source) : `${review.source.repo} at ${review.source.commit.slice(0, 12)}`}${review.kit ? (kitText !== undefined ? ", with the kit file you gave" : ", with its installation kit") : ""}`,
          ...review.services.map((s) => `  ${s.name}: ${s.image}${s.interface ? " (interface)" : ""}`),
          ...review.adaptations.map((a) => `  ${a.service}: ${a.detail}`),
          review.warning,
          "",
        ].join("\n"),
      );
    }
    const actorId = await operatorActorId(database.db);
    const publish = values.publish
      ? {
          ...(values.port !== undefined ? { port: Number(values.port) } : {}),
          ...(values.bind !== undefined ? { bind: values.bind } : {}),
          ...(values.link !== undefined ? { link: values.link } : {}),
          ...(values["no-frame"] ? { frame: false } : {}),
        }
      : null;
    const { name, jobId, done } = await apps.install(review.previewId, {}, values["reuse-data"] === true, actorId, publish);
    await done;
    const job = await apps.job(jobId);
    const detail = await apps.detail(name);
    if (job.state !== "succeeded") {
      out.failure({ ok: false, error: "install_failed", name, message: job.error }, `Installing ${name} failed: ${job.error}`);
      return EXIT.notApplicable;
    }
    out.success(
      {
        ok: true,
        name,
        state: detail.state,
        origin: detail.origin,
        publish: detail.publish,
        // A Compose file on this machine has no commit; its digest identifies it.
        ...(isLocalSource(review.source) ? { source: review.source.link } : { commit: review.source.commit }),
      },
      [
        `Installed ${review.title} (${detail.state}). Open it from Your Space, or at ${detail.origin}`,
        ...(detail.publish ? [publishedLine(review.title, detail.publish)] : []),
      ],
    );
    return EXIT.ok;
  } catch (error) {
    if (error instanceof KitFileError || error instanceof SourceError) {
      out.failure({ ok: false, error: "kit_file", message: error.message }, error.message);
      return EXIT.notApplicable;
    }
    if (error instanceof ComposeFileError) {
      out.failure({ ok: false, error: "compose_file", message: error.message }, error.message);
      return EXIT.notApplicable;
    }
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
