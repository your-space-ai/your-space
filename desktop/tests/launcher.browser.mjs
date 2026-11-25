// Run with node --test desktop/tests/launcher.browser.mjs after installing e2e's Chromium.
import assert from "node:assert/strict";
import { builtInThemes, defaultThemeId } from "../../shared/appearance/theme.mjs";
import { launcherTheme } from "../src/appearance.mjs";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const require = createRequire(new URL("../../e2e/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const launcher = new URL("../renderer/index.html", import.meta.url).href;
const local = { name: "desktop-linux", socket: "/fixtures/default.sock", detected: true };
const alternate = { name: "alt", socket: "/fixtures/other.sock", detected: false };
let browser;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser?.close(); });

async function launch(t, handlers) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const calls = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.exposeFunction("testDispatch", (method, arg) => {
    if (method === "appearance" && !handlers.appearance) return launcherTheme();
    // Reading the saved list isn't recorded; tests that don't set it see none saved.
    if (method === "workspaces") return handlers.workspaces ? handlers.workspaces() : { workspaces: [] };
    calls.push({ method, arg });
    if (!Object.hasOwn(handlers, method)) throw new Error("Unexpected bridge call");
    return handlers[method](arg);
  });
  await page.addInitScript(() => {
    window.yourSpace = Object.fromEntries(["appearance", "engines", "start", "createOwner", "connect", "openDockerGuide",
      "workspaces", "open", "rename", "remove"].map(method => [method, arg => window.testDispatch(method, arg)]));
    // The main process's refresh, which a test sends with window.testRefresh().
    window.yourSpace.onRefresh = callback => { window.testRefresh = callback; };
  });
  await page.goto(launcher);
  return { page, calls };
}

test("an existing server opens without Docker and refuses a pasted setup link", async (t) => {
  const { page, calls } = await launch(t, { connect: () => ({ state: "ready", origin: "https://space.example" }) });
  await page.getByRole("button", { name: /Connect to a server/ }).click();
  await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeFocused();
  await page.getByLabel("Server address").fill("https://space.example/reset-password#token=example");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  assert.equal(await page.getByLabel("Server address").evaluate(input => input.checkValidity()), false);
  assert.deepEqual(calls, []);
  await page.getByLabel("Server address").fill("https://space.example/");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  assert.deepEqual(calls, [{ method: "connect", arg: { url: "https://space.example", name: "" } }]);
});

test("loopback HTTP works, remote HTTP is refused, and a failed connection can be retried", async (t) => {
  let connected = false;
  const { page, calls } = await launch(t, {
    connect: () => connected ? { state: "ready" } : { error: { code: "unreachable", message: "Could not reach this server." } },
  });
  await page.getByRole("button", { name: /Connect to a server/ }).click();
  await expect(page.locator("#remote .intro")).toContainText("http://space.localhost:8081");
  const address = page.getByLabel("Server address");
  await address.fill("http://localhost.workspace.example");
  await address.press("Enter");
  assert.equal(await address.evaluate(input => input.checkValidity()), false);
  assert.match(await address.evaluate(input => input.validationMessage), /http:\/\/space\.localhost and its port/);
  assert.deepEqual(calls, []);
  await address.fill("http://space.localhost:8080");
  await address.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Could not reach this server.");
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled();
  connected = true;
  await address.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  await expect(page.getByRole("alert")).toBeEmpty();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.at(-1), { method: "connect", arg: { url: "http://space.localhost:8080", name: "" } });
});

test("local first run shows a detected engine, an alternate context, and owner setup", async (t) => {
  const { page, calls } = await launch(t, {
    engines: () => ({ engines: [local, alternate], saved: null }),
    start: () => ({ state: "owner-needed" }),
    createOwner: () => ({ state: "ready" }),
  });
  await page.getByRole("button", { name: /Run on this Mac/ }).click();
  await expect(page.locator("#endpoint")).toHaveText(local.socket);
  await page.getByText("Choose another engine").click();
  await page.getByLabel("Local Docker context").selectOption(alternate.name);
  await expect(page.locator("#endpoint")).toHaveText(alternate.socket);
  await page.getByRole("button", { name: "Open local workspace" }).click();
  await expect(page.getByRole("heading", { name: "Create your owner account" })).toBeFocused();
  await page.getByLabel("Your name").fill("Demo Owner");
  await page.getByLabel("Username").fill("demo.owner");
  await page.getByRole("button", { name: "Continue to password setup" }).click();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  assert.deepEqual(calls.slice(1), [
    { method: "start", arg: { engine: "alt", expectedSocket: alternate.socket } },
    { method: "createOwner", arg: { name: "Demo Owner", username: "demo.owner" } },
  ]);
});

test("a missing engine offers the guide, retry, and a manual socket", async (t) => {
  let checks = 0;
  const { page, calls } = await launch(t, {
    engines: () => ++checks === 1
      ? { engines: [], saved: null, problem: { code: "docker_missing", message: "Install Docker and try again." } }
      : { engines: [local], saved: null },
    openDockerGuide: () => ({}),
    start: () => ({ state: "ready" }),
  });
  await page.getByRole("button", { name: /Run on this Mac/ }).click();
  await expect(page.getByRole("alert")).toHaveText("Install Docker and try again.");
  await expect(page.getByRole("button", { name: "Open local workspace" })).toBeDisabled();
  await page.getByRole("button", { name: "Docker Desktop setup guide" }).click();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.locator("#endpoint")).toHaveText(local.socket);
  await page.getByText("Choose another engine").click();
  await page.getByLabel("Local Docker context").selectOption({ label: "Enter a Unix socket path" });
  await page.getByLabel("Unix socket path").fill("tcp://elsewhere");
  await page.getByRole("button", { name: "Open local workspace" }).click();
  assert.equal(await page.getByLabel("Unix socket path").evaluate(input => input.checkValidity()), false);
  await page.getByLabel("Unix socket path").fill("/fixture/manual.sock");
  await page.getByRole("button", { name: "Open local workspace" }).click();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  assert.deepEqual(calls.at(-1), { method: "start", arg: { engine: "/fixture/manual.sock", expectedSocket: "/fixture/manual.sock" } });
});

test("relaunch preserves a saved manual socket and never silently switches a changed context", async (t) => {
  const custom = "/fixtures/manual.sock";
  let saved = { name: custom, socket: custom };
  const { page } = await launch(t, { engines: () => ({ engines: [local, alternate], saved }) });
  await page.getByRole("button", { name: /Run on this Mac/ }).click();
  await expect(page.getByLabel("Unix socket path")).toHaveValue(custom);
  await expect(page.locator("#endpoint")).toHaveText(custom);
  saved = { name: local.name, socket: "/fixtures/previous.sock" };
  await page.reload();
  await page.getByRole("button", { name: /Run on this Mac/ }).click();
  await expect(page.getByRole("alert")).toContainText("changed or is unavailable");
  await expect(page.getByRole("button", { name: "Open local workspace" })).toBeDisabled();
});

test("remote connection remains available during a slow local engine check", async (t) => {
  let finish;
  const { page } = await launch(t, {
    engines: () => new Promise(resolve => { finish = resolve; }),
    connect: () => ({ state: "ready" }),
  });
  await page.getByRole("button", { name: /Run on this Mac/ }).click();
  await expect(page.getByRole("status")).toHaveText("Checking local Docker engines…");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: /Connect to a server/ }).click();
  await page.getByLabel("Server address").fill("https://space.example");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  finish({ engines: [], saved: null, problem: { code: "engine_missing", message: "Stopped" } });
  await expect(page.getByRole("alert")).toBeEmpty();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
});

test("the launcher follows the Mac's light or dark appearance in the default theme and offers no picker", async (t) => {
  const { page, calls } = await launch(t, {});
  const background = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--bg"));
  const { theme } = builtInThemes.find(entry => entry.id === defaultThemeId);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe(theme.light.bg);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe(theme.dark.bg);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByRole("button", { name: "Appearance" })).toHaveCount(0);
  assert.deepEqual(calls, []);
});

const day = 86_400_000;
const thisMac = { name: "This Mac", origin: "http://space.localhost:8081", local: true, lastOpened: Date.now() - day, running: true };
const home = { name: "Home server", origin: "https://home.example.com", local: false, lastOpened: Date.now(), running: false };
const office = { name: "office.example.com", origin: "https://office.example.com", local: false, lastOpened: Date.now() - 2 * day, running: false };

function rowButton(page, name) {
  return page.getByRole("listitem").filter({ hasText: name }).locator("button.saved-open");
}

test("saved workspaces are the launcher's main content, each opened with a click", async (t) => {
  const { page, calls } = await launch(t, {
    workspaces: () => ({ workspaces: [thisMac, home, office] }),
    open: () => ({ state: "ready", origin: home.origin }),
  });
  await expect(page.getByRole("heading", { name: "Open a workspace" })).toBeVisible();
  await expect(page.locator("#welcome .intro")).toHaveText("Choose one you use, or add another.");
  await expect(page.getByRole("listitem")).toHaveText([/This Mac.*http:\/\/space\.localhost:8081.*Running/, /Home server.*https:\/\/home\.example\.com.*Today/,
    /office\.example\.com.*https:\/\/office\.example\.com.*2 days ago/]);
  await expect(page.getByRole("button", { name: /Connect to a server/ })).toBeHidden();
  // This Mac is saved, so only adding a server is offered below the list.
  await expect(page.getByRole("button", { name: "Add a server" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run on this Mac", exact: true })).toBeHidden();
  await rowButton(page, "Home server").click();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  assert.deepEqual(calls, [{ method: "open", arg: { origin: home.origin } }]);

  // When the launcher shows again after the workspace opened, it shows the list without the old status.
  await page.evaluate(() => window.testRefresh());
  await expect(page.getByRole("status")).toBeEmpty();
  await expect(rowButton(page, "Home server")).toBeFocused();
});

test("a server is added with an optional name, and Back returns to the same place in the list", async (t) => {
  const many = Array.from({ length: 14 }, (_, i) => ({ ...office, name: `Server ${i + 1}`, origin: `https://s${i + 1}.example.com` }));
  const { page, calls } = await launch(t, {
    workspaces: () => ({ workspaces: many }),
    connect: () => ({ state: "ready" }),
  });
  await page.setViewportSize({ width: 700, height: 600 });
  // Without This Mac saved, running here stays on offer.
  await expect(page.getByRole("button", { name: "Run on this Mac", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add a server" });
  await add.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  assert.ok(scroll > 0);
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(add).toBeFocused();
  assert.equal(await page.evaluate(() => window.scrollY), scroll);

  await add.click();
  await page.getByLabel("Server address").fill("https://new.example.com");
  await expect(page.getByLabel("Name (optional)")).toHaveAttribute("placeholder", "new.example.com");
  await page.getByLabel("Name (optional)").fill("  Studio  ");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  assert.deepEqual(calls, [{ method: "connect", arg: { url: "https://new.example.com", name: "Studio" } }]);
});

test("rename and remove happen in the launcher, by keyboard, with an in-app confirmation", async (t) => {
  let list = [thisMac, home, office];
  const { page, calls } = await launch(t, {
    workspaces: () => ({ workspaces: list }),
    rename: ({ origin, name }) => name === "Refused" ? { error: { code: "invalid_name", message: "Enter another name." } }
      : { workspaces: list = list.map(entry => entry.origin === origin ? { ...entry, name: name || "home.example.com" } : entry) },
    remove: ({ origin }) => ({ workspaces: list = list.filter(entry => entry.origin !== origin) }),
  });
  page.on("dialog", () => assert.fail("No native dialog"));
  const edit = page.getByRole("button", { name: "Rename or remove Home server" });
  await edit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename or remove" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expect(dialog).toContainText("https://home.example.com");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();

  await page.keyboard.press("Enter");
  await dialog.getByLabel("Name").fill("Refused");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Enter another name.");
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByLabel("Name").fill("Garage");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Rename or remove Garage" })).toBeFocused();
  await expect(rowButton(page, "Garage")).toContainText("https://home.example.com");

  // Remove asks first, in the page, and says nothing on the server changes.
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Remove…" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove “Garage”?" });
  await expect(confirm).toContainText("the workspace and its data stay on the server");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Rename or remove Garage" })).toBeFocused();
  assert.equal(calls.filter(call => call.method === "remove").length, 0);
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Remove…" }).click();
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(rowButton(page, "office.example.com")).toBeFocused();

  // Removing This Mac only forgets it, and running here is offered again.
  await page.getByRole("button", { name: "Rename or remove This Mac" }).click();
  await dialog.getByRole("button", { name: "Remove…" }).click();
  await expect(page.getByRole("dialog", { name: "Remove “This Mac”?" })).toContainText("isn’t stopped or uninstalled");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run on this Mac", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rename or remove office.example.com" }).click();
  await dialog.getByRole("button", { name: "Remove…" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();

  // With nothing saved, the first-run choices come back.
  await expect(page.getByRole("heading", { name: "Open your workspace" })).toBeFocused();
  await expect(page.getByRole("button", { name: /Connect to a server/ })).toBeVisible();
  assert.deepEqual(calls.filter(call => call.method !== "rename"), [
    { method: "remove", arg: { origin: home.origin } },
    { method: "remove", arg: { origin: thisMac.origin } },
    { method: "remove", arg: { origin: office.origin } },
  ]);
});

test("This Mac that can't start leads to the engine check with the reason, and Back returns to its row", async (t) => {
  const { page, calls } = await launch(t, {
    workspaces: () => ({ workspaces: [{ ...thisMac, running: false }, home] }),
    open: () => ({ error: { code: "start_failed", message: "The local workspace could not start." } }),
    engines: () => ({ engines: [local], saved: { name: local.name, socket: local.socket } }),
  });
  await expect(rowButton(page, "This Mac")).toContainText("Yesterday");
  await rowButton(page, "This Mac").click();
  await expect(page.getByRole("heading", { name: "Run on this Mac" })).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText("The local workspace could not start.");
  await expect(page.locator("#endpoint")).toHaveText(local.socket);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(rowButton(page, "This Mac")).toBeFocused();
  assert.deepEqual(calls.map(call => call.method), ["open", "engines"]);
});

test("the Workspace menu's requests show the address form or open a saved workspace", async (t) => {
  let request;
  const { page, calls } = await launch(t, {
    workspaces: () => {
      const reply = { workspaces: [home, office], ...(request ? { request } : {}) };
      request = undefined;
      return reply;
    },
    open: () => ({ state: "ready" }),
  });
  await expect(rowButton(page, "Home server")).toBeVisible();
  request = { view: "remote" };
  await page.evaluate(() => window.testRefresh());
  await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeFocused();
  request = { open: office.origin };
  await page.evaluate(() => window.testRefresh());
  await expect(page.getByRole("status")).toHaveText("Opening your dashboard…");
  await expect(page.getByRole("heading", { name: "Open a workspace" })).toBeVisible();
  request = { view: "list" };
  await page.evaluate(() => window.testRefresh());
  await expect(page.getByRole("status")).toBeEmpty();
  assert.deepEqual(calls, [{ method: "open", arg: { origin: office.origin } }]);
});
