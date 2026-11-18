// The CLI's version, which is also the Your Space release `init` downloads. The bundle has it built
// in (scripts/build.mjs); running from source reads package.json.
import { readFileSync } from "node:fs";

declare const YS_CLI_VERSION: string | undefined;

export const VERSION: string =
  typeof YS_CLI_VERSION === "string" ? YS_CLI_VERSION : (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
