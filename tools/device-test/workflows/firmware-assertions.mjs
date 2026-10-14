import { expect } from "../fixtures.mjs";

/**
 * Assert the visible Retro-Go installer uses the fixed bank-2 destination.
 *
 * Bank 2 is now an implementation invariant, so the UI deliberately has no
 * bank picker. Keep this check focused on the user-visible contract: there is
 * no obsolete bank picker or bank-card option, while the layout disclosure
 * remains available to inspect the resulting image geometry.
 */
export async function assertBank2OnlyInstallTarget(page) {
  await expect(page.locator(".bank-picker")).toHaveCount(0);
  await expect(page.locator(".bank-card")).toHaveCount(0);
  await expect(page.locator("details.layout-foldout")).toBeVisible();
}

