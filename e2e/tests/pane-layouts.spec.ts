import { expect, test, type Page } from "@playwright/test";
import type { SavedView, ViewComposition } from "../../shared/workspace-layout/model.mjs";
import { builtInThemes } from "../../shared/appearance/theme.mjs";

// Isolate layout behavior from the app installer. Each fixture app is a distinct document and origin.
async function fixture(page: Page) {
  const apps = ["notes", "calendar", "projects", "library", "outside"];
  const views: SavedView[] = [];
  const owner = "a1111111-1111-4111-8111-111111111111";
  const id = "b1111111-1111-4111-8111-111111111111";
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    let json: unknown;
    if (pathname === "/api/status") json = { owner: true };
    else if (pathname === "/api/auth/get-session")
      json = {
        session: { id: owner, userId: owner, expiresAt: "2099-01-01" },
        user: { id: owner, name: "Owner", email: "fixture@example.test" },
      };
    else if (pathname === "/api/auth/organization/list") json = [{ id, name: "Test", slug: "test" }];
    else if (pathname === "/api/appearance/active") {
      const { style, fonts, light, dark } = builtInThemes[0]!.theme;
      json = { mode: "light", style, fonts, light, dark };
    } else if (pathname === "/api/apps")
      json = {
        apps: apps.map((name) => ({
          name,
          title: name,
          hasInterface: true,
          pane: name !== "outside",
          origin: "http://" + name + ".example.test",
          state: "running",
          publish: null,
        })),
      };
    else if (pathname === "/api/workspace-layout") json = { revision: 1, appOrder: apps, views };
    else if (pathname === "/api/workspace-layout/views" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string; composition: ViewComposition };
      const view = {
        id: id.slice(0, -1) + String(views.length + 1),
        name: body.name,
        composition: body.composition,
        revision: 1,
      };
      views.push(view);
      json = view;
    } else if (pathname.startsWith("/api/workspace-layout/views/") && route.request().method() === "PUT") {
      const view = views.find((item) => item.id === pathname.split("/").at(-1))!;
      Object.assign(view, route.request().postDataJSON(), { revision: view.revision + 1 });
      json = view;
    } else return route.fulfill({ status: 404, json: { error: "unused_route" } });
    await route.fulfill({ json });
  });
  await page.route("http://*.example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Fixture app</title><label>Draft <input></label>",
    }),
  );
  return views;
}

const section = (page: Page, name: string) => page.locator('section[data-pane="' + name + '"]');
const input = (page: Page, name: string) => section(page, name).frameLocator("iframe").getByLabel("Draft");
const separators = (page: Page, axis: "vertical" | "horizontal") =>
  page.locator('[role=separator][aria-orientation="' + axis + '"]');

const value = async (page: Page, axis: "vertical" | "horizontal") =>
  Number(await separators(page, axis).first().getAttribute("aria-valuenow"));

test("panes keep each app's document and lay apps out by count, and named views keep their sizes", async ({ page }) => {
  const views = await fixture(page);
  await page.goto("/open/notes?with=calendar");
  await expect(page.locator("section[data-pane]")).toHaveCount(2);
  await input(page, "notes").fill("unfinished draft");
  // No preset choice and no layout link (decision 2026-11-23, Alpha scope).
  await expect(page.getByLabel("Layout preset")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy layout link" })).toHaveCount(0);
  for (const [app, vertical, horizontal] of [
    [null, 1, 0],
    ["projects", 1, 1],
    ["library", 1, 1],
  ] as const) {
    if (app) await page.getByLabel("Add an app to this layout").selectOption(app);
    await expect(separators(page, "vertical")).toHaveCount(vertical);
    await expect(separators(page, "horizontal")).toHaveCount(horizontal);
    await expect(input(page, "notes")).toHaveValue("unfinished draft");
  }
  for (const axis of ["vertical", "horizontal"] as const) {
    const handle = separators(page, axis).first();
    const original = await handle.boundingBox();
    await handle.focus();
    await page.keyboard.press(axis === "vertical" ? "ArrowRight" : "ArrowDown");
    await expect
      .poll(async () => (await handle.boundingBox())![axis === "vertical" ? "x" : "y"])
      .not.toBe(original![axis === "vertical" ? "x" : "y"]);
  }

  const line = separators(page, "vertical").first();
  const handle = (await line.boundingBox())!;
  const original = (await section(page, "notes").boundingBox())!.width;
  // End the gesture inside the cross-origin document; release must also return pointer input to it.
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 80, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await section(page, "notes").boundingBox())!.width).toBeLessThan(original - 30);
  await input(page, "notes").fill("still editable");
  // Sizes stay out of the address and out of the browser's storage.
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(["with"]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ys-pane")))).toEqual([]);

  const url = page.url();
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("View name").fill("Daily desk");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/view=b111/);
  expect(views[0]!.composition).toMatchObject({ layout: "grid", apps: ["notes", "calendar", "projects", "library"] });
  const proportions = views[0]!.composition.sizes;
  expect(proportions.columns).toHaveLength(2);
  expect(proportions.rows).toHaveLength(2);
  const before = (await section(page, "notes").boundingBox())!.width;
  await page.goto("/open/calendar");
  await page.goto("/open/notes?view=" + views[0]!.id);
  await expect.poll(async () => Math.abs((await section(page, "notes").boundingBox())!.width - before)).toBeLessThan(2);
  // The same apps opened again without the view start at even sizes.
  await page.goto(url);
  await expect.poll(() => value(page, "vertical")).toBeCloseTo(50, 0);
  await page.getByRole("button", { name: "Close calendar", exact: true }).click();
  await expect(section(page, "calendar")).toHaveCount(0);
  await page.getByLabel("Add an app to this layout").selectOption("outside");
  await expect(section(page, "outside").locator("iframe")).toHaveCount(0);
  await expect(section(page, "outside").getByRole("link", { name: "Open in its own tab" }).first()).toHaveAttribute(
    "href",
    "http://outside.example.test",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "Visible app", exact: true }).selectOption("library");
  await expect(input(page, "library")).toBeVisible();
  await expect(section(page, "notes")).toBeHidden();
  expect((await section(page, "library").boundingBox())!.width).toBeGreaterThan(370);
});

test("touch resizes a grid boundary through an app iframe", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium's touch input protocol exercises a real touch gesture.");
  await fixture(page);
  await page.goto("/open/notes?with=calendar");
  const line = separators(page, "vertical").first();
  await expect(line).toBeVisible();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const box = (await line.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 60, y: y + 8 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await line.boundingBox())!.x).toBeLessThan(box.x - 25);
});

test("a saved view changes on explicit update, and a layout link from before opens with even sizes", async ({ page }) => {
  const views = await fixture(page);
  await page.goto("/open/notes?with=calendar");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("View name").fill("Morning");
  // The address changes before the router finishes checking the owner's session.
  const navigating = Promise.withResolvers<void>();
  await page.route("**/api/status", async (route) => {
    await navigating.promise;
    await route.fallback();
  }, { times: 1 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/view=b111/);
  const divider = separators(page, "vertical").first();
  try {
    await expect(divider).toBeVisible();
    await divider.focus();
    await page.keyboard.press("ArrowRight");
  } finally {
    navigating.resolve();
  }
  await expect.poll(() => value(page, "vertical")).toBeGreaterThan(50);
  expect(views[0]!.composition.sizes.columns[0]).toBeCloseTo(50, 0);
  await page.getByRole("button", { name: "Update view" }).click();
  await expect.poll(() => views[0]!.revision).toBe(2);
  expect(views[0]!.composition.sizes.columns[0]).toBeGreaterThan(50);
  // A layout link from before keeps its apps; its layout and sizes are ignored.
  await page.goto("/open/library?with=projects&layout=rows&sizes=32,68/100");
  await expect(separators(page, "vertical")).toHaveCount(1);
  await expect(separators(page, "horizontal")).toHaveCount(0);
  await expect.poll(() => value(page, "vertical")).toBeCloseTo(50, 0);
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("View name").fill("Reference");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Reference", exact: true })).toBeVisible();
  expect(views).toHaveLength(2);
  expect(views.map((view) => view.revision)).toEqual([2, 1]);
  await page.reload();
  for (const expected of [views[0]!, views[1]!, views[0]!]) {
    await page.getByRole("link", { name: expected.name, exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator("section[data-pane]")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-pane"))),
      )
      .toEqual(expected.composition.apps);
    await expect
      .poll(async () => Math.abs((await value(page, "vertical")) - expected.composition.sizes.columns[0]!))
      .toBeLessThan(1);
  }
  // Closing a pane of a saved view leaves the one app open, and the view can be updated to it.
  await page.getByRole("button", { name: "Close calendar", exact: true }).click();
  await expect(page.locator("section[data-pane]")).toHaveCount(1);
  await expect(section(page, "notes")).toBeVisible();
  await page.getByRole("button", { name: "Update view" }).click();
  await expect.poll(() => views[0]!.composition.apps).toEqual(["notes"]);
});

test("reload loads one pane's app again and leaves the other panes and the page as they were", async ({ page }) => {
  await fixture(page);
  const loads: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") loads.push(new URL(request.url()).hostname);
  });
  await page.goto("/open/notes?with=calendar,outside");
  await input(page, "notes").fill("before reload");
  await input(page, "calendar").fill("kept");
  const count = (host: string) => loads.filter((name) => name === host).length;
  const before = { notes: count("notes.example.test"), calendar: count("calendar.example.test") };
  // A keyboard user reaches the control by its name, which says which app it reloads.
  await section(page, "notes").getByRole("button", { name: "Reload notes", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(input(page, "notes")).toHaveValue("");
  expect(count("notes.example.test")).toBe(before.notes + 1);
  expect(count("calendar.example.test")).toBe(before.calendar);
  await expect(input(page, "calendar")).toHaveValue("kept");
  // An app the pane can't show has nothing to reload.
  await expect(section(page, "outside").getByRole("button", { name: /^Reload/ })).toHaveCount(0);
});
