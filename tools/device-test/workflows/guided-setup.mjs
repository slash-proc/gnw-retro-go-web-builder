import { expect } from "../fixtures.mjs";
import { goToGuidedSetup } from "./navigation.mjs";

const pathLabels = {
  dual: /dual boot/i,
  retrogo: /only retro-go|retro-go only/i,
  stock: /return to stock/i,
};

/** Enter Guided Setup and select a plan, leaving the wizard at its first actionable step. */
export async function chooseGuidedPath(page, path) {
  const label = pathLabels[path];
  if (!label) throw new Error(`Unknown Guided Setup path: ${path}`);
  await goToGuidedSetup(page);
  const choice = page.locator(".chooser .choice").filter({ hasText: label });
  await expect(choice).toBeVisible();
  // A workflow block may be resumed after another block has already established its
  // selection. Re-clicking an active path is not a harmless no-op in the app: choose()
  // resets per-path derived state such as the model detected by a fresh OFW backup.
  if (await choice.getAttribute("aria-pressed") !== "true") await choice.click();
  if (path === "dual") {
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".plan-col")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Back Up the Original Firmware/i })).toBeVisible();
  }
  return page.locator(".wizard-container");
}

export async function openGuidedBackupDialog(page) {
  const backup = page.getByRole("button", { name: /^Back Up$/i });
  await expect(backup).toBeEnabled();
  await backup.click();
  const dialog = page.getByRole("dialog").filter({ hasText: /Choose a folder to save and verify/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openPatchConfirmation(page) {
  const patch = page.getByRole("button", { name: /^Patch$/i });
  await expect(patch).toBeEnabled();
  await patch.click();
  const dialog = page.getByRole("dialog").filter({ hasText: /Patch Device/i });
  await expect(dialog).toBeVisible();
  return dialog;
}
