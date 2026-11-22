import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { starterThemes } from "../../shared/appearance/theme.mjs";
import { evidence } from "./helpers/evidence.ts";
import { createOwner, resetStack } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test("the owner previews, shares and applies workspace themes", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Appearance" }).click();
  await expect(page.getByRole("button", { name: "Canopy is current" })).toBeDisabled();
  await expect(page.locator(".starter-cover img")).toHaveCount(3);
  await expect.poll(() => page.locator(".starter-cover img").evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBeTruthy();
  await evidence(page, testInfo, "appearance-light-library");

  const ember = starterThemes.find((entry) => entry.id === "ember")!.theme;
  await page.getByRole("button", { name: "Use Ember", exact: true }).focus();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/appearance/selection") && response.ok()),
    page.keyboard.press("Enter"),
  ]);
  await expect(page.getByRole("button", { name: "Ember is current" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--bg").trim())).toBe(ember.tokens.bg);
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Ember is current" })).toBeDisabled();
  await evidence(page, testInfo, "appearance-dark-library");

  await page.getByRole("button", { name: "Customize Ember" }).click();
  await expect(page.getByRole("heading", { name: "Create a theme" })).toBeFocused();
  await page.getByLabel("Theme name", { exact: true }).fill("Night study");
  await page.getByLabel("Heading font", { exact: true }).fill("Georgia");
  await page.getByLabel("Text", { exact: true }).fill(ember.tokens.bg);
  await expect(page.getByText(/Low contrast for/)).toBeVisible();
  await page.getByLabel("Text", { exact: true }).fill("#fff2e1");
  await expect(page.getByText(/Low contrast for/)).toHaveCount(0);
  await expect(page.locator(".preview-title")).toHaveCSS("font-family", /Georgia/);
  await evidence(page, testInfo, "appearance-theme-editor");
  await page.getByRole("checkbox", { name: "Use this theme after saving" }).check();
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page.getByRole("button", { name: "Night study is current" })).toBeDisabled();

  const row = page.getByRole("listitem", { name: "Night study" });
  await row.getByText("More options").click();
  const downloaded = page.waitForEvent("download");
  await row.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloaded;
  const file = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(file).toMatchObject({ version: 1, name: "Night study", tokens: { fontHeading: "Georgia" } });
  expect(file).not.toHaveProperty("id");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"arbitrary":"style"}') });
  await expect(page.getByRole("alert")).toContainText("version 1");
  await input.setInputFiles({ name: "copy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue("Night study");
  await page.getByLabel("Theme name", { exact: true }).fill("Imported theme");
  await page.getByRole("button", { name: "Save theme" }).click();
  const imported = page.getByRole("listitem", { name: "Imported theme" });
  await imported.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Theme name", { exact: true }).fill("Renamed theme");
  await page.getByRole("button", { name: "Save theme" }).click();
  const renamed = page.getByRole("listitem", { name: "Renamed theme" });
  await renamed.getByText("More options").click();
  await renamed.getByRole("button", { name: "Delete theme" }).click();
  await renamed.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(renamed).toHaveCount(0);

  const signedOut = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const visitor = await signedOut.newPage();
    await visitor.goto("/sign-in");
    await expect(visitor.getByRole("heading", { name: "Sign in to Your Space" })).toBeVisible();
    await expect(visitor.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(visitor.getByRole("heading")).toHaveCSS("font-family", /Georgia/);
    expect((await signedOut.request.get("/api/appearance")).status()).toBe(401);
  } finally { await signedOut.close(); }
});
