import { expect, test, type Page } from "@playwright/test";
import { starterThemes } from "../../appearance/theme.mjs";

async function recoveryFixture(page: Page, response: "received" | "lost-applied" | "lost-pending" | "truncated" | "rollback") {
  const appId = "d1234567-1234-4123-8123-123456789abc";
  const previewId = "e1234567-1234-4123-8123-123456789abc";
  const commit = "b".repeat(40);
  const repo = { id: "123", fullName: "fixture/desk", origin: "created", defaultBranch: "main", private: true };
  const app = {
    id: appId,
    name: "desk",
    title: "Desk",
    state: "failed",
    source: { repo: repo.fullName, path: "compose.yaml" },
  };
  const plan = {
    appId,
    previewId,
    commit,
    repoId: repo.id,
    repo: repo.fullName,
    previousCommit: "a".repeat(40),
    images: { "fixture/web:1": { digest: "sha256:" + "c".repeat(64) } },
    services: ["web"],
    volumes: ["storage"],
  };
  let lookups = 0;
  let receiptReads = 0;
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const { pathname, searchParams } = new URL(req.url());
    let json: unknown;
    if (req.method() === "POST") {
      writes.push({ path: pathname, body: req.postDataJSON() });
      if (response === "rollback") return route.fulfill({
        status: 502,
        json: { error: "previous_artifacts_restored", message: "Deployment failed. The previous app was restored." },
      });
      if (response === "truncated") return route.fulfill({ contentType: "application/json", body: '{"status":' });
      if (response !== "received") return route.abort("connectionreset");
      json = { status: "applied", appId, repoId: repo.id, commit };
    } else if (pathname === "/api/auth/get-session") {
      json = {
        user: { id: appId, name: "Owner", email: "fixture@example.test" },
        session: { id: previewId, userId: appId, expiresAt: "2099-01-01" },
      };
    } else if (pathname === "/api/auth/organization/list") json = [{ id: appId, name: "Fixture", slug: "fixture" }];
    else if (pathname === "/api/appearance/active") json = starterThemes[0]!.theme;
    else if (pathname === "/api/status") json = { owner: true };
    else if (pathname === "/api/workspace-layout") json = { revision: 1, appOrder: [app.name], views: [] };
    else if (pathname === "/api/apps") json = { apps: [app] };
    else if (pathname === "/api/apps/desk") json = app;
    else if (pathname === "/api/repositories/connection")
      json = { configured: true, connected: true, login: "fixture", scope: "repo" };
    else if (pathname === "/api/repositories") json = { repos: [repo], agents: [], grants: [] };
    else if (pathname === "/api/repositories/123/deploy/pending") {
      expect(searchParams.get("appId")).toBe(appId);
      lookups++;
      json = { pending: writes.length && response !== "lost-pending" ? null : plan };
    } else if (pathname === "/api/repositories/123/deploy/receipt") {
      expect(req.method()).toBe("GET");
      expect(Object.fromEntries(searchParams)).toEqual({ appId, previewId, commit });
      receiptReads++;
      if (response === "lost-applied" && receiptReads <= 2) {
        json = { receipt: null, applying: true };
      } else {
        const confirmed = response === "lost-applied" || response === "truncated";
        json = { receipt: confirmed ? { status: "applied", appId, repoId: repo.id, commit } : null };
      }
    } else json = {};
    await route.fulfill({ json });
  });
  return {
    commit,
    lookups: () => lookups,
    receiptReads: () => receiptReads,
    writes,
    expectedWrite: { path: "/api/repositories/123/deploy/apply", body: { appId, previewId, commit } },
  };
}

test("reloading an interrupted installation restores the reviewed commit for explicit confirmation", async ({ page }) => {
  const fixture = await recoveryFixture(page, "received");
  await page.goto("/repositories?app=desk");
  await expect(page.getByRole("heading", { name: "Resume deployment to Desk" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resume deployment to Desk" })).toBeVisible();
  await expect(page.getByText(fixture.commit, { exact: true })).toBeVisible();
  expect(fixture.lookups()).toBeGreaterThanOrEqual(2);
  expect(fixture.writes).toEqual([]);
  await page.getByRole("button", { name: "Resume reviewed deployment" }).click();
  await expect(page.getByRole("status")).toContainText("Deployment applied");
  expect(fixture.writes).toEqual([fixture.expectedWrite]);
  expect(fixture.receiptReads()).toBe(0);
  await expect(page.getByRole("button", { name: "Resume reviewed deployment" })).toHaveCount(0);
});

test("a lost deployment response recovers only the exact applied receipt without another write", async ({ page }) => {
  const fixture = await recoveryFixture(page, "lost-applied");
  await page.goto("/repositories?app=desk");
  await page.getByRole("button", { name: "Resume reviewed deployment" }).click();
  await expect(page.getByRole("status")).toContainText("Checking whether the reviewed deployment finished");
  await expect(page.getByRole("status")).toContainText("Deployment applied");
  await expect(page.getByRole("link", { name: "View installation" })).toBeVisible();
  expect(fixture.receiptReads()).toBe(3);
  expect(fixture.writes).toEqual([fixture.expectedWrite]);
});

test("a pending deployment with a lost response requires another explicit owner decision", async ({ page }) => {
  const fixture = await recoveryFixture(page, "lost-pending");
  await page.goto("/repositories?app=desk");
  const resume = page.getByRole("button", { name: "Resume reviewed deployment" });
  await resume.click();
  await expect(page.getByRole("alert")).toContainText("couldn't confirm");
  await expect(page.getByRole("link", { name: "Check installation status" })).toBeVisible();
  await expect(resume).toBeEnabled();
  await expect(page.getByRole("link", { name: "View installation" })).toHaveCount(0);
  expect(fixture.receiptReads()).toBeGreaterThan(0);
  expect(fixture.writes).toEqual([fixture.expectedWrite]);
});

test("an incomplete successful response still needs an exact receipt", async ({ page }) => {
  const fixture = await recoveryFixture(page, "truncated");
  await page.goto("/repositories?app=desk");
  await page.getByRole("button", { name: "Resume reviewed deployment" }).click();
  await expect(page.getByRole("status")).toContainText("Deployment applied");
  expect(fixture.receiptReads()).toBe(1);
  expect(fixture.writes).toEqual([fixture.expectedWrite]);
});

test("a known deployment rollback is reported without checking for a receipt", async ({ page }) => {
  const fixture = await recoveryFixture(page, "rollback");
  await page.goto("/repositories?app=desk");
  await page.getByRole("button", { name: "Resume reviewed deployment" }).click();
  await expect(page.getByRole("alert")).toContainText("The previous app was restored");
  await expect(page.getByRole("link", { name: "View installation" })).toHaveCount(0);
  expect(fixture.receiptReads()).toBe(0);
  expect(fixture.writes).toEqual([fixture.expectedWrite]);
});
