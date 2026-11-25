import { expect, test } from "@playwright/test";
import { fixtureCommit } from "../github/commits.mjs";
import { evidence } from "./helpers/evidence.ts";
import { blobsServed, pushPrivateImage } from "./helpers/registry.ts";
import { compose, composeWithInput, createOwner, docker, logs, resetStack, serverCommand, sql } from "./helpers/stack.ts";
import { installReviewed, reviewKit as review, setPassword, signIn } from "./helpers/ui.ts";

// Journey 015, slice 4: a kit whose image is private on GitHub's container registry, pulled with the
// GitHub connection's image token. The real owner UI, server command, database, runtime manager and
// engine; GitHub is the stand-in compose.e2e.yaml mounts, and GHCR a local registry that asks for a
// password, which the server treats as ghcr.io (YS_E2E_GHCR) and which knows one synthetic account.
// The same registry at another name, localhost, is another registry, which Your Space doesn't sign in to.
const IMAGE_TOKEN = "ghp_ys_fixture_packages";
const OTHER_IMAGE_TOKEN = "ghp_ys_fixture_packages_other";
const WIDE_TOKEN = "ghp_ys_fixture_packages_wide";
const LOGIN = "ys-fixture-owner";
const OTHER_LOGIN = "ys-fixture-other";
const IMAGE = "127.0.0.1:5591/ys-fixtures/private-image:1";
const KIT = "https://github.com/ys-fixtures/public-kits/blob/main/private-image.yaml";
const OTHER_KIT = "https://github.com/ys-fixtures/public-kits/blob/main/other-registry.yaml";
/** A kit file on this machine, for `install-app --kit -`, that names the same private image. */
const KIT_FILE = `kit: 1
source: { repo: ys-fixtures/private-image, path: compose.yaml, commit: ${fixtureCommit("ys-fixtures/private-image")} }
name: private-image-local
title: Private Image Local
interface: { service: web, port: 80 }
limits:
  web: { memory: 64M, cpus: 0.5 }
`;

test("the owner adds an image token and installs a kit whose image is private", async ({ page, browserName }, testInfo) => {
  test.setTimeout(480_000);
  await resetStack();
  const digest = await pushPrivateImage("traefik/whoami:latest", IMAGE, LOGIN, IMAGE_TOKEN);
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);

  // No image token: GHCR doesn't show the image without signing in, and the review says what to do.
  await review(page, KIT);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  const refusals = page.getByRole("list", { name: "Refusals" });
  await expect(refusals).toContainText(`GitHub's container registry doesn't show ${IMAGE} without signing in: it is private, or it doesn't exist.`);
  await expect(refusals).toContainText("add an image token, a classic token with only read:packages, on Your Space's GitHub page");
  await expect(page.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
  await evidence(page, testInfo, "015-private-image-no-token");

  // The GitHub page takes an image token on its own, without a contents token. One with more scopes
  // than read:packages is refused before it is stored.
  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  const images = page.getByRole("region", { name: "Images" });
  await images.getByRole("button", { name: "Add an image token" }).click();
  // Cancel forgets a token the owner didn't send.
  await images.getByLabel("Token").fill(WIDE_TOKEN);
  await images.getByRole("button", { name: "Cancel" }).click();
  await images.getByRole("button", { name: "Add an image token" }).click();
  await expect(images.getByLabel("Token")).toHaveValue("");
  const create = new URL((await images.getByRole("link", { name: "Create an image token on GitHub" }).getAttribute("href"))!);
  expect(`${create.origin}${create.pathname}`).toBe("https://github.com/settings/tokens/new");
  expect(create.searchParams.get("scopes")).toBe("read:packages");
  await images.getByText("What the image token can read").click();
  await expect(images).toContainText("read:packages reads every package your account can see");
  await expect(images).toContainText("SAML single sign-on");
  await images.scrollIntoViewIfNeeded();
  await evidence(page, testInfo, "015-images-add");
  await images.getByLabel("Token").fill(WIDE_TOKEN);
  await images.getByRole("button", { name: "Add image token" }).click();
  await expect(images.getByRole("alert")).toContainText("This token has the scopes read:packages, write:packages, repo. The image token must have only read:packages");
  await expect(images.getByLabel("Token")).toHaveValue("");
  // Cancel clears the refusal too, so it isn't there when the owner comes back.
  await images.getByRole("button", { name: "Cancel" }).click();
  await expect(images.getByRole("alert")).toHaveCount(0);
  await images.getByRole("button", { name: "Add an image token" }).click();

  // A token GitHub accepts, whose account the registry doesn't let read the image: the review says so.
  await images.getByLabel("Token").fill(OTHER_IMAGE_TOKEN);
  await images.getByRole("button", { name: "Add image token" }).click();
  await expect(page.locator("[data-field=github-images]")).toHaveText(`Images: @${OTHER_LOGIN}`);
  await review(page, KIT);
  await expect(refusals).toContainText(`Your image token (@${OTHER_LOGIN}) can't read ${IMAGE}, or it doesn't exist.`);
  await evidence(page, testInfo, "015-private-image-cannot-read");

  // Replaced with the server command, from standard input; the page shows it.
  const replaced = await composeWithInput(["exec", "-T", "server", "github", "image-token", "--json"], `${IMAGE_TOKEN}\n`);
  expect(JSON.parse(replaced.stdout)).toMatchObject({ ok: true, images: { set: true, login: LOGIN } });
  expect(replaced.stdout + replaced.stderr).not.toContain(IMAGE_TOKEN);
  await page.goto("/github");
  await expect(page.locator("[data-field=github-images]")).toHaveText(`Images: @${LOGIN}`);
  await expect(page.getByRole("region", { name: "Images" })).toContainText("GitHub accepts the token.");
  await page.getByRole("region", { name: "Images" }).scrollIntoViewIfNeeded();
  await evidence(page, testInfo, "015-images-login");
  const [stored] = await sql("select token from registry_credential");
  expect(stored).toMatch(/^v2\./);
  expect(stored).not.toContain(IMAGE_TOKEN);

  // The review signs in for the image, pins its digest and labels it Private image; it installs.
  await review(page, KIT);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.locator('[data-private="image"]')).toHaveText("Private image");
  await expect(page.locator(`code[title="${digest}"]`)).toBeVisible();
  await evidence(page, testInfo, "015-private-image-review");
  const looked = await blobsServed();
  await installReviewed(page);
  // The install downloaded the image, which isn't on the engine, signed in with the image token: its job
  // shows the download, and the registry, which asks for a password, served the image's layers to the
  // token's account. A lookup reads only the manifest and config the review already read.
  expect(
    (await sql("select steps from install_job j join app a on a.id = j.app_id where a.name = 'private-image' and j.kind = 'install'")).join("\n"),
  ).toContain("Downloading 127.0.0.1:5591/ys-fixtures/private-image: ");
  expect([...(await blobsServed())].filter((blob) => !looked.has(blob)).length).toBeGreaterThan(0);
  await page.getByRole("region", { name: "Install an app" }).getByRole("link", { name: "Open Private Image" }).click();
  const pane = page.frameLocator('[data-testid="app-pane"]');
  if (browserName === "webkit") {
    // WebKit blocks an app's cookies in a pane on this plain-HTTP setup, so it offers the app's own tab.
    await expect(pane.getByRole("heading", { name: "This browser won't run the app here" })).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(pane.locator("body")).toContainText("Host: private-image.space.localhost", { timeout: 30_000 });
  }
  await evidence(page, testInfo, "015-private-image-open");
  // Recorded pinned to its digest and private; the engine runs that digest.
  expect(await sql("select images->'127.0.0.1:5591/ys-fixtures/private-image:1' from app where name = 'private-image'")).toEqual([
    `{"digest": "${digest}", "private": true}`,
  ]);
  const running = await docker(["inspect", "ys-private-image-web-1", "--format", "{{.Config.Image}}\n{{json .Config.Env}}"], false);
  expect(running.stdout).toContain(`127.0.0.1:5591/ys-fixtures/private-image@${digest}`);
  // The app never gets the token.
  expect(running.stdout).not.toContain(IMAGE_TOKEN);

  // The server command installs a kit file naming the private image with the same image token, and its
  // review says so.
  const local = await composeWithInput(["exec", "-T", "server", "install-app", "--kit", "-"], KIT_FILE);
  expect(local.stderr).toContain(`web: ${IMAGE} (interface) (private image, pulled with your image token)`);
  expect(local.stdout).toContain("Installed Private Image Local");
  expect(local.stdout + local.stderr).not.toContain(IMAGE_TOKEN);
  expect(await sql("select images->'127.0.0.1:5591/ys-fixtures/private-image:1' from app where name = 'private-image-local'")).toEqual([
    `{"digest": "${digest}", "private": true}`,
  ]);

  // A private image on another registry is refused, image token or not: Your Space pulls public images only there.
  await review(page, OTHER_KIT);
  await expect(refusals).toContainText(
    "localhost:5591 doesn't show localhost:5591/ys-fixtures/private-image:1 without signing in: it is private, or it doesn't exist. Your Space pulls private images only from GitHub's container registry, ghcr.io, with an image token; from other registries it pulls public images only.",
  );
  await evidence(page, testInfo, "015-private-image-other-registry");

  // The command removes the image token alone; the page shows it gone, and the app keeps running.
  expect((await serverCommand("github", ["disconnect", "--image-token"])).json).toMatchObject({ ok: true, removed: true, images: { set: false } });
  await page.goto("/github");
  await expect(images.getByRole("button", { name: "Add an image token" })).toBeVisible();
  expect(await sql("select state from app where name = 'private-image'")).toEqual(["running"]);

  // On the page: added, replaced, then removed on its own, with a reminder to delete it at GitHub.
  await images.getByRole("button", { name: "Add an image token" }).click();
  await images.getByLabel("Token").fill(IMAGE_TOKEN);
  await images.getByRole("button", { name: "Add image token" }).click();
  await expect(page.locator("[data-field=github-images]")).toHaveText(`Images: @${LOGIN}`);
  await images.getByRole("button", { name: "Replace", exact: true }).click();
  await images.getByLabel("Token").fill(OTHER_IMAGE_TOKEN);
  await images.getByRole("button", { name: "Replace image token" }).click();
  await expect(page.locator("[data-field=github-images]")).toHaveText(`Images: @${OTHER_LOGIN}`);
  await images.getByRole("button", { name: "Remove", exact: true }).click();
  await images.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(images.getByRole("status")).toContainText("Removed the image token. Delete it at GitHub too");
  await expect(images.getByRole("button", { name: "Add an image token" })).toBeVisible();
  expect(await sql("select count(*) from registry_credential")).toEqual(["0"]);

  // Disconnect forgets both tokens.
  await composeWithInput(["exec", "-T", "server", "github", "image-token"], `${IMAGE_TOKEN}\n`);
  await composeWithInput(["exec", "-T", "server", "github", "connect"], "github_pat_ys_fixture_contents\n");
  await page.reload();
  await expect(page.locator("[data-field=github-login]")).toHaveText(`Connected as @${LOGIN}`);
  await expect(page.locator("[data-field=github-images]")).toHaveText(`Images: @${LOGIN}`);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("Delete the tokens at GitHub too");
  await expect(images.getByRole("button", { name: "Add an image token" })).toBeVisible();
  expect((await serverCommand("github", ["status"])).json).toEqual({ ok: true, contents: { set: false }, images: { set: false } });
  expect(await sql("select state from app where name = 'private-image'")).toEqual(["running"]);

  // Neither image token reached a log, and the runtime manager wrote no Docker config file.
  const all = await logs();
  expect(all).not.toContain(IMAGE_TOKEN);
  expect(all).not.toContain(OTHER_IMAGE_TOKEN);
  const configs = await compose(["exec", "-T", "runtime", "sh", "-c", "find / -xdev -path '*/.docker/config.json' 2>/dev/null; true"]);
  expect(configs.stdout.trim()).toBe("");
});
