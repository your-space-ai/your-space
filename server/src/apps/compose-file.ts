// Other Compose files an app's Compose file names (2026-11-24): files it includes with `include`, and
// files a service extends with `extends: { file }`. Compose reads them while it reads the app's file,
// even as written (`config --no-interpolate`), before the runtime manager could check any of them, and
// an `include` reads its own `env_file` too. The app's file is one file, alone in its folder, so such a
// file could only be one on the machine: the server refuses the app's file before Compose sees it.
import { parseAllDocuments } from "yaml";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Why Compose must not be given the app's file, or null when the file names no other Compose file. */
export function otherComposeFiles(text: string): string | null {
  let documents: unknown[];
  try {
    // As Compose reads it: every document in the file, and `<<` merge keys.
    documents = parseAllDocuments(text, { merge: true }).map((document) => {
      if (document.errors.length > 0) throw document.errors[0];
      return document.toJS() as unknown;
    });
  } catch {
    return "The file isn't a Compose file Your Space can read: it isn't valid YAML.";
  }
  const named: string[] = [];
  for (const document of documents) {
    if (!isObject(document)) continue;
    if (Object.hasOwn(document, "include")) named.push("the files it includes");
    const services = isObject(document.services) ? document.services : {};
    for (const [name, service] of Object.entries(services)) {
      const extended = isObject(service) && isObject(service.extends) ? service.extends.file : undefined;
      if (extended !== undefined && extended !== null) named.push(`${String(extended)}, which service ${name} extends`);
    }
  }
  if (named.length === 0) return null;
  return `The file names other Compose files, which Compose would read from the machine: ${[...new Set(named)].join("; ")}. An app is one Compose file: extend services in the same file.`;
}
