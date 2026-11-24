import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "./helpers/cli.ts";
import { fixtureCommit, PRIVATE_FIXTURE } from "../github/commits.mjs";
import { expect, test, type Frame } from "@playwright/test";
import { composeWithInput, createOwner, resetStack, serverCommand } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Runs through the real owner UI, database, Docker runtime, edge and GitHub connection.
// Only GitHub is replaced with the synthetic provider mounted by compose.e2e.yaml.
const recordsKit = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/records.yaml";
const kitLink = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/whoami.yaml";

async function sendHome(frame: Frame, workspace: string, request: Record<string, unknown>) {
  return frame.evaluate(
    ({ workspace, request }) =>
      new Promise<{ ok: boolean; result?: unknown; error?: { code: string } }>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => {
          window.removeEventListener("message", reply);
          reject(new Error("No Home response"));
        }, 8000);
        function reply(event: MessageEvent) {
          if (event.source !== window.parent || event.origin !== workspace || event.data?.requestId !== id) return;
          clearTimeout(timeout);
          window.removeEventListener("message", reply);
          resolve(event.data);
        }
        window.addEventListener("message", reply);
        window.parent.postMessage({ ...request, version: 1, requestId: id }, workspace);
      }),
    { workspace, request },
  );
}

test("the owner installs a directory kit, grants a custom Home one read, and restores built-in Home", async ({
  page,
  baseURL,
  browserName,
}) => {
  test.setTimeout(240000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await page.getByText("Kit directory", { exact: true }).click();
  await page.getByRole("button", { name: "Review whoami", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  // The directory's entry is pinned to the directory's commit, and the kit pins its Compose file.
  await expect(page.getByRole("link", { name: "ys-fixtures/catalog/apps/ys-fixtures/whoami.yaml" })).toHaveAttribute("href", new RegExp(`/blob/${fixtureCommit("ys-fixtures/catalog")}/`));
  await expect(page.getByRole("link", { name: "ys-fixtures/whoami/compose.yaml" })).toHaveAttribute("href", new RegExp(`/blob/${fixtureCommit("ys-fixtures/whoami")}/`));
  await page.getByLabel("Link to the app's kit").fill(kitLink);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Install", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator("section.job")).toHaveAttribute("data-job-state", "succeeded", { timeout: 120000 });
  const folder = await mkdtemp(join(tmpdir(), "ys-creator-e2e-"));
  try {
    const appDir = join(folder, "creator-home-proof");
    execFileSync(process.execPath, [join(root, "cli/dist/your-space.cjs"), "--json", "app", "new", appDir], {
      stdio: "pipe",
    });
    const files = {
      compose: await readFile(join(appDir, "compose.yaml"), "utf8"),
      kit: await readFile(join(appDir, "kit.yaml"), "utf8"),
    };
    const installed = await composeWithInput(
      ["exec", "-T", "server", "install-app", "--files-stdin", "--json"],
      JSON.stringify(files),
    );
    expect(installed.code).toBe(0);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  const other = await serverCommand("install-app", [recordsKit]);
  expect(other.json?.ok, other.json?.error).toBe(true);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  const connection = page.getByRole("region", { name: "App connections" });
  await connection.locator("summary").click();
  await connection.getByLabel("App credential", { exact: true }).fill("local-fixture-key");
  await connection.getByRole("checkbox", { name: /Reader/ }).check();
  await connection.getByRole("button", { name: "Save connection" }).click();
  await expect(connection.locator("summary")).toContainText("Credential saved");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Home settings" }).click();
  await page.getByLabel("Home dashboard").selectOption({ label: "Creator Home Proof" });
  await page.getByRole("checkbox", { name: /Reader/ }).check();
  await page.getByRole("button", { name: "Save Home settings" }).click();
  await page.getByRole("link", { name: "Open Home", exact: true }).click();
  const pane = page.frameLocator('iframe[title="Creator Home Proof"]');
  await expect(pane.locator("#actions, [data-ys-own-tab]")).toBeVisible({ timeout: 25000 });
  if (await pane.locator("[data-ys-own-tab]").isVisible()) {
    // WebKit can reject app cookies in an embedded *.localhost pane (journey 002).
    expect(browserName).toBe("webkit");
    await expect(page.getByRole("link", { name: "Open app in a tab" })).toHaveAttribute("target", "_blank");
  } else {
    await expect(pane.locator("#actions option")).toHaveCount(1, { timeout: 25000 });
    await pane.getByRole("button", { name: "Show data" }).click();
    await expect(pane.locator("#output")).toHaveText("[]", { timeout: 12000 });
    const frame = page.frames().find((f) => new URL(f.url()).hostname.startsWith("creator-home-proof."))!;
    // Another document on the same app origin does not inherit the chosen frame's grant.
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/home/actions")) requests.push(request.url());
    });
    const attached = page.waitForEvent("frameattached");
    await page.evaluate(() => {
      const sibling = document.createElement("iframe");
      sibling.name = "unselected-home";
      sibling.hidden = true;
      sibling.src = document.querySelector<HTMLIFrameElement>(".custom-home iframe")!.src;
      document.body.append(sibling);
    });
    const sibling = await attached;
    await sibling.waitForURL(frame.url());
    await sibling.evaluate((origin) => {
      parent.postMessage({ type: "your-space:home:actions", version: 1, requestId: "unselected" }, origin);
    }, baseURL!);
    const discovered = await sendHome(frame, baseURL!, { type: "your-space:home:actions" });
    expect(requests).toHaveLength(1);
    await page.evaluate(() => document.querySelector('iframe[name="unselected-home"]')?.remove());
    expect(discovered.ok).toBeTruthy();
    const actions = (discovered.result as { actions: { installationId: string; actionId: string }[] }).actions;
    expect(actions.map((a) => a.actionId)).toEqual(["list"]);
    const target = actions[0]!.installationId;
    const read = await sendHome(frame, baseURL!, {
      type: "your-space:home:read",
      installationId: target,
      actionId: "list",
      input: {},
    });
    expect(read).toMatchObject({ ok: true, result: [] });
    const denied = await sendHome(frame, baseURL!, {
      type: "your-space:home:read",
      installationId: target,
      actionId: "create",
      input: {},
    });
    expect(denied.ok).toBe(false);
  }
  await page.getByRole("link", { name: "Home settings" }).click();
  await page.getByRole("button", { name: "Restore built-in Home" }).click();
  await page.getByRole("link", { name: "Open Home", exact: true }).click();
  await expect(page.locator('main[data-state="home"]')).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("a GitHub connection with private access installs an app from a kit in a private repository", async ({ page }) => {
  test.setTimeout(240000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  const privateKit = `https://github.com/${PRIVATE_FIXTURE.repo}/blob/main/kit.yaml`;
  // Without a connection Your Space reads public GitHub only, and says how to reach a private kit.
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await page.getByLabel("Link to the app's kit").fill(privateKit);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("connect GitHub with private repositories included");
  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  await page.getByRole("checkbox", { name: /Include private repositories/ }).check();
  await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(page.getByText("fixture-owner", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Public and private repositories/)).toBeVisible();
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await page.getByLabel("Link to the app's kit").fill(privateKit);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  // The kit is read at the commit its link resolves to, and the Compose file at the commit the kit pins.
  await expect(page.getByRole("link", { name: `${PRIVATE_FIXTURE.repo}/kit.yaml` })).toHaveAttribute("href", new RegExp(`/blob/${PRIVATE_FIXTURE.kit}/`));
  await expect(page.getByRole("link", { name: `${PRIVATE_FIXTURE.repo}/compose.yaml` })).toHaveAttribute("href", new RegExp(`/blob/${PRIVATE_FIXTURE.compose}/`));
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator("section.job")).toHaveAttribute("data-job-state", "succeeded", { timeout: 120000 });
  const detail = await page.request.get("/api/apps/private-whoami");
  expect(await detail.json()).toMatchObject({ source: { repo: PRIVATE_FIXTURE.repo, commit: PRIVATE_FIXTURE.compose } });
});
