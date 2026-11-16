// Journey 002: install apps from their own Compose files and use them in Your Space. A stand-in for
// GitHub serves the fixture apps (e2e/github); Sure and Twenty run by hand (verification record).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { compose, createOwner, docker, resetStack, serverCommand, up } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const WHOAMI = "https://github.com/ys-fixtures/whoami/blob/main/compose.yaml";
const PROBE = "https://github.com/ys-fixtures/probe/blob/main/compose.yaml";
const LINK_LABEL = "Link to the app's Compose file";

// The owner signs in once: sign-in allows three attempts per address in 10 seconds (journey 001).
let ownerCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

async function asOwner(page: Page): Promise<void> {
  if (ownerCookies.length) return page.context().addCookies(ownerCookies);
  await signIn(page, "sam");
  await expect(page).toHaveURL(/\/$/);
  ownerCookies = await page.context().cookies();
}

async function waitForJob(page: Page): Promise<void> {
  const job = page.locator("section.job");
  await expect(job).toHaveAttribute("data-job-state", /succeeded|failed/, { timeout: 120_000 });
  // On failure, the job's own steps and error say why.
  expect(await job.getAttribute("data-job-state"), (await job.textContent()) ?? "").toBe("succeeded");
}

async function inspect(container: string, format: string): Promise<string> {
  return (await docker(["inspect", container, "--format", format], false)).stdout.trim();
}

test("the owner installs an app from its link, after a review and a trust warning", async ({ page, browser }, testInfo) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  ownerCookies = [];
  await asOwner(page);

  await page.goto("/apps");
  await expect(page.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
  await expect(page.locator("li[data-app]")).toHaveCount(0);

  await page.getByLabel(LINK_LABEL).fill(WHOAMI);
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByText("Published ports removed")).toBeVisible();
  await expect(page.getByText(/trusts it with everything/)).toBeVisible();
  // The generated secret replaces the published default, and neither is shown (FR-006).
  await expect(page.locator("body")).not.toContainText("published-default-token");
  await evidence(page, testInfo, "002-us3-1-review");

  await page.getByRole("button", { name: "Install" }).click();
  await waitForJob(page);
  await page.goto("/apps");
  await expect(page.locator('li[data-app="whoami"]')).toHaveAttribute("data-app-state", "running");
  await evidence(page, testInfo, "002-us3-2-installed");

  // Nobody else can list or install apps (FR-010).
  const stranger = await browser.newContext();
  const refused = await stranger.request.get("/api/apps");
  expect(refused.status()).toBe(401);
  expect((await stranger.request.post("/api/apps/preview", { headers: { origin: "http://space.localhost" }, data: { link: PROBE } })).status()).toBe(401);
  await stranger.close();

  // The container publishes no port of its own (FR-015).
  expect(await inspect("ys-whoami-web-1", "{{json .HostConfig.PortBindings}}")).toBe("{}");
});

test("the app opens in a pane on its own origin, only for the signed-in owner", async ({ page, browser, browserName }) => {
  await asOwner(page);
  await page.goto("/open/whoami");
  const pane = page.frameLocator('[data-testid="app-pane"]');
  let echoed: string;
  if (browserName === "webkit") {
    // WebKit treats each *.localhost name as its own site and blocks the app's cookies in a pane,
    // so on this setup the app opens in its own tab instead (FR-016).
    await expect(pane.getByRole("heading", { name: "This browser won't run the app here" })).toBeVisible({ timeout: 30_000 });
    const [tab] = await Promise.all([page.context().waitForEvent("page"), pane.getByRole("link", { name: "Open in its own tab" }).click()]);
    await expect(tab.locator("body")).toContainText("Hostname", { timeout: 30_000 });
    echoed = (await tab.locator("body").textContent()) ?? "";
    await tab.close();
  } else {
    await expect(pane.locator("body")).toContainText("Hostname", { timeout: 30_000 });
    echoed = (await pane.locator("body").textContent()) ?? "";
  }
  // whoami echoes the request it received: its own host, and none of Your Space's cookies.
  expect(echoed).toContain("Host: whoami.space.localhost");
  expect(echoed).not.toMatch(/ys-pass|session_token/);

  // Only Your Space may frame the app.
  const direct = await page.request.get("http://whoami.space.localhost/");
  expect(direct.headers()["content-security-policy"]).toContain("frame-ancestors http://space.localhost:*");
  expect(direct.headers()["x-frame-options"]).toBeUndefined();

  // Someone who isn't signed in reaches no part of the app (SC-005).
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto("http://whoami.space.localhost/anything");
  await expect(visitor).toHaveURL(/^http:\/\/space\.localhost(:\d+)?\/sign-in/);
  await expect(visitor.locator("body")).not.toContainText("Hostname");
  await stranger.close();
});

test("the owner sees the engine and what each app uses", async ({ page }) => {
  await asOwner(page);
  await page.goto("/engine");
  await expect(page.getByRole("heading", { name: "Engine" })).toBeVisible();
  await expect(page.locator("[data-field=reachable]")).toHaveText("Reachable");
  await expect(page.locator('tr[data-app="whoami"]')).toBeVisible();
});

test("restarting Your Space leaves apps running; stopping it stops them, and starting brings them back", async ({ page }) => {
  const started = await inspect("ys-whoami-web-1", "{{.State.StartedAt}}");
  await compose(["restart", "server", "runtime", "caddy"], { timeout: 120_000 });
  await up();
  expect(await inspect("ys-whoami-web-1", "{{.State.StartedAt}}")).toBe(started);
  await asOwner(page);
  await page.goto("/apps");
  await expect(page.locator('li[data-app="whoami"]')).toHaveAttribute("data-app-state", "running");

  // The documented stop: the runtime manager stops the apps, then Compose stops Your Space.
  await compose(["exec", "-T", "runtime", "stop-apps"]);
  expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("false");
  await compose(["stop"], { timeout: 120_000 });
  await up();
  await expect(async () => {
    expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("true");
  }).toPass({ timeout: 60_000 });
});
