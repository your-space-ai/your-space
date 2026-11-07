// Builds the stack's images once before the journeys run (skip with YS_E2E_SKIP_BUILD=1).
import { compose } from "./tests/helpers/stack.ts";

export default async function globalSetup(): Promise<void> {
  if (process.env.YS_E2E_SKIP_BUILD === "1") return;
  await compose(["build"], { timeout: 900_000 });
}
