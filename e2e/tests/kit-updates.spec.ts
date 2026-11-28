import { expect, test, type Page } from "@playwright/test";
import { compose, createOwner, resetStack } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Journey 019: an installed app updates in place from its kit. The GitHub stand-in moves the kit
// repository's `main` on to a new commit; the app's page shows the update in its status card
// (design A), says what it changes, asks for the setting it adds, and applies it; the app keeps
// running with its data and settings.
const kitLink = "https://github.com/ys-fixtures/updates/blob/main/kit.yaml";

async function waitForJob(page: Page): Promise<void> {
  const job = page.locator("section.job");
  await expect(job).toHaveAttribute("data-job-state", /succeeded|failed/, { timeout: 180_000 });
  expect(await job.getAttribute("data-job-state"), (await job.textContent()) ?? "").toBe("succeeded");
}

test("an app shows an update to its kit, previews what it changes, and updates in place", async ({ page }) => {
  test.setTimeout(420_000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await page.getByLabel("Link to the app's kit").fill(kitLink);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await waitForJob(page);

  await page.goto("/apps/updating");
  const status = page.getByRole("region", { name: "Status" });
  await status.getByRole("button", { name: "Check for update" }).click();
  await expect(status.getByText("Up to date with its kit.")).toBeVisible();
  await expect(status.locator("[data-field=update-available]")).toHaveCount(0);

  // A new commit of the kit on main: a setting the owner gives, and a host the app may reach.
  await compose(["exec", "-T", "github", "node", "-e", `fetch("http://127.0.0.1:8080/_stand-in/advance", { method: "POST", body: "ys-fixtures/updates" }).then((r) => process.exit(r.ok ? 0 : 1))`]);
  await status.getByRole("button", { name: "Check for update" }).click();
  await expect(status.locator("[data-field=update-available]")).toHaveText("Update available");
  await status.getByRole("button", { name: "Preview changes" }).click();
  await expect(status.getByText("A new setting, MOTTO.")).toBeVisible();
  await expect(status.getByText("The app may reach example.org.")).toBeVisible();
  const update = status.getByRole("button", { name: "Update Updating" });
  await expect(update).toBeDisabled();
  await status.getByLabel("MOTTO").fill("ship it");
  await update.click();
  await waitForJob(page);

  await page.reload();
  await expect(page.getByRole("region", { name: "Status" }).locator("[data-field=update-available]")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Status" }).locator("[data-field=state]")).toHaveText("Running");
  const detail = await (await page.request.get("/api/apps/updating")).json();
  expect(detail.outbound.map((o: { host: string }) => o.host).sort()).toEqual(["example.com", "example.org"]);
  expect(detail.settings.find((s: { name: string }) => s.name === "MOTTO")).toMatchObject({ set: true, value: "ship it" });
  expect(detail.settings.find((s: { name: string }) => s.name === "API_TOKEN")).toMatchObject({ set: true });
});
