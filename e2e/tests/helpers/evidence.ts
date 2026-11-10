// A screenshot of each story step, for review on the pull request. In CI the Argos reporter
// uploads them, and Argos compares each with the one from main. Locally they stay in
// screenshots/ for a look by hand.
import { argosScreenshot } from "@argos-ci/playwright";
import type { Page, TestInfo } from "@playwright/test";

export async function evidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Argos files each screenshot under its browser, so the three browsers keep separate copies.
  await argosScreenshot(page, name);
}
