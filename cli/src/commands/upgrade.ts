// `your-space upgrade`: moves an installation to the CLI's own version, the release `init` would
// download, keeping `.env`, the volumes and the apps. It backs up the database first and, when the
// new version doesn't start, puts the previous one back (contracts/cli-commands.md).
import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Compose } from "../compose.ts";
import { parseEnv } from "../env-file.ts";
import { CliError, Restated } from "../errors.ts";
import { Installation, RELEASE_FILES } from "../installation.ts";
import type { Ran } from "../process.ts";
import { fetchRelease } from "../release.ts";
import type { Ui } from "../ui.ts";
import { clearRestoreNeeded, lockInstallation, markRestoreNeeded, refuseWhileRestoreNeeded } from "../installation-lock.ts";
import { compareVersions, isVersion, VERSION } from "../version.ts";
import { open, upStack } from "./shared.ts";

export interface ReleaseUpgradeFlags {
  releaseDir?: string;
}

/** The release an installation runs, which `upgrade` moves on from. */
export function installedVersion(installation: Installation): string {
  const version = installation.version();
  if (!version || !isVersion(version)) {
    throw new CliError(
      "version_unknown",
      `This installation's stack.yaml doesn't name a release${version ? ` (it runs ${version})` : ""}, so upgrade can't tell which version it has. Update it by hand with the new release's files, then run your-space start.`,
    );
  }
  return version;
}

/** pg_dump ends every dump it finished with this line; one cut short doesn't have it. */
export function dumpComplete(path: string): boolean {
  const size = statSync(path).size;
  const length = Math.min(size, 4096);
  const tail = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, tail, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return tail.toString("utf8").includes("-- PostgreSQL database dump complete");
}

/** A dump's SHA-256, read line by line, leaving out the random key in its \restrict and \unrestrict lines. */
async function dumpDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) if (!/^\\(un)?restrict \S+$/.test(line)) hash.update(`${line}\n`);
  return hash.digest("hex");
}

/** True when two dumps hold the same database, compared without reading either into memory whole. */
export async function sameDump(a: string, b: string): Promise<boolean> {
  return (await dumpDigest(a)) === (await dumpDigest(b));
}

/**
 * Dumps the database into `path`, written under another name and given its own only once complete,
 * so a dump's name always means a whole dump. Created owner-only: it holds password hashes,
 * sessions and apps' encrypted settings. Returns what pg_dump said, and whether the dump is there.
 */
async function dump(compose: Compose, path: string): Promise<{ saved: boolean; ran?: Ran }> {
  const partial = `${path}.partial`;
  const fd = openSync(partial, "wx", 0o600);
  let ran: Ran | undefined;
  let saved = false;
  try {
    ran = await compose.run(["exec", "-T", "postgres", "pg_dump", "-U", "yourspace", "-d", "yourspace"], { outputFile: fd });
  } catch {
    // The engine stopped answering: no dump.
  } finally {
    closeSync(fd);
    if (ran?.code === 0 && dumpComplete(partial)) {
      renameSync(partial, path);
      saved = true;
    } else rmSync(partial, { force: true });
  }
  return { saved, ran };
}

/** 20261123T154500Z: when a backup was taken, in a name that sorts by time. */
export function backupStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

interface Backup {
  path: string;
}

/**
 * Stops the server and Caddy, so nothing changes the database after the backup, then dumps it into
 * backups/ in the installation folder, readable only by its owner. PostgreSQL is started on its own
 * first when Your Space was stopped, as `start --new-secrets` does.
 */
async function backUp(compose: Compose, installation: Installation, from: string): Promise<Backup> {
  const failed = (message: string, ran?: Ran) => new CliError("backup_failed", message, {}, ran ? `${ran.stdout}${ran.stderr}` : undefined);
  if (!(await compose.running("postgres"))) {
    const db = await compose.run(["up", "-d", "--wait", "postgres"]);
    if (db.code !== 0) throw failed("The database didn't start, so it couldn't be backed up. See why with: your-space logs postgres", db);
  }
  const stopped = await compose.run(["stop", "caddy", "server"]);
  if (stopped.code !== 0) throw failed("Couldn't stop Your Space to back up its database.", stopped);

  const folder = join(installation.folder, "backups");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, `${backupStamp(new Date())}-${from}.sql`);
  const { saved, ran } = await dump(compose, path);
  if (!saved) throw failed("Couldn't back up Your Space's database. See why with: your-space logs postgres", ran);
  return { path };
}

/**
 * Restores the backup into a new database, then swaps it in for the current one in one transaction,
 * so a restore that fails part way leaves the database as it was. The database the new version left
 * is kept, renamed to `kept`, so nothing it took in is lost. The new version's server is stopped, so
 * nothing else uses the database.
 */
async function restore(compose: Compose, backup: string, kept: string): Promise<void> {
  const psql = (database: string) => ["exec", "-T", "postgres", "psql", "-U", "yourspace", "-d", database, "-v", "ON_ERROR_STOP=1", "-q"];
  const step = async (ran: Promise<Ran>, what: string) => {
    const done = await ran;
    if (done.code !== 0) throw new Error(`${what}: ${done.stderr.trim().split("\n").at(-1) ?? ""}`);
  };
  await step(
    compose.run(psql("postgres"), {
      input: "DROP DATABASE IF EXISTS yourspace_restore;\nCREATE DATABASE yourspace_restore OWNER yourspace TEMPLATE template0;\n",
    }),
    "couldn't make a database to restore into",
  );
  const fd = openSync(backup, "r");
  try {
    await step(compose.run([...psql("yourspace_restore"), "--single-transaction"], { inputFile: fd }), "couldn't restore the backup");
  } finally {
    closeSync(fd);
  }
  await step(
    compose.run(psql("postgres"), {
      input: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'yourspace' AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE yourspace RENAME TO ${kept};
ALTER DATABASE yourspace_restore RENAME TO yourspace;
COMMIT;
`,
    }),
    "couldn't swap the restored database in",
  );
}

/** Moves files between folders by renaming them, and can undo every move, the latest first. */
export class Moves {
  private done: { from: string; to: string }[] = [];

  /** Moves the files named `names` from one folder to another, skipping any that aren't there. */
  move(names: string[], fromFolder: string, toFolder: string): void {
    for (const name of names) {
      const from = join(fromFolder, name);
      const to = join(toFolder, name);
      if (!existsSync(from)) continue;
      renameSync(from, to);
      this.done.push({ from, to });
    }
  }

  get started(): boolean {
    return this.done.length > 0;
  }

  undo(): void {
    for (const { from, to } of this.done.reverse()) renameSync(to, from);
    this.done = [];
  }
}

/** What a failed upgrade did to put the previous version back. */
export interface RollBack {
  /** Why the new version couldn't be stopped, when it couldn't: then nothing was put back. */
  stopProblem?: string;
  /** The previous release files are back in the installation folder. */
  filesBack: boolean;
  /** The database was restored from the backup, because the new version had changed it. */
  restored: boolean;
  /** When it was, the database the new version left, kept under this name. */
  keptDatabase?: string;
  /** Why the database may still need restoring by hand, when it does. */
  restoreProblem?: string;
  /** The previous version started again. */
  running: boolean;
}

/** The message for a failed upgrade: what failed, then where the rollback left the installation. */
export function failedUpgrade(failure: CliError, rolledBack: RollBack, versions: { from: string; to: string; backup: string; previous: string }): string {
  const { from, to, backup, previous } = versions;
  const lines = [failure.message];
  if (rolledBack.stopProblem) {
    lines.push(
      `The upgrade to ${to} didn't finish, and ${to} couldn't be stopped (${rolledBack.stopProblem}), so nothing was put back. Stop it with: docker compose stop caddy server. Then move Your Space ${from}'s files back from ${previous}, restore ${backup} as "Restore the Backup by Hand" in the guide says (docs/operate/index.md), since ${to} may have updated the database, delete .upgrade-restore, and run your-space start.`,
    );
    return lines.join("\n");
  }
  if (!rolledBack.filesBack) {
    lines.push(
      `The upgrade to ${to} didn't finish, and Your Space ${from}'s files couldn't be put back: they are in ${previous}. Move them back into this folder, restore ${backup} as "Restore the Backup by Hand" in the guide says (docs/operate/index.md), since ${to} may have updated the database, delete .upgrade-restore, then run your-space start.`,
    );
    return lines.join("\n");
  }
  if (rolledBack.restoreProblem) {
    lines.push(
      `The upgrade to ${to} didn't finish, so Your Space ${from}'s files are back, but ${rolledBack.restoreProblem}. Restore ${backup} as "Restore the Backup by Hand" in the guide says (docs/operate/index.md), delete .upgrade-restore, then run your-space start.`,
    );
    return lines.join("\n");
  }
  const data = rolledBack.restored
    ? `its database restored from the backup taken just before (${backup}), since ${to} had already changed it`
    : `its data as it was; the database backup is at ${backup}`;
  lines.push(
    rolledBack.running
      ? `The upgrade to ${to} didn't finish, so Your Space ${from} is back and running, with ${data}.`
      : `The upgrade to ${to} didn't finish, so Your Space ${from} is back, with ${data}, but it didn't start either. See why with: your-space logs`,
  );
  if (rolledBack.keptDatabase) {
    lines.push(
      `The database as ${to} left it is kept as ${rolledBack.keptDatabase}, so nothing it took in is lost. Delete it once you don't need it: docker compose exec -T postgres dropdb -U yourspace ${rolledBack.keptDatabase}`,
    );
  }
  return lines.join("\n");
}

function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  return new CliError("unexpected", "Something unexpected went wrong.", {}, error instanceof Error ? (error.stack ?? error.message) : String(error));
}

export async function upgrade(ui: Ui, workdir: string, flags: ReleaseUpgradeFlags): Promise<void> {
  ui.intro("Your Space");
  await upgradeInstallation(ui, workdir, flags);
}

/** `upgrade`'s work, also run by `upgrade --channel` when the channel's build is this CLI's own. */
export async function upgradeInstallation(ui: Ui, workdir: string, flags: ReleaseUpgradeFlags): Promise<void> {
  // The lock comes first, so an upgrade killed part way, which may have left the folder without its
  // release files, is found before the folder is checked.
  const folder = resolve(workdir);
  let unlock = () => {};
  if (existsSync(folder)) {
    try {
      unlock = lockInstallation(folder, "upgrade");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") throw error;
      throw new CliError("permission_denied", `You can't change the files in ${folder}, and upgrading replaces them. Run this as the user who owns the installation.`, {}, String(error));
    }
  }
  try {
    if (existsSync(folder)) checkInterrupted(folder);
    const { installation, compose } = await open(ui, workdir);
    await upgradeLocked(ui, installation, compose, flags);
  } finally {
    unlock();
  }
}

/**
 * Refuses to go on from an upgrade that stopped part way, killed before it could put the previous
 * version back, which left that version's files in its `.upgrade-*` folder; a person decides which
 * files belong in the installation. A folder that holds none of them is removed.
 */
export function checkInterrupted(folder: string): void {
  refuseWhileRestoreNeeded(folder);
  for (const name of readdirSync(folder)) {
    if (!name.startsWith(".upgrade-")) continue;
    const previous = join(folder, name, "previous");
    if (existsSync(previous) && readdirSync(previous).length) {
      throw new CliError(
        "upgrade_interrupted",
        `An earlier upgrade stopped part way and left the previous version's release files in ${join(name, "previous")}. To run that version again, move them back into this folder in place of the ones there, and restore the newest backup in backups/ as "Restore the Backup by Hand" in the guide says (docs/operate/index.md), since the new version may have updated the database. Then delete ${name}, run your-space start, and upgrade again.`,
        { folder: join(folder, name) },
      );
    }
    rmSync(join(folder, name), { recursive: true, force: true });
  }
}

async function upgradeLocked(ui: Ui, installation: Installation, compose: Compose, flags: ReleaseUpgradeFlags): Promise<void> {
  const from = installedVersion(installation);
  const to = VERSION;
  const order = compareVersions(from, to);
  if (order === 0) {
    ui.result({ from, to, upToDate: true }, () => ui.outro(`Your Space is already ${to}. Nothing was changed.`));
    return;
  }
  if (order > 0) {
    throw new CliError(
      "downgrade_refused",
      `This installation runs Your Space ${from}, which is newer than this CLI (${to}), and Your Space can't go back to an earlier version. Use the CLI ${from} or later with it.`,
      { from, to },
    );
  }
  // The desktop app and scripts run it with --json, which answers for them as --yes does.
  if (!ui.json) {
    const go = await ui.confirm({
      message: `Upgrade Your Space from ${from} to ${to}? It stops while it upgrades, and its database is backed up first. Apps keep running.`,
      flag: "--yes",
      initial: true,
    });
    if (!go) throw new CliError("cancelled", "Not upgraded. Nothing was changed.");
  }

  const folder = installation.folder;
  // Beside the installation, so files move in and out of it by renaming.
  const work = mkdtempSync(join(folder, ".upgrade-"));
  const release = join(work, "release");
  const previous = join(work, "previous");
  mkdirSync(release);
  mkdirSync(previous);
  const wasRunning = await compose.running("server");
  const startedDb = !(await compose.running("postgres"));
  const moves = new Moves();
  let envBefore: string | null = null;
  let backup: Backup | undefined;
  let stopped = false;
  let committed = false;
  let keepWork = false;
  // Ctrl-C or the desktop app quitting doesn't kill the upgrade part way: it stops at the next step
  // and puts the previous version back. Once the new version has started, the upgrade finishes.
  let signalled: NodeJS.Signals | null = null;
  const onSignal = (signal: NodeJS.Signals) => {
    signalled = signal;
  };
  const checkpoint = () => {
    if (signalled) throw new CliError("cancelled", `Stopped by ${signalled} before Your Space ${to} started.`);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await ui.step(
      flags.releaseDir ? `Checking bundled Your Space ${to}` : `Downloading Your Space ${to}`,
      `Checked Your Space ${to}`,
      () => fetchRelease(to, release, flags.releaseDir),
    );
    if (!Installation.isOne(release) || RELEASE_FILES.some((name) => !existsSync(join(release, name)))) {
      throw new CliError("checksum_mismatch", `Your Space ${to}'s release files aren't complete. Nothing was changed.`);
    }
    // Only the release's own files are replaced; anything else in the bundle is left out.
    const names = RELEASE_FILES;
    checkpoint();
    await ui.step(`Getting Your Space ${to}'s images`, `Your Space ${to}'s images are here`, async () => {
      // The new release's files, which Compose finds beside its compose.yaml when that is the project
      // folder, with this installation's .env to pick the same setup, before anything stops, so a
      // download that fails changes nothing. Images already here aren't downloaded again.
      const env = existsSync(installation.envPath) ? ["--env-file", installation.envPath] : [];
      const pulled = await compose.run(["--project-directory", release, ...env, "-f", join(release, "compose.yaml"), "pull", "--policy", "missing", "--quiet"]);
      if (pulled.code !== 0) {
        throw new CliError("download_failed", `Couldn't download Your Space ${to}'s images. Check this machine's internet connection, then run this again. Nothing was changed.`, {}, `${pulled.stdout}${pulled.stderr}`);
      }
    });
    checkpoint();
    stopped = true;
    backup = await ui.step("Stopping Your Space and backing up its database", "Database backed up", () => backUp(compose, installation, from));
    ui.info(`Your Space ${from}'s database is backed up in ${relative(folder, backup.path)}.`);
    checkpoint();
    // From the first file moved until the files and the database are known to match, the folder
    // says they may not, in case this run is killed: start and upgrade then refuse.
    markRestoreNeeded(folder, { from, to, backup: backup.path });

    moves.move(names, folder, previous);
    moves.move(names, release, folder);
    // A setting the new release requires is added from its env.example; nothing set is changed.
    const required = parseEnv(readFileSync(join(folder, "env.example"), "utf8"));
    const present = installation.env();
    const missing = Object.fromEntries(Object.entries(required).filter(([key]) => !(key in present)));
    if (Object.keys(missing).length) {
      envBefore = installation.envText();
      ui.info(`Added to .env for Your Space ${to}: ${installation.writeEnv(missing).join(", ")}`);
    }
    checkpoint();
    // The server applies the new version's migrations as it starts. Once it is ready, with everything
    // it needs, the upgrade is done: the files and the database match. Only then does Caddy, the only
    // way in, start, so a rollback, which happens only before that, never discards anyone's changes.
    await ui.step(`Starting Your Space ${to}`, `Your Space ${to}'s server is ready`, () => upStack(compose, ["server"]));
    committed = true;
    clearRestoreNeeded(folder);
    // The previous files are no longer a way back: a later upgrade mustn't take them for one.
    rmSync(work, { recursive: true, force: true });
    await ui.step(`Opening Your Space ${to}`, `Your Space ${to} started`, () => upStack(compose));
  } catch (error) {
    const failure = asCliError(error);
    if (committed) {
      // Upgraded, but Caddy didn't start: that is fixed and started like any start, not rolled back.
      throw new Restated(
        failure,
        `${failure.message}\nYour Space ${to} is installed and its server runs on the updated database, but it didn't open. Fix the problem above, then run your-space start. The database backup from before the upgrade is at ${relative(folder, backup!.path)}.`,
        { from, to, backup: backup!.path, upgraded: true, rolledBack: false, restored: false },
      );
    }
    if (!moves.started) {
      // Nothing was replaced: Your Space comes back as it was, if the backup stopped it.
      clearRestoreNeeded(folder);
      if (stopped && wasRunning) {
        const restarted = await compose.run(["up", "-d", "--wait"]).then((ran) => ran.code === 0, () => false);
        if (!restarted) {
          throw new Restated(failure, `${failure.message}\nNothing was upgraded, but Your Space ${from} didn't start again either. See why with: your-space logs`, { running: false });
        }
      } else if (stopped && startedDb) await compose.run(["stop", "postgres"]).catch(() => undefined);
      throw failure;
    }
    const saved = backup!;
    const rolledBack = await ui.step(`Putting Your Space ${from} back`, `Your Space ${from} is back`, () =>
      rollBack(compose, installation, { moves, envBefore, backup: saved }),
    );
    keepWork = !rolledBack.filesBack;
    throw new Restated(failure, failedUpgrade(failure, rolledBack, { from, to, backup: relative(folder, saved.path), previous: relative(folder, previous) }), {
      from,
      to,
      backup: saved.path,
      rolledBack: rolledBack.filesBack,
      restored: rolledBack.restored,
      ...(rolledBack.keptDatabase ? { keptDatabase: rolledBack.keptDatabase } : {}),
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!keepWork) rmSync(work, { recursive: true, force: true });
  }
  const path = backup!.path;
  ui.result({ from, to, backup: path }, () => {
    ui.note(`Your Space ${from} → ${to}\nDatabase backup from before: ${relative(folder, path)}`, "Upgraded");
    ui.outro(`Your Space ${to} is running.`);
  });
}

/**
 * Puts the previous version back after its files were replaced: the files and `.env`, then the
 * database from the backup when the new version had already changed it, since the previous
 * version refuses a database a newer one changed. Restoring loses nothing: the server was stopped
 * before the backup, and only the new version ran since. Then it starts the previous version.
 */
export async function rollBack(
  compose: Compose,
  installation: Installation,
  state: { moves: Moves; envBefore: string | null; backup: Backup },
): Promise<RollBack> {
  const result: RollBack = { filesBack: false, restored: false, running: false };
  // Nothing may use the database while it is checked and restored, nor run from files being moved.
  try {
    const stopped = await compose.run(["stop", "caddy", "server"]);
    if (stopped.code !== 0) {
      result.stopProblem = stopped.stderr.trim().split("\n").at(-1) || "Docker Compose couldn't stop them";
      return result;
    }
  } catch (error) {
    result.stopProblem = (error instanceof Error ? error.message : String(error)) || "Docker Compose couldn't stop them";
    return result;
  }
  try {
    state.moves.undo();
    if (state.envBefore !== null) installation.writeEnvText(state.envBefore);
    result.filesBack = Installation.isOne(installation.folder);
  } catch {
    return result;
  }
  if (!result.filesBack) return result;

  // The previous version's own database service, then the database as it is now, compared with the
  // backup whole: the new version may have changed more than its schema as it started, such as
  // moving settings into a new format, which the previous version couldn't read.
  const db = await compose.run(["up", "-d", "--wait", "postgres"]).catch(() => null);
  const now = join(dirname(state.backup.path), `.now-${backupStamp(new Date())}.sql`);
  let checked = false;
  let changed = true;
  try {
    if (db?.code === 0 && (await dump(compose, now)).saved) {
      changed = !(await sameDump(now, state.backup.path));
      checked = true;
    }
  } catch {
    // Unreadable, it counts as unchecked.
  } finally {
    rmSync(now, { force: true });
  }
  if (!checked) {
    // Unread, the database may have been changed, and a version from before the server refused a
    // newer database would run on it; so the previous version isn't started.
    result.restoreProblem = "the database couldn't be checked, so whether the new version had already changed it is unknown";
    return result;
  }
  if (changed) {
    try {
      const kept = `yourspace_upgrade_failed_${backupStamp(new Date()).toLowerCase()}`;
      await restore(compose, state.backup.path, kept);
      result.restored = true;
      result.keptDatabase = kept;
    } catch (error) {
      result.restoreProblem = `the new version had already changed the database, and restoring the backup failed: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }
  // The previous files and its database match again, before the previous version runs on them.
  clearRestoreNeeded(installation.folder);
  const started = await compose.run(["up", "-d", "--wait"]).catch(() => null);
  result.running = started?.code === 0;
  return result;
}
