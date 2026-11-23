import { defineConfig, devices } from "@playwright/test";
import { createArgosReporterOptions } from "@argos-ci/playwright/reporter";

// The stack runs this machine's setup at http://space.localhost; YS_PORT moves it when port 80 is
// taken. Browsers resolve *.localhost themselves (RFC 6761).
const baseURL = process.env.YS_PORT ? `http://space.localhost:${process.env.YS_PORT}` : "http://space.localhost";
const evidence = process.env.YS_E2E_EVIDENCE === "1";

// The journeys run one at a time against a single Compose stack, which each spec resets.
export default defineConfig({
  testDir: "./tests",
  // Shared reports need test results and screenshots, not private commit metadata or diffs.
  captureGitInfo: { commit: false, diff: false },
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    // Uploads each story screenshot to Argos only from CircleCI's x86 e2e job, which sets
    // YS_ARGOS_UPLOAD, so Argos compares one environment's renderings. ARGOS_TOKEN authenticates it.
    ["@argos-ci/playwright/reporter", createArgosReporterOptions({ uploadToArgos: process.env.YS_ARGOS_UPLOAD === "1" })],
  ],
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    // Off: recording a trace adds work around every action and can hide timing races in the app.
    // A failed test's screenshot and error context (error-context.md) are kept, and CircleCI
    // stores them.
    trace: "off",
    screenshot: "only-on-failure",
    // A local evidence run can record video. Hosted checks report results in the job log.
    video: evidence ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        // Same text rendering on every machine, so screenshots don't differ by font smoothing.
        launchOptions: { args: ["--disable-lcd-text", "--font-render-hinting=none"] },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 720 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 } } },
  ],
});
