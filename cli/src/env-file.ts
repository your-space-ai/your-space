// Reads `.env` and sets or clears one line, keeping comments, order and the person's own lines, so
// a `.env` the CLI wrote reads like one written by hand from env.example.

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const COMMENTED = (key: string) => new RegExp(`^\\s*#\\s*${key}\\s*=`);

/** The value Compose reads: surrounding quotes removed, and a trailing comment after unquoted text. */
function value(raw: string): string {
  const text = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(text);
  if (quoted) return quoted[2]!;
  return text.replace(/\s+#.*$/, "");
}

/** The settings `.env` sets, in order. Comment lines and blank lines are left out. */
export function parseEnv(text: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = LINE.exec(line);
    if (match) settings[match[1]!] = value(match[2]!);
  }
  return settings;
}

/**
 * Sets `key` to `next`, or comments it out when `next` is null. A setting already in the file is
 * changed in place; a new one replaces env.example's commented line for it, or goes at the end.
 */
export function setEnv(text: string, key: string, next: string | null): string {
  const lines = text.split("\n");
  const active = lines.findIndex((line) => !line.trimStart().startsWith("#") && LINE.exec(line)?.[1] === key);
  if (next === null) {
    if (active >= 0) lines[active] = `# ${lines[active]!.trimStart()}`;
    return lines.join("\n");
  }
  const line = `${key}=${next}`;
  if (active >= 0) {
    lines[active] = line;
    return lines.join("\n");
  }
  const commented = lines.findIndex((l) => COMMENTED(key).test(l));
  if (commented >= 0) {
    lines[commented] = line;
    return lines.join("\n");
  }
  const end = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  return `${text}${end}${line}\n`;
}
