// An installation is a folder with the release files and `.env` (spec, Key Entities). The CLI reads
// everything from the folder and the running space, and stores nothing of its own.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliError } from "./errors.ts";
import { parseEnv, setEnv } from "./env-file.ts";
import { setupFromEnv, type Setup } from "./setup.ts";

export const RELEASE_FILES = ["compose.yaml", "stack.yaml", "modes", "env.example"];

export class Installation {
  readonly folder: string;

  constructor(folder: string) {
    this.folder = resolve(folder);
  }

  static isOne(folder: string): boolean {
    const compose = join(folder, "compose.yaml");
    return existsSync(compose) && existsSync(join(folder, "stack.yaml")) && /^name:\s*your-space\s*$/m.test(readFileSync(compose, "utf8"));
  }

  /** The installation in `folder`, or an error that says how to make one. */
  static open(folder: string): Installation {
    const installation = new Installation(folder);
    if (!Installation.isOne(installation.folder)) {
      throw new CliError(
        "not_an_installation",
        `${installation.folder} isn't a Your Space installation. Run \`your-space init\` there to make one, or pass --workdir <folder>.`,
      );
    }
    return installation;
  }

  get envPath(): string {
    return join(this.folder, ".env");
  }

  envText(): string {
    return existsSync(this.envPath) ? readFileSync(this.envPath, "utf8") : "";
  }

  env(): Record<string, string> {
    return parseEnv(this.envText());
  }

  /** Sets or clears lines in `.env`, and returns the lines that are now set. */
  writeEnv(values: Record<string, string | null>): string[] {
    let text = this.envText();
    for (const [key, value] of Object.entries(values)) text = setEnv(text, key, value);
    writeFileSync(this.envPath, text, { mode: 0o600 });
    return Object.entries(values)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `${key}=${value}`);
  }

  setup(): Setup {
    return setupFromEnv(this.env());
  }

  /** The Compose project: `name:` in compose.yaml, unless COMPOSE_PROJECT_NAME overrides it. */
  project(): string {
    if (process.env.COMPOSE_PROJECT_NAME) return process.env.COMPOSE_PROJECT_NAME;
    const file = join(this.folder, "compose.yaml");
    if (!existsSync(file)) return "your-space";
    return /^name:\s*(\S+)\s*$/m.exec(readFileSync(file, "utf8"))?.[1] ?? "your-space";
  }

  /** The release these files run: YS_VERSION in .env, or the version stack.yaml was released with. */
  version(): string | null {
    const set = this.env().YS_VERSION;
    if (set) return set;
    const stack = readFileSync(join(this.folder, "stack.yaml"), "utf8");
    const pinned = /\$\{YS_VERSION:-([^}]+)\}/.exec(stack)?.[1];
    return pinned ?? null;
  }
}
