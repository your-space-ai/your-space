import { fixtureCommit } from "../github/commits.mjs";
import { expect, test } from "@playwright/test";
import { createOwner, resetStack } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Runs through the real owner UI, database, Docker runtime and edge. Only GitHub is replaced, with
// the synthetic provider mounted by compose.e2e.yaml.
const kitLink = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/whoami.yaml";

test("the owner reviews a directory kit, then installs an app from its kit's link", async ({ page }) => {
  test.setTimeout(240000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await page.getByText("Kit directory", { exact: true }).click();
  await page.getByRole("button", { name: "Review whoami", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  // The directory's entry is pinned to the directory's commit, and the kit pins its Compose file.
  await expect(page.getByRole("link", { name: "ys-fixtures/catalog/apps/ys-fixtures/whoami.yaml" })).toHaveAttribute("href", new RegExp(`/blob/${fixtureCommit("ys-fixtures/catalog")}/`));
  await expect(page.getByRole("link", { name: "ys-fixtures/whoami/compose.yaml" })).toHaveAttribute("href", new RegExp(`/blob/${fixtureCommit("ys-fixtures/whoami")}/`));
  // A kit Your Space can't read on public GitHub, as in a private repository, installs from this machine instead.
  await page.getByLabel("Link to the app's kit").fill("https://github.com/ys-fixtures/private/blob/main/kit.yaml");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("install-app --kit - < kit.yaml");
  await page.getByLabel("Link to the app's kit").fill(kitLink);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Install", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator("section.job")).toHaveAttribute("data-job-state", "succeeded", { timeout: 120000 });
});
