// Bundles the CLI into one CommonJS file, dist/your-space.cjs, with its version and its
// dependencies inside: the npm package's `bin`, and the main script of the standalone executable
// (research R3). The licenses of the bundled packages are appended to it. A second argument writes
// it elsewhere, as the tests do for a build of another version.
import { build } from "esbuild";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version: packageVersion } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = process.argv[2] ?? packageVersion;
const outfile = process.argv[3] ? resolve(process.argv[3]) : join(root, "dist", "your-space.cjs");

const result = await build({
  entryPoints: [join(root, "src", "index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22.12",
  define: { YS_CLI_VERSION: JSON.stringify(version) },
  // version.ts reads package.json only when YS_CLI_VERSION isn't built in, which it always is here.
  logOverride: { "empty-import-meta": "silent" },
  metafile: true,
  legalComments: "none",
});

// Each bundled package's license, as its MIT or ISC terms require.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!match) continue;
  const dir = join(root, input.slice(0, input.indexOf(match[0]) + match[0].length));
  packages.set(match[1], dir);
}
let notices = "\n/*\n * Bundled packages and their licenses:\n";
for (const [name, dir] of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = ["LICENSE", "LICENSE.md", "license", "LICENSE.txt"].map((f) => join(dir, f)).find(existsSync);
  notices += ` *\n * ${name} ${pkg.version} (${pkg.license})\n`;
  if (file) notices += `${readFileSync(file, "utf8").replaceAll("*/", "* /").split("\n").map((l) => ` * ${l}`.trimEnd()).join("\n")}\n`;
}
appendFileSync(outfile, `${notices} */\n`);
console.log(`Built ${outfile.replace(`${dirname(root)}/`, "")} ${version} with ${packages.size} bundled packages.`);
