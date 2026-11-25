import { expect, test } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { composeWithInput, createOwner, logs, resetStack, serverCommand, sql } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Journey 015, slice 1: connecting GitHub. The real owner UI, database and server command; only
// GitHub is replaced, by the stand-in mounted by compose.e2e.yaml, which knows this synthetic token.
const TOKEN = "github_pat_ys_fixture_contents";
const LOGIN = "ys-fixture-owner";

test("the owner connects GitHub on its page or with the server command, and disconnects", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);

  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  await expect(page.getByRole("heading", { name: "GitHub", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect", exact: true })).toBeVisible();
  // GitHub's new-token page opens with a name and Contents read chosen; the owner picks the rest.
  const create = new URL((await page.getByRole("link", { name: "Create a token on GitHub" }).getAttribute("href"))!);
  expect(`${create.origin}${create.pathname}`).toBe("https://github.com/settings/personal-access-tokens/new");
  expect(create.searchParams.get("name")).toBe("Your Space");
  expect(create.searchParams.get("contents")).toBe("read");
  await evidence(page, testInfo, "github-connect");

  // A classic token is refused before GitHub is asked: it could reach every repository.
  await page.getByLabel("Token").fill("ghp_ys_fixture_classic");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("only a fine-grained token");
  await expect(page.getByLabel("Token")).toHaveValue("");

  // A token GitHub refuses isn't stored, and the field doesn't keep it.
  await page.getByLabel("Token").fill("github_pat_ys_fixture_unknown");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("GitHub doesn't accept this token");
  await expect(page.getByLabel("Token")).toHaveValue("");

  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("[data-field=github-login]")).toHaveText(`Connected as @${LOGIN}`);
  await expect(page.getByText("GitHub accepts the token.")).toBeVisible();
  await evidence(page, testInfo, "github-connected");
  // Stored encrypted under the data key, never as it is.
  const [stored] = await sql("select token from source_credential");
  expect(stored).toMatch(/^v2\./);
  expect(stored).not.toContain(TOKEN);

  // The server command reads the same connection.
  const status = await serverCommand("github", ["status"]);
  expect(status.json).toMatchObject({ ok: true, contents: { set: true, login: LOGIN, accepted: true } });

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Delete the token at GitHub too");
  await expect(page.getByRole("heading", { name: "Connect", exact: true })).toBeVisible();
  expect((await serverCommand("github", ["status"])).json).toEqual({ ok: true, contents: { set: false } });

  // The command refuses a token on its command line, and takes one on standard input.
  const argument = await serverCommand("github", ["connect", TOKEN]);
  expect(argument.code).toBe(1);
  expect(argument.stdout + argument.stderr).not.toContain(TOKEN);
  const connected = await composeWithInput(["exec", "-T", "server", "github", "connect", "--json"], `${TOKEN}\n`);
  expect(JSON.parse(connected.stdout)).toMatchObject({ ok: true, contents: { set: true, login: LOGIN } });
  expect(connected.stdout + connected.stderr).not.toContain(TOKEN);
  await page.reload();
  await expect(page.locator("[data-field=github-login]")).toHaveText(`Connected as @${LOGIN}`);
  await evidence(page, testInfo, "github-connected-by-command");

  // Disconnected with the command, the page is back to Connect.
  expect((await serverCommand("github", ["disconnect"])).json).toMatchObject({ ok: true, removed: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect", exact: true })).toBeVisible();
  await evidence(page, testInfo, "github-disconnected");

  expect(await logs()).not.toContain(TOKEN);
});
