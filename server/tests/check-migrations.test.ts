// The pull request check that keeps migrations on main as merged and new ones stamped after them
// (scripts/check-migrations.mjs; spec 016, decision 8 and FR-011), run on throwaway git repositories.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/check-migrations.mjs", import.meta.url));
const DIR = "server/drizzle";
const JOURNAL = `${DIR}/meta/_journal.json`;
const MAIN_WHEN = 1795530850233;
const DAY = 24 * 60 * 60 * 1000;

// Git without the machine's configuration (commit signing, hooks, default branch), and without a
// GIT_DIR or GIT_WORK_TREE inherited from a hook, which would point it at the outer repository.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

// The CircleCI Arm job runs the tests in node:26-slim, which has no git. GitHub Actions has it, so
// the required check always runs these.
const HAS_GIT = spawnSync("git", ["--version"]).status === 0;

interface Entry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const entry = (idx: number, name: string, when: number): Entry => ({
  idx,
  version: "7",
  when,
  tag: `${String(idx).padStart(4, "0")}_${name}`,
  breakpoints: true,
});

describe.skipIf(!HAS_GIT && !process.env.GITHUB_ACTIONS)("check-migrations", () => {
  let repo: string;

  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, env: ENV, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const journal = (): Entry[] => JSON.parse(readFileSync(join(repo, JOURNAL), "utf8")).entries;
  const setJournal = (entries: Entry[]) =>
    write(JOURNAL, `${JSON.stringify({ version: "7", dialect: "postgresql", entries }, null, 2)}\n`);
  /** Adds a migration the way drizzle-kit generate does: its SQL, its snapshot and its journal entry. */
  const migrate = (name: string, when: number, idx = journal().length) => {
    const added = entry(idx, name, when);
    write(`${DIR}/${added.tag}.sql`, `CREATE TABLE "${name}" ("id" uuid PRIMARY KEY);\n`);
    write(`${DIR}/meta/${added.tag.slice(0, 4)}_snapshot.json`, `{ "id": "${name}" }\n`);
    setJournal([...journal(), added]);
    return added;
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  const run = (main = "main", head = "HEAD") => {
    const result = spawnSync(process.execPath, [SCRIPT, main, head], { cwd: repo, env: ENV, encoding: "utf8" });
    return { status: result.status, out: result.stdout, err: result.stderr };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ys-check-migrations-"));
    git("init", "-q", "-b", "main");
    setJournal([]);
    migrate("initial", MAIN_WHEN - 1000);
    migrate("theme_mode", MAIN_WHEN);
    write("README.md", "A workspace.\n");
    commit("Two migrations on main");
    git("switch", "-q", "-c", "feature");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("passes a branch that appends a migration stamped after main's", () => {
    migrate("knowledge_bases", MAIN_WHEN + 1);
    commit("Add a migration");
    expect(run()).toMatchObject({ status: 0, out: expect.stringContaining("2 as merged, 1 new after them") });
  });

  it("refuses an edit to a merged migration's SQL", () => {
    write(`${DIR}/0001_theme_mode.sql`, "ALTER TABLE x ADD COLUMN y text;\n");
    commit("Edit a merged migration");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain(`${DIR}/0001_theme_mode.sql, on main, is changed.`);
    expect(result.err).toContain("npm run db:generate --workspace server");
  });

  it("refuses an edit to a merged migration's snapshot", () => {
    write(`${DIR}/meta/0000_snapshot.json`, "{}\n");
    commit("Edit a merged snapshot");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`${DIR}/meta/0000_snapshot.json, on main, is changed.`) });
  });

  it("refuses a merged migration renamed", () => {
    git("mv", `${DIR}/0001_theme_mode.sql`, `${DIR}/0001_mode.sql`);
    setJournal(journal().map((e) => (e.idx === 1 ? { ...e, tag: "0001_mode" } : e)));
    commit("Rename a merged migration");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain(`tag changed from "0001_theme_mode" to "0001_mode"`);
    expect(result.err).toContain(`${DIR}/0001_theme_mode.sql, on main, is deleted or renamed.`);
  });

  it("refuses a merged migration deleted", () => {
    setJournal(journal().filter((e) => e.idx !== 1));
    rmSync(join(repo, `${DIR}/0001_theme_mode.sql`));
    rmSync(join(repo, `${DIR}/meta/0001_snapshot.json`));
    commit("Delete a merged migration");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain("The journal entry for 0001_theme_mode, on main, is missing.");
    expect(result.err).toContain(`${DIR}/0001_theme_mode.sql, on main, is deleted or renamed.`);
    expect(result.err).toContain(`${DIR}/meta/0001_snapshot.json, on main, is deleted or renamed.`);
  });

  it.each([
    ["breakpoints", false, "true to false"],
    ["version", "8", '"7" to "8"'],
  ])("refuses a change to a merged journal entry's %s", (field, value, change) => {
    setJournal(journal().map((e) => (e.idx === 1 ? { ...e, [field]: value } : e)));
    commit("Change a merged entry");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`${field} changed from ${change}`) });
  });

  it.each([
    ["at", MAIN_WHEN],
    ["before", MAIN_WHEN - 500],
  ])("refuses a new migration stamped %s main's newest", (_, when) => {
    migrate("old_stamp", when);
    commit("Add a migration with an old stamp");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`0002_old_stamp is stamped ${when}, not after ${MAIN_WHEN}`) });
  });

  it("refuses a new migration stamped more than a day from now", () => {
    const when = Date.now() + 2 * DAY;
    migrate("future", when);
    commit("Add a migration stamped in two days");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`0002_future is stamped ${when}, more than a day after`) });
  });

  it("refuses new migrations whose stamps go backward", () => {
    migrate("first", MAIN_WHEN + 20);
    migrate("second", MAIN_WHEN + 10);
    commit("Add two migrations out of order");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`0003_second is stamped ${MAIN_WHEN + 10}, not after ${MAIN_WHEN + 20}`) });
  });

  it("refuses a duplicate idx", () => {
    migrate("knowledge_bases", MAIN_WHEN + 1, 1);
    commit("Add a migration with a duplicate idx");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain("0001_knowledge_bases has idx 1, not 2.");
    // Its snapshot takes the name of the merged migration's.
    expect(result.err).toContain(`${DIR}/meta/0001_snapshot.json, on main, is changed.`);
  });

  it("refuses a tag that doesn't start with its idx", () => {
    const added = migrate("knowledge_bases", MAIN_WHEN + 1);
    rmSync(join(repo, `${DIR}/${added.tag}.sql`));
    write(`${DIR}/knowledge_bases.sql`, "SELECT 1;\n");
    setJournal(journal().map((e) => (e.idx === 2 ? { ...e, tag: "knowledge_bases" } : e)));
    commit("Add a migration without its idx in the tag");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining("knowledge_bases's tag doesn't start with its idx, 0002_.") });
  });

  it("refuses a new .sql file without a journal entry", () => {
    write(`${DIR}/0002_knowledge_bases.sql`, "SELECT 1;\n");
    commit("Add SQL alone");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`${DIR}/0002_knowledge_bases.sql has 0 new journal entries, not 1.`) });
  });

  it("refuses a journal entry without a new .sql file", () => {
    setJournal([...journal(), entry(2, "knowledge_bases", MAIN_WHEN + 1)]);
    commit("Add an entry alone");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`0002_knowledge_bases has no new ${DIR}/0002_knowledge_bases.sql.`) });
  });

  it("refuses a new migration without its snapshot", () => {
    migrate("knowledge_bases", MAIN_WHEN + 1);
    rmSync(join(repo, `${DIR}/meta/0002_snapshot.json`));
    commit("Add a migration without its snapshot");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`0002_knowledge_bases has no new ${DIR}/meta/0002_snapshot.json.`) });
  });

  it("refuses a new snapshot without a journal entry", () => {
    write(`${DIR}/meta/0009_snapshot.json`, "{}\n");
    commit("Add a snapshot alone");
    expect(run()).toMatchObject({ status: 1, err: expect.stringContaining(`${DIR}/meta/0009_snapshot.json has 0 new journal entries, not 1.`) });
  });

  it("passes a stacked branch whose base adds a migration, checked against main", () => {
    migrate("knowledge_bases", MAIN_WHEN + 1);
    commit("The lower pull request's migration");
    git("switch", "-q", "-c", "upper");
    migrate("knowledge_sync", MAIN_WHEN + 2);
    commit("The upper pull request's migration");
    expect(run("main", "upper")).toMatchObject({ status: 0, out: expect.stringContaining("2 as merged, 2 new after them") });
  });

  it("passes the upper pull request of a stack once the lower one is squashed into main", () => {
    migrate("knowledge_bases", MAIN_WHEN + 1);
    commit("The lower pull request's migration");
    git("switch", "-q", "-c", "upper");
    migrate("knowledge_sync", MAIN_WHEN + 2);
    commit("The upper pull request's migration");
    git("switch", "-q", "main");
    git("merge", "-q", "--squash", "feature");
    git("commit", "-q", "-m", "The lower pull request, squashed");
    expect(run("main", "upper")).toMatchObject({ status: 0, out: expect.stringContaining("3 as merged, 1 new after them") });
  });

  it("passes a branch behind main that doesn't change the migrations", () => {
    write("README.md", "A workspace, documented.\n");
    commit("Documentation only");
    git("switch", "-q", "main");
    migrate("knowledge_bases", MAIN_WHEN + 1);
    commit("Main takes a migration");
    expect(run("main", "feature")).toMatchObject({ status: 0, out: expect.stringContaining("3 as merged, 0 new after them") });
  });

  it("passes a branch behind main that adds a file under server/drizzle that isn't a migration", () => {
    write(`${DIR}/README.md`, "Generated by drizzle-kit.\n");
    commit("A note beside the migrations");
    git("switch", "-q", "main");
    migrate("knowledge_bases", MAIN_WHEN + 1);
    commit("Main takes a migration");
    expect(run("main", "feature")).toMatchObject({ status: 0, out: expect.stringContaining("3 as merged, 0 new after them") });
  });

  it("refuses a branch overtaken by a migration on main until it is rebased and stamped again", () => {
    migrate("source_credential", MAIN_WHEN + 20);
    commit("This branch's migration");
    git("switch", "-q", "main");
    migrate("knowledge_bases", MAIN_WHEN + 50);
    commit("Another pull request's migration merges first");

    const result = run("main", "feature");
    expect(result.status).toBe(1);
    expect(result.err).toContain("main took migrations after this branch left it, which its journal doesn't have (0002_knowledge_bases)");

    // Rebased with main's migrations and generated again, the branch's migration comes after them.
    git("switch", "-q", "-C", "feature", "main");
    migrate("source_credential", MAIN_WHEN + 60);
    commit("This branch's migration, generated again");
    expect(run("main", "feature")).toMatchObject({ status: 0, out: expect.stringContaining("3 as merged, 1 new after them") });
  });

  it("fails closed when it can't compare", () => {
    expect(run("main", "no-such-branch")).toMatchObject({ status: 2, err: expect.stringContaining("Couldn't compare the migrations") });
  });

  it.each([
    ["isn't JSON", "{\n"],
    ["has no entries list", '{ "version": "7" }\n'],
  ])("fails closed on a journal that %s", (_, text) => {
    write(JOURNAL, text);
    commit("Break the journal");
    expect(run()).toMatchObject({ status: 2, err: expect.stringContaining("Couldn't compare the migrations") });
  });

  it("compares a push with the commit before it", () => {
    const before = git("rev-parse", "main");
    migrate("knowledge_bases", MAIN_WHEN + 1);
    commit("A merge to main");
    expect(run(before, "HEAD").status).toBe(0);
    write(`${DIR}/0000_initial.sql`, "SELECT 1;\n");
    commit("A merge to main that edits a migration");
    expect(run(before, "HEAD")).toMatchObject({ status: 1, err: expect.stringContaining(`${DIR}/0000_initial.sql, on main, is changed.`) });
  });
});
