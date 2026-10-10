import { expect } from "../fixtures.mjs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { goToTab } from "./navigation.mjs";

const execFileAsync = promisify(execFile);

const reportFile = (name) => process.env.GNW_TEST_REPORT_DIR
  ? path.join(process.env.GNW_TEST_REPORT_DIR, name) : null;

// Progress counters can change many times per second. Screenshots follow named phase and
// sub-step transitions, with a 15 second heartbeat for long operations.
function modalProgressStage(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    let label = "";
    if (/^[●◉]$/.test(lines[index])) label = lines[index + 1] ?? "";
    else label = lines[index].match(/^[●◉]\s+(.+)$/)?.[1] ?? "";
    if (!label) continue;
    const progressLine = lines.slice(index + 1, index + 4).find((line) => /^\d{1,3}%$/.test(line));
    const percent = progressLine ? Math.floor(Number.parseInt(progressLine, 10) / 25) * 25 : null;
    return { label, percent };
  }
  return { label: "working", percent: null };
}

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function installPublishedRetroGo({ page, device, testInfo, io, checkpoint, emulatorCheckpoint, browserLog = [] }) {
  const history = [];
  const save = async (stage, extra = {}) => {
    history.push({ at: Date.now(), stage, ...extra });
    const file = reportFile("retro-go-install-progress.json");
    if (file) await writeFile(file, JSON.stringify(history, null, 2) + "\n");
  };
  const install = page.getByRole("button", { name: /^install$/i });
  await expect(install).toBeEnabled();
  await checkpoint(page, testInfo, "retro-go-install-entry");
  await install.click();
  await save("install-modal-opened");
  const dialog = page.getByRole("dialog").filter({ hasText: /Install Retro-Go/i });
  await expect(dialog).toContainText(/Install Retro-Go/i);
  const buttons = await dialog.getByRole("button").allInnerTexts();
  await save("install-modal-ready", { buttons });
  await checkpoint(page, testInfo, "retro-go-install-confirmation");
  await dialog.getByRole("button", { name: /^(install|upgrade|reinstall|downgrade)$/i })
    .click({ timeout: 15_000 });
  await save("install-confirmed");
  await checkpoint(page, testInfo, "retro-go-install-started");
  await emulatorCheckpoint?.(device, testInfo, "retro-go-install-started");

  const diagnostics = async (reason) => {
    const sample = io.rendererMemory.at(-1);
    const state = sample?.modalText ?? "Install dialog text unavailable";
    const details = JSON.stringify({ reason, state, operationLog: sample?.modalLog ?? "",
      browserConsole: browserLog.slice(-100) }, null, 2) + "\n";
    const file = reportFile("retro-go-install-diagnostics.json");
    if (file) await writeFile(file, details);
    await testInfo.attach("retro-go-install-diagnostics.json", Buffer.from(details), { contentType: "application/json" });
    const screenshot = testInfo.outputPath("retro-go-install-stalled.png");
    await Promise.race([page.screenshot({ path: screenshot }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (await stat(screenshot).catch(() => null))
      await testInfo.attach("retro-go-install-stalled", { path: screenshot, contentType: "image/png" });
    return state;
  };

  const deadline = Date.now() + 180_000;
  let terminalText = "";
  let midpointCaptured = false;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const sample = io.rendererMemory.at(-1);
    const operation = sample?.installProgress;
    terminalText = sample?.modalText ?? "";
    if (operation?.modalPhase === "done" || /\bDone\b/i.test(terminalText)) break;
    if (operation?.modalPhase === "error" || /(?:error|failed|timed out|cancelled|stopped)[^\n]*/i.test(terminalText)) {
      const state = await diagnostics("Install dialog reported a failure");
      throw new Error(`Retro-Go install failed: ${state.replace(/\s+/g, " ").trim()}. See retro-go-install-diagnostics.json`);
    }
    if (history.length === 0 || Date.now() - history.at(-1).at >= 15_000) {
      await save("install-running", { phase: operation?.modalPhase ?? null,
        phases: operation?.phases ?? null, error: operation?.error ?? null,
        dialog: terminalText.replace(/\s+/g, " ").trim(), gdb: sample?.gdb ?? null });
    }
    const visibleStage = modalProgressStage(terminalText);
    if (!midpointCaptured && (visibleStage.percent >= 50 || Date.now() - startedAt >= 45_000)) {
      midpointCaptured = true;
      await checkpoint(page, testInfo, `retro-go-install-midpoint-${slug(visibleStage.label)}`);
      await emulatorCheckpoint?.(device, testInfo, `retro-go-install-midpoint-${slug(visibleStage.label)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const finalPhase = io.rendererMemory.at(-1)?.installProgress?.modalPhase;
  if (finalPhase !== "done" && !/\bDone\b/i.test(terminalText)) {
    const state = await diagnostics("No Done state after 180 seconds");
    throw new Error(`Retro-Go install remained active after 180 seconds: ${state.replace(/\s+/g, " ").trim()}. See retro-go-install-diagnostics.json`);
  }
  await checkpoint(page, testInfo, "retro-go-install-complete");
  await emulatorCheckpoint?.(device, testInfo, "retro-go-install-complete");
  await dialog.getByRole("button", { name: /^close$/i }).click();
  await expect(page.getByRole("button", { name: /Continue to Library/i })).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator("body")).toContainText(/v\d+\.\d+\.\d+[^\s]*-flash/i);
  await expect(page.locator(".wizard-step").filter({ hasText: /Install Retro-Go/i })).toHaveClass(/done/);
  const bankState = JSON.stringify({ expectedInstallTarget: "Bank 2", result: "Retro-Go release shown in device banner" }, null, 2) + "\n";
  if (process.env.GNW_TEST_REPORT_DIR)
    await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "retro-go-bank-layout.json"), bankState);
  await testInfo.attach("retro-go-bank-layout.json", Buffer.from(bankState), { contentType: "application/json" });
  await checkpoint(page, testInfo, "retro-go-installed");
  return { progress: history, terminalText };
}

export async function syncLibraryItem({
  page, device, testInfo, io, searchTerm, rowText, romSummary = null, checkpoint, emulatorCheckpoint,
  continueToLibrary = true,
}) {
  if (continueToLibrary) {
    const continueButton = page.getByRole("button", { name: /Continue to Library/i });
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
    else await goToTab(page, "library");
  } else {
    await goToTab(page, "library");
  }
  const search = page.getByRole("searchbox");
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill(searchTerm);
  const row = page.locator(".row").filter({ hasText: rowText });
  await expect(row).toHaveCount(1);
  await checkpoint(page, testInfo, "library-sync-game-selected");
  await row.getByRole("button", { name: /not installed/i }).click();
  await expect(page.locator(".sel-count")).toContainText(/1/);
  // Flash sync needs the RAM flasher and a fresh partition inventory. A prepared Retro-Go
  // profile boots the firmware directly, so the app has identified the target but has not
  // yet loaded the flasher or scanned extflash geometry. Make that prerequisite an explicit
  // app action, the same one offered in the Library footer, and wait for the UI gate to clear.
  await expect(page.getByRole("button", { name: /^(Enter Recovery Mode|Sync Library)$/i })).toBeVisible({ timeout: 90_000 });
  const enterRecovery = page.getByRole("button", { name: /Enter Recovery Mode/i });
  if (await enterRecovery.isVisible().catch(() => false)) {
    await enterRecovery.click();
    const recoveryPrompt = page.getByRole("dialog").filter({ hasText: /Enter Recovery Mode\?/i });
    await expect(recoveryPrompt).toBeVisible();
    await checkpoint(page, testInfo, "library-sync-recovery-confirmation");
    await recoveryPrompt.getByRole("button", { name: /^continue$/i }).click();
    await expect.poll(async () => page.locator("body").innerText(), {
      timeout: 90_000, intervals: [500, 1000, 2000],
    }).toMatch(/Connected \(Recovery Mode\)/);
    await emulatorCheckpoint?.(device, testInfo, "library-sync-recovery-ready");
  }
  const sync = page.getByRole("button", { name: /Sync Library/i });
  await expect(sync).toBeEnabled({ timeout: 90_000 });
  let readySince = null;
  let previousSignature = null;
  await expect.poll(async () => {
    const signature = await page.evaluate(() => {
      const button = document.querySelector(".install-btn");
      if (!button || button.disabled) return null;
      return document.querySelector(".sel-count")?.textContent + "|" + button.parentElement?.textContent;
    });
    if (signature === null || signature !== previousSignature) {
      previousSignature = signature;
      readySince = signature === null ? null : Date.now();
      return false;
    }
    return Date.now() - readySince >= 1200;
  }, { timeout: 90_000, intervals: [250] }).toBe(true);
  await sync.click();
  const dialog = page.getByRole("dialog").filter({ hasText: /Games, BIOS and languages will be installed to the device/i });
  await expect(dialog).toBeVisible();
  await checkpoint(page, testInfo, "library-sync-confirmation");
  await dialog.getByRole("button", { name: /^confirm$/i }).click({ timeout: 15_000 });
  await checkpoint(page, testInfo, "library-sync-started");

  const deadline = Date.now() + 300_000;
  const history = [];
  let state = "";
  let midpointCaptured = false;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const sample = io.rendererMemory.at(-1);
    const operation = sample?.installProgress;
    state = sample?.modalText ?? "";
    if (operation?.modalPhase === "done" || /\bDone\b/i.test(state)) break;
    if (operation?.modalPhase === "error" || /(?:error|failed|timed out|cancelled|stopped)[^\n]*/i.test(state))
      throw new Error(`Library sync failed: ${state.replace(/\s+/g, " ").trim()}`);
    if (history.length === 0 || Date.now() - history.at(-1).at >= 15_000) {
      const sampleProgress = { at: Date.now(), phase: operation?.modalPhase ?? null,
        phases: operation?.phases ?? null, error: operation?.error ?? null,
        state: state.replace(/\s+/g, " ").trim(), gdb: sample?.gdb ?? null };
      history.push(sampleProgress);
      const file = reportFile("library-sync-progress.json");
      if (file) await writeFile(file, JSON.stringify(history, null, 2) + "\n");
    }
    const visibleStage = modalProgressStage(state);
    if (!midpointCaptured && (visibleStage.percent >= 50 || Date.now() - startedAt >= 45_000)) {
      midpointCaptured = true;
      await checkpoint(page, testInfo, `library-sync-midpoint-${slug(visibleStage.label)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const finalPhase = io.rendererMemory.at(-1)?.installProgress?.modalPhase;
  if (finalPhase !== "done" && !/\bDone\b/i.test(state))
    throw new Error(`Library sync did not reach Done within 300 seconds: ${state.replace(/\s+/g, " ").trim()}`);
  await page.getByRole("dialog").getByRole("button", { name: /^close$/i }).click();
  await expect(row.getByRole("button", { name: /^installed$/i })).toBeVisible({ timeout: 60_000 });
  const result = { installedRow: await row.innerText(), rom: romSummary, progress: history };
  const text = JSON.stringify(result, null, 2) + "\n";
  const file = reportFile("library-sync-result.json");
  if (file) await writeFile(file, text);
  await testInfo.attach("library-sync-result.json", Buffer.from(text), { contentType: "application/json" });
  return result;
}

/** Leave the RAM flasher with B, capture the returned Retro-Go screen, then move once. */
export async function rebootToRetroGoAndSelectTetris({
  page, device, testInfo, emulatorCheckpoint,
}) {
  if (!device.qmp) throw new Error("GWemu button input is required for Retro-Go menu verification");

  await device.qmp.press("B", 150);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const afterB = await emulatorCheckpoint(device, testInfo, "retro-go-after-b");
  await expect.poll(() => page.locator("body").innerText(), {
    timeout: 90_000, intervals: [500, 1000, 2000],
    message: "app should recognize Retro-Go after leaving the RAM flasher with B",
  }).toMatch(/Connected \(Retro-Go\)/i);
  await device.qmp.press("UP", 150);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const afterUp = await emulatorCheckpoint(device, testInfo, "retro-go-menu-after-one-up");
  const [afterBText, afterText] = await Promise.all([afterB, afterUp].map(async (screenshot) => {
    const { stdout } = await execFileAsync("tesseract", [screenshot, "stdout"], { timeout: 10_000 });
    return stdout.replace(/\s+/g, " ").trim();
  }));
  const selectionChanged = afterBText !== afterText;
  const menuReport = JSON.stringify({ buttons: ["B", "UP"],
    retroGoAfterB: { screenshot: path.basename(afterB), recognized: afterBText },
    retroGoAfterUp: { screenshot: path.basename(afterUp), recognized: afterText },
    selectionChanged, expectedSelection: "Tetris" }, null, 2) + "\n";
  const report = process.env.GNW_TEST_REPORT_DIR;
  if (report) await writeFile(path.join(report, "retro-go-menu-verification.json"), menuReport);
  await testInfo.attach("retro-go-menu-verification.json", Buffer.from(menuReport), {
    contentType: "application/json",
  });
  expect(selectionChanged, `GWemu display did not change after the single UP input: ${JSON.stringify({ afterBText, afterText })}`).toBe(true);
  expect(afterText, `Retro-Go did not show Tetris after one UP input: ${afterText}`).toMatch(/\btetris\b/i);
  return { buttons: ["B", "UP"], selectionChanged, selected: "Tetris" };
}
