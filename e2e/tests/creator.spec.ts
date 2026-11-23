import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "./helpers/cli.ts";
import { fixtureCommit } from "../github/commits.mjs";
import { expect, test, type Frame } from "@playwright/test";
import { composeWithInput, createOwner, docker, resetStack, serverCommand } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

// Runs through the real owner UI, database, Docker runtime, edge and managed GitHub routes.
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

test("a synthetic GitHub account can manage, commit, preview a private install, and review an update", async ({
  page,
  browserName,
}) => {
  test.setTimeout(240000);
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  await signIn(page, owner.username);
  await page.getByRole("link", { name: "Repositories" }).click();
  await page.getByRole("checkbox", { name: /Include private repositories/ }).check();
  await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(page.getByText("fixture-owner", { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByText("Add a repository", { exact: true }).click();
  await page.getByLabel("Repository name", { exact: true }).fill("fixtures-private");
  await expect(page.getByLabel("Visibility")).toHaveValue("private");
  await page.getByRole("button", { name: "Create repository" }).click();
  await expect(page.getByRole("heading", { name: "fixture-owner/fixtures-private" })).toBeVisible();
  await page.getByLabel("File path", { exact: true }).fill("compose.yaml");
  await page.getByRole("button", { name: "New file" }).click();
  const release = (response: string) =>
    JSON.stringify({
      services: {
        web: {
          image: "node:26-slim",
          ports: ["8080:8080"],
          volumes: ["app-data:/data"],
          command: [
            "node",
            "-e",
            `require('node:http').createServer((_request,res)=>res.end(${response})).listen(8080)`,
          ],
        },
      },
      volumes: { "app-data": {} },
    });
  await page.getByLabel("File contents").fill(release("'Release one'"));
  await page.getByLabel("Commit message").fill("Add the fixture service");
  await page.getByRole("button", { name: "Commit changes" }).click();
  const committed = page.getByRole("status").filter({ hasText: /Committed/ });
  await expect(committed).toBeVisible();
  const release1 = (await committed.locator("code").textContent())!;
  expect(release1).toMatch(/^[0-9a-f]{40}$/);
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(page.getByLabel("File contents")).toHaveValue(/node:26-slim/);
  // Every app installs with a kit: this one sits beside its Compose file and pins it to the commit above.
  await page.getByLabel("File path", { exact: true }).fill("kit.yaml");
  await page.getByRole("button", { name: "New file" }).click();
  await page
    .getByLabel("File contents")
    .fill(`kit: 1\nsource: { repo: fixture-owner/fixtures-private, path: compose.yaml, commit: ${release1} }\ninterface: { service: web, port: 8080 }\n`);
  await page.getByLabel("Commit message").fill("Add the fixture's kit");
  await page.getByRole("button", { name: "Commit changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Committed/ })).toBeVisible();
  await page.getByRole("button", { name: "Install new app" }).click();
  await expect(page.getByLabel("Kit file path")).toHaveValue("kit.yaml");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "fixture-owner/fixtures-private/compose.yaml" })).toHaveAttribute("href", new RegExp(`/blob/${release1}/`));
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator("section.job")).toHaveAttribute("data-job-state", "succeeded", { timeout: 120000 });
  // Write once in the running first release. The next commit contains only the reader.
  const marker = randomUUID();
  await docker(
    [
      "exec",
      "ys-fixtures-private-web-1",
      "node",
      "-e",
      "require('node:fs').writeFileSync('/data/owner-marker', process.argv[1], {flag:'wx'})",
      marker,
    ],
    false,
  );
  await page.getByRole("button", { name: "Edit files" }).click();
  await page.getByLabel("File path", { exact: true }).fill("compose.yaml");
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await page
    .getByLabel("File contents")
    .fill(release("'Release two ' + require('node:fs').readFileSync('/data/owner-marker','utf8')"));
  await page.getByLabel("Commit message").fill("Serve release two");
  await page.getByRole("button", { name: "Commit changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Committed/ })).toBeVisible();
  await page.getByRole("button", { name: "Update installed app" }).click();
  const appSelect = page.getByRole("combobox", { name: "Installed app", exact: true });
  await expect(appSelect.locator("option")).toHaveCount(2);
  await appSelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Review deployment" }).click();
  await expect(page.getByRole("heading", { name: /Deploy to/ })).toBeVisible();
  await expect(page.getByText("Existing volumes", { exact: false })).toContainText("app-data");
  await page.getByRole("button", { name: "Apply reviewed deployment" }).click();
  await expect(page.getByRole("link", { name: "View installation" })).toBeVisible({ timeout: 90000 });
  const originalId = await appSelect.inputValue();
  await page.getByRole("link", { name: "View installation" }).click();
  const installedName = await page.locator("main[data-state='app-detail']").getAttribute("data-app");
  expect(installedName).toBe("fixtures-private");
  const detail = await page.request.get("/api/apps/" + installedName);
  expect((await detail.json()).id).toBe(originalId);
  await page.getByRole("link", { name: "fixtures-private", exact: true }).click();
  const appPane = page.frameLocator('[data-testid="app-pane"]');
  const persisted = "Release two " + marker;
  if (browserName === "webkit") {
    await expect(appPane.locator("body")).toContainText(/Release two|This browser won't run/);
    if (await appPane.locator("[data-ys-own-tab]").isVisible()) {
      const newPage = page.context().waitForEvent("page");
      await appPane.getByRole("link", { name: "Open in its own tab" }).click();
      const tab = await newPage;
      await expect(tab.locator("body")).toHaveText(persisted);
      await tab.close();
    } else await expect(appPane.locator("body")).toHaveText(persisted);
  } else await expect(appPane.locator("body")).toHaveText(persisted, { timeout: 25000 });
  await page.getByRole("link", { name: "Details", exact: true }).click();
  await page.getByRole("link", { name: "Customize app" }).click();
  await expect(page.getByRole("heading", { name: "Repositories", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Operation", exact: true }).selectOption("import");
  await page.getByLabel("GitHub owner/repository").fill("ys-fixtures/whoami");
  await page.getByRole("button", { name: "Import repository" }).click();
  await expect(page.getByRole("heading", { name: "ys-fixtures/whoami", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Operation", exact: true }).selectOption("fork");
  await page.getByLabel("Fork name (optional)").fill("fixture-fork");
  await page.getByRole("button", { name: "Fork repository" }).click();
  await expect(page.getByRole("heading", { name: "fixture-owner/fixture-fork", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByLabel("New agent name").fill("Fixture editor");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.getByRole("link", { name: "Repositories" }).click();
  await page.getByLabel("Agent identity").selectOption({ label: "Fixture editor" });
  await page.getByRole("checkbox", { name: "fixture-owner/fixture-fork", exact: true }).check();
  await page.getByRole("button", { name: "Save repository access" }).click();
  await expect(page.getByText("Repository access saved.")).toBeVisible();
  await page.reload();
  await page.getByLabel("Agent identity").selectOption({ label: "Fixture editor" });
  await expect(page.getByRole("checkbox", { name: "fixture-owner/fixture-fork", exact: true })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "fixture-owner/fixtures-private", exact: true }),
  ).not.toBeChecked();
});
