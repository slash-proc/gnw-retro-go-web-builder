import { expect } from "../fixtures.mjs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
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

/** Walk every Guided Setup choice and pin the visible plan for each intent. */
export async function verifyGuidedSetupPlans(page) {
  const progressFile = process.env.GNW_TEST_REPORT_DIR
    ? path.join(process.env.GNW_TEST_REPORT_DIR, "native-session-progress.log") : null;
  const mark = async (label) => {
    if (progressFile) await appendFile(progressFile, `${new Date().toISOString()} guided setup ${label}\n`);
  };
  const connect = page.getByRole("button", { name: /^connect$/i });
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await expect.poll(() => page.locator("body").innerText(), { timeout: 90_000 })
    .toMatch(/Connected \((?:Stock|Retro-Go)\)/i);
  await goToGuidedSetup(page);
  await mark("opened");
  const chooser = page.locator(".chooser");
  const choiceNames = ["Dual Boot", "Only Retro-Go", "Return to Stock"];
  await expect(chooser.locator(".choice")).toHaveCount(choiceNames.length);
  for (const name of choiceNames) await expect(chooser.getByRole("button", { name })).toBeVisible();

  const cases = [
    ["Dual Boot", [/Back Up the Original Firmware/i, /Install Retro-Go/i]],
    ["Only Retro-Go", [/Install Retro-Go/i, /Add Software Sources/i, /Add to Library/i]],
    ["Return to Stock", [/Select Backup of Original Firmware/i, /Restore Original Firmware/i]],
  ];
  for (const [name, expectedSteps] of cases) {
    await mark(`select ${name} started`);
    const choice = chooser.getByRole("button", { name });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    const headings = page.locator(".plan-col .wizard-step h3");
    const content = (await headings.allInnerTexts()).join("\n");
    for (const expected of expectedSteps) expect(content, `${name} plan should include ${expected}`).toMatch(expected);
    if (name === "Only Retro-Go") expect(content, "Retro-Go-only setup must not offer a stock-patching stage").not.toMatch(/Patch/i);
    await mark(`select ${name} verified`);
  }
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
