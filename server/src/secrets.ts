// The two platform secrets, and where each comes from (research R16):
//   1. a value set in .env is used as given and never copied;
//   2. otherwise the copy kept in the ys-secrets volume;
//   3. otherwise, for a new installation, the secrets step (commands/secrets-step.ts) generates one.
// If the database already exists but its secret is missing, the step stops instead of generating a
// new one: a new database password would lock the server out, and a silent new auth secret would
// hide a lost volume.
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  chownSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/** Where the ys-secrets volume is mounted in the secrets step (read-write) and the server (read-only). */
export const SECRETS_DIR = "/run/ys-secrets";

export interface SecretSpec {
  /** The .env setting that supplies the value instead. */
  env: "BETTER_AUTH_SECRET" | "POSTGRES_PASSWORD";
  /** The name used in logs and messages. */
  label: string;
  /** The `--new` argument that replaces it. */
  argument: string;
  /** Folder and file inside the volume. */
  dir: string;
  file: string;
  /** Who may read it. The server runs as node (1000:1000); PostgreSQL as postgres (999). */
  uid: number;
  gid: number;
  dirMode: number;
  fileMode: number;
  minLength: number;
}

export const AUTH_SECRET: SecretSpec = {
  env: "BETTER_AUTH_SECRET",
  label: "auth secret",
  argument: "auth-secret",
  dir: "auth",
  file: "secret",
  uid: 1000,
  gid: 1000,
  dirMode: 0o700,
  fileMode: 0o400,
  minLength: 32,
};

/** PostgreSQL gets only this folder (a volume subpath), so it never sees the auth secret. */
export const DATABASE_PASSWORD: SecretSpec = {
  env: "POSTGRES_PASSWORD",
  label: "database password",
  argument: "database-password",
  dir: "postgres",
  file: "password",
  uid: 999,
  gid: 1000,
  dirMode: 0o750,
  fileMode: 0o440,
  minLength: 1,
};

export const SECRETS = [AUTH_SECRET, DATABASE_PASSWORD];

export type Source = "env" | "generated";

/** The value set in .env, if any. An empty line counts as no line. */
export function fromEnv(spec: SecretSpec, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[spec.env]?.trim();
  return value ? value : undefined;
}

/** The generated copy kept in the volume, if any. Errors other than "not there" are thrown. */
export function readStored(spec: SecretSpec, dir: string = SECRETS_DIR): string | undefined {
  try {
    const value = readFileSync(join(dir, spec.dir, spec.file), "utf8").trim();
    return value ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** The value in use and where it came from: .env first, then the volume. */
export function resolveSecret(
  spec: SecretSpec,
  env: NodeJS.ProcessEnv,
  dir: string = SECRETS_DIR,
): { value: string; source: Source } | undefined {
  const given = fromEnv(spec, env);
  if (given) return { value: given, source: "env" };
  const stored = readStored(spec, dir);
  return stored ? { value: stored, source: "generated" } : undefined;
}

/** True when a PostgreSQL data directory exists anywhere in the first levels of the volume. */
export function databaseExists(dir: string, depth = 3): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  for (const entry of entries) {
    // Every PostgreSQL major version keeps PG_VERSION at the top of its data directory; the image's
    // layout around it changes between versions (18 uses 18/docker).
    if (entry.isFile() && entry.name === "PG_VERSION") return true;
    if (entry.isDirectory() && depth > 0 && databaseExists(join(dir, entry.name), depth - 1)) return true;
  }
  return false;
}

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

export type Action = "from_env" | "kept" | "generated" | "replaced";

export interface SettleOptions {
  /** The ys-secrets volume. */
  dir: string;
  /** The ys-postgres volume, read-only. */
  databaseDir: string;
  env: NodeJS.ProcessEnv;
  /** Secrets to replace with new generated values (`--new`). */
  replace?: SecretSpec[];
  /** Set owners as well as modes. Needs root; tests that run as another user turn it off. */
  chown?: boolean;
}

function recovery(spec: SecretSpec): string {
  if (spec === AUTH_SECRET) {
    return [
      "The auth secret isn't in .env or in the ys-secrets volume, but this installation already has a",
      "database. Your Space won't make a new one without asking, because a missing volume usually means",
      "something went wrong. To recover, do one of these:",
      "  - restore the ys-secrets volume from a backup, or put the old value back in .env as BETTER_AUTH_SECRET;",
      "  - or start with a new auth secret, which signs out every device and changes nothing else:",
      "      docker compose run --rm secrets --new auth-secret",
    ].join("\n");
  }
  return [
    "The database password isn't in .env or in the ys-secrets volume, but the database already exists,",
    "and it only accepts the password it was created with. Your Space won't make a new one. To recover:",
    "  - restore the ys-secrets volume from a backup, or put the password back in .env as POSTGRES_PASSWORD;",
    '  - or set a new one by following "Lost Secrets" in the installation guide.',
  ].join("\n");
}

function writeSecret(spec: SecretSpec, root: string, value: string, chown: boolean): void {
  const dir = join(root, spec.dir);
  mkdirSync(dir, { recursive: true, mode: spec.dirMode });
  chmodSync(dir, spec.dirMode);
  if (chown) chownSync(dir, spec.uid, spec.gid);
  // A random name, written then renamed, so a crash never leaves a half-written secret or a
  // leftover file that blocks the next start.
  const temporary = join(dir, `.${spec.file}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", spec.fileMode);
  try {
    writeSync(fd, `${value}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(temporary, spec.fileMode);
  if (chown) chownSync(temporary, spec.uid, spec.gid);
  renameSync(temporary, join(dir, spec.file));
  const dirFd = openSync(dir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

function removeLeftovers(spec: SecretSpec, root: string): void {
  const dir = join(root, spec.dir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (name.startsWith(".") && name.endsWith(".tmp")) rmSync(join(dir, name), { force: true });
  }
}

function generate(): string {
  // 32 random bytes, as base64url: 43 characters with no quoting or URL escaping needed.
  return randomBytes(32).toString("base64url");
}

/**
 * Settles each secret for this start and returns what happened to each. Throws SecretsError, with
 * a message that says what to do, when a secret can't be settled.
 */
export function settleSecrets(options: SettleOptions): { spec: SecretSpec; action: Action }[] {
  const { dir, databaseDir, env, replace = [], chown = true } = options;
  const outcomes: { spec: SecretSpec; action: Action }[] = [];
  let existing: boolean | undefined;
  for (const spec of SECRETS) {
    removeLeftovers(spec, dir);
    const given = fromEnv(spec, env);
    if (replace.includes(spec)) {
      if (given) {
        throw new SecretsError(`${spec.env} is set in .env, so Your Space uses it as given. Change it there instead.`);
      }
      writeSecret(spec, dir, generate(), chown);
      outcomes.push({ spec, action: "replaced" });
      continue;
    }
    if (given) {
      if (given.length < spec.minLength) {
        throw new SecretsError(
          `${spec.env} in .env must be at least ${spec.minLength} characters. Remove the line to let Your ` +
            "Space generate one, or make one with: openssl rand -base64 32",
        );
      }
      outcomes.push({ spec, action: "from_env" });
      continue;
    }
    if (readStored(spec, dir)) {
      outcomes.push({ spec, action: "kept" });
      continue;
    }
    existing ??= databaseExists(databaseDir);
    if (existing) throw new SecretsError(recovery(spec));
    writeSecret(spec, dir, generate(), chown);
    outcomes.push({ spec, action: "generated" });
  }
  return outcomes;
}
