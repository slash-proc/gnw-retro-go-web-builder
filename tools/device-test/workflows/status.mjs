import { expect } from "../fixtures.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { goToOverviewPane, goToTab } from "./navigation.mjs";

export async function expectUnlockedOnStatus(page) {
  await goToOverviewPane(page, "Status", { ensureTab: false });
  return await assertUnlockedOnStatus(page);
}

export async function assertUnlockedOnStatus(page) {
  const readProtection = page.locator(".rows .row")
    .filter({ hasText: /Read protection/i }).locator("dd");
  await expect(readProtection).toHaveText(/Unlocked/i, { timeout: 60_000 });
  await expect(page.locator("body")).toContainText(/Connected \(Stock\)/i);
  return {
    connection: await page.locator("body").innerText().then((text) =>
      text.match(/Connected \([^)]+\)/)?.[0] ?? null),
    readProtection: await readProtection.innerText(),
  };
}

/** Return from the patch utility to stock OFW, then verify RDP state on the Status pane. */
export async function returnToStockAndAssertUnlocked({
  page, device, testInfo, checkpoint, emulatorCheckpoint, milestones, onMilestone = async () => {},
}) {
  if (!device.qmp) throw new Error("GWemu QMP control is required to return to stock firmware");
  await device.qmp.press("B", 150);
  await onMilestone("B-pressed");
  try {
    await expect.poll(async () => {
      const state = await page.evaluate(() => ({ bodyText: document.body.innerText.slice(0, 600) }));
      milestones.stockReconnectSamples.push({ at: Date.now(), ...state });
      return state.bodyText;
    }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toMatch(/Connected \(Stock\)/);
  } finally {
    const details = JSON.stringify(milestones, null, 2) + "\n";
    const reportDir = process.env.GNW_TEST_REPORT_DIR;
    if (reportDir) await writeFile(path.join(reportDir, "post-patch-connection-bisect.json"), details);
  }
  await onMilestone("stock-reconnected");
  await goToTab(page, "overview");
  await onMilestone("overview-opened");
  await goToOverviewPane(page, "Status");
  await onMilestone("status-opened");
  await checkpoint(page, testInfo, "status-page");
  const unlockState = await assertUnlockedOnStatus(page);
  await onMilestone("status-reports-unlocked");
  await emulatorCheckpoint(device, testInfo, "backup-unlock-complete");
  const result = JSON.stringify(unlockState, null, 2) + "\n";
  if (process.env.GNW_TEST_REPORT_DIR)
    await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "backup-unlock-complete.json"), result);
  await testInfo.attach("backup-unlock-complete.json", Buffer.from(result), { contentType: "application/json" });
  return unlockState;
}
