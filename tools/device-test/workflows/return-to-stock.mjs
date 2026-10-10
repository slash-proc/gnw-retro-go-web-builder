import { expect } from "../fixtures.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chooseGuidedPath } from "./guided-setup.mjs";

/** Restore OFW after a bank-2 install and verify only Retro-Go was removed. */
export async function returnToStockAndAssertVisibleState({ page, testInfo }) {
  await expect(page.locator("body")).toContainText(/v\d+\.\d+\.\d+[^\s]*-flash/i);

  await chooseGuidedPath(page, "stock");
  const restore = page.getByRole("button", { name: /^Restore$/i });
  await expect(restore).toBeEnabled({ timeout: 60_000 });
  await restore.click();
  const dialog = page.getByRole("dialog").filter({ hasText: /Restore Original Firmware/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Restore$/i }).click();
  await expect(dialog).toContainText(/Done/i, { timeout: 180_000 });
  await dialog.getByRole("button", { name: /^close$/i }).click();

  await expect(page.locator("body")).toContainText(/Connected \((?:Stock|Recovery Mode)\)/i, { timeout: 90_000 });
  await expect(page.locator("body")).toContainText(/Mario \(Stock\)/i);
  await expect(page.locator("body")).not.toContainText(/v\d+\.\d+\.\d+[^\s]*-flash/i);
  const result = JSON.stringify({
    before: "Retro-Go release shown in device banner",
    after: "stock OFW shown; Retro-Go absent",
    expected: "restore stock OFW and erase Retro-Go from bank 2",
  }, null, 2) + "\n";
  if (process.env.GNW_TEST_REPORT_DIR)
    await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "return-to-stock-result.json"), result);
  await testInfo.attach("return-to-stock-result.json", Buffer.from(result), { contentType: "application/json" });
}
