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
  statSync,
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

/**
 * The value set in .env, exactly as given, or undefined for no line or an empty one. PostgreSQL
 * receives the same string, so nothing is trimmed here; the secrets step refuses a value with
 * spaces around it instead.
 */
export function fromEnv(spec: SecretSpec, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[spec.env];
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

export type Action = "from_env" | "kept" | "generated" | "replaced" | "not_replaced";

export interface SettleOptions {
  /** The ys-secrets volume. */
  dir: string;
  /** The ys-postgres volume, read-only. */
  databaseDir: string;
  env: NodeJS.ProcessEnv;
  /** Secrets to replace with new generated values (`--new`). One set in .env is left as it is. */
  replace?: SecretSpec[];
  /** Set owners as well as modes. Needs root; tests that run as another user turn it off. */
  chown?: boolean;
}

const RESTORE = "restore the ys-secrets volume from a backup, or put the old values back in .env";

function recovery(missing: SecretSpec[]): string {
  if (missing.length > 1) {
    return [
      "The auth secret and the database password aren't in .env or in the ys-secrets volume, but this",
      "installation already has a database. Your Space won't make new ones without asking, because the",
      "database only accepts the password it was created with. To recover, do one of these:",
      `  - ${RESTORE} as BETTER_AUTH_SECRET and POSTGRES_PASSWORD;`,
      '  - or start with new ones by following "Lost Secrets" in the installation guide.',
    ].join("\n");
  }
  if (missing[0] === AUTH_SECRET) {
    return [
      "The auth secret isn't in .env or in the ys-secrets volume, but this installation already has a",
      "database. Your Space won't make a new one without asking, because a missing volume usually means",
      "something went wrong. To recover, do one of these:",
      `  - ${RESTORE} as BETTER_AUTH_SECRET;`,
      "  - or start with a new auth secret, which signs out every device and changes nothing else:",
      "      docker compose run --rm secrets --new auth-secret",
    ].join("\n");
  }
  return [
    "The database password isn't in .env or in the ys-secrets volume, but the database already exists,",
    "and it only accepts the password it was created with. Your Space won't make a new one. To recover:",
    `  - ${RESTORE} as POSTGRES_PASSWORD;`,
    '  - or set a new one by following "Lost Secrets" in the installation guide.',
  ].join("\n");
}

/** The folder for one secret, with its owner and mode. PostgreSQL mounts its folder, so it must exist. */
function ensureFolder(spec: SecretSpec, root: string, chown: boolean): string {
  const dir = join(root, spec.dir);
  mkdirSync(dir, { recursive: true, mode: spec.dirMode });
  chmodSync(dir, spec.dirMode);
  if (chown) chownSync(dir, spec.uid, spec.gid);
  return dir;
}

function writeSecret(spec: SecretSpec, root: string, value: string, chown: boolean): void {
  const dir = ensureFolder(spec, root, chown);
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

// A secret is written in milliseconds, so a temporary file this old was left by a run that
// stopped part-way. A younger one may belong to another run still writing, so it stays.
const LEFTOVER_AGE_MS = 60_000;

function removeLeftovers(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(".") || !name.endsWith(".tmp")) continue;
    const path = join(dir, name);
    try {
      if (Date.now() - statSync(path).mtimeMs >= LEFTOVER_AGE_MS) rmSync(path, { force: true });
    } catch (error) {
      // Another run renamed or removed it first.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function generate(): string {
  // 32 random bytes, as base64url: 43 characters with no quoting or URL escaping needed.
  return randomBytes(32).toString("base64url");
}

/** A problem with a value set in .env, or undefined when it can be used as given. */
function checkGiven(spec: SecretSpec, value: string): string | undefined {
  if (value.trim() !== value) {
    return `${spec.env} in .env starts or ends with a space. Remove the spaces, or the line to let Your Space generate one.`;
  }
  if (value.length < spec.minLength) {
    return (
      `${spec.env} in .env must be at least ${spec.minLength} characters. Remove the line to let Your ` +
      "Space generate one, or make one with: openssl rand -base64 32"
    );
  }
  return undefined;
}

/**
 * Settles each secret for this start and returns what happened to each. Throws SecretsError, with
 * a message that says what to do, when a secret can't be settled. Nothing is written unless every
 * secret can be settled.
 */
export function settleSecrets(options: SettleOptions): { spec: SecretSpec; action: Action }[] {
  const { dir, databaseDir, env, replace = [], chown = true } = options;
  const plan: { spec: SecretSpec; action: Action }[] = [];
  const missing: SecretSpec[] = [];
  for (const spec of SECRETS) {
    const given = fromEnv(spec, env);
    if (given) {
      const problem = checkGiven(spec, given);
      if (problem) throw new SecretsError(problem);
      plan.push({ spec, action: replace.includes(spec) ? "not_replaced" : "from_env" });
    } else if (replace.includes(spec)) {
      plan.push({ spec, action: "replaced" });
    } else if (readStored(spec, dir)) {
      plan.push({ spec, action: "kept" });
    } else {
      plan.push({ spec, action: "generated" });
      missing.push(spec);
    }
  }
  if (missing.length > 0 && databaseExists(databaseDir)) throw new SecretsError(recovery(missing));

  for (const { spec, action } of plan) {
    removeLeftovers(ensureFolder(spec, dir, chown));
    if (action === "generated" || action === "replaced") writeSecret(spec, dir, generate(), chown);
  }
  return plan;
}
