import { expect, test } from "@playwright/test";
import { starterThemes } from "../../appearance/theme.mjs";

test("reloading an interrupted installation restores the reviewed commit for explicit confirmation", async ({
  page,
}) => {
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
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const { pathname, searchParams } = new URL(req.url());
    let json: unknown;
    if (req.method() === "POST") {
      writes.push({ path: pathname, body: req.postDataJSON() });
      json = { status: "applied", commit };
    } else if (pathname === "/api/auth/get-session") {
      json = {
        user: { id: appId, name: "Owner", email: "fixture@example.test" },
        session: { id: previewId, userId: appId, expiresAt: "2099-01-01" },
      };
    } else if (pathname === "/api/auth/organization/list") json = [{ id: appId, name: "Fixture", slug: "fixture" }];
    else if (pathname === "/api/appearance/active") json = starterThemes[0]!.theme;
    else if (pathname === "/api/status") json = { owner: true };
    else if (pathname === "/api/apps") json = { apps: [app] };
    else if (pathname === "/api/apps/desk") json = app;
    else if (pathname === "/api/repositories/connection")
      json = { configured: true, connected: true, login: "fixture", scope: "repo" };
    else if (pathname === "/api/repositories") json = { repos: [repo], agents: [], grants: [] };
    else if (pathname === "/api/repositories/123/deploy/pending") {
      expect(searchParams.get("appId")).toBe(appId);
      lookups++;
      json = { pending: writes.length ? null : plan };
    } else json = {};
    await route.fulfill({ json });
  });
  await page.goto("/repositories?app=desk");
  await expect(page.getByRole("heading", { name: "Resume deployment to Desk" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resume deployment to Desk" })).toBeVisible();
  await expect(page.getByText(commit, { exact: true })).toBeVisible();
  expect(lookups).toBeGreaterThanOrEqual(2);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Resume reviewed deployment" }).click();
  await expect(page.getByRole("status")).toContainText("Deployment applied");
  expect(writes).toEqual([{ path: "/api/repositories/123/deploy/apply", body: { appId, previewId, commit } }]);
  await expect(page.getByRole("button", { name: "Resume reviewed deployment" })).toHaveCount(0);
});
