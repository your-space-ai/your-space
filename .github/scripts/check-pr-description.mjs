// Checks a pull request description against the repository's standard (AGENTS.md, "Pull Request
// Descriptions"): the four visible sections are present, the visible part stays short, and every
// collapsed section has a title. In CI the description comes from PR_BODY; locally, pass a file:
//   node .github/scripts/check-pr-description.mjs description.md
import { readFileSync } from "node:fs";

const MAX_CHARACTERS = 2500;
const MAX_LINES = 40;
const REQUIRED = ["Summary", "Review focus", "Status", "Decisions needed"];

const body = (process.argv[2] ? readFileSync(process.argv[2], "utf8") : process.env.PR_BODY ?? "").replace(/\r\n/g, "\n");
const problems = [];

const withoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
const detailsBlocks = withoutComments.match(/<details>[\s\S]*?<\/details>/g) ?? [];
for (const block of detailsBlocks) {
  if (!/<summary>[^<]*\S[^<]*<\/summary>/.test(block)) problems.push("A collapsed section has no <summary> title.");
}
if ((withoutComments.match(/<details>/g) ?? []).length !== detailsBlocks.length) {
  problems.push("A <details> section is not closed with </details>.");
}

// What a reviewer sees before opening anything. Links count as their text, not their address.
const visible = withoutComments
  .replace(/<details>[\s\S]*?<\/details>/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
const visibleLines = visible.split("\n").filter((line) => line.trim() !== "");
const characters = visibleLines.join("\n").length;

// Each required section is present and filled in; each status row has a result.
for (const title of REQUIRED) {
  const section = visible.match(new RegExp(`^##\\s+${title}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m"));
  if (!section) {
    problems.push(`The visible part has no "## ${title}" section.`);
    continue;
  }
  const rows = section[1].split("\n").filter((line) => line.trim() !== "");
  if (rows.length === 0) problems.push(`"## ${title}" is empty.`);
  if (title === "Status") {
    for (const row of rows.filter((line) => line.trim().startsWith("|")).slice(2)) {
      const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length >= 2 && cells[cells.length - 1] === "") problems.push(`"## Status" has no result for ${cells[0] || "a row"}.`);
    }
  }
}
if (characters > MAX_CHARACTERS) {
  problems.push(`The visible part has ${characters} characters; the limit is ${MAX_CHARACTERS}. Move detail into a collapsed section.`);
}
if (visibleLines.length > MAX_LINES) {
  problems.push(`The visible part has ${visibleLines.length} lines; the limit is ${MAX_LINES}. Move detail into a collapsed section.`);
}

console.log(`Visible part: ${characters} characters, ${visibleLines.length} lines. Collapsed sections: ${detailsBlocks.length}.`);
if (problems.length > 0) {
  console.log("The description doesn't follow the standard (.github/pull_request_template.md):");
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}
console.log("The description follows the standard.");
