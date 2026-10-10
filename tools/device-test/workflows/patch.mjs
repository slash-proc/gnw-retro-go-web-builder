import { expect } from "../fixtures.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { openPatchConfirmation } from "./guided-setup.mjs";

/** Patch stock OFW and flash the bootloader; leaves the modal closed at operation completion. */
export async function patchStockFirmware({
  page, device, testInfo, checkpoint, emulatorCheckpoint, onMilestone = async () => {}, browserLog = [],
}) {
  await onMilestone("patch-step-entered");
  const confirmation = await openPatchConfirmation(page);
  await expect(confirmation).toContainText(/Patch Device/i);
  await checkpoint(page, testInfo, "stock-patch-confirmation");
  await confirmation.getByRole("button", { name: /^Patch$/i }).click();
  await onMilestone("patch-confirmed");
  const dialog = page.getByRole("dialog").filter({ hasText: /Patch Device/i });
  // Loading the RAM flasher for the first firmware write is intentionally gated by a
  // user confirmation in the app. Treat this as a real UI step in the scenario.
  const recoveryPrompt = page.getByRole("dialog").filter({ hasText: /Enter Recovery Mode\?/i });
  let recoveryPromptShown = false;
  try {
    await recoveryPrompt.waitFor({ state: "visible", timeout: 3_000 });
    recoveryPromptShown = true;
  } catch {
    // A locked-device backup leaves Recovery Mode active; in that case patching may
    // proceed directly without asking to load the already-running RAM utility again.
  }
  if (recoveryPromptShown) {
    await onMilestone("recovery-mode-confirmation");
    await checkpoint(page, testInfo, "stock-patch-recovery-confirmation");
    await recoveryPrompt.getByRole("button", { name: /^Continue$/i }).click();
  } else {
    await expect(dialog).toContainText(/Patch firmware/i, { timeout: 15_000 });
  }
  await expect(dialog).toContainText(/Patch Device/i);

  const captureDiagnostics = async (reason) => {
    const patchState = await dialog.innerText().catch(() => "Patch dialog closed");
    const logToggle = dialog.getByRole("button", { name: /^Log/i });
    if (await logToggle.count()) await logToggle.click();
    const operationLog = await dialog.locator(".log-box").innerText().catch(() => "");
    const deviceState = await page.evaluate(async () => {
      const [{ device }, { auditLog }] = await Promise.all([
        import("/src/lib/device.svelte.js"), import("/src/lib/auditLog.svelte.js"),
      ]);
      return {
        connection: device.connection, locked: device.locked, error: device.error,
        utilLoaded: device.utilLoaded, model: device.model,
        audit: auditLog.entries.slice(-80).map((entry) => ({
          level: entry.level, source: entry.source, subject: entry.subject,
          detail: entry.detail, message: entry.message,
        })),
      };
    });
    const details = JSON.stringify({ reason, patchState, operationLog, deviceState,
      browserConsole: browserLog.slice(-100) }, null, 2) + "\n";
    const reportDir = process.env.GNW_TEST_REPORT_DIR;
    if (reportDir) await writeFile(path.join(reportDir, "patch-failure-diagnostics.json"), details);
    await testInfo.attach("patch-failure-diagnostics.json", Buffer.from(details), { contentType: "application/json" });
    return patchState;
  };

  let terminalState;
  await checkpoint(page, testInfo, "stock-patch-started");
  await emulatorCheckpoint(device, testInfo, "stock-patch-started");
  let lastProgressCapture = Date.now();
  try {
    await expect.poll(async () => {
      const text = await dialog.innerText();
      if (!/Done|not connected|error|failed|timed out|cancelled|stopped/i.test(text)
          && Date.now() - lastProgressCapture >= 10_000) {
        lastProgressCapture = Date.now();
        await checkpoint(page, testInfo, "stock-patch-in-progress");
        await emulatorCheckpoint(device, testInfo, "stock-patch-in-progress");
      }
      return /Done|not connected|error|failed|timed out|cancelled|stopped/i.test(text) ? text : "working";
    }, { timeout: 90_000, intervals: [500, 1000, 2000] }).not.toBe("working");
    terminalState = await dialog.innerText();
  } catch (error) {
    const state = await captureDiagnostics(`No terminal patch status after 90 seconds: ${error}`);
    throw new Error(`Patch Device remained active after 90 seconds: ${state.replace(/\s+/g, " ").trim()}. See patch-failure-diagnostics.json`);
  }
  if (!/Done/i.test(terminalState)) {
    const state = await captureDiagnostics("Patch operation reported a terminal failure");
    throw new Error(`Patch Device did not complete: ${state.replace(/\s+/g, " ").trim()}. See patch-failure-diagnostics.json`);
  }
  await expect(dialog).toContainText(/Done/i);
  await onMilestone("patch-progress-done");
  await dialog.getByRole("button", { name: /^close$/i }).click();
  await emulatorCheckpoint(device, testInfo, "stock-ofw-patched-with-bootloader");
  await checkpoint(page, testInfo, "patch-complete");
  return terminalState;
}
