// T040, User Story 3: restarts and recreation keep everything; a database outage is reported as a
// storage problem and never as "no owner yet".
import { expect, test } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { compose, createOwner, identities, resetStack, serverCommand, sql, up } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const USERNAME = "sam";
let before: string[];

test.beforeAll(async () => {
  await resetStack();
});

async function expectHome(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
}

test("restart and recreation keep the account, workspace, ownership, and session", async ({ page }, testInfo) => {
  const { url } = await createOwner(USERNAME, "Sam Rivera");
  await setPassword(page, url);
  await signIn(page, USERNAME);
  await expectHome(page);
  before = await identities();
  expect(before).toHaveLength(1);
  const sessionsBefore = await sql("select id from session order by id");

  await compose(["restart"]);
  await up();
  expect(await identities()).toEqual(before);
  await expectHome(page);

  // Recreate every container from the Compose file, keeping only the named volumes.
  await compose(["down"]);
  expect((await compose(["ps", "-a", "-q"])).stdout.trim()).toBe("");
  await up();
  expect(await identities()).toEqual(before);
  expect(await sql("select id from session order by id")).toEqual(sessionsBefore);
  await expectHome(page);
  await evidence(page, testInfo, "us3-1-home-after-recreate");

  const again = await serverCommand("create-owner", ["--username", "other", "--name", "Other"]);
  expect(again.code).toBe(2);
  expect(again.json.error).toBe("owner_exists");
});

test("with the database stopped it reports a storage problem, then recovers unchanged", async ({ page }, testInfo) => {
  await signIn(page, USERNAME);
  await expectHome(page);
  await compose(["stop", "postgres"]);
  try {
    // Signing out can't be carried out without the database, so it is reported as failed and the
    // session stays valid for when the database is back.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("alert")).toHaveText("Couldn't sign out. You are still signed in; try again.");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your Space can't read its storage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your Space has no owner yet" })).toHaveCount(0);
    await expect(page.getByText("Sam Rivera's space")).toHaveCount(0);
    await evidence(page, testInfo, "us3-2-storage-unavailable");

    const status = await page.request.get("/api/status");
    expect(status.status()).toBe(503);
    expect(await status.json()).toEqual({ state: "storage_unavailable" });

    const create = await serverCommand("create-owner", ["--username", "other", "--name", "Other"]);
    expect(create.code).toBe(3);
    expect(create.json.error).toBe("storage_unavailable");
    const reset = await serverCommand("reset-link");
    expect(reset.code).toBe(3);
    expect(reset.json.error).toBe("storage_unavailable");

    // Retrying while it is still down keeps showing the storage problem.
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Your Space can't read its storage" })).toBeVisible();
  } finally {
    await compose(["start", "postgres"]);
    await up();
  }

  // The server recovers without a restart; "Try again" returns to the same workspace and session.
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  expect(await identities()).toEqual(before);
  const status = await page.request.get("/api/status");
  expect(await status.json()).toEqual({ owner: true });
});
