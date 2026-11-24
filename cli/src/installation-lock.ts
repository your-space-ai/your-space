// The installation's lock, `.your-space.lock` in its folder: held by each command that starts, stops,
// changes or upgrades Your Space, so they never overlap, and an upgrade has the installation to
// itself from its backup to its result. And `.upgrade-restore`, which says an upgrade left the files
// and the database possibly not matching.
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliError } from "./errors.ts";

/** True while a process with this ID runs. */
function running(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What a lock file holds: `<process ID> <command>`. The ID is null when it is gone, empty or unreadable. */
function lockHolder(path: string): { pid: number | null; command: string } {
  try {
    const [id = "", ...command] = readFileSync(path, "utf8").trim().split(/\s+/);
    const pid = Number.parseInt(id, 10);
    return { pid: Number.isInteger(pid) && pid > 0 ? pid : null, command: command.join(" ") };
  } catch {
    return { pid: null, command: "" };
  }
}

function lockPath(folder: string): string {
  return join(folder, ".your-space.lock");
}

function held(path: string): CliError {
  const { pid, command } = lockHolder(path);
  return new CliError(
    "installation_busy",
    `${command ? `your-space ${command}` : "Another your-space command"} is running on this installation${pid ? ` (process ${pid})` : ""}. Wait for it to finish, then run this again. If nothing is running, delete ${path}.`,
    { ...(pid ? { pid } : {}), ...(command ? { command } : {}) },
  );
}

/**
 * Runs `work` holding the lock of the installation in `workdir`, for a command that starts, stops or
 * changes Your Space. The lock is taken before anything in the folder is read, since an upgrade moves
 * its release files while it holds it; a folder that doesn't exist is left to the command to report.
 */
export async function holdingLock<T>(workdir: string, command: string, work: () => Promise<T>): Promise<T> {
  const folder = resolve(workdir);
  let release = () => {};
  if (existsSync(folder)) {
    try {
      release = lockInstallation(folder, command);
    } catch (error) {
      if (!READ_ONLY.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      // Without the lock, the command could run during another user's upgrade, so it doesn't run.
      throw new CliError(
        "permission_denied",
        `You can't write to ${folder}, so your-space can't take the installation's lock (.your-space.lock) to ${command} it safely. Run this as the user who owns the installation.`,
        {},
        String(error),
      );
    }
  }
  try {
    return await work();
  } finally {
    release();
  }
}

/** Errors that say this process can't write in the folder at all. */
const READ_ONLY = new Set(["EACCES", "EPERM", "EROFS"]);
/** Errors that say the folder's filesystem can't make hard links. */
const NO_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

/** Test-only: a pause between finding the lock stale and taking it over, to order two runs. */
export interface LockHooks {
  afterStale?: () => void;
}

/**
 * Takes the installation's lock for `command`, and returns what gives it up. The lock never exists
 * without a process ID in it: it is a hard link to a file written first. A lock whose process is
 * gone was left by a command that was stopped part way, and is taken over by renaming this run's
 * file over it, so the lock is never absent. Takeovers go one at a time, through
 * `.your-space.lock.takeover`, and each checks again that the lock is still the one it found stale.
 */
export function lockInstallation(folder: string, command: string, hooks: LockHooks = {}): () => void {
  const path = lockPath(folder);
  const takeover = `${path}.takeover`;
  const mine = `${path}.${process.pid}`;
  const release = () => rmSync(path, { force: true });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      writeFileSync(mine, `${process.pid} ${command}\n`, { mode: 0o600 });
      try {
        try {
          linkSync(mine, path);
        } catch (error) {
          // Without hard links, the lock is created on its own; read before it is written, it has
          // no process ID, which counts as held and is never taken over.
          if (!NO_LINKS.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
          writeFileSync(path, `${process.pid} ${command}\n`, { mode: 0o600, flag: "wx" });
        }
        return release;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = lockHolder(path).pid;
      if (holder === null) {
        // Given up since, or left without a process ID: try again, or say so.
        if (existsSync(path)) throw held(path);
        continue;
      }
      if (running(holder)) throw held(path);
      hooks.afterStale?.();
      try {
        mkdirSync(takeover);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        throw new CliError(
          "installation_busy",
          `Another command is taking over the lock a stopped one left. Run this again in a moment. If nothing else is running, delete ${takeover} and ${path}, then run this again.`,
        );
      }
      try {
        // Still the lock that was found stale, and no other takeover has replaced it since.
        if (lockHolder(path).pid !== holder) continue;
        renameSync(mine, path);
        return release;
      } finally {
        rmSync(takeover, { recursive: true, force: true });
      }
    }
    throw held(path);
  } finally {
    rmSync(mine, { force: true });
  }
}

/** What `.upgrade-restore` records: an upgrade that may have left the database for a version whose files aren't in place. */
interface RestoreNeeded {
  from: string;
  to: string;
  backup: string;
}

function restorePath(folder: string): string {
  return join(folder, ".upgrade-restore");
}

/**
 * Records, from the moment a new version may migrate the database until the upgrade knows the files
 * and the database agree, that they may not: an upgrade killed in between, or one whose rollback
 * couldn't check or restore the database, leaves it behind.
 */
export function markRestoreNeeded(folder: string, upgrade: RestoreNeeded): void {
  writeFileSync(restorePath(folder), `${JSON.stringify(upgrade)}\n`, { mode: 0o600 });
}

export function clearRestoreNeeded(folder: string): void {
  rmSync(restorePath(folder), { force: true });
}

/**
 * Refuses to start Your Space, or upgrade it again, while `.upgrade-restore` says its files and its
 * database may not agree: a version from before the server refused a newer database would run on it.
 */
export function refuseWhileRestoreNeeded(folder: string): void {
  const path = restorePath(folder);
  if (!existsSync(path)) return;
  let recorded: Partial<RestoreNeeded> = {};
  try {
    recorded = JSON.parse(readFileSync(path, "utf8")) as Partial<RestoreNeeded>;
  } catch {
    // Unreadable, it still says an upgrade didn't settle.
  }
  const { from = "the previous version", to = "the new version", backup = "the newest backup in backups/" } = recorded;
  throw new CliError(
    "upgrade_interrupted",
    `An upgrade from ${from} to ${to} stopped before it knew the database matches this folder's files. Make the release files one version's first: the previous ones are in a .upgrade-* folder here if the upgrade left them. If stack.yaml then names ${from}, restore ${backup} as "Restore the Backup by Hand" in the guide says (docs/operate/index.md), since ${to} may have updated the database; if it names ${to}, nothing needs restoring. Then delete ${path} and run this again.`,
    { folder, ...recorded },
  );
}
