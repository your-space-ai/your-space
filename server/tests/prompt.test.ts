// Journey 015, R5: the hidden prompt `github connect` shows on a terminal. What is typed is never
// written back; only the question and a closing newline are.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Cancelled, hiddenPrompt, PROMPT_START, promptKeys, type PromptStreams } from "../src/commands/prompt.ts";

const MAX = 16;
const keys = (...chunks: string[]) => chunks.reduce((state, chunk) => promptKeys(state, chunk, MAX), PROMPT_START);

describe("the hidden prompt's keystrokes", () => {
  it("ends at Enter, from a line feed or a carriage return, and drops what follows", () => {
    expect(keys("abc\n")).toEqual({ value: "abc", done: true, cancelled: false });
    expect(keys("ab", "c\rdef")).toEqual({ value: "abc", done: true, cancelled: false });
    expect(keys("abc\r", "def")).toEqual({ value: "abc", done: true, cancelled: false });
  });

  it("keeps going until the input ends", () => {
    expect(keys("ab", "c")).toEqual({ value: "abc", done: false, cancelled: false });
  });

  it("cancels at Ctrl-C, keeping nothing", () => {
    expect(keys("abc\u0003")).toEqual({ value: "", done: true, cancelled: true });
    expect(keys("\u0003")).toEqual({ value: "", done: true, cancelled: true });
  });

  it("ends at Ctrl-D, or cancels when nothing was typed", () => {
    expect(keys("abc\u0004")).toEqual({ value: "abc", done: true, cancelled: false });
    expect(keys("\u0004")).toEqual({ value: "", done: true, cancelled: true });
    expect(keys("a\u007f\u0004")).toEqual({ value: "", done: true, cancelled: true });
  });

  it("deletes a character at backspace, from either key code, and never below empty", () => {
    expect(keys("abc\u007f\n")).toEqual({ value: "ab", done: true, cancelled: false });
    expect(keys("abc\b\b", "d\n")).toEqual({ value: "ad", done: true, cancelled: false });
    expect(keys("\u007f\u007fa\n")).toEqual({ value: "a", done: true, cancelled: false });
  });

  it("stops growing at the bound", () => {
    const state = keys("x".repeat(MAX + 10));
    expect(state.value).toBe("x".repeat(MAX));
    expect(keys("x".repeat(MAX + 10), "\u007fy\n").value).toBe(`${"x".repeat(MAX - 1)}y`);
  });
});

/** A terminal: input in raw mode, and every write to standard error. */
function terminal() {
  const input = new PassThrough();
  const raw: boolean[] = [];
  const writes: string[] = [];
  const streams = {
    input: Object.assign(input, { setRawMode: (mode: boolean) => (raw.push(mode), input) }),
    output: { write: (text: string) => (writes.push(text), true) },
  } as unknown as PromptStreams;
  return { input, raw, writes, streams };
}

describe("the hidden prompt", () => {
  const QUESTION = "Paste the token: ";
  const SECRET = "github_pat_ys_fixture_prompt";

  it("returns what was typed, writing only the question and a newline, and leaves raw mode", async () => {
    const tty = terminal();
    const answer = hiddenPrompt(QUESTION, 1024, tty.streams);
    for (const char of SECRET) tty.input.write(char);
    tty.input.write("\r");
    await expect(answer).resolves.toBe(SECRET);
    expect(tty.writes).toEqual([QUESTION, "\n"]);
    expect(tty.raw).toEqual([true, false]);
    expect(tty.input.isPaused()).toBe(true);
    expect(tty.input.listenerCount("data")).toBe(0);
  });

  it("cancels at Ctrl-C, writing nothing of what was typed", async () => {
    const tty = terminal();
    const answer = hiddenPrompt(QUESTION, 1024, tty.streams);
    tty.input.write(`${SECRET}\u0003`);
    await expect(answer).rejects.toBeInstanceOf(Cancelled);
    expect(tty.writes).toEqual([QUESTION, "\n"]);
    expect(tty.raw).toEqual([true, false]);
  });
});
