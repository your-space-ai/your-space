// How the space is reached: this machine, your own domain, or your own proxy or tunnel. The setup
// is the `.env` lines journey 001 defined (YS_DOMAIN, YS_PROXY_URL, YS_PORT), nothing else.
import { CliError } from "./errors.ts";
import type { Ui } from "./ui.ts";

export type Setup =
  | { kind: "this-machine"; port: number }
  | { kind: "domain"; domain: string }
  | { kind: "proxy"; url: string; port: number };

export type SetupKind = Setup["kind"];

export const SETUP_KEYS = ["YS_DOMAIN", "YS_PROXY_URL", "YS_PORT"] as const;

export function setupFromEnv(env: Record<string, string>): Setup {
  const port = env.YS_PORT ? Number(env.YS_PORT) : undefined;
  if (env.YS_DOMAIN && env.YS_PROXY_URL) {
    throw new CliError("invalid_input", "Both YS_DOMAIN and YS_PROXY_URL are set in .env. Run `your-space configure` to choose one.");
  }
  if (env.YS_DOMAIN) return { kind: "domain", domain: env.YS_DOMAIN };
  if (env.YS_PROXY_URL) return { kind: "proxy", url: env.YS_PROXY_URL, port: port ?? 8080 };
  return { kind: "this-machine", port: port ?? 80 };
}

/** The `.env` values for a setup; null clears a line. */
export function setupLines(setup: Setup): Record<(typeof SETUP_KEYS)[number], string | null> {
  switch (setup.kind) {
    case "this-machine":
      return { YS_DOMAIN: null, YS_PROXY_URL: null, YS_PORT: setup.port === 80 ? null : String(setup.port) };
    case "domain":
      return { YS_DOMAIN: setup.domain, YS_PROXY_URL: null, YS_PORT: null };
    case "proxy":
      return { YS_DOMAIN: null, YS_PROXY_URL: setup.url, YS_PORT: setup.port === 8080 ? null : String(setup.port) };
  }
}

/** Your Space's own address. */
export function address(setup: Setup): string {
  switch (setup.kind) {
    case "this-machine":
      return `http://space.localhost${setup.port === 80 ? "" : `:${setup.port}`}`;
    case "domain":
      return `https://${setup.domain}`;
    case "proxy":
      return setup.url;
  }
}

/** An app's address: `<app>.<Your Space's address>`. */
export function appAddress(setup: Setup, app: string): string {
  const url = new URL(address(setup));
  url.hostname = `${app}.${url.hostname}`;
  return url.origin;
}

/** The ports a setup publishes on this machine. */
export function setupPorts(setup: Setup): number[] {
  return setup.kind === "domain" ? [80, 443] : [setup.port];
}

export function checkPort(value: string): string | undefined {
  const port = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || port < 1 || port > 65535) return "Write a port number from 1 to 65535, like 8081.";
  return undefined;
}

export interface SetupFlags {
  thisMachine?: boolean;
  port?: string;
}

function valid(check: (value: string) => string | undefined, value: string, flag: string): string {
  const problem = check(value);
  if (problem) throw new CliError("invalid_input", `${flag}: ${problem}`);
  return value.trim();
}

/** The setup from the flags; `current` is the default. Shared by `init` and, later, `configure`. */
export async function chooseSetup(_ui: Ui, flags: SetupFlags, current: Setup): Promise<Setup> {
  const port = flags.port === undefined ? undefined : Number(valid(checkPort, flags.port, "--port"));
  if (port !== undefined) return { kind: "this-machine", port };
  // A setup set by hand in .env is kept; choosing another comes with the domain and proxy slices.
  if (!flags.thisMachine && current.kind !== "this-machine") return current;
  return { kind: "this-machine", port: current.kind === "this-machine" ? current.port : 80 };
}
