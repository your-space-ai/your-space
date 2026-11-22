import { expect, test, type Page } from "@playwright/test";
import type { SavedView, ViewComposition } from "../../shared/workspace-layout/model.mjs";
import { starterThemes } from "../../shared/appearance/theme.mjs";

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
    else if (pathname === "/api/appearance/active") json = starterThemes[0]!.theme;
    else if (pathname === "/api/apps")
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

test("layouts preserve each app's document, all divider sizes, named views and shareable links", async ({ page }) => {
  const views = await fixture(page);
  await page.goto("/open/notes?with=calendar");
  await expect(page.locator("section[data-pane]")).toHaveCount(2);
  await input(page, "notes").fill("unfinished draft");
  await page.getByLabel("Add an app to this layout").selectOption("projects");
  await page.getByLabel("Add an app to this layout").selectOption("library");
  await expect(input(page, "notes")).toHaveValue("unfinished draft");

  for (const [preset, vertical, horizontal] of [
    ["columns", 3, 0],
    ["rows", 0, 3],
    ["grid", 1, 1],
    ["main", 1, 2],
  ] as const) {
    await page.getByLabel("Layout preset").selectOption(preset);
    await expect(separators(page, "vertical")).toHaveCount(vertical);
    await expect(separators(page, "horizontal")).toHaveCount(horizontal);
    for (const axis of ["vertical", "horizontal"] as const) {
      const handles = separators(page, axis);
      for (const handle of await handles.all()) {
        const original = await handle.boundingBox();
        await handle.focus();
        await page.keyboard.press(axis === "vertical" ? "ArrowRight" : "ArrowDown");
        await expect
          .poll(async () => (await handle.boundingBox())![axis === "vertical" ? "x" : "y"])
          .not.toBe(original![axis === "vertical" ? "x" : "y"]);
      }
    }
    await expect(input(page, "notes")).toHaveValue("unfinished draft");
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

  const url = page.url();
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("View name").fill("Daily desk");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/view=b111/);
  expect(views[0]!.composition).toMatchObject({ layout: "main", apps: ["notes", "calendar", "projects", "library"] });
  const proportions = views[0]!.composition.sizes;
  expect(proportions.columns).toHaveLength(2);
  expect(proportions.rows).toHaveLength(3);
  const before = (await section(page, "notes").boundingBox())!.width;
  await page.goto("/open/calendar");
  await page.goto("/open/notes?view=" + views[0]!.id);
  await expect.poll(async () => Math.abs((await section(page, "notes").boundingBox())!.width - before)).toBeLessThan(2);
  await page.goto(url);
  await expect.poll(async () => Math.abs((await section(page, "notes").boundingBox())!.width - before)).toBeLessThan(2);
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

test("a saved view changes on explicit update and a standalone composition link opens without its saved record", async ({
  page,
  browser,
  baseURL,
}) => {
  const views = await fixture(page);
  // Exercise the copy fallback available when a browser doesn't grant clipboard access.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }),
  );
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
  try {
    await page.getByLabel("Layout preset").selectOption("rows");
  } finally {
    navigating.resolve();
  }
  const divider = separators(page, "horizontal").first();
  await expect(divider).toBeVisible();
  await divider.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page).toHaveURL(/sizes=/);
  expect(views[0]!.composition.layout).toBe("columns");
  await page.getByRole("button", { name: "Update view" }).click();
  await expect.poll(() => views[0]!.revision).toBe(2);
  expect(views[0]!.composition.layout).toBe("rows");
  await page.getByRole("button", { name: "Copy layout link" }).click();
  const shared = await page.getByRole("textbox", { name: "Layout link" }).inputValue();
  expect(new URL(shared).searchParams.get("view")).toBeNull();
  await page.goto("/open/library?with=projects&layout=columns&sizes=32,68/100");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("View name").fill("Reference");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Reference", exact: true })).toBeVisible();
  expect(views).toHaveLength(2);
  await page.reload();
  for (const expected of [views[0]!, views[1]!, views[0]!]) {
    await page.getByRole("link", { name: expected.name, exact: true }).click();
    await expect(page.getByLabel("Layout preset")).toHaveValue(expected.composition.layout);
    await expect
      .poll(() =>
        page
          .locator("section[data-pane]")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-pane"))),
      )
      .toEqual(expected.composition.apps);
    const axis = expected.composition.layout === "columns" ? "vertical" : "horizontal";
    const first = expected.composition.sizes[axis === "vertical" ? "columns" : "rows"][0]!;
    await expect
      .poll(async () => Math.abs(Number(await separators(page, axis).first().getAttribute("aria-valuenow")) - first))
      .toBeLessThan(1);
  }
  // The same owner can open the standalone link without editing either of their saved views.
  await page.goto(shared);
  await expect(page.getByLabel("Layout preset")).toHaveValue("rows");
  await page.getByLabel("Layout preset").selectOption("columns");
  await expect(page).toHaveURL(/layout=columns/);
  expect(new URL(page.url()).searchParams.get("view")).toBeNull();
  await expect(page.getByRole("button", { name: "Update view" })).toHaveCount(0);
  expect(views.map((view) => view.revision)).toEqual([2, 1]);
  const visitor = await browser.newPage({ baseURL, viewport: { width: 1280, height: 850 } });
  try {
    const empty = await fixture(visitor);
    await visitor.goto(shared);
    await expect(visitor.locator("section[data-pane=calendar]")).toBeVisible();
    await expect(visitor.getByLabel("Layout preset")).toHaveValue("rows");
    const expected = views[0]!.composition.sizes.rows[0]!;
    await expect
      .poll(async () =>
        Math.abs(Number(await separators(visitor, "horizontal").first().getAttribute("aria-valuenow")) - expected),
      )
      .toBeLessThan(1);
    expect(empty).toHaveLength(0);
  } finally {
    await visitor.close();
  }
});
