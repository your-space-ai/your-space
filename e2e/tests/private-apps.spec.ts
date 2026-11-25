import { expect, test } from "@playwright/test";
import { fixtureCommit } from "../github/commits.mjs";
import { evidence } from "./helpers/evidence.ts";
import { composeWithInput, createOwner, logs, resetStack, sql } from "./helpers/stack.ts";
import { installReviewed, reviewKit as review, setPassword, signIn } from "./helpers/ui.ts";

// Journey 015, slice 3: installing a kit whose Compose file is in a private repository, through the
// GitHub connection. The real owner UI, server command, database and runtime; only GitHub is replaced,
// by the stand-in mounted by compose.e2e.yaml, which shows ys-fixtures/private-app, where the Compose
// file is, and ys-fixtures/private-kits only to this synthetic token. ys-fixtures/public-kits is public.
const TOKEN = "github_pat_ys_fixture_contents";
const LOGIN = "ys-fixture-owner";
const PUBLIC_KIT = "https://github.com/ys-fixtures/public-kits/blob/main/private-app.yaml";
const PRIVATE_KIT = "https://github.com/ys-fixtures/private-kits/blob/main/private-app.yaml";
const COMPOSE_COMMIT = fixtureCommit("ys-fixtures/private-app")!;
const LABEL = `Private · read with your GitHub connection (@${LOGIN})`;
const READS = "This kit reads ys-fixtures/private-app with your GitHub connection.";
/** A kit file on this machine, for `install-app --kit -`, that names the same private Compose file. */
const KIT_FILE = `kit: 1
source: { repo: ys-fixtures/private-app, path: compose.yaml, commit: ${COMPOSE_COMMIT} }
name: private-local
title: Private Local
interface: { service: web, port: 80 }
env:
  API_TOKEN: { generate: { bytes: 24 } }
  GREETING: { ask: optional, secret: false }
limits:
  web: { memory: 64M, cpus: 0.5 }
`;

test("the owner installs kits whose Compose file is in a private repository", async ({ page, browserName }, testInfo) => {
  test.setTimeout(480_000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);

  // Public GitHub shows the kit but not its Compose file, and nothing is connected: the review says to
  // connect GitHub. So does the server command with a kit file, where only connecting helps.
  await review(page, PUBLIC_KIT);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your Space can't find ys-fixtures/private-app, where the kit's Compose file is, on public GitHub.");
  await expect(alert).toContainText("If the repository is private, connect GitHub with a token that can read it");
  await expect(alert.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/github");
  await evidence(page, testInfo, "015-private-app-not-connected");
  await expect(composeWithInput(["exec", "-T", "server", "install-app", "--kit", "-"], KIT_FILE)).rejects.toThrow(
    /on public GitHub\. If the repository is private, connect GitHub with a token that can read it, then try again\. Connect GitHub with: docker compose exec server github connect\.\n/,
  );

  // Connected (the GitHub page's own journey is github.spec.ts), the public kit's Compose file is read
  // through the connection: it alone is labelled Private, and the review names the repository the kit
  // reads with the connection.
  const connected = await composeWithInput(["exec", "-T", "server", "github", "connect", "--json"], `${TOKEN}\n`);
  expect(JSON.parse(connected.stdout)).toMatchObject({ ok: true, contents: { set: true, login: LOGIN } });
  await review(page, PUBLIC_KIT);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ys-fixtures/private-app/compose.yaml" })).toHaveAttribute(
    "href",
    `https://github.com/ys-fixtures/private-app/blob/${COMPOSE_COMMIT}/compose.yaml`,
  );
  await expect(page.locator('[data-private="compose"]')).toHaveText(LABEL);
  await expect(page.locator('[data-private="kit"]')).toHaveCount(0);
  await expect(page.locator("[data-field=reads-repository]")).toHaveText(READS);
  await evidence(page, testInfo, "015-private-app-review");

  await installReviewed(page);
  await page.getByRole("region", { name: "Install an app" }).getByRole("link", { name: "Open Private App" }).click();
  const pane = page.frameLocator('[data-testid="app-pane"]');
  if (browserName === "webkit") {
    // WebKit blocks an app's cookies in a pane on this plain-HTTP setup, so it offers the app's own tab.
    await expect(pane.getByRole("heading", { name: "This browser won't run the app here" })).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(pane.locator("body")).toContainText("Host: private-app.space.localhost", { timeout: 30_000 });
  }
  await evidence(page, testInfo, "015-private-app-open");

  // A private kit naming a Compose file in another private repository: both are labelled, with the line.
  await review(page, PRIVATE_KIT);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.locator('[data-private="kit"]')).toHaveText(LABEL);
  await expect(page.locator('[data-private="compose"]')).toHaveText(LABEL);
  await expect(page.locator("[data-field=reads-repository]")).toHaveText(READS);
  await evidence(page, testInfo, "015-private-both-review");
  await installReviewed(page);

  // The server command installs a kit file whose Compose file is private through the same connection,
  // and its review says so.
  const local = await composeWithInput(["exec", "-T", "server", "install-app", "--kit", "-"], KIT_FILE);
  expect(local.stderr).toContain(`Private Local from ys-fixtures/private-app at ${COMPOSE_COMMIT.slice(0, 12)} (private, read with your GitHub connection @${LOGIN}), with the kit file you gave`);
  expect(local.stderr).toContain(READS);
  expect(local.stdout).toContain("Installed Private Local");

  // Each app records how its kit and its Compose file were read (R4); a kit file wasn't read from GitHub.
  const connection = `{"read": "connection", "login": "${LOGIN}"}`;
  expect(await sql("select name, provenance->'kit', provenance->'compose' from app order by name")).toEqual([
    `private-app\t{"read": "anonymous"}\t${connection}`,
    `private-both\t${connection}\t${connection}`,
    `private-local\tnull\t${connection}`,
  ]);

  expect(await logs()).not.toContain(TOKEN);
});
