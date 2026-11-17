// Steps more than one command takes: opening the installation and its engine, checking ports and a
// domain, starting Compose and reading what went wrong, and gathering the summary.
import { certificateProblem, checkNames, freePort, portAnswers, portUser, readCertificate, type Certificate } from "../checks.ts";
import { Compose, otherInstallation } from "../compose.ts";
import { checkEngine, engineSocket, type Engine } from "../engine.ts";
import { CliError } from "../errors.ts";
import { Installation } from "../installation.ts";
import { listApps, showOwner, type App, type Owner } from "../server.ts";
import { setupPorts, wildcardProbe, type Setup } from "../setup.ts";
import { buildSummary, summaryText, type Link, type Summary } from "../summary.ts";
import type { Ui } from "../ui.ts";

export interface Opened {
  installation: Installation;
  compose: Compose;
  engine: Engine;
}

/** The engine, checked, and refused when it already runs Your Space from another folder. */
export async function engineFor(ui: Ui, installation: Installation): Promise<Engine> {
  const engine = await ui.step("Checking Docker", "Docker is ready", () => checkEngine());
  const other = await otherInstallation(installation.project(), installation.folder);
  if (other) {
    throw new CliError(
      "another_installation",
      `This Docker engine already runs Your Space from ${other}. There is one installation per engine; manage that one with --workdir ${other}.`,
      { folder: other },
    );
  }
  return engine;
}

/** Writes YS_ENGINE_SOCKET when the engine's socket isn't the default and the person hasn't set it. */
export function rememberSocket(ui: Ui, installation: Installation, engine: Engine): void {
  const socket = engineSocket(engine.endpoint);
  const env = installation.env();
  if (socket && !env.YS_ENGINE_SOCKET) {
    installation.writeEnv({ YS_ENGINE_SOCKET: socket });
    ui.info(`Docker's engine is at ${socket}, so Your Space's runtime manager uses it (YS_ENGINE_SOCKET in .env).`);
  }
}

export async function open(ui: Ui, workdir: string): Promise<Opened> {
  const installation = Installation.open(workdir);
  const engine = await engineFor(ui, installation);
  rememberSocket(ui, installation, engine);
  return { installation, compose: new Compose(installation.folder), engine };
}

/**
 * Checks the ports the setup needs, skipping those Your Space already holds. A taken port for this
 * machine or a proxy is moved with YS_PORT when the person agrees; a domain needs 80 and 443.
 */
export async function checkPorts(ui: Ui, installation: Installation, compose: Compose, setup: Setup): Promise<Setup> {
  const caddy = (await compose.ps()).find((s) => s.name === "caddy" && s.state === "running");
  for (const port of setupPorts(setup)) {
    if (caddy?.ports.includes(port) || !(await portAnswers(port))) continue;
    const by = await portUser(port);
    const taken = `Port ${port} on this machine is already in use${by ? ` by ${by}` : ""}.`;
    if (setup.kind === "domain") {
      throw new CliError(
        "port_in_use",
        `${taken} Your own domain needs ports 80 and 443. Stop what uses it, or put Your Space behind it as your own proxy: your-space configure --proxy-url https://${setup.domain}`,
        { port, ...(by ? { by } : {}) },
      );
    }
    const next = await freePort(port === 80 ? 8081 : port + 1);
    const refuse = () =>
      new CliError("port_in_use", `${taken} Free it, run this again with --yes to use port ${next}, or choose one with: your-space configure --port <n>`, {
        port,
        ...(by ? { by } : {}),
      });
    if (!ui.interactive && !ui.yes) throw refuse();
    if (!(await ui.confirm({ message: `${taken} Use port ${next} instead?`, flag: "--yes", initial: true }))) throw refuse();
    installation.writeEnv({ YS_PORT: String(next) });
    ui.info(`Your Space will use port ${next} (YS_PORT=${next} in .env).`);
    return { ...setup, port: next };
  }
  return setup;
}

/** A domain's names, before Caddy asks for a certificate (research R6). */
export async function checkDomain(ui: Ui, setup: Setup, ignore: boolean): Promise<void> {
  if (setup.kind !== "domain") return;
  const result = await ui.step(`Checking ${setup.domain}`, `Checked ${setup.domain}`, () => checkNames(setup.domain, wildcardProbe(setup.domain)));
  if (result.ok) {
    ui.info(`${setup.domain} and *.${setup.domain} point at ${result.checks[0]!.addresses.join(", ")}. If that is this server, you're set.`);
    return;
  }
  for (const problem of result.problems) ui.warn(problem);
  if (ignore) return;
  // A failed check is passed only by --ignore-checks, or by a person at the terminal; never by --yes.
  const go = ui.interactive && !ui.yes ? await ui.confirm({ message: "Start anyway? The certificate will fail until the names point here.", flag: "--ignore-checks", initial: false }) : false;
  if (!go) {
    throw new CliError("check_failed", `${result.problems.join(" ")} Fix the DNS records, or run with --ignore-checks.`, { checks: result.checks });
  }
}

/** Waits for the domain's certificate, reading Caddy's log for why it fails. */
export async function waitForCertificate(ui: Ui, compose: Compose, setup: Setup, seconds: number): Promise<Certificate | null> {
  if (setup.kind !== "domain") return null;
  const since = new Date(Date.now() - 5000).toISOString();
  return ui.step("Getting the HTTPS certificate", "HTTPS certificate checked", async (update) => {
    const deadline = Date.now() + seconds * 1000;
    let problem: string | undefined;
    while (Date.now() < deadline) {
      const certificate = await readCertificate(setup.domain);
      if (certificate.state === "valid") return certificate;
      problem = certificateProblem((await compose.logs(["--no-log-prefix", "--since", since, "caddy"])).stdout, setup.domain);
      if (problem) update(`Getting the HTTPS certificate (Caddy keeps trying: ${problem})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    return problem ? { state: "failed", message: problem } : { state: "waiting" };
  });
}

/** `docker compose up -d --wait`, and when it fails, what went wrong in Your Space's terms. */
export async function startStack(ui: Ui, compose: Compose): Promise<void> {
  await ui.step("Starting Your Space (the first start downloads the images)", "Your Space started", async () => {
    const ran = await compose.run(["up", "-d", "--wait"]);
    if (ran.code === 0) return;
    throw await whyNotStarted(compose, `${ran.stdout}${ran.stderr}`);
  });
}

export async function whyNotStarted(compose: Compose, output: string): Promise<CliError> {
  const services = await compose.ps();
  const secrets = services.find((s) => s.name === "secrets");
  if (secrets && secrets.state === "exited" && secrets.exitCode !== 0) {
    const log = (await compose.logs(["--no-log-prefix", "secrets"])).stdout.trim();
    if (/already has a\s+database/.test(log)) {
      return new CliError(
        "lost_secrets",
        "Your Space's secrets are gone, but its database is still there, so it didn't start. Put the old values back in .env as BETTER_AUTH_SECRET and POSTGRES_PASSWORD, or start with new ones: your-space start --new-secrets (everyone is signed out; your data stays, but installed apps' settings can't be read with a new auth secret, so apps must be reinstalled).",
        {},
        log,
      );
    }
    return new CliError("start_failed", `The secrets step failed: ${log.split("\n").at(-1)}`, { service: "secrets" }, log);
  }
  const server = services.find((s) => s.name === "server");
  if (server && server.health !== "healthy") {
    const log = (await compose.logs(["--no-log-prefix", "--tail", "60", "server"])).stdout;
    const config = /Invalid configuration:\n((?:\s+- .*\n?)+)/.exec(log)?.[1];
    if (config) {
      return new CliError("start_failed", `Your Space's settings in .env need fixing:\n${config.trimEnd()}`, { service: "server" }, log);
    }
    if (/refused the database password/.test(log)) {
      return new CliError(
        "start_failed",
        "PostgreSQL refused the database password: it changed after the database was created. Change POSTGRES_PASSWORD in .env back, or run your-space secrets replace database-password.",
        { service: "server" },
        log,
      );
    }
    return new CliError("start_failed", "The server didn't become healthy. See its log with: your-space logs server", { service: "server" }, log);
  }
  if (/address already in use|port is already allocated/i.test(output)) {
    return new CliError("port_in_use", "A port Your Space needs is already in use. Free it, or choose another with: your-space configure --port <n>", {}, output);
  }
  return new CliError("start_failed", "Docker Compose couldn't start Your Space.", {}, output);
}

/** What the summary shows, read from the running space. */
export async function gather(
  installation: Installation,
  compose: Compose,
  engine: Engine | null,
  extra: { link?: Link; certificate?: Certificate | null } = {},
): Promise<Summary> {
  const setup = installation.setup();
  const services = await compose.ps();
  const running = services.some((s) => s.name === "server" && s.state === "running");
  let owner: Owner | null = null;
  let apps: App[] | null = null;
  if (running) {
    owner = await showOwner(compose).catch(() => null);
    apps = await listApps(compose).catch(() => null);
  }
  let certificate = extra.certificate ?? null;
  if (certificate === null && setup.kind === "domain" && running) certificate = await readCertificate(setup.domain);
  return buildSummary({ version: installation.version(), folder: installation.folder, setup, services, engine, owner, link: extra.link, apps, certificate });
}

export function showSummary(ui: Ui, summary: Summary): void {
  ui.result({ ...summary }, () => {
    for (const { title, body } of summaryText(summary)) ui.note(body, title);
    if (summary.certificate?.state === "failed" && summary.certificate.message) ui.warn(summary.certificate.message);
    if (summary.certificate?.state === "waiting") ui.warn("The HTTPS certificate isn't issued yet. Check again with: your-space status");
  });
}
