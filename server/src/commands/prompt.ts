// A hidden prompt for a secret on a terminal (journey 015, R5): the terminal is in raw mode, so what
// is typed is never shown, and only the question and a closing newline are written.

/** The owner ended the prompt without giving anything: Ctrl-C, or Ctrl-D on an empty line. */
export class Cancelled extends Error {}

/** What has been typed so far, and whether the prompt has ended. */
export interface PromptState {
  value: string;
  done: boolean;
  cancelled: boolean;
}

export const PROMPT_START: PromptState = { value: "", done: false, cancelled: false };

/**
 * Applies keystrokes read in raw mode. Enter ends the input; Ctrl-C cancels it; Ctrl-D ends it, or
 * cancels it when nothing was typed; backspace deletes a character. Input stops growing at `max`, and
 * anything after the end is dropped.
 */
export function promptKeys(state: PromptState, chunk: string, max: number): PromptState {
  if (state.done) return state;
  let value = state.value;
  for (const char of chunk) {
    if (char === "\r" || char === "\n") return { value, done: true, cancelled: false };
    if (char === "\u0003") return { value: "", done: true, cancelled: true };
    if (char === "\u0004") return value ? { value, done: true, cancelled: false } : { value: "", done: true, cancelled: true };
    if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
    else if (value.length < max) value += char;
  }
  return { value, done: false, cancelled: false };
}

export interface PromptStreams {
  input?: Pick<NodeJS.ReadStream, "setEncoding" | "setRawMode" | "on" | "off" | "resume" | "pause">;
  output?: Pick<NodeJS.WriteStream, "write">;
}

/** Reads a line from the terminal without showing it; rejects with `Cancelled` if the owner cancels. */
export function hiddenPrompt(question: string, max: number, { input = process.stdin, output = process.stderr }: PromptStreams = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let state = PROMPT_START;
    const onData = (chunk: string) => {
      state = promptKeys(state, chunk, max);
      if (!state.done) return;
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (state.cancelled) reject(new Cancelled());
      else resolve(state.value);
    };
    output.write(question);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });
}
