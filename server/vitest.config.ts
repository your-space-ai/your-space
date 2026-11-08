import { defineConfig } from "vitest/config";

// Server tests run against a real PostgreSQL (TEST_DATABASE_URL); each file gets its own database.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Show log output only for failing tests.
    silent: "passed-only",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
