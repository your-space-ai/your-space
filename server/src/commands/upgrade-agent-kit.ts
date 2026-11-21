import { createReadStream } from "node:fs";
import { parseArgs } from "node:util";
import { MAX_FILE_BYTES } from "../apps/github.ts";
import { KitError, KitFileError } from "../apps/kits.ts";
import { refreshAgentInterface } from "../apps/refresh-agent-interface.ts";
import { AppError } from "../apps/service.ts";
import { inspectAgentKit, upgradeAgentKit } from "../apps/upgrade-agent-kit.ts";
import { isStorageError } from "../db/client.ts";
import { EXIT, openForCommand, output, STORAGE_MESSAGE } from "./output.ts";

const usage =
  "Usage: upgrade-agent-kit <app-name> --inspect | (--kit <file|-> | --refresh) --expect-installation <token> --expect-kit <sha256:digest> [--json]";
const options = {
  inspect: { type: "boolean" },
  refresh: { type: "boolean" },
  kit: { type: "string" },
  "expect-installation": { type: "string" },
  "expect-kit": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

async function candidateText(path: string) {
  const input = path === "-" ? process.stdin : createReadStream(path);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of input) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) throw new KitError("the file is larger than a kit should be.");
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof KitError) throw error;
    throw new KitFileError("The kit file could not be read.");
  }
  // A pin identifies the exact bytes, including a possible UTF-8 BOM.
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new KitError("the file must contain UTF-8 text.");
  }
}

async function main(argv: string[]) {
  const out = output(argv.includes("--json"));
  function badUsage() {
    out.failure({ ok: false, error: "usage", message: usage }, usage);
    return EXIT.usage;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch {
    return badUsage();
  }
  const { values, positionals } = parsed;
  if (values.help) {
    out.success({ ok: true, usage }, [usage]);
    return EXIT.ok;
  }
  const [name] = positionals;
  const expectedInstallation = values["expect-installation"],
    expectedSource = values["expect-kit"];
  const modes = [values.inspect, values.refresh, values.kit].filter((value) => value !== undefined);
  if (positionals.length !== 1 || !/^[a-z][a-z0-9-]{0,29}$/.test(name) || modes.length !== 1 || values.kit === "")
    return badUsage();
  if (values.inspect) {
    if (expectedInstallation !== undefined || expectedSource !== undefined) return badUsage();
  } else if (
    !expectedInstallation ||
    !/^install:[a-f0-9]{64}$/.test(expectedInstallation) ||
    !expectedSource ||
    !/^sha256:[a-f0-9]{64}$/.test(expectedSource)
  ) {
    return badUsage();
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  try {
    if (values.inspect) {
      const info = await inspectAgentKit(database.db, name);
      out.success({ ok: true, ...info }, [
        `App: ${info.name} (${info.appId})`,
        `Installation: ${info.installation}`,
        `Kit: ${info.kitSource ?? "none"} (version ${info.kitVersion ?? "none"})`,
      ]);
      return EXIT.ok;
    }
    const info = values.refresh
      ? await inspectAgentKit(database.db, name)
      : await upgradeAgentKit(database.db, name, expectedInstallation!, expectedSource!, await candidateText(values.kit!));
    if (
      info.installation !== expectedInstallation ||
      info.kitVersion !== 2 ||
      !info.kitSource ||
      (values.refresh && info.kitSource !== expectedSource)
    ) {
      throw new AppError(409, "upgrade_conflict", "The installed app differs from the requested version 2 installation.");
    }
    let runtime;
    try {
      runtime = await refreshAgentInterface(
        database.db,
        { publicUrl: config.publicUrl, dataKey: config.dataKey },
        info.appId,
        info.kitSource,
        info.installation,
      );
    } catch (error) {
      if (error instanceof AppError && ["not_found", "kit_changed", "installation_changed"].includes(error.code)) throw error;
      const message = `The interface refresh failed. Check the app settings and runtime health, then retry --refresh --expect-installation ${info.installation} --expect-kit ${info.kitSource} for ${name}.`;
      out.failure({ ok: false, ...info, error: "interface_refresh_failed", message }, message);
      return EXIT.storage;
    }
    out.success({ ok: true, ...info, runtime }, [`${name} now uses ${info.kitSource}. Runtime: ${runtime}.`]);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof KitFileError || error instanceof KitError || error instanceof AppError) {
      const code = error instanceof KitFileError ? "kit_file" : error instanceof KitError ? "invalid_kit" : error.code;
      out.failure({ ok: false, error: code, message: error.message }, error.message);
      return EXIT.notApplicable;
    }
    const storage = isStorageError(error);
    const message = storage ? STORAGE_MESSAGE : "The kit could not be upgraded.";
    out.failure({ ok: false, error: storage ? "storage_unavailable" : "unexpected", message }, message);
    return storage ? EXIT.storage : EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}
process.exitCode = await main(process.argv.slice(2));
