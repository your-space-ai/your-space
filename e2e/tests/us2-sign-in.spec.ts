// T035, User Story 2: sign in and out, protected access needs a valid session, failures are shown
// as failures. Better Auth allows 3 sign-in attempts per 10 seconds per address, so the steps pace
// their attempts.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { compose, createOwner, resetStack, up } from "./helpers/stack.ts";
import { PASSWORD, setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const EMAIL = "sam@example.com";

test.beforeAll(async () => {
  await resetStack();
});

test("sign in, sign out, and a replayed session is refused", async ({ page, context }, testInfo) => {
  const { url } = await createOwner(EMAIL, "Sam Rivera");
  await setPassword(page, url);

  // A wrong password is refused and reveals nothing.
  await signIn(page, EMAIL, "not the right password");
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match.");
  await expect(page).toHaveURL(/\/sign-in/);
  await evidence(page, testInfo, "us2-1-wrong-password");

  // The right password opens the workspace.
  await signIn(page, EMAIL);
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
  await evidence(page, testInfo, "us2-2-home");

  // The session cookie is host-only and HttpOnly, so it is never sent to another host, including
  // subdomains where apps may later live (FR-021).
  const session = (await context.cookies()).find((c) => c.name.endsWith("session_token"));
  expect(session).toBeDefined();
  expect(session!.domain).toBe("localhost"); // no leading dot: host-only
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");

  // Check it with real requests: a server on another port of localhost sees the cookie (cookies
  // ignore ports), and the same server reached as app.localhost does not.
  const seen = new Map<string, string>();
  const echo = createServer((req, res) => {
    seen.set(`${req.headers.host?.split(":")[0]}`, req.headers.cookie ?? "");
    res.end("ok");
  });
  await new Promise<void>((resolve) => echo.listen(0, resolve));
  try {
    const port = (echo.address() as AddressInfo).port;
    const probe = await context.newPage();
    await probe.goto(`http://localhost:${port}/`);
    await probe.goto(`http://app.localhost:${port}/`);
    await probe.close();
    expect(seen.get("localhost")).toContain(`${session!.name}=`);
    expect(seen.get("app.localhost")).toBe("");
  } finally {
    echo.close();
  }

  // A sign-out request from another site is refused and the session stays (CSRF protection).
  const sessionCookie = `${session!.name}=${session!.value}`;
  const forged = await page.request.post("/api/auth/sign-out", {
    headers: { origin: "https://elsewhere.example", cookie: sessionCookie },
    data: {},
  });
  expect(forged.status()).toBe(403);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();

  // Signed-in visitors skip the sign-in page.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/$/);

  // Sign out returns to sign-in, and replaying the old cookie gets nothing.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=signed_out$/);
  await expect(page.getByText("You're signed out.")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);

  // Unknown addresses lead back to the app, not to an error.
  await page.goto("/no-such-page");
  await expect(page).toHaveURL(/\/sign-in$/);

  const replay = await page.request.get("/api/auth/get-session", {
    headers: { cookie: `${session!.name}=${session!.value}` },
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toBeNull();
  const workspaces = await page.request.get("/api/auth/organization/list", {
    headers: { cookie: `${session!.name}=${session!.value}` },
  });
  expect(workspaces.status()).toBe(401);
});

test("repeated failures are limited and the page says so", async ({ page }, testInfo) => {
  await page.waitForTimeout(11_000);
  await page.goto("/sign-in");
  for (let attempt = 0; attempt < 3; attempt++) {
    await signIn(page, EMAIL, "not the right password");
    await expect(page.getByRole("alert")).toHaveText("That email and password don't match.");
  }
  await signIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole("alert")).toHaveText("Too many sign-in attempts. Wait a few seconds, then try again.");
  await expect(page).toHaveURL(/\/sign-in/);
  await evidence(page, testInfo, "us2-3-rate-limited");

  // After the window passes, the right password works again.
  await page.waitForTimeout(11_000);
  await signIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
});

test("a stopped server shows that it can't be reached, not an empty workspace", async ({ page }, testInfo) => {
  await signIn(page, EMAIL);
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();

  await compose(["stop", "server"]);
  try {
    // Signing out while the server is down is not reported as done.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Couldn't sign out because Your Space isn't reachable. You are still signed in; try again.",
    );
    await expect(page).toHaveURL(/\/$/);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Can't reach Your Space" })).toBeVisible();
    await expect(page.getByText("Sam Rivera's space")).toHaveCount(0);
    await expect(page.getByText("Nothing is in this workspace yet.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your Space has no owner yet" })).toHaveCount(0);
    await evidence(page, testInfo, "us2-4-server-unreachable");

    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Can't reach Your Space" })).toBeVisible();
  } finally {
    await up();
  }

  // Once it is back, "Try again" returns to the same workspace and session.
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Sam Rivera's space" })).toBeVisible();
});
