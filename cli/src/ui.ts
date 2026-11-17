// How a command talks to its caller: Clack's own prompts, spinners, logs and notes for a person, or
// one JSON object on stdout for a script (--json). Nothing else draws output.
import * as clack from "@clack/prompts";
import { CliError } from "./errors.ts";

export interface UiOptions {
  json: boolean;
  verbose: boolean;
  /** --yes: answer yes to every confirmation, and take the default answer to every other question. */
  yes: boolean;
}

interface Question {
  message: string;
  /** The option that answers this question without a terminal, named in the error. */
  flag: string;
}

export class Ui {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly yes: boolean;
  readonly interactive: boolean;

  constructor(options: UiOptions) {
    this.json = options.json;
    this.verbose = options.verbose;
    this.yes = options.yes;
    this.interactive = !options.json && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  }

  private unanswered(question: Question): never {
    throw new CliError("usage", `${question.message} Answer it with ${question.flag}, or run this in a terminal.`);
  }

  private answered<T>(value: T): Exclude<T, symbol> {
    if (clack.isCancel(value)) {
      clack.cancel("Stopped. Nothing more was changed.");
      throw new CliError("cancelled", "Cancelled.");
    }
    return value as Exclude<T, symbol>;
  }

  async text(question: Question & { placeholder?: string; initial?: string; validate?: (value: string) => string | undefined }): Promise<string> {
    if (this.yes && question.initial) return question.initial;
    if (!this.interactive) this.unanswered(question);
    const value = await clack.text({
      message: question.message,
      placeholder: question.placeholder,
      initialValue: question.initial,
      validate: question.validate ? (value) => question.validate!(value ?? "") : undefined,
    });
    return this.answered(value).trim();
  }

  async select<T extends string>(question: Question & { options: { value: T; label: string; hint?: string }[]; initial: T }): Promise<T> {
    if (this.yes) return question.initial;
    if (!this.interactive) this.unanswered(question);
    // Clack's Option type is conditional on the value type; these options carry labels either way.
    const options = question.options as Parameters<typeof clack.select<T>>[0]["options"];
    return this.answered(await clack.select<T>({ message: question.message, options, initialValue: question.initial }));
  }

  /** A yes or no question; --yes answers yes. */
  async confirm(question: Question & { initial: boolean }): Promise<boolean> {
    if (this.yes) return true;
    if (!this.interactive) this.unanswered(question);
    return this.answered(await clack.confirm({ message: question.message, initialValue: question.initial }));
  }

  intro(title: string): void {
    if (!this.json) clack.intro(title);
  }

  outro(message: string): void {
    if (!this.json) clack.outro(message);
  }

  info(message: string): void {
    if (!this.json) clack.log.info(message);
  }

  success(message: string): void {
    if (!this.json) clack.log.success(message);
  }

  warn(message: string): void {
    if (!this.json) clack.log.warn(message);
  }

  note(body: string, title: string): void {
    if (!this.json) clack.note(body, title);
  }

  /** Runs a slow step behind a spinner, which says whether it worked. */
  async step<T>(message: string, done: string, work: (update: (message: string) => void) => Promise<T>): Promise<T> {
    if (this.json) return work(() => {});
    // Outside a terminal, such as in a log file, each step is one line instead of a spinner.
    if (!process.stdout.isTTY) {
      clack.log.step(message);
      const result = await work(() => {});
      clack.log.success(done);
      return result;
    }
    const spin = clack.spinner();
    spin.start(message);
    try {
      const result = await work((text) => spin.message(text));
      spin.stop(done);
      return result;
    } catch (error) {
      spin.error(error instanceof CliError ? "Stopped" : "Failed");
      throw error;
    }
  }

  /** The command's result: its JSON, or the lines for a person. */
  result(body: Record<string, unknown>, show: () => void): void {
    if (this.json) process.stdout.write(`${JSON.stringify({ ok: true, ...body })}\n`);
    else show();
  }

  failure(error: CliError): void {
    if (this.json) {
      const body: Record<string, unknown> = { ok: false, error: error.code, message: error.message, ...error.fields };
      if (error.detail) body.detail = error.detail;
      process.stdout.write(`${JSON.stringify(body)}\n`);
      return;
    }
    clack.log.error(error.message, { output: process.stderr });
    if (error.detail && this.verbose) clack.log.message(error.detail.trimEnd(), { output: process.stderr });
    else if (error.detail) clack.log.message("Run it again with --verbose to see the details.", { output: process.stderr });
  }
}
