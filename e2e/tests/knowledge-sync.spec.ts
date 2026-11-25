// Journey 014, slice 2: synced knowledge bases. The owner sets up the Google connection with their own
// OAuth client and signs in; a knowledge base connected to a Drive folder then syncs both ways with
// real rclone bisync. Google is never contacted: the browser's sign-in page is answered by the test,
// the server exchanges the code with a stand-in (e2e/google), and the runtime manager syncs with a
// folder of a test volume in place of Drive (YS_E2E_SYNC_FIXTURE in e2e/compose.e2e.yaml).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { compose, createOwner, docker, logs, PROJECT, resetStack, sql, up } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const CLIENT_ID = "ys-e2e-client.apps.googleusercontent.com";
const CLIENT_SECRET = "ys-e2e-client-secret";
const FOLDER = "1E2eTestFolder0000000000000000ab";
const ORIGIN = process.env.YS_PORT ? `http://space.localhost:${process.env.YS_PORT}` : "http://space.localhost";
const KB = "drive-notes";
const DRIVE_VOLUME = `ys-sync-fixture.${PROJECT}`;
const KB_VOLUME = `ys-knowledge.${PROJECT}.${KB}`;
const STATE_VOLUME = `${KB_VOLUME}.sync`;
/** Already on the engine: the GitHub stand-in runs it. */
const SHELL_IMAGE = "node:26-slim";

let ownerCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

async function asOwner(page: Page): Promise<void> {
  page.on("dialog", (dialog) => {
    throw new Error(`The browser showed a ${dialog.type()} dialog: ${dialog.message()}`);
  });
  await answerGoogle(page);
  if (ownerCookies.length) return page.context().addCookies(ownerCookies);
  await signIn(page, "sam");
  await expect(page).toHaveURL(/\/$/);
  ownerCookies = await page.context().cookies();
}

/** Google's sign-in page, answered by the test: the owner allows access, and Google sends them back. */
let asked: URL | undefined;
async function answerGoogle(page: Page): Promise<void> {
  await page.route("http://accounts.google.test/**", async (route) => {
    const url = new URL(route.request().url());
    asked = url;
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    back.searchParams.set("code", `ok.${url.searchParams.get("code_challenge")}`);
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
}

/** Runs a shell script as user 1000 with a volume at /v: the knowledge base, or the stand-in for Drive. */
async function shell(volume: string, script: string): Promise<string> {
  const result = await docker(["run", "--rm", "--network", "none", "--user", "1000:1000", "-v", `${volume}:/v`, SHELL_IMAGE, "sh", "-c", script]);
  if (result.code !== 0) throw new Error(`The script failed: ${result.stderr}`);
  return result.stdout.trim();
}
const here = (script: string) => shell(KB_VOLUME, `cd /v && ${script}`);
const onDrive = (script: string) => shell(DRIVE_VOLUME, `cd /v/${FOLDER} && ${script}`);
/** Every file of a side and its content, to tell whether a run changed it. */
const listing = (side: (script: string) => Promise<string>) => side("find . -type f | sort | while read f; do echo \"$f: $(cat \"$f\")\"; done");

/** Chooses Sync now, or another action, and waits for that run to finish. */
async function run(page: Page, button = "Sync now"): Promise<void> {
  const main = page.locator('main[data-state="knowledge-base"]');
  const before = (await main.getAttribute("data-last-run")) ?? "";
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(main).not.toHaveAttribute("data-last-run", before, { timeout: 120_000 });
  await expect(main).toHaveAttribute("data-sync-running", "false", { timeout: 120_000 });
}

test("the owner sets up Google Drive with their own OAuth client and signs in", async ({ page }, testInfo) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  ownerCookies = [];
  await asOwner(page);

  await page.goto("/knowledge");
  const drive = page.getByRole("region", { name: "Google Drive" });
  await expect(drive).toHaveAttribute("data-google-state", "not_set_up");
  // The address to register with the client: Your Space's own, and its callback.
  await expect(drive.locator("[data-redirect-uri]")).toHaveText(`${ORIGIN}/api/google-drive/callback`);
  await drive.getByLabel("Client ID").fill(CLIENT_ID);
  await drive.getByLabel("Client secret").fill(CLIENT_SECRET);
  await evidence(page, testInfo, "014-2-google-client");
  await drive.getByRole("button", { name: "Save client" }).click();
  await expect(drive).toHaveAttribute("data-google-state", "signed_out");
  // The secret is kept encrypted with the data key, and never shown again.
  const [secret] = await sql("select client_secret from google_connection");
  expect(secret).toMatch(/^v2\./);
  expect(secret).not.toContain(CLIENT_SECRET);
  await expect(page.locator("body")).not.toContainText(CLIENT_SECRET);

  await drive.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page).toHaveURL(`${ORIGIN}/knowledge?google=connected`);
  // Google's page was asked for the operator's client, offline access to all of Drive, the consent
  // screen and PKCE; the stand-in checked the verifier against the challenge.
  expect(asked?.searchParams.get("client_id")).toBe(CLIENT_ID);
  expect(asked?.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/google-drive/callback`);
  expect(asked?.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive");
  expect(asked?.searchParams.get("access_type")).toBe("offline");
  expect(asked?.searchParams.get("prompt")).toBe("consent");
  expect(asked?.searchParams.get("code_challenge_method")).toBe("S256");
  await expect(drive).toHaveAttribute("data-google-state", "connected");
  const [token] = await sql("select token from google_connection");
  expect(token).toMatch(/^v2\./);
  expect(token).not.toContain("e2e-refresh-token");

  // Google's answer can be used once, and only by the session that started the sign-in.
  const callback = new URL(`${ORIGIN}/api/google-drive/callback`);
  callback.searchParams.set("state", asked!.searchParams.get("state")!);
  callback.searchParams.set("code", "ok.replayed");
  await page.goto(callback.toString());
  await expect(page).toHaveURL(`${ORIGIN}/knowledge?google=expired`);
  await expect(page.locator("[data-google-sign-in]")).toContainText("expired");
});

test("a knowledge base connected to a Drive folder syncs files created, changed and deleted on either side", async ({ page }, testInfo) => {
  // The first sync downloads rclone's and Squid's images on a machine that hasn't run them yet.
  test.setTimeout(360_000);
  await asOwner(page);
  await page.goto("/knowledge");
  const create = page.getByRole("region", { name: "New knowledge base" });
  await create.getByLabel("Name").fill(KB);
  await create.getByLabel("Title").fill("Drive notes");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(`li[data-knowledge="${KB}"]`)).toBeVisible();

  // Both sides have a file before they are connected. The Drive stand-in is a volume of the test's.
  await docker(["volume", "create", "--label", `ai.your-space.installation=${PROJECT}`, "--label", "ai.your-space.role=sync-fixture", DRIVE_VOLUME], false);
  await docker(["run", "--rm", "--network", "none", "-v", `${DRIVE_VOLUME}:/v`, SHELL_IMAGE, "sh", "-c", `mkdir -p /v/${FOLDER} && chown -R 1000:1000 /v && chmod 2777 /v`], false);
  await onDrive("echo 'From Drive' > from-drive.md && mkdir -p course && echo 'Week 1' > course/week-1.md");
  await here("echo 'From here' > from-here.md");

  await page.getByRole("link", { name: "Drive notes" }).click();
  await expect(page.getByRole("heading", { name: "Drive notes" })).toBeVisible();
  const sync = page.getByRole("region", { name: "Google Drive" });
  // A link that isn't a Drive folder's is refused.
  await sync.getByLabel("Drive folder link").fill("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view");
  await sync.getByRole("button", { name: "Connect" }).click();
  await expect(sync.getByRole("alert")).toContainText("Paste the link of a Google Drive folder");
  await sync.getByLabel("Drive folder link").fill(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`);
  await sync.getByRole("button", { name: "Connect" }).click();
  const main = page.locator('main[data-state="knowledge-base"]');
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 300_000 });
  await expect(page.locator("[data-sync-status]")).toContainText("Last synced");

  // The first run copied both ways and deleted nothing, and put Your Space's marker at both roots.
  expect(await listing(here)).toBe("./.your-space-sync: \n./course/week-1.md: Week 1\n./from-drive.md: From Drive\n./from-here.md: From here");
  expect(await listing(onDrive)).toBe(await listing(here));
  // The sync's state is in a volume of its own, never in the knowledge base.
  expect((await docker(["volume", "inspect", STATE_VOLUME, "--format", "{{json .Labels}}"], false)).stdout.trim()).toBe(
    JSON.stringify({ "ai.your-space.installation": PROJECT, "ai.your-space.knowledge": KB, "ai.your-space.role": "knowledge-sync" }),
  );
  await evidence(page, testInfo, "014-2-synced");

  // Created and changed on either side.
  await here("echo 'Changed here' > from-drive.md && echo 'New here' > new-here.md");
  await onDrive("echo 'Changed on Drive' > from-here.md && echo 'New on Drive' > new-there.md");
  await run(page);
  await expect(main).toHaveAttribute("data-sync-result", "synced");
  expect(await here("cat from-here.md new-there.md")).toBe("Changed on Drive\nNew on Drive");
  expect(await onDrive("cat from-drive.md new-here.md")).toBe("Changed here\nNew here");
  // A run that changed files is recorded against Your Space, not the owner.
  expect(await sql("select a.kind from event e join actor a on a.id = e.actor_id where e.type = 'knowledge.synced'")).toContain("operator");

  // Deleted on either side.
  await here("rm new-here.md");
  await onDrive("rm new-there.md");
  await run(page);
  expect(await listing(onDrive)).toBe(await listing(here));
  expect(await here("ls")).not.toMatch(/new-/);

  // The list shows how the sync stands.
  await page.goto("/knowledge");
  await expect(page.locator(`li[data-knowledge="${KB}"] [data-sync-line]`)).toContainText("Synced with Google Drive");
});

test("the sync's network reaches nothing but its proxy, which refuses any host but Google's", async () => {
  // From a container on the sync's sealed network, as each rclone step is: the GitHub stand-in, on
  // the stack's own network, can't be reached directly, and the proxy refuses it. Nothing here
  // reaches Google or the internet.
  const address = (await docker(["inspect", `${PROJECT}-github-1`, "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}"], false)).stdout.trim().split(" ")[0];
  const script = `
    const net = require("node:net");
    const http = require("node:http");
    const direct = () => new Promise((resolve) => {
      const socket = net.connect({ host: "${address}", port: 8080, timeout: 3000 });
      socket.on("connect", () => { socket.destroy(); resolve("connected"); });
      socket.on("error", (error) => resolve(error.code));
      socket.on("timeout", () => { socket.destroy(); resolve("timeout"); });
    });
    const proxied = (host) => new Promise((resolve) => {
      const request = http.request({ host: "ys-egress", port: 3128, path: "http://" + host + "/", headers: { host }, agent: false }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", (error) => resolve(error.code));
      request.end();
    });
    Promise.all([direct(), proxied("github:8080"), proxied("${address}:8080")]).then((answers) => {
      console.log(JSON.stringify(answers));
      process.exit(0);
    });`;
  const result = await docker(["run", "--rm", "--network", `${PROJECT}_knowledge-sync_sync`, "--user", "1000:1000", SHELL_IMAGE, "node", "-e", script], false);
  const [direct, byName, byAddress] = JSON.parse(result.stdout) as [string, number, number];
  expect(direct).not.toBe("connected");
  expect(byName).toBe(403);
  expect(byAddress).toBe(403);
});

test("a file changed on both sides keeps both copies, and the page lists the conflict copy", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  await here("echo 'Plan' > plan.md");
  await run(page);
  await here("echo 'Edited here' > plan.md");
  await onDrive("echo 'Edited on Drive' > plan.md");
  await run(page);
  // The copy here keeps the name; Drive's is renamed, and both sides have both.
  expect(await here("cat plan.md plan.md.conflict1")).toBe("Edited here\nEdited on Drive");
  expect(await onDrive("cat plan.md plan.md.conflict1")).toBe("Edited here\nEdited on Drive");
  const conflicts = page.getByRole("region", { name: "Conflict copies" });
  await expect(conflicts).toContainText("plan.md.conflict1");
  await conflicts.scrollIntoViewIfNeeded();
  await evidence(page, testInfo, "014-2-conflicts");
  // Resolved by the owner: the copy is deleted, and leaves the list.
  await here("rm plan.md.conflict1");
  await run(page);
  await expect(page.getByRole("region", { name: "Conflict copies" })).toHaveCount(0);
  expect(await onDrive("ls")).not.toContain("conflict");
});

test("a missing marker or an empty knowledge base stops the sync with Drive unchanged, and Resync deletes nothing", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  const main = page.locator('main[data-state="knowledge-base"]');
  const drive = await listing(onDrive);

  await here("rm .your-space-sync");
  await run(page);
  await expect(main).toHaveAttribute("data-sync-result", "stopped");
  await expect(page.locator('[data-sync-notice="marker"]')).toContainText("marker file, .your-space-sync, is missing in the knowledge base");
  expect(await listing(onDrive)).toBe(drive);
  await evidence(page, testInfo, "014-2-stopped-marker");
  await run(page, "Resync");
  await expect(main).toHaveAttribute("data-sync-result", "synced");
  expect(await listing(here)).toBe(drive);
  expect(await listing(onDrive)).toBe(drive);

  // An emptied knowledge base never reads as "everything was deleted".
  await here("find . -mindepth 1 -delete");
  await run(page);
  await expect(main).toHaveAttribute("data-sync-result", "stopped");
  await expect(page.locator("[data-sync-notice]")).toHaveAttribute("data-sync-notice", /empty|marker/);
  expect(await listing(onDrive)).toBe(drive);
  // Resync brings the files back from Drive.
  await run(page, "Resync");
  await expect(main).toHaveAttribute("data-sync-result", "synced");
  expect(await listing(here)).toBe(drive);
});

test("deleting over half the files stops the sync; Resync brings them back, and confirmed deletions are applied once", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  const main = page.locator('main[data-state="knowledge-base"]');
  await here("for i in 1 2 3 4 5 6; do echo \"Batch $i\" > batch-$i.md; done");
  await run(page);
  const drive = await listing(onDrive);
  const deleteMost = () => here("rm batch-*.md from-here.md");

  await deleteMost();
  await run(page);
  await expect(main).toHaveAttribute("data-sync-result", "stopped");
  await expect(page.locator('[data-sync-notice="max_delete"]')).toContainText("More than half of the files were deleted in the knowledge base");
  await expect(page.locator("[data-deletions]")).toContainText("7 files to delete");
  expect(await listing(onDrive)).toBe(drive);
  await evidence(page, testInfo, "014-2-stopped-deletions");
  // Resync copies them back from Drive and deletes nothing.
  await run(page, "Resync");
  await expect(main).toHaveAttribute("data-sync-result", "synced");
  expect(await listing(here)).toBe(drive);

  // Stopped again; one more file is deleted after the owner sees the list, so the confirmed list is
  // out of date: nothing is deleted, and the new list shows.
  await deleteMost();
  await run(page);
  await expect(page.locator("[data-deletions]")).toContainText("7 files to delete");
  await here("rm from-drive.md");
  await page.getByRole("button", { name: "Apply these deletions" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Apply these deletions?" });
  await expect(dialog).toContainText("7 files are deleted in Drive");
  await evidence(page, testInfo, "014-2-apply-deletions");
  const before = (await main.getAttribute("data-last-run")) ?? "";
  await dialog.getByRole("button", { name: "Delete 7 files" }).click();
  await expect(main).not.toHaveAttribute("data-last-run", before, { timeout: 120_000 });
  await expect(main).toHaveAttribute("data-sync-running", "false");
  await expect(page.locator('[data-sync-notice="changed"]')).toBeVisible();
  await expect(page.locator("[data-deletions]")).toContainText("8 files to delete");
  expect(await listing(onDrive)).toBe(drive);

  // Confirmed with the new list, they are deleted in Drive; the next run has the limit again.
  await page.getByRole("button", { name: "Apply these deletions" }).click();
  await dialog.getByRole("button", { name: "Delete 8 files" }).click();
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  expect(await listing(onDrive)).toBe(await listing(here));
  expect(await onDrive("ls")).not.toMatch(/batch|from-/);
  await here("for i in 1 2 3 4 5 6; do echo \"Again $i\" > again-$i.md; done");
  await run(page);
  await here("rm again-*.md");
  await run(page);
  await expect(main).toHaveAttribute("data-sync-result", "stopped");
  await expect(page.locator('[data-sync-notice="max_delete"]')).toBeVisible();
  await run(page, "Resync");
  await expect(main).toHaveAttribute("data-sync-result", "synced");
});

test("replacing the data key keeps the Google connection, and the knowledge base still syncs", async ({ page }) => {
  const [before] = await sql("select client_secret || ' ' || token from google_connection");
  await compose(["run", "--rm", "secrets", "--new", "data-key"]);
  await compose(["restart", "server"]);
  await up();
  await compose(["run", "--rm", "secrets", "--forget", "previous-data-key"]);
  const [after] = await sql("select client_secret || ' ' || token from google_connection");
  expect(after).not.toBe(before);

  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  await here("echo 'After the new key' > after-key.md");
  await run(page);
  await expect(page.locator('main[data-state="knowledge-base"]')).toHaveAttribute("data-sync-result", "synced");
  expect(await onDrive("cat after-key.md")).toBe("After the new key");
});

test("a connection Google refused shows Reconnect, and signing in again resumes the sync", async ({ page }, testInfo) => {
  await asOwner(page);
  // As after Google refused the token on a run: the runtime manager's tests cover reading that from rclone.
  await sql("update google_connection set problem = 'invalid_grant: Token has been expired or revoked.'");
  await page.goto(`/knowledge/${KB}`);
  const notice = page.locator('[data-sync-notice="disconnected"]');
  await expect(notice).toContainText("Google refused Your Space's access to Drive");
  await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
  await evidence(page, testInfo, "014-2-reconnect");
  await notice.getByRole("button", { name: "Reconnect" }).click();
  await expect(page).toHaveURL(`${ORIGIN}/knowledge?google=connected`);
  await page.goto(`/knowledge/${KB}`);
  await expect(notice).toHaveCount(0);
  await run(page);
  await expect(page.locator('main[data-state="knowledge-base"]')).toHaveAttribute("data-sync-result", "synced");
});

test("a first sync keeps the newer copy, backs up a replaced local file, and the local copy wins a tie", async ({ page }, testInfo) => {
  await asOwner(page);
  const name = "first-sync";
  const folder = "1E2eTestFolder0000000000000000cd";
  const local = (script: string) => shell(`ys-knowledge.${PROJECT}.${name}`, `cd /v && ${script}`);
  const remote = (script: string) => shell(DRIVE_VOLUME, `mkdir -p /v/${folder} && cd /v/${folder} && ${script}`);
  await page.goto("/knowledge");
  const create = page.getByRole("region", { name: "New knowledge base" });
  await create.getByLabel("Name").fill(name);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(`li[data-knowledge="${name}"]`)).toBeVisible();
  // Both sides have each file: Drive's newer.md is newer; tie.md has the same size and time on both.
  await local("echo 'Older here' > newer.md && touch -d '2024-01-01 00:00:00' newer.md && echo 'aaaa' > tie.md && touch -d '2024-02-02 00:00:00' tie.md");
  await remote("echo 'Newer on Drive' > newer.md && touch -d '2025-01-01 00:00:00' newer.md && echo 'bbbb' > tie.md && touch -d '2024-02-02 00:00:00' tie.md");
  await page.goto(`/knowledge/${name}`);
  await page.getByLabel("Drive folder link").fill(`https://drive.google.com/drive/u/0/folders/${folder}`);
  await page.getByRole("button", { name: "Connect" }).click();
  const main = page.locator('main[data-state="knowledge-base"]');
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  expect(await local("cat newer.md tie.md")).toBe("Newer on Drive\naaaa");
  expect(await remote("cat newer.md tie.md")).toBe("Newer on Drive\naaaa");
  await expect(page.getByText("1 file had the same time on both sides at the first sync")).toBeVisible();

  // Drive changes it again: the local copy is replaced a second time, and each earlier copy is kept.
  await remote("echo 'Newest on Drive' > newer.md");
  await run(page);
  expect(await local("cat newer.md")).toBe("Newest on Drive");
  const kept = await shell(`ys-knowledge.${PROJECT}.${name}.sync`, "cd /v/backups && for f in $(ls -1 | sort); do cat $f/newer.md; done");
  expect(kept).toBe("Older here\nNewer on Drive");
  const backups = page.getByRole("region", { name: "Replaced files" });
  await backups.getByText("Replaced files").click();
  await expect(backups.locator("li")).toHaveCount(2);
  await backups.scrollIntoViewIfNeeded();
  await evidence(page, testInfo, "014-2-backups");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Drive folder link")).toBeVisible();
});

test("a run that stops over more than 500 deletions shows the first 500, and applies every one once confirmed", async ({ page }, testInfo) => {
  await asOwner(page);
  const name = "bulk";
  const folder = "1E2eTestFolder0000000000000000ef";
  const local = (script: string) => shell(`ys-knowledge.${PROJECT}.${name}`, `cd /v && ${script}`);
  const remote = (script: string) => shell(DRIVE_VOLUME, `mkdir -p /v/${folder} && cd /v/${folder} && ${script}`);
  const count = (side: (script: string) => Promise<string>) => side("ls | grep -c '^file-' || true");
  await page.goto("/knowledge");
  const create = page.getByRole("region", { name: "New knowledge base" });
  await create.getByLabel("Name").fill(name);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(`li[data-knowledge="${name}"]`)).toBeVisible();
  await local("for i in $(seq 1 1100); do echo $i > file-$i.md; done");
  await page.goto(`/knowledge/${name}`);
  await page.getByLabel("Drive folder link").fill(`https://drive.google.com/drive/folders/${folder}`);
  await page.getByRole("button", { name: "Connect" }).click();
  const main = page.locator('main[data-state="knowledge-base"]');
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  expect(await count(remote)).toBe("1100");

  // 600 of 1,100 files deleted here: over the limit, so the run stops, and the page has all 600.
  await local("for i in $(seq 1 600); do rm file-$i.md; done");
  await run(page);
  await expect(main).toHaveAttribute("data-sync-result", "stopped");
  const listed = page.locator("[data-deletions]");
  await expect(listed).toContainText("600 files to delete");
  await expect(listed.locator("li code")).toHaveCount(500);
  await expect(listed.locator("[data-more-deletions]")).toHaveText("and 100 more files");
  expect(await count(remote)).toBe("1100");

  await page.getByRole("button", { name: "Apply these deletions" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Apply these deletions?" });
  await expect(dialog).toContainText("600 files are deleted in Drive");
  await expect(dialog.locator("[data-more-deletions]")).toHaveText("and 100 more files");
  await evidence(page, testInfo, "014-2-apply-many-deletions");
  await dialog.getByRole("button", { name: "Delete 600 files" }).click();
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  expect(await count(remote)).toBe("500");
  expect(await remote("ls file-1.md file-600.md 2>&1 || true")).toContain("No such file");
  expect(await remote("cat file-601.md file-1100.md")).toBe("601\n1100");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Drive folder link")).toBeVisible();
});

test("disconnecting leaves both sides' files, and no secret reached a log or a container left behind", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  const drive = await listing(onDrive);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Disconnect Drive notes from Drive?" });
  await expect(dialog).toContainText("Both keep their files");
  await evidence(page, testInfo, "014-2-disconnect");
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Drive folder link")).toBeVisible();
  expect(await listing(here)).toBe(drive);
  expect(await listing(onDrive)).toBe(drive);
  expect((await docker(["volume", "ls", "-q", "--filter", `name=${STATE_VOLUME}`])).stdout.trim()).toBe("");

  // Every step's container was removed, and neither the server's nor the runtime manager's log has
  // the client secret or a token.
  expect((await docker(["ps", "-aq", "--filter", "label=ai.your-space.role=knowledge-sync", "--filter", `label=ai.your-space.installation=${PROJECT}`])).stdout.trim()).toBe("");
  const all = await logs(["server", "runtime"]);
  for (const secret of [CLIENT_SECRET, "e2e-refresh-token", "e2e-access-token"]) expect(all).not.toContain(secret);
});
