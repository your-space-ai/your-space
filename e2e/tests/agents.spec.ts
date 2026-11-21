// Real owner controls, without credentials in screenshots, traces, or console output.
import { expect, test } from "@playwright/test";
import { cliIn } from "./helpers/cli.ts";
import { createOwner, resetStack, serverCommand } from "./helpers/stack.ts";
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
  playwright,
  baseURL,
}) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, "sam");
  const installed = await serverCommand("install-app", [
    "https://github.com/ys-fixtures/records/blob/main/compose.yaml",
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
