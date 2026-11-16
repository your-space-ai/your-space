import { defineConfig } from "vitest/config";

// The adapter's rules, tested on resolved Compose files without an engine.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    silent: "passed-only",
  },
});
