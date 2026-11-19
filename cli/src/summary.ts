// The summary `start` and `status` print (contracts/cli-commands.md, "The summary"): what is running
// and how to reach it, like the Supabase CLI's table after `supabase start`.
import type { Certificate } from "./checks.ts";
import type { ServiceState } from "./compose.ts";
import type { Engine } from "./engine.ts";
import type { App, Owner } from "./server.ts";
import { address, appAddress, type Setup } from "./setup.ts";

export interface Link {
  url: string;
  expiresAt: string;
}

export interface Forward {
  to: string;
  network: string;
  names: string[];
  wildcard: string;
}

export interface Summary {
  version: string | null;
  folder: string;
  setup: { kind: Setup["kind"]; address: string; port?: number };
  running: boolean;
  services: { name: string; state: string; health: string }[];
  engine: Pick<Engine, "version" | "os" | "arch" | "endpoint"> | null;
  owner: Owner | null;
  link?: Link;
  apps: (App & { address: string })[] | null;
  forward: Forward | null;
  certificate: Certificate | null;
}

/** Where a proxy or tunnel sends Your Space's names (research R11). */
export function forwardFor(setup: Setup, apps: string[]): Forward | null {
  if (setup.kind !== "proxy") return null;
  const host = new URL(setup.url).host;
  return {
    to: `http://127.0.0.1:${setup.port}`,
    network: "your-space_edge",
    names: [host, ...apps.map((app) => `${app}.${host}`)],
    wildcard: `*.${host}`,
  };
}

export function buildSummary(parts: {
  version: string | null;
  folder: string;
  setup: Setup;
  services: ServiceState[];
  engine: Engine | null;
  owner: Owner | null;
  link?: Link;
  apps: App[] | null;
  certificate: Certificate | null;
}): Summary {
  const { setup } = parts;
  const running = parts.services.some((s) => s.name === "server" && s.state === "running");
  return {
    version: parts.version,
    folder: parts.folder,
    setup: { kind: setup.kind, address: address(setup), ...(setup.kind === "domain" ? {} : { port: setup.port }) },
    running,
    services: parts.services.map(({ name, state, health }) => ({ name, state, health })),
    engine: parts.engine && { version: parts.engine.version, os: parts.engine.os, arch: parts.engine.arch, endpoint: parts.engine.endpoint },
    owner: parts.owner,
    ...(parts.link ? { link: parts.link } : {}),
    apps: parts.apps && parts.apps.map((app) => ({ ...app, address: app.publish?.link ?? appAddress(setup, app.name) })),
    // An app with its own link is reached there, through its published port, not at a name under Your Space's.
    forward: forwardFor(setup, (parts.apps ?? []).filter((a) => !a.publish?.link).map((a) => a.name)),
    certificate: parts.certificate,
  };
}

const SETUP_TEXT = { "this-machine": "This machine only", domain: "Your own domain", proxy: "Your own proxy or tunnel" };

function rows(pairs: [string, string][]): string {
  const width = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n");
}

/** The summary as text for a person, in sections. */
export function summaryText(summary: Summary): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  const space: [string, string][] = [
    ["Address", summary.setup.address],
    ["Setup", SETUP_TEXT[summary.setup.kind]],
    ["Version", summary.version ?? "unknown"],
    ["Folder", summary.folder],
  ];
  if (summary.owner) space.push(["Owner", `${summary.owner.name} (${summary.owner.username})`]);
  if (summary.certificate) {
    const text = { valid: `valid, from ${summary.certificate.issuer}`, waiting: "not issued yet", failed: "failed" }[summary.certificate.state];
    space.push(["Certificate", text]);
  }
  sections.push({ title: summary.running ? "Your Space is running" : "Your Space is stopped", body: rows(space) });

  if (summary.link) {
    sections.push({
      title: "Set your password",
      body: `Open this link within 30 minutes; it works once:\n${summary.link.url}\nThen sign in at ${summary.setup.address}.`,
    });
  } else if (summary.running && summary.owner) {
    sections.push({ title: "Sign in", body: `${summary.setup.address}\nLost your password or the link? Run: your-space owner reset-link` });
  }

  if (summary.services.length) {
    sections.push({
      title: "Services",
      body: rows(summary.services.filter((s) => s.name !== "secrets").map((s) => [s.name, s.health ? `${s.state} (${s.health})` : s.state])),
    });
  }
  if (summary.apps?.length) sections.push({ title: "Apps", body: rows(summary.apps.map((a) => [a.name, `${a.state}  ${a.address}`])) });
  const published = (summary.apps ?? []).filter((a) => a.publish);
  if (published.length) {
    sections.push({
      title: "Published on this machine",
      body: [
        rows(published.map((a) => [a.name, `http://${a.publish!.bind.includes(":") ? `[${a.publish!.bind}]` : a.publish!.bind}:${a.publish!.port}`])),
        "Your proxy or tunnel sends each app's link to its port.",
      ].join("\n"),
    });
  }
  if (summary.forward) {
    const f = summary.forward;
    sections.push({
      title: "Your proxy or tunnel forwards",
      body: [
        `${f.names.join("\n")}`,
        `(or ${f.wildcard} for every app)`,
        `to ${f.to}, or to http://your-space:8080 on the ${f.network} network for a proxy in a container.`,
        "It must pass the original host name.",
      ].join("\n"),
    });
  }
  if (summary.engine) {
    sections.push({ title: "Engine", body: rows([["Docker", `${summary.engine.version} (${summary.engine.os}, ${summary.engine.arch})`], ["Endpoint", summary.engine.endpoint]]) });
  }
  return sections;
}
