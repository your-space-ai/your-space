// Journey 003: `your-space upgrade` moves an installation to the CLI's own version. It backs up the
// database first, keeps .env, the owner, the data and the apps, and puts the previous version back
// when the new one doesn't start (contracts/cli-commands.md). The previous version is an earlier
// release made from the same images, installed by hand as the guide's manual steps do, since the
// CLI's own `init` installs only its own version. `upgrade --channel alpha` (spec 016) moves it on,
// through a stand-in for the release downloads whose `alpha` feed names the CLI's version.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CLI_VERSION, cliIn, githubStandIn, makeRelease, newFolder, removeInstallation, root, serveFolder, tagImages, type Cli } from "./helpers/cli.ts";
import { compose as e2eCompose, docker, removeApps } from "./helpers/stack.ts";

test.skip(({ browserName }) => browserName !== "chromium", "The CLI doesn't depend on the browser; run it once.");
test.describe.configure({ mode: "serial", timeout: 300_000 });

const WHOAMI = "https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/whoami.yaml";
// Before every real version, so the CLI's own is always the newer one.
const PREVIOUS = "0.0.0-e2e.1";
// The installation's Compose project, which also labels its apps.
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "your-space";

// The server of a new version that migrated the database and then failed: it records a migration
// later than any, adds a table, and exits.
const MIGRATE_THEN_FAIL = `    command:
      - node
      - --input-type=module
      - -e
      - |
        import pg from "pg";
        import { loadConfig } from "./src/config.ts";
        const db = new pg.Client({ connectionString: loadConfig().databaseUrl });
        await db.connect();
        await db.query("CREATE TABLE IF NOT EXISTS upgrade_marker (id int)");
        await db.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('e2e', 9999999999999)");
        process.exit(1);
`;

/** The release's stack.yaml with one change, which must apply. */
function changed(stack: string, find: string | RegExp, replace: string): string {
  const result = stack.replace(find, replace);
  expect(result).not.toBe(stack);
  return result;
}

let releases: string;
let cli: Cli;
/** The release downloads, with the `alpha` feed naming the CLI's version, as Release publish writes it. */
let feed: { url: string; close(): Promise<void> };

test.beforeAll(async () => {
  test.setTimeout(300_000);
  // The other journeys' stack holds port 80; this is the CLI's own installation.
  await removeApps();
  await e2eCompose(["down", "--remove-orphans"], { timeout: 120_000 });
  await removeInstallation(undefined, PROJECT);
  await tagImages([PREVIOUS, CLI_VERSION]);
  releases = mkdtempSync(join(tmpdir(), "ys-releases-"));
  await makeRelease(PREVIOUS, join(releases, "previous"));
  await makeRelease(CLI_VERSION, join(releases, "current"));
  // The CLI's version with a setting its server refuses, so it stops before it migrates anything.
  await makeRelease(CLI_VERSION, join(releases, "broken"), (stack) =>
    changed(stack, "      DATABASE_URL: postgres://yourspace@postgres:5432/yourspace\n", '$&      YS_BROKEN_SETTING: "1"\n'),
  );
  // The CLI's version whose server records a migration later than any, adds a table, then stops: a
  // new version that migrated the database and then failed.
  await makeRelease(CLI_VERSION, join(releases, "migrated"), (stack) => changed(stack, /( {2}server:\n {4}image: [^\n]+\n)/, `$1${MIGRATE_THEN_FAIL}`));
  const served = join(releases, "served");
  await makeRelease(CLI_VERSION, join(served, `v${CLI_VERSION}`));
  mkdirSync(join(served, "alpha"));
  // Any full commit: nothing reads it back.
  const commit = "69525a9569f68a39b76598af86662a04b6fb2886";
  writeFileSync(join(served, "alpha", "channel.json"), execFileSync(join(root, "deploy/channel-json.sh"), ["alpha", CLI_VERSION, commit], { encoding: "utf8" }));
  feed = await serveFolder(served);
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  if (cli) {
    await removeInstallation(cli, PROJECT);
    rmSync(cli.folder, { recursive: true, force: true });
  }
  await feed?.close();
  if (releases) rmSync(releases, { recursive: true, force: true });
  for (const name of ["server", "web", "runtime"]) await docker(["rmi", `ghcr.io/your-space-ai/your-space-${name}:${PREVIOUS}`]);
});

const ok = (result: { code: number; stdout: string; stderr: string; json: any }) => {
  expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.json?.ok).toBe(true);
  return result.json;
};

const stack = () => readFileSync(join(cli.folder, "stack.yaml"), "utf8");
const env = () => readFileSync(join(cli.folder, ".env"), "utf8");
/** What a query in Your Space's database prints. */
const sql = async (query: string) => (await cli.compose(["exec", "-T", "postgres", "psql", "-U", "yourspace", "-d", "yourspace", "-tAc", query])).stdout.trim();
/** When the app's container started: the same after an upgrade when the app kept running. */
const appStarted = async () => (await docker(["inspect", "ys-whoami-web-1", "--format", "{{.State.StartedAt}}"], false)).stdout.trim();

async function appsRunning(): Promise<void> {
  await expect(async () => {
    const apps = ok(await cli.run(["status", "--json"])).apps as { name: string; state: string }[];
    expect(apps.map((app) => [app.name, app.state])).toEqual([["whoami", "running"]]);
  }).toPass({ timeout: 120_000 });
}

test("an earlier release, installed by hand, runs with its owner and an app", async () => {
  const folder = newFolder("upgrade");
  execFileSync("tar", ["--no-same-owner", "-xzf", join(releases, "previous", "your-space.tar.gz"), "-C", folder]);
  writeFileSync(join(folder, ".env"), readFileSync(join(folder, "env.example"), "utf8"));
  cli = cliIn(folder, {});
  // The GitHub stand-in, beside the release's files, so an app can be installed.
  cli.env.COMPOSE_FILE = githubStandIn(folder);

  const started = ok(await cli.run(["start", "--owner-name", "Sam Rivera", "--owner-username", "sam", "--no-open", "--json"]));
  expect(started).toMatchObject({ version: PREVIOUS, running: true, owner: { username: "sam", name: "Sam Rivera" } });
  const installed = await cli.compose(["exec", "-T", "server", "install-app", WHOAMI, "--json"]);
  expect(installed.code, installed.stdout + installed.stderr).toBe(0);
  await appsRunning();
});

test("an upgrade whose new version doesn't start puts the previous one back, with its data", async () => {
  const before = env();
  const failed = await cli.run(["upgrade", "--release-dir", join(releases, "broken"), "--json"]);
  expect(failed.code, failed.stdout).toBe(2);
  expect(failed.json).toMatchObject({ ok: false, error: "start_failed", from: PREVIOUS, to: CLI_VERSION, rolledBack: true, restored: false });
  expect(failed.json.message).toContain("YS_BROKEN_SETTING isn't a setting");
  expect(failed.json.message).toContain(`so Your Space ${PREVIOUS} is back and running, with its data as it was`);
  expect(stack()).toContain(`your-space-server:${PREVIOUS}\n`);
  expect(env()).toBe(before);
  expect(ok(await cli.run(["status", "--json"]))).toMatchObject({ version: PREVIOUS, running: true, owner: { username: "sam", name: "Sam Rivera" } });
  await appsRunning();
});

test("a stopped installation whose new version migrated the database and failed gets the backup restored", async () => {
  const migrations = await sql("select count(*) from drizzle.__drizzle_migrations");
  expect(Number(migrations)).toBeGreaterThan(0);
  ok(await cli.run(["stop", "--json"]));
  const before = env();
  const failed = await cli.run(["upgrade", "--release-dir", join(releases, "migrated"), "--json"]);
  expect(failed.code, failed.stdout).toBe(2);
  expect(failed.json).toMatchObject({ ok: false, error: "start_failed", from: PREVIOUS, to: CLI_VERSION, rolledBack: true, restored: true });
  expect(failed.json.keptDatabase).toMatch(/^yourspace_upgrade_failed_/);
  expect(failed.json.message).toContain(`so Your Space ${PREVIOUS} is back and running, with its database restored from the backup taken just before`);
  expect(stack()).toContain(`your-space-server:${PREVIOUS}\n`);
  expect(env()).toBe(before);
  // The database is the backup: the later migration and the table are gone, and the owner is there.
  expect(await sql("select to_regclass('public.upgrade_marker') is null")).toBe("t");
  expect(await sql("select count(*) from drizzle.__drizzle_migrations where hash = 'e2e'")).toBe("0");
  expect(await sql("select count(*) from drizzle.__drizzle_migrations")).toBe(migrations);
  // The database the new version left is kept beside it, table and all.
  const kept = await cli.compose(["exec", "-T", "postgres", "psql", "-U", "yourspace", "-d", failed.json.keptDatabase, "-tAc", "select to_regclass('public.upgrade_marker') is not null"]);
  expect(kept.stdout.trim()).toBe("t");
  expect(ok(await cli.run(["status", "--json"]))).toMatchObject({ version: PREVIOUS, running: true, owner: { username: "sam", name: "Sam Rivera" } });
  await appsRunning();
});

test("upgrade --channel alpha backs up the database, then runs the version the alpha feed names with the same owner, data and apps", async () => {
  const before = env();
  const app = await appStarted();
  // The feed names the CLI's own version, so it upgrades itself, downloading that release.
  const upgraded = ok(await cli.run(["upgrade", "--channel", "alpha", "--json"], { env: { YS_E2E_RELEASES: feed.url } }));
  expect(upgraded).toEqual({ ok: true, from: PREVIOUS, to: CLI_VERSION, backup: expect.stringMatching(new RegExp(`^${cli.folder}/backups/\\d{8}T\\d{6}Z-${PREVIOUS.replaceAll(".", "\\.")}\\.sql$`)) });
  // The backup is the database from before, readable only by its owner.
  expect(statSync(upgraded.backup).mode & 0o777).toBe(0o600);
  const backup = readFileSync(upgraded.backup, "utf8");
  expect(backup).toContain("-- PostgreSQL database dump complete");
  expect(backup).toContain("Sam Rivera");
  expect(backup).toContain("whoami");

  expect(stack()).toContain(`your-space-server:${CLI_VERSION}\n`);
  expect(env()).toBe(before);
  expect(ok(await cli.run(["status", "--json"]))).toMatchObject({ version: CLI_VERSION, running: true, owner: { username: "sam", name: "Sam Rivera" } });
  await appsRunning();
  // The app kept running through the upgrade.
  expect(await appStarted()).toBe(app);

  const again = ok(await cli.run(["upgrade", "--release-dir", join(releases, "current"), "--json"]));
  expect(again).toEqual({ ok: true, from: CLI_VERSION, to: CLI_VERSION, upToDate: true });
  const already = ok(await cli.run(["upgrade", "--channel", "alpha", "--json"], { env: { YS_E2E_RELEASES: feed.url } }));
  expect(already).toEqual({ ok: true, channel: "alpha", newest: CLI_VERSION, from: CLI_VERSION, to: CLI_VERSION, upToDate: true });
});
