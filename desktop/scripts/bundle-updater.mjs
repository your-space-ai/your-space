// Bundles electron-updater, which the packaged launcher uses to update itself from GitHub Releases,
// into one CommonJS file with Electron left external, and writes the bundled packages' licenses, as
// their MIT and ISC terms require. The launcher's own code stays unbundled; only this file is added.
import { build } from "esbuild";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [outfile, noticesFile] = process.argv.slice(2);
if (!outfile || !noticesFile) {
  console.error("Usage: bundle-updater.mjs OUTPUT.cjs NOTICES.txt");
  process.exit(2);
}
const desktop = fileURLToPath(new URL("..", import.meta.url));
const result = await build({
  absWorkingDir: desktop,
  stdin: { contents: 'module.exports = require("electron-updater");', resolveDir: desktop, loader: "js" },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
});

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  // The innermost package, so a nested copy such as electron-updater/node_modules/semver counts as its own.
  const match = /^.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!match) continue;
  packages.set(match[0], { name: match[1], dir: join(desktop, match[0]) });
}
let notices = "Packages bundled in the launcher's updater (Contents/Resources/app.asar, desktop/vendor/electron-updater.cjs) and their licenses:\n";
for (const { name, dir } of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  // In any case: ms, for one, ships license.md.
  const licenseFile = readdirSync(dir).find((f) => /^licen[cs]e([.-](md|txt|mit))?$/i.test(f));
  const file = licenseFile && join(dir, licenseFile);
  notices += `\n${name} ${pkg.version} (${pkg.license})\n`;
  if (file) notices += `${readFileSync(file, "utf8").trimEnd()}\n`;
  else {
    // lazy-val publishes no license file, upstream or in its package; record what its package declares.
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
    const source = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    notices += `The package includes no license file. Its package.json declares the ${pkg.license} license` +
      `${author ? `, author ${author}` : ""}${source ? `, source ${source}` : ""}.\n`;
  }
}
writeFileSync(noticesFile, notices);
console.log(`Bundled the updater with ${packages.size} packages into ${outfile}.`);
