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
  expect((await stranger.request.post("/api/apps/preview", { headers: { origin: "http://localhost" }, data: { link: PROBE } })).status()).toBe(401);
  await stranger.close();

  // The container publishes no port of its own (FR-015).
  expect(await inspect("ys-whoami-web-1", "{{json .HostConfig.PortBindings}}")).toBe("{}");
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
