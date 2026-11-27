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

test("kit grants and exact approvals route real reads to the installed app", async ({
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
  // There is no Ask for all writes: each route asks or runs as the owner sets it (spec 017).
  await expect(app).not.toContainText("No verified review");
  await app.getByLabel("App credential", { exact: true }).fill("local-fixture-key");
  await app.getByRole("checkbox", { name: /Inspector/ }).check();
  await app.getByRole("checkbox", { name: /Reader/ }).check();
  await app.getByRole("button", { name: "Save connection" }).click();
  await expect(app.locator("summary")).toContainText("Credential saved");
  const settings = page.getByRole("region", { name: "Manage agents" });
  const access = settings.locator("details").filter({ has: page.locator("summary", { hasText: /records/i }) });
  await access.locator("summary").click();
  await access.getByRole("checkbox", { name: /Inspector/ }).check();
  await expect(access.getByText("Ask for all writes")).toHaveCount(0);
  await expect(access.getByLabel("Approval for show")).toHaveValue("");
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access.locator("summary")).toContainText("Inspector");

  const cli = cliIn(process.cwd(), { YOUR_SPACE_URL: baseURL!, YOUR_SPACE_AGENT_KEY: key });
  const run = async (args: string[], input?: unknown) => {
    const outcome = await cli.run(["--json", "agent", ...args], { input: JSON.stringify(input) });
    expect(outcome.code).toBe(0);
    return outcome.json;
  };
  const discovered = await run(["actions"]);
  expect(discovered.actions.map((a: { actionId: string }) => a.actionId).sort()).toEqual(["list", "show"]);
  expect(discovered.actions.every((a: { method: string; effect: string }) => a.method === "GET" && a.effect === "read")).toBe(true);
  const installationId = discovered.actions[0].installationId;
  const invoke = (actionId: string, input: unknown) => run(["invoke", installationId, actionId, "--input-stdin"], input);
  const assignee = { firstName: "Sam" };
  const walk = { id: "3f8a2c1e-5b7d-4e9f-a1c3-6d2b8e4f7a90", revision: 1, title: "Morning walk", assignee };
  const plants = { id: "9c4e7b2a-1d3f-4a6e-b8c5-2f7a9d1e3b64", revision: 3, title: "Water the plants", assignee };

  // A read the kit allows runs directly, and the app's response comes back unchanged.
  const listed = await invoke("list", {});
  expect(listed.status).toBe("succeeded");
  expect(listed.result).toEqual({ data: { items: [walk, plants] }, totalCount: 2 });

  // A read the kit marks ask waits for the owner, who sees the exact input.
  const asked = await invoke("show", { path: { id: walk.id } });
  expect(asked.status).toBe("pending");
  const pending = page.getByRole("region", { name: "Pending approvals" });
  await pending.locator("summary").click();
  await expect(pending.locator("pre")).toContainText(walk.id);
  await pending.getByRole("button", { name: "Approve once" }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  const approved = await run(["request", asked.id]);
  expect(approved.status).toBe("succeeded");
  expect(approved.result).toEqual(walk);

  const denied = await invoke("show", { path: { id: plants.id } });
  expect(denied.status).toBe("pending");
  await pending.locator("summary").click();
  await pending.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await run(["request", denied.id])).status).toBe("rejected");

  // The owner can let the read run directly instead.
  await access.locator("summary").click();
  await access.getByLabel("Approval for show").selectOption("allow");
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access).not.toHaveAttribute("open", "");
  const direct = await invoke("show", { path: { id: plants.id } });
  expect(direct.status).toBe("succeeded");
  expect(direct.result).toEqual(plants);

  // A body, or an action the kit doesn't declare, is refused.
  const refused = await cli.run(["--json", "agent", "invoke", installationId, "show", "--input-stdin"], {
    input: JSON.stringify({ path: { id: walk.id }, body: { title: "Changed" } }),
  });
  expect(refused.code).not.toBe(0);
  expect(refused.json).toMatchObject({ error: "agent_request_failed", reason: "invalid_input" });
});

test("an agent creates, edits and deletes records through the routes its roles grant", async ({ page, baseURL }) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, "sam");
  const installed = await serverCommand("install-app", [
    "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/records.yaml",
  ]);
  expect(installed.json?.ok, installed.json?.error).toBe(true);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByLabel("New agent name").fill("Writing agent");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.getByRole("button", { name: "Issue key" }).click();
  const key = await page.getByLabel("New agent key", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Dismiss key" }).click();

  const app = page.getByRole("region", { name: "App connections" });
  await app.locator("summary").click();
  await app.getByLabel("App credential", { exact: true }).fill("local-fixture-key");
  await app.getByRole("checkbox", { name: /Editor/ }).check();
  await app.getByRole("checkbox", { name: /Remover/ }).check();
  await app.getByRole("button", { name: "Save connection" }).click();
  await expect(app.locator("summary")).toContainText("Credential saved");
  const settings = page.getByRole("region", { name: "Manage agents" });
  const access = settings.locator("details").filter({ has: page.locator("summary", { hasText: /records/i }) });
  await access.locator("summary").click();
  await access.getByRole("checkbox", { name: /Editor/ }).check();
  // A write nobody set asks first; a read runs directly.
  await expect(access.getByLabel("Approval for create").locator("option").first()).toHaveText("Use default (ask)");
  await expect(access.getByLabel("Approval for list").locator("option").first()).toHaveText("Use default (allow)");
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access.locator("summary")).toContainText("Editor");

  const cli = cliIn(process.cwd(), { YOUR_SPACE_URL: baseURL!, YOUR_SPACE_AGENT_KEY: key });
  const run = async (args: string[], input?: unknown) => {
    const outcome = await cli.run(["--json", "agent", ...args], { input: JSON.stringify(input) });
    expect(outcome.code, JSON.stringify(outcome.json)).toBe(0);
    return outcome.json;
  };
  const discovered = await run(["actions"]);
  expect(discovered.actions.map((a: { actionId: string; method: string }) => a.actionId + " " + a.method).sort()).toEqual([
    "create POST",
    "edit PATCH",
    "list GET",
    "show GET",
  ]);
  const installationId = discovered.actions[0].installationId;
  const invoke = (actionId: string, input: unknown) => run(["invoke", installationId, actionId, "--input-stdin"], input);

  // The create waits for the owner, who sees the body it will send, then reaches the app once.
  const id = "5d1c8e3a-7b2f-4a9e-9c6d-1e4f8a2b7c30";
  const asked = await invoke("create", { body: { id, title: "Call the plumber" } });
  expect(asked.status).toBe("pending");
  const pending = page.getByRole("region", { name: "Pending approvals" });
  await pending.locator("summary").click();
  await expect(pending.locator("pre")).toContainText("Call the plumber");
  await pending.getByRole("button", { name: "Approve once" }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  const created = await run(["request", asked.id]);
  expect(created).toMatchObject({ status: "succeeded", result: { data: { createItem: { id, title: "Call the plumber" } } } });

  // Set to Allow, an edit runs directly; the app changes only the field sent.
  await access.locator("summary").click();
  await access.getByLabel("Approval for edit").selectOption("allow");
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access).not.toHaveAttribute("open", "");
  const edited = await invoke("edit", { path: { id }, body: { done: true } });
  expect(edited).toMatchObject({ status: "succeeded", result: { data: { updateItem: { id, title: "Call the plumber", done: true } } } });
  const afterEdit = await invoke("list", {});
  expect(afterEdit.result.data.items).toContainEqual({ id, title: "Call the plumber", done: true, revision: 2 });

  // A second create of the same record ID reaches the app, which refuses it: Your Space keeps no operation ID.
  await access.locator("summary").click();
  await access.getByLabel("Approval for create").selectOption("allow");
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access).not.toHaveAttribute("open", "");
  const again = await cli.run(["--json", "agent", "invoke", installationId, "create", "--input-stdin"], {
    input: JSON.stringify({ body: { id, title: "Call the plumber" } }),
  });
  expect(again.json).toMatchObject({ error: "agent_request_failed", status: "refused" });

  // A delete is granted only with its own role, then asks first like any write nobody set.
  const remove = { path: { id } };
  const unGranted = await cli.run(["--json", "agent", "invoke", installationId, "remove", "--input-stdin"], {
    input: JSON.stringify(remove),
  });
  expect(unGranted.json).toMatchObject({ error: "agent_request_failed", reason: "denied" });
  await access.locator("summary").click();
  await access.getByRole("checkbox", { name: /Remover/ }).check();
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access.locator("summary")).toContainText("Remover");
  const removal = await invoke("remove", remove);
  expect(removal.status).toBe("pending");
  await pending.locator("summary").click();
  await pending.getByRole("button", { name: "Approve once" }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await run(["request", removal.id])).status).toBe("succeeded");
  const listed = await invoke("list", {});
  expect(listed.result.data.items.map((item: { id: string }) => item.id)).not.toContain(id);
});
