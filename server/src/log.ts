// One JSON line per event on stdout (T007). Callers pass only safe fields; as a second line of
// defense, any field whose name suggests a credential is replaced before it is written.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEY = /pass|token|secret|cookie|authori[sz]ation|session|url|link|body|header/i;

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : value;
  }
  return out;
}

let stream: "split" | "stderr" = "split";

/** Operator commands send every log line to stderr, keeping stdout for their own output. */
export function setLogStream(value: "split" | "stderr"): void {
  stream = value;
}

export function log(level: Level, event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...clean(fields) });
  if (stream === "stderr" || level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** A safe description of an error: its name and code, never its message or stack, which can hold values. */
export function errorFields(error: unknown): Fields {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; code?: unknown };
    return {
      errorName: typeof e.name === "string" ? e.name : "Error",
      errorCode: typeof e.code === "string" || typeof e.code === "number" ? e.code : undefined,
    };
  }
  return { errorName: typeof error };
}
