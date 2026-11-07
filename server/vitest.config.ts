import { defineConfig } from "vitest/config";

// Server tests run against a real PostgreSQL (TEST_DATABASE_URL); each file gets its own database.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
