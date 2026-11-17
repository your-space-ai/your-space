// Journey 003: the your-space CLI installs, runs and recovers Your Space from a release, in its own
// folder, with nothing but Docker (spec User Stories 1 to 6; contracts/cli-commands.md). The CLI
// doesn't use a browser except to sign in, so these run once, in Chromium.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cliIn, newFolder, removeInstallation, root, serveRelease, tagImages, type Cli, CLI_VERSION } from "./helpers/cli.ts";
import { evidence } from "./helpers/evidence.ts";
import { compose as e2eCompose, docker, removeApps } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.skip(({ browserName }) => browserName !== "chromium", "The CLI doesn't depend on the browser; run it once.");
test.describe.configure({ mode: "serial", timeout: 300_000 });

const WHOAMI = "https://github.com/ys-fixtures/whoami/blob/main/compose.yaml";

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

test("a taken port is moved only with consent", async () => {
  expect((await cli.compose(["stop"])).code).toBe(0);
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

});

