import { defineConfig, devices } from "@playwright/test";

// The component gallery (web/gallery.html) on the web client's development server: screenshots of
// every component in each built-in theme and palette, and a contrast check of what renders. Run it
// with `npm run gallery --workspace e2e`; the screenshots go to e2e/gallery-screenshots/, or to
// YS_GALLERY_DIR. It needs no Compose stack.
const port = Number(process.env.YS_GALLERY_PORT ?? 5199);

export default defineConfig({
  testDir: "./gallery",
  outputDir: "./test-results/gallery",
  captureGitInfo: { commit: false, diff: false },
  fullyParallel: true,
  reporter: [["list"]],
  webServer: {
    command: `npm run dev --workspace web -- --port ${port} --strictPort`,
    cwd: "..",
    url: `http://localhost:${port}/gallery.html`,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: `http://localhost:${port}`, trace: "off" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        // The same text rendering as the journeys' screenshots.
        launchOptions: { args: ["--disable-lcd-text", "--font-render-hinting=none"] },
      },
    },
  ],
});
