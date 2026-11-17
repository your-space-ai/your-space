// Builds the stack's images and the CLI's bundle once before the journeys run (skip with
// YS_E2E_SKIP_BUILD=1).
import { execFileSync } from "node:child_process";
import { compose } from "./tests/helpers/stack.ts";

export default async function globalSetup(): Promise<void> {
  if (process.env.YS_E2E_SKIP_BUILD === "1") return;
  execFileSync("npm", ["run", "build", "--workspace", "cli"], { cwd: new URL("..", import.meta.url), stdio: "inherit" });
  await compose(["build"], { timeout: 900_000 });
}
