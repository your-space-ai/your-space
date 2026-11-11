import { defineConfig, devices } from "@playwright/test";
import { createArgosReporterOptions } from "@argos-ci/playwright/reporter";

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
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    // Uploads each story screenshot to Argos from GitHub Actions only, so Argos compares one
    // environment's renderings, and authenticates with GitHub's OIDC token or tokenless check.
    ["@argos-ci/playwright/reporter", createArgosReporterOptions({ uploadToArgos: !!process.env.GITHUB_ACTIONS })],
  ],
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    trace: "off",
    screenshot: "only-on-failure",
    // CI keeps a video of every journey in the run's playwright-report artifact.
    video: evidence || process.env.CI ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
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
