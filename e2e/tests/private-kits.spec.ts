import { expect, test, type Page } from "@playwright/test";
import { fixtureCommit } from "../github/commits.mjs";
import { evidence } from "./helpers/evidence.ts";
import { compose, composeWithInput, createOwner, logs, resetStack, serverCommand, sql } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Journey 015, slice 2: installing a kit from a private repository through the GitHub connection. The
// real owner UI, server command, database and runtime; only GitHub is replaced, by the stand-in
// mounted by compose.e2e.yaml, which shows ys-fixtures/private-kits only to this synthetic token and
// ys-fixtures/private-other to no token at all.
const TOKEN = "github_pat_ys_fixture_contents";
const LOGIN = "ys-fixture-owner";
const PRIVATE_KIT = "https://github.com/ys-fixtures/private-kits/blob/main/whoami.yaml";
const COMMAND_KIT = "https://github.com/ys-fixtures/private-kits/blob/main/command.yaml";
const PUBLIC_KIT = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/whoami.yaml";
const LINK_LABEL = "Link to the app's kit";

async function review(page: Page, link: string): Promise<void> {
  await page.goto("/apps");
  await page.getByLabel(LINK_LABEL).fill(link);
  await page.getByRole("button", { name: "Review", exact: true }).click();
}

async function installReviewed(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Install", exact: true }).click();
  const job = page.locator("section.job");
  await expect(job).toHaveAttribute("data-job-state", /succeeded|failed/, { timeout: 120_000 });
  expect(await job.getAttribute("data-job-state"), (await job.textContent()) ?? "").toBe("succeeded");
}

test("the owner installs a kit from a private repository through the GitHub connection", async ({ page, browserName }, testInfo) => {
  test.setTimeout(480_000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);

  // Public GitHub doesn't show the kit, and nothing is connected: the review says to connect GitHub.
  await review(page, PRIVATE_KIT);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your Space can't find ys-fixtures/private-kits, or that branch, tag or commit in it, on public GitHub.");
  await expect(alert).toContainText("If the repository is private, connect GitHub with a token that can read it");
  await expect(alert.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/github");
  await evidence(page, testInfo, "015-private-kit-not-connected");

  // Connected (the GitHub page's own journey is github.spec.ts), the kit is read through the connection
  // and labelled Private.
  const connected = await composeWithInput(["exec", "-T", "server", "github", "connect", "--json"], `${TOKEN}\n`);
  expect(JSON.parse(connected.stdout)).toMatchObject({ ok: true, contents: { set: true, login: LOGIN } });
  await review(page, PRIVATE_KIT);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ys-fixtures/private-kits/whoami.yaml" })).toHaveAttribute(
    "href",
    `https://github.com/ys-fixtures/private-kits/blob/${fixtureCommit("ys-fixtures/private-kits")}/whoami.yaml`,
  );
  await expect(page.locator('[data-private="kit"]')).toHaveText(`Private · read with your GitHub connection (@${LOGIN})`);
  await evidence(page, testInfo, "015-private-kit-review");

  await installReviewed(page);
  await page.getByRole("region", { name: "Install an app" }).getByRole("link", { name: "Open Private Who Am I" }).click();
  const pane = page.frameLocator('[data-testid="app-pane"]');
  if (browserName === "webkit") {
    // WebKit blocks an app's cookies in a pane on this plain-HTTP setup, so it offers the app's own tab.
    await expect(pane.getByRole("heading", { name: "This browser won't run the app here" })).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(pane.locator("body")).toContainText("Host: private-whoami.space.localhost", { timeout: 30_000 });
  }
  await evidence(page, testInfo, "015-private-kit-open");
  // The app records how each file was read (R4).
  expect(await sql("select provenance->'kit', provenance->'compose' from app where name = 'private-whoami'")).toEqual([
    `{"read": "connection", "login": "${LOGIN}"}\t{"read": "anonymous"}`,
  ]);

  // The server command reads a private kit through the same connection.
  const command = await serverCommand("install-app", [COMMAND_KIT]);
  expect(command.code, command.stderr).toBe(0);
  expect(command.json).toMatchObject({ ok: true, name: "private-command", provenance: { kit: { read: "connection", login: LOGIN }, compose: { read: "anonymous" } } });

  // A repository GitHub doesn't show the token, and a file that isn't there, each say so.
  await review(page, "https://github.com/ys-fixtures/private-other/blob/main/kit.yaml");
  await expect(alert).toContainText(`GitHub doesn't show ys-fixtures/private-other to your GitHub connection (@${LOGIN}).`);
  await expect(alert.getByRole("link", { name: "Open the GitHub page" })).toBeVisible();
  await evidence(page, testInfo, "015-private-kit-not-visible");
  await review(page, "https://github.com/ys-fixtures/private-kits/blob/main/missing.yaml");
  await expect(alert).toHaveText("There is no file missing.yaml in ys-fixtures/private-kits at main.");

  // The owner deletes the token at GitHub. The next private review says so and marks it; the GitHub
  // page and the command then show Reconnect, and a public kit is still reviewed.
  await compose(["exec", "-T", "github", "node", "-e", `fetch("http://127.0.0.1:8080/_stand-in/delete-token", { method: "POST", body: "${TOKEN}" }).then((r) => process.exit(r.ok ? 0 : 1))`]);
  await review(page, PRIVATE_KIT);
  await expect(alert).toContainText(`GitHub no longer accepts your GitHub connection's token (@${LOGIN}): it expired, or it was deleted or revoked.`);
  await alert.getByRole("link", { name: "Reconnect GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Reconnect", exact: true })).toBeVisible();
  await expect(page.getByText("GitHub no longer accepts this token")).toBeVisible();
  await evidence(page, testInfo, "015-private-kit-reconnect");
  expect((await serverCommand("github", ["status"])).json).toMatchObject({ ok: true, contents: { set: true, accepted: false, problem: "refused" } });
  await review(page, PUBLIC_KIT);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();

  // A token no data key here can read stops a private review with its own message, and a public kit
  // still installs.
  await sql("update source_credential set token = 'v2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA'");
  await review(page, PRIVATE_KIT);
  await expect(alert).toContainText("no data key here can read its token");
  await expect(alert.getByRole("link", { name: "Reconnect GitHub" })).toBeVisible();
  await review(page, PUBLIC_KIT);
  await installReviewed(page);

  expect(await logs()).not.toContain(TOKEN);
});
