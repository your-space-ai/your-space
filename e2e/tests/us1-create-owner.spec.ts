// T026, User Story 1: install, create the owner from the server, set the password, sign in.
import { expect, test } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { createOwner, resetStack, serverCommand, sql } from "./helpers/stack.ts";

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
});
