#!/usr/bin/env node
// Refuses a change to a migration already on main, and a new migration not stamped after every
// earlier one (spec 016, decision 8 and FR-011). Drizzle runs only migrations stamped later than
// the newest a database records and never reads one again once applied, so either mistake would be
// skipped without an error on a database that already followed main.
//
//   node server/scripts/check-migrations.mjs <main> <head>
//
// <main> is main as it is now (CI fetches it when the check runs), <head> the commit to check. Both
// are read from git objects, so the working tree doesn't matter.
import { execFileSync } from "node:child_process";

const DIR = "server/drizzle";
const JOURNAL = `${DIR}/meta/_journal.json`;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

const pad = (idx) => String(idx).padStart(4, "0");
const sqlPath = (entry) => `${DIR}/${entry.tag}.sql`;
const snapshotPath = (entry) => `${DIR}/meta/${pad(entry.idx)}_snapshot.json`;

/** The tree object of server/drizzle in a commit, or "" when it has none. */
const folder = (commit) => git("ls-tree", "-d", "--full-tree", "--object-only", commit, "--", DIR).trim();

/** The blob of each file under server/drizzle in a commit, by path. */
function files(commit) {
  const out = new Map();
  for (const line of git("ls-tree", "-r", "-z", "--full-tree", commit, "--", DIR).split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    out.set(line.slice(tab + 1), line.slice(0, tab).split(" ")[2]);
  }
  return out;
}

/** The journal's entries, or [] when there is no journal. */
function entries(commit, blobs) {
  const blob = blobs.get(JOURNAL);
  if (!blob) return [];
  const { entries } = JSON.parse(git("cat-file", "blob", blob));
  if (!Array.isArray(entries)) throw new Error(`${JOURNAL} in ${commit} has no entries list.`);
  return entries;
}

/** What keeps head's migrations from following main's, with how many there are of each. */
function compare(main, head) {
  const base = git("merge-base", main, head).trim();
  const mainFiles = files(main);
  const mainEntries = entries(main, mainFiles);
  const problems = [];

  // A branch that doesn't change the migrations can't break them, however far behind main it is.
  if (folder(base) === folder(head)) return { problems, merged: mainEntries.length, added: [] };

  const headFiles = files(head);
  const headEntries = entries(head, headFiles);

  // Overtaken: main took migrations after this branch left it, and the branch's journal doesn't
  // have them. Everything else follows from that, so it is all that is reported until a rebase.
  const missing = mainEntries.filter((entry, i) => headEntries[i]?.tag !== entry.tag).map((entry) => entry.tag);
  if (missing.length && folder(base) !== folder(main)) {
    problems.push(
      `main took migrations after this branch left it, which its journal doesn't have (${missing.join(", ")}): ` +
        "rebase on main, then generate this branch's migrations again so they come after main's.",
    );
    return { problems, merged: mainEntries.length, added: [] };
  }

  // Every migration on main stays as merged: its journal entry, its SQL and its snapshot.
  mainEntries.forEach((entry, i) => {
    const now = headEntries[i];
    if (!now) {
      problems.push(`The journal entry for ${entry.tag}, on main, is missing.`);
      return;
    }
    for (const field of ["idx", "when", "tag", "breakpoints"]) {
      if (now[field] !== entry[field]) {
        const [was, is] = [entry[field], now[field]].map((value) => JSON.stringify(value));
        problems.push(`The journal entry for ${entry.tag}, on main, has its ${field} changed from ${was} to ${is}.`);
      }
    }
    for (const path of [sqlPath(entry), snapshotPath(entry)]) {
      if (!mainFiles.has(path)) continue;
      if (!headFiles.has(path)) problems.push(`${path}, on main, is deleted or renamed.`);
      else if (headFiles.get(path) !== mainFiles.get(path)) problems.push(`${path}, on main, is changed.`);
    }
  });

  // New migrations come after main's: the next idx, a tag starting with it, a later stamp.
  const added = headEntries.slice(mainEntries.length);
  let idx = mainEntries.length ? mainEntries.at(-1).idx : -1;
  let newest = Math.max(-Infinity, ...mainEntries.map((entry) => entry.when));
  for (const entry of added) {
    const name = typeof entry.tag === "string" ? entry.tag : `The entry at idx ${entry.idx}`;
    if (entry.idx !== idx + 1) problems.push(`${name} has idx ${JSON.stringify(entry.idx)}, not ${idx + 1}.`);
    if (typeof entry.tag !== "string" || !entry.tag.startsWith(`${pad(entry.idx)}_`)) {
      problems.push(`${name}'s tag doesn't start with its idx, ${pad(entry.idx)}_.`);
    }
    if (!Number.isSafeInteger(entry.when) || entry.when <= newest) {
      problems.push(
        `${name} is stamped ${JSON.stringify(entry.when)}, not after ${newest}, the newest stamp before it: ` +
          "Drizzle would skip it on a database that has a later migration.",
      );
    }
    if (Number.isSafeInteger(entry.idx)) idx = entry.idx;
    if (Number.isSafeInteger(entry.when) && entry.when > newest) newest = entry.when;
  }

  // Each new .sql file has one new journal entry, and each new entry one new .sql file.
  const newSql = [...headFiles.keys()].filter(
    (path) => !mainFiles.has(path) && path.endsWith(".sql") && path.lastIndexOf("/") === DIR.length,
  );
  for (const path of newSql) {
    const count = added.filter((entry) => sqlPath(entry) === path).length;
    if (count !== 1) problems.push(`${path} has ${count} new journal entries, not 1.`);
  }
  for (const entry of added) {
    if (typeof entry.tag === "string" && !newSql.includes(sqlPath(entry))) {
      problems.push(`${entry.tag} has no new ${sqlPath(entry)}.`);
    }
  }

  return { problems, merged: mainEntries.length, added };
}

const [main, head] = process.argv.slice(2);
if (!main || !head) {
  console.error("Usage: node server/scripts/check-migrations.mjs <main> <head>");
  process.exit(2);
}

let result;
try {
  result = compare(main, head);
} catch (error) {
  console.error(`Couldn't compare the migrations: ${error.stderr?.trim() || error.message}`);
  process.exit(2);
}

if (result.problems.length) {
  console.error(`The migrations in ${head} don't follow main's (${main}):`);
  for (const problem of result.problems) console.error(`- ${problem}`);
  console.error(
    "Never change a migration on main; add a new one. To stamp a migration after main's, rebase on main, " +
      "take main's server/drizzle, and generate it again with npm run db:generate --workspace server -- --name <name>. " +
      "See docs/maintainers/contributor-ci.md.",
  );
  process.exit(1);
}
console.log(`Migrations follow main's: ${result.merged} as merged, ${result.added.length} new after them.`);
