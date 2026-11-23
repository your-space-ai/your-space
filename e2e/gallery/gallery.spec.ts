// Screenshots of the component kit in every built-in theme and palette for review, and a check that
// what renders meets WCAG AA: 4.5:1 for text and 3:1 for the edges of controls and status dots.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const themes = [["cerulean", "Instrument Sans"], ["cinder", "Space Grotesk"], ["fern", "Fraunces"]] as const;
const schemes = ["light", "dark"] as const;
const folder = process.env.YS_GALLERY_DIR ?? join(import.meta.dirname, "..", "gallery-screenshots");
mkdirSync(folder, { recursive: true });

async function open(page: Page, theme: string, scheme: string, heading: string) {
  await page.goto(`/gallery.html?theme=${theme}&scheme=${scheme}`);
  await expect(page.getByRole("heading", { level: 1, name: "Component kit" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The bundled fonts swap in when they load: wait for them, so no screenshot shows a fallback.
  expect(await page.evaluate((family) => document.fonts.check(`600 16px "${family}"`) && document.fonts.check('16px "IBM Plex Mono"'), heading)).toBe(true);
}

// Measures, in the page, every element with its own text and every control edge and status dot
// against what is behind it. Colors are read back through a canvas, so any CSS color works.
async function contrastProblems(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255] as const;
    };
    const over = (top: readonly number[], bottom: readonly number[]) =>
      [0, 1, 2].map((i) => top[i]! * top[3]! + bottom[i]! * (1 - top[3]!)).concat(1);
    // What shows behind an element: its own and its ancestors' backgrounds, laid over each other.
    const behind = (element: Element | null, self: boolean) => {
      const layers: (readonly number[])[] = [];
      for (let node = self ? element : element?.parentElement ?? null; node; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] === 1) break;
      }
      return layers.reduceRight<readonly number[]>((ground, layer) => over(layer, ground), [255, 255, 255, 1]);
    };
    const luminance = (color: readonly number[]) => {
      const [r, g, b] = color.slice(0, 3).map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: readonly number[], b: readonly number[]) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const exempt = (element: Element) =>
      !!element.closest(":disabled, [aria-disabled='true'], .ui-visually-hidden, [inert]") || element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false;
    const problems: string[] = [];
    const name = (element: Element) => `${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
    for (const element of document.querySelectorAll("body *")) {
      const own = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
      if (!own || exempt(element) || element.closest("svg")) continue;
      const ground = behind(element, true);
      const value = ratio(over(rgba(getComputedStyle(element).color), ground), ground);
      if (value < 4.5) problems.push(`text ${name(element)}: ${value.toFixed(2)}`);
    }
    for (const element of document.querySelectorAll(".ui-input, .ui-toggle, .ui-dot")) {
      if (exempt(element)) continue;
      const style = getComputedStyle(element);
      const edge = element.classList.contains("ui-dot") ? style.backgroundColor : (element as HTMLInputElement).checked ? style.backgroundColor : style.borderTopColor;
      const value = ratio(over(rgba(edge), behind(element, false)), behind(element, false));
      if (value < 3) problems.push(`edge ${name(element)}: ${value.toFixed(2)}`);
    }
    return problems;
  });
}

for (const [theme, heading] of themes) {
  for (const scheme of schemes) {
    test(`${theme} ${scheme}`, async ({ page }) => {
      await open(page, theme, scheme, heading);
      expect(await contrastProblems(page)).toEqual([]);
      await page.screenshot({ path: join(folder, `${theme}-${scheme}-1-page.png`), fullPage: true, animations: "disabled" });

      // Overlays: toasts, then the pane menu opened from the keyboard, then each dialog.
      await page.getByRole("button", { name: "Show toasts" }).click();
      const menuButton = page.getByRole("button", { name: "Calendar actions" });
      await menuButton.scrollIntoViewIfNeeded();
      await menuButton.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Reload" })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      expect(await contrastProblems(page)).toEqual([]);
      await page.screenshot({ path: join(folder, `${theme}-${scheme}-2-menu-and-toasts.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(menuButton).toBeFocused();

      await page.getByRole("button", { name: "Save view…" }).click();
      await expect(page.getByRole("dialog", { name: "Save this view" })).toBeVisible();
      await expect(page.getByLabel("View name")).toBeFocused();
      expect(await contrastProblems(page)).toEqual([]);
      await page.screenshot({ path: join(folder, `${theme}-${scheme}-3-dialog.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save view…" })).toBeFocused();

      await page.getByRole("button", { name: "Remove app…" }).click();
      const confirm = page.getByRole("alertdialog", { name: "Remove Recipes?" });
      await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
      // The page behind a modal dialog can't be reached with Tab.
      await page.keyboard.press("Tab");
      await expect(confirm.getByRole("button", { name: "Remove app" })).toBeFocused();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => {
        const focused = document.activeElement;
        return !focused || focused === document.body || !!focused.closest("[role=alertdialog]");
      })).toBe(true);
      await page.screenshot({ path: join(folder, `${theme}-${scheme}-4-confirm.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(confirm).toHaveCount(0);
    });
  }
  test(`${theme} on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, theme, "light", heading);
    expect(await contrastProblems(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: join(folder, `${theme}-light-5-phone.png`), fullPage: true, animations: "disabled" });
  });
}
