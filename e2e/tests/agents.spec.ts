// Real owner controls, without credentials in screenshots, traces, or console output.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fixtureCommit } from "../github/commits.mjs";
import { cliIn } from "./helpers/cli.ts";
import { compose, composeWithInput, createOwner, docker, resetStack, serverCommand, sql } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test("an owner issues, rotates and revokes a zero-grant agent's keys", async ({ page, playwright, baseURL }) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, "sam");
  await page.getByRole("link", { name: "Agents", exact: true }).click();

  await page.getByLabel("New agent name").fill("Fixture agent");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText("This agent has no app access.")).toBeVisible();
  await page.getByRole("button", { name: "Issue key" }).click();
  const key = page.getByLabel("New agent key", { exact: true });
  await expect(key).toHaveAttribute("type", "password");
  const original = await key.inputValue();
  await page.getByRole("button", { name: "Dismiss key" }).click();
  await expect(key).toHaveCount(0);

  const client = await playwright.request.newContext({ baseURL });
  const discovery = async (secret: string) =>
    (
      await client.get("/api/agent/actions", {
        headers: { Authorization: "Bearer " + secret },
      })
    ).status();
  try {
    expect(await discovery(original)).toBe(200);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(key).toHaveAttribute("type", "password");
    const replacement = await key.inputValue();
    expect(await discovery(original)).toBe(401);
    expect(await discovery(replacement)).toBe(200);
    await page.getByRole("button", { name: "Dismiss key" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText("Key revoked.", { exact: true })).toBeVisible();
    expect(await discovery(replacement)).toBe(401);

    await page.getByText("Identity settings", { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Disable agent", exact: true }).click();
    await expect(page.getByText("This agent is disabled. Its keys cannot be used.")).toBeVisible();
  } finally {
    await client.dispose();
  }
});

test("kit grants and exact approvals route real calls to the installed app", async ({
  page,
  baseURL,
}) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, "sam");
  const installed = await serverCommand("install-app", [
    "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/records.yaml",
  ]);
  expect(installed.json?.ok, installed.json?.error).toBe(true);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByLabel("New agent name").fill("Records agent");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.getByRole("button", { name: "Issue key" }).click();
  const key = await page.getByLabel("New agent key", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Dismiss key" }).click();

  const app = page.getByRole("region", { name: "App connections" });
  await app.locator("summary").click();
  await app.getByLabel("App credential", { exact: true }).fill("local-fixture-key");
  await app.getByRole("checkbox", { name: /Manager/ }).check();
  await app.getByRole("checkbox", { name: /Reader/ }).check();
  await app.getByRole("button", { name: "Save connection" }).click();
  await expect(app.locator("summary")).toContainText("Credential saved");
  const settings = page.getByRole("region", { name: "Manage agents" });
  const access = settings.locator("details").filter({ has: page.locator("summary", { hasText: /records/i }) });
  await access.locator("summary").click();
  await access.getByRole("checkbox", { name: /Manager/ }).check();
  await access.getByRole("checkbox", { name: /Reader/ }).check();
  await access.getByLabel("Approval for create").selectOption("allow");
  await access.getByLabel("Approval for edit").selectOption("ask");
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access.locator("summary")).toContainText("Manager");

  const cli = cliIn(process.cwd(), { YOUR_SPACE_URL: baseURL!, YOUR_SPACE_AGENT_KEY: key });
  const run = async (args: string[], input?: unknown) => {
    const outcome = await cli.run(["--json", "agent", ...args], { input: JSON.stringify(input) });
    expect(outcome.code).toBe(0);
    return outcome.json;
  };
  const discovered = await run(["actions"]);
  expect(discovered.actions.map((a: { actionId: string }) => a.actionId).sort()).toEqual([
    "create",
    "edit",
    "list",
  ]);
  const installationId = discovered.actions[0].installationId;
  const invoke = async (actionId: string, input: unknown, operationId?: string, expectedRevision?: string) => {
    const args = ["invoke", installationId, actionId, "--input-stdin"];
    if (operationId) args.push("--operation-id", operationId);
    if (expectedRevision) args.push("--expected-revision", expectedRevision);
    return run(args, input);
  };
  const created = await invoke("create", { body: { title: "Original" } }, "fixture-create");
  expect(created.status).toBe("succeeded");
  const id = created.result.id;
  expect(created.result).toEqual({ id, revision: 1, title: "Original" });
  expect(await invoke("create", { body: { title: "Original" } }, "fixture-create")).toEqual(created);
  const edit = await invoke("edit", { path: { id }, body: { title: "Changed" } }, "fixture-edit", '"1"');
  expect(edit.status).toBe("pending");
  expect((await invoke("list", {})).result).toEqual([created.result]);
  const pending = page.getByRole("region", { name: "Pending approvals" });
  await pending.locator("summary").click();
  await expect(pending.locator("pre")).toContainText("Changed");
  await pending.getByRole("button", { name: "Approve once" }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await run(["request", edit.id])).result).toEqual({ id, revision: 2, title: "Changed" });
  expect((await invoke("list", {})).result).toEqual([{ id, revision: 2, title: "Changed" }]);

  const staleEdit = await invoke("edit", { path: { id }, body: { title: "Stale change" } }, "fixture-stale", '"1"');
  expect(staleEdit.status).toBe("pending");
  await pending.locator("summary").click();
  await pending.getByRole("button", { name: "Approve once" }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await run(["request", staleEdit.id])).status).toBe("conflict");
  expect((await invoke("list", {})).result).toEqual([{ id, revision: 2, title: "Changed" }]);

  await access.locator("summary").click();
  await access.getByRole("checkbox", { name: /Ask for all writes/ }).check();
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access).not.toHaveAttribute("open", "");
  const held = await invoke("create", { body: { title: "Not applied" } }, "fixture-deny");
  expect(held.status).toBe("pending");
  await pending.locator("summary").click();
  await pending.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await invoke("list", {})).result).toEqual([{ id, revision: 2, title: "Changed" }]);
});

test("upgrading a running installation keeps its app ID and volume and installs a usable agent interface", async () => {
  await resetStack();
  await createOwner();
  // A kit file on this machine names the app's Compose file on GitHub.
  const legacy = { kit: 1, source: { repo: "ys-fixtures/records", path: "compose.yaml", commit: fixtureCommit("ys-fixtures/records") }, name: "records", interface: { service: "app", port: 8080 } };
  await composeWithInput(["exec", "-T", "server", "install-app", "--kit", "-", "--json"], JSON.stringify(legacy));
  const operator = ["exec", "-T", "server", "upgrade-agent-kit", "records", "--json"];
  const inspect = async () => JSON.parse((await compose([...operator, "--inspect"])).stdout);
  const before = await inspect();
  expect(before.kitVersion).toBe(1);
  const appService = "ys-records-app-1";
  await docker(["exec", appService, "node", "-e", "require('node:fs').writeFileSync('/records/example', 'existing app data')"], false);
  const volume = async () => (await docker(["inspect", appService, "--format", '{{range .Mounts}}{{if eq .Destination "/records"}}{{.Name}}{{end}}{{end}}'], false)).stdout.trim();
  const originalVolume = await volume();
  expect(originalVolume).toBeTruthy();

  const kit = readFileSync(new URL("../github/fixtures/ys-fixtures/catalog/apps/ys-fixtures/records.yaml", import.meta.url), "utf8");
  const applied = await composeWithInput([...operator, "--kit", "-", "--expect-installation", before.installation, "--expect-kit", before.kitSource], kit);
  expect(JSON.parse(applied.stdout)).toMatchObject({ ok: true, appId: before.appId, kitVersion: 2, runtime: "refreshed" });
  const after = await inspect();
  expect(after.appId).toBe(before.appId);
  expect(after.kitSource).not.toBe(before.kitSource);
  expect(await volume()).toEqual(originalVolume);
  const content = await docker(["exec", appService, "node", "-p", "require('node:fs').readFileSync('/records/example', 'utf8')"], false);
  expect(content.stdout.trim()).toBe("existing app data");
  expect(await sql("select (select count(*) from agent_binding), (select count(*) from agent_grant)")).toEqual(["0\t0"]);
  const lookup = await compose(["exec", "-T", "server", "node", "--input-type=module", "-e",
    "import {installedInterface} from './src/apps/runtime-client.ts'; const {address} = await installedInterface('ys-records', process.argv[1], 'app', 8080); if (!address) process.exit(1);", before.appId]);
  expect(lookup.code).toBe(0);
});
