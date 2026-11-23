// Every `your-space` command and option the operator documentation names exists (task T026), so the
// guide can't drift from the CLI. The browser test runs the commands themselves.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The operator documentation: installing, reaching it from other devices, running it, and recovery.
const guide = ["install/README.md", "install/other-devices.md", "operate/README.md", "operate/recovery.md"]
  .map((page) => readFileSync(new URL(`../../docs/${page}`, import.meta.url), "utf8"))
  .join("\n");
const cli = (args: string[]) => execFileSync(process.execPath, [new URL("../src/index.ts", import.meta.url).pathname, ...args], { encoding: "utf8" });

/** `your-space <command> [<subcommand>] [--option ...]`, as the guide writes them. */
function mentions(): { command: string[]; options: string[] }[] {
  const found = new Map<string, { command: string[]; options: string[] }>();
  for (const match of guide.matchAll(/your-space ((?:[a-z][a-z-]*\s?)+)((?:\s?--[a-z-]+(?:\s[^\s`-][^\s`]*)?)*)/g)) {
    const words = match[1]!.trim().split(/\s+/);
    const command: string[] = [];
    for (const word of words) {
      if (["init", "start", "stop", "status", "logs", "configure", "owner", "secrets", "create", "reset-link", "show", "replace"].includes(word)) command.push(word);
      else break;
    }
    if (command.length === 0) continue;
    const options = [...match[2]!.matchAll(/--[a-z-]+/g)].map((m) => m[0]);
    const key = `${command.join(" ")} ${options.join(" ")}`;
    found.set(key, { command, options });
  }
  return [...found.values()];
}

describe("the operator documentation", () => {
  const all = mentions();

  it("names the CLI's commands", () => {
    const commands = new Set(all.map((m) => m.command.join(" ")));
    for (const command of ["init", "start", "stop", "status", "logs", "configure", "owner reset-link", "secrets show", "secrets replace"]) {
      expect(commands, command).toContain(command);
    }
  });

  it("names only commands and options that exist", () => {
    const global = cli(["--help"]);
    for (const { command, options } of all) {
      const help = cli([...command, "--help"]);
      for (const option of options) expect(`${help}\n${global}`, `your-space ${command.join(" ")} ${option}`).toContain(option);
    }
  });
});
