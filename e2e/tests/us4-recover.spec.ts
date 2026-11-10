// T046, User Story 4: reset-link recovers the owner without email and signs out every session.
import { expect, test } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { createOwner, identities, resetLink, resetStack, sql } from "./helpers/stack.ts";
import { PASSWORD, setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const EMAIL = "sam@example.com";
const NEW_PASSWORD = "a brand new passphrase for sam";

test.beforeAll(async () => {
  await resetStack();
});

test("reset-link sets a new password and signs out every device", async ({ browser }, testInfo) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const laptop = await first.newPage();
  const phone = await second.newPage();

  const { url } = await createOwner(EMAIL, "Sam Rivera");
  await setPassword(laptop, url);
  await signIn(laptop, EMAIL);
  await expect(laptop.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  await signIn(phone, EMAIL);
  await expect(phone.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  const before = await identities();

  // Issuing a link changes nothing by itself.
  const link = await resetLink();
  expect(link.email).toBe(EMAIL);
  await laptop.reload();
  await expect(laptop.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  expect(await sql("select count(*) from session")).toEqual(["2"]);

  // Use the link in a third browser.
  const recovery = await (await browser.newContext()).newPage();
  await setPassword(recovery, link.url, NEW_PASSWORD);
  await evidence(recovery, testInfo, "us4-1-password-reset");

  // A page left open notices on its next refresh (here, returning to the tab) and goes to sign-in
  // instead of showing stale data.
  await expect(phone.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
  await expect(phone).toHaveURL(/\/sign-in\?notice=expired$/);
  await expect(phone.getByText("Your session has ended. Sign in again to continue.")).toBeVisible();
  await evidence(phone, testInfo, "us4-2-other-device-signed-out");

  // Both earlier sessions are signed out.
  for (const page of [laptop, phone]) {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  }
  expect(await sql("select count(*) from session")).toEqual(["0"]);

  // Same account and workspace; the email is still unverified.
  expect(await identities()).toEqual(before);
  expect(await sql(`select email_verified from "user"`)).toEqual(["f"]);
  expect(await sql("select type from event order by created_at")).toEqual([
    "owner.created",
    "recovery.password_reset",
    "recovery.link_issued",
    "recovery.password_reset",
  ]);

  // The old password no longer works and the new one does (pacing for the sign-in limit).
  await laptop.waitForTimeout(11_000);
  await signIn(laptop, EMAIL, PASSWORD);
  await expect(laptop.getByRole("alert")).toHaveText("That email and password don't match.");
  await signIn(laptop, EMAIL, NEW_PASSWORD);
  await expect(laptop.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  await evidence(laptop, testInfo, "us4-3-signed-in-with-new-password");

  // The link works once.
  const reuse = await (await browser.newContext()).newPage();
  await reuse.goto(link.url);
  await reuse.getByLabel("New password").fill("yet another passphrase here");
  await reuse.getByLabel("Confirm the password").fill("yet another passphrase here");
  await reuse.getByRole("button", { name: "Set password" }).click();
  await expect(reuse.getByRole("heading", { name: "This link has expired or was already used" })).toBeVisible();

  // Without server access there is no way to get a link from the web.
  const request = await reuse.request.post("/api/auth/request-password-reset", {
    headers: { origin: "http://localhost" },
    data: { email: EMAIL },
  });
  expect(request.status()).toBe(400);
  expect(await sql("select count(*) from verification")).toEqual(["0"]);
});
