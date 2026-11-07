// T051 (browser half), cross-cutting scenario 2: after setup, sign-in, failures, and recovery, the
// stack's logs hold no passwords, tokens, set-password or reset links, or session values.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createOwner, logs, resetLink, resetStack } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

const EMAIL = "sam@example.com";
const FIRST_PASSWORD = "first passphrase for the log check";
const WRONG_PASSWORD = "wrong passphrase for the log check";
const SECOND_PASSWORD = "second passphrase for the log check";

function stackSecrets(): string[] {
  const env = readFileSync(new URL("../stack.env", import.meta.url), "utf8");
  return env
    .split("\n")
    .filter((line) => /^(BETTER_AUTH_SECRET|POSTGRES_PASSWORD)=/.test(line))
    .map((line) => line.slice(line.indexOf("=") + 1).trim())
    .filter(Boolean);
}

test("logs contain no credentials after the whole journey", async ({ page, context }) => {
  await resetStack();
  const secrets: string[] = [FIRST_PASSWORD, WRONG_PASSWORD, SECOND_PASSWORD];

  const created = await createOwner(EMAIL, "Sam Rivera");
  secrets.push(created.token, created.url);
  await setPassword(page, created.url, FIRST_PASSWORD);

  await signIn(page, EMAIL, WRONG_PASSWORD);
  await expect(page.getByRole("alert")).toBeVisible();
  await signIn(page, EMAIL, FIRST_PASSWORD);
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  for (const cookie of await context.cookies()) {
    secrets.push(cookie.value, decodeURIComponent(cookie.value), decodeURIComponent(cookie.value).split(".")[0]!);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // Refused requests: sign-up, an emailed reset link, a bad token.
  const origin = { origin: "http://localhost" };
  await page.request.post("/api/auth/sign-up/email", { headers: origin, data: { email: "x@example.com", name: "X", password: WRONG_PASSWORD } });
  await page.request.post("/api/auth/request-password-reset", { headers: origin, data: { email: EMAIL } });
  await page.request.post("/api/auth/reset-password", { headers: origin, data: { token: "not-a-real-token", newPassword: WRONG_PASSWORD } });

  const reset = await resetLink();
  secrets.push(reset.token, reset.url);
  await setPassword(page, reset.url, SECOND_PASSWORD);

  const output = await logs();
  expect(output.length).toBeGreaterThan(0);
  for (const secret of [...secrets, ...stackSecrets()]) {
    expect(secret.length).toBeGreaterThan(8);
    expect(output.includes(secret), `logs must not contain ${secret.slice(0, 4)}…`).toBe(false);
  }
  expect(output).not.toMatch(/reset-password#token=/);
});
