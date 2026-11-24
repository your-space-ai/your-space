// An app's Compose file given on this machine with its kit, recorded by its digest; nothing is read
// from GitHub for it. install-app --compose, the owner's way to give one, left with the alpha scope
// (decision 2026-11-23), so no command gives one now. Apps installed from such a file keep running
// from the file stored with them.
import { createHash } from "node:crypto";
import { MAX_FILE_BYTES, SourceError, type SourceFile } from "./github.ts";

export interface LocalCompose {
  text: string;
  /** The file's name, or empty when it came on standard input. */
  name: string;
}

/**
 * Why install-app's sources can't be used together, or null. Every app installs with a kit (decision
 * 2026-11-23): the link to its kit, or a kit file on this machine with `--kit`.
 */
export function sourcesProblem(o: { link?: string; kit?: string }): string | null {
  if (o.kit !== undefined && /^https?:\/\//i.test(o.kit)) {
    return "--kit takes a kit file on this machine, or - for standard input. Give a kit's link as the first argument instead.";
  }
  if (o.link === undefined && o.kit === undefined) return "Give the link to the app's kit, or --kit with a kit file on this machine.";
  if (o.link !== undefined && o.kit !== undefined) return "Give the link to the app's kit or --kit with a kit file, not both: the kit names the app's Compose file.";
  return null;
}

/**
 * A Compose file on this machine as the app's source. It has no repository, branch or commit: the
 * record keeps its digest as the link and its name as the path, and the text itself, as for any app.
 */
export function localSource(compose: LocalCompose): SourceFile {
  if (Buffer.byteLength(compose.text) > MAX_FILE_BYTES) throw new SourceError("The file is larger than a Compose file should be.");
  if (!compose.text.trim()) throw new SourceError("The Compose file is empty.");
  const link = `sha256:${createHash("sha256").update(compose.text).digest("hex")}`;
  return { link, repo: "", ref: "", path: compose.name, commit: "", text: compose.text, pinnedLink: link };
}

/** Whether an app's source is a Compose file given on this machine. */
export function isLocalSource(source: { link: string }): boolean {
  return source.link.startsWith("sha256:");
}
