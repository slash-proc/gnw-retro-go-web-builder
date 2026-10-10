import { expect } from "../fixtures.mjs";
import { openGuidedBackupDialog } from "./guided-setup.mjs";

/** Dump, verify, and leave a locked stock target at Guided Setup's enabled Patch step. */
export async function backupLockedStock({ page, device, testInfo, checkpoint, emulatorCheckpoint }) {
  if (!device.qmp) throw new Error("GWemu QMP control is required for the locked-backup power-cycle workflow");
  const backupDialog = await openGuidedBackupDialog(page);
  await checkpoint(page, testInfo, "locked-backup-confirmation");
  await backupDialog.getByRole("button", { name: /Select Folder & Start/i }).click();
  await checkpoint(page, testInfo, "locked-backup-started");
  await emulatorCheckpoint(device, testInfo, "locked-backup-started");

  const powerCycleHeading = page.getByRole("heading", { name: /Power-cycle to read protected firmware/i });
  let outcome = "working";
  let lastWorkingCapture = Date.now();
  await expect.poll(async () => {
    if (await powerCycleHeading.isVisible().catch(() => false)) outcome = "power-cycle";
    else {
      const text = await page.getByRole("dialog").innerText().catch(() => "");
      if (/backup failed|\berror\b|\bfailed\b/i.test(text)) outcome = `error: ${text.replace(/\s+/g, " ").trim()}`;
      else if (Date.now() - lastWorkingCapture >= 15_000) {
        lastWorkingCapture = Date.now();
        await checkpoint(page, testInfo, "locked-backup-dump-in-progress");
        await emulatorCheckpoint(device, testInfo, "locked-backup-dump-in-progress");
      }
    }
    return outcome === "working" ? "working" : "finished";
  }, { timeout: 600_000, intervals: [500, 1000, 2000] }).toBe("finished");
  if (outcome !== "power-cycle") throw new Error(outcome);

  await checkpoint(page, testInfo, "locked-backup-power-cycle-prompt");
  await emulatorCheckpoint(device, testInfo, "locked-backup-power-cycle-prompt");
  // QMP presses the emulated console power key only; it must not stop or reset GWemu.
  await device.qmp.press("POWER", 150);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await device.qmp.press("POWER", 150);
  const proceed = page.getByRole("dialog").getByRole("button", { name: /^Continue$/i });
  await expect(proceed).toBeEnabled({ timeout: 120_000 });
  await checkpoint(page, testInfo, "locked-backup-blue-screen");
  await emulatorCheckpoint(device, testInfo, "locked-backup-blue-screen");
  await proceed.click();

  const progress = page.getByRole("dialog").filter({ hasText: /Back Up Original Firmware/i });
  let lastReadCapture = Date.now();
  await expect.poll(async () => {
    const text = await progress.innerText();
    if (!/Done\./i.test(text) && Date.now() - lastReadCapture >= 15_000) {
      lastReadCapture = Date.now();
      await checkpoint(page, testInfo, "locked-backup-read-in-progress");
      await emulatorCheckpoint(device, testInfo, "locked-backup-read-in-progress");
    }
    return text;
  }, { timeout: 600_000, intervals: [500, 1000, 2000] }).toMatch(/Done\./i);
  await checkpoint(page, testInfo, "locked-backup-read-complete");
  await emulatorCheckpoint(device, testInfo, "locked-backup-read-complete");
  await progress.getByRole("button", { name: /^Close$/i }).click();
  await expect(progress).toBeHidden();

  // This is a directory inventory refresh, distinct from a device rescan.
  const inventory = await page.evaluate(async () => {
    const { backupPresence } = await import("/src/lib/backupPresence.svelte.js");
    await backupPresence.scanDirectories();
    const { complete, partial } = backupPresence.forModel("mario");
    return {
      complete: !!complete,
      partial,
      internalBytes: complete?.internal?.byteLength ?? null,
      externalBytes: complete?.external?.byteLength ?? null,
      internalOk: complete?.internalOk ?? false,
      externalOk: complete?.externalOk ?? false,
    };
  });
  const inventoryText = JSON.stringify(inventory, null, 2) + "\n";
  await testInfo.attach("backup-directory-rescan.json", Buffer.from(inventoryText), { contentType: "application/json" });
  expect(inventory.complete, "the refreshed backup directory should contain a complete Mario pair").toBe(true);
  expect(inventory.internalOk).toBe(true);
  expect(inventory.externalOk).toBe(true);
  expect(inventory.internalBytes).toBe(131072);
  expect(inventory.externalBytes).toBe(1048576);

  const patch = page.getByRole("button", { name: /^Patch$/i });
  await expect(patch).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /^Patch Device$/i })).toBeVisible();

  const deviceState = await page.evaluate(async () => {
    const [{ backupPresence }, { device }] = await Promise.all([
      import("/src/lib/backupPresence.svelte.js"), import("/src/lib/device.svelte.js"),
    ]);
    await backupPresence.scanDirectories();
    const { complete, partial } = backupPresence.forModel("mario");
    const sources = await backupPresence.directories();
    const sourceEntries = [];
    for (const source of sources) {
      const entries = [];
      if (source.handle) for await (const [name, item] of source.handle.entries()) {
        entries.push({ name, kind: item.kind, size: item.metadata?.size ?? null });
      }
      sourceEntries.push({ rowName: source.name, folderName: source.folderName, status: source.status,
        usedBy: source.usedBy, handleName: source.handle?.name ?? null, entries });
    }
    return {
      complete: !!complete, partial,
      internalBytes: complete?.internal?.byteLength ?? null,
      externalBytes: complete?.external?.byteLength ?? null,
      internalOk: complete?.internalOk ?? false,
      externalOk: complete?.externalOk ?? false,
      lockedAfterBackup: device.locked,
      connection: device.connection,
      sourceEntries,
    };
  });
  const details = JSON.stringify(deviceState, null, 2) + "\n";
  await testInfo.attach("pristine-backup-verified.json", Buffer.from(details), { contentType: "application/json" });
  expect(deviceState.complete).toBe(true);
  expect(deviceState.internalOk).toBe(true);
  expect(deviceState.externalOk).toBe(true);
  expect(deviceState.internalBytes).toBe(131072);
  expect(deviceState.externalBytes).toBe(1048576);
  if (deviceState.lockedAfterBackup !== null) {
    expect(deviceState.lockedAfterBackup, "backup completes before the separate patch/unlock step").toBe(true);
  }
  await checkpoint(page, testInfo, "locked-backup-verified");
  await emulatorCheckpoint(device, testInfo, "locked-backup-verified");
  return deviceState;
}
