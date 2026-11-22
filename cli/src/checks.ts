// What the CLI checks before and after starting: ports (research R7), a domain's names and its
// certificate (research R6).
import { lookup as dnsLookup } from "node:dns/promises";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { run } from "./process.ts";

/** True when something answers on the port on this machine. */
export function portAnswers(port: number, host = "127.0.0.1", timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ port, host });
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The container that publishes the port, when it is one. */
export async function portUser(port: number): Promise<string | undefined> {
  const ran = await run("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"]).catch(() => undefined);
  const name = ran?.stdout.trim().split("\n")[0];
  return name ? `the container ${name}` : undefined;
}

/** The first port from `start` that nothing answers on. */
export async function freePort(start = 8081): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (!(await portAnswers(port))) return port;
  }
  return start;
}

export interface NameCheck {
  name: string;
  addresses: string[];
  error?: string;
}

export type Lookup = (name: string) => Promise<string[]>;

const systemLookup: Lookup = async (name) => (await dnsLookup(name, { all: true })).map((a) => a.address);

/**
 * Resolves the domain and a name under it that only a wildcard record answers. Both must resolve,
 * to the same addresses, since Caddy serves Your Space and its apps from one place.
 */
export async function checkNames(domain: string, probe: string, lookup: Lookup = systemLookup): Promise<{ ok: boolean; checks: NameCheck[]; problems: string[] }> {
  const checks = await Promise.all(
    [domain, probe].map(async (name): Promise<NameCheck> => {
      try {
        return { name, addresses: (await lookup(name)).sort() };
      } catch (error) {
        return { name, addresses: [], error: (error as NodeJS.ErrnoException).code ?? String(error) };
      }
    }),
  );
  const [own, wildcard] = checks as [NameCheck, NameCheck];
  const problems: string[] = [];
  if (own.addresses.length === 0) problems.push(`${domain} doesn't resolve. Add an A (or AAAA) record for it that points at this server.`);
  if (wildcard.addresses.length === 0) {
    problems.push(`*.${domain} doesn't resolve, so apps' names won't either. Add a wildcard record, *.${domain}, that points at this server too.`);
  } else if (own.addresses.length && own.addresses.join() !== wildcard.addresses.join()) {
    problems.push(`${domain} (${own.addresses.join(", ")}) and *.${domain} (${wildcard.addresses.join(", ")}) point at different addresses. Point both at this server.`);
  }
  return { ok: problems.length === 0, checks, problems };
}

export interface Certificate {
  state: "valid" | "waiting" | "failed";
  issuer?: string;
  message?: string;
}

/** The certificate Caddy presents for the domain, read on this machine whatever the DNS does. */
export function readCertificate(domain: string, port = 443, timeout = 3000): Promise<Certificate> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host: "127.0.0.1", port, servername: domain });
    const done = (certificate: Certificate) => {
      socket.destroy();
      resolve(certificate);
    };
    socket.setTimeout(timeout, () => done({ state: "waiting" }));
    socket.once("error", () => done({ state: "waiting" }));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const names = (cert.subjectaltname ?? "").split(", ").map((n) => n.replace(/^DNS:/, ""));
      const issuer = [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(", ");
      // Caddy's own authority signs a temporary certificate only for local names.
      if (!names.includes(domain) || /Caddy Local Authority/.test(issuer)) done({ state: "waiting", issuer });
      else done({ state: "valid", issuer });
    });
  });
}

interface CaddyLine {
  level?: string;
  msg?: string;
  identifier?: string;
  error?: string;
}

/** Caddy's latest failed attempt to get the domain's certificate, in plain words, if any. */
export function certificateProblem(logs: string, domain: string): string | undefined {
  let latest: string | undefined;
  for (const line of logs.split("\n")) {
    if (!line.startsWith("{")) continue;
    let entry: CaddyLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.msg === "certificate obtained successfully" && entry.identifier === domain) latest = undefined;
    const failed = entry.level === "error" && /could not get certificate|job failed|obtain/i.test(entry.msg ?? "");
    if (failed && (entry.identifier === domain || (entry.error ?? "").includes(domain))) latest = entry.error ?? entry.msg;
  }
  return latest === undefined ? undefined : explain(latest);
}

export function explain(error: string): string {
  if (/rateLimited|too many/i.test(error)) {
    return "Let's Encrypt's rate limit was reached for this domain. Wait an hour or more, then run `your-space start` again.";
  }
  if (/:dns|NXDOMAIN|no valid A|DNS problem|SERVFAIL/i.test(error)) {
    return "Let's Encrypt couldn't find this server through the domain's DNS. Check that the domain and *.domain point at this server's public address.";
  }
  if (/caa/i.test(error)) return "The domain's CAA record doesn't allow Let's Encrypt. Add letsencrypt.org to it, or remove it.";
  if (/connection|timeout|firewall|refused|unreachable/i.test(error)) {
    return "Let's Encrypt couldn't reach this server on ports 80 and 443. Open them in the firewall (and forward them on your router if this server is at home), then run `your-space start` again.";
  }
  return `Caddy couldn't get a certificate: ${error}`;
}
