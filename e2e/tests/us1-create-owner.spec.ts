// T026, User Story 1: install, create the owner from the server, set the password, sign in.
import { expect, test } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { createOwner, resetStack, serverCommand, sql } from "./helpers/stack.ts";
import { PASSWORD, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

test("a fresh install offers no way to create an account, and create-owner makes the owner", async ({ page }, testInfo) => {
  await resetStack();

  // Before an owner exists: an explanation of create-owner, and no form.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Space has no owner yet" })).toBeVisible();
  await expect(page.getByText("docker compose exec server create-owner")).toBeVisible();
  await expect(page.locator("form, input, button")).toHaveCount(0);
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Your Space has no owner yet" })).toBeVisible();
  await evidence(page, testInfo, "us1-1-no-owner-yet");

  // Reaching the server over the network cannot create an account.
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: new URL(page.url()).origin },
    data: { email: "visitor@example.com", name: "Visitor", password: "a-long-enough-password" },
  });
  expect(signUp.status()).toBe(400);
  expect(await sql(`select count(*) from "user"`)).toEqual(["0"]);

  // The operator creates the owner on the server.
  const created = await createOwner("Sam@Example.com", "Sam Rivera");
  expect(created.email).toBe("sam@example.com");
  expect(created.url).toMatch(/^http:\/\/localhost\/reset-password#token=[A-Za-z0-9]{24}$/);

  // The link sets the password; the token leaves the address bar once read.
  await page.goto(created.url);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await evidence(page, testInfo, "us1-2-set-password");
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Confirm the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=password_set$/);
  await expect(page.getByText("Your password is set.")).toBeVisible();

  // Sign in and reach the empty workspace: the workspace, name, email, and sign out only.
  await signIn(page, "sam@example.com");
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  await expect(page.locator('[data-field="name"]')).toHaveText("Sam Rivera");
  await expect(page.locator('[data-field="email"]')).toHaveText("sam@example.com");
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator("a, input, select, textarea")).toHaveCount(0);
  await evidence(page, testInfo, "us1-3-home");

  // The same link does not work twice. The token is checked when the form is sent, since it never
  // travels in a URL.
  const second = await page.context().newPage();
  await second.goto(created.url);
  await second.getByLabel("New password").fill("a different password entirely");
  await second.getByLabel("Confirm the password").fill("a different password entirely");
  await second.getByRole("button", { name: "Set password" }).click();
  await expect(second.getByRole("heading", { name: "This link has expired or was already used" })).toBeVisible();
  await expect(second.getByText("Your password has not been changed.")).toBeVisible();
  await expect(second.getByText("docker compose exec server reset-link")).toBeVisible();
  await evidence(second, testInfo, "us1-4-link-used");
  await second.close();

  // Running create-owner again changes nothing; sign-up stays closed.
  const again = await serverCommand("create-owner", ["--email", "other@example.com", "--name", "Other"]);
  expect(again.code).toBe(2);
  expect(again.json).toMatchObject({ ok: false, error: "owner_exists" });
  const signUpAfter = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: new URL(page.url()).origin },
    data: { email: "visitor@example.com", name: "Visitor", password: "a-long-enough-password" },
  });
  expect(signUpAfter.status()).toBe(400);
  expect(await sql(`select count(*) from "user"`)).toEqual(["1"]);
  expect(await sql(`select count(*) from organization`)).toEqual(["1"]);
  expect(await sql(`select type from event order by created_at`)).toEqual(["owner.created", "recovery.password_reset"]);
});

test("an invalid set-password link explains how to get a new one", async ({ page }, testInfo) => {
  await page.goto("/reset-password#token=not-a-real-token");
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Confirm the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("heading", { name: "This link has expired or was already used" })).toBeVisible();
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This link is incomplete" })).toBeVisible();
  await evidence(page, testInfo, "us1-5-link-incomplete");
});
