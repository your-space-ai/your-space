// Screenshots for the delivery evidence, written to test-results/evidence/<browser>/<name>.png.
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export async function evidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = join(testInfo.project.outputDir, "evidence", testInfo.project.name, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
