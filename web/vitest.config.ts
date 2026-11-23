import { defineConfig } from "vitest/config";

// Unit tests for the web client's components, in a simulated DOM.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
