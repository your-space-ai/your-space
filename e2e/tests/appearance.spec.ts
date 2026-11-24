import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { builtInThemes, bundledFonts } from "../../shared/appearance/theme.mjs";
import { evidence } from "./helpers/evidence.ts";
import { createOwner, resetStack } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

const [cerulean, cinder] = builtInThemes.map((entry) => entry.theme);
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--bg").trim());
const colorScheme = (page: Page) => page.evaluate(() => document.documentElement.style.colorScheme);
const loadedFaces = (page: Page, family: string) => page.evaluate(async (font) => (await document.fonts.load(font)).length, `600 16px "${family}"`);

async function chooseMode(page: Page, label: string) {
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/appearance/mode") && response.ok()),
    page.getByRole("radio", { name: label, exact: true }).check(),
  ]);
}

test("the owner previews, shares and applies workspace themes in light and dark", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const fonts: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "font") fonts.push(request.url()); });
  await page.emulateMedia({ colorScheme: "light" });
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Appearance" }).click();
  await expect(page.getByRole("button", { name: "Cerulean is current" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Match my device" })).toBeChecked();
  await expect(page.locator(".starter-card .theme-sample")).toHaveCount(6);
  // The four bundled families load from the dashboard itself.
  for (const family of bundledFonts) {
    await expect.poll(() => loadedFaces(page, family)).toBeGreaterThan(0);
  }
  // Each family's license ships beside it and in the dashboard's third-party notices.
  const notices = await page.request.get("/licenses/THIRD-PARTY.md");
  expect(notices.ok()).toBe(true);
  const noticeText = await notices.text();
  for (const family of bundledFonts) {
    expect(noticeText).toContain(`## ${family} font (OFL-1.1)`);
    const license = await page.request.get(`/fonts/OFL-${family.replaceAll(" ", "")}.txt`);
    expect(license.ok()).toBe(true);
    expect(await license.text()).toContain("SIL Open Font License, Version 1.1");
  }
  const origin = new URL(page.url()).origin;
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  await expect.poll(() => background(page)).toBe(cerulean.light.bg);
  await evidence(page, testInfo, "appearance-light-library");

  await chooseMode(page, "Dark");
  await expect.poll(() => colorScheme(page)).toBe("dark");
  await expect.poll(() => background(page)).toBe(cerulean.dark.bg);
  await evidence(page, testInfo, "appearance-dark-library");
  await chooseMode(page, "Light");
  await expect.poll(() => background(page)).toBe(cerulean.light.bg);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => background(page)).toBe(cerulean.light.bg);
  // Match my device follows the browser's preference as it changes.
  await chooseMode(page, "Match my device");
  await expect.poll(() => background(page)).toBe(cerulean.dark.bg);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => background(page)).toBe(cerulean.light.bg);
  await expect.poll(() => colorScheme(page)).toBe("light");

  // Another browser chose Dark: this page's stale change is refused, and it shows the saved mode.
  const other = await page.context().newPage();
  await other.goto("/appearance");
  await chooseMode(other, "Dark");
  await other.close();
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await expect(page.getByRole("alert")).toContainText("Your theme library changed");
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await expect.poll(() => background(page)).toBe(cerulean.dark.bg);
  // The saved mode outlasts a reload, over the browser's light preference.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await expect.poll(() => background(page)).toBe(cerulean.dark.bg);
  await expect.poll(() => colorScheme(page)).toBe("dark");
  await chooseMode(page, "Match my device");
  await expect.poll(() => background(page)).toBe(cerulean.light.bg);

  await page.getByRole("button", { name: "Use Cinder", exact: true }).focus();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/appearance/selection") && response.ok()),
    page.keyboard.press("Enter"),
  ]);
  await expect(page.getByRole("button", { name: "Cinder is current" })).toBeDisabled();
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
  await expect.poll(() => background(page)).toBe(cinder.light.bg);
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Cinder is current" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Match my device" })).toBeChecked();

  await page.getByRole("button", { name: "Customize Cinder" }).click();
  await expect(page.getByRole("heading", { name: "Create a theme" })).toBeFocused();
  await page.getByLabel("Theme name", { exact: true }).fill("Night study");
  await page.getByRole("combobox", { name: "Style", exact: true }).selectOption("soft");
  await page.getByLabel("Heading font", { exact: true }).fill("Georgia");
  await page.getByLabel("Dark Text", { exact: true }).fill(cinder.dark.bg);
  await expect(page.getByText(/Low contrast in Dark for/)).toBeVisible();
  await page.getByLabel("Dark Text", { exact: true }).fill("#fff2e1");
  await expect(page.getByText(/Low contrast in/)).toHaveCount(0);
  await expect(page.locator(".preview-title").first()).toHaveCSS("font-family", /Georgia/);
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
  expect(file).toMatchObject({ version: 2, name: "Night study", style: "soft", fonts: { heading: "Georgia", mono: "IBM Plex Mono" },
    dark: { fg: "#fff2e1" }, light: { bg: cinder.light.bg } });
  expect(file).not.toHaveProperty("id");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"arbitrary":"style"}') });
  await expect(page.getByRole("alert")).toContainText("version 2");
  await input.setInputFiles({ name: "future.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...file, version: 3 })) });
  await expect(page.getByRole("alert")).toContainText("version 2");
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

  // The sign-in page shows the workspace's theme in the visitor's own mode.
  for (const scheme of ["light", "dark"] as const) {
    const signedOut = await browser.newContext({ baseURL: origin, colorScheme: scheme });
    try {
      const visitor = await signedOut.newPage();
      await visitor.goto("/sign-in");
      await expect(visitor.getByRole("heading", { name: "Sign in to Your Space" })).toBeVisible();
      await expect(visitor.locator("html")).toHaveCSS("color-scheme", scheme);
      await expect.poll(() => background(visitor)).toBe(scheme === "dark" ? cinder.dark.bg : cinder.light.bg);
      await expect(visitor.getByRole("heading")).toHaveCSS("font-family", /Georgia/);
      expect((await signedOut.request.get("/api/appearance")).status()).toBe(401);
    } finally { await signedOut.close(); }
  }
});
