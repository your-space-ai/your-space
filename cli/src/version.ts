// The CLI's version, which is also the Your Space release `init` downloads. The bundle has it built
// in (scripts/build.mjs); running from source reads package.json.
import { readFileSync } from "node:fs";

declare const YS_CLI_VERSION: string | undefined;

export const VERSION: string =
  typeof YS_CLI_VERSION === "string" ? YS_CLI_VERSION : (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

// Semantic Versioning 2.0.0's own pattern: no leading zeroes in numbers, prerelease numbers included.
const IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

/** True for a release version Your Space can compare, such as 0.1.0 or 0.1.0-alpha.2. */
export function isVersion(version: string): boolean {
  return SEMVER.test(version);
}

/**
 * Orders two release versions by Semantic Versioning's precedence: negative when `a` comes first,
 * 0 when they are the same release, positive when `a` is later. A prerelease comes before its
 * release (0.1.0-alpha.2 < 0.1.0), and its identifiers compare one by one, numbers as numbers
 * (alpha.2 < alpha.10). Build metadata after `+` doesn't count.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const match = SEMVER.exec(version);
    if (!match) throw new Error(`Not a release version: ${version}`);
    return { core: [match[1], match[2], match[3]].map(Number), pre: match[4]?.split(".") ?? [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  // A version without a prerelease comes after every prerelease of it.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    // Numeric identifiers compare as numbers and come before alphanumeric ones.
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
