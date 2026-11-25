#!/usr/bin/env node
// Refuses a change to a migration already on main, and a new migration not stamped after every
// earlier one (spec 016, decision 8 and FR-011). Drizzle runs only migrations stamped later than
// the newest a database records and never reads one again once applied, so either mistake would be
// skipped without an error on a database that already followed main.
//
//   node server/scripts/check-migrations.mjs <main> <head>
//
// <main> is main as it is when the check runs, <head> the commit to check. Both are read from git
// objects, so the working tree doesn't matter.
import { execFileSync } from "node:child_process";

const DIR = "server/drizzle";
const JOURNAL = `${DIR}/meta/_journal.json`;
// What Drizzle and drizzle-kit read: the journal, each migration's SQL and each one's snapshot.
const MIGRATION_FILE = /^server\/drizzle\/(?:[^/]+\.sql|meta\/_journal\.json|meta\/\d+_snapshot\.json)$/;
// drizzle-kit stamps a migration with the time it generates it. A stamp further ahead than this is a
// wrong clock or a hand edit, and every migration generated before that time would be refused.
const AHEAD = 24 * 60 * 60 * 1000;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

const pad = (idx) => String(idx).padStart(4, "0");
const sqlPath = (entry) => `${DIR}/${entry.tag}.sql`;
const snapshotPath = (entry) => `${DIR}/meta/${pad(entry.idx)}_snapshot.json`;

/** The mode and blob of each migration file in a commit ("100644 <blob>"), by path. */
function files(commit) {
  const out = new Map();
  for (const line of git("ls-tree", "-r", "-z", "--full-tree", commit, "--", DIR).split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const path = line.slice(tab + 1);
    const [mode, , blob] = line.slice(0, tab).split(" ");
    if (MIGRATION_FILE.test(path)) out.set(path, `${mode} ${blob}`);
  }
  return out;
}

const same = (a, b) => a.size === b.size && [...a].every(([path, blob]) => b.get(path) === blob);

/** The journal's entries, or [] when there is no journal. */
function entries(commit, blobs) {
  const file = blobs.get(JOURNAL);
  if (!file) return [];
  const { entries } = JSON.parse(git("cat-file", "blob", file.split(" ")[1]));
  if (!Array.isArray(entries)) throw new Error(`${JOURNAL} in ${commit} has no entries list.`);
  return entries;
}

/** What keeps head's migrations from following main's, with how many there are of each. */
function compare(main, head) {
  const base = git("merge-base", main, head).trim();
  const [baseFiles, mainFiles, headFiles] = [base, main, head].map(files);
  const mainEntries = entries(main, mainFiles);
  const problems = [];

  // A branch that doesn't change the migrations can't break them, however far behind main it is.
  if (same(baseFiles, headFiles)) return { problems, merged: mainEntries.length, added: [] };

  const headEntries = entries(head, headFiles);

  // Overtaken: main took migrations after this branch left it, and the branch's journal doesn't
  // have them. Everything else follows from that, so it is all that is reported until a rebase.
  const missing = mainEntries.filter((entry, i) => headEntries[i]?.tag !== entry.tag).map((entry) => entry.tag);
  if (missing.length && !same(baseFiles, mainFiles)) {
    problems.push(
      `main took migrations after this branch left it, which its journal doesn't have (${missing.join(", ")}): ` +
        "rebase on main, then generate this branch's migrations again so they come after main's.",
    );
    return { problems, merged: mainEntries.length, added: [] };
  }

  // Every migration on main stays as merged: its journal entry, its SQL and its snapshot.
  mainEntries.forEach((entry, i) => {
    const now = headEntries[i];
    if (!now) problems.push(`The journal entry for ${entry.tag}, on main, is missing.`);
    for (const field of now ? new Set([...Object.keys(entry), ...Object.keys(now)]) : []) {
      const [was, is] = [entry[field], now[field]].map((value) => JSON.stringify(value));
      if (was !== is) {
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
  const latest = Date.now() + AHEAD;
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
    } else if (entry.when > latest) {
      problems.push(
        `${name} is stamped ${entry.when}, more than a day after this check ran (${Date.now()}): ` +
          "set the clock right and generate it again, or every migration generated before then is refused.",
      );
    }
    if (Number.isSafeInteger(entry.idx)) idx = entry.idx;
    if (Number.isSafeInteger(entry.when) && entry.when > newest) newest = entry.when;
  }

  // Drizzle reads them through the filesystem, so a link would apply whatever it points at.
  for (const [path, file] of headFiles) {
    if (file !== mainFiles.get(path) && !file.startsWith("100644 ")) problems.push(`${path} isn't a regular file.`);
  }

  // Each new .sql file and snapshot belongs to one new journal entry, and each new entry has both.
  const fresh = [...headFiles.keys()].filter((path) => path !== JOURNAL && !mainFiles.has(path));
  for (const path of fresh) {
    const count = added.filter((entry) => sqlPath(entry) === path || snapshotPath(entry) === path).length;
    if (count !== 1) problems.push(`${path} has ${count} new journal entries, not 1.`);
  }
  for (const entry of added) {
    if (typeof entry.tag !== "string") continue;
    for (const path of [sqlPath(entry), snapshotPath(entry)]) {
      if (!fresh.includes(path)) problems.push(`${entry.tag} has no new ${path}.`);
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
    "Never change a migration on main; add a new one. To stamp a migration after main's, rebase on main and " +
      "generate it again with npm run db:generate --workspace server -- --name <name>, " +
      "as docs/maintainers/contributor-ci.md describes.",
  );
  process.exit(1);
}
console.log(`Migrations follow main's: ${result.merged} as merged, ${result.added.length} new after them.`);
