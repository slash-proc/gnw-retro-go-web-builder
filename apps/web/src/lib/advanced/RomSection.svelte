<script lang="ts">
  import { device } from "../device.svelte.js";
  import { pickAndScanRomFolder, folderPickerSupported, type RomScanResult } from "../romScan.js";
  import { EXTBASE } from "./addr.js";
  import {
    buildFlashInstall,
    flashInstallToDevice,
    BudgetError,
    FLASH_REGIONS,
    type FlashInstall,
    type FlashRegion,
  } from "../engine/flashInstall.js";
  import { listVersions, refreshVersions, fetchBundle } from "../artifacts.js";
  import { sameVersion } from "../firmwareDist/compare.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { readFrogfsState } from "../engine/fsscan.js";
  import { dbg as dbgLog } from "../debug.js";
  import { readGameData } from "../engine/frogfsDevice.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import { homebrew } from "../sources/homebrewTitles.svelte.js";
  import { prepareState } from "../sources/prepareState.svelte.js";
  import { sources } from "../sources/store.svelte.js";
  import { deviceInstallPaths } from "../engine/devicePaths.js";
  import { isCoreKind, type Target } from "../sources/types.js";
  import type { MappedSpec } from "@gnw/fs-builders";
  import { planFlashLayout } from "@gnw/fs-builders";
  import { locateSuperblock, readSuperblock, SUPERBLOCK_SIZE } from "@gnw/gnw-patch";
  import SplitButton from "../ui/SplitButton.svelte";
  import Button from "../ui/Button.svelte";
  import PaneFooter from "./PaneFooter.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { msg, errText, sumBytes } from "../logEntry.js";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import { isStubAlive } from "../engine/flasher.js";
  import { raceWithFallback } from "../engine/timeout.js";
  import { saveFileToDirOrDownload, nativeFolderPickerSupported, pickSdCardFolder } from "../romScan.js";
  import { download } from "../util.js";
  import JSZip from "jszip";
  import BankCard from "../ui/BankCard.svelte";
  import { locale } from "../i18n/locale.svelte.js";

  // Tab B.1 — ROM / homebrew management. Pick a folder → scan → build the FrogFS +
  // LittleFS images (with the bundled default content) → flash. Covers + cheats fold
  // in here later as more content under the same scan.
  let {
    installMode,
    onRunning,
  }: { installMode: "flash" | "sd"; onRunning?: (r: boolean) => void } = $props();

  import { library } from "../library.svelte.js";
  import type { FirmwareVersion } from "../artifacts.js";
  const scan = $derived(library.scan);
  let preparing = $state(false);
  let install = $state<FlashInstall | null>(null);
  // Stashed from the fetched bundle during buildInstall(), consumed by run()'s post-rescan
  // "sd-sync" phase (SD mode only) — see Wizard.svelte's step 2 for the pattern this mirrors.
  let pendingSdContent: Map<string, Uint8Array> | null = null;
  let flashing = $state(false);
  let result = $state<"success" | null>(null);
  let err = $state<string | null>(null);
  let flashTarget = $state<readonly FlashRegion[]>(FLASH_REGIONS); // which regions the modal will flash

  // Friendly, user-facing names for the flash regions — end-users don't care about the
  // filesystem name, so drop the FrogFS/LittleFS technical suffix entirely (owner request).
  // Used only for the "flash" phase's per-region sub-steps/progress label, not the SplitButton
  // menu (which keeps "Flash " as an unambiguous clickable-action prefix — see below).
  const REGION_LABELS: Record<FlashRegion, string> = {
    intflash: locale.t.romSection.regionIntflash,
    frogfs: locale.t.romSection.regionFrogfs,
    littlefs: locale.t.romSection.regionLittlefs,
  };

  function flashPhases(regions: readonly FlashRegion[]): PhaseDef[] {
    return [
      { id: "prepare", label: locale.t.romSection.phasePrepare },
      { id: "download", label: locale.t.romSection.phaseDownload },
      {
        id: "migrate-scan",
        label: locale.t.romSection.phaseMigrateScan,
        substeps: [
          { id: "frogfs-state", label: locale.t.romSection.subFrogfsState },
          { id: "lfs-extract", label: locale.t.romSection.subLfsExtract },
          { id: "games-migrate", label: locale.t.romSection.subGamesMigrate },
        ],
      },
      // SD mode doesn't build a FrogFS/LittleFS image at all (that content lives on the SD
      // card, gathered separately) — it only patches the prebuilt SD blob's round-robin
      // ROM-cache reserved-offset boundary, so it gets exactly one real sub-step.
      installMode === "sd"
        ? {
            id: "build",
            label: locale.t.romSection.phasePrepareInstallImage,
            substeps: [{ id: "sdcache", label: locale.t.romSection.subSdCache }],
          }
        : {
            id: "build",
            label: locale.t.romSection.phaseBuildInstallImage,
            substeps: [
              { id: "frogfs", label: locale.t.romSection.subBuildFrogfs },
              { id: "littlefs", label: locale.t.romSection.subBuildLittlefs },
              { id: "superblock", label: locale.t.romSection.subPatchSuperblock },
            ],
          },
      {
        id: "flash",
        label: locale.t.romSection.phaseFlashingToDevice,
        substeps: regions.map((r) => ({ id: r, label: REGION_LABELS[r] })),
      },
      { id: "rescan", label: locale.t.romSection.phaseRescan },
      // SD mode also writes the bundle's cores/bios/fonts content to the SD card itself —
      // mirrors Wizard.svelte's step 2 exactly (same per-bank SD content tree, same
      // saveFileToDirOrDownload/ZIP-fallback pair).
      ...(installMode === "sd" ? [{ id: "sd-sync", label: locale.t.romSection.phaseSyncSdCores } as PhaseDef] : []),
    ];
  }

  function openFlash(regions: readonly FlashRegion[]) {
    // NOTE: littlefs is always included regardless of migrateLfs — buildInstall() rebuilds the
    // LittleFS image either way (with migrated saves folded in when requested), so it always
    // needs to actually be flashed. A prior version of this line excluded "littlefs" from
    // flashTarget whenever migrateLfs was checked, which meant the freshly-built image
    // (containing the migrated data) was built but never written — LittleFS silently never
    // got created/updated on a migrated install.
    flashTarget = regions;
    const phaseRegions = installMode === "sd" ? flashTarget.filter((r) => r === "intflash") : flashTarget;
    void installProgress.run({
      title: flashTitle,
      body: flashBody,
      danger: true,
      confirmText: locale.t.romSection.flashConfirmText,
      phases: flashPhases(phaseRegions),
      // Same SD-card folder gate as Wizard.svelte's step 2 (reuses the exact same picker) —
      // belt-and-suspenders here since the trigger button below already only offers "Flash
      // Retro-Go" once device.sdHandle is set, but this keeps the confirm step itself honest
      // if that ever changes. Skipped on Firefox (no File System Access API) — the sd-sync
      // phase's ZIP-fallback handles that case instead, same as Wizard.
      confirmGate:
        installMode === "sd" && nativeFolderPickerSupported()
          ? { label: locale.t.romSection.selectSdCard, ready: () => !!device.sdHandle, onClick: pickSdCardFolder }
          : undefined,
      exec: async (report) => {
        flashing = true;
        onRunning?.(true);
        try {
          if (needsBuild) {
            await buildInstall(report);
          } else {
            for (const id of ["prepare", "download", "migrate-scan", "build"]) report.finish(id);
          }
          await run(report);
          result = "success";
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
          throw e;
        } finally {
          flashing = false;
          onRunning?.(false);
        }
      },
    });
  }

  // Trigger-button label: SD mode needs the SD card folder picked before there's anything
  // meaningful to flash to it (the install writes cores/bios/fonts there too — see run()'s
  // "sd-sync" phase) — the button itself does that directly rather than making the user open
  // the confirm modal first just to hit the in-modal confirmGate button.
  const needsSdCardPick = $derived(installMode === "sd" && nativeFolderPickerSupported() && !device.sdHandle);
  const flashButtonLabel = $derived(needsSdCardPick ? locale.t.romSection.chooseSdCard : locale.t.romSection.flashRetroGo);
  function onFlashButtonClick() {
    if (needsSdCardPick) {
      void pickSdCardFolder();
    } else {
      openFlash(FLASH_REGIONS);
    }
  }

  // Expert layout overrides (decision: "specify offset of frogfs and size of littlefs").
  let layoutOpen = $state(false);

  // Firmware.dc.html:150's footer caption. Both values are device/build-derived, so they are
  // arguments; with nothing built yet there is no size to state and the artboard shows no
  // empty-state caption, so the bar's left side stays blank rather than inventing one.
  const footerSummary = $derived(
    install ? locale.t.romSection.footerSummary(`${Math.round(install.intflash.length / 1024)} KB`, install.bank, install.bank === 2) : undefined,
  );
  let frogfsOffsetStr = $state(""); // blank = auto
  let littlefsMiBStr = $state(""); // blank = auto

  // --- Bank inference (req. 0/1) ---------------------------------------------------
  const bank1 = $derived(device.banks.find((b) => b.index === 1));
  const bank2 = $derived(device.banks.find((b) => b.index === 2));
  const retroGoBank = $derived(device.banks.find((b) => b.retroGoVersion));
  const installedVersion = $derived(retroGoBank?.retroGoVersion);
  const retroGoBankIndex = $derived(retroGoBank?.index);
  const bank1StockOfw = $derived(bank1?.ofw && !bank1.ofw.patched ? bank1.ofw : undefined);
  /**
   * ANY official firmware in bank 1, stock or patched. `bank1StockOfw` above deliberately means
   * only the unpatched kind, because "is there stock firmware to preserve" is a different
   * question from "where should Retro-Go go".
   *
   * A DUAL-BOOT PATCHED OFW IS THE STRONGEST possible signal that bank 2 is the target: that
   * patch exists precisely so the OFW in bank 1 can hand off to Retro-Go in bank 2. Inferring
   * from `bank1StockOfw` alone meant that after uninstalling Retro-Go, a device with patched
   * OFW in bank 1 and a dual-boot layout preselected bank 1, which would flash Retro-Go over
   * the very firmware the patch boots from.
   */
  const bank1AnyOfw = $derived(bank1?.ofw);
  const hasRetroGoAnywhere = $derived(retroGoBankIndex !== undefined);
  const deviceHasRetroGoInstalled = $derived(hasRetroGoAnywhere);

  let bankUserOverride = $state<1 | 2 | null>(null); // set only via the "change bank" picker
  const inferredBank = $derived.by((): 1 | 2 => {
    if (retroGoBankIndex === 1 || retroGoBankIndex === 2) return retroGoBankIndex; // follow retro-go
    // Any OFW in bank 1, stock or patched. Patched means dual-boot, which is a statement that
    // bank 2 is where Retro-Go lives -- it is not a reason to treat bank 1 as free.
    if (bank1AnyOfw) return 2;
    return 1; // bank1 has no official firmware at all (empty/unknown) → retro-go-only install
  });
  const bank = $derived(bankUserOverride ?? inferredBank);
  const retroGoOnlyInstall = $derived(inferredBank === 1 && !bank1StockOfw && !hasRetroGoAnywhere);

  // Migration-detection basis (classify.ts's installOrigin): a soft, non-blocking heads-up when
  // the device's ACTUAL installed build (Flash vs SD, from the LittleFS/layout-superblock probe)
  // disagrees with which mode this UI is currently set to — "old" (foreign/pre-web-builder image)
  // has nothing of ours to compare against, so it's excluded. Complain once, don't harass: no
  // modal, doesn't block anything, just an inline notice like the bank ones above.
  const installOriginMismatch = $derived.by((): "flash" | "sd" | null => {
    const origin = device.deviceClass?.installOrigin;
    if (origin === "flash" && installMode === "sd") return "flash";
    if (origin === "sd" && installMode === "flash") return "sd";
    return null;
  });

  // --- Version card + real multi-version picker (req. 2) ----------------------------
  let versions = $state<FirmwareVersion[]>([]);
  let selectedVersionTag = $state<string>("");
  let selectedVersionUserSet = false; // becomes true once the user picks explicitly

  /**
   * Re-read the published version list on demand.
   *
   * `versions.json` is memoised for the session, so a release published while the app is open
   * is invisible and there is no way to tell from the picker whether the list is current. The
   * owner asked for a way to check without reloading.
   *
   * The 10 s lockout is the whole rate limit, by his instruction: the control greys out on
   * press and comes back. No queueing, no retry, no spinner state machine -- a second press
   * would only refetch a document that changes on the order of days.
   */
  let refreshingVersions = $state(false);
  let refreshCooldown = $state(false);
  async function doRefreshVersions(): Promise<void> {
    if (refreshCooldown || refreshingVersions) return;
    refreshingVersions = true;
    refreshCooldown = true;
    setTimeout(() => (refreshCooldown = false), 10000);
    try {
      const v = await refreshVersions();
      versions = v;
      // A refresh must not move a choice the user made. It may still fill an empty picker, and
      // it re-runs the installed-version match when they have not chosen, which is the case
      // where a newly published release should become the default.
      if (!selectedVersionUserSet && v.length > 0) {
        const matchInstalled = v.find((x) => sameVersion(x.gitTag, installedVersion));
        selectedVersionTag = matchInstalled ? matchInstalled.tag : v[0].tag;
      }
    } catch (e) {
      dbgLog("[versions] refresh failed:", errText(e));
    } finally {
      refreshingVersions = false;
    }
  }
  $effect(() => {
    listVersions().then((v) => {
      versions = v;
      if (!selectedVersionUserSet && v.length > 0) {
        // The device reports a BAKED version string, which is the release's `gitTag`, not its
        // release `tag` — matching on `.tag` here could only ever miss.
        const matchInstalled = v.find((x) => sameVersion(x.gitTag, installedVersion));
        selectedVersionTag = matchInstalled ? matchInstalled.tag : v[0].tag;
      }
    });
  });
  const latestVersion = $derived(versions[0]?.tag ?? null);

  // Same-version repair vs a genuine (re)install of a different build. This used to extract a
  // 7-hex sha off the end of both strings, which parsed nothing the day a release was tagged
  // `v2.0.0-rc1` rather than as a `git describe` suffix. It is a `gitTag` byte-compare now
  // (firmwareDist/compare.ts): the device's baked string against the selected release's
  // published one. Unknown on either side is never "same".
  const selectedVersion = $derived(versions.find((v) => v.tag === selectedVersionTag));
  const isSameVersion = $derived(sameVersion(selectedVersion?.gitTag, installedVersion));
  // NOTE: this section has no upgrade/reinstall LABEL of its own — the picker names the exact
  // release, and the only question this section asks is same-or-different, which is genuinely
  // what gates the migrate defaults below and the repair-vs-install log line. Both surfaces
  // that DO carry that label — views/Wizard.svelte and the Advanced rail's pane title in
  // advanced/FirmwareRail.svelte — share one rule, `installTitleState` in
  // firmwareDist/compare.ts; use it rather than a local test if this section ever grows one.

  function pickVersion(tag: string) {
    selectedVersionUserSet = true;
    selectedVersionTag = tag;
  }

  let migrateGames = $state(false);
  let migrateLfs = $state(false);

  // Default-checked the first time deviceHasRetroGoInstalled becomes true (device.banks
  // populates asynchronously after the scan, so this can't be a plain $state initializer) —
  // but only for whichever of games/saves actually has something on-device to migrate FROM.
  // Checking a box with nothing behind it left migrateLfs/migrateGames stuck at their default
  // `true` even when the corresponding partition doesn't exist (the checkbox shows disabled/
  // grayed, but a disabled checkbox doesn't reset its own bound value) — which both silently
  // dropped LittleFS from the actual flash (see openFlash()'s fix) and mislabeled the "new"
  // projection as "(migrated)" below.
  let migrateDefaultsApplied = false;
  $effect(() => {
    // Wait for the full scan (banks AND partitions) to settle — banks alone can go true first
    // within the same scan, which would otherwise lock in defaults against a still-empty
    // partitions list.
    if (deviceHasRetroGoInstalled && !device.scanning && !migrateDefaultsApplied) {
      migrateDefaultsApplied = true;
      migrateGames = device.partitions.some((p) => p.fs === "frogfs");
      migrateLfs = device.partitions.some((p) => p.fs === "littlefs");
    }
  });

  $effect(() => {
    // Same-version "repair" still implies keeping what's there.
    if (isSameVersion) migrateGames = true;
  });

  const supported = folderPickerSupported();
  const extBytes = $derived(device.info?.externalFlashSizeBytes ?? 0);
  const blockSize = $derived(device.info?.minEraseSizeBytes ?? 4096);
  const MiB = (n: number) => (n / 1048576).toFixed(2);
  const hex = (n: number) => "0x" + (n >>> 0).toString(16);

  // Current on-device flash layout (from the device scan) — drives the geometry aid below.
  const intSegs = $derived(intflashSegments(device.banks));
  // Bank selector — reuses OverviewTab's own bank visualization (BankCard.svelte) as a
  // clickable selector instead of a plain <select>, so the user sees exactly what's already
  // in each bank (same bars/segments as the Overview tab) while picking where to install.
  const bank1Segs = $derived(intSegs.filter((s) => s.bank === 1));
  const bank2Segs = $derived(intSegs.filter((s) => s.bank === 2));
  const extSegs = $derived(extflashSegments(device.partitions, extBytes));
  const extEnd = $derived(EXTBASE + extBytes);
  const deviceScanned = $derived(device.banks.length > 0);

  const frogfsPart = $derived(device.partitions.find((p) => p.fs === "frogfs"));
  const littlefsPart = $derived(device.partitions.find((p) => p.fs === "littlefs"));
  const reservedEnd = $derived(
    device.partitions
      .filter((p) => p.fs !== "littlefs" && p.fs !== "frogfs")
      .reduce((m, p) => Math.max(m, p.offset + p.size), 0),
  );
  const reservedEndAligned = $derived(Math.ceil(reservedEnd / blockSize) * blockSize);
  const defaultFrogfsOffset = $derived(
    frogfsPart && frogfsPart.offset % blockSize === 0 ? frogfsPart.offset : reservedEndAligned,
  );

  const frogfsOffset = $derived.by(() => {
    const s = frogfsOffsetStr.trim();
    if (!s) return defaultFrogfsOffset;
    const n = s.toLowerCase().startsWith("0x") ? parseInt(s, 16) : parseInt(s, 10);
    const parsed = Number.isFinite(n) && n >= 0 ? n : defaultFrogfsOffset;
    // The flasher hangs if the offset is not aligned to the device's erase block size.
    return Math.ceil(parsed / blockSize) * blockSize;
  });
  const littlefsOverride = $derived.by(() => {
    const s = littlefsMiBStr.trim();
    if (!s) return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1048576) : undefined;
  });

  // Pre-fill the offset field with the real auto-computed value (rather than leaving it blank
  // with just a placeholder hint), in both modes — it's the one meaningful, always-relevant
  // number in this dropdown (SD Cache offset / FrogFS offset are the same underlying value).
  // Only ever sets it automatically; stops once the user has typed their own value.
  let frogfsOffsetUserSet = false;
  $effect(() => {
    if (!frogfsOffsetUserSet) {
      frogfsOffsetStr = hex(defaultFrogfsOffset);
    }
  });

  // Same pre-fill treatment for LittleFS size (Flash mode only — SD hides this field
  // entirely) — "8" (MiB) is the documented default floor, so show it as a real, editable
  // value up front rather than leaving the field blank. This also fixes the geometry
  // projection below: with the field blank, littlefsOverride was undefined, and with no
  // existing on-device LittleFS partition (or built install) yet to fall back to, the
  // projection had no size to draw a LittleFS region with at all.
  let littlefsMiBUserSet = false;
  $effect(() => {
    if (installMode === "flash" && !littlefsMiBUserSet) {
      littlefsMiBStr = "8";
    }
  });

  // SD mode's extflash geometry projection — same technique as InstallGeometry.svelte (used by
  // the ROMs tab's Flash install): splice a synthetic region onto the real on-device segments
  // instead of just showing the raw scan. Here that's the SD round-robin ROM cache's reserved
  // region, [SD Cache offset, end of chip) — LittleFS is deliberately ignored/superseded (SD
  // installs never use it; a stale LittleFS partition from a prior Flash install shouldn't
  // show as if it still matters), and anything else at/after the offset gets covered the same
  // way, matching what the reserved-offset boundary actually means on-device.
  const sdCacheSegments = $derived.by<GeoSegment[]>(() => {
    if (!extBytes) return [];
    const offset = Math.min(frogfsOffset, extBytes);
    type Region = { offset: number; size: number; kind: string; label: string; detail: string[] };
    const regions: Region[] = [];
    for (const p of device.partitions) {
      if (p.fs === "littlefs") continue; // ignored — superseded by the reserved region below
      if (p.offset >= offset) continue; // superseded too — anything from the boundary on is reserved
      const label = p.fs === "frogfs" ? "Games" : p.type;
      const size = Math.min(p.size, offset - p.offset); // clip if it would cross the boundary
      regions.push({ offset: p.offset, size, kind: p.fs ?? (/OFW/.test(p.type) ? "ofw" : "data"), label, detail: [label, `${MiB(size)} MB`] });
    }
    if (extBytes - offset > 0) {
      regions.push({
        offset,
        size: extBytes - offset,
        kind: "frogfs-changed",
        label: locale.t.shared.geometry.reservedSdCache,
        detail: [locale.t.shared.geometry.reservedSdCache, `${MiB(extBytes - offset)} MB`],
      });
    }
    regions.sort((a, b) => a.offset - b.offset);
    const out: GeoSegment[] = [];
    let cursor = 0;
    const free = (from: number, to: number) => {
      if (to - from > 0) out.push({ pct: ((to - from) / extBytes) * 100, kind: "free", label: "Free Space", detail: ["Free Space", `${MiB(to - from)} MB`] });
    };
    for (const r of regions) {
      if (r.offset < cursor) continue;
      free(cursor, r.offset);
      out.push({ pct: (r.size / extBytes) * 100, kind: r.kind, label: r.label, detail: r.detail });
      cursor = r.offset + r.size;
    }
    free(cursor, extBytes);
    return out;
  });

  // Flash mode's extflash geometry projection — same splice-in technique as sdCacheSegments
  // above, but for BOTH FrogFS and LittleFS, each styled independently by its own migrate
  // checkbox: migrating shows the EXISTING region (size taken from the actual on-device
  // partition) restyled as "will be replaced"; not migrating shows a fresh region instead
  // (~2 MiB default estimate for FrogFS — there's no prior content to reuse the size of;
  // LittleFS keeps its existing boundary/size either way, since that's a real on-device
  // partition boundary, just styled as "reset" when not migrating saves).
  const FROGFS_FRESH_ESTIMATE_BYTES = 2 * 1048576;
  const flashProjectionSegments = $derived.by<GeoSegment[]>(() => {
    if (!extBytes) return [];
    // Both regions are unconditionally rewritten by any install regardless of migrate state
    // (migrating just means the data read back out gets written back in) — so the "will be
    // (re)written" hatch always applies to both; only the SIZE shown differs by migrate state
    // (the real existing size when migrating something back in, a fresh/default size when not).
    const fOffset = frogfsOffset;
    const fSize = migrateGames && frogfsPart ? frogfsPart.size : FROGFS_FRESH_ESTIMATE_BYTES;
    const fKind = "frogfs-changed";
    const fLabel = migrateGames ? "Games (migrated)" : "Games (new)";

    // LittleFS grows DOWNWARD from the top of extflash (see fs-builders' downward-partition
    // layout) — so absent a real on-device partition or a built install to read the actual
    // position from, it belongs anchored to the END of the chip, not tacked on right after
    // FrogFS.
    const lSize = littlefsPart?.size ?? install?.layout.littlefsLength ?? littlefsOverride ?? 0;
    const lOffset = littlefsPart?.offset ?? install?.layout.littlefsOffset ?? (lSize > 0 ? extBytes - lSize : null);
    const lKind = "littlefs-changed";
    const lLabel = migrateLfs ? "Cores & Saves (migrated)" : "Cores & Saves (reset)";

    type Region = { offset: number; size: number; kind: string; label: string; detail: string[] };
    const regions: Region[] = [];
    for (const p of device.partitions) {
      if (p.fs === "frogfs" || p.fs === "littlefs") continue; // handled specially below
      if (p.offset >= fOffset) continue; // superseded — anything from the FrogFS boundary on is projected
      const size = Math.min(p.size, fOffset - p.offset); // clip if it would cross the boundary
      regions.push({ offset: p.offset, size, kind: /OFW/.test(p.type) ? "ofw" : "data", label: p.type, detail: [p.type, `${MiB(size)} MB`] });
    }
    if (fSize > 0) {
      regions.push({ offset: fOffset, size: fSize, kind: fKind, label: fLabel, detail: [fLabel, `${MiB(fSize)} MB`] });
    }
    if (lOffset !== null && lSize > 0) {
      regions.push({ offset: lOffset, size: lSize, kind: lKind, label: lLabel, detail: [lLabel, `${MiB(lSize)} MB`] });
    }
    regions.sort((a, b) => a.offset - b.offset);
    const out: GeoSegment[] = [];
    let cursor = 0;
    const free = (from: number, to: number) => {
      if (to - from > 0) out.push({ pct: ((to - from) / extBytes) * 100, kind: "free", label: "Free Space", detail: ["Free Space", `${MiB(to - from)} MB`] });
    };
    for (const r of regions) {
      if (r.offset < cursor) continue; // overlap guard (shouldn't happen)
      free(cursor, r.offset);
      out.push({ pct: (r.size / extBytes) * 100, kind: r.kind, label: r.label, detail: r.detail });
      cursor = r.offset + r.size;
    }
    free(cursor, extBytes);
    return out;
  });

  // A previously-built `install` is stale (needs rebuilding) if any of its inputs changed
  // since the last build. Tracked by snapshotting the inputs used for the last build.
  let builtFor: string | null = null;
  const buildKey = $derived(
    JSON.stringify([bank, selectedVersionTag, migrateGames, migrateLfs, frogfsOffset, littlefsOverride]),
  );
  const needsBuild = $derived(install === null || builtFor !== buildKey);


  /**
   * The relocation facts for the mapped artifacts this install actually writes, keyed the way
   * the packer keys them. `prepareState` recorded them from the manifest when it fetched the
   * artifact (`mappedArtifactMap()`); `bytes` is the declared length `relocateMappedInFrogfs`
   * asserts the packed entry against before it patches a word.
   *
   * A mapped artifact is placed in FrogFS whatever its role directory says, because only FrogFS
   * stores a file as one contiguous run. gba.xip is the live case: the firmware reads it with
   * `rg_frogfs_get_file_data()` rather than `fopen`, and on a flash-only build nothing else
   * relocates it (`odroid_overlay_cache_file_in_flash_relocate` runs its callback only under
   * SD_CARD == 1), so the sentinel rebase has to happen here or the core faults on its first
   * indirect call. See docs/MAPPED_ARTIFACTS.md.
   */
  function mappedArtifactsIn(roms: Map<string, Uint8Array>): Map<string, MappedSpec> | undefined {
    const all = prepareState.mappedArtifactMap();
    if (all.size === 0) return undefined;
    const out = new Map<string, MappedSpec>();
    for (const [key, data] of roms) {
      const m = all.get(key);
      if (!m) continue;
      out.set(key, { ...(m.relocBase === undefined ? {} : { relocBase: m.relocBase }), bytes: data.length });
    }
    return out.size > 0 ? out : undefined;
  }

  async function buildInstall(report: PhaseReporter) {
    err = null;
    result = null;
    preparing = true;
    install = null;
    try {
      // The layout needs the device's extflash + erase size, so the RAM util must be up.
      // Automatic unlock: a locked device is unlocked before this write, never after it
      // (engine/unlockGate.ts owns the backup-first ordering). No-op when already unlocked.
      await device.ensureUnlocked();
      report.start("prepare");
      report.log("prepare", msg((t) => t.romSection.logConnectingFlashUtil));
      const flasher = await device.ensureStub();
      report.log("prepare", msg((t) => t.romSection.logFlashUtilReady, extBytes, blockSize));
      report.finish("prepare");

      const targetVersion = selectedVersionTag;
      if (!targetVersion) throw new Error(locale.t.romSection.errNoVersionsPublished);

      report.start("download");
      report.log("download", msg((t) => t.romSection.logDownloadingBundle, targetVersion));
      // Phase-level (drawn unconditionally by InstallProgressModal); no new copy.
      const bundleT0 = Date.now();
      const bundle = await fetchBundle(targetVersion, (d, t) => report.progress("download", d, t, undefined, "bytes"));
      const bundleBytes = bundle.blobs[1].length + bundle.blobs[2].length;
      report.log("download", msg((t) => t.romSection.logBundleDownloaded, targetVersion, bundleBytes, Date.now() - bundleT0));
      report.finish("download");
      // Must follow the SELECTED bank (this view lets the user pick it): SD cores call
      // back into firmware at bank-specific absolute addresses.
      pendingSdContent = installMode === "sd" ? bundle.contentFor(bank, true) : null;

      const userRoms = new Map<string, Uint8Array>();

      // EVERY active core's binaries, packed into the LittleFS image this install flashes whole.
      //
      // This is the owner's ruling after living with the alternative. A ROM install cannot
      // rebuild the partition (it holds the saves), so it had to mount the device's filesystem
      // over SWD and write into it incrementally -- and that path is slow for reasons that are
      // structural, not a bug to tune away: our littlefs block device faults at BLOCK
      // granularity while littlefs only ever asks for 16 to 64 bytes, so every read amplifies.
      // gnwmanager is fast because its driver reads and programs exactly the bytes littlefs
      // asks for (`gnwmanager/filesystem.py`, LfsDriverContext).
      //
      // A firmware install has no such constraint: it already extracts saves and /data into
      // `lfsData` below, so it can pack the whole partition locally and flash it in one
      // sequential write. That is the path that was always fast.
      //
      // Consequence, stated rather than hidden: adding a core later means running an install
      // again. It preserves saves and takes seconds.
      await prepareState.restore(homebrew.titles);
      const coreTargets: { key: string; target: Target }[] = [];
      for (const row of sources.rows) {
        if (!row.active || !row.manifest) continue;
        for (const target of row.manifest.targets) {
          if (!isCoreKind(target.kind)) continue;
          if ((target.artifacts?.length ?? 0) === 0) continue;
          coreTargets.push({ key: `${row.repo}#${target.id}`, target });
        }
      }
      for (const { key, target } of coreTargets) {
        if (prepareState.preparedBytesFor(key) !== undefined) continue;
        try {
          await prepareState.prepareCoreArtifacts(key, target);
        } catch (e) {
          dbgLog("[install] core artifacts unavailable:", key, errText(e));
          report.log("migrate-scan", `core artifacts unavailable: ${key}: ${errText(e)}`, "lfs-extract");
        }
      }
      const CORES_PREFIX = `${deviceInstallPaths().cores}/`;
      let coreCount = 0;
      for (const [k, v] of prepareState.assets) {
        if (!k.startsWith(CORES_PREFIX)) continue;
        userRoms.set(k, v);
        coreCount++;
      }
      dbgLog("[install] cores packed into the LittleFS image:", coreCount, "file(s) from", coreTargets.length, "core source(s)");
      const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);

      // NO CORES BY DEFAULT on a flash install. The owner's rule, and it is about the medium:
      // on SD a user may drop a ROM onto the card by hand at any moment, so every core has to
      // be there already; on Flash content can only arrive through this tool, so a core follows
      // a ROM selection and this flow has none. Two earlier attempts here got it wrong in both
      // directions: installing every active source put the Doom core on the device, and
      // filtering by ROM presence installed nothing at all.
      //
      // The partition is still built WITH its directory structure (`plan.lfsDirs` -> `cores`
      // and `data`). An empty LittleFS carrying no directories reads as a failed install, and
      // `/data` has to exist regardless: it is where the firmware writes its own state.

      const lfsData = new Map<string, Uint8Array>();
      let frogfsState;
      // installMode === "flash" is required here, not just "is retro-go currently
      // installed": deviceClass.kind reflects whatever's CURRENTLY on the device
      // (which could be a prior flash install) regardless of what we're installing TO.
      // FrogFS/LittleFS migration only makes sense for a flash-mode install; there is
      // no flash->SD (or SD->SD) migration implemented. Without this check, installing
      // SD mode over a previous flash install tried to run readFrogfsState()/
      // ensureLfsTree() anyway and hung, since those reads assume a flash-mode layout.
      const isRetroGo =
        installMode === "flash" &&
        (device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old");
      report.start("migrate-scan");
      // Real decision: is this a same-version repair (forces migrateGames on) or a genuine
      // upgrade/reinstall with the checkboxes as the user set them?
      report.log(
        "migrate-scan",
        isSameVersion
          ? msg((t) => t.romSection.logSameVersionRepair, selectedVersionTag)
          : msg((t) => t.romSection.logMigrateSummary, selectedVersionTag, migrateGames, migrateLfs));
      if (isRetroGo) {
        report.subStart("migrate-scan", "frogfs-state");
        const stateWindow = extBytes - defaultFrogfsOffset;
        try {
          frogfsState = await readFrogfsState(read, defaultFrogfsOffset, stateWindow);
          report.log("migrate-scan", msg((t) => t.romSection.logReadPreviousGameState, hex(defaultFrogfsOffset), stateWindow), "frogfs-state");
          report.subFinish("migrate-scan", "frogfs-state");
        } catch (e) {
          report.log("migrate-scan", msg((t) => t.romSection.logCouldNotReadPreviousGameState, hex(defaultFrogfsOffset), stateWindow, errText(e)), "frogfs-state");
          report.subFinish("migrate-scan", "frogfs-state");
        }

        report.subStart("migrate-scan", "lfs-extract");
        try {
          const lfsTree = await ensureLfsTree();
          async function extractLfs(node: LittlefsTreeNode, pathPrefix: string) {
            for (const child of node.children || []) {
              const fullPath = pathPrefix + child.name;
              if (child.isDirectory) {
                await extractLfs(child, fullPath + "/");
              } else {
                lfsData.set(fullPath, await readLfsFile(fullPath));
              }
            }
          }
          const dataDir = lfsTree.children?.find((c) => c.name === "data" && c.isDirectory);
          if (dataDir) await extractLfs(dataDir, "data/");
          const configFile = lfsTree.children?.find((c) => c.name === "CONFIG" && !c.isDirectory);
          if (configFile) lfsData.set("CONFIG", await readLfsFile("CONFIG"));
          report.log("migrate-scan", msg((t) => t.romSection.logExtractedSavesData, lfsData.size, sumBytes(lfsData)), "lfs-extract");
          report.subFinish("migrate-scan", "lfs-extract");
        } catch (e) {
          report.log("migrate-scan", msg((t) => t.romSection.logCouldNotExtractSavesData, errText(e)), "lfs-extract");
          report.subFinish("migrate-scan", "lfs-extract");
        }
      } else {
        report.subFinish("migrate-scan", "frogfs-state");
        report.subFinish("migrate-scan", "lfs-extract");
      }

      report.subStart("migrate-scan", "games-migrate");
      if (isRetroGo && migrateGames && device.installedGames.length > 0) {
        for (const g of device.installedGames) {
          const path = `${g.system}/${g.name}`;
          if (!userRoms.has(path)) {
            userRoms.set(path, await readGameData(read, defaultFrogfsOffset, g));
          }
        }
        report.log("migrate-scan", msg((t) => t.romSection.logMigratedGames, device.installedGames.length), "games-migrate");
      } else {
        report.log("migrate-scan", msg((t) => t.romSection.logSkippedGameMigration, isRetroGo && migrateGames, device.installedGames.length), "games-migrate");
      }
      report.subFinish("migrate-scan", "games-migrate");
      report.finish("migrate-scan");

      // Build selectedHomebrew from the ACTIVE sources' manifests. A SELF-CONTAINED title
      // (one whose converter needs no user file — what "celeste" used to be hardcoded as) is
      // always included; every other title is kept only if the userRoms map (which includes
      // migrated on-device games) already has ANY of its device files.
      const selectedHomebrew = new Set<string>();
      for (const hb of homebrew.titles) {
        if (hb.selfContained || hb.deviceFiles.some((f) => userRoms.has(`homebrew/${f}`))) {
          selectedHomebrew.add(hb.key);
        }
      }

      report.start("build");
      report.subStart("build", installMode === "sd" ? "sdcache" : "frogfs");
      install = await buildFlashInstall({
        bundle,
        bank,
        extflashSize: extBytes,
        blockSize,
        userRoms,
        reservedOffset: frogfsOffset,
        frogfsState,
        littlefsLength: littlefsOverride,
        lfsData,
        sdCard: installMode === "sd",
        mappedArtifacts: mappedArtifactsIn(userRoms),
        opts: {
          selectedHomebrew,
          homebrewTitles: homebrew.titles,
        },
        onStep: (step) => {
          if (step === "frogfs") {
            report.log("build", msg((t) => t.romSection.logGamesBiosLanguagesBuilt), "frogfs");
            report.subFinish("build", "frogfs");
            report.subStart("build", "littlefs");
          } else if (step === "littlefs") {
            report.log("build", msg((t) => t.romSection.logCoresSavesBuilt), "littlefs");
            report.subFinish("build", "littlefs");
            report.subStart("build", "superblock");
          } else if (step === "superblock") {
            report.log("build", msg((t) => t.romSection.logSuperblockPatched), "superblock");
            report.subFinish("build", "superblock");
          } else if (step === "sdcache") {
            report.log(
              "build",
              msg((t) => t.romSection.logSdCacheBoundarySet, frogfsOffset),
              "sdcache");
            report.subFinish("build", "sdcache");
          }
        },
      });
      builtFor = buildKey;
      report.finish("build");

      // Stall mitigation (hypothesis, NOT proven — see CLAUDE.md / plan notes): the
      // CPU/WASM-heavy build above runs with zero wall-clock pause, unlike the old
      // two-click Build-then-Flash flow. Give the link a beat + a liveness ping before
      // the first flash write, mirroring the existing 500ms post-flash settle in
      // engine/flasher.ts. This does not touch the flashImage() 120s stall watchdog itself.
      // Deliberately NOT a visible phase — this is an internal mitigation detail, not
      // something the user needs to see as its own checklist step.
      const pingT0 = Date.now();
      await new Promise((r) => setTimeout(r, 500));
      const stubAlive = device.transport
        ? await raceWithFallback(isStubAlive(device.transport), 2500, false)
        : false;
      report.log("flash", msg((t) => t.romSection.logConfirmingLinkResponsive, stubAlive, Date.now() - pingT0));
    } catch (e) {
      err = e instanceof BudgetError ? e.message : e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      preparing = false;
    }
  }

  async function run(report: PhaseReporter) {
    const inst = install!;
    const sizes: Record<string, number> = {
      intflash: inst.intflash.length,
      frogfs: inst.frogfs.length,
      littlefs: inst.littlefs.length,
    };

    // For SD mode, only flash the intflash region.
    const actualFlashTarget = installMode === "sd"
      ? flashTarget.filter(r => r === "intflash")
      : flashTarget;

    if (actualFlashTarget.length === 0) return;

    if (installMode !== "sd") {
      // Defensive capacity guard: the external-flash payload (FrogFS + LittleFS) must fit the chip.
      const extPayload = inst.frogfs.length + inst.littlefs.length;
      if (!device.fitsExtFlash(extPayload)) {
        throw new Error(locale.t.romSection.errExternalPayloadTooBig(MiB(extPayload), MiB(extBytes)));
      }
    }

    report.start("flash");
    const totalB = actualFlashTarget.reduce((n, r) => n + sizes[r], 0);
    device.suspendPoll();
    try {
      await flashInstallToDevice(
        // Silent, but forwards flashImage's own retry-driven `force` flag — consent already
        // granted via "prepare"'s unforced ensureStub() call above; any mid-flash reboot
        // needed to recover from a stall must never re-prompt, but this must still reuse the
        // live cached stub whenever possible rather than resetting the device on every call.
        (force) => device.ensureStub(undefined, force, true),
        inst,
        (phase, d, t) => {
          report.progress("flash", d, t, phase, "bytes");
        },
        (line: string) => {
          dbgLog(line);
          report.log("flash", line);
        },
        actualFlashTarget,
        (region, event) => {
          if (event === "start") report.subStart("flash", region);
          else report.subFinish("flash", region);
        },
        report.signal,
      );
    } finally {
      device.resumePoll();
    }
    report.finish("flash");

    report.start("rescan");
    report.log("rescan", msg((t) => t.romSection.logRescanning));
    await device.runScan("after firmware install"); // big change → rescan the device geometry (docs/ARCHITECTURE.md "Device Scan & Classification")
    report.finish("rescan");

    // SD mode also writes the bundle's cores/bios/fonts content to the SD card — mirrors
    // Wizard.svelte's step 2 exactly (device.sdHandle write-back, or a ZIP download fallback
    // on Firefox where there's no File System Access API / no writable handle at all).
    if (installMode === "sd" && pendingSdContent) {
      report.start("sd-sync");
      report.log("sd-sync", msg((t) => t.romSection.logSdSyncFoundItems, pendingSdContent.size, sumBytes(pendingSdContent)));
      if (device.sdHandle) {
        let doneFiles = 0;
        const totalFiles = pendingSdContent.size;
        for (const [path, data] of pendingSdContent) {
          report.log("sd-sync", msg((t) => t.romSection.logSdSyncCopyingFile, path, data.length));
          await saveFileToDirOrDownload(device.sdHandle, path, data);
          doneFiles++;
          report.progress("sd-sync", doneFiles, totalFiles);
        }
      } else {
        report.log("sd-sync", msg((t) => t.romSection.logSdSyncNoHandleZipFallback, pendingSdContent.size));
        const zip = new JSZip();
        for (const [path, data] of pendingSdContent) zip.file(path, data);
        const blob = await zip.generateAsync({ type: "blob" });
        download(locale.t.romSection.sdSyncZipFilename, blob);
      }
      report.finish("sd-sync");
    }
  }

  // Confirm-modal copy adapts to the ACTUAL write scope, not the pre-SD-filter selection —
  // SD mode only ever writes intflash regardless of `flashTarget` (see `run()`'s
  // `actualFlashTarget`), so the copy must reflect that same restriction or it misleadingly
  // shows regions (e.g. FrogFS) that will never actually be written.
  const displayFlashTarget = $derived(
    installMode === "sd" ? flashTarget.filter((r) => r === "intflash") : flashTarget,
  );
  const DISPLAY_REGION_NAMES: Record<FlashRegion, string> = {
    intflash: locale.t.romSection.regionInternalFirmware,
    frogfs: locale.t.romSection.regionGamesBiosLanguages,
    littlefs: locale.t.romSection.regionCoresSaves,
  };
  const flashTitle = $derived(
    displayFlashTarget.length === FLASH_REGIONS.length
      ? locale.t.romSection.flashThisInstall
      : locale.t.romSection.flashRegions(displayFlashTarget.map((r) => DISPLAY_REGION_NAMES[r]).join(" + ")),
  );
  const flashBody = $derived.by(() => {
    if (!install) return "";
    const names: Record<FlashRegion, string> = {
      intflash: locale.t.romSection.nameInternalFirmware(install.bank),
      frogfs: locale.t.romSection.nameGamesBiosLanguages(hex(EXTBASE + install.layout.frogfsOffset)),
      littlefs: locale.t.romSection.nameCoresSaves(hex(EXTBASE + install.layout.littlefsOffset)),
    };
    return locale.t.romSection.flashBody(displayFlashTarget.map((r) => names[r]).join(", "));
  });

  // Debug: read the superblock back from flash and compare to the patched blob.
  let sbCheck = $state<string | null>(null);
  async function checkSuperblock() {
    sbCheck = "reading…";
    try {
      if (!install) return (sbCheck = "Build an install first.");
      if (!device.isConnected) return (sbCheck = "Connect first.");
      const flasher = await device.ensureStub();
      const off = locateSuperblock(install.intflash);
      const onDev = await dumpRegion(flasher, install.bank, off, SUPERBLOCK_SIZE);
      const exp = install.intflash.subarray(off, off + SUPERBLOCK_SIZE);
      const match = onDev.every((b, i) => b === exp[i]);
      const sb = readSuperblock(onDev, 0);
      sbCheck =
        `@bank${install.bank}+${hex(off)} flash==patched: ${match}\n` +
        `on-device: magic=${hex(sb.magic)} ver=${sb.version} sz=${sb.structSize} ` +
        `extsz=${sb.extflashSize} lfslen=${sb.littlefsLength} flags=${sb.flags} crc=${hex(sb.crc32)}`;
    } catch (e) {
      sbCheck = e instanceof Error ? e.message : String(e);
    }
  }

  // Start (jump to + run) the firmware in a bank — session-only boot for testing
  // (a cold power-cycle reverts to the default boot bank).
  let starting = $state(false);
  let startResult = $state<string | null>(null);
  async function startBank(b: number) {
    if (!device.isConnected) return (startResult = "Connect first.");
    starting = true;
    startResult = null;
    try {
      await (await device.ensureStub()).startBank(b);
      startResult = locale.t.romSection.startedBankResult(b);
    } catch (e) {
      startResult = e instanceof Error ? e.message : String(e);
    } finally {
      starting = false;
    }
  }

  // Live layout preview — uses the built image sizes once available, else 0/floor, so
  // the configured FrogFS offset + LittleFS size update the bar as the user types.
  const coresBytes = $derived(
    install ? install.plan.coreFiles.reduce((n, f) => n + f.data.length, 0) : 0,
  );
  const frogBytes = $derived(install ? install.frogfs.length : 0);
  const previewLayout = $derived.by(() =>
    extBytes
      ? planFlashLayout({
          extflashSize: extBytes,
          frogfsLength: frogBytes,
          coresSize: coresBytes,
          blockSize,
          reservedOffset: frogfsOffset,
          littlefsLength: littlefsOverride,
        })
      : null,
  );
  // Absolute extflash addresses + end-of-device validation.
  const geom = $derived.by(() => {
    if (!previewLayout) return null;
    const L = previewLayout;
    const fEnd = L.frogfsOffset + L.frogfsLength;
    const lEnd = L.littlefsOffset + L.littlefsLength;
    return {
      fStart: EXTBASE + L.frogfsOffset,
      fEnd: EXTBASE + fEnd,
      lStart: EXTBASE + L.littlefsOffset,
      lEnd: EXTBASE + lEnd,
      devEnd: EXTBASE + L.deviceEndOffset,
      endsAtChip: lEnd === L.deviceEndOffset, // LittleFS ends exactly at the chip end
      noOverlap: fEnd <= L.littlefsOffset,
      aligned: L.aligned,
    };
  });

</script>

<div class="stack">
    <!-- Version picker — clean and minimal. The currently-installed version is already shown in
         the status bar, so there's no need to repeat an "installed → target" chip pair here;
         just a plain prompt for which version to install. -->
    <label class="field version">
      <span>{locale.t.romSection.installVersionLabel}</span>
      <div class="version-row">
      <select
        class="mono"
        bind:value={selectedVersionTag}
        onchange={(e) => pickVersion(e.currentTarget.value)}
        disabled={versions.length === 0}
      >
        {#each versions as v (v.tag)}
          <option value={v.tag}>{v.tag}{v.prerelease ? " (pre)" : ""}</option>
        {/each}
      </select>
      <!-- Icon only: the label beside it already says what the row is about, and a second word
           here would be the narration docs/UI_VOICE.md rules out. The accessible name says what
           the control DOES, not what it looks like. -->
      <button
        type="button"
        class="version-refresh"
        onclick={() => void doRefreshVersions()}
        disabled={refreshCooldown || refreshingVersions}
        title={locale.t.romSection.refreshVersions}
        aria-label={locale.t.romSection.refreshVersions}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" class:spin={refreshingVersions}>
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <path d="M13.6 2.4v3.2h-3.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      </div>
    </label>

    {#if installMode === "flash" && deviceHasRetroGoInstalled}
      <!-- Firmware.dc.html:100 — the two option rows are one column at `gap: 14px`. -->
      <div class="field optgroup" style="flex-direction: column; align-items: flex-start;">
        <label class="row" style="cursor: {frogfsPart ? 'pointer' : 'not-allowed'};" class:migrate-disabled={!frogfsPart}>
          <input type="checkbox" bind:checked={migrateGames} disabled={!frogfsPart} />
          <span>{locale.t.romSection.migrateGamesLabel}</span>
        </label>
        <label class="row" style="cursor: {littlefsPart ? 'pointer' : 'not-allowed'};" class:migrate-disabled={!littlefsPart}>
          <input type="checkbox" bind:checked={migrateLfs} disabled={!littlefsPart} />
          <span>{locale.t.romSection.migrateSavesLabel}</span>
        </label>
      </div>
    {/if}

    <!-- Bank selector — same bank visualization as the Overview tab (BankCard.svelte), made
         clickable: the selected bank is highlighted, the other dims, so the choice reads
         clearly at a glance instead of a plain <select>. Front-and-center, right after the
         version — this is the main decision an install makes. -->
    <!-- Firmware.dc.html:119-141 — a `Target` label over the two cards, and each card carries
         its own sub-caption (`Replaces stock` / `Dual boot`) instead of one composed sentence
         below both. -->
    <div class="targetgroup">
    <span class="field-label">{locale.t.romSection.bankTargetLabel}</span>
    <div class="bank-picker">
      <BankCard bankNum={1} segs={bank1Segs} selectable selected={bank === 1} onSelect={() => (bankUserOverride = 1)}>
        {#snippet footer()}<span class="bank-sub">{locale.t.romSection.bankReplacesStock}</span>{/snippet}
      </BankCard>
      <BankCard bankNum={2} segs={bank2Segs} selectable selected={bank === 2} onSelect={() => (bankUserOverride = 2)}>
        {#snippet footer()}<span class="bank-sub">{locale.t.romSection.bankDualBoot}</span>{/snippet}
      </BankCard>
    </div>
    <!-- These three notices annotate the target choice directly above them. No artboard draws
         them, so they are not a group in the artboard's 32px body rhythm; they live INSIDE the
         target group at its own 12px so they stay attached to the picker they qualify. -->
    {#if retroGoOnlyInstall}
      <p class="notice">
        {locale.t.romSection.retroGoOnlyNotice}
      </p>
    {:else if bank === 2 && bank1StockOfw}
      <p class="notice warn">
        {locale.t.romSection.bank1StockOfwNotice}
      </p>
    {/if}
    {#if installOriginMismatch}
      <p class="notice warn">
        {locale.t.romSection.installOriginMismatchNotice(installOriginMismatch === "flash" ? "Flash" : "SD", installMode === "sd" ? "SD" : "Flash")}
      </p>
    {/if}
    </div>

    <!-- Layout (advanced): expert overrides + the device's current flash-layout geometry, both
         tucked away by default — neither is interesting for a typical install (and the
         geometry bar specifically has nothing meaningful to say for an SD install). -->
    {#if layoutOpen}
      <div class="sub">
        <div class="sub-body">
          <label class="field">
            <span>{installMode === "sd" ? locale.t.romSection.sdCacheOffsetLabel : locale.t.romSection.frogfsOffsetLabel} <em>{locale.t.romSection.offsetHint}</em></span>
            <input
              class="mono"
              bind:value={frogfsOffsetStr}
              oninput={() => (frogfsOffsetUserSet = true)}
              placeholder={locale.t.romSection.autoPlaceholder(hex(defaultFrogfsOffset))}
            />
          </label>
          {#if installMode !== "sd"}
            <label class="field"><span>{locale.t.romSection.littlefsSizeLabel} <em>{locale.t.romSection.littlefsSizeHint}</em></span>
              <span class="unit-input">
                <input
                  class="mono"
                  bind:value={littlefsMiBStr}
                  oninput={() => (littlefsMiBUserSet = true)}
                  placeholder={locale.t.romSection.littlefsSizePlaceholder}
                />
                <span class="unit">{locale.t.romSection.mbUnit}</span>
              </span>
            </label>
            <p class="muted">
              {locale.t.romSection.layoutDefaultsNote(blockSize)}
            </p>
          {/if}

          <!-- Current on-device flash layout (from the scan). Grayed until a scan has run.
               Internal-flash geometry is deliberately omitted here — the bank selector above
               already shows that (superfluous to repeat it). SD mode projects the SD cache's
               reserved region onto the bar (same technique as the ROMs tab's Flash install
               geometry preview) instead of the raw scan. -->
          <div class="devgeo" class:dim={!deviceScanned && !device.scanning}>
            {#if deviceScanned || device.scanning}
              {#if device.scanning}
                <div class="scanning mono">
                  <div class="track"><div class="fill" style="width:{Math.round(device.scanProgress * 100)}%"></div></div>
                  <span>{locale.t.romSection.scanningProgress(Math.round(device.scanProgress * 100))}</span>
                </div>
              {:else if device.scanError}
                <div class="scanerr mono">{locale.t.romSection.scanFailed(device.scanError)}</div>
              {:else if installMode === "sd" && sdCacheSegments.length}
                <GeometryBar size="tall" segments={sdCacheSegments} title={locale.t.shared.geometry.externalFlash} leftLabel={hex(EXTBASE)} rightLabel={hex(extEnd)} />
              {:else if installMode !== "sd" && flashProjectionSegments.length}
                <GeometryBar size="tall" segments={flashProjectionSegments} title={locale.t.shared.geometry.externalFlash} leftLabel={hex(EXTBASE)} rightLabel={hex(extEnd)} />
              {:else if extSegs.length}
                <GeometryBar size="tall" segments={extSegs} title={locale.t.shared.geometry.externalFlash} leftLabel={hex(EXTBASE)} rightLabel={hex(extEnd)} />
              {/if}
            {:else}
              <p class="muted">{locale.t.romSection.scanToSeeLayout}</p>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if !device.isConnected}
      <p class="muted">{locale.t.romSection.connectToSizeAndFlash}</p>
    {/if}

    {#if err}
      <p class="notice warn">{err}</p>
    {/if}

    <!-- Firmware.dc.html:149 — the pane's one primary action lives in the anchored 72px
         footer bar, beside the "Advanced layout" disclosure that reveals the expert
         overrides above (the artboard shows the toggle there, not in the body). PaneFooter
         renders nothing in place; FirmwareRail draws the bar as the pane column's 2nd child. -->
    <PaneFooter summary={footerSummary}>
      <button class="footlink" aria-expanded={layoutOpen} onclick={() => (layoutOpen = !layoutOpen)}
        >{locale.t.romSection.layoutAdvancedToggle}</button
      >
      {#if device.isConnected}
        <Button variant="action" disabled={flashing} onclick={onFlashButtonClick}>{flashButtonLabel}</Button>
      {/if}
    </PaneFooter>

    {#if install && geom}
      <div class="well mono">
        <div>{locale.t.romSection.wellFrogfsLine(`${hex(geom.fStart)} – ${hex(geom.fEnd)}`, MiB(install.frogfs.length))}</div>
        <div>{locale.t.romSection.wellLittlefsLine(`${hex(geom.lStart)} – ${hex(geom.lEnd)}`, MiB(install.littlefs.length))}</div>
        <div>{locale.t.romSection.wellDeviceEndLine(hex(geom.devEnd), blockSize, MiB(install.layout.freeBytes))}</div>
        <div class:bad={!(geom.endsAtChip && geom.noOverlap && geom.aligned)}>
          {locale.t.romSection.wellChecksLine(geom.endsAtChip, geom.noOverlap, geom.aligned)}
        </div>
        <div>{locale.t.romSection.wellSystemsLine(install.plan.systems.join(", "))}</div>
      </div>

      {@const mainBank = install.bank}
      {@const otherBank = install.bank === 1 ? 2 : 1}
      <div>
        <SplitButton
          variant="default"
          label={locale.t.romSection.startBankLabel(mainBank)}
          disabled={starting || flashing || !device.isConnected}
          onclick={() => startBank(mainBank)}
          items={[{ label: locale.t.romSection.startBankLabel(otherBank), onclick: () => startBank(otherBank) }]}
        />
        {#if startResult}<pre class="dbgout mono">{startResult}</pre>{/if}
      </div>

      <div>
        <button class="dbglink" onclick={checkSuperblock}>{locale.t.romSection.readBackSuperblockDebug}</button>
        {#if sbCheck}<pre class="dbgout mono">{sbCheck}</pre>{/if}
      </div>
    {/if}
  </div>

<style>
  /* Firmware.dc.html:80 — the pane body stacks its groups 32px apart (the same rhythm
     `.pane.narrow .panebody` already uses one level up). The undrawn notices are not peers of
     those groups: they were moved inside `.targetgroup` so they keep its 12px and stay tight to
     the picker they annotate. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    margin: 0;
  }
  .unit-input {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .unit-input input {
    width: 4.5ch;
    text-align: end;
  }
  .unit-input .unit {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: var(--fs-caption);
  }
  .migrate-disabled {
    opacity: 0.45;
  }
  /* Firmware.dc.html:87-89 — a 13px/500 --ink-soft label over a 40px `2px`-radius control,
     `padding: 0 12px`, 9px apart. */
  .version {
    gap: 9px;
  }
  /* `.field` is a column (label above control), so the refresh has to share a ROW with the
     select rather than being a third child of the field. */
  .version-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .version-row select {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Sits with the select, not after the field: it acts on that control. Sized to the select's
     own line so it does not change the row's height. */
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
  /* Only while a fetch is in flight. The 10 s lockout is deliberately silent: a control that
     keeps spinning after its work is done is lying about what it is waiting for. */
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
  /* Firmware.dc.html:119 — the `Target` label sits 12px above its two cards. */
  .targetgroup {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  /* Firmware.dc.html:100 — the two option rows are 14px apart. */
  .optgroup {
    gap: 14px;
  }
  .version > span {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  .version select {
    height: 40px;
    padding: 0 12px;
  }
  /* Firmware.dc.html:101-116 — the option marks are 17px `2px`-radius squares filling
     --zelda-green with a white 11px check, 11px from their 14px label. The control stays a
     real <input type="checkbox">; only its paint is ours. */
  .row {
    display: flex;
    align-items: center;
    gap: 11px;
    font-size: var(--fs-caption);
  }
  .row input[type="checkbox"] {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    border: 1px solid var(--silver-edge);
    border-radius: 2px;
    background: var(--surface);
    cursor: inherit;
  }
  .row input[type="checkbox"]:checked {
    border-color: var(--zelda-green);
    background:
      var(--zelda-green)
      url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 20 20' fill='none' stroke='%23ffffff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.5 10.5l3.5 3.5 7.5-8'/%3E%3C/svg%3E")
      center / 11px 11px no-repeat;
  }
  .row input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
  }
  input,
  select {
    font: inherit;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
  }
  .field em {
    color: var(--ink-soft);
    font-style: normal;
    font-size: var(--fs-micro);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .sub {
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
  }
  /* Firmware.dc.html:152 — `font-size: 14px; font-weight: 500; color: #5c5c5c`, plain text
     with no button chrome. Keyboard focus keeps a visible ring (no bare `outline: none`). */
  .footlink {
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 500;
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .footlink:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 3px;
  }
  /* Firmware.dc.html:121 — the two Target cards are a two-up grid, not a flex row:
     `grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 460px`.
     The cap is what keeps the pair from stretching across the full pane width. */
  .bank-picker {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    max-width: 460px;
    min-width: 0;
  }
  /* Firmware.dc.html:120 — the `Target` label is the same 13px/500 --ink-soft as the other
     field labels on this pane. */
  .field-label {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  /* Firmware.dc.html:129/139 — the per-card sub-caption, 12px --ink-soft. */
  .bank-sub {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .sub-body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.6rem;
  }
  .well {
    background: var(--surface-sunk);
    padding: 0.55rem 0.7rem;
    font-size: var(--fs-micro);
    overflow-x: auto;
    white-space: nowrap;
  }
  .well > div {
    line-height: 1.5;
  }
  .notice {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.5rem 0.65rem;
  }
  .notice.warn {
    color: var(--caution);
  }
  .dbglink {
    font: inherit;
    font-size: var(--fs-micro);
    background: none;
    border: none;
    color: var(--ink-soft);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .dbgout {
    margin: 0.4rem 0 0;
    background: var(--surface-sunk);
    padding: 0.55rem 0.7rem;
    font-size: var(--fs-micro);
    white-space: pre-wrap;
    word-break: break-all;
  }
  /* Device-layout geometry aid (moved here from the top status). */
  .devgeo {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .devgeo.dim {
    opacity: 0.45;
  }
  .scanning {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .track {
    flex: 1;
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
  .scanerr {
    font-size: var(--fs-micro);
    color: var(--danger);
  }
</style>
