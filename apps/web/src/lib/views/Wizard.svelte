<script lang="ts">
  import { untrack } from "svelte";
  import { device, modelLabel } from "../device.svelte.js";
  import { backupPresence } from "../backupPresence.svelte.js";
  import Button from "../ui/Button.svelte";
  import AddSourcesModal from "../ui/AddSourcesModal.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { msg, errText, sumBytes } from "../logEntry.js";
  import { locale } from "../i18n/locale.svelte.js";

  import {
    pickBackupFolder, dumpBackup, writeBackup, patchAndFlash, detectDevice,
    scanBackupFolder, defaultBackup, restoreStock, type FoundBackup, type BackupDir
  } from "../engine/ofw.js";
  import { evaluateRestore } from "../engine/restoreGuards.js";
  import { buildFlashInstall, flashInstallToDevice, type FlashRegion } from "../engine/flashInstall.js";
  import { listVersions, refreshVersions, fetchBundle, type FirmwareVersion } from "../artifacts.js";
  import { versionRelation, versionActionFace } from "../firmwareDist/compare.js";
  import { curatedProjects } from "../firmwareDist/curated.js";
  import { dbgLog } from "../debug.js";
  import { isStubAlive, dumpRegion } from "../engine/flasher.js";
  import { raceWithFallback } from "../engine/timeout.js";
  import { saveFileToDirOrDownload, nativeFolderPickerSupported, pickSdCardFolder } from "../romScan.js";
  import { download } from "../util.js";
  import { hex } from "../advanced/addr.js";
  import { readFrogfsState } from "../engine/fsscan.js";
  import { scanReservedOffset, defaultLittlefsLength } from "../flashLayout.js";
  import { readGameData } from "../engine/frogfsDevice.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import JSZip from "jszip";
  import logoRgo from "../../assets/logo-rgo.png";
  import logoGnw from "../../assets/logo-gnw-badge.svg";
  import {
    cards as cardsFor,
    floorNote as floorNoteFor,
    canRetroGo as planCanRetroGo,
    canDualBoot as planCanDualBoot,
    spineFor,
    needsBackupStep,
    type ChooserCard,
    type SpineId,
  } from "./chooserPlan.js";

  let {
    onComplete,
    onSources,
  }: {
    onComplete?: () => void;
    /**
     * Leave the wizard for the full Sources tab. No longer what the spine's "Add Sources"
     * button does — that opens AddSourcesModal, which handles the common case in place; this
     * is the modal's way out for everything else.
     */
    onSources?: () => void;
  } = $props();

  /** The "Add Software Sources" spine step's modal (ModalSources artboard). */
  let sourcesModalOpen = $state(false);

  /**
   * The "Add Software Sources" step is satisfied by the CURATED LIST having been pulled, not
   * by the user adding a source: the app already lists ~22 curated cores/homebrew, so the
   * button is the route for a custom addition, not the thing that completes the step.
   *
   * Three states, and `false` covers two of them: not yet attempted / in flight, and failed.
   * Only a resolved walk that actually yielded entries flips it -- `curatedProjects()`
   * resolves `null` when the release publishes no list, which is a successful fetch of
   * nothing and adds no sources.
   *
   * `curatedProjects()` is the session memo (`firmwareDist/curated.ts`) that
   * `sources/store.svelte.ts` already drives on startup, so this reads that one walk's
   * outcome rather than issuing a request of its own.
   */
  let curatedReady = $state(false);
  $effect(() => {
    let live = true;
    void curatedProjects().then(
      (list) => { if (live) curatedReady = !!list && list.length > 0; },
      () => { if (live) curatedReady = false; },
    );
    return () => { live = false; };
  });

  // ── Step 1: "What do you want on the device?" ─────────────────────────────
  // The whole view is a two-step wizard: pick an intent, then walk a spine
  // specialised to that intent. `path === null` IS step 1.
  type WizardPath = "dual" | "rgo" | "stock";
  let path = $state<WizardPath | null>(null);

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

  // ── Device-state predicates that gate the chooser and the spine ───────────
  // "Unpatched stock firmware is on the device" is exactly classify.ts's `stock` kind: it is
  // returned only when bank 1 holds an OFW image with `patched === false` (see
  // engine/classify.ts's `isPristineStock`). Anything else in bank 1 — a patched OFW, a
  // Retro-Go app, an unrecognised app, an empty/locked bank — falls through to the other
  // kinds, which is precisely the spec's "treat the user as returning".
  const isStock = $derived(device.deviceClass?.kind === "stock");

  // A LOCKED DEVICE GETS THE SAME CHOOSER AS ANY OTHER, and this is the owner's rule rather
  // than an omission: "WE DON'T CARE! We unlock the device if it is locked! The user is not
  // explicitly prompted. Unlocking is an inherent part of the Backup phase."
  //
  // That is the rule `engine/unlockGate.ts` already implements and already quotes him on --
  // "the device should be unlocked if they're using this tool to change anything on the
  // device. It should just automatically happen." Every write flow calls
  // `device.ensureUnlocked()` (here at the patch step and again before the step 2 flash), and
  // it either returns or throws. There is no opt-in, no prompt for the ordinary case, and no
  // "unlock first, then come back" dead end.
  //
  // WHAT THIS BRANCH USED TO DO, and why it was wrong twice over. It replaced the whole card
  // region with a wall. Its first justification was that the app could not unlock at all,
  // citing `flasher.unlock()` as `notImplemented` -- that was a misreading of the package:
  // `unlock()` is real (`packages/gnw-flasher/src/index.ts:1237`) and it is `lock()` at :1269
  // that is the deliberate stub. Its second justification was that a locked device cannot be
  // read, so no backup can be taken and every path is built on one. True, and it is exactly
  // why the Backup phase carries the unlock rather than why the chooser should refuse: the
  // gate asks for confirmation there, once, at the only moment the loss is real.
  //
  // So there is deliberately no `isLocked` here. `kind === "locked"` still reaches the gate,
  // which is the one place that acts on it.

  // ── External-flash floors (hard hardware limits, not preferences) ──────────
  // Owner's rule: below 8 MB the chip is not fit for modern Retro-Go, and below 16 MB it is
  // not fit for dual boot. Guided Setup does not offer what the hardware cannot carry — under
  // 8 MB the ONLY thing it offers is returning to stock. Anyone who wants to make Retro-Go run
  // on a smaller chip does it from the Advanced tab, without the training wheels.
  //
  // Unknown size does NOT gate: `extSizeMB` needs the stub to have read the chip, so it is null
  // before a scan completes. Hiding choices on "we have not looked yet" would be a worse lie
  // than showing one the device turns out not to support.
  // One definition, in `chooserPlan.ts`, so the matrix can be walked by a suite rather than
  // read off an `{#if}` ladder. The floors and the null-is-permissive rule live there.
  const extMB = $derived(device.extSizeMB);
  const canRetroGo = $derived(planCanRetroGo(extMB));
  const canDualBoot = $derived(planCanDualBoot(extMB));
  /** The cards, in draw order. EMPTY on an unmodified device: see `chooserPlan.ts`. */
  const chooserCards = $derived(cardsFor({ extMB, isStock }));
  const chooserFloorNote = $derived(floorNoteFor(extMB));

  // "A backup of THIS unit's stock firmware exists on the user's disk" — a durable fact, so it
  // lives in the device store (localStorage, keyed by the unit's STM32 UID) rather than the
  // session `$state` it used to be, which forgot across every reload.
  const backupTaken = $derived(device.backupTaken);

  // Step 1: Backup & Patch
  // Manual escape hatch: detection can be wrong (or the user knows better) — lets them
  // bypass the "Backup & Patch" gate and proceed straight to step 2, same idea as step 2's
  // "Reinstall" button being a subtle secondary action next to the primary state.
  let step1Skipped = $state(false);
  // On the Retro-Go-only path the step is BACKUP ONLY — it never patches, so `isPatched` can
  // never be what completes it; the recorded backup is.
  /**
   * This step is "back up, then patch". On the dual-boot path, a patched OFW in bank 1 is
   * durable device evidence that the patch phase already happened, even when this browser has
   * no remembered backup record. Retro-Go-only still requires the local backup because that
   * path never patches the device.
   *
   * It used to read `isPatched`, which also requires `hasAssets` -- a stock-asset partition
   * still present in extflash. That extra condition belongs to "will the OFW boot", not to
   * "did this step run": a device with a patched OFW, a recorded backup and its assets since
   * overwritten showed the step as not done, with no way to make it done short of re-patching.
   * Reported from the device.
   *
   * The blank-device false positive the `hasAssets` check was guarding against is handled by
   * the patch evidence itself: `deviceClass.ofw.patched` comes from the bank scan, so an erased
   * intflash has no `ofw` at all and cannot report patched. A patched bank-1 image is sufficient
   * evidence for dual boot; requiring a local backup record there made an already-patched
   * Zelda/Mario device look unfinished after a reload or when prepared by another session.
   */
  let step1Done = $derived(
    step1Skipped || (path === "rgo" ? backupTaken : !!device.deviceClass?.ofw?.patched),
  );
  let step1Active = $derived(!step1Done);

  // NOT NEGOTIABLE (device behaviour): the dual-boot patch is COMPUTED from the dumped stock
  // firmware, so there is nothing to patch without the dump — the dual-boot path can never
  // skip or hide the backup step. Only the Retro-Go-only path may offer a skip, and it only
  // needs the step at all while unpatched stock is still sitting in bank 1 with no dump taken.
  //
  // The Retro-Go-only half is LATCHED when the path is chosen, not re-derived live: taking the
  // backup flips `backupTaken`, and a live derivation would delete the step the user is
  // standing on and renumber the spine underneath them. A reload re-evaluates it — which is
  // exactly what persisting `backupTaken` buys.
  let rgoNeedsBackup = $state(false);
  const showBackupStep = $derived(path === "dual" || (path === "rgo" && rgoNeedsBackup));
  const canSkipBackup = $derived(path === "rgo");
  let skipExpanded = $state(false);

  // Dual boot: back up, then patch and flash the result. Unchanged behaviour — and the backup
  // here is NOT optional in any sense: `patchAndFlash` computes the patch FROM the dumped stock
  // image, so a dual-boot run with no dump has nothing to patch.
  function openStep1() {
    void installProgress.run({
      title: isBroken ? locale.t.wizard.step1.titlePatch : locale.t.wizard.step1.titleBackupAndPatch,
      body: isBroken
        ? locale.t.wizard.step1.bodyBroken
        : locale.t.wizard.step1.bodyNormal,
      confirmText: isBroken ? locale.t.wizard.step1.confirmPatch : locale.t.wizard.step1.confirmSelectFolderAndStart,
      phases: step1Phases,
      exec: (report) => runStep1(report, true),
    });
  }

  // Retro-Go only: back up and STOP. Retro-Go is about to overwrite the stock firmware
  // wholesale, so patching it for dual boot would be a full patch plus two flash passes of work
  // thrown away on the very next step, on a device whose owner just said they don't want to
  // dual boot. The dump itself is still worth taking — it's the user's only copy of a firmware
  // they can't legally re-download — so this path offers it, it just never patches.
  function openBackupOnly() {
    void installProgress.run({
      title: locale.t.wizard.step1.titleBackupOnly,
      body: locale.t.wizard.step1.bodyBackupOnly,
      confirmText: locale.t.wizard.step1.confirmSelectFolderAndStart,
      phases: backupOnlyPhases,
      exec: (report) => runStep1(report, false),
    });
  }

  // The backup-only run stops after "read-device", so it advertises only the phases it will
  // actually walk — an unreachable "Patch firmware" row would read as a stall.
  const backupOnlyPhases: PhaseDef[] = [
    { id: "locate-backup", label: locale.t.wizard.step1.phaseLocateBackup },
    { id: "read-device", label: locale.t.wizard.step1.phaseReadDevice },
  ];
  const step1Phases: PhaseDef[] = [
    ...backupOnlyPhases,
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

  /**
   * The single backup entry point, now with the patch made optional.
   *
   * `patch === true` (dual boot) is the original flow verbatim: locate-or-dump the stock
   * firmware, then patch it and flash both banks. `patch === false` (Retro-Go only) runs
   * exactly the same locate-or-dump half and returns — nothing is written to the device.
   *
   * The dump is NOT skippable when `patch` is true: the patch is computed from the dumped
   * image, so there is nothing to patch without it.
   */
  async function runStep1(report: PhaseReporter, patch: boolean) {
    report.start("locate-backup");
    const dir = await pickBackupFolder();
    if (!dir) {
      report.finish("locate-backup");
      return;
    }

    const found = await scanBackupFolder(dir);
    const chosen = defaultBackup(found, device.model);

    const reuseExisting = !!(chosen && chosen.internalOk && chosen.externalOk);
    // Recovery Mode is needed to read the device. On the dual-boot path it is ALSO needed for
    // the flash below, so it stays where it was — before the branch, one unforced (confirming)
    // call that every later getter then reuses silently. Backup-only reusing an on-disk backup
    // touches the device not at all, so it must not demand Recovery Mode for nothing.
    const flasher = patch || !reuseExisting ? await device.ensureStub() : null;
    let targetModel = chosen?.model;
    let targetInt: Uint8Array;
    let targetExt: Uint8Array;

    if (reuseExisting) {
      targetInt = chosen!.internal;
      targetExt = chosen!.external;
      device.markBackupTaken();
      report.log("locate-backup", msg((t) => t.wizard.step1.logReusingBackup, chosen!.model, chosen!.internal.length, chosen!.external.length));
      report.finish("locate-backup");
      report.finish("read-device"); // nothing to read — using the existing backup (Branch A)
    } else {
      if (isBroken) {
        report.log("locate-backup", msg((t) => t.wizard.step1.logNoBackupBroken));
        report.finish("locate-backup");
        throw new Error(locale.t.wizard.step1.errMustSelectBackup);
      }

      let extSize = device.extFlashBytes;
      const actualModel = device.deviceClass?.model ?? device.model;
      if (actualModel === "mario") extSize = 1048576;
      else if (actualModel === "zelda") extSize = 4194304;
      report.log("locate-backup", msg((t) => t.wizard.step1.logNoBackupReadingDevice, actualModel, extSize));
      report.finish("locate-backup");

      report.start("read-device");
      const dumps = await withTimeout(
        (progressReport) => dumpBackup(flasher!, extSize, progressReport),
        30000,
        (d, t, label) => {
          report.progress("read-device", d, t);
        }
      );

      const det = await detectDevice(dumps.internal, dumps.external);
      if (!det.model || !det.internalOk) {
        throw new Error(locale.t.wizard.step1.errDumpedFirmwareMismatch);
      }
      report.log("read-device", msg((t) => t.wizard.step1.logDetectedModel, det.model, dumps.internal.length, dumps.external.length));

      report.log("read-device", msg((t) => t.wizard.step1.logSavingBackup));
      await writeBackup(dir, det.model, dumps);
      report.finish("read-device");

      targetModel = det.model;
      targetInt = dumps.internal;
      targetExt = dumps.external;
      device.markBackupTaken();
    }

    // Retro-Go only: the backup is the whole job. Nothing has been written to the device, and
    // the install step that follows will overwrite the stock firmware anyway — so stop here
    // rather than patching a firmware the user has said they don't want to keep.
    if (!patch) return;

    // Automatic unlock, placed HERE and not at the top of this function. Everything above is
    // the backup half -- Branch B literally dumps the stock firmware off the device -- and
    // unlocking mass-erases both flashes, so unlocking first would destroy the very image
    // this flow just read. Backup, THEN unlock, THEN write (engine/unlockGate.ts).
    await device.ensureUnlocked();

    report.start("patch");
    report.log("patch", msg((t) => t.officialFirmware.logPatchingModel, targetModel!, targetInt.length, targetExt.length));
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
            report.progress("flash-internal", sub.value, sub.max);
          } else if (sub?.label === "external → bank 0") {
            if (!flashExternalStarted) {
              flashExternalStarted = true;
              if (flashInternalStarted) report.finish("flash-internal");
              report.start("flash-external");
            }
            report.progress("flash-external", sub.value, sub.max);
          }
        }
      );
    } finally {
      device.resumePoll();
    }
    if (flashInternalStarted) report.finish("flash-internal");
    if (flashExternalStarted) report.finish("flash-external");

    report.start("rescan");
    report.log("rescan", msg((t) => t.wizard.common.rescanningDeviceGeometry));
    await device.runScan("guided step");
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
      
      // THE TWO REASONS A FLASH STOPS EARLY, as one signal. `controller` is this helper's own
      // no-progress stall timeout; `installProgress.reporter.signal` is the user pressing Stop
      // in the progress modal. Combining them HERE rather than at each call site is what stops
      // a future call forwarding one and dropping the other -- which would be a Cancel that
      // silently does nothing on that path.
      const signal = AbortSignal.any([controller.signal, installProgress.reporter.signal]);
      runFn(wrappedReport, signal).then(
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

  // ── External-flash layout ─────────────────────────────────────────────────
  // Computed from the probed chip (lib/flashLayout.ts) — no user choice, no hardcoded size.
  const blockSize = $derived(device.info?.minEraseSizeBytes ?? 4096);
  // What this unit already reserves at the bottom. Not a preference — a scan result.
  const chosenReserved = $derived(scanReservedOffset(device.partitions, blockSize));
  // Bytes handed to buildFlashInstall. Null means "let the builder size it" (its own cores +
  // headroom rule) — which is what an unsupported chip geometry, and SD mode, get: SD_CARD=1
  // sets EXTFLASH_TOTAL_LENGTH = 0 and compiles no FrogFS/LittleFS at all, so external flash
  // there is a round-robin ROM cache with no partitions to divide.
  const installLittlefsLength = $derived(
    device.targetMedia === "sd"
      ? null
      : defaultLittlefsLength({
          extflashSize: device.extFlashBytes,
          blockSize,
          reservedOffset: chosenReserved,
        }),
  );

  // Step 2: Install Retro-Go
  let step2Active = $derived(step1Done && !isInstalled);
  let step2Done = $derived(isInstalled);

  // The whole index, not just the newest tag: `versionRelation` orders by POSITION in this
  // published newest-first list (see firmwareDist/compare.ts), so the list itself is the data.
  let versions = $state<FirmwareVersion[]>([]);
  $effect(() => {
    listVersions().then((v) => { versions = v; }).catch(() => {});
  });
  const latestVersion = $derived(versions[0]?.tag ?? null);

  /**
   * Which release the install modal will actually fetch.
   *
   * Null means "whatever is newest", which is the state every device starts in and the one the
   * step's own button describes. It becomes a tag only when the user picks one in the modal's
   * picker, so an empty choice cannot pin the flow to a release that later ages out of the
   * index -- and `selectedTag` below resolves null back to `versions[0]` on every read.
   *
   * Cleared whenever the list itself changes (`doRefreshVersions`), for the same reason
   * RomSection clears its own: a refetch can retire the tag that was chosen, and silently
   * installing a DIFFERENT release than the one on screen is the failure mode worth avoiding.
   */
  let selectedTagUserSet = $state<string | null>(null);
  const selectedTag = $derived(
    selectedTagUserSet !== null && versions.some((v) => v.tag === selectedTagUserSet)
      ? selectedTagUserSet
      : (latestVersion ?? null),
  );
  const selectedGitTag = $derived(versions.find((v) => v.tag === selectedTag)?.gitTag ?? null);

  /**
   * Re-read the published version list without a reload. Same control and same rule as the
   * Advanced tab's version picker (`advanced/RomSection.svelte`): `versions.json` is memoised
   * for the session, so a release published while the app is open is invisible, and here there
   * is not even a picker to hint at it -- the step just says which version it would install.
   *
   * Rate limited by greying out for 10 s, by the owner's instruction. No queueing, no retry.
   */
  let refreshingVersions = $state(false);
  let refreshCooldown = $state(false);
  async function doRefreshVersions(): Promise<void> {
    if (refreshCooldown || refreshingVersions) return;
    refreshingVersions = true;
    refreshCooldown = true;
    setTimeout(() => (refreshCooldown = false), 10000);
    try {
      versions = await refreshVersions();
      // A refetch can retire the tag the user picked. `selectedTag` already falls back to the
      // newest when the choice is no longer in the list, so this only drops the pin -- it exists
      // so a later refresh that brings the tag BACK does not silently re-pin a choice the user
      // has long since stopped seeing.
      if (selectedTagUserSet !== null && !versions.some((v) => v.tag === selectedTagUserSet)) {
        selectedTagUserSet = null;
      }
    } catch {
      // A failed check leaves the list as it was: the step still shows the version it knows.
    } finally {
      refreshingVersions = false;
    }
  }

  
  function cleanTag(v: string | null | undefined) {
    if (!v) return "";
    const match = v.match(/^(v\d+\.\d+\.\d+).*?(-[0-9]+-g[0-9a-f]+)$/);
    if (match) return match[1] + match[2];
    return v;
  }
  const retroGoBank = $derived(device.banks.find((b) => b.retroGoVersion));
  const installedVersion = $derived(retroGoBank?.retroGoVersion);
  // Reinstall vs upgrade. This used to extract a 7-hex sha off the end of both strings, which
  // silently stopped working the day a release was tagged `v2.0.0-rc1` instead of a
  // `git describe` suffix — every device then read as "Reinstall". It is a `gitTag` comparison
  // now (firmwareDist/compare.ts), and ORDERED: only a release the index places ahead of the
  // installed one is an upgrade. An installed version the index cannot place — nothing read off
  // the device, a hand-flashed build, a release aged out of the retained five — is "unknown" and
  // deliberately NOT an upgrade, so the button falls back to the neutral "Reinstall" label
  // rather than promising an upgrade this list cannot support. (No artboard states a
  // "cannot tell" case, so no new string is invented for it.)
  const orderedGitTags = $derived(versions.map((v) => v.gitTag));
  const latestRelation = $derived(versionRelation(installedVersion, versions[0]?.gitTag, orderedGitTags));
  const hasUpdate = $derived(latestRelation === "newer");

  /**
   * Which verb the install modal's confirm button shows, for the release the PICKER has selected
   * rather than for the newest one. `versionActionFace` lives in firmwareDist/compare.ts beside
   * `installTitleState` so this surface and the Advanced rail cannot answer one question two
   * ways -- the defect that put it there in the first place.
   *
   * The step's own button is deliberately NOT keyed to this: it opens the modal, and until the
   * modal is open no version has been picked. It keeps describing the newest release, which is
   * what it would install if the user changed nothing.
   */
  const installFace = $derived(versionActionFace(installedVersion, selectedGitTag, orderedGitTags));
  const confirmFaceLabel = $derived(() => {
    switch (installFace) {
      case "upgrade":
        return locale.t.wizard.step2.confirmUpgrade;
      case "downgrade":
        return locale.t.wizard.step2.confirmDowngrade;
      case "reinstall":
        return locale.t.wizard.step2.reinstallButtonLabel;
      default:
        return locale.t.wizard.step2.confirmInstall;
    }
  });

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
      // A function, not a string: the picker below can change the face while the dialog is open,
      // and a label captured here would freeze at whichever verb was showing when it opened.
      confirmText: () => confirmFaceLabel(),
      phases: step2Phases,
      // THE VERSION IS CHOSEN HERE, not on the step. The user is already deciding what carries
      // over, and which release it carries over TO is the same decision; the step's button is
      // just the door to it. Callbacks rather than values, so a refetch inside the dialog
      // re-renders the list (see VersionPicker in installProgress.svelte.ts).
      versionPicker: {
        label: locale.t.romSection.installVersionLabel,
        options: () => versions.map((v) => ({ value: v.tag, label: cleanTag(v.tag) })),
        selected: () => selectedTag ?? "",
        onSelect: (value) => (selectedTagUserSet = value),
        onRefresh: doRefreshVersions,
        refreshLabel: locale.t.romSection.refreshVersions,
      },
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
    littlefs: locale.t.wizard.step2.regionCoresSaves,
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
              { id: "lfs-extract", label: locale.t.wizard.step2.subExtractCoresSaves },
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
            { id: "littlefs", label: locale.t.wizard.step2.subBuildCoresSaves },
            { id: "superblock", label: locale.t.wizard.step2.subPatchSuperblock },
          ],
        },
    {
      id: "flash",
      label: locale.t.wizard.step2.phaseFlashingRetroGo,
      // "Flashing Retro-Go" already names the intflash write itself, so an "Internal firmware"
      // sub-step here would be tautological — only list the frogfs/littlefs regions (owner's
      // exact example: "● Games, BIOS, Languages" / "▸ Cores, saves", no 3rd intflash line).
      // The intflash write is NOT unreported for it: its bytes go to the PHASE-level counter
      // instead (see runStep2's flash callback), which is what draws the phase row's own
      // percent and bar in docs/design/mockups/GuidedFlashing.dc.html.
      substeps: flashRegionsForPhase.filter((r) => r !== "intflash").map((r) => ({ id: r, label: REGION_LABELS[r] })),
    },
    { id: "rescan", label: locale.t.wizard.step2.phaseRescan },
    ...(device.targetMedia === "sd" ? [{ id: "sd-sync", label: locale.t.wizard.step2.phaseSyncSdCores }] : []),
  ]);

  async function runStep2(report: PhaseReporter) {
    // Both derived from the scan above (see lib/flashLayout.ts): `chosenReserved` is the
    // bottom-reserved size this device already has, and `installLittlefsLength` the computed
    // read-write partition — null only when the chip geometry was not layoutable, in which
    // case buildFlashInstall falls back to its own cores+headroom sizing.
    const reservedOffset = chosenReserved;

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
        msg(
          (t) => t.wizard.step2.logMigrateSummary,
          isReinstall ? msg((t) => t.wizard.step2.logMigrateKindReinstall) : msg((t) => t.wizard.step2.logMigrateKindUpgrade),
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
        const stateWindow = device.extFlashBytes - reservedOffset;
        try {
          frogfsState = await readFrogfsState(read, reservedOffset, stateWindow);
          report.log("migrate-scan", msg((t) => t.wizard.step2.logReadPreviousGameState, hex(reservedOffset), stateWindow), "frogfs-state");
        } catch (e) {
          report.log("migrate-scan", msg((t) => t.wizard.step2.logCouldNotReadPreviousGameState, hex(reservedOffset), stateWindow, errText(e)), "frogfs-state");
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
          report.log("migrate-scan", msg((t) => t.wizard.step2.logExtractedSavesSettings, lfsData.size, sumBytes(lfsData)), "lfs-extract");
        } catch (e) {
          report.log("migrate-scan", msg((t) => t.wizard.step2.logCouldNotExtractSavesSettings, errText(e)), "lfs-extract");
        }
        report.subFinish("migrate-scan", "lfs-extract");
      } else {
        report.subFinish("migrate-scan", "frogfs-state");
        report.subFinish("migrate-scan", "lfs-extract");
      }

      report.subStart("migrate-scan", "games-migrate");
      if (migrateGames && device.installedGames.length > 0) {
        // Can be many MB of SWD reads. Report the real byte counter into the already-declared
        // "games-migrate" sub-step: total = the bytes we will actually read (games already in
        // userRoms are skipped, so they must not inflate the denominator), and `base` carries
        // the completed games so the per-read callback stays monotonic across games.
        const pending = device.installedGames.filter((g) => !userRoms.has(`${g.system}/${g.name}`));
        const totalBytes = pending.reduce((a, g) => a + g.size, 0);
        let base = 0;
        report.progress("migrate-scan", 0, totalBytes, "games-migrate", "bytes");
        const readTracked = (off: number, len: number) =>
          dumpRegion(flasher, 0, off, len, (d) => {
            if (totalBytes > 0)
              report.progress("migrate-scan", Math.min(base + d, totalBytes), totalBytes, "games-migrate", "bytes");
          });
        for (const g of pending) {
          const path = `${g.system}/${g.name}`;
          userRoms.set(path, await readGameData(readTracked, reservedOffset, g));
          base = Math.min(base + g.size, totalBytes);
          report.progress("migrate-scan", base, totalBytes, "games-migrate", "bytes");
        }
        report.log("migrate-scan", msg((t) => t.wizard.step2.logMigratedGames, device.installedGames.length, totalBytes), "games-migrate");
      } else {
        report.log("migrate-scan", msg((t) => t.wizard.step2.logSkippingGameMigration, migrateGames, device.installedGames.length), "games-migrate");
      }
      report.subFinish("migrate-scan", "games-migrate");
      report.finish("migrate-scan");
    }

    report.start("download");
    const published = await listVersions();
    // THE PICKER DECIDES, not the index's head. `selectedTag` resolves to the newest release
    // whenever the user has pinned nothing (and whenever the pin no longer exists), so the
    // default path is unchanged -- but a chosen release is the one that gets fetched, which is
    // the whole of what the modal's picker promises. Falling back to the head here as well keeps
    // an empty index behaving exactly as it did.
    const target = published.find((v) => v.tag === selectedTag) ?? published[0];
    report.log("download", msg((t) => t.wizard.step2.logTargetVersion, target?.tag ?? msg((t) => t.wizard.step2.logNoVersion)));
    // Multi-MB over the network: report the real byte counter at PHASE level, which
    // InstallProgressModal draws unconditionally (a sub-step bar would be hidden while the
    // phase is collapsed). No new copy — the percent/bar are rendered from numbers.
    const bundleT0 = Date.now();
    const bundle = await fetchBundle(target.tag, (d, t) => report.progress("download", d, t, undefined, "bytes"));
    const bundleBytes = bundle.blobs[1].length + bundle.blobs[2].length;
    report.log("download", msg((t) => t.wizard.step2.logBundleDownloaded, target.tag, bundleBytes, Date.now() - bundleT0));
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
      ...(installLittlefsLength !== null ? { littlefsLength: installLittlefsLength } : {}),
      sdCard: device.targetMedia === "sd",
      onStep: (step) => {
        if (step === "frogfs") {
          report.log("build", msg((t) => t.wizard.step2.logGamesBiosLanguagesBuilt), "frogfs");
          report.subFinish("build", "frogfs");
          report.subStart("build", "littlefs");
        } else if (step === "littlefs") {
          report.log("build", msg((t) => t.wizard.step2.logCoresSavesBuilt), "littlefs");
          report.subFinish("build", "littlefs");
          report.subStart("build", "superblock");
        } else if (step === "superblock") {
          report.log("build", msg((t) => t.wizard.step2.logSuperblockPatched), "superblock");
          report.subFinish("build", "superblock");
        } else if (step === "sdcache") {
          report.log(
            "build",
            msg((t) => t.wizard.step2.logSdCacheBoundarySet, reservedOffset),
            "sdcache");
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
    const pingT0 = Date.now();
    await new Promise((r) => setTimeout(r, 500));
    const stubAlive = device.transport
      ? await raceWithFallback(isStubAlive(device.transport), 2500, false)
      : false;
    report.log("flash", msg((t) => t.wizard.step2.logConfirmingLinkResponsive, stubAlive, Date.now() - pingT0));

    // Automatic unlock: a locked device is unlocked before this write, never after it
    // (engine/unlockGate.ts owns the backup-first ordering). No-op when already unlocked.
    await device.ensureUnlocked();
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
        (progressReport, signal) =>
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
            signal,
          ),
        // Matches the sibling withTimeout call above (already bumped to 120000) and the
        // flasher's own internal no-progress watchdog — this was left at 30000 and would have
        // fired BEFORE the inner watchdog ever got a chance, on any transfer slower than 30s.
        120000,
        (phase, d, t) => {
          // intflash has no sub-step row (see step2Phases) — report it at phase level, which
          // the modal draws as the phase's own percent + bar. Every other region reports into
          // its own declared sub-step row.
          const region = phase as FlashRegion;
          report.progress("flash", d, t, region === "intflash" ? undefined : region, "bytes");
        }
      );
    } finally {
      device.resumePoll();
    }
    report.finish("flash");

    report.start("rescan");
    await device.runScan("guided step");
    report.finish("rescan");

    if (device.targetMedia === "sd") {
      report.start("sd-sync");
      report.log("sd-sync", msg((t) => t.wizard.step2.logSdSyncStarting));
      // Keyed off the bank we just installed: SD cores call back into firmware at
      // bank-specific absolute addresses, so the tree must match `install.bank`.
      const sdTree = bundle.contentFor(install.bank, true);
      report.log("sd-sync", msg((t) => t.wizard.step2.logSdSyncFoundItems, sdTree.size, sumBytes(sdTree)));
      if (device.sdHandle) {
        let totalFiles = sdTree.size;
        let doneFiles = 0;
        for (const [path, data] of sdTree.entries()) {
          report.log("sd-sync", msg((t) => t.wizard.step2.logSdSyncCopyingFile, path, data.length));
          await saveFileToDirOrDownload(device.sdHandle, path, data);
          doneFiles++;
          report.progress("sd-sync", doneFiles, totalFiles);
        }
      } else {
        report.log("sd-sync", msg((t) => t.wizard.step2.logSdSyncGeneratingZip, sdTree.size));
        const zip = new JSZip();
        for (const [path, data] of sdTree.entries()) {
          zip.file(path, data);
        }
        // Phase-level, matching the sibling per-file branch above; JSZip's percent is 0..100.
        const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
          report.progress("sd-sync", Math.max(0, Math.min(100, Math.round(meta.percent))), 100);
        });
        download(locale.t.wizard.step2.sdSyncZipFilename, blob);
      }
      report.finish("sd-sync");
    }
  }

  // Step 3: Install ROMs
  let step3Active = $derived(isInstalled);

  // ── "Return to Stock" spine ───────────────────────────────────────────────
  // Two steps, not three: pick a backup, then write it back. "Remove Retro-Go" is NOT a
  // separate step because the restore already is its removal — writing the stock 128 KiB
  // image to bank 1 offset 0 puts the original reset vector back at 0x08000000, which is
  // the thing that makes Retro-Go run. Erasing the rest of a (possibly 16 MB) external chip
  // afterwards would add a long second destructive write pass that changes nothing the stock
  // firmware can observe, so we don't offer it. See engine/ofw.ts's restoreStock() for the
  // full list of what is deliberately left in place.
  let restoreBackup = $state<FoundBackup | null>(null);
  let restoreScanned = $state(false); // a folder has been picked and scanned at least once
  let restoreDone = $state(false);

  async function readRestoreDir(dir: BackupDir) {
    const found = await scanBackupFolder(dir);
    restoreBackup = defaultBackup(found, device.model);
    restoreScanned = true;
  }

  // READ THE REMEMBERED FOLDER FIRST. This step used to go straight to `pickBackupFolder()`, so
  // it was the one surface that ignored the folder every other surface already knows about: the
  // Firmware tab stores it, the Status row reports out of it, and Return to Stock made the user
  // find it again. `backupPresence.adopted()` is the single owner of "which folder", and it is
  // silent -- an already-granted permission only, so arriving at this step never raises a prompt.
  // The button below stays: adopting a folder is not the same as being stuck with it.
  $effect(() => {
    untrack(() => {
      if (restoreScanned) return;
      void backupPresence.adopted().then((dir) => {
        if (dir && !restoreScanned) void readRestoreDir(dir);
      });
    });
  });

  async function pickRestoreBackup() {
    const dir = await pickBackupFolder();
    if (!dir) return; // cancelled — leave any previous selection alone
    await readRestoreDir(dir);
  }

  // The whole admissibility decision lives in engine/restoreGuards.ts (pure, testable —
  // apps/web/test/ofw-restore.mjs covers it). "Usable" is the same bar the Advanced OFW
  // section sets: BOTH dumps hash-match a genuine stock ROM (engine/ofw.ts's DEVICES SHA-1s).
  // A pair that only half-validates is not a partial restore we can complete — it is a
  // corrupt backup, and we refuse it. The wrong-hardware case (a Zelda backup onto Mario
  // hardware, which physically lacks two of the buttons Zelda's firmware needs) is what
  // OfficialFirmwareSection.svelte calls `dangerous`: there it is an expert override behind
  // an acknowledgement checkbox; here it is a hard refusal, since this path exists precisely
  // for the user who does NOT want to reason about that.
  const restoreVerdict = $derived(
    evaluateRestore(
      restoreBackup && {
        model: restoreBackup.model,
        internalOk: restoreBackup.internalOk,
        externalOk: restoreBackup.externalOk,
        externalLength: restoreBackup.external.length,
      },
      { model: device.model, extFlashBytes: device.extFlashBytes },
    ),
  );
  const restoreValid = $derived(restoreVerdict.valid);
  const restoreWrongHw = $derived(restoreVerdict.refusal === "wrong-hardware");
  const restoreTooBig = $derived(restoreVerdict.refusal === "too-big");
  const canRestore = $derived(restoreVerdict.allowed && device.isConnected && !restoreDone);

  // Only the two writes plus a rescan: unlike the patch flow there is nothing to compute, so
  // there is no "patch" phase to advertise.
  const restorePhases: PhaseDef[] = [
    { id: "flash-internal", label: locale.t.wizard.step1.phaseFlashInternal },
    { id: "flash-external", label: locale.t.wizard.step1.phaseFlashExternal },
    { id: "rescan", label: locale.t.wizard.step1.phaseRescan },
  ];

  function openRestore() {
    void installProgress.run({
      title: w.spine.restoreOriginal,
      body: w.restore.modalBody,
      danger: true,
      confirmText: w.restore.confirm,
      phases: restorePhases,
      exec: async (report) => {
        await runRestore(report);
        restoreDone = true;
      },
    });
  }

  async function runRestore(report: PhaseReporter) {
    const backup = restoreBackup!;
    // Re-assert the guards at the point of writing, not just in the disabled state of the
    // button: `device.model` can change under us (a rescan between selecting the folder and
    // confirming the modal), and this write is irreversible.
    if (!restoreValid) throw new Error(w.restore.needBackup);
    if (restoreWrongHw) throw new Error(w.restore.wrongHardware(modelLabel(backup.model), modelLabel(device.model)));
    if (restoreTooBig) {
      throw new Error(w.restore.tooBig(MiB(backup.external.length), MiB(device.extFlashBytes)));
    }

    // One unforced (i.e. confirming) ensureStub for the whole flow — this is where the user
    // grants Recovery Mode. Every getter below it is silent and must never re-prompt for the
    // consent already given here.
    // Automatic unlock: a locked device is unlocked before this write, never after it
    // (engine/unlockGate.ts owns the backup-first ordering). No-op when already unlocked.
    await device.ensureUnlocked();
    await device.ensureStub();

    report.start("flash-internal");
    report.log("flash-internal", msg((t) => t.wizard.restore.logRestoring, backup.model, backup.internal.length, backup.external.length));
    let flashInternalStarted = false;
    let flashExternalStarted = false;
    // Same reason as the patch flow: the liveness poll issues its own SWD traffic in the gaps
    // between transport ops, and a poll-perturbed probe at the internal→external handover can
    // wrongly conclude the stub is dead and reset a device whose bank 1 was just rewritten.
    device.suspendPoll();
    try {
      await withTimeout(
        (progressReport, signal) => restoreStock(
          // Silent always; `force` is forwarded rather than hardcoded so a normal per-chunk
          // call reuses the live cached stub instead of resetting the device every time —
          // only flashImage's own stall-retry passes true (docs/AUDIT_NOTES.md item #19).
          (force) => device.ensureStub(undefined, force, true),
          backup.internal,
          backup.external,
          progressReport as any,
          signal,
          device.extFlashBytes,
        ),
        // Must stay >= engine/flasher.ts's own 120s no-progress watchdog, or this outer guard
        // fires first and false-aborts a slow but healthy transfer.
        120000,
        (d, t, sub) => {
          if (sub?.label === "internal → bank 1") {
            flashInternalStarted = true;
            report.progress("flash-internal", sub.value, sub.max);
          } else if (sub?.label === "external → bank 0") {
            if (!flashExternalStarted) {
              flashExternalStarted = true;
              report.finish("flash-internal");
              report.start("flash-external");
            }
            report.progress("flash-external", sub.value, sub.max);
          }
        },
      );
    } finally {
      device.resumePoll();
    }
    if (flashInternalStarted && !flashExternalStarted) report.finish("flash-internal");
    if (flashExternalStarted) report.finish("flash-external");

    report.start("rescan");
    report.log("rescan", msg((t) => t.wizard.common.rescanningDeviceGeometry));
    await device.runScan("guided step");
    report.finish("rescan");
  }

  // ── Spine composition ─────────────────────────────────────────────────────
  const spine = $derived<SpineId[]>(path === null ? [] : spineFor(path, showBackupStep));

  // ── The preview column ────────────────────────────────────────────────────
  // ChooseAndSee: the choices on the left, the steps they produce on the right, updating live.
  // `previewPath` is a HOVER, never a choice -- `path` stays null until a card is clicked, so
  // nothing here can commit. It falls back to the first card so the column is never empty
  // beside a row of cards that has one.
  //
  // This is the one place `needsBackupStep` IS derived live rather than latched. The latch
  // exists so the spine cannot renumber under a user standing on a step; nobody is standing on
  // a plan they have not chosen, and a preview that ignored `backupTaken` would promise a step
  // the real spine then drops.
  let hoverPath = $state<ChooserCard | null>(null);
  const previewPath = $derived<ChooserCard | null>(
    hoverPath !== null && chooserCards.includes(hoverPath) ? hoverPath : (chooserCards[0] ?? null),
  );
  /**
   * WHICH CARD THE RIGHT-HAND COLUMN BELONGS TO, in either life. Once a path is chosen it is
   * that path, permanently; before then it follows the hover. This is the one thing that
   * decides whether the page is one column or two, so the container's width and the stage's
   * divider both read it rather than re-deriving the question.
   *
   * `path` first, deliberately: a chosen path must not be displaced by hovering another card,
   * or the spine the user is working in would be swapped out from under them by a mouse
   * passing over. Hover only speaks while nothing is chosen.
   */
  const planColumn = $derived<WizardPath | null>(path ?? previewPath);

  const previewSpine = $derived<SpineId[]>(
    previewPath === null
      ? []
      : spineFor(previewPath, needsBackupStep(previewPath, { isStock, backupTaken })),
  );

  const w = $derived(locale.t.wizard);
  /** The preview column's titles. Same table, but keyed on the HOVERED path rather than the
   *  chosen one, which is still null while the chooser is up. */
  function previewTitle(id: SpineId): string {
    return titleOf(id, previewPath === "dual");
  }
  function spineTitle(id: SpineId): string {
    return titleOf(id, path === "dual");
  }
  function titleOf(id: SpineId, dual: boolean): string {
    switch (id) {
      case "backup":
        return dual ? w.spine.backupAndPatchOriginal : w.spine.backUpOriginal;
      case "install":
        return w.spine.installRetroGo;
      case "sources":
        return w.spine.addSources;
      case "roms":
        return w.spine.addRoms;
      case "select-backup":
        return w.spine.selectBackup;
      case "restore":
        return w.spine.restoreOriginal;
      case "remove-rgo":
        return w.spine.removeRetroGo;
    }
  }

  function choose(p: WizardPath) {
    path = p;
    skipExpanded = false;
    // Latch here (see `rgoNeedsBackup`): Retro-Go-only needs the backup step only while there
    // is still unpatched stock on the device and no backup of THIS unit has been recorded.
    // Same predicate the preview column derives live, so the plan the user was shown is the
    // plan they get -- but read ONCE, here, and then frozen.
    rgoNeedsBackup = p === "rgo" && needsBackupStep(p, { isStock, backupTaken });
  }
</script>

<!-- One definition, ONE placement: the install step's title row. It was rendered once per
     control row, because the row swaps between Install and Reinstall and the refresh belongs to
     both shapes; the title does not swap, so saying it there says it once. -->
{#snippet refreshVersionsButton()}
  <button
    type="button"
    class="version-refresh"
    onclick={() => void doRefreshVersions()}
    disabled={refreshCooldown || refreshingVersions}
    title={locale.t.romSection.refreshVersions}
    aria-label={locale.t.romSection.refreshVersions}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true" class:spin={refreshingVersions}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path d="M13.6 2.4v3.2h-3.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
{/snippet}

<!-- ONE PAGE, NOT TWO. ChooseAndSee draws the choices and the plan they produce side by side,
     and CHOOSING COMMITS RATHER THAN NAVIGATES: the layout does not change, the picked card reads
     as picked, and the right column stops being an inert preview and becomes the live spine.
     Nothing slides, swaps or replaces.

     This replaced a `{#if path === null}` / `{:else}` that exchanged the whole page for a second
     layout of the same information, with a Back button underneath it -- the two-page model the
     redesign exists to remove. The pips went with it: two pips describing two pages are a lie
     once there is one page, and no ChooseAndSee board draws them. -->
<div class="wizard-container" class:two-col={planColumn !== null}>
    <h2 class="chooser-title">{w.chooser.title}</h2>
    <!-- Retro-Go is the one word this screen assumes and never defines. It sits under the
         title as a rubric, the shape Landing already uses for its two steps. -->
    <p class="chooser-rubric">{w.chooser.whatIsRetroGo}</p>

    <!-- ChooseAndSee: the choices and the plan they produce, side by side, in ONE layout that
         a choice fills rather than replaces. The right column exists whenever there is a card
         it could belong to -- on the degenerate page (an unmodified device, every card gated
         away) there is no plan, so the column collapses and the note stands alone at the
         page's own measure, which is what `.two-col` keys off. -->
    <div class="chooser-stage" class:has-preview={planColumn !== null}>
      <div class="chooser-col">
        <div class="chooser">
          {#each chooserCards as card (card)}
            <button
              type="button"
              class="choice"
              class:previewing={path === null && previewPath === card}
              class:picked={path === card}
              aria-pressed={path === card}
              onclick={() => choose(card)}
              onmouseenter={() => (hoverPath = card)}
              onmouseleave={() => (hoverPath = null)}
              onfocus={() => (hoverPath = card)}
              onblur={() => (hoverPath = null)}
            >
              <span class="marks">
                {#if card === "dual"}
                  <img class="mark-gnw" src={logoGnw} alt="" />
                  <svg class="plus" width="22" height="22" viewBox="0 0 11 11" aria-hidden="true">
                    <path d="M5.5 0.5 V10.5 M0.5 5.5 H10.5" stroke="var(--ink-faint)" stroke-width="1.7" fill="none" />
                  </svg>
                  <img class="mark-rgo" src={logoRgo} alt="" />
                {:else if card === "rgo"}
                  <img class="mark-rgo" src={logoRgo} alt="" />
                {:else}
                  <img class="mark-gnw" src={logoGnw} alt="" />
                {/if}
              </span>
              <span class="choice-label">
                {card === "dual"
                  ? w.chooser.dualBoot
                  : card === "rgo"
                    ? w.chooser.onlyRetroGo
                    : w.chooser.returnToStock}
              </span>
            </button>
          {/each}
        </div>

        {#if chooserFloorNote === "retrogo"}
          <!-- Under 8 MB, every card can end up hidden (including "Return to Stock" when the
               device already has unpatched stock) — this note is the only thing shown then, so
               it must stand alone regardless of which cards are present. -->
          <p class="floor-note">{w.chooser.tooSmallForRetroGo(extMB ?? 0)}</p>
        {:else if chooserFloorNote === "dualboot"}
          <p class="floor-note">{w.chooser.tooSmallForDualBoot(extMB ?? 0)}</p>
        {/if}
      </div>

      {#if planColumn !== null}
        <!-- THE PLAN, in one of its two lives. Before a choice it is an inert PREVIEW: no
             controls, because every control in the real spine acts on a chosen path, and
             `aria-hidden` because the cards are the operable thing and a reader walking inert
             step titles between them would be reading furniture. After a choice it is the
             SPINE ITSELF, controls and all, in the same column of the same layout -- which is
             the whole point of ChooseAndSee. The column does not appear, move or swap; only
             what fills it changes. -->
        <div
          class="plan-col"
          class:is-preview={path === null}
          aria-hidden={path === null ? "true" : undefined}
        >
          {#if path === null}
            {#each previewSpine as id, i (id)}
              <div class="preview-step">
                <div class="rail">
                  <span class="step-num">{i + 1}</span>
                  {#if i < previewSpine.length - 1}<span class="connector"></span>{/if}
                </div>
                <div class="preview-title">{previewTitle(id)}</div>
              </div>
            {/each}
          {:else}
            {#each spine as id, i (id)}
              {@const stepDone =
                (id === "backup" && step1Done) || (id === "install" && step2Done) || (id === "restore" && restoreDone) ||
                (id === "sources" && curatedReady)}
              {@const stepActive =
                !stepDone &&
                ((id === "backup" && step1Active) ||
                  (id === "install" && step2Active) ||
                  (id === "roms" && step3Active) ||
                  id === "sources" ||
                  (id === "select-backup" && !restoreDone) ||
                  (id === "restore" && restoreValid && !restoreDone))}
              {@const stepOptional = id === "sources" || id === "remove-rgo"}
              <div class="wizard-step" class:active={stepActive} class:done={stepDone}>
                <div class="rail">
                  <span class="step-num">
                    {#if stepDone}
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                           stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                      </svg>
                    {:else}
                      {i + 1}
                    {/if}
                  </span>
                  {#if i < spine.length - 1}<span class="connector"></span>{/if}
                </div>
                <div class="step-content">
                  <div class="title-row">
                    <h3>{spineTitle(id)}</h3>
                    <!-- ONE refresh on the step, beside its title, rather than one per control
                         row. It used to be rendered twice, once in each shape of the install
                         step, because the shapes swap and the control belongs to both -- but the
                         title does not swap, so putting it there says the same thing once. The
                         version itself is chosen in the modal now, and that has its own. -->
                    {#if id === "install"}{@render refreshVersionsButton()}{/if}
                    <!-- No "Done" chip: the rail already replaces the step number with a green check,
                         and a word repeating it is the kind of filler docs/UI_VOICE.md rules out. The
                         Optional chip stays, because nothing else says that. -->
                    {#if !stepDone && stepOptional}
                      <span class="chip chip-optional">{w.spine.chipOptional}</span>
                    {/if}
                  </div>

                  {#if id === "backup"}
                    {#if step1Done}
                      <button type="button" class="run-again" onclick={path === "dual" ? openStep1 : openBackupOnly}>
                        {w.spine.runAgain}
                      </button>
                    {:else}
                      <div class="row">
                        <!-- Dual boot patches; Retro-Go-only backs up and stops (see openBackupOnly). -->
                        <Button variant="action" disabled={!step1Active} onclick={path === "dual" ? openStep1 : openBackupOnly}>
                          {path === "dual" ? w.step1.buttonAction(isBroken) : w.step1.buttonBackupOnly}
                        </Button>
                        <!-- GuidedSkipBackup: once the caution is open the Skip affordance is gone,
                             leaving only "Skip anyway" inside the panel. -->
                        {#if canSkipBackup && !skipExpanded}
                          <button type="button" class="skip" onclick={() => (skipExpanded = true)}>
                            {w.step1.skip}
                          </button>
                        {/if}
                      </div>
                      {#if canSkipBackup && skipExpanded}
                        <div class="caution">
                          <p>{w.spine.skipCaution}</p>
                          <button type="button" class="skip-anyway" onclick={() => { step1Skipped = true; skipExpanded = false; }}>
                            {w.spine.skipAnyway}
                          </button>
                        </div>
                      {/if}
                    {/if}

                  {:else if id === "install"}
                    {#if step2Done}
                      <div class="row">
                        {#if hasUpdate}
                          <Button variant="action" onclick={openStep2}>
                            {w.step2.upgradeButtonLabel(cleanTag(latestVersion))}
                          </Button>
                        {:else}
                          <Button variant="quiet" onclick={openStep2}>{w.step2.reinstallButtonLabel}</Button>
                        {/if}
                      </div>
                    {:else}
                      <!-- The artboards run the version you are about to install, in mono, beside the
                           button. Device/runtime-derived, so no string table entry. -->
                      <div class="row">
                        <Button variant="action" disabled={!step2Active} onclick={openStep2}>
                          {w.step2.installButtonLabel}
                        </Button>
                        {#if latestVersion}<span class="version">{cleanTag(latestVersion)} {w.step2.versionLatest}</span>{/if}
                      </div>
                    {/if}

                  {:else if id === "sources"}
                    <Button variant="default" onclick={() => (sourcesModalOpen = true)}>{w.spine.sourcesButtonLabel}</Button>

                  {:else if id === "roms"}
                    <Button variant="action" disabled={!step3Active} onclick={() => onComplete?.()}>{w.step3.continueButtonLabel}</Button>

                  {:else if id === "select-backup"}
                    <!-- GuidedStockOnly.dc.html draws the done `Select Backup` step as a bare title
                         with its check disc and NO control (survey A, GSO5) — the same shape as the
                         3.8 fix on the backup step, rather than a disabled leftover. -->
                    {#if !restoreDone}
                      <div class="row">
                        <Button variant="action" onclick={pickRestoreBackup}>{w.spine.selectFolderButtonLabel}</Button>
                        {#if restoreValid}
                          <span class="found">{w.spine.backupFound(modelLabel(restoreBackup!.model))}</span>
                        {/if}
                      </div>
                    {/if}
                    {#if restoreScanned && !restoreValid}
                      <!-- No usable backup, and deliberately nothing here that offers to fetch one:
                           we have no legal way to supply the original firmware. -->
                      <div class="caution">
                        <p>{w.restore.noneFound}</p>
                        <p>{w.spine.skipCaution}</p>
                      </div>
                    {:else if restoreWrongHw}
                      <div class="caution">
                        <p>{w.restore.wrongHardware(modelLabel(restoreBackup!.model), modelLabel(device.model))}</p>
                      </div>
                    {:else if restoreTooBig}
                      <div class="caution">
                        <p>{w.restore.tooBig(MiB(restoreBackup!.external.length), MiB(device.extFlashBytes))}</p>
                      </div>
                    {/if}

                  {:else if id === "restore"}
                    {#if !restoreDone}
                      <Button variant="action" disabled={!canRestore} onclick={openRestore}>
                        {w.spine.restoreButtonLabel}
                      </Button>
                      {#if !restoreValid}
                        <span class="found">{w.restore.needBackup}</span>
                      {/if}
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    <!-- Below the stage, and drawn in every state. It used to be hidden from a locked device
         because the Advanced tab could not unlock one either; now it can, so for a locked
         device this line is a route forward rather than a second dead end. -->
    <p class="escape">{w.chooser.escapePrompt} <span class="escape-strong">{w.chooser.escapeAction}</span></p>
</div>

{#if sourcesModalOpen}
  <AddSourcesModal
    onClose={() => (sourcesModalOpen = false)}
    onAllSources={onSources ? () => { sourcesModalOpen = false; onSources(); } : undefined}
  />
{/if}

<style>
  /* No surface, no border, no shadow: a wizard is not an object, so it earns no container
     (the redesign's container rule). A bare 470px column on the page ground. */
  .wizard-container {
    display: flex;
    flex-direction: column;
    /* No container gap. The re-synced Guided.dc.html (31cc2f7) stacks the spine steps with
       NOTHING between them — their own `padding-bottom: 30px` is the whole separation, and
       that padding is what the rail's connector hairline runs through. A 2rem container gap
       both over-spaced the steps (30+32) and cut the connector into visible segments. Every
       other spacer on these boards is an explicit height, so they are explicit margins here. */
    gap: 0;
    /* ONE COLUMN by default: the degenerate page (every card gated away) is a note at the
       spine's own 470px measure, which is what `centred(left, width=COL)` draws. */
    width: 470px;
    max-width: 100%;
    margin: 0 auto;
  }
  /* TWO COLUMNS, and this is the bug the owner reported as "all messed up". The stage needs
     the cards (360) plus two gutters (48 each) plus the divider (1) plus the spine's measure
     (470) = 927px, and the container was pinning it at 470 -- so the two columns were crushed
     into 55% of the width they need, the cards could not shrink below their fixed width, and
     the plan was squeezed to a ragged stub beside them.

     `build.py` in the proposal draws exactly this sum: `CARD + GUTTER * 2 + 1 + COL`. Stated
     as that sum rather than as 927 so the arithmetic stays visible and a change to one term
     cannot silently leave the rest behind. Well inside `--maxw` (1360px). */
  .wizard-container.two-col {
    width: calc(360px + 48px * 2 + 1px + 470px);
  }

  /* ── Step 1: the chooser ── */
  .chooser-title {
    /* 24px title -> cards on both chooser artboards. The rubric and the locked notice both
       sit between title and cards, so they carry that gap themselves (see .chooser-rubric). */
    margin: 0 0 24px;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--ink);
  }
  .chooser {
    display: flex;
    flex-direction: column;
    /* A fixed-width card in a stretch-aligned column would sit hard left — centre them. */
    align-items: center;
    gap: 10px;
    /* 20px cards -> escape line on both chooser artboards. */
    margin-bottom: 20px;
  }
  .choice {
    /* 360, not the old chooser's 304: wide enough for the longest label ("Retro-Go uniquement",
       fr) to sit on one line beside the mark well. `build.py`'s CARD, and the first term of the
       two-column width above. */
    width: 360px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 18px 20px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    cursor: pointer;
    text-align: start;
    font: inherit;
  }
  .choice:hover {
    border-color: var(--ink-faint);
  }
  /* The marks sit ABOVE the label rather than beside it. At their old sizes a fixed 120px
     well beside the label was what made every label start on the same x; at double the size
     that row needs 219.6px, and a card wide enough to hold it beside a label would have
     filled the 470px column edge to edge. Stacked, the row only has to fit the card's own
     content width (264px), and the labels line up because they are centred in equal cards.
     No fixed width here: the row is as wide as its contents. */
  .marks {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .mark-gnw {
    height: 48px;
    width: auto;
    display: block;
  }
  .mark-rgo {
    height: 22px;
    width: auto;
    display: block;
  }
  .plus {
    display: block;
    flex: 0 0 auto;
  }
  .choice-label {
    width: 100%;
    text-align: center;
    font-size: var(--fs-body);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  /* The rubric replaces the title's own bottom margin so the title sits tight above it. */
  .chooser-rubric {
    margin: -16px 0 24px;
    font-size: var(--fs-caption);
    line-height: 1.45;
    color: var(--ink-soft);
  }
  /* ChooseAndSee's two columns. The stage is a flex row rather than a grid because the second
     column is CONDITIONAL: on the degenerate page there is no plan to draw, and a grid would
     hold its track open. `align-items: flex-start` keeps a short plan from stretching down
     beside a tall stack of cards.

     Logical properties throughout (`direction.mjs` fails the build on the physical ones), so
     the preview lands on the trailing side in both directions. */
  .chooser-stage {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 48px;
  }
  .chooser-col {
    display: flex;
    flex-direction: column;
    /* Without this the cards' fixed width makes the column refuse to shrink, and the row
       pushes the page sideways at narrow widths. */
    min-width: 0;
  }
  /* A hairline between the choice and its consequence, drawn only when both are there. It is
     a divider, so it follows the taller column rather than declaring a height. */
  .chooser-stage.has-preview .plan-col {
    border-inline-start: 1px solid var(--hairline);
    padding-inline-start: 48px;
  }
  .plan-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    /* Matches the spine's own measure, so the plan previewed here is the width it arrives at. */
    inline-size: 470px;
    max-inline-size: 100%;
  }
  .preview-step {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    column-gap: 18px;
    /* The real spine's rows carry their own spacing; the preview's are inert, so the rail's
       connector is what ties them and the gap belongs to the row. */
    min-block-size: 44px;
  }
  /* Every preview row is dim by construction: none of these steps has been reached, and the
     real spine's done/active treatments would claim progress on a path not chosen. */
  .preview-title {
    font-size: var(--fs-body);
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.5;
  }
  /* The card the preview belongs to. An outline, never a word: which plan is shown is carried
     by the pairing, and a label saying "selected" would be the filler UI_VOICE rules out. */
  .choice.previewing {
    border-color: var(--ink-faint);
  }
  /* THE PICKED CARD. A committed choice is not a hover, so it reads stronger: the accent edge
     the rest of the app uses for a current thing. No word and no chip -- the live spine beside
     it already says which path is running, and a label repeating that is the filler
     docs/UI_VOICE.md rules out. `aria-pressed` carries the same fact to a reader. */
  .choice.picked {
    border-color: var(--zelda-green);
    box-shadow: inset 0 0 0 1px var(--zelda-green);
  }
  .escape {
    margin: 0;
    font-size: var(--fs-btn-sm);
    color: var(--ink-dim);
  }
  /* The hardware-floor note. Sits with the escape hatch, not styled as an error: the device
     simply cannot do the thing, which is a fact about the chip rather than a failure. */
  .floor-note {
    margin: 0 0 20px;
    max-width: 52ch;
    font-size: var(--fs-btn-sm);
    line-height: 1.5;
    color: var(--ink-mute);
  }
  .escape-strong {
    color: var(--ink-mute);
    font-weight: 600;
  }

  /* ── The plan column, once a path is chosen ── */
  .wizard-step {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    column-gap: 18px;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  .wizard-step.active, .wizard-step.done {
    opacity: 1;
  }
  /* The number column: the mark, then the hairline that carries the eye to the next step. */
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .connector {
    width: 1px;
    flex-grow: 1;
    background: var(--hairline);
    margin: 8px 0;
  }
  /* Pending: white fill, hairline border, grey digit. */
  .step-num {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-chip);
    font-weight: 700;
    flex-shrink: 0;
  }
  /* Active: solid ink, white digit — NOT the model accent, which is a neutral grey whenever
     the model is unknown. */
  .wizard-step.active .step-num {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--surface);
  }
  /* Done: green fill and a white check. The digit goes away. */
  .wizard-step.done .step-num {
    background: var(--zelda-green);
    border-color: var(--zelda-green);
    color: var(--surface);
  }
  .step-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    padding-bottom: 30px;
  }
  .wizard-step:last-child .step-content {
    padding-bottom: 0;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  /* The row is baseline-aligned for the title and its chip, which are both text. The refresh is
     a 28px box with no text in it, so a baseline would hang it below the title it sits beside;
     it centres against the line instead. Scoped to the child rather than changing the row, so
     the chip keeps the alignment it was drawn with. */
  .title-row .version-refresh {
    align-self: center;
  }
  /* The step you are on is promoted; the rest sit back at 16px. */
  .step-content h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
  }
  .wizard-step.active .step-content h3 {
    font-size: 21px;
  }
  .chip {
    font-size: var(--fs-chip);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .chip-optional {
    color: var(--ink-dim);
  }
  .version-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    flex: none;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .version-refresh:hover:not(:disabled) {
    color: var(--ink);
  }
  .version-refresh:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .version-refresh svg {
    width: 15px;
    height: 15px;
  }
  /* Only while a fetch is in flight: the 10 s lockout is silent, because a control still
     spinning after its work is done is lying about what it waits for. */
  .version-refresh svg.spin {
    animation: version-refresh-spin 900ms linear infinite;
  }
  @keyframes version-refresh-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .version-refresh svg.spin {
      animation: none;
    }
  }
  /* A quiet way back into a step that is already done — not a link, not a button. */
  .run-again {
    background: none;
    border: none;
    padding: 2px 0 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  .run-again:hover {
    color: var(--ink);
  }
  .version {
    font-family: var(--font-mono);
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  .row {
    display: flex;
    gap: 18px;
    align-items: center;
  }
  .found {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }

  .caution {
    background: var(--tint-caution);
    border-inline-start: 2px solid var(--caution);
    border-radius: 0 3px 3px 0;
    padding: 10px 13px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  /* GuidedSkipBackup sets the caution body in plain ink, not the caution brown; the panel's
     tint and left rule already say "caution". --ink flips in dark theme like the brown did. */
  .caution p {
    margin: 0;
    font-size: var(--fs-btn-sm);
    color: var(--ink);
  }
  /* GuidedRetroGoOnly draws Skip as bare grey text — no chrome, no underline. */
  .skip {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  .skip:hover {
    color: var(--ink);
  }
  .skip:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  /* Weight and the danger colour carry it — the artboard does not underline. */
  .skip-anyway {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--danger);
  }
</style>
