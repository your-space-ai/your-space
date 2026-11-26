import { expect, test } from "@playwright/test";
import { createOwner, resetStack } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Runs through the real owner UI, database, Docker runtime and edge. Only GitHub is replaced, with
// the synthetic provider mounted by compose.e2e.yaml.
const kitLink = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/whoami.yaml";

test("a private kit points the owner to connecting GitHub, and a public one installs from its link", async ({ page }) => {
  test.setTimeout(240000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  // A kit Your Space can't read on public GitHub, as in a private repository, needs the GitHub connection.
  await page.getByLabel("Link to the app's kit").fill("https://github.com/ys-fixtures/private/blob/main/kit.yaml");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("If the repository is private, connect GitHub");
  await page.getByLabel("Link to the app's kit").fill(kitLink);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Install", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator("section.job")).toHaveAttribute("data-job-state", "succeeded", { timeout: 120000 });
});
