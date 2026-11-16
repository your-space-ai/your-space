// Journey 002: install apps from their own Compose files and run them. A stand-in for GitHub serves
// the fixture apps (e2e/github); Sure and Twenty run by hand (verification record).
import { expect, test } from "@playwright/test";
import { compose, docker, resetStack, serverCommand, up } from "./helpers/stack.ts";

test.describe.configure({ mode: "serial" });

const WHOAMI = "https://github.com/ys-fixtures/whoami/blob/main/compose.yaml";

async function inspect(container: string, format: string): Promise<string> {
  return (await docker(["inspect", container, "--format", format], false)).stdout.trim();
}

test("install-app installs an app from its link, and list-apps shows it running", async () => {
  await resetStack();
  const installed = await serverCommand("install-app", [WHOAMI]);
  expect(installed.code, installed.stderr).toBe(0);
  expect(installed.json).toMatchObject({ ok: true, name: "whoami", state: "running" });
  expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("true");

  const listed = await serverCommand("list-apps");
  expect(listed.code, listed.stderr).toBe(0);
  expect(listed.json.apps).toEqual([expect.objectContaining({ name: "whoami", state: "running", repo: "ys-fixtures/whoami" })]);

  // The container publishes no port of its own (FR-015).
  expect(await inspect("ys-whoami-web-1", "{{json .HostConfig.PortBindings}}")).toBe("{}");
});

test("restarting Your Space leaves apps running; stopping it stops them, and starting brings them back", async () => {
  const started = await inspect("ys-whoami-web-1", "{{.State.StartedAt}}");
  await compose(["restart", "server", "runtime", "caddy"], { timeout: 120_000 });
  await up();
  expect(await inspect("ys-whoami-web-1", "{{.State.StartedAt}}")).toBe(started);
  await expect(async () => {
    expect((await serverCommand("list-apps")).json.apps).toEqual([expect.objectContaining({ name: "whoami", state: "running" })]);
  }).toPass({ timeout: 30_000 });

  // The documented stop: the runtime manager stops the apps, then Compose stops Your Space.
  await compose(["exec", "-T", "runtime", "stop-apps"]);
  expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("false");
  await compose(["stop"], { timeout: 120_000 });
  await up();
  await expect(async () => {
    expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("true");
  }).toPass({ timeout: 60_000 });
});
