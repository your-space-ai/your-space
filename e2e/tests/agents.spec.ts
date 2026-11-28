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
      await client.get("/api/agent/apps", {
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

test("an agent granted an app reads and writes its API with the owner's key, asking only where the owner said", async ({
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

  // The owner binds the app key once; agents never see it.
  const app = page.getByRole("region", { name: "App connections" });
  await app.locator("summary").click();
  await expect(app).toContainText("/items");
  await app.getByLabel("App key", { exact: true }).fill("local-fixture-key");
  await app.getByRole("button", { name: "Save keys" }).click();
  await expect(app.locator("summary")).toContainText("Key saved");

  // The agent gets the app with that key; only deletes ask first.
  const settings = page.getByRole("region", { name: "Manage agents" });
  const access = settings.locator("details").filter({ has: page.locator("summary", { hasText: /records/i }) });
  await access.locator("summary").click();
  await expect(access.getByText("None: every call runs directly.")).toBeVisible();
  await access.getByLabel("App key this agent uses").selectOption("service");
  await access.getByLabel("Method that asks").selectOption("DELETE");
  await access.getByLabel("Path that asks").fill("/items/*");
  await access.getByRole("button", { name: "Add" }).click();
  await access.getByRole("button", { name: "Save agent access" }).click();
  await expect(access.locator("summary")).toContainText("Uses the service key");

  const cli = cliIn(process.cwd(), { YOUR_SPACE_URL: baseURL!, YOUR_SPACE_AGENT_KEY: key });
  const run = async (args: string[], input?: unknown) => {
    const outcome = await cli.run(["--json", "agent", ...args], input === undefined ? {} : { input: JSON.stringify(input) });
    expect(outcome.code, JSON.stringify(outcome.json)).toBe(0);
    return outcome.json;
  };
  const apps = (await run(["apps"])).apps;
  expect(apps).toMatchObject([{ api: "/items", available: true, asks: [{ method: "DELETE", path: "/items/*" }] }]);
  const installationId = apps[0].installationId;
  const callApp = (method: string, path: string, body?: unknown) =>
    run(["call", installationId, method, path, ...(body === undefined ? [] : ["--body-stdin"])], body);

  const assignee = { firstName: "Sam" };
  const walk = { id: "3f8a2c1e-5b7d-4e9f-a1c3-6d2b8e4f7a90", revision: 1, title: "Morning walk", assignee };
  const listed = await callApp("GET", "/items");
  expect(listed).toMatchObject({ status: "succeeded", result: { data: { items: [walk, expect.anything()] }, totalCount: 2 } });

  // Writes run directly: the key's role in the app is the limit, and the body goes as it is.
  const id = "5d1c8e3a-7b2f-4a9e-9c6d-1e4f8a2b7c30";
  const created = await callApp("POST", "/items", { id, title: "Call the plumber" });
  expect(created).toMatchObject({ status: "succeeded", result: { data: { createItem: { id, title: "Call the plumber" } } } });
  const edited = await callApp("PATCH", "/items/" + id, { done: true });
  expect(edited).toMatchObject({ status: "succeeded", result: { data: { updateItem: { id, done: true, revision: 2 } } } });

  // A delete matches the route that asks: it waits, the owner sees the exact call, and approves once.
  const asked = await callApp("DELETE", "/items/" + id);
  expect(asked.status).toBe("pending");
  const pending = page.getByRole("region", { name: "Pending approvals" });
  await pending.locator("summary").click();
  await expect(pending.locator("pre")).toContainText("/items/" + id);
  await pending.getByRole("button", { name: "Approve once" }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await run(["request", asked.id])).status).toBe("succeeded");
  const denied = await callApp("DELETE", "/items/" + walk.id);
  expect(denied.status).toBe("pending");
  await pending.locator("summary").click();
  await pending.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(pending.getByText("No requests awaiting approval.")).toBeVisible();
  expect((await run(["request", denied.id])).status).toBe("rejected");
  const after = await callApp("GET", "/items");
  expect(after.result.data.items.map((item: { id: string }) => item.id)).toEqual([walk.id, expect.any(String)]);

  // Outside the API is refused before anything reaches the app.
  const outside = await cli.run(["--json", "agent", "call", installationId, "GET", "/meta/fields"]);
  expect(outside.code).not.toBe(0);
  expect(outside.json).toMatchObject({ error: "agent_request_failed", reason: "invalid_request" });

  // Removing access ends it.
  await access.locator("summary").click();
  await access.getByRole("button", { name: "Remove access" }).click();
  await expect(access.locator("summary")).toContainText("No access");
  const removed = await cli.run(["--json", "agent", "call", installationId, "GET", "/items"]);
  expect(removed.json).toMatchObject({ error: "agent_request_failed", reason: "denied" });
});

test("each agent uses the app key the owner picked for it, and no other", async ({ page, baseURL }) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, "sam");
  const installed = await serverCommand("install-app", [
    "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/records-setup.yaml",
  ]);
  expect(installed.json?.ok, installed.json?.error).toBe(true);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByLabel("New agent name").fill("Setup agent");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.getByRole("button", { name: "Issue key" }).click();
  const key = await page.getByLabel("New agent key", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Dismiss key" }).click();

  const app = page.getByRole("region", { name: "App connections" });
  await app.locator("summary").click();
  await app.getByLabel("App key: records", { exact: true }).fill("local-fixture-key");
  await app.getByLabel("App key: setup", { exact: true }).fill("local-fixture-admin-key");
  await app.getByRole("button", { name: "Save keys" }).click();
  await expect(app.locator("summary")).toContainText("Key saved");

  const settings = page.getByRole("region", { name: "Manage agents" });
  const access = settings.locator("details").filter({ has: page.locator("summary", { hasText: /records/i }) });
  const useKey = async (name: string) => {
    await access.locator("summary").click();
    await access.getByLabel("App key this agent uses").selectOption(name);
    await access.getByRole("button", { name: "Save agent access" }).click();
    await expect(access.locator("summary")).toContainText(`Uses the ${name} key`);
  };
  await useKey("setup");

  const cli = cliIn(process.cwd(), { YOUR_SPACE_URL: baseURL!, YOUR_SPACE_AGENT_KEY: key });
  const callApp = async (path: string) =>
    (await cli.run(["--json", "agent", "call", installationId, "GET", path])).json;
  const installationId = (await cli.run(["--json", "agent", "apps"])).json.apps[0].installationId;
  // The app answers its data model only to the admin key, and its records only to the record key.
  expect(await callApp("/meta/fields")).toMatchObject({ status: "succeeded", result: { data: { fields: ["title", "assignee"] } } });
  expect(await callApp("/items")).toMatchObject({ status: "refused" });
  await useKey("records");
  expect((await callApp("/items")).status).toBe("succeeded");
  expect(await callApp("/meta/fields")).toMatchObject({ status: "refused" });
});
