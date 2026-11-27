// Journey 014, slice 1: local knowledge bases. The owner creates them, gives them to apps whose kits
// ask for knowledge, and the apps share their files. Removing an app and deleting its data keeps
// them; deleting one asks first and takes it from its apps. A knowledge base taken from an app leaves
// it once Your Space is back, even when Your Space stopped during the change. Two fixture apps from
// one Compose file (e2e/github/fixtures/ys-fixtures/notes), one running as user 1000 and one as 1234.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { createOwner, docker, PROJECT, resetStack, sql, up } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const kit = (app: string) => `https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/${app}.yaml`;
const ONE = "ys-notes-one-web-1";
const TWO = "ys-notes-two-web-1";
const LINK_LABEL = "Link to the app's kit";

let ownerCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

async function asOwner(page: Page): Promise<void> {
  // Your Space asks in its own modal, never in one of the browser's.
  page.on("dialog", (dialog) => {
    throw new Error(`The browser showed a ${dialog.type()} dialog: ${dialog.message()}`);
  });
  if (ownerCookies.length) return page.context().addCookies(ownerCookies);
  await signIn(page, "sam");
  await expect(page).toHaveURL(/\/$/);
  ownerCookies = await page.context().cookies();
}

async function waitForJob(page: Page): Promise<void> {
  const job = page.locator("section.job");
  await expect(job).toHaveAttribute("data-job-state", /succeeded|failed/, { timeout: 120_000 });
  expect(await job.getAttribute("data-job-state"), (await job.textContent()) ?? "").toBe("succeeded");
}

/** Runs a shell command in an app's container, as the user the app runs as; a command that fails fails the test. */
async function inApp(container: string, script: string): Promise<string> {
  return (await docker(["exec", container, "sh", "-c", script], false)).stdout.trim();
}

const containerId = async (container: string) => (await docker(["inspect", container, "--format", "{{.Id}}"], false)).stdout.trim();

/** A knowledge base's volume on the engine, by its labels: its name, or "" when there is none. */
async function knowledgeVolume(name: string): Promise<string> {
  const filters = [`label=ai.your-space.installation=${PROJECT}`, "label=ai.your-space.role=knowledge", `label=ai.your-space.knowledge=${name}`];
  return (await docker(["volume", "ls", "-q", ...filters.flatMap((f) => ["--filter", f])], false)).stdout.trim();
}

/**
 * Holds the page's requests of a method to a path until the function it returns lets them through.
 * The route stays, passing every request on, so none it holds is left to an unroute.
 */
async function holdRequests(page: Page, path: string, method: string): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === method) await released;
    await route.continue();
  });
  return release;
}

/** Waits for a job, through the API, and checks it succeeded. */
async function jobDone(page: Page, jobId: string): Promise<void> {
  await expect
    .poll(async () => ((await (await page.request.get(`/api/jobs/${jobId}`)).json()) as { state: string }).state, { timeout: 120_000 })
    .not.toBe("running");
  expect(((await (await page.request.get(`/api/jobs/${jobId}`)).json()) as { state: string }).state).toBe("succeeded");
}

async function install(page: Page, app: string, pick: string[]): Promise<void> {
  await page.goto("/apps");
  await page.getByLabel(LINK_LABEL).fill(kit(app));
  await page.getByRole("button", { name: "Review" }).click();
  const knowledge = page.getByRole("region", { name: "Knowledge", exact: true });
  await expect(knowledge).toContainText("asks for knowledge bases");
  for (const title of pick) await knowledge.getByLabel(title).check();
}

test("the owner creates knowledge bases, and the apps given them share their files", async ({ page }, testInfo) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  ownerCookies = [];
  await asOwner(page);

  await page.getByRole("navigation", { name: "Your Space" }).getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();
  await expect(page.getByText("No knowledge base yet.")).toBeVisible();
  const create = page.getByRole("region", { name: "New knowledge base" });
  // The name becomes the folder's: typed text is turned into one.
  await create.getByLabel("Name").fill("Course Notes");
  await expect(create.getByLabel("Name")).toHaveValue("course-notes");
  await create.getByLabel("Title").fill("Course notes");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator('li[data-knowledge="course-notes"]')).toContainText("Not given to any app yet.");
  // While one is being created, the form can't change, so nothing typed meanwhile is cleared when it is.
  const creating = await holdRequests(page, "/api/knowledge", "POST");
  await create.getByLabel("Name").fill("recipes");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create.getByLabel("Name")).toBeDisabled();
  await expect(create.getByLabel("Title")).toBeDisabled();
  creating();
  await expect(page.locator('li[data-knowledge="recipes"]')).toBeVisible();
  await expect(create.getByLabel("Name")).toBeEnabled();
  await expect(create.getByLabel("Name")).toHaveValue("");
  // An error is about what was sent, so it goes once the form changes.
  await create.getByLabel("Name").fill("recipes");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create.getByRole("alert")).toContainText("already exists");
  await create.getByLabel("Name").fill("soups");
  await expect(create.getByRole("alert")).toHaveCount(0);
  await create.getByLabel("Name").fill("");

  // Each is a volume of Your Space's, labelled as knowledge and never as an app's Compose project.
  const notes = await knowledgeVolume("course-notes");
  expect(notes).not.toBe("");
  const labels = JSON.parse((await docker(["volume", "inspect", notes, "--format", "{{json .Labels}}"], false)).stdout) as Record<string, string>;
  expect(labels).toEqual({ "ai.your-space.installation": PROJECT, "ai.your-space.role": "knowledge", "ai.your-space.knowledge": "course-notes" });

  // The rename keeps the name, the folder in apps.
  await page.getByRole("button", { name: "Rename recipes" }).click();
  await page.getByLabel("Title of recipes").fill("Family recipes");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(page.locator('li[data-knowledge="recipes"]')).toContainText("Family recipes");
  await evidence(page, testInfo, "014-1-knowledge-bases");

  // The review of a kit that asks for knowledge offers the owner's knowledge bases; none is picked.
  await install(page, "notes-one", ["Course notes"]);
  await expect(page.getByRole("region", { name: "Knowledge", exact: true }).getByLabel("Family recipes")).not.toBeChecked();
  await evidence(page, testInfo, "014-1-review-picker");
  await page.getByRole("button", { name: "Install" }).click();
  await waitForJob(page);
  await install(page, "notes-two", ["Course notes", "Family recipes"]);
  await page.getByRole("button", { name: "Install" }).click();
  await waitForJob(page);

  // A new knowledge base's folder belongs to user and group 1000, is writable by everyone, and gives
  // new files its group.
  expect(await inApp(ONE, "stat -c '%a %u:%g' /knowledge/course-notes")).toBe("2777 1000:1000");
  await inApp(ONE, "echo 'Week 1: cells' > /knowledge/course-notes/week-1.md");
  expect(await inApp(TWO, "cat /knowledge/course-notes/week-1.md")).toBe("Week 1: cells");
  // The app running as another user writes there too, and its file has the folder's group.
  await inApp(TWO, "echo 'Week 2: tissues' > /knowledge/course-notes/week-2.md && echo 'Lentil soup' > /knowledge/recipes/soup.md");
  expect(await inApp(ONE, "cat /knowledge/course-notes/week-2.md")).toBe("Week 2: tissues");
  expect(await inApp(ONE, "stat -c '%u:%g' /knowledge/course-notes/week-2.md")).toBe("1234:1000");
  // The app given only the first doesn't have the second.
  expect(await inApp(ONE, "ls -1 /knowledge")).toBe("course-notes");
  expect(await inApp(TWO, "ls -1 /knowledge")).toBe("course-notes\nrecipes");

  await page.goto("/knowledge");
  await expect(page.locator('li[data-knowledge="course-notes"]')).toContainText("Used by Notes one, Notes two");
  await expect(page.locator('li[data-knowledge="recipes"]')).toContainText("Used by Notes two");
});

test("the app's page changes its knowledge bases, which recreates its interface service", async ({ page }, testInfo) => {
  await asOwner(page);
  const before = await containerId(ONE);
  await page.goto("/apps/notes-one");
  const knowledge = page.getByRole("region", { name: "Knowledge", exact: true });
  await expect(knowledge.getByLabel("Course notes")).toBeChecked();
  await expect(knowledge.getByRole("button", { name: "Save knowledge bases" })).toBeDisabled();
  await knowledge.getByLabel("Family recipes").check();
  await expect(knowledge).toContainText("Saving restarts the app's interface service");
  await evidence(page, testInfo, "014-1-app-knowledge");
  // While the save is under way, the picks can't change, so none made meanwhile is lost when it ends.
  const saving = await holdRequests(page, "/api/apps/notes-one/knowledge", "PUT");
  await knowledge.getByRole("button", { name: "Save knowledge bases" }).click();
  await expect(knowledge.getByLabel("Course notes")).toBeDisabled();
  await expect(knowledge.getByLabel("Family recipes")).toBeDisabled();
  // Once it is saved, the picks stay as saved, and can't change, until the app's details show them.
  const details = await holdRequests(page, "/api/apps/notes-one", "GET");
  saving();
  await expect(page.locator("section.job")).toBeVisible();
  await expect(knowledge.getByLabel("Family recipes")).toBeChecked();
  await expect(knowledge.getByLabel("Family recipes")).toBeDisabled();
  details();
  await waitForJob(page);
  await expect(knowledge.getByLabel("Family recipes")).toBeEnabled();
  await expect(knowledge.getByLabel("Family recipes")).toBeChecked();
  expect(await containerId(ONE)).not.toBe(before);
  expect(await inApp(ONE, "cat /knowledge/recipes/soup.md")).toBe("Lentil soup");
  // Files written before the change are still there.
  expect(await inApp(ONE, "cat /knowledge/course-notes/week-1.md")).toBe("Week 1: cells");

  // A pick of a knowledge base deleted since, as in another tab, is dropped once the list shows it gone.
  const origin = new URL(page.url()).origin;
  expect((await page.request.post("/api/knowledge", { data: { name: "scratch" }, headers: { origin } })).status()).toBe(201);
  await page.reload();
  await knowledge.getByLabel("scratch").check();
  await expect(knowledge.getByRole("button", { name: "Save knowledge bases" })).toBeEnabled();
  expect((await page.request.delete("/api/knowledge/scratch", { headers: { origin } })).status()).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(knowledge.getByLabel("scratch")).toHaveCount(0);
  await expect(knowledge.getByRole("button", { name: "Save knowledge bases" })).toBeDisabled();

  // One the app is given after the list was read stays given when the picks change.
  await page.reload();
  await expect(knowledge.getByLabel("Family recipes")).toBeChecked();
  expect((await page.request.post("/api/knowledge", { data: { name: "late" }, headers: { origin } })).status()).toBe(201);
  const given = await page.request.put("/api/apps/notes-one/knowledge", { data: { bases: ["course-notes", "late", "recipes"] }, headers: { origin } });
  expect(given.status()).toBe(202);
  await jobDone(page, ((await given.json()) as { jobId: string }).jobId);
  // The app's details show it from their next refresh; the list, read before it was created, doesn't.
  await page.waitForResponse(async (r) => r.url().endsWith("/api/apps/notes-one") && r.request().method() === "GET" && (await r.text()).includes('"late"'), { timeout: 15_000 });
  await expect(knowledge.getByLabel("late")).toHaveCount(0);
  await knowledge.getByLabel("Family recipes").uncheck();
  await knowledge.getByRole("button", { name: "Save knowledge bases" }).click();
  await waitForJob(page);
  const detail = (await (await page.request.get("/api/apps/notes-one")).json()) as { knowledge: { bases: { name: string }[] } };
  expect(detail.knowledge.bases.map((base) => base.name)).toEqual(["course-notes", "late"]);
  expect((await page.request.delete("/api/knowledge/late", { headers: { origin } })).status()).toBe(204);
});

test("a knowledge base taken from an app leaves it once Your Space is back, though Your Space stopped during the change", async ({ page }) => {
  test.setTimeout(300_000);
  await asOwner(page);
  await page.goto("/apps/notes-one");
  const origin = new URL(page.url()).origin;
  const notes = await knowledgeVolume("course-notes");
  const mounts = async () => (await docker(["inspect", ONE, "--format", "{{range .Mounts}}{{.Name}} {{end}}"], false)).stdout;
  expect(await mounts()).toContain(notes);
  const before = await containerId(ONE);
  // The runtime manager stops answering, so the apply that would take it from the app never ends,
  // and then Your Space's server and runtime manager stop without finishing it.
  const runtime = `${PROJECT}-runtime-1`;
  await docker(["pause", runtime], false);
  try {
    const taken = await page.request.put("/api/apps/notes-one/knowledge", { data: { bases: [] }, headers: { origin } });
    expect(taken.status()).toBe(202);
    await docker(["kill", `${PROJECT}-server-1`], false);
  } finally {
    await docker(["kill", runtime], false);
  }
  // Meanwhile its grant is gone, and its container, unchanged, still mounts it.
  expect(await sql("select count(*) from app_knowledge_base g join app a on a.id = g.app_id where a.name = 'notes-one'")).toEqual(["0"]);
  expect(await containerId(ONE)).toBe(before);
  expect(await mounts()).toContain(notes);

  // Once Your Space is back, it applies the app again without it, and records that against itself.
  // Asked without failing, as the container is briefly gone while Compose recreates it.
  await up();
  const recreated = async () => {
    const answer = (await docker(["inspect", ONE, "--format", "{{.State.Running}} {{range .Mounts}}{{.Name}} {{end}}"])).stdout.trim();
    return /^true\b/.test(answer) && !answer.includes(notes);
  };
  await expect.poll(recreated, { timeout: 120_000 }).toBe(true);
  expect(await containerId(ONE)).not.toBe(before);
  expect(await inApp(ONE, "[ -e /knowledge/course-notes ] && echo there || echo gone")).toBe("gone");
  expect(
    await sql(
      "select a.kind from event e join actor a on a.id = e.actor_id join event_knowledge_base k on k.event_id = e.id join app p on p.id = e.subject_app_id where e.type = 'knowledge.revoked' and p.name = 'notes-one' and k.name = 'course-notes' order by e.created_at desc limit 1",
    ),
  ).toEqual(["operator"]);
  await page.goto("/apps/notes-one");
  const knowledge = page.getByRole("region", { name: "Knowledge", exact: true });
  await expect(knowledge.getByLabel("Course notes")).not.toBeChecked();
});

test("removing an app and deleting its data keeps its knowledge bases' files", async ({ page }) => {
  await asOwner(page);
  await page.goto("/apps/notes-one");
  // Given back the knowledge base the test before took from it, so the app removed mounts it.
  const origin = new URL(page.url()).origin;
  const given = await page.request.put("/api/apps/notes-one/knowledge", { data: { bases: ["course-notes"] }, headers: { origin } });
  expect(given.status()).toBe(202);
  await jobDone(page, ((await given.json()) as { jobId: string }).jobId);
  expect(await inApp(ONE, "cat /knowledge/course-notes/week-1.md")).toBe("Week 1: cells");
  await page.reload();
  await page.getByRole("button", { name: "Remove app", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove app", exact: true }).click();
  await waitForJob(page);
  await page.goto("/apps");
  await page.getByRole("button", { name: "Delete data of notes-one" }).click();
  await page.getByRole("alertdialog").getByLabel("Type notes-one to confirm").fill("notes-one");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete data" }).click();
  await expect(page.getByRole("heading", { name: "Kept data" })).toHaveCount(0);
  expect((await docker(["volume", "ls", "-q", "--filter", "name=ys-notes-one_data"], false)).stdout.trim()).toBe("");

  expect(await knowledgeVolume("course-notes")).not.toBe("");
  expect(await knowledgeVolume("recipes")).not.toBe("");
  // The file the removed app wrote is still in the knowledge base.
  expect(await inApp(TWO, "cat /knowledge/course-notes/week-1.md")).toBe("Week 1: cells");
  await page.goto("/knowledge");
  await expect(page.locator('li[data-knowledge="course-notes"]')).toContainText("Used by Notes two");
});

test("deleting a knowledge base asks first, names the apps that use it, and takes it from them", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Delete Course notes" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete Course notes?" });
  await expect(dialog).toContainText("Notes two uses it, and restarts without its folder.");
  await expect(dialog).toContainText("Its files are deleted. This can't be undone.");
  await evidence(page, testInfo, "014-1-delete-knowledge");
  // Cancel, and Escape, leave it as it is.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Delete Course notes" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await inApp(TWO, "ls -1 /knowledge")).toBe("course-notes\nrecipes");

  const before = await containerId(TWO);
  await page.getByRole("button", { name: "Delete Course notes" }).click();
  await dialog.getByRole("button", { name: "Delete knowledge base" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator('li[data-knowledge="course-notes"]')).toHaveCount(0);
  expect(await knowledgeVolume("course-notes")).toBe("");
  expect(await containerId(TWO)).not.toBe(before);
  expect(await inApp(TWO, "ls -1 /knowledge")).toBe("recipes");

  await page.getByRole("button", { name: "Delete Family recipes" }).click();
  await page.getByRole("alertdialog", { name: "Delete Family recipes?" }).getByRole("button", { name: "Delete knowledge base" }).click();
  await expect(page.getByText("No knowledge base yet.")).toBeVisible({ timeout: 120_000 });
  expect(await knowledgeVolume("recipes")).toBe("");
  // With none left, Your Space mounts nothing, so the knowledge path may not be there at all.
  expect(await inApp(TWO, "[ ! -e /knowledge ] || ls -1A /knowledge")).toBe("");
});
