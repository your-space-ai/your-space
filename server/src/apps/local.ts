// An app's Compose file given on this machine (install-app --compose), for an app whose own file
// doesn't fit Your Space's rules, so the owner supplies one that does. It is checked and adapted like
// a file from GitHub, and recorded by its digest; nothing is read from GitHub for it.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { MAX_FILE_BYTES, SourceError, type SourceFile } from "./github.ts";

export class ComposeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeFileError";
  }
}

export interface LocalCompose {
  text: string;
  /** The file's name, or empty when it came on standard input. */
  name: string;
}

/**
 * Why install-app's sources can't be used together, or null. An app comes from a GitHub link or from
 * `--compose`; `--compose` and `--kit` share standard input, so only one of them can be `-`; and a
 * Compose file on this machine takes its kit from this machine too.
 */
export function sourcesProblem(o: { link?: string; compose?: string; kit?: string; name?: string }): string | null {
  if (o.compose === undefined) {
    if (o.link === undefined) return "Give the GitHub link to the app's Compose file, or --compose with a Compose file on this machine.";
    if (o.name !== undefined) return "--name goes with --compose. An app from GitHub takes its name from its kit or its repository.";
    return null;
  }
  if (o.link !== undefined) return "Give the GitHub link to the app's Compose file or --compose, not both.";
  if (o.compose === "-" && o.kit === "-") {
    return "--compose and --kit can't both be -, since they share standard input. Give one of them as a file in the server's container.";
  }
  if (o.kit !== undefined && /^https?:\/\//i.test(o.kit)) return "With --compose, the kit is on this machine too: --kit <file> or --kit -.";
  return null;
}

/** The Compose file `--compose` names: `-` reads standard input, and anything else is the file. */
export function readLocalCompose(file: string, stdin: number | string = 0): LocalCompose {
  try {
    if (file === "-") return { text: readFileSync(stdin, "utf8"), name: "" };
    if (statSync(file).isDirectory()) throw new ComposeFileError(`${file} is a folder. Give the Compose file itself.`);
    if (statSync(file).size > MAX_FILE_BYTES) throw new ComposeFileError(`The Compose file ${file} is larger than a Compose file should be.`);
    return { text: readFileSync(file, "utf8"), name: basename(file) };
  } catch (error) {
    if (error instanceof ComposeFileError) throw error;
    throw new ComposeFileError(`The Compose file ${file} can't be read (${(error as NodeJS.ErrnoException).code ?? "error"}).`);
  }
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
