import { defineConfig } from "vitest/config";

// The CLI's logic, tested without an engine: files, checks, parsing and output.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    silent: "passed-only",
  },
});
