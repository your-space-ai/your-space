import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { secretsLost } from "../src/commands/shared.ts";
import { settleSecrets } from "../../server/src/secrets.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The secrets step's own message when the secrets volume is empty but the database is kept. */
function stopped(env: NodeJS.ProcessEnv): string {
  const root = mkdtempSync(join(tmpdir(), "ys-lost-secrets-"));
  folders.push(root);
  mkdirSync(join(root, "secrets"));
  mkdirSync(join(root, "pgdata", "18", "docker"), { recursive: true });
  writeFileSync(join(root, "pgdata", "18", "docker", "PG_VERSION"), "18\n");
  try {
    settleSecrets({ dir: join(root, "secrets"), databaseDir: join(root, "pgdata"), env, chown: false });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("The secrets step didn't stop.");
}

describe("lost secrets", () => {
  const auth = "a".repeat(43);
  it("are recognised whichever secrets .env still sets", () => {
    expect(secretsLost(stopped({}))).toBe(true);
    expect(secretsLost(stopped({ POSTGRES_PASSWORD: "kept" }))).toBe(true);
    expect(secretsLost(stopped({ BETTER_AUTH_SECRET: auth }))).toBe(true);
  });

  it("aren't read into another failure of the secrets step", () => {
    expect(secretsLost("BETTER_AUTH_SECRET in .env must be at least 32 characters.")).toBe(false);
  });
});
