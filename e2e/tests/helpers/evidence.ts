// A screenshot of each story step, for review on the pull request. In CI the Argos reporter
// uploads them, and Argos compares each with the one from main. Locally they stay in
// screenshots/ for a look by hand.
import { argosScreenshot } from "@argos-ci/playwright";
import type { Page, TestInfo } from "@playwright/test";

// Times differ from run to run, so they are hidden in the screenshots; the page keeps its layout.
const HIDE_TIMES = "time { visibility: hidden; }";

export async function evidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Chromium only: Argos's screenshot allowance is limited, and the other browsers' journeys are
  // still checked.
  if (testInfo.project.name !== "chromium") return;
  await argosScreenshot(page, name, { argosCSS: HIDE_TIMES });
}
