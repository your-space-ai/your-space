// Journey 014, slice 2: synced knowledge bases. The owner sets up the Google connection with their own
// OAuth client and signs in; a knowledge base connected to a Drive folder then syncs both ways with
// real rclone bisync, run by a container of stock `rclone rcd` for each knowledge base, which the
// server drives over its socket. Google is never contacted: the browser's sign-in page is answered by the test, the server
// exchanges the code with a stand-in (e2e/google), and rclone syncs with a folder of a test volume in
// place of Drive (YS_E2E_SYNC_FIXTURE in e2e/compose.e2e.yaml). The server syncs every few seconds
// (YS_E2E_SYNC_INTERVAL_S), so changes arrive without Sync now; the tests wait for files, not runs.
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
/** A knowledge base's sync container: stock rclone's remote control. */
const rcloneOf = (name: string) => `${PROJECT}_knowledge-sync-rclone-${name}-1`;
const RCLONE = rcloneOf(KB);
const containerId = async (name: string) => (await docker(["inspect", name, "--format", "{{.Id}}"], false)).stdout.trim();
const mountsOf = async (name: string) => (JSON.parse((await docker(["inspect", name, "--format", "{{json .Mounts}}"], false)).stdout) as { Destination: string }[]).map((m) => m.Destination).sort();
const SECRETS = [CLIENT_SECRET, "e2e-refresh-token", "e2e-access-token"];
/** Already on the engine: the GitHub stand-in runs it. */
const SHELL_IMAGE = "node:26-slim";
/**
 * The tests' own containers run as user 1000 in the engine's own user name space, as rclone's does
 * when Your Space's containers run there, on an engine that remaps containers' users: the files they
 * write are then rclone's user's. On any other engine this changes nothing.
 */
const AS_RCLONE = ["--userns", "host", "--user", "1000:1000"];

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
  const result = await docker(["run", "--rm", "--network", "none", ...AS_RCLONE, "-v", `${volume}:/v`, SHELL_IMAGE, "sh", "-c", script]);
  if (result.code !== 0) throw new Error(`The script failed: ${result.stderr}`);
  return result.stdout.trim();
}
const here = (script: string) => shell(KB_VOLUME, `cd /v && ${script}`);
const onDrive = (script: string) => shell(DRIVE_VOLUME, `cd /v/${FOLDER} && ${script}`);
/** Changes both sides in one go, with no sync between them. */
async function onBoth(local: string, drive: string): Promise<void> {
  const result = await docker(["run", "--rm", "--network", "none", ...AS_RCLONE, "-v", `${KB_VOLUME}:/a`, "-v", `${DRIVE_VOLUME}:/r`, SHELL_IMAGE, "sh", "-c", `cd /a && ${local} && cd /r/${FOLDER} && ${drive}`]);
  if (result.code !== 0) throw new Error(`The script failed: ${result.stderr}`);
}
/** Waits for a side to answer what is expected, as a timed sync carries changes over; a script that fails, as on a file not there yet, answers its error. */
const arrives = (side: () => Promise<string>, expected: string, timeout = 60_000) =>
  expect.poll(() => side().catch((error: unknown) => String(error)), { timeout, intervals: [500] }).toBe(expected);
/** Every file of a side and its content, to tell whether a run changed it. */
const listing = (side: (script: string) => Promise<string>) => side("find . -type f | sort | while read f; do echo \"$f: $(cat \"$f\")\"; done");

/**
 * Chooses Sync now, or another action, and waits for a run to finish. Only for a knowledge base whose
 * runs stopped for the owner, which the timer leaves alone, so the run is the one chosen.
 */
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
  await docker(["run", "--rm", "--network", "none", "--userns", "host", "-v", `${DRIVE_VOLUME}:/v`, SHELL_IMAGE, "sh", "-c", `mkdir -p /v/${FOLDER} && chown -R 1000:1000 /v && chmod 2777 /v`], false);
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

  // Created and changed on either side: they arrive on the other without Sync now, at the next timed run.
  await here("echo 'Changed here' > from-drive.md && echo 'New here' > new-here.md");
  await onDrive("echo 'Changed on Drive' > from-here.md && echo 'New on Drive' > new-there.md");
  await arrives(() => here("cat from-here.md new-there.md 2>&1"), "Changed on Drive\nNew on Drive");
  await arrives(() => onDrive("cat from-drive.md new-here.md 2>&1"), "Changed here\nNew here");
  await expect(main).toHaveAttribute("data-sync-result", "synced");
  // A run that changed files is recorded against Your Space, not the owner.
  expect(await sql("select a.kind from event e join actor a on a.id = e.actor_id where e.type = 'knowledge.synced'")).toContain("operator");

  // Deleted on either side.
  await here("rm new-here.md");
  await onDrive("rm new-there.md");
  await arrives(() => here("ls"), "course\nfrom-drive.md\nfrom-here.md");
  await arrives(() => listing(onDrive), await listing(here));

  // Sync now runs at once, and the page says so.
  await here("echo 'Now' > now.md");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await arrives(() => onDrive("cat now.md 2>&1"), "Now", 15_000);
  await here("rm now.md");
  await arrives(() => onDrive("ls"), "course\nfrom-drive.md\nfrom-here.md");

  // The list shows how the sync stands.
  await page.goto("/knowledge");
  await expect(page.locator(`li[data-knowledge="${KB}"] [data-sync-line]`)).toContainText("Synced with Google Drive");
});

test("the sync's network reaches nothing but its proxy, which refuses any host but Google's", async () => {
  // From a container on the sync's sealed network, as each rclone is: the GitHub stand-in, on
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
  await arrives(() => onDrive("cat plan.md 2>&1"), "Plan");
  // Both sides change it before the next run.
  await onBoth("echo 'Edited here' > plan.md", "echo 'Edited on Drive' > plan.md");
  // The copy here keeps the name; Drive's is renamed, and both sides have both.
  await arrives(() => here("cat plan.md plan.md.conflict1 2>&1"), "Edited here\nEdited on Drive");
  await arrives(() => onDrive("cat plan.md plan.md.conflict1 2>&1"), "Edited here\nEdited on Drive");
  const conflicts = page.getByRole("region", { name: "Conflict copies" });
  await expect(conflicts).toContainText("plan.md.conflict1", { timeout: 30_000 });
  await conflicts.scrollIntoViewIfNeeded();
  await evidence(page, testInfo, "014-2-conflicts");
  // Resolved by the owner: the copy is deleted, and leaves the list.
  await here("rm plan.md.conflict1");
  await expect(page.getByRole("region", { name: "Conflict copies" })).toHaveCount(0, { timeout: 30_000 });
  await arrives(() => onDrive("ls | grep -c conflict || true"), "0");
});

test("each knowledge base syncs through an rclone of its own, so a symbolic link in one can't have a sync write into another", async ({ page }) => {
  test.setTimeout(240_000);
  await asOwner(page);
  const name = "other";
  const folder = "1E2eTestFolder0000000000000000ij";
  const other = (script: string) => shell(`ys-knowledge.${PROJECT}.${name}`, `cd /v && ${script}`);
  const notes = await containerId(RCLONE);
  await page.goto("/knowledge");
  const create = page.getByRole("region", { name: "New knowledge base" });
  await create.getByLabel("Name").fill(name);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(`li[data-knowledge="${name}"]`)).toBeVisible();
  await page.goto(`/knowledge/${name}`);
  await page.getByLabel("Drive folder link").fill(`https://drive.google.com/drive/folders/${folder}`);
  await page.getByRole("button", { name: "Connect" }).click();
  const main = page.locator('main[data-state="knowledge-base"]');
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  // Each rclone mounts its own knowledge base, its sync state and its socket's folder only; connecting
  // another left the first running as it was.
  expect(await mountsOf(rcloneOf(name))).toEqual([`/knowledge/${name}`, "/remote", "/run/ys-sync", `/state/${name}`]);
  expect(await mountsOf(RCLONE)).toEqual([`/knowledge/${KB}`, "/remote", "/run/ys-sync", `/state/${KB}`]);
  expect(await containerId(RCLONE)).toBe(notes);

  // An app given only drive-notes makes a symbolic link to where the other knowledge base would be,
  // and Drive has files under that name: rclone writes through a link to a folder, so in one container
  // mounting both, the next run would copy them into the other knowledge base.
  await here(`ln -s /knowledge/${name} evil && ln -s /state/${name} evil-state`);
  await onDrive("mkdir -p evil evil-state && echo planted > evil/planted.md && echo planted > evil-state/planted.md");
  const planted = new Date().toISOString();
  // Drive-notes' next run, started after them, can't: the links lead nowhere in its own container.
  await expect
    .poll(async () => (await sql(`select s.last_run_at > '${planted}'::timestamptz and s.job is null from knowledge_sync s join knowledge_base b on b.id = s.knowledge_base_id where b.name = '${KB}'`))[0], { timeout: 60_000 })
    .toBe("t");
  expect(await other("ls -A")).toBe(".your-space-sync");
  expect(await shell(`ys-knowledge.${PROJECT}.${name}.sync`, "find /v -name planted.md")).toBe("");
  // The app's own knowledge base gets back to syncing once the links are gone.
  await here("rm evil evil-state");
  await onDrive("rm -r evil evil-state");
  await page.goto(`/knowledge/${KB}`);
  const notesPage = page.locator('main[data-state="knowledge-base"]');
  await expect(notesPage).toHaveAttribute("data-sync-running", "false", { timeout: 60_000 });
  if ((await notesPage.getAttribute("data-sync-result")) === "stopped") await run(page, "Resync");
  await expect(notesPage).toHaveAttribute("data-sync-result", "synced", { timeout: 60_000 });

  // Disconnecting the other removes its rclone only.
  await page.goto(`/knowledge/${name}`);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Drive folder link")).toBeVisible();
  expect((await docker(["ps", "-aq", "--filter", `name=${rcloneOf(name)}`])).stdout.trim()).toBe("");
  expect(await containerId(RCLONE)).toBe(notes);
});

test("a missing marker or an empty knowledge base stops the sync with Drive unchanged, and Resync deletes nothing", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  const main = page.locator('main[data-state="knowledge-base"]');
  const drive = await listing(onDrive);

  // The next timed run stops, and the timer leaves the knowledge base for the owner.
  await here("rm .your-space-sync");
  await expect(main).toHaveAttribute("data-sync-result", "stopped", { timeout: 30_000 });
  await expect(page.locator('[data-sync-notice="marker"]')).toContainText("marker file, .your-space-sync, is missing in the knowledge base");
  expect(await listing(onDrive)).toBe(drive);
  await evidence(page, testInfo, "014-2-stopped-marker");
  await run(page, "Resync");
  await expect(main).toHaveAttribute("data-sync-result", "synced");
  expect(await listing(here)).toBe(drive);
  expect(await listing(onDrive)).toBe(drive);

  // An emptied knowledge base never reads as "everything was deleted".
  await here("find . -mindepth 1 -delete");
  await expect(main).toHaveAttribute("data-sync-result", "stopped", { timeout: 30_000 });
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
  await arrives(() => onDrive("ls | grep -c batch || true"), "6");
  const drive = await listing(onDrive);
  const deleteMost = () => here("rm batch-*.md from-here.md");

  await deleteMost();
  await expect(main).toHaveAttribute("data-sync-result", "stopped", { timeout: 30_000 });
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
  await expect(page.locator("[data-deletions]")).toContainText("7 files to delete", { timeout: 30_000 });
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

  // The owner opens the list, and meanwhile a sync from another tab stops on a different one: the
  // dialog keeps the list they opened, says it is out of date, and can't confirm it.
  await page.getByRole("button", { name: "Apply these deletions" }).click();
  await expect(dialog.getByRole("button", { name: "Delete 8 files" })).toBeEnabled();
  await here("rm course/week-1.md");
  const other = await page.context().newPage();
  await other.goto(`/knowledge/${KB}`);
  await run(other);
  await expect(other.locator("[data-deletions]")).toContainText("9 files to delete");
  await other.close();
  await page.bringToFront();
  await expect(dialog.locator("[data-deletions-outdated]")).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("8 files are deleted in Drive");
  await expect(dialog.getByRole("button", { name: "Delete 8 files" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await listing(onDrive)).toBe(drive);

  // Confirmed with the new list, they are deleted in Drive; the next run has the limit again.
  await page.getByRole("button", { name: "Apply these deletions" }).click();
  await dialog.getByRole("button", { name: "Delete 9 files" }).click();
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  expect(await listing(onDrive)).toBe(await listing(here));
  expect(await onDrive("ls")).not.toMatch(/batch|from-/);
  await here("for i in 1 2 3 4 5 6; do echo \"Again $i\" > again-$i.md; done");
  await arrives(() => onDrive("ls | grep -c again || true"), "6");
  await here("rm again-*.md");
  await expect(main).toHaveAttribute("data-sync-result", "stopped", { timeout: 30_000 });
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
  await arrives(() => onDrive("cat after-key.md 2>&1"), "After the new key");
  await expect(page.locator('main[data-state="knowledge-base"]')).toHaveAttribute("data-sync-result", "synced");
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
  await here("echo 'After reconnecting' > reconnected.md");
  await arrives(() => onDrive("cat reconnected.md 2>&1"), "After reconnecting");
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
  await arrives(() => local("cat newer.md"), "Newest on Drive");
  const kept = await shell(`ys-knowledge.${PROJECT}.${name}.sync`, "cd /v/backups && for f in $(ls -1 | sort); do cat $f/newer.md; done");
  expect(kept).toBe("Older here\nNewer on Drive");
  const backups = page.getByRole("region", { name: "Replaced files" });
  await expect(backups).toBeVisible({ timeout: 30_000 });
  await backups.getByText("Replaced files").click();
  await expect(backups.locator("li")).toHaveCount(2, { timeout: 30_000 });
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
  await expect(main).toHaveAttribute("data-sync-result", "stopped", { timeout: 30_000 });
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

test("the client secret and token are in rclone's memory only: in no container's configuration, file or log", async () => {
  // Its rclone has them, for the remote the server made over its socket before the knowledge base's
  // runs.
  const remote = () => docker(["exec", RCLONE, "rclone", "rc", "--unix-socket", "/run/ys-sync/rc.sock", "config/get", `name=kb-${KB}`]).then((r) => r.stdout);
  await expect.poll(remote, { timeout: 30_000 }).toContain("e2e-refresh-token");
  expect(await remote()).toContain(CLIENT_SECRET);
  // No container of the installation has them in its environment, command or labels: not rclone's,
  // whose configuration the engine keeps on disk, nor the server's or the runtime manager's.
  const ids = new Set<string>();
  for (const label of [`ai.your-space.installation=${PROJECT}`, `com.docker.compose.project=${PROJECT}`]) {
    for (const id of (await docker(["ps", "-aq", "--filter", `label=${label}`])).stdout.split("\n").filter(Boolean)) ids.add(id);
  }
  expect(ids.size).toBeGreaterThan(3);
  for (const id of ids) {
    const config = (await docker(["inspect", id, "--format", "{{json .Config}} {{json .HostConfig.Binds}} {{json .Mounts}}"], false)).stdout;
    for (const secret of SECRETS) expect(config, id).not.toContain(secret);
  }
  // Its rclone's container mounts no engine socket, runs as user 1000, and writes nothing else but its volumes and /tmp.
  const rclone = JSON.parse((await docker(["inspect", RCLONE], false)).stdout)[0] as { Config: { User: string; Env: string[] }; HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[] }; Mounts: { Destination: string }[] };
  expect(rclone.Config.User).toBe("1000:1000");
  expect(rclone.HostConfig).toMatchObject({ ReadonlyRootfs: true, CapDrop: ["ALL"] });
  expect(rclone.Mounts.map((m) => m.Destination).sort()).toEqual(["/knowledge/drive-notes", "/remote", "/run/ys-sync", "/state/drive-notes"]);
  const found = await docker(["exec", RCLONE, "sh", "-c", `grep -rl ${SECRETS.map((x) => `-e '${x}'`).join(" ")} /run/ys-sync /state /knowledge /remote /tmp 2>/dev/null; true`], false);
  expect(found.stdout.trim()).toBe("");
  const said = await docker(["logs", RCLONE], false);
  for (const secret of SECRETS) expect(said.stdout + said.stderr).not.toContain(secret);
  // Its socket is in a folder only user 1000, rclone's and the server's, opens.
  expect((await docker(["exec", RCLONE, "stat", "-c", "%a %u", "/run/ys-sync"], false)).stdout.trim()).toBe("700 1000");
});

test("a restarted rclone syncs again once the server has made its remotes again", async ({ page }) => {
  await asOwner(page);
  await page.goto(`/knowledge/${KB}`);
  // rclone forgets its remotes: its configuration is in memory only.
  await docker(["restart", RCLONE], false);
  await here("echo 'After rclone restarted' > restarted.md");
  await arrives(() => onDrive("cat restarted.md 2>&1"), "After rclone restarted");
  await expect(page.locator('main[data-state="knowledge-base"]')).toHaveAttribute("data-sync-result", "synced");
});

/** A knowledge base with many files to copy, so a run takes a while. */
const BIG = "big";
const BIG_FOLDER = "1E2eTestFolder0000000000000000gh";
const bigHere = (script: string) => shell(`ys-knowledge.${PROJECT}.${BIG}`, `cd /v && ${script}`);
const bigThere = (script: string) => shell(DRIVE_VOLUME, `mkdir -p /v/${BIG_FOLDER} && cd /v/${BIG_FOLDER} && ${script}`);
const bigRow = async (column: string) => (await sql(`select ${column} from knowledge_sync s join knowledge_base b on b.id = s.knowledge_base_id where b.name = '${BIG}'`))[0];
const MANY = 30_000;
/** The big knowledge base's run under way, once it is one that started after `since`: one that copies every file made before it. */
const runSince = (since: string) => bigRow(`case when (s.job->>'startedAt')::timestamptz > '${since}' then s.job end`);

test("a run goes on when only the server restarts, and the next server records its result", async ({ page }) => {
  test.setTimeout(400_000);
  await asOwner(page);
  await page.goto("/knowledge");
  const create = page.getByRole("region", { name: "New knowledge base" });
  await create.getByLabel("Name").fill(BIG);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(`li[data-knowledge="${BIG}"]`)).toBeVisible();
  await page.goto(`/knowledge/${BIG}`);
  await page.getByLabel("Drive folder link").fill(`https://drive.google.com/drive/folders/${BIG_FOLDER}`);
  await page.getByRole("button", { name: "Connect" }).click();
  const main = page.locator('main[data-state="knowledge-base"]');
  await expect(main).toHaveAttribute("data-sync-result", "synced", { timeout: 120_000 });
  const synced = async () => Number((await sql(`select count(*) from event e join event_knowledge_base k on k.event_id = e.id where e.type = 'knowledge.synced' and k.name = '${BIG}'`))[0]);

  await bigHere(`mkdir first && cd first && seq 1 ${MANY} | while read i; do echo $i > f-$i; done`);
  const made = new Date().toISOString();
  // A timed run that starts once they are all there copies them; the server stops while it is under way.
  await expect.poll(async () => (await runSince(made)) ?? null, { timeout: 60_000, intervals: [100] }).not.toBeNull();
  await compose(["stop", "server"]);
  // Counted once the server is stopped: only the next server can record the run under way.
  const before = await synced();
  const kept = await runSince(made);
  expect(kept, "The run copying the files was still on the row when the server stopped.").toBeTruthy();
  const job = JSON.parse(kept!) as { id: number; startedAt: string };
  // rclone finishes the run without the server, and keeps its result.
  // Only its state: its result holds the run's whole log, which is long for this many files.
  const status = async () => {
    const said = await docker(["exec", rcloneOf(BIG), "sh", "-c", `rclone rc --unix-socket /run/ys-sync/rc.sock job/status jobid=${job.id} | grep -E '"(finished|success)":'`]);
    return { finished: said.stdout.includes('"finished": true'), success: said.stdout.includes('"success": true') };
  };
  await expect.poll(async () => (await status()).finished, { timeout: 240_000, intervals: [1_000] }).toBe(true);
  expect((await status()).success).toBe(true);
  await up();
  // The next server reads the run's result from rclone, and records it as that run's: the files it
  // copied, as no later run copies anything, and not as a run that was interrupted. The knowledge
  // base is due again at once, so the row soon shows a later run.
  await expect.poll(synced, { timeout: 60_000 }).toBeGreaterThan(before);
  expect(await bigRow(`job is null or job->>'startedAt' <> '${job.startedAt}'`)).toBe("t");
  expect(await sql(`select count(*) from event e join event_knowledge_base k on k.event_id = e.id where e.type = 'knowledge.sync_failed' and k.name = '${BIG}'`)).toEqual(["0"]);
  await arrives(() => bigThere(`ls first | wc -l`), String(MANY), 240_000);
  await asOwner(page);
  await page.goto(`/knowledge/${BIG}`);
  await expect(main).toHaveAttribute("data-sync-result", "synced");
});

test("stopping Your Space during a run stops rclone gracefully, and the next start carries the run on without a resync", async ({ page }) => {
  test.setTimeout(400_000);
  await bigHere(`mkdir second && cd second && seq 1 ${MANY} | while read i; do echo $i > g-$i; done`);
  const made = new Date().toISOString();
  // A run that copies them all is under way when Your Space stops, not one that started before they were there.
  await expect.poll(async () => (await runSince(made)) ?? null, { timeout: 60_000, intervals: [100] }).not.toBeNull();
  // As `your-space stop` does: the apps and the sync first, then Your Space.
  await compose(["exec", "-T", "runtime", "stop-apps"]);
  // Stopped by SIGINT: rclone exits with 130 once bisync has shut down.
  expect((await docker(["inspect", rcloneOf(BIG), "--format", "{{.State.Running}} {{.State.ExitCode}}"], false)).stdout.trim()).toBe("false 130");
  await compose(["stop"]);
  await up();
  // The server starts rclone again, and the next run copies the rest: no resync is asked of the owner.
  await arrives(() => bigThere("ls second | wc -l"), String(MANY), 240_000);
  await expect.poll(() => bigRow("result"), { timeout: 60_000 }).toBe("synced");
  expect(await bigRow("resync")).toBe("f");
  await asOwner(page);
  await page.goto(`/knowledge/${BIG}`);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Drive folder link")).toBeVisible({ timeout: 60_000 });
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

  // With no knowledge base synced, the sync's containers are gone, and neither the server's nor the
  // runtime manager's log has the client secret or a token.
  expect((await docker(["ps", "-aq", "--filter", "label=ai.your-space.role=knowledge-sync", "--filter", `label=ai.your-space.installation=${PROJECT}`])).stdout.trim()).toBe("");
  const all = await logs(["server", "runtime"]);
  for (const secret of SECRETS) expect(all).not.toContain(secret);
});
