// Server configuration, read from the environment and validated at startup (T006).

export interface Config {
  /** The address people use, e.g. `https://space.example.com` or `http://localhost`. No trailing slash. */
  publicUrl: string;
  databaseUrl: string;
  authSecret: string;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function checkPublicUrl(value: string | undefined, problems: string[]): string {
  if (!value) {
    problems.push("YS_PUBLIC_URL is not set. Set it in .env, for example YS_PUBLIC_URL=http://localhost.");
    return "";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`YS_PUBLIC_URL is not a valid URL: "${value}".`);
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    problems.push("YS_PUBLIC_URL must start with https:// (or http:// for localhost only).");
  } else if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    // Session cookies must never travel over plain HTTP to another machine (FR-015).
    problems.push(
      "YS_PUBLIC_URL uses plain http:// for a host other than localhost. Use https:// with a domain, " +
        "your own proxy, or Tailscale; see the installation guide.",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    problems.push("YS_PUBLIC_URL must be just the address, with no path, query, or credentials.");
  } else if (value !== url.origin) {
    // Caddy uses the same text as its site address, where a trailing slash or a written-out
    // default port changes what it matches.
    problems.push(`YS_PUBLIC_URL must be written exactly as ${url.origin} (no trailing slash or default port).`);
  }
  return url.origin;
}

function checkDatabaseUrl(value: string | undefined, problems: string[]): string {
  if (!value) {
    problems.push("DATABASE_URL is not set.");
    return "";
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      problems.push("DATABASE_URL must be a postgres:// URL.");
    }
  } catch {
    problems.push("DATABASE_URL is not a valid URL.");
  }
  return value;
}

function checkSecret(value: string | undefined, problems: string[]): string {
  if (!value) {
    problems.push("BETTER_AUTH_SECRET is not set. Generate one with: openssl rand -base64 32");
    return "";
  }
  if (value.length < 32) {
    problems.push("BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32");
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const config: Config = {
    publicUrl: checkPublicUrl(env.YS_PUBLIC_URL, problems),
    databaseUrl: checkDatabaseUrl(env.DATABASE_URL, problems),
    authSecret: checkSecret(env.BETTER_AUTH_SECRET, problems),
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
