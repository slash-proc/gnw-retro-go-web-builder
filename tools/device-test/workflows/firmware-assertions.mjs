import { expect } from "../fixtures.mjs";

/** Assert the visible Retro-Go installer offers exactly the supported B2 destination. */
export async function assertBank2OnlyInstallTarget(page) {
  const picker = page.locator(".targetgroup .bank-picker");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".bank-card")).toHaveCount(1);
  await expect(picker.locator(".bank-title")).toHaveText("Bank 2");
}

