// How the space is reached: this machine, your own domain, or your own proxy or tunnel. The setup
// is the `.env` lines journey 001 defined (YS_DOMAIN, YS_PROXY_URL, YS_PORT), nothing else.
import { randomBytes } from "node:crypto";
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

/** A name under the domain that only a wildcard record answers, to check apps' names resolve. */
export function wildcardProbe(domain: string): string {
  return `ys-check-${randomBytes(4).toString("hex")}.${domain}`;
}

// The same rules as the server's settings check (server/src/config.ts), so a wrong answer is caught
// before anything starts. The server checks again when it starts.
const NOT_PUBLIC = [
  { suffix: "localhost", hint: "for this machine, choose \"This machine\"" },
  { suffix: "ts.net", hint: "for Tailscale, choose \"Your own proxy or tunnel\"" },
  ...["local", "internal", "home.arpa", "test", "invalid"].map((suffix) => ({ suffix, hint: "use a domain whose DNS points at this server" })),
];
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function checkDomain(value: string): string | undefined {
  const name = value.trim().toLowerCase();
  if (/^[a-z]+:\/\//.test(name) || name.includes("/") || name.includes(":")) {
    return "Write just the name, like space.example.com, without \"https://\", a port, or a path.";
  }
  const reserved = NOT_PUBLIC.find(({ suffix }) => name === suffix || name.endsWith(`.${suffix}`));
  if (reserved) return `"${name}" can't get a public certificate: ${reserved.hint}.`;
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)) || name.length > 253) {
    return `"${value}" isn't a domain name. Write one like space.example.com.`;
  }
  if (/^\d+$/.test(labels.at(-1)!)) return "Write a domain name, not an IP address. Certificates are only issued for names.";
  return undefined;
}

export function checkProxyUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "That isn't a valid address. Write the HTTPS address your proxy serves, like https://space.example.com.";
  }
  if (url.protocol !== "https:") return "The address must start with https://. Your proxy or tunnel provides the HTTPS.";
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    return "Write just the address, with no path, query, or credentials.";
  }
  if (value.trim() !== url.origin) return `Write it exactly as ${url.origin}, in lower case, with no trailing slash or default port.`;
  return undefined;
}

export function checkPort(value: string): string | undefined {
  const port = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || port < 1 || port > 65535) return "Write a port number from 1 to 65535, like 8081.";
  return undefined;
}

export interface SetupFlags {
  thisMachine?: boolean;
  domain?: string;
  proxyUrl?: string;
  port?: string;
}

function valid(check: (value: string) => string | undefined, value: string, flag: string): string {
  const problem = check(value);
  if (problem) throw new CliError("invalid_input", `${flag}: ${problem}`);
  return value.trim();
}

/** The setup from the flags, or by asking; `current` is the default. Shared by `init` and `configure`. */
export async function chooseSetup(ui: Ui, flags: SetupFlags, current: Setup): Promise<Setup> {
  const chosen = [flags.thisMachine, flags.domain !== undefined, flags.proxyUrl !== undefined].filter(Boolean).length;
  if (chosen > 1) throw new CliError("usage", "Choose one of --this-machine, --domain and --proxy-url.");
  const port = flags.port === undefined ? undefined : Number(valid(checkPort, flags.port, "--port"));

  let kind: SetupKind;
  if (flags.thisMachine) kind = "this-machine";
  else if (flags.domain !== undefined) kind = "domain";
  else if (flags.proxyUrl !== undefined) kind = "proxy";
  else if (port !== undefined) kind = current.kind;
  else {
    kind = await ui.select<SetupKind>({
      message: "How will you reach Your Space?",
      flag: "--this-machine, --domain <name> or --proxy-url <url>",
      initial: current.kind,
      options: [
        { value: "this-machine", label: "This machine", hint: "http://space.localhost, nothing opens to the network" },
        { value: "domain", label: "Your own domain", hint: "HTTPS from Let's Encrypt; needs DNS and ports 80 and 443" },
        { value: "proxy", label: "Your own proxy or tunnel", hint: "it provides HTTPS, such as nginx or Tailscale" },
      ],
    });
  }

  switch (kind) {
    case "this-machine":
      if (port !== undefined) return { kind, port };
      return { kind, port: current.kind === "this-machine" ? current.port : 80 };
    case "domain": {
      if (port !== undefined) throw new CliError("usage", "--port doesn't apply to your own domain, which needs ports 80 and 443.");
      const domain =
        flags.domain !== undefined
          ? valid(checkDomain, flags.domain, "--domain")
          : await ui.text({
              message: "Your domain, whose DNS points at this server:",
              flag: "--domain <name>",
              placeholder: "space.example.com",
              initial: current.kind === "domain" ? current.domain : undefined,
              validate: checkDomain,
            });
      return { kind, domain: domain.toLowerCase() };
    }
    case "proxy": {
      // --port alone moves only the port, so it keeps the current address without asking.
      const url =
        flags.proxyUrl !== undefined
          ? valid(checkProxyUrl, flags.proxyUrl, "--proxy-url")
          : port !== undefined && current.kind === "proxy"
            ? current.url
            : await ui.text({
                message: "The HTTPS address your proxy or tunnel serves:",
                flag: "--proxy-url <url>",
                placeholder: "https://space.example.com",
                initial: current.kind === "proxy" ? current.url : undefined,
                validate: checkProxyUrl,
              });
      return { kind, url, port: port ?? (current.kind === "proxy" ? current.port : 8080) };
    }
  }
}
