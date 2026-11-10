// Shared steps in the web client.
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery staple";

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  if (!page.url().includes("/sign-in")) await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  // Wait for the server's answer, so a following navigation cannot cancel the request.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/auth/sign-in/email")),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}
