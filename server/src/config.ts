// Server configuration, read from the environment and validated at startup (T006).
//
// The owner writes at most one line, and which key they write picks the setup (constitution
// principle II; docs/install/README.md):
//   nothing                        this machine only, http://space.localhost
//   YS_DOMAIN=space.example.com    your own domain, HTTPS from Let's Encrypt
//   YS_PROXY_URL=https://...       behind your own proxy or Tailscale
// YS_PORT moves the local port when 80 (or 8080 behind a proxy) is taken. Everything else is derived.
// The two secrets come from .env when set there, otherwise from the ys-secrets volume (secrets.ts).
import { AUTH_SECRET, DATA_KEY, DATABASE_PASSWORD, PREVIOUS_DATA_KEY, readStored, resolveSecret, SECRETS_DIR, type SecretSpec } from "./secrets.ts";

export type Mode = "local" | "domain" | "proxy";

export interface Config {
  mode: Mode;
  /** The address people use, e.g. `https://space.example.com` or `http://localhost`. No trailing slash. */
  publicUrl: string;
  databaseUrl: string;
  authSecret: string;
  /** Encrypts the secrets Your Space stores (spec 009). */
  dataKey: string;
  /** The data key a replacement left, until the server has re-encrypted with the new one. */
  previousDataKey?: string;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const OWNER_KEYS = ["YS_DOMAIN", "YS_PROXY_URL", "YS_PORT", "YS_VERSION", "YS_ENGINE_SOCKET", "YS_DATA_KEY"];

/**
 * This machine's address. Apps are at <app>.space.localhost, a subdomain of it, so they are same-site
 * with Your Space and each gets its own origin; every *.localhost name reaches this machine with no
 * setup (RFC 6761). Plain `localhost` redirects here.
 */
export const LOCAL_HOST = "space.localhost";

// Better Auth reads these by itself, and they would replace the secret Your Space gives it.
const FOREIGN_SECRET_KEYS: Record<string, string> = {
  BETTER_AUTH_SECRETS: "BETTER_AUTH_SECRETS isn't a Your Space setting. Write BETTER_AUTH_SECRET, or remove it to use the generated secret.",
  AUTH_SECRET: "AUTH_SECRET isn't a Your Space setting. Write BETTER_AUTH_SECRET, or remove it to use the generated secret.",
};

// Names that never get a public certificate, or that belong to another setup.
const NOT_PUBLIC = [
  { suffix: "localhost", hint: "for this machine, leave YS_DOMAIN out" },
  { suffix: "ts.net", hint: "for Tailscale, write YS_PROXY_URL=https://… instead" },
  { suffix: "local", hint: "use a domain whose DNS points at this server" },
  { suffix: "internal", hint: "use a domain whose DNS points at this server" },
  { suffix: "home.arpa", hint: "use a domain whose DNS points at this server" },
  { suffix: "test", hint: "use a domain whose DNS points at this server" },
  { suffix: "invalid", hint: "use a domain whose DNS points at this server" },
];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Refuses settings Your Space doesn't know, so a typo can't silently fall back to another setup. */
function checkKeys(env: NodeJS.ProcessEnv, problems: string[]): void {
  for (const key of Object.keys(env)) {
    if (FOREIGN_SECRET_KEYS[key] && env[key]) {
      problems.push(FOREIGN_SECRET_KEYS[key]);
      continue;
    }
    const upper = key.toUpperCase();
    if (!upper.startsWith("YS_") || upper.startsWith("YS_E2E_")) continue;
    if (OWNER_KEYS.includes(key)) continue;
    const guess = OWNER_KEYS.find((known) => known === upper || distance(upper, known) <= 2);
    problems.push(guess ? `${key} isn't a setting. Did you mean ${guess}?` : `${key} isn't a setting. Remove it from .env.`);
  }
}

function checkDomain(value: string, problems: string[]): string {
  const name = value.trim().toLowerCase();
  if (/^[a-z]+:\/\//.test(name) || name.includes("/") || name.includes(":")) {
    problems.push(`YS_DOMAIN must be just the name, like space.example.com, without "https://", a port, or a path.`);
    return name;
  }
  const reserved = NOT_PUBLIC.find(({ suffix }) => name === suffix || name.endsWith(`.${suffix}`));
  if (reserved) {
    problems.push(`YS_DOMAIN "${name}" can't get a public certificate: ${reserved.hint}.`);
    return name;
  }
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)) || name.length > 253) {
    problems.push(`YS_DOMAIN "${value}" isn't a domain name. Write one like space.example.com.`);
    return name;
  }
  if (/^\d+$/.test(labels.at(-1)!)) {
    problems.push("YS_DOMAIN must be a domain name, not an IP address. Let's Encrypt only issues certificates for names.");
  }
  return name;
}

function checkProxyUrl(value: string, problems: string[]): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    // The value may hold a password, so the message leaves it out.
    problems.push("YS_PROXY_URL isn't a valid address. Write the HTTPS address your proxy serves, like https://space.example.com.");
    return "";
  }
  if (url.protocol !== "https:") {
    // Session cookies must never travel over plain HTTP to another machine (FR-015).
    problems.push("YS_PROXY_URL must start with https://. Your proxy or Tailscale provides the HTTPS.");
  } else if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    problems.push("YS_PROXY_URL must be just the address, with no path, query, or credentials.");
  } else if (value.trim() !== url.origin) {
    // Caddy compares this exact text with each request's address, to tell Your Space from its apps.
    problems.push(`YS_PROXY_URL must be written exactly as ${url.origin}, in lower case, with no trailing slash or default port.`);
  }
  return url.origin;
}

function checkPort(value: string, problems: string[]): number {
  const port = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || port < 1 || port > 65535) {
    problems.push(`YS_PORT must be a port number from 1 to 65535, like 8081.`);
  }
  return port;
}

/** A secret from .env or the volume, or a problem that says how to get one. */
function secret(spec: SecretSpec, env: NodeJS.ProcessEnv, dir: string, problems: string[]): string | undefined {
  try {
    const resolved = resolveSecret(spec, env, dir);
    if (resolved) return resolved.value;
    problems.push(
      `${spec.env} isn't set in .env, and Your Space hasn't generated the ${spec.label} yet. ` +
        "Start it with docker compose up -d, which generates one.",
    );
  } catch (error) {
    problems.push(`The ${spec.label} in the ys-secrets volume can't be read (${(error as NodeJS.ErrnoException).code ?? "error"}).`);
  }
  return undefined;
}

function checkDatabaseUrl(env: NodeJS.ProcessEnv, dir: string, problems: string[]): string {
  const value = env.DATABASE_URL;
  if (!value) {
    problems.push("DATABASE_URL is not set.");
    return "";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push("DATABASE_URL is not a valid URL.");
    return value;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    problems.push("DATABASE_URL must be a postgres:// URL.");
    return value;
  }
  if (url.password) return value;
  const password = secret(DATABASE_PASSWORD, env, dir, problems);
  if (password === undefined) return value;
  // Encoded, so a password with characters such as @, /, # or % still reaches PostgreSQL unchanged.
  url.password = encodeURIComponent(password);
  return url.toString();
}

function checkSecret(env: NodeJS.ProcessEnv, dir: string, problems: string[]): string {
  const value = secret(AUTH_SECRET, env, dir, problems);
  if (value === undefined) return "";
  if (value.length < 32) {
    problems.push(
      "BETTER_AUTH_SECRET must be at least 32 characters. Remove it from .env to use a generated one, or make one with: openssl rand -base64 32",
    );
  }
  return value;
}

function checkDataKey(env: NodeJS.ProcessEnv, dir: string, problems: string[]): string {
  const value = secret(DATA_KEY, env, dir, problems);
  if (value === undefined) return "";
  if (value.length < 32) {
    problems.push("YS_DATA_KEY must be at least 32 characters. Remove it from .env to use a generated one, or make one with: openssl rand -base64 32");
  }
  return value;
}

function previousDataKey(dir: string): string | undefined {
  try {
    return readStored(PREVIOUS_DATA_KEY, dir);
  } catch {
    return undefined;
  }
}

export interface LoadOptions {
  /** Where the ys-secrets volume is mounted. */
  secretsDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: LoadOptions = {}): Config {
  const secretsDir = options.secretsDir ?? SECRETS_DIR;
  const problems: string[] = [];
  checkKeys(env, problems);

  const port = present(env.YS_PORT) ? checkPort(env.YS_PORT, problems) : undefined;
  let mode: Mode = "local";
  let publicUrl = port && port !== 80 ? `http://${LOCAL_HOST}:${port}` : `http://${LOCAL_HOST}`;

  if (present(env.YS_DOMAIN) && present(env.YS_PROXY_URL)) {
    problems.push("Set either YS_DOMAIN (your own domain) or YS_PROXY_URL (your own proxy or Tailscale), not both.");
  } else if (present(env.YS_DOMAIN)) {
    mode = "domain";
    publicUrl = `https://${checkDomain(env.YS_DOMAIN, problems)}`;
    if (port !== undefined) {
      problems.push("YS_PORT doesn't apply to your own domain: Let's Encrypt and visitors need ports 80 and 443.");
    }
  } else if (present(env.YS_PROXY_URL)) {
    mode = "proxy";
    publicUrl = checkProxyUrl(env.YS_PROXY_URL, problems);
  }

  const config: Config = {
    mode,
    publicUrl,
    databaseUrl: checkDatabaseUrl(env, secretsDir, problems),
    authSecret: checkSecret(env, secretsDir, problems),
    dataKey: checkDataKey(env, secretsDir, problems),
  };
  const previous = previousDataKey(secretsDir);
  if (previous) config.previousDataKey = previous;
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
