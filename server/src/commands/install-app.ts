// install-app <kit-link> | --kit <file | ->, then [--reuse-data] [--publish [--port <n>]
// [--bind <address>] [--link <url>]] [--json] (FR-009, contracts/http-api.md). Every app
// installs from its kit, which names its Compose file on GitHub (decision 2026-11-23; a Compose file
// on this machine, --compose, left with the alpha scope). A kit, or the Compose file it names, in a
// private repository is read through the GitHub connection, as in the web client (journey 015), and
// a kit file given with --kit needs the connection only for a private Compose file. Reviews the app,
// installs it as the operator, and waits until it runs or the install fails.
import { parseArgs } from "node:util";
import { operatorActorId } from "../actors.ts";
import { errorFields, log } from "../log.ts";
import { SourceError, type FileRead } from "../apps/github.ts";
import { KitFileError, readLocalKit } from "../apps/kits.ts";
import { isLocalSource, sourcesProblem } from "../apps/local.ts";
import { socketRuntime } from "../apps/runtime-client.ts";
import { AppError, AppsService } from "../apps/service.ts";
import { GithubConnection } from "../github-connection.ts";
import { EXIT, localFileLine, openForCommand, output, publishedLine } from "./output.ts";

const USAGE =
  "Usage: install-app <github-link-to-kit> | --kit <file | ->, then [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>]] [--json]";
const CONNECT = "docker compose exec server github connect";
/** What to run for a review the GitHub connection answers (journey 015). */
const CONNECTION_HINT: Record<string, string> = {
  not_connected: `Connect GitHub with: ${CONNECT}.`,
  token_refused: `Reconnect with: ${CONNECT}`,
  token_unreadable: `Reconnect with: ${CONNECT}`,
  repository_not_visible: `To connect another token: ${CONNECT}`,
};
/** A private kit also installs from a kit file on this machine; a private Compose file needs the connection. */
const KIT_FILE_HINT = "Or give the kit file: install-app --kit - < kit.yaml";

/** The image reference the review's images are keyed by: with a tag, without a digest. */
function imageRef(image: string): string {
  const base = image.split("@")[0]!;
  return base.slice(base.lastIndexOf("/") + 1).includes(":") ? base : `${base}:latest`;
}

/** The review's note on a file read through the GitHub connection (decision 7). */
function privately(read: FileRead | null): string {
  return read?.read === "connection" ? ` (private, read with your GitHub connection @${read.login})` : "";
}

async function main(argv: string[]): Promise<number> {
  let values: {
    kit?: string;
    json?: boolean;
    help?: boolean;
    "reuse-data"?: boolean;
    publish?: boolean;
    port?: string;
    bind?: string;
    link?: string;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        kit: { type: "string" },
        "reuse-data": { type: "boolean", default: false },
        publish: { type: "boolean", default: false },
        port: { type: "string" },
        bind: { type: "string" },
        link: { type: "string" },
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
  if (!values.publish && (values.port !== undefined || values.bind !== undefined || values.link !== undefined)) {
    out.failure({ ok: false, error: "usage", message: `--port, --bind and --link need --publish. ${USAGE}` }, `--port, --bind and --link need --publish.\n${USAGE}`);
    return EXIT.usage;
  }
  if (values.help || positionals.length > 1) {
    if (values.help) out.success({ ok: true, usage: USAGE }, [USAGE]);
    else out.failure({ ok: false, error: "usage", message: USAGE }, USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }
  const link = positionals[0];
  const problem = sourcesProblem({ link, kit: values.kit });
  if (problem) {
    out.failure({ ok: false, error: "usage", message: `${problem} ${USAGE}` }, `${problem}\n${USAGE}`);
    return EXIT.usage;
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
  try {
    // The command runs in the server's container, so standard input (`--kit -`) is how a file on the
    // host reaches it. A kit's link is read from GitHub, and the kit names the app's Compose file
    // there; a kit file on this machine names it too.
    const kitText = values.kit !== undefined ? readLocalKit(values.kit) : undefined;
    const review = await apps.preview(kitText !== undefined ? { text: kitText } : { link: link! });
    // Each image pulled with the image token is marked private (decision 7).
    const privateImages = new Set(review.images.filter((i) => i.private).map((i) => i.ref));
    if (!review.ok) {
      const reasons = review.refusals.map((r) => `  - ${r.service ? `${r.service}: ` : ""}${r.reason}`);
      out.failure({ ok: false, error: "refused", name: review.name, refusals: review.refusals }, [`Your Space can't run ${review.title} as it is:`, ...reasons].join("\n"));
      return EXIT.notApplicable;
    }
    if (!out.json) {
      process.stderr.write(
        [
          `${review.title} from ${isLocalSource(review.source) ? localFileLine(review.source) : `${review.source.repo} at ${review.source.commit.slice(0, 12)}${privately(review.source.read)}`}${review.kit.repo ? `, with its kit ${review.kit.repo}/${review.kit.path} at ${review.kit.commit!.slice(0, 12)}${privately(review.kit.read)}` : ", with the kit file you gave"}`,
          ...(review.readsRepository ? [`This kit reads ${review.readsRepository} with your GitHub connection.`] : []),
          ...review.services.map((s) => `  ${s.name}: ${s.image}${s.interface ? " (interface)" : ""}${privateImages.has(imageRef(s.image)) ? " (private image, pulled with your image token)" : ""}`),
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
        kit: review.kit.source,
        provenance: detail.provenance,
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
    if (error instanceof AppError) {
      // A private kit, or Compose file, is read through the GitHub connection, which this command
      // connects too. A kit file on this machine needs no connection for itself.
      const file = (error.details as { file?: string } | undefined)?.file;
      const hint = [CONNECTION_HINT[error.code], error.code === "not_connected" && file === "kit" ? KIT_FILE_HINT : undefined].filter(Boolean).join(" ");
      const message = hint ? `${error.message} ${hint}` : error.message;
      out.failure({ ok: false, error: error.code, message }, message);
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
