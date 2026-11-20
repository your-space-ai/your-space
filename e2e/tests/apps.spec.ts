// Journey 002: install apps from their own Compose files and use them in Your Space. A stand-in for
// GitHub serves the fixture apps (e2e/github); Sure and Twenty run by hand (verification record).
import { Agent, request } from "node:http";
import { createServer } from "node:net";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { evidence } from "./helpers/evidence.ts";
import { compose, createOwner, docker, resetStack, serverCommand, up } from "./helpers/stack.ts";
import { setPassword, signIn } from "./helpers/ui.ts";

test.describe.configure({ mode: "serial" });

const WHOAMI = "https://github.com/ys-fixtures/whoami/blob/main/compose.yaml";
const PROBE = "https://github.com/ys-fixtures/probe/blob/main/compose.yaml";
const NOFRAME = "https://github.com/ys-fixtures/noframe/blob/main/compose.yaml";
const LINK_LABEL = "Link to the app's Compose file";

// The owner signs in once: sign-in allows three attempts per address in 10 seconds (journey 001).
let ownerCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

async function asOwner(page: Page): Promise<void> {
  if (ownerCookies.length) return page.context().addCookies(ownerCookies);
  await signIn(page, "sam");
  await expect(page).toHaveURL(/\/$/);
  ownerCookies = await page.context().cookies();
}

async function waitForJob(page: Page): Promise<void> {
  const job = page.locator("section.job");
  await expect(job).toHaveAttribute("data-job-state", /succeeded|failed/, { timeout: 120_000 });
  // On failure, the job's own steps and error say why.
  expect(await job.getAttribute("data-job-state"), (await job.textContent()) ?? "").toBe("succeeded");
}

async function inspect(container: string, format: string): Promise<string> {
  return (await docker(["inspect", container, "--format", format], false)).stdout.trim();
}

/** Runs a shell command inside an app's container. */
async function inApp(container: string, script: string): Promise<string> {
  return (await docker(["exec", container, "sh", "-c", script])).stdout.trim();
}

/** A GET on a connection of its own, or on one of `agent`'s: the status, and whether it reused a connection. */
function get(url: string, agent: Agent | false = false): Promise<{ status: number; reused: boolean }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { agent, timeout: 30_000 }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, reused: req.reusedSocket }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

test("the owner installs an app from its link, after a review and a trust warning", async ({ page, browser }, testInfo) => {
  await resetStack();
  const owner = await createOwner();
  await setPassword(page, owner.url);
  ownerCookies = [];
  await asOwner(page);

  await page.goto("/apps");
  await expect(page.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
  await expect(page.locator("li[data-app]")).toHaveCount(0);

  await page.getByLabel(LINK_LABEL).fill(WHOAMI);
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByText("Published ports removed")).toBeVisible();
  await expect(page.getByText(/trusts it with everything/)).toBeVisible();
  await expect(page.getByText("example.com")).toBeVisible();
  // The generated secret replaces the published default, and neither is shown (FR-006).
  await expect(page.locator("body")).not.toContainText("published-default-token");
  await evidence(page, testInfo, "002-us3-1-review");

  await page.getByRole("button", { name: "Install" }).click();
  await waitForJob(page);
  await page.goto("/apps");
  await expect(page.locator('li[data-app="whoami"]')).toHaveAttribute("data-app-state", "running");
  await evidence(page, testInfo, "002-us3-2-installed");

  // Nobody else can list or install apps (FR-010).
  const stranger = await browser.newContext();
  const refused = await stranger.request.get("/api/apps");
  expect(refused.status()).toBe(401);
  expect((await stranger.request.post("/api/apps/preview", { headers: { origin: "http://space.localhost" }, data: { link: PROBE } })).status()).toBe(401);
  await stranger.close();

  // The container publishes no port of its own (FR-015).
  expect(await inspect("ys-whoami-web-1", "{{json .HostConfig.PortBindings}}")).toBe("{}");
});

test("the app opens in a pane on its own origin, only for the signed-in owner", async ({ page, browser, browserName }) => {
  await asOwner(page);
  await page.goto("/open/whoami");
  const pane = page.frameLocator('[data-testid="app-pane"]');
  let echoed: string;
  if (browserName === "webkit") {
    // WebKit treats each *.localhost name as its own site and blocks the app's cookies in a pane,
    // so on this setup the app opens in its own tab instead (FR-016).
    await expect(pane.getByRole("heading", { name: "This browser won't run the app here" })).toBeVisible({ timeout: 30_000 });
    const [tab] = await Promise.all([page.context().waitForEvent("page"), pane.getByRole("link", { name: "Open in its own tab" }).click()]);
    await expect(tab.locator("body")).toContainText("Hostname", { timeout: 30_000 });
    echoed = (await tab.locator("body").textContent()) ?? "";
    await tab.close();
  } else {
    await expect(pane.locator("body")).toContainText("Hostname", { timeout: 30_000 });
    echoed = (await pane.locator("body").textContent()) ?? "";
  }
  // whoami echoes the request it received: its own host, and none of Your Space's cookies.
  expect(echoed).toContain("Host: whoami.space.localhost");
  expect(echoed).not.toMatch(/ys-pass|session_token/);

  // Only Your Space may frame the app.
  const direct = await page.request.get("http://whoami.space.localhost/");
  expect(direct.headers()["content-security-policy"]).toContain("frame-ancestors http://space.localhost:*");
  expect(direct.headers()["x-frame-options"]).toBeUndefined();

  // Someone who isn't signed in reaches no part of the app (SC-005).
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto("http://whoami.space.localhost/anything");
  await expect(visitor).toHaveURL(/^http:\/\/space\.localhost(:\d+)?\/sign-in/);
  await expect(visitor.locator("body")).not.toContainText("Hostname");
  await stranger.close();
});

test("the owner changes a setting, and secrets show only as set", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto("/apps/whoami");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("published-default-token");
  await page.getByLabel("GREETING").fill("hi there");
  await page.getByRole("button", { name: "Save settings" }).click();
  await waitForJob(page);
  await expect(page.getByLabel("GREETING")).toHaveValue("hi there");
  const env = await inspect("ys-whoami-web-1", "{{json .Config.Env}}");
  expect(env).toContain("GREETING=hi there");
  await evidence(page, testInfo, "002-us5-settings");
});

test("an app can't reach Your Space, other apps, the host or the internet", async () => {
  const installed = await serverCommand("install-app", [PROBE]);
  expect(installed.code, installed.stderr).toBe(0);
  // The network itself: -Y off bypasses the app's outbound proxy.
  const blocked = await inApp(
    "ys-probe-web-1",
    `t(){ if timeout 4 "$@" >/dev/null 2>&1; then echo reached; else echo blocked; fi; }
     t wget -Y off -qO- http://server:3000/api/health
     t wget -Y off -qO- http://ys-e2e-server-1:3001/gate
     t nc -z ys-e2e-postgres-1 5432
     t wget -Y off -qO- http://ys-whoami-web-1/
     t wget -Y off -qO- http://ys-whoami-ui/
     t nc -z 172.17.0.1 2375
     t nc -z 1.1.1.1 443
     t test -S /var/run/docker.sock`,
  );
  expect(blocked.split("\n")).toEqual(Array(8).fill("blocked"));
  // The outbound proxy refuses private addresses, so it is no way around the network either.
  const viaProxy = await inApp(
    "ys-probe-web-1",
    `for u in http://ys-e2e-server-1:3000/api/health http://172.17.0.1:2375/ http://127.0.0.1:8080/; do
       if timeout 6 wget -qO- "$u" >/dev/null 2>&1; then echo reached; else echo blocked; fi; done`,
  );
  expect(viaProxy.split("\n")).toEqual(Array(3).fill("blocked"));
  // A sanity check that the probe itself works: its own service answers.
  expect(await inApp("ys-probe-web-1", "wget -Y off -qO- http://web:8080/")).toBe("ok");
});

test("blocked hosts become access requests the owner approves or dismisses", async ({ page }, testInfo) => {
  await asOwner(page);
  // Two attempts the egress proxy refuses.
  await inApp("ys-probe-web-1", "http_proxy=http://ys-egress:3128 wget -T5 -qO- http://approve-me.example/ ; http_proxy=http://ys-egress:3128 wget -T5 -qO- http://dismiss-me.example/ ; true");
  await page.goto("/apps/probe");
  const requests = page.locator("section", { has: page.getByRole("heading", { name: "Access requests" }) });
  await expect(async () => {
    await page.reload();
    await expect(requests).toContainText("approve-me.example", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await evidence(page, testInfo, "002-us6-1-requests");

  await page.getByRole("button", { name: "Dismiss dismiss-me.example" }).click();
  // The list refreshes after a dismissal; approve once it has.
  await expect(page.getByRole("button", { name: "Dismiss dismiss-me.example" })).toHaveCount(0);
  const [approval] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/requests/") && r.url().endsWith("/approve")),
    page.getByRole("button", { name: "Approve approve-me.example" }).click(),
  ]);
  expect(approval.status(), await approval.text()).toBe(202);
  await waitForJob(page);
  await page.reload();
  const outbound = page.locator("section", { has: page.getByRole("heading", { name: "Outbound access" }) });
  await expect(outbound).toContainText("approve-me.example");
  const config = await inApp("ys-probe-ys-egress-1", "cat /etc/squid/squid.conf");
  expect(config).toContain("acl approved dstdomain approve-me.example");
  expect(config).not.toContain("dismiss-me.example");

  // A dismissed host stays dismissed when the app tries again.
  await inApp("ys-probe-web-1", "http_proxy=http://ys-egress:3128 wget -T5 -qO- http://dismiss-me.example/ ; true");
  await page.waitForTimeout(16_000);
  await page.reload();
  await expect(page.getByRole("button", { name: "Approve dismiss-me.example" })).toHaveCount(0);
});

test("the owner sees each service, its logs and limits, and the engine", async ({ page }) => {
  await asOwner(page);
  await page.goto("/apps/whoami");
  await page.getByText("Advanced").click();
  await page.getByRole("button", { name: "Show logs" }).click();
  await expect(page.getByLabel("Logs")).not.toBeEmpty({ timeout: 15_000 });
  await page.getByLabel("Memory limit for web in MiB").fill("96");
  await page.getByRole("button", { name: "Save limits" }).click();
  await waitForJob(page);
  expect(await inspect("ys-whoami-web-1", "{{.HostConfig.Memory}}")).toBe(String(96 * 1024 * 1024));
  // Apps go first when memory runs out (FR-D06).
  expect(await inspect("ys-whoami-web-1", "{{.HostConfig.OomScoreAdj}}")).toBe("500");

  await page.goto("/engine");
  await expect(page.getByRole("heading", { name: "Engine" })).toBeVisible();
  await expect(page.locator("[data-field=reachable]")).toHaveText("Reachable");
  await expect(page.locator('tr[data-app="whoami"]')).toBeVisible();
});

test("the owner publishes an app on a port of this machine, for their own proxy or tunnel", async ({ page }, testInfo) => {
  await asOwner(page);
  await page.goto("/apps/whoami");
  const publishing = page.locator("section", { has: page.getByRole("heading", { name: "Publishing" }) });
  await publishing.getByLabel(/^Publish on a port/).check();

  // A port another program on this machine uses is refused when the owner saves, not when the app starts.
  const program = createServer();
  await new Promise<void>((resolve) => program.listen(18782, "127.0.0.1", resolve));
  try {
    await publishing.getByLabel(/^Port/).fill("18782");
    await publishing.getByRole("button", { name: "Save publishing" }).click();
    await expect(publishing.getByRole("alert")).toHaveText("Port 18782 on 127.0.0.1 is already used by another program on this machine. Choose another port.", {
      timeout: 60_000,
    });
  } finally {
    await new Promise((resolve) => program.close(resolve));
  }

  await publishing.getByLabel(/^Port/).fill("18781");
  await publishing.getByLabel(/^Link/).fill("http://127.0.0.1:18781");
  await publishing.getByRole("button", { name: "Save publishing" }).click();
  await waitForJob(page);

  // Your Space's Caddy passes each request on to the app with the proxy's own headers, and no gate in
  // between. It starts with the app, so the first request may come before it listens.
  let echoed = "";
  await expect(async () => {
    const answer = await page.request.get("http://127.0.0.1:18781/inbox", { headers: { "X-Forwarded-Proto": "https" }, maxRedirects: 0, timeout: 5_000 });
    expect(answer.status()).toBe(200);
    echoed = await answer.text();
  }).toPass({ timeout: 30_000 });
  expect(echoed).toContain("GET /inbox");
  expect(echoed).toContain("Host: 127.0.0.1:18781");
  expect(echoed).toContain("X-Forwarded-Proto: https");
  // Only Your Space's Caddy publishes the port; the app's own container still publishes none (FR-015).
  expect(await inspect("ys-whoami-web-1", "{{json .HostConfig.PortBindings}}")).toBe("{}");
  expect(await inspect("ys-whoami-ys-publish-1", "{{json .HostConfig.PortBindings}}")).toContain('"HostIp":"127.0.0.1","HostPort":"18781"');

  // A browser's first visit through the owner's proxy asks for many files at once: every request is
  // answered.
  const burst = await Promise.allSettled(Array.from({ length: 200 }, (_, i) => get(`http://127.0.0.1:18781/file-${i}`)));
  const failed = burst.flatMap((r, i) => (r.status === "fulfilled" && r.value.status === 200 ? [] : [`${i}: ${r.status === "fulfilled" ? r.value.status : String(r.reason)}`]));
  expect(failed).toEqual([]);

  // Your Space shows it in its pane, which frames the link (decision 2026-11-20).
  await page.goto("/apps");
  await expect(page.locator('li[data-app="whoami"]').getByRole("link", { name: /^Open/ })).toHaveAttribute("href", /\/open\/whoami$/);
  expect(((await (await page.request.get("/api/apps/whoami")).json()) as { origin: string }).origin).toBe("http://127.0.0.1:18781");
  await page.goto("/apps/whoami");
  await expect(page.getByRole("region", { name: "Status" }).getByRole("link", { name: "Open", exact: true })).toHaveAttribute("href", /\/open\/whoami$/);
  await page.goto("/open/whoami");
  const pane = page.locator('section[data-pane="whoami"]');
  // At an address that carries the ID of the app's Caddy, so the browser never shows a page cached before.
  await expect(pane.locator('[data-testid="app-pane"]')).toHaveAttribute("src", /^http:\/\/127\.0\.0\.1:18781\/\?ys-pane=[0-9a-f]{12}$/);
  await expect(page.frameLocator('[data-testid="app-pane"]').locator("body")).toContainText("Host: 127.0.0.1:18781", { timeout: 30_000 });
  await expect(pane.getByRole("link", { name: "Open in its own tab" })).toHaveAttribute("href", "http://127.0.0.1:18781");

  // An app that refuses to be framed shows in its pane too: its Caddy lets only Your Space's origin
  // frame it, and leaves the rest of the app's policy alone.
  const installed = await serverCommand("install-app", [NOFRAME, "--publish", "--port", "18783", "--link", "http://127.0.0.1:18783"]);
  expect(installed.code, installed.stderr).toBe(0);
  const headersOf = async (): Promise<(name: string) => string[]> => {
    let headers: { name: string; value: string }[] = [];
    await expect(async () => {
      const answer = await page.request.get("http://127.0.0.1:18783/", { timeout: 5_000 });
      expect(answer.status()).toBe(200);
      headers = answer.headersArray();
    }).toPass({ timeout: 30_000 });
    return (name) => headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
  };
  let values = await headersOf();
  expect(values("x-frame-options")).toEqual([]);
  expect(values("content-security-policy")).toEqual(["default-src 'self'; frame-ancestors http://space.localhost:*", "frame-ancestors http://space.localhost:*"]);
  await page.goto("/open/noframe");
  await expect(page.frameLocator('[data-testid="app-pane"]').getByRole("heading", { name: "Refuses to be framed" })).toBeVisible({ timeout: 30_000 });
  await evidence(page, testInfo, "002-publish-1-pane");

  // With "Show inside Your Space" off, its Caddy passes the app's responses on as the app sent them,
  // and the app opens at its link in its own tab.
  await page.goto("/apps/noframe");
  await publishing.getByLabel(/^Show inside Your Space/).uncheck();
  await evidence(page, testInfo, "002-publish-2-switch");
  await publishing.getByRole("button", { name: "Save publishing" }).click();
  await waitForJob(page);
  await expect(async () => {
    values = await headersOf();
    expect(values("x-frame-options")).toEqual(["DENY"]);
  }).toPass({ timeout: 30_000 });
  expect(values("content-security-policy")).toEqual(["default-src 'self'; frame-ancestors 'none'"]);
  const listed = (await serverCommand("list-apps")).json as { apps: { name: string; publish: { frame: boolean } | null }[] };
  expect(listed.apps.find((a) => a.name === "noframe")!.publish).toMatchObject({ frame: false });
  await page.goto("/open/noframe");
  const card = page.locator('section[data-pane="noframe"]');
  await expect(card).toContainText("opens there in its own tab");
  await expect(card.locator('[data-testid="app-pane"]')).toHaveCount(0);
  const ownTab = card.getByRole("link", { name: "Open in its own tab" });
  await expect(ownTab).toHaveCount(2);
  for (const link of await ownTab.all()) await expect(link).toHaveAttribute("href", "http://127.0.0.1:18783");
  await page.goto("/apps");
  await expect(page.locator('li[data-app="noframe"]').getByRole("link", { name: /^Open/ })).toHaveAttribute("href", "http://127.0.0.1:18783");

  // This app closes its connection after each answer. Caddy still keeps the visitor's connection open,
  // and it works after a pause.
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  try {
    expect((await get("http://127.0.0.1:18783/", agent)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await get("http://127.0.0.1:18783/", agent)).toEqual({ status: 200, reused: true });
  } finally {
    agent.destroy();
  }

  // It goes again, with its data, so the journeys after this one find the apps they expect.
  await page.goto("/apps/noframe");
  await page.getByRole("button", { name: "Remove app", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove app", exact: true }).click();
  await waitForJob(page);
  await page.goto("/apps");
  await page.getByRole("button", { name: "Delete data of noframe" }).click();
  await page.getByRole("alertdialog").getByLabel("Type noframe to confirm").fill("noframe");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete data" }).click();
  await expect(page.getByRole("heading", { name: "Kept data" })).toHaveCount(0);

  // Stopping publishing closes the port, and the app is still at its own address.
  await page.goto("/apps/whoami");
  await publishing.getByLabel(/^Publish on a port/).uncheck();
  await publishing.getByRole("button", { name: "Save publishing" }).click();
  await waitForJob(page);
  const closed = await page.request.get("http://127.0.0.1:18781/", { timeout: 5_000 }).then(
    () => false,
    () => true,
  );
  expect(closed).toBe(true);
  await page.goto("/apps");
  await expect(page.locator('li[data-app="whoami"]').getByRole("link", { name: /^Open/ })).toHaveAttribute("href", /\/open\/whoami$/);
});

test("two apps side by side on a large screen, one at a time on a phone", async ({ page }) => {
  await asOwner(page);
  await page.goto("/open/whoami?with=probe");
  await expect(page.locator('[data-testid="app-pane"]')).toHaveCount(2);
  const [first, second] = await Promise.all([page.locator('[data-testid="app-pane"]').nth(0).boundingBox(), page.locator('[data-testid="app-pane"]').nth(1).boundingBox()]);
  expect(second!.x).toBeGreaterThan(first!.x + first!.width - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/open/whoami");
  const pane = page.locator('[data-testid="app-pane"]');
  await expect(pane).toHaveCount(1);
  expect((await pane.boundingBox())!.width).toBeGreaterThan(370);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "probe" }).click();
  await expect(page).toHaveURL(/\/open\/probe$/);
});

test("restarting Your Space leaves apps running; stopping it stops them, and starting brings them back", async ({ page }) => {
  const started = await inspect("ys-whoami-web-1", "{{.State.StartedAt}}");
  await compose(["restart", "server", "runtime", "caddy"], { timeout: 120_000 });
  await up();
  expect(await inspect("ys-whoami-web-1", "{{.State.StartedAt}}")).toBe(started);
  await asOwner(page);
  await page.goto("/apps");
  await expect(page.locator('li[data-app="whoami"]')).toHaveAttribute("data-app-state", "running");

  // The documented stop: the runtime manager stops the apps, then Compose stops Your Space.
  await compose(["exec", "-T", "runtime", "stop-apps"]);
  expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("false");
  await compose(["stop"], { timeout: 120_000 });
  await up();
  await expect(async () => {
    expect(await inspect("ys-whoami-web-1", "{{.State.Running}}")).toBe("true");
  }).toPass({ timeout: 60_000 });
});

test("removing an app keeps its data, which a reinstall reuses or the owner deletes", async ({ page }, testInfo) => {
  await asOwner(page);
  await inApp("ys-probe-web-1", "echo kept > /data/note");
  await page.goto("/apps/probe");
  await page.getByRole("button", { name: "Remove app", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove app", exact: true }).click();
  await waitForJob(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading", { name: "Kept data" })).toBeVisible();
  expect((await docker(["ps", "-aq", "--filter", "name=ys-probe-"])).stdout.trim()).toBe("");
  expect((await docker(["volume", "ls", "-q", "--filter", "name=ys-probe_data"])).stdout.trim()).toBe("ys-probe_data");
  await evidence(page, testInfo, "002-us9-1-kept");

  await page.getByLabel(LINK_LABEL).fill(PROBE);
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByLabel("Reuse kept data").check();
  await page.getByRole("button", { name: "Install" }).click();
  await waitForJob(page);
  expect(await inApp("ys-probe-web-1", "cat /data/note")).toBe("kept");

  await page.goto("/apps/probe");
  await page.getByRole("button", { name: "Remove app", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove app", exact: true }).click();
  await waitForJob(page);
  await page.goto("/apps");
  await page.getByRole("button", { name: "Delete data of probe" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This can't be undone");
  await dialog.getByLabel("Type probe to confirm").fill("probe");
  await dialog.getByRole("button", { name: "Delete data" }).click();
  await expect(page.getByRole("heading", { name: "Kept data" })).toHaveCount(0);
  expect((await docker(["volume", "ls", "-q", "--filter", "name=ys-probe_data"])).stdout.trim()).toBe("");
});
