// Journey 003: the your-space CLI installs, runs and recovers Your Space from a release, in its own
// folder, with nothing but Docker (spec User Stories 1 to 6; contracts/cli-commands.md). The CLI
// doesn't use a browser except to sign in, so these run once, in Chromium.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cliIn, githubStandIn, newFolder, removeInstallation, root, serveRelease, tagImages, type Cli, CLI_VERSION } from "./helpers/cli.ts";
import { evidence } from "./helpers/evidence.ts";
import { compose as e2eCompose, docker, removeApps } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.skip(({ browserName }) => browserName !== "chromium", "The CLI doesn't depend on the browser; run it once.");
test.describe.configure({ mode: "serial", timeout: 300_000 });

const WHOAMI = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/whoami.yaml";

let release: { url: string; close(): Promise<void> };
let cli: Cli;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  // The other journeys' stack holds port 80; this one is the CLI's own installation.
  await removeApps();
  await e2eCompose(["down", "--remove-orphans"], { timeout: 120_000 });
  await removeInstallation();
  await tagImages();
  release = await serveRelease();
  const folder = newFolder("main");
  cli = cliIn(folder, { YS_E2E_RELEASES: release.url });
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  if (cli) await removeInstallation(cli);
  await release?.close();
});

const ok = (result: { code: number; stdout: string; stderr: string; json: any }) => {
  expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.json?.ok).toBe(true);
  return result.json;
};

test("init and start install Your Space on this machine, and the owner signs in", async ({ page }, testInfo) => {
  const init = ok(await cli.run(["init", "--yes", "--json"]));
  expect(init).toMatchObject({ version: CLI_VERSION, setup: { kind: "this-machine" }, env: [] });
  for (const file of ["compose.yaml", "stack.yaml", "modes/mode.yaml", "env.example", ".env"]) expect(existsSync(join(cli.folder, file))).toBe(true);
  // The release's own files, unchanged, and a .env with no settings line, as the manual install has.
  expect(readFileSync(join(cli.folder, "stack.yaml"), "utf8")).toContain(`your-space-server:\${YS_VERSION:-${CLI_VERSION}}`);
  expect(readFileSync(join(cli.folder, ".env"), "utf8")).toBe(readFileSync(join(cli.folder, "env.example"), "utf8"));

  // A question with no answer and no terminal fails, naming its flag.
  const unanswered = await cli.run(["start", "--json", "--no-open"]);
  expect(unanswered.code).toBe(1);
  expect(unanswered.json).toMatchObject({ ok: false, error: "usage" });
  expect(unanswered.json.message).toContain("--owner-name");

  const started = ok(await cli.run(["start", "--owner-name", "Sam Rivera", "--owner-username", "sam", "--no-open", "--json"]));
  expect(started).toMatchObject({
    running: true,
    setup: { kind: "this-machine", address: "http://space.localhost", port: 80 },
    owner: { username: "sam", name: "Sam Rivera" },
    apps: [],
    forward: null,
  });
  expect(started.link.url).toMatch(/^http:\/\/space\.localhost\/reset-password#token=/);
  expect(started.services.filter((s: any) => s.health === "healthy").map((s: any) => s.name).sort()).toEqual(["postgres", "server"]);

  await setPassword(page, started.link.url);
  await signIn(page, "sam");
  await expect(page.getByRole("main")).toContainText("Sam Rivera");
  await evidence(page, testInfo, "003-us1-signed-in-after-cli");

  // init again doesn't overwrite anything.
  const again = await cli.run(["init", "--yes", "--json"]);
  expect(again.code).toBe(2);
  expect(again.json.error).toBe("already_initialised");
});

test("status, stop and start keep apps, and logs show Your Space's output", async () => {
  // The GitHub stand-in, beside the release's files, so an app can be installed.
  cli.env.COMPOSE_FILE = githubStandIn(cli.folder);
  ok(await cli.run(["start", "--no-open", "--json"]));
  const installed = await cli.compose(["exec", "-T", "server", "install-app", WHOAMI, "--json"]);
  expect(installed.code, installed.stdout + installed.stderr).toBe(0);

  await expect(async () => {
    const status = ok(await cli.run(["status", "--json"]));
    expect(status.apps).toEqual([{ name: "whoami", state: "running", address: "http://whoami.space.localhost" }]);
  }).toPass({ timeout: 120_000 });
  const human = await cli.run(["status"]);
  expect(human.stdout).toContain("Your Space is running");
  expect(human.stdout).toContain("http://whoami.space.localhost");

  const stopped = ok(await cli.run(["stop", "--json"]));
  expect(stopped.stopped).toEqual(["whoami"]);
  expect((await docker(["ps", "-q", "--filter", "label=ai.your-space.installation=your-space"])).stdout.trim()).toBe("");
  const down = ok(await cli.run(["status", "--json"]));
  expect(down).toMatchObject({ running: false, apps: null });
  expect(ok(await cli.run(["stop", "--json"])).stopped).toEqual([]);

  const restarted = ok(await cli.run(["start", "--no-open", "--json"]));
  expect(restarted.link).toBeUndefined();
  await expect(async () => {
    expect(ok(await cli.run(["status", "--json"])).apps[0].state).toBe("running");
  }).toPass({ timeout: 120_000 });

  const logs = await cli.run(["logs", "server", "--tail", "20"]);
  expect(logs.code).toBe(0);
  expect(logs.stdout).toContain("server.listening");
});

test("a taken port is moved only with consent, and configure changes the setup", async () => {
  ok(await cli.run(["stop", "--json"]));
  // Another container holds port 80, as another program would. CI doesn't run as root, so the test
  // can't listen on port 80 itself; Docker can.
  await docker(["rm", "-f", "ys-e2e-port-80"]);
  await docker(
    ["run", "-d", "--name", "ys-e2e-port-80", "-p", "127.0.0.1:80:8080", "node:26-slim", "node", "-e", "require('net').createServer((s) => s.end()).listen(8080)"],
    false,
  );
  try {
    const taken = await cli.run(["start", "--no-open", "--json"]);
    expect(taken.code).toBe(2);
    expect(taken.json).toMatchObject({ error: "port_in_use", port: 80, by: "the container ys-e2e-port-80" });
    const moved = ok(await cli.run(["start", "--no-open", "--yes", "--json"]));
    expect(moved.setup).toEqual({ kind: "this-machine", address: "http://space.localhost:8081", port: 8081 });
    expect(readFileSync(join(cli.folder, ".env"), "utf8")).toMatch(/^YS_PORT=8081$/m);
  } finally {
    await docker(["rm", "-f", "ys-e2e-port-80"]);
  }

  const proxied = ok(await cli.run(["configure", "--proxy-url", "https://box.example.com", "--json"]));
  // The proxy setup has its own default port, 8080, so the moved port 8081 doesn't carry over.
  expect(proxied.env).toEqual(["YS_PROXY_URL=https://box.example.com"]);
  expect(proxied.summary.forward).toEqual({
    to: "http://127.0.0.1:8080",
    network: "your-space_edge",
    names: ["box.example.com", "whoami.box.example.com"],
    wildcard: "*.box.example.com",
  });
  const human = await cli.run(["status"]);
  expect(human.stdout).toContain("whoami.box.example.com");

  const wrong = await cli.run(["configure", "--domain", "space.localhost", "--json"]);
  expect(wrong.code).toBe(1);
  expect(wrong.json.error).toBe("invalid_input");

  const back = ok(await cli.run(["configure", "--this-machine", "--port", "80", "--json"]));
  expect(back.summary.setup).toEqual({ kind: "this-machine", address: "http://space.localhost", port: 80 });
  expect(readFileSync(join(cli.folder, ".env"), "utf8")).not.toMatch(/^YS_(PORT|PROXY_URL)=/m);
});

test("another Docker context's socket reaches the runtime manager, and a remote engine is refused", async () => {
  // The engine's own socket under its other name (/var/run is /run on Linux), so the context differs
  // from the default without a symlink, which an engine with a private /tmp can't follow.
  const socket = "/run/docker.sock";
  await docker(["context", "rm", "-f", "ys-e2e"]);
  await docker(["context", "create", "ys-e2e", "--docker", `host=unix://${socket}`], false);
  try {
    const run = await cli.run(["start", "--no-open", "--json"], { env: { DOCKER_CONTEXT: "ys-e2e" } });
    if (run.code !== 0) {
      // What the stack looked like, for the report.
      const ps = await cli.compose(["ps", "--all"]);
      const runtime = await cli.compose(["logs", "--tail", "40", "runtime", "server"]);
      console.log(`${JSON.stringify(run.json)}\n${ps.stdout}${ps.stderr}\n${runtime.stdout}${runtime.stderr}`);
    }
    const started = ok(run);
    expect(started.engine.endpoint).toBe(`unix://${socket}`);
    expect(readFileSync(join(cli.folder, ".env"), "utf8")).toMatch(new RegExp(`^YS_ENGINE_SOCKET=${socket}$`, "m"));
    await expect(async () => {
      expect(ok(await cli.run(["status", "--json"], { env: { DOCKER_CONTEXT: "ys-e2e" } })).apps[0].state).toBe("running");
    }).toPass({ timeout: 120_000 });
  } finally {
    await docker(["context", "rm", "-f", "ys-e2e"]);
  }
  const remote = await cli.run(["status", "--json"], { env: { DOCKER_HOST: "tcp://10.255.255.1:2375" } });
  expect(remote.code).toBe(2);
  expect(remote.json.error).toBe("engine_unsupported");
  writeFileSync(join(cli.folder, ".env"), readFileSync(join(cli.folder, ".env"), "utf8").replace(/^YS_ENGINE_SOCKET=.*\n/m, ""));
});

test("a folder installed by hand is managed as it is, and one engine runs one installation", async () => {
  // The guide's manual steps: unpack the release, copy env.example to .env.
  const manual = newFolder("manual");
  const tarball = await fetch(`${release.url}/v${CLI_VERSION}/your-space.tar.gz`);
  writeFileSync(join(manual, "your-space.tar.gz"), Buffer.from(await tarball.arrayBuffer()));
  const hand = cliIn(manual, {});
  execFileSync("tar", ["-xzf", "your-space.tar.gz"], { cwd: manual });
  rmSync(join(manual, "your-space.tar.gz"));
  writeFileSync(join(manual, ".env"), readFileSync(join(manual, "env.example"), "utf8"));

  // While the CLI's installation runs, the same engine refuses a second one.
  const second = await hand.run(["start", "--no-open", "--json"]);
  expect(second.code).toBe(2);
  expect(second.json).toMatchObject({ error: "another_installation", folder: cli.folder });

  // The project and its volumes are named your-space in both, so the manual folder picks up the data.
  await cli.compose(["down"]);
  const adopted = ok(await hand.run(["start", "--no-open", "--json"]));
  expect(adopted).toMatchObject({ running: true, folder: manual, owner: { username: "sam" } });
  ok(await hand.run(["stop", "--json"]));
  await hand.compose(["down"]);
  rmSync(manual, { recursive: true, force: true });
  ok(await cli.run(["start", "--no-open", "--json"]));
});

test("owner recovery and secrets go through the server's own commands", async () => {
  const link = ok(await cli.run(["owner", "reset-link", "--json"]));
  expect(link).toMatchObject({ username: "sam", url: expect.stringContaining("/reset-password#token=") });
  const exists = await cli.run(["owner", "create", "--name", "Other", "--username", "other", "--json"]);
  expect(exists.code).toBe(2);
  expect(exists.json.error).toBe("owner_exists");

  const shown = ok(await cli.run(["secrets", "show", "--json"]));
  expect(shown.secrets).toEqual([
    { name: "BETTER_AUTH_SECRET", source: "generated" },
    { name: "POSTGRES_PASSWORD", source: "generated" },
    { name: "YS_DATA_KEY", source: "generated" },
  ]);
  const revealed = ok(await cli.run(["secrets", "show", "--reveal", "--json"]));
  expect(revealed.secrets[0].value.length).toBeGreaterThan(30);

  // The app's generated secret, as its container gets it from Your Space's encrypted settings.
  const appToken = async () =>
    (await docker(["inspect", "ys-whoami-web-1", "--format", "{{range .Config.Env}}{{println .}}{{end}}"], false)).stdout
      .split("\n")
      .find((line) => line.startsWith("API_TOKEN="));
  const token = await appToken();
  expect(token).toMatch(/^API_TOKEN=.{20,}$/);

  const unconfirmed = await cli.run(["secrets", "replace", "auth-secret", "--json"]);
  expect(unconfirmed.code).toBe(1);
  ok(await cli.run(["secrets", "replace", "auth-secret", "--yes", "--json"]));
  ok(await cli.run(["secrets", "replace", "database-password", "--yes", "--json"]));
  ok(await cli.run(["secrets", "replace", "data-key", "--yes", "--json"]));
  const after = ok(await cli.run(["secrets", "show", "--reveal", "--json"]));
  for (const i of [0, 1, 2]) expect(after.secrets[i].value).not.toBe(revealed.secrets[i].value);
  // The server reads the database with the new password, so the owner is still there.
  expect(ok(await cli.run(["status", "--json"])).owner).toEqual({ username: "sam", name: "Sam Rivera" });
  // The previous data key is gone once the server re-encrypted with the new one.
  expect((await cli.compose(["exec", "-T", "server", "ls", "/run/ys-secrets/data"])).stdout.trim()).toBe("key");

  // The app's settings survive all three (spec 009): stopping and starting applies them again.
  ok(await cli.run(["stop", "--json"]));
  ok(await cli.run(["start", "--no-open", "--json"]));
  await expect(async () => {
    expect(ok(await cli.run(["status", "--json"])).apps[0].state).toBe("running");
  }).toPass({ timeout: 120_000 });
  expect(await appToken()).toBe(token);

  // A secret set in .env is left to .env.
  writeFileSync(join(cli.folder, ".env"), `${readFileSync(join(cli.folder, ".env"), "utf8")}BETTER_AUTH_SECRET=${after.secrets[0].value}\n`);
  const inEnv = await cli.run(["secrets", "replace", "auth-secret", "--yes", "--json"]);
  expect(inEnv.code).toBe(2);
  expect(inEnv.json.error).toBe("secret_in_env");
  writeFileSync(join(cli.folder, ".env"), readFileSync(join(cli.folder, ".env"), "utf8").replace(/^BETTER_AUTH_SECRET=.*\n/m, ""));
});

test("lost secrets stop the start with what to do, and new ones bring Your Space back with its data", async () => {
  await cli.compose(["down"]);
  await docker(["volume", "rm", "your-space_ys-secrets"], false);
  const lost = await cli.run(["start", "--no-open", "--json"]);
  expect(lost.code).toBe(2);
  expect(lost.json.error).toBe("lost_secrets");
  expect(lost.json.message).toContain("your-space start --new-secrets");
  const recovered = ok(await cli.run(["start", "--no-open", "--new-secrets", "--json"]));
  expect(recovered).toMatchObject({ running: true, owner: { username: "sam" } });

  // Secrets that aren't lost are kept: --new-secrets changes nothing then.
  const kept = ok(await cli.run(["secrets", "show", "--reveal", "--json"]));
  ok(await cli.run(["start", "--no-open", "--new-secrets", "--json"]));
  expect(ok(await cli.run(["secrets", "show", "--reveal", "--json"])).secrets).toEqual(kept.secrets);
});

test("your own domain: the names are checked, and HTTPS comes up with the certificate", async () => {
  await removeInstallation(cli);
  const folder = newFolder("domain");
  setUpPebble(folder);
  const domain = cliIn(folder, { YS_E2E_RELEASES: release.url, COMPOSE_FILE: "compose.yaml:compose.pebble.yaml" });
  try {
    ok(await domain.run(["init", "--domain", "space.example.com", "--yes", "--json"]));
    expect(readFileSync(join(folder, ".env"), "utf8")).toMatch(/^YS_DOMAIN=space\.example\.com$/m);
    // space.example.com is in this machine's hosts file; no wildcard record can be, so the check fails.
    const checked = await domain.run(["start", "--no-open", "--owner-name", "Sam Rivera", "--owner-username", "sam", "--json"]);
    expect(checked.code).toBe(2);
    expect(checked.json.error).toBe("check_failed");
    expect(checked.json.message).toContain("*.space.example.com doesn't resolve");

    // Pebble creates a fresh issuing root at startup. Trust it only in this test's CLI process.
    const pebble = await domain.compose(["up", "-d", "pebble"]);
    expect(pebble.code, pebble.stderr).toBe(0);
    const address = await domain.compose(["port", "pebble", "15000"]);
    expect(address.code, address.stderr).toBe(0);
    const caPath = join(folder, "issuing-root.pem");
    execFileSync("curl", [
      "--fail", "--silent", "--show-error", "--retry", "15", "--retry-connrefused",
      "--cacert", join(root, "e2e/pebble/pebble.minica.pem"),
      "--output", caPath, `https://localhost:${address.stdout.trim().split(":").at(-1)}/roots/0`,
    ]);
    domain.env.NODE_EXTRA_CA_CERTS = caPath;
    const started = ok(await domain.run(["start", "--no-open", "--ignore-checks", "--owner-name", "Sam Rivera", "--owner-username", "sam", "--json"]));
    expect(started.setup).toEqual({ kind: "domain", address: "https://space.example.com" });
    expect(started.certificate).toMatchObject({ state: "valid", issuer: expect.stringContaining("Pebble") });
    expect(started.link.url).toMatch(/^https:\/\/space\.example\.com\/reset-password#token=/);
    expect(await health("space.example.com", readFileSync(caPath))).toBe(200);
  } finally {
    await removeInstallation(domain);
  }
});

/** A test copy of the Caddyfile that asks Pebble, Let's Encrypt's test authority, for certificates. */
function setUpPebble(folder: string): void {
  // Pebble's public test root (e2e/pebble/README.md), so Caddy trusts Pebble's own HTTPS.
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8").replace(
    /^\{$/m,
    "{\n\tacme_ca https://pebble:14000/dir\n\tacme_ca_root /pebble/root.pem",
  );
  if (!caddyfile.includes("acme_ca https://pebble")) throw new Error("The Caddyfile's global options changed; update this test.");
  writeFileSync(join(folder, "Caddyfile.pebble"), caddyfile);
  writeFileSync(
    join(folder, "compose.pebble.yaml"),
    `services:
  pebble:
    image: ghcr.io/letsencrypt/pebble:2.10.3
    ports: ["127.0.0.1::15000"]
    environment:
      # Issue without reaching this machine from outside, and never refuse a nonce at random.
      PEBBLE_VA_ALWAYS_VALID: "1"
      PEBBLE_WFE_NONCEREJECT: "0"
  caddy:
    volumes:
      - ./Caddyfile.pebble:/etc/caddy/Caddyfile:ro
      - ${join(root, "e2e/pebble/pebble.minica.pem")}:/pebble/root.pem:ro
    depends_on:
      pebble:
        condition: service_started
`,
  );
}

/** GET /api/health over HTTPS on this machine, with the domain as the TLS server name. */
function health(name: string, ca: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: 443, path: "/api/health", servername: name, headers: { host: name }, ca }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}
