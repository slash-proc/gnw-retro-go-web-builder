<script lang="ts">
  import { device, modelLabel } from "../device.svelte.js";
  import Button from "../ui/Button.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";

  import {
    pickBackupFolder, dumpBackup, writeBackup, patchAndFlash, detectDevice,
    scanBackupFolder, defaultBackup
  } from "../engine/ofw.js";
  import { buildFlashInstall, flashInstallToDevice, type FlashRegion } from "../engine/flashInstall.js";
  import { listVersions, fetchBundle } from "../artifacts.js";
  import { dbgLog } from "../debug.js";
  import { isStubAlive, dumpRegion } from "../engine/flasher.js";
  import { raceWithFallback } from "../engine/timeout.js";
  import { saveFileToDirOrDownload, nativeFolderPickerSupported, pickSdCardFolder } from "../romScan.js";
  import { download } from "../util.js";
  import { readFrogfsState } from "../engine/fsscan.js";
  import { readGameData } from "../engine/frogfsDevice.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import JSZip from "jszip";

  let { onComplete }: { onComplete?: () => void } = $props();

  const MiB = (n: number) => (n / 1048576).toFixed(2);

  const hasAssets = $derived(
    device.partitions.some(p => p.type.includes("Assets") || p.type.includes("OFW"))
  );

  // "Patched" requires ACTUAL evidence of a patched OFW in intflash (deviceClass.ofw.patched,
  // derived from the bank scan) AND its assets present in extflash (hasAssets) — both checks
  // are required, not just "not locked". The old fallback (`kind !== "locked"`) fired whenever
  // NO OFW was detected anywhere (e.g. intflash fully erased), incorrectly reporting a
  // completely blank device as "patched" and skipping straight to Guided Setup's Install
  // Retro-Go step — which would fail, since that step assumes bank 1 already has a working
  // patched-OFW dual-boot chainloader in place.
  const isPatched = $derived(!!device.deviceClass?.ofw?.patched && hasAssets);

  const isInstalled = $derived(
    device.deviceClass 
      ? device.deviceClass.kind === "retrogo-sd" || device.deviceClass.kind === "retrogo-old" 
      : false
  );

  const isBroken = $derived(
    device.deviceClass?.ofw?.patched === true && !hasAssets
  );

  // Step 1: Backup & Patch
  // Manual escape hatch: detection can be wrong (or the user knows better) — lets them
  // bypass the "Backup & Patch" gate and proceed straight to step 2, same idea as step 2's
  // "Reinstall" button being a subtle secondary action next to the primary state.
  let step1Skipped = $state(false);
  let step1Active = $derived(!isPatched && !step1Skipped);
  let step1Done = $derived(isPatched || step1Skipped);

  function openStep1() {
    void installProgress.run({
      title: isBroken ? locale.t.wizard.step1.titlePatch : locale.t.wizard.step1.titleBackupAndPatch,
      body: isBroken
        ? locale.t.wizard.step1.bodyBroken
        : locale.t.wizard.step1.bodyNormal,
      confirmText: isBroken ? locale.t.wizard.step1.confirmPatch : locale.t.wizard.step1.confirmSelectFolderAndStart,
      phases: step1Phases,
      exec: runStep1,
    });
  }

  const step1Phases: PhaseDef[] = [
    { id: "locate-backup", label: locale.t.wizard.step1.phaseLocateBackup },
    { id: "read-device", label: locale.t.wizard.step1.phaseReadDevice },
    { id: "patch", label: locale.t.wizard.step1.phasePatch },
    { id: "flash-internal", label: locale.t.wizard.step1.phaseFlashInternal },
    { id: "flash-external", label: locale.t.wizard.step1.phaseFlashExternal },
    { id: "rescan", label: locale.t.wizard.step1.phaseRescan },
  ];
  // patchAndFlash (engine/ofw.ts) does its patch work then reports two flash sub-phases via
  // its own progressReport(sub.label) — "internal → bank 1" and "external → bank 0" — which
  // this file already maps to the flash-internal/flash-external phases below. There's no
  // further real internal decomposition surfaced by patchAndFlash for the "patch" phase itself
  // (it's genuinely one atomic firmware-patch operation from this caller's vantage point), so
  // "patch" is left without substeps.

  async function runStep1(report: PhaseReporter) {
    report.start("locate-backup");
    const dir = await pickBackupFolder();
    if (!dir) {
      report.finish("locate-backup");
      return;
    }

    const found = await scanBackupFolder(dir);
    const chosen = defaultBackup(found, device.model);

    const flasher = await device.ensureStub();
    let targetModel = chosen?.model;
    let targetInt: Uint8Array;
    let targetExt: Uint8Array;

    if (chosen && chosen.internalOk && chosen.externalOk) {
      targetInt = chosen.internal;
      targetExt = chosen.external;
      report.log("locate-backup", locale.t.wizard.step1.logReusingBackup(chosen.model));
      report.finish("locate-backup");
      report.finish("read-device"); // nothing to read — using the existing backup (Branch A)
    } else {
      if (isBroken) {
        report.log("locate-backup", locale.t.wizard.step1.logNoBackupBroken);
        report.finish("locate-backup");
        throw new Error(locale.t.wizard.step1.errMustSelectBackup);
      }

      let extSize = device.extFlashBytes;
      const actualModel = device.deviceClass?.model ?? device.model;
      if (actualModel === "mario") extSize = 1048576;
      else if (actualModel === "zelda") extSize = 4194304;
      report.log("locate-backup", locale.t.wizard.step1.logNoBackupReadingDevice(actualModel));
      report.finish("locate-backup");

      report.start("read-device");
      const dumps = await withTimeout(
        (progressReport) => dumpBackup(flasher, extSize, progressReport),
        30000,
        (d, t, label) => {
          report.progress("read-device", d, t, locale.t.wizard.step1.logBackingUp(MiB(d), MiB(t)));
        }
      );

      const det = await detectDevice(dumps.internal, dumps.external);
      if (!det.model || !det.internalOk) {
        throw new Error(locale.t.wizard.step1.errDumpedFirmwareMismatch);
      }
      report.log("read-device", locale.t.wizard.step1.logDetectedModel(det.model));

      report.log("read-device", locale.t.wizard.step1.logSavingBackup);
      await writeBackup(dir, det.model, dumps);
      report.finish("read-device");

      targetModel = det.model;
      targetInt = dumps.internal;
      targetExt = dumps.external;
    }

    report.start("patch");
    report.log("patch", `Patching firmware for model: ${targetModel}.`);
    let flashInternalStarted = false;
    let flashExternalStarted = false;
    // Suspend the liveness poll for the whole patch+flash, exactly as step 2 below and every
    // other flash-writing flow does. Without this the poll keeps issuing its own SWD traffic
    // in the gaps BETWEEN transport ops (it only backs off while transport.busy()) — the
    // ensureStub() settle, the post-flash settle, and above all the internal→external
    // handover, where the flow re-enters ensureStub() and a poll-perturbed
    // stubAlive()/contextsFree() probe can wrongly conclude the stub is dead and trigger a
    // bootStub() reset. That reset lands on a device whose bank 1 was JUST overwritten with
    // the patched dual-boot image, so it comes back running that instead of a clean stub and
    // re-attach is unreliable — the "works on the third try" OFW flash. This was the only
    // flash-writing path missing the suspend.
    device.suspendPoll();
    try {
      await withTimeout(
        (progressReport, signal) => patchAndFlash(
          // Silent, but still forwards flashImage's own retry-driven `force` flag (true only on
          // an actual stall-retry, false on a normal/first attempt) — the user already confirmed
          // entering Recovery Mode via the earlier unforced ensureStub() call above, so this must
          // never re-prompt for that same already-granted consent, but it must still reuse the
          // live cached stub whenever possible (this getter is invoked once per chunk) rather
          // than resetting the device on every single call — hardcoding force=true here
          // previously caused the device to reset repeatedly mid-flash (see
          // docs/AUDIT_NOTES.md item #19's follow-up fix).
          (force) => device.ensureStub(undefined, force, true), targetModel!, targetInt, targetExt,
          { bootloader: true },
          progressReport as any,
          signal,
          device.extFlashBytes
        ),
        120000,
        (d, t, sub) => {
          // "bootloader → bank 1" shares the internal phase — both write bank 1.
        if (sub?.label.endsWith("bank 1")) {
            if (!flashInternalStarted) {
              flashInternalStarted = true;
              report.finish("patch");
              report.start("flash-internal");
            }
            report.progress("flash-internal", sub.value, sub.max, sub.label);
          } else if (sub?.label === "external → bank 0") {
            if (!flashExternalStarted) {
              flashExternalStarted = true;
              if (flashInternalStarted) report.finish("flash-internal");
              report.start("flash-external");
            }
            report.progress("flash-external", sub.value, sub.max, sub.label);
          }
        }
      );
    } finally {
      device.resumePoll();
    }
    if (flashInternalStarted) report.finish("flash-internal");
    if (flashExternalStarted) report.finish("flash-external");

    report.start("rescan");
    report.log("rescan", locale.t.wizard.common.rescanningDeviceGeometry);
    await device.runScan();
    report.finish("rescan");
  }

  function withTimeout<T>(
    runFn: (report: (...args: any[]) => void, signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    onProgressUpdate: (...args: any[]) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout>;
      const controller = new AbortController();
      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(locale.t.wizard.common.errOperationTimedOut));
        }, timeoutMs);
      };

      resetTimeout();
      
      const wrappedReport = (...args: any[]) => {
        resetTimeout();
        onProgressUpdate(...args);
      };
      
      runFn(wrappedReport, controller.signal).then(
        (val) => {
          clearTimeout(timeoutId);
          resolve(val);
        },
        (err) => {
          clearTimeout(timeoutId);
          reject(err);
        }
      );
    });
  }

  // Step 2: Install Retro-Go
  let step2Active = $derived(step1Done && !isInstalled);
  let step2Done = $derived(isInstalled);

  let latestVersion = $state<string | null>(null);
  $effect(() => {
    listVersions().then((v) => {
      if (v.length > 0) latestVersion = v[0].tag;
    }).catch(() => {});
  });

  
  function cleanTag(v: string | null | undefined) {
    if (!v) return "";
    const match = v.match(/^(v\d+\.\d+\.\d+).*?(-[0-9]+-g[0-9a-f]+)$/);
    if (match) return match[1] + match[2];
    return v;
  }
  function parseSha(v: string | null | undefined) {
    if (!v) return null;
    const m = v.match(/g?([0-9a-f]{7})[0-9a-f]*$/);
    return m ? m[1] : null;
  }

  const retroGoBank = $derived(device.banks.find((b) => b.retroGoVersion));
  const installedVersion = $derived(retroGoBank?.retroGoVersion);
  const installedSha = $derived(parseSha(installedVersion));
  const latestSha = $derived(parseSha(latestVersion));
  const hasUpdate = $derived(installedSha !== null && latestSha !== null && installedSha !== latestSha);

  // Reinstall (same version already installed, flash mode only — SD mode has its own
  // separate sync/migrate concept elsewhere): offer to migrate existing games/saves instead
  // of always wiping, defaulted on ("assume the user wants to keep what's there"). The
  // checkboxes live INSIDE the confirm modal itself (installProgress.run's `checkboxes`),
  // not on the wizard card — runStep2 reads their live values via installProgress.checkboxValues.
  const isReinstall = $derived(step2Done && !hasUpdate && device.targetMedia === "flash");
  // Migrate is offered whenever something is already installed on flash — reinstalling the
  // same version OR upgrading to a new one. It used to be gated on isReinstall alone, which
  // meant clicking "Upgrade" (hasUpdate true) always silently wiped games/saves with no
  // option to preserve them, contrary to this app's documented upgrade-migration behavior.
  const canMigrate = $derived(step2Done && device.targetMedia === "flash");

  // SD mode + a real folder picker (i.e. not Firefox, which has no File System Access API and
  // can't produce a writable directory handle) requires the SAME SD-card folder the ROMs tab
  // uses (device.sdHandle) to be picked BEFORE Install can proceed — reuses
  // FolderGateModal.svelte's exact picker (romScan.ts's pickSdCardFolder) so the user is never
  // asked twice. On Firefox this gate is skipped entirely; runStep2's existing SD-sync fallback
  // already offers a ZIP download of the cores at the end when device.sdHandle is unset.
  function openStep2() {
    void installProgress.run({
      title: locale.t.wizard.step2.title,
      body: canMigrate
        ? isReinstall
          ? locale.t.wizard.step2.bodyReinstall
          : locale.t.wizard.step2.bodyUpgrade(cleanTag(latestVersion))
        : locale.t.wizard.step2.bodyEraseWarning,
      danger: true,
      confirmText: locale.t.wizard.step2.confirmInstall,
      phases: step2Phases,
      checkboxes: canMigrate
        ? [
            { id: "migrateGames", label: locale.t.wizard.step2.checkboxMigrateGames, default: true },
            { id: "migrateSaves", label: locale.t.wizard.step2.checkboxMigrateSaves, default: true },
          ]
        : [],
      confirmGate:
        device.targetMedia === "sd" && nativeFolderPickerSupported()
          ? {
              label: locale.t.wizard.step2.confirmGateSelectSdCard,
              ready: () => !!device.sdHandle,
              onClick: pickSdCardFolder,
            }
          : undefined,
      exec: runStep2,
    });
  }

  // Friendly, user-facing names for the flash regions — end-users don't care about the
  // filesystem name, so drop the FrogFS/LittleFS technical suffix entirely (owner request).
  const REGION_LABELS = $derived<Record<FlashRegion, string>>({
    intflash: locale.t.wizard.step2.regionInternalFirmware,
    frogfs: locale.t.wizard.step2.regionGamesBiosLanguages,
    littlefs: locale.t.wizard.step2.regionEmulatorsSaves,
  });
  const flashRegionsForPhase = $derived<readonly FlashRegion[]>(
    device.targetMedia === "sd" ? ["intflash"] : ["intflash", "frogfs", "littlefs"],
  );

  const step2Phases = $derived<PhaseDef[]>([
    ...(canMigrate
      ? [
          {
            id: "migrate-scan",
            label: locale.t.wizard.step2.phaseReadExistingState,
            substeps: [
              { id: "frogfs-state", label: locale.t.wizard.step2.subReadPreviousGameState },
              { id: "lfs-extract", label: locale.t.wizard.step2.subExtractEmulatorsSaves },
              { id: "games-migrate", label: locale.t.wizard.step2.subMigrateInstalledGames },
            ],
          },
        ]
      : []),
    { id: "download", label: locale.t.wizard.step2.phaseDownloadFirmware },
    // SD mode's build phase does NOT build a FrogFS/LittleFS image at all (that content lives
    // on the SD card itself, gathered later in the "sd-sync" phase) — it only patches the
    // prebuilt SD blob's round-robin ROM-cache reserved-offset boundary, so it gets exactly
    // one real sub-step, not the 3 Flash-mode ones (which would be pure fiction here).
    device.targetMedia === "sd"
      ? {
          id: "build",
          label: locale.t.wizard.step2.phasePrepareInstallImage,
          substeps: [{ id: "sdcache", label: locale.t.wizard.step2.subSetSdCacheBoundary }],
        }
      : {
          id: "build",
          label: locale.t.wizard.step2.phaseBuildInstallImage,
          substeps: [
            { id: "frogfs", label: locale.t.wizard.step2.subBuildGamesBiosLanguages },
            { id: "littlefs", label: locale.t.wizard.step2.subBuildEmulatorsSaves },
            { id: "superblock", label: locale.t.wizard.step2.subPatchSuperblock },
          ],
        },
    {
      id: "flash",
      label: locale.t.wizard.step2.phaseFlashingRetroGo,
      // "Flashing Retro-Go" already names the intflash write itself, so an "Internal firmware"
      // sub-step here would be tautological — only list the frogfs/littlefs regions (owner's
      // exact example: "● Games, BIOS, Languages" / "▸ Emulators, Saves", no 3rd intflash line).
      substeps: flashRegionsForPhase.filter((r) => r !== "intflash").map((r) => ({ id: r, label: REGION_LABELS[r] })),
    },
    { id: "rescan", label: locale.t.wizard.step2.phaseRescan },
    ...(device.targetMedia === "sd" ? [{ id: "sd-sync", label: locale.t.wizard.step2.phaseSyncSdCores }] : []),
  ]);

  async function runStep2(report: PhaseReporter) {
    const blockSize = device.info?.minEraseSizeBytes ?? 4096;
    const frogfsPart = device.partitions.find((p) => p.fs === "frogfs");
    const reservedEnd = device.partitions
      .filter((p) => p.fs !== "littlefs" && p.fs !== "frogfs")
      .reduce((m, p) => Math.max(m, p.offset + p.size), 0);
    const reservedEndAligned = Math.ceil(reservedEnd / blockSize) * blockSize;
    const reservedOffset = frogfsPart && frogfsPart.offset % blockSize === 0
      ? frogfsPart.offset
      : reservedEndAligned;

    const userRoms = new Map<string, Uint8Array>();
    const lfsData = new Map<string, Uint8Array>();
    let frogfsState;

    // Read live from the confirm modal's own checkboxes (rendered inside InstallProgressModal
    // itself, not on this card) rather than local component state.
    const migrateGames = installProgress.checkboxValues.migrateGames ?? false;
    const migrateSaves = installProgress.checkboxValues.migrateSaves ?? false;

    if (canMigrate) {
      report.log(
        "download",
        locale.t.wizard.step2.logMigrateSummary(
          isReinstall ? locale.t.wizard.step2.logMigrateKindReinstall : locale.t.wizard.step2.logMigrateKindUpgrade,
          migrateGames,
          migrateSaves,
        ),
      );
    }

    if (canMigrate && (migrateGames || migrateSaves)) {
      report.start("migrate-scan");
      const flasher = await device.ensureStub();
      const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);

      if (migrateSaves) {
        report.subStart("migrate-scan", "frogfs-state");
        try {
          frogfsState = await readFrogfsState(read, reservedOffset, device.extFlashBytes - reservedOffset);
          report.log("migrate-scan", locale.t.wizard.step2.logReadPreviousGameState, "frogfs-state");
        } catch {
          report.log("migrate-scan", locale.t.wizard.step2.logCouldNotReadPreviousGameState, "frogfs-state");
        }
        report.subFinish("migrate-scan", "frogfs-state");

        report.subStart("migrate-scan", "lfs-extract");
        try {
          const lfsTree = await ensureLfsTree();
          async function extractLfs(node: LittlefsTreeNode, pathPrefix: string) {
            for (const child of node.children || []) {
              const fullPath = pathPrefix + child.name;
              if (child.isDirectory) await extractLfs(child, fullPath + "/");
              else lfsData.set(fullPath, await readLfsFile(fullPath));
            }
          }
          const dataDir = lfsTree.children?.find((c) => c.name === "data" && c.isDirectory);
          if (dataDir) await extractLfs(dataDir, "data/");
          const configFile = lfsTree.children?.find((c) => c.name === "CONFIG" && !c.isDirectory);
          if (configFile) lfsData.set("CONFIG", await readLfsFile("CONFIG"));
          report.log("migrate-scan", locale.t.wizard.step2.logExtractedSavesSettings(lfsData.size), "lfs-extract");
        } catch {
          report.log("migrate-scan", locale.t.wizard.step2.logCouldNotExtractSavesSettings, "lfs-extract");
        }
        report.subFinish("migrate-scan", "lfs-extract");
      } else {
        report.subFinish("migrate-scan", "frogfs-state");
        report.subFinish("migrate-scan", "lfs-extract");
      }

      report.subStart("migrate-scan", "games-migrate");
      if (migrateGames && device.installedGames.length > 0) {
        for (const g of device.installedGames) {
          const path = `${g.system}/${g.name}`;
          if (!userRoms.has(path)) userRoms.set(path, await readGameData(read, reservedOffset, g));
        }
        report.log("migrate-scan", locale.t.wizard.step2.logMigratedGames(device.installedGames.length), "games-migrate");
      } else {
        report.log("migrate-scan", locale.t.wizard.step2.logSkippingGameMigration, "games-migrate");
      }
      report.subFinish("migrate-scan", "games-migrate");
      report.finish("migrate-scan");
    }

    report.start("download");
    const versions = await listVersions();
    report.log("download", locale.t.wizard.step2.logTargetVersion(versions[0]?.tag ?? locale.t.wizard.step2.logNoVersion));
    const bundle = await fetchBundle(versions[0].tag);
    const bundleBytes = bundle.blobs[1].length + bundle.blobs[2].length;
    report.log("download", locale.t.wizard.step2.logBundleDownloaded((bundleBytes / 1048576).toFixed(2)));
    report.finish("download");

    report.start("build");
    report.subStart("build", device.targetMedia === "sd" ? "sdcache" : "frogfs");
    const install = await buildFlashInstall({
      bundle,
      bank: 2,
      extflashSize: device.extFlashBytes,
      blockSize,
      reservedOffset,
      userRoms,
      frogfsState,
      lfsData,
      littlefsLength: 8 * 1024 * 1024,
      sdCard: device.targetMedia === "sd",
      onStep: (step) => {
        if (step === "frogfs") {
          report.log("build", locale.t.wizard.step2.logGamesBiosLanguagesBuilt, "frogfs");
          report.subFinish("build", "frogfs");
          report.subStart("build", "littlefs");
        } else if (step === "littlefs") {
          report.log("build", locale.t.wizard.step2.logEmulatorsSavesBuilt, "littlefs");
          report.subFinish("build", "littlefs");
          report.subStart("build", "superblock");
        } else if (step === "superblock") {
          report.log("build", locale.t.wizard.step2.logSuperblockPatched, "superblock");
          report.subFinish("build", "superblock");
        } else if (step === "sdcache") {
          report.log(
            "build",
            locale.t.wizard.step2.logSdCacheBoundarySet(reservedOffset),
            "sdcache",
          );
          report.subFinish("build", "sdcache");
        }
      },
    });
    report.finish("build");

    // Stall mitigation (hypothesis, NOT proven — see CLAUDE.md / plan notes): give the
    // link a beat + a liveness ping before the first flash write after the CPU/WASM-heavy
    // build above. Mirrors the existing 500ms post-flash settle in engine/flasher.ts;
    // does not touch the flashImage() 120s stall watchdog itself. Deliberately NOT a visible
    // phase — an internal mitigation detail, not a user-facing checklist step.
    report.log("flash", locale.t.wizard.step2.logConfirmingLinkResponsive);
    await new Promise((r) => setTimeout(r, 500));
    if (device.transport) {
      await raceWithFallback(isStubAlive(device.transport), 2500, false);
    }

    const flasher = await device.ensureStub();
    report.start("flash");
    const regions = flashRegionsForPhase;

    device.suspendPoll();
    try {
      await withTimeout(
        // Silent, but forwards flashImage's own retry-driven `force` flag — consent already
        // granted via the unforced ensureStub() call above; any mid-flash reboot needed to
        // recover from a stall must never re-prompt, but this is invoked per chunk so it must
        // still reuse the live cached stub whenever possible rather than resetting the device
        // on every call.
        (progressReport) =>
          flashInstallToDevice(
            (force) => device.ensureStub(undefined, force, true),
            install,
            progressReport as any,
            dbgLog("flash", (m) => report.log("flash", m)),
            regions,
            (region, event) => {
              if (event === "start") report.subStart("flash", region);
              else report.subFinish("flash", region);
            },
          ),
        // Matches the sibling withTimeout call above (already bumped to 120000) and the
        // flasher's own internal no-progress watchdog — this was left at 30000 and would have
        // fired BEFORE the inner watchdog ever got a chance, on any transfer slower than 30s.
        120000,
        (phase, d, t) => {
          report.progress("flash", d, t, REGION_LABELS[phase as FlashRegion], phase);
        }
      );
    } finally {
      device.resumePoll();
    }
    report.finish("flash");

    report.start("rescan");
    await device.runScan();
    report.finish("rescan");

    if (device.targetMedia === "sd") {
      report.start("sd-sync");
      report.log("sd-sync", locale.t.wizard.step2.logSdSyncStarting);
      // Keyed off the bank we just installed: SD cores call back into firmware at
      // bank-specific absolute addresses, so the tree must match `install.bank`.
      const sdTree = bundle.contentFor(install.bank, true);
      report.log("sd-sync", locale.t.wizard.step2.logSdSyncFoundItems(sdTree.size));
      if (device.sdHandle) {
        let totalFiles = sdTree.size;
        let doneFiles = 0;
        for (const [path, data] of sdTree.entries()) {
          report.log("sd-sync", locale.t.wizard.step2.logSdSyncCopyingFile(path));
          await saveFileToDirOrDownload(device.sdHandle, path, data);
          doneFiles++;
          report.progress("sd-sync", doneFiles, totalFiles, locale.t.wizard.step2.progressFilesLabel(doneFiles, totalFiles));
        }
      } else {
        report.log("sd-sync", locale.t.wizard.step2.logSdSyncGeneratingZip);
        const zip = new JSZip();
        for (const [path, data] of sdTree.entries()) {
          zip.file(path, data);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        download(locale.t.wizard.step2.sdSyncZipFilename, blob);
      }
      report.finish("sd-sync");
    }
  }

  // Step 3: Install ROMs
  let step3Active = $derived(isInstalled);
</script>

<div class="wizard-container">
  <div class="wizard-step" class:active={step1Active} class:done={step1Done}>
    <div class="step-num">1</div>
    <div class="step-content">
      <h3>{locale.t.wizard.step1.heading(isBroken)}</h3>
      <p>{locale.t.wizard.step1.body(isBroken)}</p>
      {#if step1Done}
        <Button variant="default" disabled>{step1Skipped && !isPatched ? locale.t.wizard.step1.skipped : locale.t.wizard.step1.patched}</Button>
      {:else}
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <Button variant="action" disabled={!step1Active} onclick={openStep1}>
            {locale.t.wizard.step1.buttonAction(isBroken)}
          </Button>
          <Button variant="quiet" onclick={() => (step1Skipped = true)}>{locale.t.wizard.step1.skipEllipsis}</Button>
        </div>
      {/if}
    </div>
  </div>

  <div class="wizard-step" class:active={step2Active} class:done={step2Done}>
    <div class="step-num">2</div>
    <div class="step-content">
      <h3>{locale.t.wizard.step2.title}</h3>
      <p>{locale.t.wizard.step2.body}</p>
      {#if step2Done}
        {#if hasUpdate}
          <Button variant="action" onclick={openStep2}>
            {locale.t.wizard.step2.upgradeButtonLabel(cleanTag(latestVersion))}
          </Button>
        {:else}
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <Button variant="default" disabled>{locale.t.wizard.step2.installedLabel}</Button>
            <Button variant="quiet" onclick={openStep2}>{locale.t.wizard.step2.reinstallButtonLabel}</Button>
          </div>
        {/if}
      {:else}
        <Button variant="action" disabled={!step2Active} onclick={openStep2}>
          {locale.t.wizard.step2.installButtonLabel}
        </Button>
      {/if}
    </div>
  </div>

  <div class="wizard-step" class:active={step3Active}>
    <div class="step-num">3</div>
    <div class="step-content">
      <h3>{locale.t.wizard.step3.title}</h3>
      <p>{locale.t.wizard.step3.body}</p>
      <Button variant="action" disabled={!step3Active} onclick={() => onComplete?.()}>{locale.t.wizard.step3.continueButtonLabel}</Button>
    </div>
  </div>
</div>

<style>
  .wizard-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 2.5rem 2rem;
    background: var(--surface);
    border-radius: var(--r-card);
    border: 1px solid var(--surface-sunk);
    max-width: 460px;
    margin: 4rem auto;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05);
  }
  .wizard-step {
    display: flex;
    gap: 1rem;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  .wizard-step.active, .wizard-step.done {
    opacity: 1;
  }
  .step-num {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--surface-sunk);
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    flex-shrink: 0;
  }
  .wizard-step.active .step-num {
    background: var(--model-accent);
    color: white;
  }
  .wizard-step.done .step-num {
    background: var(--zelda-green);
    color: white;
  }
  .step-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .step-content h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--ink);
  }
  .step-content p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }

</style>
