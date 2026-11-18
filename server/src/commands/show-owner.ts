// show-owner [--json] (journey 003, research R8): whether the installation has an owner, and who.
// Read-only, so the CLI's `start` can decide whether to create the owner without side effects.
import { and, eq } from "drizzle-orm";
import { parseArgs } from "node:util";
import { member, user } from "../db/auth-schema.ts";
import { errorFields, log } from "../log.ts";
import { readInstallation, StorageUnavailable } from "../owner/installation.ts";
import { EXIT, openForCommand, output, STORAGE_MESSAGE } from "./output.ts";

const USAGE = "Usage: show-owner [--json]";

async function main(argv: string[]): Promise<number> {
  let json = false;
  try {
    json = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } }, strict: true }).values.json === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";
    output(argv.includes("--json")).failure({ ok: false, error: "usage", message: `${message} ${USAGE}` }, `${message}\n${USAGE}`);
    return EXIT.usage;
  }
  const out = output(json);
  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { database } = opened;
  try {
    const installation = await readInstallation(database.db);
    if (installation.state === "unclaimed") {
      out.success({ ok: true, owner: null }, ["This installation has no owner yet."]);
      return EXIT.ok;
    }
    // A claimed installation has an owner, so a missing workspace is damaged storage, never "no owner".
    if (!installation.workspaceId) throw new StorageUnavailable("The claimed installation has no workspace.");
    const rows = await database.db
      .select({ username: user.username, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, installation.workspaceId), eq(member.role, "owner")))
      .limit(1);
    const owner = rows[0];
    if (!owner) throw new StorageUnavailable("The owner's account is missing.");
    out.success({ ok: true, owner: { username: owner.username, name: owner.name } }, [`Owner: ${owner.name} (username ${owner.username})`]);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      out.failure({ ok: false, error: "storage_unavailable", message: STORAGE_MESSAGE }, STORAGE_MESSAGE);
      return EXIT.storage;
    }
    log("error", "show_owner.failed", errorFields(error));
    const message = "Something unexpected went wrong.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
