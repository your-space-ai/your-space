import { defineConfig, devices } from "@playwright/test";

// The stack runs this machine's setup; YS_PORT moves it when port 80 is taken.
const baseURL = process.env.YS_PORT ? `http://localhost:${process.env.YS_PORT}` : "http://localhost";
const evidence = process.env.YS_E2E_EVIDENCE === "1";

// The journeys run one at a time against a single Compose stack, which each spec resets.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    trace: "off",
    screenshot: "only-on-failure",
    video: evidence ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 720 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 } } },
  ],
});
