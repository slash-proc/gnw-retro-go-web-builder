<script lang="ts">
  import { device, modelLabel } from "../device.svelte.js";
  import {
    pickBackupFolder,
    scanBackupFolder,
    defaultBackup,
    dumpBackup,
    dumpLockedBackup,
    isLockedBackupBlueScreen,
    restoreSavedExternal,
    writeBackup,
    detectDevice,
    patchAndFlash,
    backupPickerSupported,
    intBackupName,
    extBackupName,
    type BackupDir,
    type OfwModel,
  } from "../engine/ofw.js";
  import { evaluateRestore } from "../engine/restoreGuards.js";
  import { loadSel, saveSel, saveDir } from "../persist.js";
  import Button from "../ui/Button.svelte";
  import { installProgress, deviceSafety, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { msg } from "../logEntry.js";
  import { dbg } from "../debug.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { formatSize } from "../util.js";
  import PaneFooter from "./PaneFooter.svelte";
  import { localFolders, displayName, OFW_BACKUP_SOURCE_LIMIT } from "../sources/localFolders.svelte.js";
  import { backupPresence } from "../backupPresence.svelte.js";

  // Official Firmware — a staged, progressive-disclosure flow:
  //   1. Firmware Backup  — pick a folder; validate existing backups or take a fresh one.
  //   2. Patch            — appears once a valid stock backup is selected (one button + bootloader).
  //   3. Patch & flash    — shared install-progress-modal-gated, multi-transfer progress (internal + external).
  // A device is needed for a fresh backup + the flash; an existing valid backup unlocks step 2
  // without one. The patch model comes from the BACKUP (not the scanned hardware) — with a guard
  // for the dangerous Zelda-firmware-onto-Mario-hardware case (Mario hardware lacks two buttons).

  const supported = backupPickerSupported();

  // Recovery mode can make the internal-bank scan inconclusive. The device store also
  // probes GnWManager's model-specific ITCM signature in that case; use it before the
  // generic model fallback so an unknown live scan doesn't silently select Zelda backups.
  const detectedModel = $derived(
    device.deviceClass?.model ??
      (device.itcmOfwModel !== "unknown" ? device.itcmOfwModel : device.model),
  );

  // An already-patched (Retro-Go dual-boot) device has no STOCK firmware left to dump, so a fresh
  // "Back up now" is meaningless here. But patching from an EXISTING backup is still valid — that's
  // how you install a *different* official firmware (e.g. Mario↔Zelda) onto a patched device. So we
  // only suppress the fresh-dump path, not the folder-pick / select-backup / patch flow.
  const alreadyPatched = $derived(
    !!device.info && (device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old"),
  );

  let sourceSnapshots = $state<Awaited<ReturnType<typeof backupPresence.scanDirectories>>>([]);
  let selectedSourceId = $state<string | null>(null);
  let userVariantFilter = $state<"both" | OfwModel | null>(null);
  const variantFilter = $derived(userVariantFilter ?? (detectedModel === "unknown" ? "both" : detectedModel));
  const sources = $derived(localFolders.ofwBackupFolders());
  const selectedSource = $derived(sources.find((row) => row.id === selectedSourceId) ?? sources[0] ?? null);
  const dir = $derived((selectedSource?.handle as BackupDir | null) ?? null);
  const allBackups = $derived(sourceSnapshots.flatMap((snapshot) =>
    snapshot.backups.map((backup) => ({
      ...backup,
      sourceId: snapshot.source.id,
      sourceName: displayName(snapshot.source),
    })),
  ));
  const hasBothModels = $derived(
    (["mario", "zelda"] as const).every((model) => allBackups.some((b) => b.model === model && b.internalOk && b.externalOk)),
  );
  let triedRestore = $state(false);
  const scanResults = $derived(allBackups.filter((f) => variantFilter === "both" || f.model === variantFilter));
  let scanGeneration = 0;
  let chosenKey = $state<string | null>(null); // source + model; each menu entry retains its directory
  const backupKey = (f: { sourceId: string; model: OfwModel }) => `${f.sourceId}:${f.model}`;
  const noBackup = $derived(scanResults.length === 0);
  let pickErr = $state<string | null>(null);

  // The chosen backup, and the patch payload derived from it (only when hash-valid).
  const chosen = $derived(scanResults.find((f) => backupKey(f) === chosenKey) ?? null);
  $effect(() => {
    const visible = scanResults;
    if (chosenKey && visible.some((f) => backupKey(f) === chosenKey)) return;
    const preferred = defaultBackup(visible, detectedModel);
    const match = preferred && visible.find((f) => f.model === preferred.model);
    chosenKey = match ? backupKey(match) : null;
  });
  const selected = $derived(
    chosen && chosen.internalOk && chosen.externalOk
      ? { model: chosen.model, internal: chosen.internal, external: chosen.external }
      : null,
  );

  let backupBusy = $state(false);
  let backupErr = $state<string | null>(null);
  let backupRecoveryNotice = $state<string | null>(null);
  const recoverableExternals = $derived(scanResults.filter((b) => b.externalOk && !b.internalOk));

  let bootloader = $state(loadSel("ofwBootloader", true));
  $effect(() => saveSel("ofwBootloader", bootloader));
  let ackCrossModel = $state(false);
  let patchErr = $state<string | null>(null);
  let patched = $state(false);

  // Step 2 unlocks only on a genuine, hash-valid stock backup (the chosen one).
  const backupValid = $derived(!!selected);
  // Offer a fresh backup unless we already hold a valid backup for the CONNECTED hardware
  // (a Mario device with only a Zelda backup on disk should still be able to back up Mario).
  const offerBackup = $derived(
    detectedModel !== "unknown"
      ? !allBackups.some((f) => f.model === detectedModel && f.internalOk && f.externalOk)
      : !backupValid,
  );
  // Cross-model: the backup's firmware vs the scanned hardware. Zelda firmware on Mario
  // hardware is dangerous (missing buttons); Mario firmware on Zelda hardware is fine.
  const crossModel = $derived(
    !!selected && detectedModel !== "unknown" && detectedModel !== selected.model,
  );
  // The same guards Guided Setup runs (engine/restoreGuards.ts). `selected` is non-null only
  // when both dumps hash-matched, which is exactly the verdict's `valid`.
  const restoreVerdict = $derived(
    evaluateRestore(
      selected && {
        model: selected.model,
        internalOk: true,
        externalOk: true,
        externalLength: selected.external.length,
      },
      { model: detectedModel, extFlashBytes: device.extFlashBytes },
    ),
  );
  const dangerous = $derived(restoreVerdict.refusal === "wrong-hardware");
  // Hard capacity guard (not overridable): the external image must fit the device's flash chip.
  // We predict from the stock external backup (the patched external is ≤ it). Only enforced once
  // the chip size is known from the scan.
  //
  // Deliberately NOT `restoreVerdict.refusal === "too-big"`: the verdict reports ONE refusal in
  // precedence order, so a Zelda backup on Mario hardware (which trips both) reports only
  // wrong-hardware. Guided Setup wants that — it refuses either way. Here the wrong-hardware
  // half is overridable and the capacity half is not, so this guard is evaluated on its own and
  // keeps its own notice.
  const tooBig = $derived(
    !!selected && device.extFlashBytes > 0 && !device.fitsExtFlash(selected.external.length),
  );
  // Guided Setup's `restoreVerdict.allowed`, plus the expert override for the one refusal this
  // path lets the user accept. `!tooBig` stays outside it for the reason above.
  // Extflash collision. `patchAndFlash` writes the patched external image to bank 0 at
  // OFFSET 0 (engine/ofw.ts: `flashImage(flasher, 0, 0, res.external, …)`), and the patched
  // external is never larger than the stock one — so `selected.external.length` is the same
  // upper bound this section already uses for the capacity guard above, and for a Zelda
  // backup it is exactly the 4 MB the artboard names.
  //
  // "Installed data" means the user's own content partitions found by the deep scan
  // (engine/fsscan.ts): FrogFS (the game library), LittleFS (Retro-Go data/saves) and FAT.
  // The OFW/Assets/backup partitions are deliberately excluded — those ARE the region the
  // patch is supposed to replace, so naming them would cry wolf. The warning therefore only
  // appears when a scan actually found content inside [0, patch length).
  const patchExtBytes = $derived(selected ? selected.external.length : 0);
  const overlapsInstalled = $derived(
    !!selected &&
      device.partitions.some(
        (p) => (p.fs === "frogfs" || p.fs === "littlefs" || p.fs === "fat") && p.offset < patchExtBytes,
      ),
  );

  const canPatch = $derived(
    (restoreVerdict.allowed || (dangerous && ackCrossModel)) && device.isConnected && !tooBig,
  );

  // Patch firmware needs Recovery Mode: (1) a deep scan to find existing OFW assets, and
  // (2) it's itself a write op. Two-click affordance on one button: first click enters Recovery
  // Mode (+ runs the deep scan), second click (once device.utilLoaded) performs the patch.
  let enteringRecovery = $state(false);
  let recoveryErr = $state<string | null>(null);
  async function enterRecoveryAndScan(): Promise<void> {
    recoveryErr = null;
    enteringRecovery = true;
    try {
      await device.startRecoveryMode();
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("cancelled"))) {
        recoveryErr = e instanceof Error ? e.message : String(e);
      }
    } finally {
      enteringRecovery = false;
    }
  }

  const MiB = (n: number): string => (n / 1048576).toFixed(2);
  // Same MiB figure without the trailing ".00" — the artboards print whole megabytes as
  // "4 MB", not "4.00 MB" (BackupPatch*.dc.html:87, corrected in 31cc2f7).
  const mbShort = (n: number): string => MiB(n).replace(/\.00$/, "");
  // Row sizes as the artboard prints them: "128 KB" under a megabyte, "4 MB" over
  // (BackupPatchAllowed.dc.html:87, "int 128 KB" and "ext 1 MB"). That is exactly `formatSize`'s
  // contract, so this is the shared helper rather than a fourth local copy of it. The other
  // two figure helpers here stay local on purpose: `mbShort` and `MiB` feed translated
  // sentences that already carry the unit word (overlapWarnBody, tooBigNotice, the backup
  // progress readout), and `formatSize` would double it.

  async function doPickFolder(): Promise<void> {
    pickErr = null;
    backupErr = null;
    try {
      const d = await pickBackupFolder();
      if (!d) return; // cancelled
      const row = await localFolders.adoptOfwBackup(d);
      selectedSourceId = row.id;
      await saveDir("ofwBackupDir", d);
      patched = false;
      await rescan();
    } catch (e) {
      pickErr = e instanceof Error ? e.message : String(e);
    }
  }

  // The shared source registry is authoritative. Scan each registered OFW directory on mount.
  $effect(() => {
    if (triedRestore) return;
    triedRestore = true;
    void rescan();
  });

  async function reconnectSource(id: string): Promise<void> {
    const row = localFolders.get(id);
    if (!row) return;
    if (row.handle) {
      if (await localFolders.grant(id)) await rescan();
      return;
    }
    const picked = await pickBackupFolder();
    if (!picked) return;
    await localFolders.repoint(id, picked);
    await rescan();
  }

  async function removeSource(id: string): Promise<void> {
    await localFolders.removeOfwBackup(id);
    if (selectedSourceId === id) selectedSourceId = null;
    await backupPresence.refresh();
    await rescan();
  }

  // (Re)scan every source so Mario/Zelda menu entries can live in separate directories.
  async function rescan(): Promise<Awaited<ReturnType<typeof backupPresence.scanDirectories>> | null> {
    const generation = ++scanGeneration;
    const snapshots = await backupPresence.scanDirectories();
    if (generation !== scanGeneration) return null;
    sourceSnapshots = snapshots;
    selectedSourceId = selectedSourceId && snapshots.some((s) => s.source.id === selectedSourceId)
      ? selectedSourceId
      : (detectedModel !== "unknown"
          ? snapshots.find((s) => s.backups.some((b) => b.model === detectedModel && b.internalOk && b.externalOk))?.source.id
          : undefined)
        ?? snapshots.find((s) => s.backups.some((b) => b.internalOk && b.externalOk))?.source.id
        ?? snapshots[0]?.source.id
        ?? null;
    const located = snapshots.flatMap((snapshot) => snapshot.backups.map((backup) => ({
      ...backup,
      sourceId: snapshot.source.id,
      sourceName: displayName(snapshot.source),
    })));
    const visible = located.filter((f) => variantFilter === "both" || f.model === variantFilter);
    chosenKey = chosenKey && visible.some((f) => backupKey(f) === chosenKey)
      ? chosenKey
      : (() => {
          const preferred = defaultBackup(visible, detectedModel);
          const match = preferred && visible.find((f) => f.model === preferred.model);
          return match ? backupKey(match) : null;
        })();
    dbg(`[ofw-backup] source registry rescan: ${snapshots.map((s) => `${displayName(s.source)}: ${s.backups.map((f) => `${f.model} int=${f.internalFileSize ?? f.internal.length}B/${f.internalOk ? "valid" : "invalid"} ext=${f.externalFileSize ?? f.external.length}B/${f.externalOk ? "valid" : "invalid"}`).join(", ") || "no stock images"}`).join(" | ") || "no sources"}`);
    return snapshots;
  }

  const backupStages = [
    { id: "recovery", label: locale.t.officialFirmware.lockedBackupStageRecovery },
    { id: "identify", label: locale.t.officialFirmware.lockedBackupStageIdentify },
    { id: "read-external", label: locale.t.officialFirmware.lockedBackupStageReadExternal },
    { id: "save-external", label: locale.t.officialFirmware.lockedBackupStageSaveExternal },
    { id: "reuse-external", label: locale.t.officialFirmware.lockedBackupStageReuseExternal },
    { id: "flash-payload", label: locale.t.officialFirmware.lockedBackupStagePrepareRead },
    { id: "power-cycle", label: locale.t.officialFirmware.lockedBackupStagePowerCycle },
    { id: "read-internal", label: locale.t.officialFirmware.lockedBackupStageReadInternal },
    { id: "verify-backups", label: locale.t.officialFirmware.lockedBackupStageVerify },
    { id: "restore-external", label: locale.t.officialFirmware.lockedBackupStageRestore },
  ];
  const backupPhases: PhaseDef[] = [{
    id: "backup",
    label: locale.t.officialFirmware.step1Title,
    substeps: backupStages,
  }];

  async function doBackup(): Promise<void> {
    if (!dir) return;
    backupErr = null;
    backupRecoveryNotice = null;
    backupBusy = true;
    try {
      await installProgress.run({
        title: locale.t.officialFirmware.step1Title,
        body: locale.t.officialFirmware.lockedBackupConfirmBody,
        confirmText: locale.t.officialFirmware.backUpNow,
        phases: backupPhases,
        // The progress modal lives at App scope and can outlive this section. Bump the shared
        // revision so FirmwareRail destroys and recreates Backup & Patch; its mount path then
        // reloads the persisted directory handle and scans the actual files from disk.
        onClose: () => backupPresence.requestFirmwarePageReload(),
        exec: async (report) => {
          report.start("backup");
          let activeStage: string | null = null;
          const startStage = (id: string) => {
            if (activeStage && activeStage !== id) report.subFinish("backup", activeStage);
            if (activeStage === id) return;
            activeStage = id;
            report.subStart("backup", id);
          };
          try {
            // Check the payload's LTDC signature before Recovery Mode resets the staged SRAM.
            const resumeFromBlueScreen = !!device.transport && await isLockedBackupBlueScreen(device.transport);
            startStage("recovery");
            if (resumeFromBlueScreen) {
              report.log("backup", msg((t) => t.officialFirmware.lockedBackupBlueScreenLog));
            } else {
              await device.startRecoveryMode();
            }
            if (!resumeFromBlueScreen && (!device.utilLoaded || device.locked === null))
              throw new Error("Recovery Mode started, but the device's read-protection state could not be verified. Try Recovery Mode again.");
            report.subFinish("backup", "recovery");

            device.suspendPoll();
            deviceSafety.hold();
            let dumps: { internal: Uint8Array; external: Uint8Array };
            let backupDir = dir!;
            let lockedFlowCompleted = false;
            try {
              if (device.locked === true || resumeFromBlueScreen) {
                if (!device.transport) throw new Error("The debug adapter is not connected.");
                const result = await dumpLockedBackup({
                  transport: () => {
                    if (!device.transport) throw new Error("The debug adapter is not connected.");
                    return device.transport;
                  },
                  initialSwdClockHz: device.adapterFrequencyHz,
                  persistSwdClockHz: (hz) => device.setAdapterFrequency(hz),
                  reconnect: () => device.connect(undefined, { reconnect: true, recoveryOnly: true }),
                  ensureStub: (forceReboot = false) => device.ensureStub(undefined, forceReboot, true),
                  expectedModel: detectedModel === "unknown" ? undefined : detectedModel,
                  requestPowerCycle: async (signal) => {
                    // No flash operation is active while the user power-cycles. Resume the
                    // normal liveness poll so its reconnect path owns detection during this
                    // window; the modal reflects device state instead of probing a stale link.
                    device.resumePoll();
                    try {
                      await new Promise<void>((resolve, reject) => {
                        const cleanup = () => signal?.removeEventListener("abort", abort);
                        const abort = () => device.cancelLockedBackupPowerCycle();
                        signal?.addEventListener("abort", abort, { once: true });
                        device.lockedBackupPrompt = {
                          resolve: () => { cleanup(); resolve(); },
                          reject: (error) => { cleanup(); reject(error); },
                        };
                        device.beginLockedBackupPowerCycleMonitoring();
                        if (signal?.aborted) abort();
                      });
                      await device.connect(undefined, { reconnect: true, recoveryOnly: true });
                    } finally {
                      device.suspendPoll();
                    }
                  },
                  requestReadFailureChoice: (error, nextSwdClockHz, signal) => new Promise((resolve, reject) => {
                    const abort = () => {
                      device.lockedBackupFailurePrompt = null;
                      reject(new Error("Operation aborted"));
                    };
                    signal?.addEventListener("abort", abort, { once: true });
                    device.lockedBackupFailurePrompt = {
                      error,
                      nextSwdClockHz,
                      resolve: (choice) => {
                        signal?.removeEventListener("abort", abort);
                        resolve(choice);
                      },
                    };
                    if (signal?.aborted) abort();
                  }),
                  resumeFromBlueScreen,
                }, backupDir, await scanBackupFolder(backupDir), (stage, done, total, outcome) => {
                  if (stage === "done") {
                    if (activeStage) report.subFinish("backup", activeStage);
                    activeStage = null;
                    return;
                  }
                  if (outcome === "error") {
                    report.subError("backup", stage);
                    if (activeStage === stage) activeStage = null;
                    return;
                  }
                  startStage(stage);
                  if (done !== undefined && total !== undefined)
                    report.progress("backup", done, total, stage, "bytes");
                }, report.signal);
                dumps = result.dumps;
                backupDir = result.directory;
                lockedFlowCompleted = true;
              } else {
                startStage("read-external");
                const flasher = await device.ensureStub(undefined, false, true);
                let extSize = device.extFlashBytes;
                const actualModel = detectedModel;
                if (actualModel === "mario") extSize = 1048576;
                else if (actualModel === "zelda") extSize = 4194304;
                dumps = await dumpBackup(flasher, extSize, (done, total, label) => {
                  const stage = label === "internal flash" ? "read-internal" : "read-external";
                  startStage(stage);
                  report.progress("backup", done, total, stage, "bytes");
                }, report.signal);
                startStage("verify-backups");
              }

              if (!lockedFlowCompleted) startStage("verify-backups");
              if (report.signal.aborted) throw new Error("Operation aborted");
              const det = await detectDevice(dumps.internal, dumps.external);
              if (report.signal.aborted) throw new Error("Operation aborted");
              if (!det.model || !det.internalOk || !det.externalOk)
                throw new Error(locale.t.officialFirmware.errFirmwareMismatch);
              // These are the just-read, hash-verified images. Always commit them to the
              // selected folder; an earlier scan can be stale or can describe a different
              // on-disk generation, and must not suppress the fresh internal dump write.
              backupDir = await writeBackup(backupDir, det.model, dumps);
              if (!(await scanBackupFolder(backupDir)).some((f) => f.model === det.model && f.internalOk && f.externalOk))
                throw new Error("Saved firmware backup failed hash verification; the device will remain locked.");
              // The backup may have been written during this operation, so rebuild the UI
              // from the directory contents instead of retaining the pre-backup scan (or
              // synthesizing a result from the in-memory dump). Persist and adopt the same
              // handle so the patch flow and a later reload use this exact folder.
              await saveDir("ofwBackupDir", backupDir);
              selectedSourceId = (await localFolders.adoptOfwBackup(backupDir)).id;
              userVariantFilter = det.model;
              // `scanBackupFolder` above already verified the saved bytes. Use the fresh
              // snapshot returned by this rescan instead of reading `scanResults` here:
              // it is a $derived view and may not have recomputed until the next render.
              const refreshed = await rescan();
              const saved = refreshed
                ?.find((snapshot) => snapshot.source.id === selectedSourceId)
                ?.backups.find((backup) => backup.model === det.model && backup.internalOk && backup.externalOk);
              if (saved) chosenKey = `${selectedSourceId}:${saved.model}`;
              device.markBackupTaken();
              if (activeStage) report.subFinish("backup", activeStage);
              report.finish("backup");
            } finally {
              deviceSafety.release();
              device.resumePoll();
            }
          } catch (e) {
            backupErr = e instanceof Error ? e.message : String(e);
            throw e;
          }
        },
      });
    } catch (e) {
      if (!backupErr) backupErr = e instanceof Error ? e.message : String(e);
      await rescan().catch(() => {});
    } finally {
      backupBusy = false;
    }
  }

  async function restoreSavedExternalNow(partial: (typeof scanResults)[number]): Promise<void> {
    const source = localFolders.get(partial.sourceId);
    const sourceDir = source?.handle as BackupDir | null;
    if (!sourceDir || backupBusy) return;
    backupBusy = true;
    backupErr = null;
    backupRecoveryNotice = null;
    try {
      await installProgress.run({
        title: "Restore saved stock firmware",
        body: "The verified external firmware dump will be written back to the device and hash-checked. The internal firmware backup is still incomplete.",
        confirmText: "Restore external firmware",
        danger: true,
        phases: [
          { id: "recover", label: "Reconnect and enter Recovery Mode" },
          { id: "restore", label: "Restore original external firmware" },
        ],
        exec: async (report) => {
          try {
            report.start("recover");
            device.suspendPoll();
            deviceSafety.hold();
            try {
              await device.connect(undefined, { reconnect: true, recoveryOnly: true });
              await device.startRecoveryMode();
              report.finish("recover");
              report.start("restore");
              await restoreSavedExternal(sourceDir, partial.model, (force) => device.ensureStub(undefined, force, true),
                (done, total) => report.progress("restore", done, total, undefined, "bytes"));
              report.finish("restore");
            } finally {
              deviceSafety.release();
              device.resumePoll();
            }
            backupRecoveryNotice = `Original ${modelLabel(partial.model)} external firmware restored and device-verified during flashing. The internal backup is still incomplete.`;
            await rescan();
          } catch (e) {
            backupErr = e instanceof Error ? e.message : String(e);
            throw e;
          }
        },
      });
    } catch (e) {
      if (!backupErr) backupErr = e instanceof Error ? e.message : String(e);
    } finally {
      backupBusy = false;
    }
  }

  // Phase shape mirrors Wizard.svelte's already-migrated step1 (Backup & Patch): patch, then
  // the two flash sub-phases patchAndFlash reports via its own progressReport(sub.label), then
  // a rescan. This flow's backup is already selected (step 1 above), so there's no
  // locate-backup/read-device phase here.
  const patchPhases: PhaseDef[] = [
    { id: "patch", label: locale.t.officialFirmware.phasePatch },
    { id: "flash-internal", label: locale.t.officialFirmware.phaseFlashInternal },
    { id: "flash-external", label: locale.t.officialFirmware.phaseFlashExternal },
    { id: "rescan", label: locale.t.officialFirmware.phaseRescan },
  ];

  async function run(report: PhaseReporter): Promise<void> {
    const sel = selected!;
    report.start("patch");
    report.log("patch", msg((t) => t.officialFirmware.logPatchingModel, sel.model, sel.internal.length, sel.external.length));
    let flashInternalStarted = false;
    let flashExternalStarted = false;
    // Automatic unlock: a locked device is unlocked before this write, never after it
    // (engine/unlockGate.ts owns the backup-first ordering). No-op when already unlocked.
    // Ahead of suspendPoll(): unlocking resets the device and rescans it, which is exactly
    // the kind of work the liveness poll exists for.
    await device.ensureUnlocked();
    device.suspendPoll();
    try {
      await patchAndFlash(
        (force) => device.ensureStub(undefined, force, true),
        sel.model,
        sel.internal,
        sel.external,
        { bootloader },
        (d, t, sub) => {
          // "bootloader → bank 1" shares the internal phase — both write bank 1.
          if (sub?.label.endsWith("bank 1")) {
            if (!flashInternalStarted) {
              flashInternalStarted = true;
              report.finish("patch");
              report.start("flash-internal");
            }
            report.progress("flash-internal", sub.value, sub.max);
          } else if (sub?.label === "external → bank 0") {
            if (!flashExternalStarted) {
              flashExternalStarted = true;
              if (flashInternalStarted) report.finish("flash-internal");
              report.start("flash-external");
            }
            report.progress("flash-external", sub.value, sub.max);
          }
        },
        report.signal,
        device.extFlashBytes,
      );
    } finally {
      device.resumePoll();
    }
    if (flashInternalStarted) report.finish("flash-internal");
    if (flashExternalStarted) report.finish("flash-external");

    report.start("rescan");
    report.log("rescan", msg((t) => t.eraseSection.rescanningLog));
    await device.runScan("ofw section");
    report.finish("rescan");
  }

  const modalBody = $derived.by(() => {
    if (!selected) return "";
    const base = locale.t.officialFirmware.modalBodyBase(modelLabel(selected.model), bootloader);
    return dangerous ? locale.t.officialFirmware.modalBodyDangerPrefix(base) : base;
  });

  function openPatch() {
    patchErr = null;
    patched = false;
    void installProgress.run({
      title: locale.t.officialFirmware.modalTitle,
      body: modalBody,
      danger: true,
      confirmText: locale.t.officialFirmware.modalConfirmText,
      phases: patchPhases,
      exec: async (report) => {
        try {
          await run(report);
          patched = true;
          void device.runScan("ofw section");
        } catch (e) {
          patchErr = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    });
  }
</script>

<div class="ofw">
  <!-- Step 1 — Firmware backup. BackupPatch.dc.html's spine: a 30px mark column and a
       22px disc (green + white check when done, --ink + --surface numeral when not — see the
       .disc rule for why the numeral is a token and the check stays a literal), joined
       to the next step by a 1px hairline connector that grows to fill the gap. -->
  <section class="step" class:done={backupValid}>
    <div class="rail">
      <span class="disc">
        {#if backupValid}
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor"
               stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4.5 10.5l3.5 3.5 7.5-8" />
          </svg>
        {:else}
          1
        {/if}
      </span>
      <!-- BackupPatch.dc.html always draws step 1's connector: the artboards never show
           step 1 without step 2 below it, and the spine is continuous regardless of whether
           a backup has been chosen yet (survey A, BackupPatch #2). -->
      <span class="connector"></span>
    </div>
    <div class="step-body">
      <div class="title-row">
        <h4 class="steph">{locale.t.officialFirmware.step1Title}</h4>
        {#if backupValid}<span class="found-chip">{locale.t.officialFirmware.foundChip}</span>{/if}
      </div>
    {#if !supported}
      <p class="notice">{locale.t.officialFirmware.chromiumRequired}</p>
    {/if}
    <!-- BackupPatch.dc.html goes straight from the step-1 heading to the folder line: the two
         intro paragraphs are the no-folder-chosen state's copy (which no artboard draws), so
         they are kept for that state and dropped once a folder is picked. -->
    {#if sources.length === 0}
      <p class="muted">{locale.t.officialFirmware.pickFolderIntro}</p>
      <p class="muted">
        {locale.t.officialFirmware.pickFolderLookForPre}
        <span class="mono">{locale.t.officialFirmware.internalBackupFilename}</span> + <span class="mono">{locale.t.officialFirmware.externalBackupFilename}</span>
        {locale.t.officialFirmware.pickFolderBodyPost}
      </p>
    {/if}
    <div class="library-toolbar">
      <div class="segmented" role="group" aria-label={locale.t.officialFirmware.filterVariants}>
        {#each [{ value: "both", label: locale.t.officialFirmware.filterBoth }, { value: "mario", label: modelLabel("mario") }, { value: "zelda", label: modelLabel("zelda") }] as option}
          <button class:active={variantFilter === option.value} type="button" aria-pressed={variantFilter === option.value}
            onclick={() => { userVariantFilter = option.value as "both" | OfwModel; void rescan(); }}>{option.label}</button>
        {/each}
      </div>
      {#if sources.length < OFW_BACKUP_SOURCE_LIMIT && !hasBothModels}
        <Button variant="quiet" disabled={!supported || backupBusy} onclick={doPickFolder}>+ {locale.t.sources.folders.addDirectoryTitle}</Button>
      {/if}
    </div>
    {#each sourceSnapshots.filter((snapshot) => snapshot.source.status !== "ready") as snapshot (snapshot.source.id)}
      <div class="source-repair-row">
        <span><strong>{displayName(snapshot.source)}</strong><br />{snapshot.source.status === "needs-permission" ? locale.t.sources.folders.needsPermission : locale.t.sources.folders.missing}</span>
        <Button variant="quiet" disabled={backupBusy} onclick={() => reconnectSource(snapshot.source.id)}>
          {snapshot.source.status === "needs-permission" ? locale.t.officialFirmware.reconnectLastFolder : locale.t.officialFirmware.changeFolder}
        </Button>
        <button class="source-remove" type="button" disabled={backupBusy} title={locale.t.sources.remove} onclick={() => void removeSource(snapshot.source.id)}>
          {locale.t.sources.remove}
        </button>
      </div>
    {/each}
    {#if pickErr}<p class="notice warn">{pickErr}</p>{/if}

    {#if sources.length > 0}
      {#if scanResults.length > 0}
        <fieldset class="backup-menu" aria-label={locale.t.officialFirmware.filterVariants}>
          <legend class="sr-only">{locale.t.officialFirmware.filterVariants}</legend>
          {#each scanResults as fb (backupKey(fb))}
            <label class="backup-choice" class:sel={chosenKey === backupKey(fb)}>
              <input type="radio" name="ofw-backup" value={backupKey(fb)} bind:group={chosenKey}
                onchange={() => { selectedSourceId = fb.sourceId; }} />
              <span class="choice-heading">
                <strong>{modelLabel(fb.model)}</strong>
                <span class="source-association"><span aria-hidden="true">↳</span> {fb.sourceName}</span>
              </span>
              <span class="choice-files">
                <span class="file-state" class:file-ok={fb.internalOk} aria-label={locale.t.officialFirmware.backupFailedValidation(modelLabel(fb.model), fb.internalOk, fb.externalOk)}>
                  <span>{intBackupName(fb.model)}</span>
                  <small>{fb.internalPresent ? formatSize(fb.internalOk ? fb.internal.length : fb.internalFileSize ?? fb.internal.length) : locale.t.sources.folders.missing}</small>
                  <b>{fb.internalOk ? locale.t.officialFirmware.rowValid : fb.internalPresent ? "✗" : locale.t.sources.folders.missing}</b>
                </span>
                <span class="file-state" class:file-ok={fb.externalOk} aria-label={locale.t.officialFirmware.backupFailedValidation(modelLabel(fb.model), fb.internalOk, fb.externalOk)}>
                  <span>{extBackupName(fb.model)}</span>
                  <small>{fb.externalPresent ? formatSize(fb.externalOk ? fb.external.length : fb.externalFileSize ?? fb.external.length) : locale.t.sources.folders.missing}</small>
                  <b>{fb.externalOk ? locale.t.officialFirmware.rowValid : fb.externalPresent ? "✗" : locale.t.sources.folders.missing}</b>
                </span>
              </span>
            </label>
          {/each}
        </fieldset>
      {/if}

      {#if backupValid && chosen}
        <p class="ok">
          {locale.t.officialFirmware.validBackupSelected(modelLabel(chosen.model))}
        </p>
      {:else if chosen && !backupValid}
        <p class="notice warn">
          {locale.t.officialFirmware.backupFailedValidation(modelLabel(chosen.model), chosen.internalOk, chosen.externalOk)}
        </p>
      {:else if noBackup}
        <p class="muted">{locale.t.officialFirmware.noBackupYet}</p>
      {/if}

      <!-- Fresh backup from the device (needs the RAM util). -->
      {#if !offerBackup && scanResults.length > 0 && !alreadyPatched}
        <div class="againline">
          <button type="button" class="againlink" disabled={!device.isConnected || backupBusy} onclick={doBackup}>
            {backupBusy ? locale.t.officialFirmware.backingUp : locale.t.officialFirmware.backUpAgain}
          </button>
        </div>
        {#if backupErr}<p class="notice warn">{backupErr}</p>{/if}
      {/if}
      {#if offerBackup}
        {#if alreadyPatched}
          <p class="notice">
            <!-- No literal whitespace between these fragments: each locale owns its own
                 spacing/punctuation at the boundaries (es/pl need a comma, ja/ko differ). -->
            {locale.t.officialFirmware.alreadyPatchedNoticePre}<strong>{locale.t.officialFirmware.alreadyPatchedNoticeBold}</strong>{locale.t.officialFirmware.alreadyPatchedNoticePost}<strong>{locale.t.officialFirmware.alreadyPatchedNoticeDifferentBold}</strong>{locale.t.officialFirmware.alreadyPatchedNoticeEnd}
          </p>
        {:else}
          <div>
            <Button
              variant="default"
              disabled={!device.isConnected || backupBusy}
              onclick={doBackup}
            >
              {backupBusy ? locale.t.officialFirmware.backingUp : locale.t.officialFirmware.backUpNow}
            </Button>
            {#if !device.isConnected}
              <span class="hint">{locale.t.officialFirmware.connectToBackUp}</span>
            {/if}
          </div>
          {#if backupErr}<p class="notice warn">{backupErr}</p>{/if}
        {/if}
      {/if}
      {#if backupRecoveryNotice}<p class="ok">{backupRecoveryNotice}</p>{/if}
      {#if backupErr && recoverableExternals.length > 0}
        <div class="recovery-actions">
          <p class="notice warn">A hash-verified external stock image is saved. Restore it to return to stock, or retry the internal backup later; the saved image will be reused.</p>
        {#each recoverableExternals as partial (backupKey(partial))}
            <Button variant="default" disabled={backupBusy} onclick={() => restoreSavedExternalNow(partial)}>
              Restore saved {modelLabel(partial.model)} external firmware
            </Button>
          {/each}
        </div>
      {/if}
    {/if}
    </div>
  </section>

  <!-- Step 2 — Patch (only once a valid stock backup is selected) -->
  {#if selected}
    <section class="step active">
      <div class="rail"><span class="disc">2</span></div>
      <div class="step-body">
      <div class="head">
        <h4 class="steph big">{locale.t.officialFirmware.step2Title}</h4>
        <p class="muted">
          {scanResults.length > 1
            ? locale.t.officialFirmware.step2BodySelected
            : locale.t.officialFirmware.step2BodyThis(modelLabel(selected.model))}
        </p>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={bootloader} />
        {locale.t.officialFirmware.installBootloaderLabel} <em>{locale.t.officialFirmware.installBootloaderHint}</em>
      </label>

      {#if dangerous}
        <div class="danger">
          <p>
            <strong>{locale.t.officialFirmware.crossModelDangerBold}</strong> {locale.t.officialFirmware.crossModelDangerBody}
          </p>
          <label class="check">
            <input type="checkbox" bind:checked={ackCrossModel} />
            {locale.t.officialFirmware.crossModelAck}
          </label>
        </div>
      {:else if crossModel}
        <!-- BackupPatchAllowed.dc.html:97 — the allowed note is a gold left-rule aside, the same
             shape as the collision aside, not grey body copy. -->
        <p class="caution-aside">
          <strong>{locale.t.officialFirmware.crossModelAllowedBold}</strong>
          {locale.t.officialFirmware.crossModelAllowedNote(modelLabel(selected.model), modelLabel(detectedModel))}
        </p>
      {/if}

      {#if overlapsInstalled}
        <p class="caution-aside">
          <strong>{locale.t.officialFirmware.overlapWarnBold}</strong>
          {locale.t.officialFirmware.overlapWarnBody(mbShort(patchExtBytes))}
        </p>
      {/if}

      {#if tooBig}
        <p class="notice warn">
          {locale.t.officialFirmware.tooBigNotice(modelLabel(selected.model), MiB(selected.external.length), MiB(device.extFlashBytes))}
        </p>
      {/if}

      <!-- BackupPatch.dc.html / BackupPatchCross.dc.html — the cross-model state swaps the
           summary AND turns the action into the destructive outline labelled "Patch anyway". -->
      <PaneFooter
        summary={dangerous ? locale.t.officialFirmware.footerSummaryCross : locale.t.officialFirmware.footerSummary}
      >
        {#if !device.isConnected}<span class="hint">{locale.t.officialFirmware.connectToPatchAndFlash}</span>{/if}
        {#if !device.utilLoaded}
          <Button variant="action" disabled={!device.isConnected || enteringRecovery} onclick={enterRecoveryAndScan}>
            {enteringRecovery ? locale.t.officialFirmware.enteringRecoveryMode : locale.t.officialFirmware.enterRecoveryMode}
          </Button>
        {:else if dangerous}
          <Button variant="destructive" disabled={!canPatch} onclick={openPatch}>
            {locale.t.officialFirmware.patchAnywayButton}
          </Button>
        {:else}
          <Button variant="action" disabled={!canPatch} onclick={openPatch}>
            {locale.t.officialFirmware.patchFirmwareButton}
          </Button>
        {/if}
      </PaneFooter>
      {#if recoveryErr}<p class="notice warn">{recoveryErr}</p>{/if}
      {#if patched}<p class="ok">{locale.t.officialFirmware.patchedAndFlashed}</p>{/if}
      {#if patchErr}<p class="notice warn">{patchErr}</p>{/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .ofw {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  /* BackupPatch.dc.html: `grid-template-columns: 30px minmax(0, 1fr); column-gap: 18px`. */
  .step {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    column-gap: 18px;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  /* 22px disc, --ink fill + reversed-out numeral; green fill + white check once the step is
     done. The numeral reads --surface, NOT a `#ffffff` literal: --ink flips (#1b1b1b light ->
     #ececec dark) while the literal does not, so in dark theme this was white-on-near-white
     and the step number vanished. --surface is --ink's counterpart in both theme blocks and is
     the same pairing Button.svelte's `.ink-solid` already uses for `background: var(--ink)`.
     (The green `.step.done .disc` case keeps a white check drawn in markup — --zelda-green is
     dark enough in both themes.) */
  .disc {
    width: 22px;
    height: 22px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--ink);
    color: var(--surface);
    font-size: var(--fs-label);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  /* The done state keeps the literal white check: unlike --ink, --zelda-green stays a mid
     green in both theme blocks (#3e9e4e / #4fb163), so white-on-it is the same legible pair in
     either theme — the same on-green check ConnectGateModal/FolderGateModal draw. Restating it
     here is required because `.disc` above now inherits --surface, which would darken it. */
  .step.done .disc {
    background: var(--zelda-green);
    color: #ffffff;
  }
  .connector {
    width: 1px;
    flex-grow: 1;
    background: var(--hairline);
    margin: 8px 0;
  }
  .step-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .step.done .step-body {
    padding-bottom: 34px;
  }
  .step.active .step-body {
    gap: 16px;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  /* Uppercase green state chip beside the step title (artboard: "Found"). */
  .found-chip {
    font-size: var(--fs-chip);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--zelda-green);
    text-transform: uppercase;
  }
  .pickrow {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .library-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .segmented { display: inline-flex; padding: 3px; border: 1px solid var(--hairline); border-radius: 10px; gap: 2px; }
  .segmented button {
    border: 0; border-radius: 7px; padding: 7px 12px; background: transparent; color: var(--ink-soft);
    font: inherit; font-size: var(--fs-caption); cursor: pointer;
  }
  .segmented button.active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px #0002; }
  .source-repair-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid var(--hairline); border-radius: 8px; color: var(--ink-soft); font-size: var(--fs-label); }
  .source-repair-row > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source-remove { border: 0; background: transparent; color: var(--ink-soft); cursor: pointer; font: inherit; font-size: var(--fs-label); }
  .backup-menu { display: grid; gap: 8px; padding: 0; margin: 0; border: 0; }
  .backup-choice { position: relative; display: grid; grid-template-columns: minmax(130px, 0.65fr) minmax(0, 1.35fr); gap: 12px 16px; align-items: center; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); cursor: pointer; }
  .backup-choice.sel { border-color: color-mix(in srgb, var(--zelda-green) 60%, var(--hairline)); background: color-mix(in srgb, var(--zelda-green) 5%, var(--surface)); }
  .choice-heading { display: grid; gap: 4px; min-width: 0; padding-inline-start: 24px; }
  .choice-heading strong { font-size: var(--fs-body); }
  .source-association { overflow: hidden; color: var(--ink-soft); font-size: var(--fs-label); text-overflow: ellipsis; white-space: nowrap; }
  .choice-files { display: grid; gap: 4px; min-width: 0; }
  .file-state { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--hairline); font-size: var(--fs-label); }
  .file-state:last-child { border-bottom: 0; }
  .file-state > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-state small { color: var(--ink-soft); font-family: var(--font-mono); }
  .file-state b { color: var(--gold); font-size: var(--fs-label); text-transform: uppercase; white-space: nowrap; }
  .file-state.file-ok b { color: var(--zelda-green); }
  .backup-choice input[type="radio"] { position: absolute; inset-inline-start: 14px; top: 17px; margin: 0; accent-color: var(--zelda-green); }
  .backup-choice:focus-within { outline: 2px solid var(--zelda-green); outline-offset: 2px; }
  @media (max-width: 620px) {
    .backup-choice { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  }
  /* 18px for a completed step, 22px for the one you are on (artboard). */
  .steph {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .steph.big {
    font-size: 22px;
    letter-spacing: -0.015em;
  }
  .muted {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .mono {
    font-family: var(--font-mono);
  }
  /* The artboard's caution aside: a 2px gold rule at the left, no box. */
  .caution-aside {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink);
    border-inline-start: 2px solid var(--caution);
    /* Inline, to follow the `border-inline-start` above: as `padding-left` the 14px stayed on
       the left under `dir=rtl` while the rule moved to the right, so the text butted against
       the rule and the gap opened on the empty side. */
    padding-block: 2px;
    padding-inline: 14px 0;
  }
  .caution-aside strong {
    color: var(--caution);
  }
  .ok {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--zelda-green);
    font-weight: 600;
  }
  .notice {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--caution);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.5rem 0.65rem;
  }
  .warn {
    color: var(--caution);
  }
  .recovery-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .recovery-actions .notice { flex-basis: 100%; }
  /* BackupPatch.dc.html:96 — `display:flex; align-items:center; gap:10px`, 14px label with a
     13px `(recommended)` hint. */
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--fs-caption);
    color: var(--ink);
  }
  .check em {
    color: var(--ink-soft);
    font-style: normal;
    font-size: var(--fs-btn-sm);
  }
  /* BackupPatch.dc.html:96 draws the mark itself: a 16px `2px`-radius square that fills
     --zelda-green with a white 10px check when set. The control stays a real
     <input type="checkbox">; only its paint is ours. */
  .check input[type="checkbox"] {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border: 1px solid var(--silver-edge);
    border-radius: 2px;
    background: var(--surface);
    cursor: inherit;
  }
  .check input[type="checkbox"]:checked {
    border-color: var(--zelda-green);
    background:
      var(--zelda-green)
      url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20' fill='none' stroke='%23ffffff' stroke-width='2.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.5 10.5l3.5 3.5 7.5-8'/%3E%3C/svg%3E")
      center / 10px 10px no-repeat;
  }
  .check input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
  }
  .check input[type="checkbox"]:disabled {
    opacity: 0.45;
  }
  .hint {
    margin-inline-start: 0.5rem;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  /* BackupPatch*.dc.html's row surface: white, 6px radius, `padding: 2px 16px`, rows
     separated by the in-surface --rule (#ededed). No border and no shadow. */
  .rows {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 2px 16px;
    margin: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
    font-size: var(--fs-caption);
    color: var(--ink);
    min-width: 0;
  }
  label.row {
    cursor: pointer;
  }
  /* The radio keeps every native behaviour (arrow keys, name grouping, AT role) and only
     swaps its paint for the artboard's 15px ring. */
  .row input[type="radio"] {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--silver-edge);
    background: var(--surface);
    flex-shrink: 0;
  }
  .row input[type="radio"]:checked {
    border: 4px solid var(--zelda-green);
  }
  .row input[type="radio"]:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .rname {
    flex-grow: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row.sel .rname {
    font-weight: 600;
  }
  .rsize {
    font-size: var(--fs-chip);
    color: var(--ink-soft);
  }
  .rchip {
    font-size: var(--fs-label);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-inline-start: 14px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* The folder line + its green "Change folder" link. */
  .folderline {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--ink-soft);
    min-width: 0;
  }
  .path {
    font-size: var(--fs-caption);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .linklike {
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--zelda-green);
    flex-shrink: 0;
  }
  .linklike:disabled {
    color: var(--ink-dim);
    cursor: default;
  }
  /* "Back up this device again" — the artboard's quiet grey line under the rows. */
  .againline {
    padding-top: 2px;
  }
  .againlink {
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .againlink:hover {
    color: var(--ink);
  }
  .againlink:disabled {
    color: var(--ink-dim);
    cursor: default;
  }
  .ok-chip {
    color: var(--zelda-green);
  }
  .bad-chip {
    color: var(--caution);
  }
  /* BackupPatchCross.dc.html:97 — a left-rule aside on the page ground, mirroring the gold
     collision aside exactly but in --danger: no box, no fill, no radius. */
  .danger {
    border-inline-start: 2px solid var(--danger);
    /* Inline, to follow the `border-inline-start` above. Same pairing as `.caution-aside`. */
    padding-block: 2px;
    padding-inline: 14px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .danger p {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink);
  }
  .danger p strong {
    color: var(--danger);
  }
  /* The acknowledgement mark is outlined in --danger while unset (artboard); once set it uses
     the same green check mark every other artboard draws. */
  .danger .check input[type="checkbox"]:not(:checked) {
    border-color: var(--danger);
  }
  .prog {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .track {
    height: 0.5rem;
    background: var(--surface-sunk);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--model-accent);
    transition: width 120ms ease;
  }
</style>
