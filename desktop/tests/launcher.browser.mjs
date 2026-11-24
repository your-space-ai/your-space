// Run with node --test desktop/tests/launcher.browser.mjs after installing e2e's Chromium.
import assert from "node:assert/strict";
import { builtInThemes } from "../../shared/appearance/theme.mjs";
import { launcherAppearance } from "../src/appearance.mjs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const require = createRequire(new URL("../../e2e/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const launcher = new URL("../renderer/index.html", import.meta.url).href;
const local = { name: "desktop-linux", socket: "/fixtures/default.sock", detected: true };
const alternate = { name: "alt", socket: "/fixtures/other.sock", detected: false };
let browser;
// The library a launcher without a saved choice offers: the built-in themes, Cerulean selected.
const defaultLibrary = await launcherAppearance(join(tmpdir(), "ys-launcher-missing-" + process.pid, "launcher-theme.json")).get();

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
    if (method === "appearance" && !handlers.appearance) return defaultLibrary;
    calls.push({ method, arg });
    if (!Object.hasOwn(handlers, method)) throw new Error("Unexpected bridge call");
    return handlers[method](arg);
  });
  await page.addInitScript(() => {
    window.yourSpace = Object.fromEntries(["appearance", "previewTheme", "saveTheme", "engines", "start", "createOwner", "connect", "openDockerGuide"]
      .map(method => [method, arg => window.testDispatch(method, arg)]));
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
  assert.deepEqual(calls, [{ method: "connect", arg: { url: "https://space.example" } }]);
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
  assert.deepEqual(calls.at(-1), { method: "connect", arg: { url: "http://space.localhost:8080" } });
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

test("the launcher follows the Mac's light or dark appearance and previews a theme before saving it", async (t) => {
  const { page, calls } = await launch(t, { saveTheme: ({ id }) => ({ ...defaultLibrary, selected: id }) });
  const background = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--bg"));
  const [cerulean, , fern] = builtInThemes.map(({ theme }) => theme);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe(cerulean.light.bg);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe(cerulean.dark.bg);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByRole("radio", { name: "Cerulean" })).toBeChecked();
  await page.getByRole("radio", { name: "Fern" }).check();
  await expect.poll(background).toBe(fern.dark.bg);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe(fern.light.bg);
  await page.getByRole("button", { name: "Use theme" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual(calls, [{ method: "saveTheme", arg: { id: "fern", text: undefined } }]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe(fern.dark.bg);
});
