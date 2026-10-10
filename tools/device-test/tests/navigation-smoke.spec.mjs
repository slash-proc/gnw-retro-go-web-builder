import { test, expect } from "../fixtures.mjs";
import { goToOverviewPane, goToTab } from "../workflows/navigation.mjs";

async function checkpoint(page, testInfo, name) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, timeout: 20_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

test("navigate the primary tabs and dependent device panes", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => localStorage.setItem("gnw:locale", "en"));
  await page.goto("/");
  // A fresh app-only profile first asks which mod the device uses. Pick flash
  // storage so the normal Manage Device path appears even without a device.
  await page.getByRole("button", { name: /Flash Memory.*internal flash chip/i }).click();
  await expect(page.getByRole("button", { name: /^Manage Device Backup/i })).toBeVisible();
  await page.getByRole("button", { name: /^Manage Device Backup/i }).click();
  await checkpoint(page, testInfo, "01-overview");

  for (const name of ["Status", "Details", "Activity", "Device log"]) {
    await test.step(`open Overview / ${name}`, async () => {
      await goToOverviewPane(page, name);
      await checkpoint(page, testInfo, `overview-${name.toLowerCase().replaceAll(" ", "-")}`);
    });
  }

  for (const tab of ["firmware", "sources", "library", "overview"]) {
    await test.step(`open ${tab} tab`, async () => {
      await goToTab(page, tab);
      await checkpoint(page, testInfo, `tab-${tab}`);
      if (tab === "library") {
        const foldersNeeded = page.getByRole("dialog").filter({ hasText: /Folders needed/i });
        if (await foldersNeeded.isVisible().catch(() => false)) {
          await foldersNeeded.getByRole("button", { name: /^Cancel$/i }).click();
          await expect(foldersNeeded).toBeHidden();
        }
      }
    });
  }

  await test.step("open Advanced firmware mode without a connected device", async () => {
    await goToTab(page, "firmware");
    const advanced = page.getByRole("button", { name: /^advanced$/i });
    await expect(advanced).toBeVisible();
    await advanced.click();
    await expect(page.getByText(/Waiting for a device connection/i)).toBeVisible();
    await checkpoint(page, testInfo, "firmware-advanced-waiting-for-device");
  });
});
