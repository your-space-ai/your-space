// Shared steps in the web client.
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery staple";

export async function setPassword(page: Page, url: string, password = PASSWORD): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm the password").fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=password_set$/);
}

export async function signIn(page: Page, username: string, password = PASSWORD): Promise<void> {
  if (!page.url().includes("/sign-in")) await page.goto("/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  // Wait for the server's answer, so a following navigation cannot cancel the request.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/auth/sign-in/username")),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}
