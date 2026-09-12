<script module lang="ts">
  // Module-level (not component-instance) so it survives this component being torn down and
  // remounted on every tab switch — tracks the SD handle already auto-scanned so revisiting the
  // ROMs tab doesn't re-walk the whole SD card every time (see the onMount comment below). Keyed
  // on the handle itself, not a plain boolean, so picking a genuinely different SD folder
  // mid-session still triggers one fresh scan for it.
  let sdAutoScannedHandle: unknown = null;
</script>

<script lang="ts">
  // Tab — ROM Management. Three drop-downs, top → bottom:
  //   1. Select games  — the folder ∪ device game list; pick what to install (drives Install ROMs).
  //   2. Library Extras — per-game enrichments (cover art, saves, cheats).
  //   3. Install ROMs   — version-agnostic FrogFS repack from the SELECTION (non-destructive).
  // The ROM FOLDER is OPTIONAL. The on-device games come from device.installedGames (FrogFS read).
  // See memory: romgr-install-architecture.
  import { onMount } from "svelte";
  import { library } from "../library.svelte.js";
  import { nativeFolderPickerSupported, pickFolder, saveFileToDirOrDownload, deleteFileFromDir, readTextFromDir, scanRomDirectory, getValidRoot, dirSupportsWriteBack, romBytes, materialize, type LibraryFile } from "../romScan.js";
  import { deviceInstallPaths, rememberInstallPaths, sdDestPath } from "../engine/devicePaths.js";
  import {
    scanLegacyHomebrew,
    readyToMove,
    movePlan,
    moveLegacyHomebrew,
    removeLegacyDirIfEmpty,
    rememberDeclinedMove,
    cardHomebrewLayout,
    moveDestination,
    LEGACY_HOMEBREW_DIR,
  } from "../sdHomebrewMigration.js";
  import { fetchVersions, fetchManifest } from "../firmwareDist/client.js";
  import { resolveInstallPaths, type InstallPaths } from "@gnw/fs-builders";
  import { sdStorage } from "../sdStorage.svelte.js";
  import { HOMEBREW_KEY_PREFIX } from "../sources/placement.js";
  import { favorites, toDevicePath, isFavoritable, FAVORITES_DEVICE_PATH } from "../favorites.svelte.js";
  import { writeFilesToDeviceLfs } from "../engine/lfsWrite.js";
  import { readLfsFile } from "../engine/lfsBrowser.js";
  import type { StagedFile } from "@gnw/fs-builders";
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { romSelection, type Game, classifyContentPath, type ContentCategory, pressAddsBytes } from "../romSelection.svelte.js";
  import { buildFrogfsImage, flashFrogfsRegion } from "../engine/flashInstall.js";
  import type { MappedSpec } from "@gnw/fs-builders";
  import { readGameData, type InstalledGame } from "../engine/frogfsDevice.js";
  import { homebrew, type HomebrewTitle } from "../sources/homebrewTitles.svelte.js";
  import { coreRegistry } from "../sources/coreRegistry.svelte.js";
  import { localFolders, displayName } from "../sources/localFolders.svelte.js";
  import { sources } from "../sources/store.svelte.js";
  import { type OfferedFile } from "../sources/inputGate.js";
  import { prepareState, type ShippedGameFetch } from "../sources/prepareState.svelte.js";
  import { selectedPreparedAssets } from "../sources/selectedAssets.js";
  import { applyCorePolicy, strandedCoreKeys, unusedCores } from "../sources/coreGate.js";
  import { adoptInputFolder, discoverForSource, discoverySignature } from "../sources/discoveryWire.svelte.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { dbg, dbgLog } from "../debug.js";
  import { diffFrogfs, movedCategories } from "../frogfsDiff.js";
  import type { FlashAssemblyPlan } from "@gnw/fs-builders";
  import { listVersions, fetchBundle, type FirmwareVersion } from "../artifacts.js";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { msg, errText, sumBytes } from "../logEntry.js";
  import { isStubAlive } from "../engine/flasher.js";
  import { raceWithFallback } from "../engine/timeout.js";
  import ModalShell from "../ui/ModalShell.svelte";
  import { filterLibraryRows, countFavorites } from "../libraryFilter.js";
  import { sortLibraryRows, LIBRARY_SORT_KEYS } from "../librarySort.js";
  import type { LibrarySortKey, SortDirection } from "../librarySort.js";
  import FilePromptModal from "../ui/FilePromptModal.svelte";
  import { type ChangeItem } from "../ui/ChangeSummary.svelte";
  import { biosState } from "../sources/biosState.svelte.js";
  import { basePath } from "../sources/libraryScan.js";
  import { type BiosStatus } from "../sources/bios.js";
  import { type ConverterInput } from "../sources/converterTypes.js";
  import { type Target } from "../sources/types.js";
  import { type PreparedTool } from "../sources/converter.js";
  import { biosSummaryDecision, composeSummaryRows } from "../sources/summaryRows.js";
  import { consoleLabel } from "../engine/consoles.js";
  import StatPanel, { type StatRow } from "../ui/StatPanel.svelte";
  import Carousel from "../ui/Carousel.svelte";
  import RefreshButton from "../ui/RefreshButton.svelte";
  import StatusChip from "../ui/StatusChip.svelte";
  import GameDetailsPanel from "./GameDetailsPanel.svelte";
  import { download, formatSize } from "../util.js";
  import JSZip from "jszip";

  let dismissedFirefoxWarning = $state(false);

  // Which bottom drawer is open, if any. Deliberately plain component-local state and NOT the
  // installProgress store: that store exists for "must never disappear mid-operation" progress
  // UI (see CLAUDE.md / AUDIT_NOTES #17). A presentation drawer the user can dismiss at will is
  // exactly the opposite case.
  /** The bottom dock's drawer. SUMMARY ONLY now: the options left the dock for a modal, so this
   *  is no longer a two-way choice between drawers that could never both be open. */
  let openDrawer = $state<"summary" | null>(null);
  /** The additional-options modal, opened from the info pane's button and nowhere else. */
  let optionsOpen = $state(false);

  // Fire the folder-gate modal as soon as this tab is shown, if required folders are missing.
  // Also apply the connection policy for this tab (SD+ROMs: never auto-connect; Flash+ROMs:
  // silently attempt the known/trusted adapter in the background, no modal — see
  // device.autoProbeRoms()'s doc comment).
  onMount(() => {
    library.ensureFolders(device.targetMedia === "sd").catch(() => {});
    device.autoProbeRoms();
    // device.sdHandle persists across page reloads (IndexedDB), but device.installedGames
    // does NOT — it only gets populated by a real scan of the SD card's contents. Without this,
    // the first time this tab is visited with a silently-restored handle (not freshly picked
    // this session) would leave installedGames empty, making doSdSync's changedSdUserRoms()
    // treat every sync as a "fresh target" and write the ENTIRE selection instead of just what
    // changed. Re-scan once per distinct handle — NOT on every mount/tab-revisit, which would
    // re-walk the entire SD card's contents every time for no reason; any operation that
    // actually changes what's on the card already re-scans afterward (runInstall/doSdSync's own
    // post-write rescan), and the user can always force one via the header's manual rescan.
    // The await is what makes the paragraph above TRUE rather than merely intended. The handle
    // is read back from IndexedDB, so on a fresh load it is not here yet: this test ran against
    // a null handle, found nothing to scan, and the "silently-restored handle" case it was
    // written for never fired. Resolves instantly once the restore has settled.
    void device.whenSdRestored().then(() => {
      if (device.targetMedia === "sd" && device.sdHandle && device.sdHandle !== sdAutoScannedHandle) {
        sdAutoScannedHandle = device.sdHandle;
        void device.scanSdCardGames();
      }
      // A card still holding the pre-manifest `roms/homebrew`. Offered here because this is where
      // the Library meets the card, and offered at most once per card -- `offerHomebrewMove` is
      // itself the gate, and stays silent unless the modern layout is established. Inside the
      // same await for the same reason: on a fresh load the handle is not here yet.
      if (device.targetMedia === "sd" && device.sdHandle) void offerHomebrewMove(device.sdHandle);
    });
    // The sort menu's dismissal, the same shape DeviceHeader's language picker uses: a click
    // anywhere outside the control closes it, including on the trigger itself, which toggles.
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".sortpick")) sortMenuOpen = false;
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });

  /**
   * Offer to move a card's legacy homebrew, and do it if the user says yes.
   *
   * Every reason NOT to ask is decided in `sdHomebrewMigration.ts` and logged rather than
   * shown -- an unknown firmware layout is the important one, and it is silence by design.
   * Declining is remembered against the card, so this cannot nag on every visit.
   */
  /** One file's bytes off the card, or null when it is not there. Absence is not an error. */
  async function readCardBytes(root: any, path: string): Promise<Uint8Array | null> {
    try {
      const parts = path.split("/");
      let dir: any = root;
      for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
      const fh = await dir.getFileHandle(parts[parts.length - 1]);
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }

  /**
   * The install paths the release carrying this `gitTag` declares, or null when none does.
   *
   * The version index carries `gitTag` on each entry precisely so a picker can filter before
   * fetching a manifest, so this costs one index fetch plus one manifest, never a bundle. The
   * manifest is authoritative on disagreement (the contract says so), so its own
   * `firmware.gitTag` is re-checked and a mismatch is a miss rather than a near-enough answer.
   *
   * Returning null rather than throwing for "no such release" keeps the distinction the gate
   * draws: a tag we cannot place is `no-release`, a fetch that failed is `lookup-failed`, and
   * both are silence.
   */
  async function pathsForGitTag(gitTag: string): Promise<InstallPaths | null> {
    const index = await fetchVersions();
    const entry = index.versions.find((v) => v.gitTag === gitTag);
    if (!entry) return null;
    const manifest = await fetchManifest(entry);
    if (manifest.firmware?.gitTag && manifest.firmware.gitTag !== gitTag) return null;
    return resolveInstallPaths(manifest.paths);
  }

  async function offerHomebrewMove(root: any): Promise<void> {
    const t = () => locale.t.roms.sdHomebrewMove;

    // LAZY, AND IN THIS ORDER. The legacy directory is read first because it is local and free;
    // the firmware lookup below reaches the network, and a card with nothing to migrate must
    // not pay for it. `LEGACY_HOMEBREW_DIR` as the destination here is a placeholder that finds
    // the source files without deciding anything -- the real destination comes from the card's
    // own firmware, and nothing is written until it does.
    let found;
    try {
      found = await scanLegacyHomebrew(root, LEGACY_HOMEBREW_DIR);
    } catch (e) {
      dbg(`[homebrew-move] could not read the card: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!found.legacyDirExists || found.movable.length + found.alreadyThere.length === 0) {
      dbg(`[homebrew-move] {"verdict":"nothing-to-move","legacyDirExists":${found.legacyDirExists}}`);
      return;
    }

    // The marker REFINES the answer; it does not decide whether to ask. An unresolvable one
    // (a firmware built from a local branch carries a gitTag no release matches) falls through
    // to the card's own layout, which is the evidence the offer actually rests on.
    const layout = await cardHomebrewLayout({
      readCardFile: (path) => readCardBytes(root, path),
      pathsForGitTag,
    });
    const destination = moveDestination(layout);

    // Re-scan against the real destination. The first pass only proved there was something
    // there; conflicts and reconciles are only meaningful once the destination is known.
    const scan = destination === null ? found : await scanLegacyHomebrew(root, destination);
    const folderName = root?.name ?? "";
    const verdict = readyToMove(scan, folderName, layout, destination);
    dbg(
      `[homebrew-move] ${JSON.stringify({
        verdict,
        marker: layout.known ? layout.gitTag : `unresolved:${layout.why}`,
        destination,
        movable: scan.movable.length,
        alreadyThere: scan.alreadyThere.length,
        conflicts: scan.conflicts.length,
      })}`,
    );
    if (verdict !== "offer" || destination === null) return;

    // WHICH COUNT THE SENTENCE STATES. `movePlan` is movable + alreadyThere: what this run will
    // actually act on. NOT every file in the legacy directory, which would include conflicts --
    // files whose counterpart in the destination differs, which the move deliberately refuses to
    // touch. Counting those would promise to migrate files nothing will move, and they are also
    // the files the scan now hides from the Library (`shadowedLegacyHomebrewKeys`), so counting
    // them here while hiding them everywhere else would be the app disagreeing with itself.
    const plan = movePlan(scan);
    // `exec` runs only on confirm, so this is how a decline is told apart from a completed run.
    let confirmed = false;
    await installProgress.run({
      title: t().title,
      body: t().body(plan.length),
      confirmText: t().confirm,
      phases: [{ id: "move", label: t().phaseMove }],
      exec: async (report: PhaseReporter) => {
        confirmed = true;
        report.start("move");
        let moved = 0;
        let left = scan.conflicts.length;
        const results = await moveLegacyHomebrew(root, plan, destination, {
          signal: report.signal,
          onFile: (_f, i, total) => report.progress("move", i, total),
          onResult: (r) => {
            if (r.outcome === "moved" || r.outcome === "reconciled") {
              moved++;
              report.log("move", t().logMoved(r.file.from));
            } else if (r.outcome === "skipped") {
              left++;
              report.log("move", t().logSkipped(r.file.from));
            } else {
              left++;
              report.log("move", t().logFailed(r.file.from, r.error ?? ""));
            }
          },
        });
        report.progress("move", results.length, plan.length);
        if (left === 0) await removeLegacyDirIfEmpty(root);
        report.log("move", t().logSummary(moved, left));
        report.finish("move");
        // The card changed underneath every reader of it.
        sdStorage.forget();
        await device.scanSdCardGames();
      },
    });
    if (!confirmed) rememberDeclinedMove(folderName);
  }
  // Cheats: the device (flash FrogFS cheats/, or an SD card's cheats/ directory) is the sole
  // source of truth for what's currently configured — deliberately NOT scanned from the local
  // ROM folder (unlike covers, where a low-quality local PNG/JPG sitting next to the converted
  // .img is harmless; a local cheat file copy would just confuse this diffing with no benefit).
  // `deviceCheatsBaseline` is what's actually on the device right now (read async, in the
  // background, whenever the tab has what it needs — utilLoaded+frogfsPart for flash, sdHandle
  // for SD). `configuredCheats` is the user-editable overlay (bound into GameDetailsPanel);
  // it's seeded from the baseline the first time a game's baseline arrives, then diverges with
  // edits. The diff between the two is what actually needs syncing — see changedCheatEntries.
  let configuredCheats = $state<Record<string, string[]>>({});
  let deviceCheatsBaseline = $state<Record<string, string[]>>({});
  // MSX/ColecoVision/SG-1000 (blueMSX-go core) consume cheats as a WHOLE .mcf FILE per game,
  // not a line-based code list — see MCF_WHOLE_FILE_SYSTEMS (cheats/index.ts). Kept as a
  // separate raw-bytes overlay+baseline pair rather than shoehorned into configuredCheats'
  // string[] shape, since there's no "line" concept to diff/toggle for these.
  const MCF_SYSTEMS = new Set(["msx", "col", "sg1000"]);
  let configuredCheatFiles = $state<Record<string, Uint8Array>>({});
  let deviceCheatFilesBaseline = $state<Record<string, Uint8Array>>({});
  let cheatsBaselineGen = 0; // non-reactive cancellation token, mirrors the SD-scan pattern above

  // Cheat files live in their own tree, cheats/<system>/<name>.<ext> — see cheatFilePath()
  // for the firmware path derivation. Both callers arrive cheats/-rooted: the Flash baseline
  // walks a FrogFS listing that keeps the image-root prefix, and the SD baseline walks
  // scanRomDirectory()'s userRoms, which strips only a leading "roms/" (romScan.ts:136-144).
  // The previous version required a "roms/" prefix, which matched the Flash paths of the day
  // but could never match an SD key — so the SD baseline was silently a no-op and an SD cheat
  // edit never diffed against what was already on the card.
  function parseCheatsFile(
    path: string,
    data: Uint8Array,
    out: Record<string, string[]>,
    outFiles: Record<string, Uint8Array>,
  ): void {
    if (!(path.endsWith(".ggcodes") || path.endsWith(".mcf") || path.endsWith(".pceplus"))) return;
    if (!path.startsWith("cheats/")) return;
    const parts = path.slice("cheats/".length).split("/");
    if (parts.length < 2) return;
    const system = parts[0];
    const baseName = parts.slice(1).join("/").replace(/\.[^/.]+$/, "");
    const game = romSelection.games.find((g) => g.system === system && g.name.replace(/\.[^/.]+$/, "") === baseName);
    if (!game) return;
    if (MCF_SYSTEMS.has(system) && path.endsWith(".mcf")) {
      outFiles[game.key] = data;
      return;
    }
    try {
      const text = new TextDecoder().decode(data);
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      out[game.key] = lines;
    } catch {}
  }

  async function loadCheatsBaseline(): Promise<void> {
    const gen = ++cheatsBaselineGen;
    const parsed: Record<string, string[]> = {};
    const parsedFiles: Record<string, Uint8Array> = {};
    if (device.targetMedia === "sd") {
      if (!device.sdHandle) return;
      const root = await getValidRoot(device.sdHandle);
      if (!root) return;
      const scan = await scanRomDirectory(root);
      if (gen !== cheatsBaselineGen) return;
      for (const [path, data] of scan.userRoms) parseCheatsFile(path, await romBytes(data), parsed, parsedFiles);
    } else {
      // Mirrors GameDetailsPanel's Saves-panel gate exactly — only read once the util is
      // already loaded THIS session (never proactively calls ensureStub() itself, so this
      // never surfaces a connect/stub-load prompt on its own).
      if (!device.utilLoaded || !frogfsPart) return;
      const frogfs = device.installedFrogfs;
      if (!frogfs) return;
      const flasher = await device.ensureStub(undefined, false, true); // already loaded — silent, cached
      if (gen !== cheatsBaselineGen) return;
      const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);
      for (const f of frogfs.files) {
        if (!(f.path.endsWith(".ggcodes") || f.path.endsWith(".mcf") || f.path.endsWith(".pceplus"))) continue;
        const data = await read(frogfsOffset + f.dataOffs, f.dataSize);
        if (gen !== cheatsBaselineGen) return;
        parseCheatsFile(f.path, data, parsed, parsedFiles);
      }
    }
    deviceCheatsBaseline = parsed;
    deviceCheatFilesBaseline = parsedFiles;
    // Seed the overlay from the baseline for any game not yet touched this session — never
    // overwrite a key already present (would clobber in-progress edits).
    for (const [key, lines] of Object.entries(parsed)) {
      if (!(key in configuredCheats)) configuredCheats[key] = [...lines];
    }
    for (const [key, data] of Object.entries(parsedFiles)) {
      if (!(key in configuredCheatFiles)) configuredCheatFiles[key] = data;
    }
  }

  $effect(() => {
    // Re-run whenever the things loadCheatsBaseline needs become available (util loaded, SD
    // handle picked, or the target media itself changes) — each run re-checks its own gates
    // and no-ops if not ready yet, so this is safe to fire eagerly and often.
    device.utilLoaded;
    device.sdHandle;
    device.targetMedia;
    void loadCheatsBaseline();
  });

  const hex = (n: number): string => "0x" + (n >>> 0).toString(16);
  /* Roms.dc.html / RomsOptions.dc.html (2026-09-08 refresh) print whole megabytes WITHOUT
     the trailing hundredths: `1 MB`, `2 MB`, `50 MB of ...` — while a fractional figure keeps
     the two places it needs (`3.54 MB`, `+0.12 MB net change`). So: two decimals, trailing
     zeros trimmed. Same rule `util.ts`'s formatSize() already uses.

     `MiB()` returns the bare NUMBER only, and survives solely for the `roms.summary.*`
     string functions (`projected`, `netChange`, `spaceAlert.notEnoughSpace`), which name the
     unit themselves inside the localized sentence. Anything that formats a size on its own
     must use `formatSize()` — pairing MiB() with a literal unit suffix hardcodes an English
     unit in all seven locales. (Guarded by `test/formatsize.mjs`'s source scan.) */
  const MiB = (n: number): string => String(parseFloat((n / 1048576).toFixed(2)));

  let {
    openSet,
    onToggle,
    onRunning,
  }: {
    openSet: Set<string>;
    onToggle: (id: string) => void;
    onRunning: (id: string, running: boolean) => void;
  } = $props();

  // The Library list IS the Sources list. Reading `library.romFolderSignature` subscribes this
  // effect to the local-folder registry, so a ROM folder added, removed, re-pointed or
  // re-granted in the Sources tab rebuilds the library immediately. `sync()` no-ops when the
  // registry has not changed, so this is safe to run on every tick.
  $effect(() => {
    library.romFolderSignature;
    // Wait for the sources to finish resolving before the FIRST scan. Their manifests build the
    // core registry, the registry decides each folder's resolved prefix, and that prefix is part
    // of the signature -- so scanning while they arrive meant one full walk of the library per
    // manifest, each one restarting the progress bar. Once a scan has happened, later signature
    // changes rescan as before: that is what makes activating a core update the library at once.
    if (library.sourcesResolving && !library.loaded) return;
    void library.sync();
  });

  // Three-way, never two: "not read yet" is NOT "nothing configured". See `libraryListState`
  // in sources/libraryScan.ts.
  const listState = $derived(library.listState);
  /** Folders walked / folders to walk — the only real denominator a scan has. */
  /** `<folder>/<file>` while scanning, or just the file when the folder has no name yet. */
  const scanLine = $derived.by(() => {
    const p = library.progress;
    if (!p?.current) return "";
    // `displayName` is the shared rule for naming a folder (the user's label, else the
    // folder's own name), so the scan line cannot drift from the Sources list.
    const row = p.folder ? localFolders.get(p.folder) : undefined;
    const folder = row ? displayName(row) : undefined;
    return folder ? `${folder}/${p.current}` : p.current;
  });
  const scanPct = $derived.by(() => {
    const p = library.progress;
    if (!p || p.total === 0) return null;
    return Math.min(100, Math.round((p.done / p.total) * 100));
  });

  // --- Device geometry / install gating ---------------------------------------------------
  const littlefsPart = $derived(device.partitions.find((p) => p.fs === "littlefs"));
  const frogfsPart = $derived(device.partitions.find((p) => p.fs === "frogfs"));
  // FrogFS must NOT overwrite the reserved bottom region — the stock OFW assets (≈1 MiB Mario /
  // 4 MiB Zelda), OFW backups, asset blobs, etc. Drive its base offset from the scan: an existing
  // FrogFS keeps its (superblock-authoritative) offset; otherwise FrogFS starts AFTER everything
  // below the LittleFS (the end of the bottom reserved region = start of the free gap). NEVER 0
  // unless the scan genuinely shows nothing reserved at the bottom (full-wipe).
  // The FrogFS write offset MUST be erase-block aligned (minEraseSizeBytes — often 64 KiB), not
  // just 4 KiB: erasing at a non-erase-block-aligned offset hangs the device mid-erase. Round the
  // reserved-region end UP to the erase block.
  const eraseBlock = $derived(device.info?.minEraseSizeBytes || 4096);
  const reservedEnd = $derived(
    device.partitions
      .filter((p) => p.fs !== "littlefs" && p.fs !== "frogfs")
      .reduce((m, p) => Math.max(m, p.offset + p.size), 0),
  );
  const reservedEndAligned = $derived(Math.ceil(reservedEnd / eraseBlock) * eraseBlock);
  const frogfsOffset = $derived(frogfsPart?.offset ?? reservedEndAligned);
  const ceilingOffset = $derived(littlefsPart?.offset ?? null);
  const currentFrogfsLen = $derived(frogfsPart?.size ?? null);
  // The previous on-device FrogFS geometry, threaded into every rebuild so the incremental
  // differential flash can still skip unchanged 256 KiB blocks (CLAUDE.md, "Incremental
  // Flashing (FrogFS)"). Derived from `device.installedFrogfs` — the SAME real device parse
  // that produces `device.installedGames` — not a fabricated value and not an extra SWD read;
  // it carries every file's `dataOffs`, which is exactly what `readFrogfsState()` reports
  // (order = paths sorted by data offset, dataStart = the lowest non-zero data offset).
  // Flash-mode only: in SD mode there is no device FrogFS at all.
  const previousFrogfsState = $derived.by((): { order: string[]; dataStart: number } | undefined => {
    if (device.targetMedia === "sd") return undefined;
    const files = device.installedFrogfs?.files;
    if (!files || files.length === 0) return undefined;
    const withData = files.filter((f) => f.dataOffs > 0).sort((a, b) => a.dataOffs - b.dataOffs);
    if (withData.length === 0) return undefined;
    return { order: withData.map((f) => f.path), dataStart: withData[0].dataOffs };
  });
  const partitionsKnown = $derived(device.partitions.length > 0);
  const baseInstalled = $derived(ceilingOffset !== null);
  // canInstallRoms is defined further down (after flashSyncHasChanges, which it depends on —
  // see that derived's doc comment).

  async function handleInstallClick(): Promise<void> {
    if (!device.isConnected) {
      try {
        await device.ensureConnectGate();
      } catch {
        return; // user cancelled the connect-gate modal
      }
    }
    await biosInstallGate();
    openInstall();
  }

  /** SD's sync button. Same gate as Flash's install; the medium difference is already inside
   *  `biosState.outstanding`. */
  async function handleSdSyncClick(): Promise<void> {
    await biosInstallGate();
    openSdSync();
  }

  // Guided flow between the three drop-downs: collapse the current section + open the next.
  // onToggle flips one id; the two ids differ, so two checked toggles move between sections.
  function advance(closeId: string, openId: string): void {
    if (openSet.has(closeId)) onToggle(closeId);
    if (!openSet.has(openId)) onToggle(openId);
  }

  // Recognized ROMs in the folder (after filtering cover art / docs / non-game systems) — the
  // folder's raw file count (library.scan.summary) includes those, which is why it can read e.g. "25
  // files / 5 systems" while only 7 ROMs across 3 systems are actually recognized.
  const folderGames = $derived(romSelection.games.filter((g) => g.inFolder));
  const folderSystemCount = $derived(new Set(folderGames.map((g) => g.system)).size);

  // --- Homebrew (shown as TITLES, not removable game files; always preserved on install) ------
  const deviceHomebrew = $derived(device.installedGames.filter((g) => g.system === "homebrew"));
  const homebrewTitles = $derived(homebrew.status(deviceHomebrew.map((g) => g.name)));
  const unknownHomebrew = $derived(
    deviceHomebrew.filter((g) => !homebrew.owning(g.name) && !romSelection.deletedUnknownHomebrew.has(g.name)),
  );



  // --- Select-games table state -----------------------------------------------------------
  /** `"all"` | `"favorites"` | a system folder | `"homebrew"`. `favorites` is a filter OVER the
   *  library rather than a system IN it, which is why it shares the strip with `all` rather
   *  than sitting among the consoles: both answer "which of everything", not "which console". */
  let consoleFilter = $state<string>("all");
  /**
   * The list's name filter.
   *
   * NOT a chip. The chips are one single-select scope and they grow left to right as sources
   * add consoles; a text field joining that run would read as one more scope. It sits beside
   * that run instead, where it is plainly a different kind of control (LibraryComposed.dc.html).
   *
   * BESIDE, not inside. It used to be the last child of `.consoles` with an auto inline-start
   * margin, which kept the chips one wrapping run but meant the field wrapped WITH them and
   * followed to the end of their last line. It is a sibling in `.filterrow` now so the row can
   * centre it against the whole chip block however many lines that is.
   *
   * Matches the LIST name, which is what the row draws and sorts by. Case-insensitive and
   * untrimmed on purpose: a trailing space a user has typed is still a narrowing they meant.
   */
  let searchQuery = $state("");
  /**
   * The list's order: which of the row's four columns ranks it, and which way.
   *
   * SESSION-LOCAL, LIKE THE OTHER TWO VIEW CONTROLS. `consoleFilter` and `searchQuery` above are
   * plain `$state` that reset on reload, and the order is the same kind of thing: how this
   * visit is looking at the library, not a setting about it. Persisting one of the three and not
   * the others would be the inconsistency, and it would need a `scoped()` key to do it.
   *
   * `name` ascending is the default because it is the order the list has always drawn in -- the
   * sort this replaced was a bare `a.name.localeCompare(b.name)` -- so the control arrives
   * describing what the user is already looking at rather than rearranging it on sight.
   */
  let sortKey = $state<LibrarySortKey>("name");
  let sortDir = $state<SortDirection>("asc");
  let sortMenuOpen = $state(false);
  /** Picking the key already shown reverses it; picking another starts that one ascending. */
  function pickSort(k: LibrarySortKey): void {
    if (k === sortKey) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortKey = k; sortDir = "asc"; }
    sortMenuOpen = false;
  }
  function sortKeyLabel(k: LibrarySortKey): string {
    const t = locale.t.roms.selectGames;
    switch (k) {
      case "system": return t.sortBySystem;
      case "name": return t.sortByName;
      case "size": return t.sortBySize;
      case "action": return t.sortByAction;
    }
  }
  /** Audit S1.3's `N selected` header label: games plus homebrew currently marked for
   *  install. Both sets are existing derived selection state — nothing new is tracked. */
  const selectedTotal = $derived(romSelection.selectedKeys.size + romSelection.selectedHomebrewKeys.size);
  let hasInitializedSelection = $state(false);

  $effect(() => {
    // When filter changes, reset the initialization flag
    consoleFilter;
    hasInitializedSelection = false;
  });

  const visibleGames = $derived.by(() => {
    // ROWS, not files: a Doom `.wad` and the `.whd` it becomes are ONE entry (sources/gameRows.ts).
    // `name` stays the LIST surface's name — the original filename, extension stripped — because
    // that is what the row is sorted, filtered and searched by; the carousel reads `prettyName`.
    let list: any[] = romSelection.rows
      .filter((r) => consoleFilter === "all" || consoleFilter === "favorites" || r.system === consoleFilter)
      .map((r) => ({
        key: r.key,
        system: r.system,
        name: r.listName,
        prettyName: r.prettyName,
        originFilename: r.originFilename,
        size: r.size,
        inFolder: r.inFolder,
        installed: r.installed,
        needsPrepare: r.needsPrepare,
        inputKey: r.inputKey,
        outputKey: r.outputKey,
        isHomebrew: false,
      }));

    if (consoleFilter === "all" || consoleFilter === "favorites" || consoleFilter === "homebrew") {
      // ONLY ACTUAL HOMEBREW. A core is in `homebrew.titles` because it has something to
      // prepare (see HomebrewTitle.isCore) — but its games are real ROMs under its own console,
      // already in `romSelection.rows` above. Pushing a pseudo-row for it here is what put Doom
      // in the Homebrew group, which is the bug the owner reported.
      homebrew.titles.filter((hb) => !hb.isCore).forEach(hb => {
        list.push({
          key: hb.key,
          system: "homebrew",
          name: hb.label,
          prettyName: hb.label,
          originFilename: hb.label,
          size: getHomebrewSize(hb.key),
          inFolder: false,
          installed: false,
          needsPrepare: false,
          isHomebrew: true,
          hb: hb // Keep reference to original object
        });
      });
    }

    // FAVOURITES AND SEARCH LAST, over the MAPPED rows. A favourite is a property of the
    // installable file, and `favoritePathFor` needs the mapped row (its `outputKey`, its homebrew
    // device file) rather than the raw `romSelection.rows` entry; filtering earlier would have to
    // duplicate that mapping and would then be a second place to keep in step with it.
    // The rules themselves live in `lib/libraryFilter.ts` so a suite can drive them.
    list = filterLibraryRows(list, rowAccess, { consoleFilter, searchQuery });

    // ORDER LAST, over the filtered rows, and through `lib/librarySort.ts` for the same reason
    // the scopes go through `libraryFilter.ts`: the tiebreak, where an unsized row lands and the
    // action order are each a decision, and rendering the tab is the only other way to reach
    // them. `locale.current` is passed rather than read inside, so the rule sorts in the user's
    // language without that module importing the i18n store.
    return sortLibraryRows(list, rowAccess, {
      key: sortKey,
      direction: sortDir,
      locale: locale.current,
    });
  });

  /** How the filter module reads one of these rows. */
  const rowAccess = {
    systemOf: (g: any) => g.system,
    nameOf: (g: any) => g.name,
    // THE SAME QUESTION THE STAR ASKS. The star is `favorites.has(g.key)` and the store keys on
    // row id; this used to hand `favoritePathFor(g)` -- a DEVICE path -- to that same store, so
    // it never matched and a starred game never appeared under `Favorites`. The device path is
    // the write-time half and lives in `favoriteWritePath`.
    rowIdOf: (g: any) => g.key as string,
    isFavorite: (rowId: string) => favorites.has(rowId),
    /** Folder bytes. 0 means "no size yet", which `librarySort` pins rather than ranks. */
    sizeOf: (g: any) => (g.isHomebrew ? getHomebrewSize(g.hb.key) : g.size) as number,
    /**
     * The row's action chip, as `getActionState()`'s state-kind key.
     *
     * CALLED ONLY WHEN SORTING BY `action`, and that laziness is load-bearing rather than an
     * optimisation. `getActionState()` reads the selection, `extracting`, `prepareState` and the
     * device's homebrew list; naming it here unconditionally would subscribe `visibleGames` to
     * all of it, so the whole list would re-sort on every chip press whatever key was chosen.
     * Under `action` that resubscription is correct -- pressing a chip is what changes a row's
     * rank -- and under the other three keys it never happens.
     */
    actionOf: (g: any) => getActionState(g).label,
  };

  /** The `Favorites` chip's count, over the WHOLE library. See `countFavorites`. */
  const favoritesCount = $derived.by(() => {
    const all: any[] = [
      ...romSelection.rows.map((r: any) => ({ ...r, name: r.listName, isHomebrew: false })),
      ...homebrew.titles
        .filter((hb) => !hb.isCore)
        .map((hb) => ({ key: hb.key, isHomebrew: true, hb, needsPrepare: false })),
    ];
    return countFavorites(all, rowAccess);
  });
  // getActionState()'s `label` is an internal state-kind key (compared against literal strings
  // all over this file — e.g. `state.label === 'install'`), NOT itself the display text. This
  // helper maps that fixed English key to the localized string shown to the user — never
  // change the keys themselves, only what actionLabelText() returns for each.
  function actionLabelText(label: string): string {
    switch (label) {
      case "installed": return locale.t.roms.selectGames.actionInstalled;
      case "uninstall": return locale.t.roms.selectGames.actionUninstall;
      case "prepare": return locale.t.roms.selectGames.actionPrepare;
      case "extracting...": return locale.t.roms.selectGames.actionExtracting;
      case "missing rom": return locale.t.roms.selectGames.actionMissingRom;
      case "install": return locale.t.roms.selectGames.actionInstall;
      case "not installed": return locale.t.roms.selectGames.actionNotInstalled;
      default: return label;
    }
  }

  function getActionState(g: any): { label: string, cls: string, action: (e?: Event) => void, disabled: boolean } {
    if (g.isHomebrew) {
      const hb: HomebrewTitle = g.hb;
      // A title needing no user file at all — what "celeste" used to be hardcoded as. Now a
      // manifest-derived property (its converter declares no required input, or it has none).
      const isSelfContained = hb.selfContained;
      const onDevice = hb.deviceFiles.every((f: string) => deviceHomebrew.some((d) => d.name === f));
      const isSelected = romSelection.isHomebrewSelected(hb.key);
      // Not "does the folder happen to hold a matching extension" any more: the file now comes
      // from the manifest-driven prompt (see prepareTitle), so anything with a converter OR
      // publisher artifacts has something "Prepare" can do.
      const hasWork = hb.tool !== undefined || hb.target.artifacts.length > 0;
      const isExtracting = extracting.has(hb.key);
      // The RUN's own provenance, not a walk of `deviceFiles`. Two earlier spellings both
      // failed on a shape the manifest allows: a hardcoded `homebrew/` prefix left every core
      // stuck on "prepare" (a core's files are keyed `cores/doom.bin`), and asking
      // `prepareState.has()` per declared name cannot see a DERIVED output at all, since one
      // declares an extension rather than a filename and is absent from `deviceFiles` by
      // construction. A title whose only output is derived would never read as prepared.
      // `preparedBytesFor` reads `assets` first, which is what keeps this `$derived`
      // subscribed to the map it depends on.
      const hasExtracted = prepareState.preparedBytesFor(hb.key) !== undefined;
      // NOT `isSelfContained || ...`: a self-contained title has no converter to run, but it
      // still ships `targets[].artifacts[]` that have to be fetched from its source before
      // there is anything to install. "Prepare" is what fetches them (see prepareTitle).
      const isReady = hasExtracted || onDevice;

      if (onDevice) {
        if (isSelected) return { label: "installed", cls: "installed", action: () => romSelection.toggleHomebrew(hb.key, false), disabled: false };
        else return { label: "uninstall", cls: "uninstall", action: () => romSelection.toggleHomebrew(hb.key, true), disabled: false };
      } else {
        if (!isReady) {
          if ((hasWork || isSelfContained) && !isExtracting) return { label: "prepare", cls: "muted", action: () => prepareTitle(hb), disabled: false };
          if (isExtracting) return { label: "extracting...", cls: "muted", action: () => {}, disabled: true };
          return { label: "missing rom", cls: "muted", action: () => {}, disabled: true };
        } else {
          if (isSelected) return { label: "install", cls: "new", action: () => romSelection.toggleHomebrew(hb.key, false), disabled: false };
          else return { label: "not installed", cls: "muted", action: () => romSelection.toggleHomebrew(hb.key, true), disabled: false };
        }
      }
    } else if (g.needsPrepare) {
      // AN INGESTABLE ROW: the file is a converter's input (a Doom `.wad`), so there is nothing
      // to install YET and deliberately NO install control — "never copied to the device" is
      // structural here, not a rule applied later. Preparing it produces the `.whd`, the scan
      // picks that up, `gameRows` pairs the two, and this same row becomes installable.
      // PER FILE, not per title. A core with several games is ONE title, so asking `extracting`
      // (which is keyed by title) flipped every Doom row to "extracting…" the moment any one of
      // them was pressed — the owner saw both entries react to one press. The conversion was
      // always correctly scoped to the single file; only this answer was not.
      const coreTitle = coreTitleFor(g.system);
      const isPreparing =
        extracting.size > 0 &&
        coreTitle !== undefined &&
        prepareState.isExtractingFile(coreTitle.key, g.originFilename);
      if (isPreparing) return { label: "extracting...", cls: "muted", action: () => {}, disabled: true };
      return { label: "prepare", cls: "muted", action: () => void prepareRomRow(g), disabled: false };
    } else {
      // ROW-aware, not `g.key`: a paired row's key is the converter's INPUT while `installed`
      // and the file on the card are its OUTPUT. Asking the input made an installed Doom row
      // read as unselected, so it drew "uninstall" untouched and toggling it moved a key that
      // nothing installs. See `selectionKeyFor`.
      const isSelected = romSelection.isRowSelected(g);
      if (g.installed) {
        if (isSelected) return { label: "installed", cls: "installed", action: () => romSelection.toggleRow(g), disabled: false };
        else return { label: "uninstall", cls: "uninstall", action: () => romSelection.toggleRow(g), disabled: false };
      } else {
        if (isSelected) return { label: "install", cls: "new", action: () => romSelection.toggleRow(g), disabled: false };
        else return { label: "not installed", cls: "muted", action: () => romSelection.toggleRow(g), disabled: false };
      }
    }
  }

  // --- Lazy preview: build the RAW FrogFS from the SELECTION to learn its size + reuse for flash.
  // Built when Select-games or Install-ROMs is open + the device is base-installed; rebuilt when the
  // selection changes. (The preview uses folder bytes only; on-device-only retained games add a
  // little size the install accounts for — exact in the common case where the folder has everything.)
  let builtFrogfs = $state<Uint8Array | null>(null);
  // The LittleFS files this install still has to deliver itself (source cores, and `/data`).
  // Carried beside `builtFrogfs` because the install below may reuse that cached preview
  // image, and reusing the image while dropping this list is exactly the silent-drop bug the
  // list exists to close.
  let builtPendingLfs = $state<StagedFile[]>([]);
  let newFrogfsLen = $state<number | null>(null);
  let building = $state(false);
  let buildErr = $state<string | null>(null);
  const installAllCores = true;
  let builtFor = $state<string | null>(null);
  let buildToken = 0;

  // Pyodide Extraction State — now `sources/prepareState.svelte.ts`, a store-backed singleton.
  // These three were component `$state` until the Sources tab needed to drive the same flow;
  // the prepared bytes have to outlive whichever tab produced them (a tab switch unmounts this
  // component), so they moved to the store. These aliases keep every reader below reading
  // exactly the same values it did before.
  const extracting = $derived(prepareState.extracting);
  const extractedAssets = $derived(prepareState.assets);

  /**
   * The systems this install actually has a ROM for, and the cores that follow from them.
   *
   * `selectedKeys` is the truth on Flash: a game already installed and still selected stays, so
   * the same set answers "which cores does the device need after this install" for an addition
   * and a removal alike. On SD `unusedCores` returns nothing at all, so the gate below is a
   * no-op there and every core ships -- see `sources/coreGate.ts` for why the medium decides.
   *
   * Declared ABOVE `selectedAssets` because that derivation reads it. `$derived.by` is lazy
   * enough that the reverse order would happen to work, which is exactly why it is not written
   * that way: a `const` read from a closure before its own initializer is a temporal dead zone
   * waiting for the first eager reader.
   */
  const selectedSystems = $derived.by(() => {
    const out = new Set<string>();
    for (const g of romSelection.games) {
      if (romSelection.selectedKeys.has(g.key)) out.add(g.system.toLowerCase());
    }
    return out;
  });

  const unusedCoreList = $derived.by(() =>
    unusedCores({
      titles: homebrew.titles,
      systemsOf: (targetKey) =>
        coreRegistry.current.systems.filter((s) => s.targetKey === targetKey).map((s) => s.folder),
      selectedSystems,
      producedBy: (k) => prepareState.producedKeys(k),
      sourceOf: (k) => prepareState.assetSourceOf(k),
      medium: device.targetMedia === "sd" ? "sd" : "flash",
      // Opening the tab is not a deselection. Without this the gate read an untouched empty
      // selection as "remove every core" and an idle Library projected a net change.
      selectionUntouched: !romSelection.selectionTouched,
    }),
  );

  const unusedCoreKeys = $derived.by(() => {
    const out = new Set<string>();
    for (const core of unusedCoreList) for (const k of core.keys) out.add(k);
    return out;
  });

  /**
   * The prepared bytes THIS selection installs.
   *
   * Every install map used to merge `extractedAssets` whole, so a converted output stayed in
   * the image after its game or title was deselected: preparing OpenLara added 42.92 MB to the
   * net change and deselecting dropped it only to 42.79 MB, the difference being the one file
   * (`OpenLara.bin`) the packer drops on its own. Doom moved not at all, its `.whd` games
   * reaching the image through this merge alone. `sources/selectedAssets.ts` carries the rule
   * and the reasoning; all three call sites below go through it so the preview and the two
   * installs cannot disagree about what gets written.
   *
   * The core gate wraps it for the same "one function, three call sites" reason: a core whose
   * every ROM was deselected must not ship on Flash, and must still ship on SD.
   */
  /**
   * Placement keys of the games the active cores SHIP (`systems[].games[]`).
   *
   * They are recorded as `artifact` because the project published them, but they behave as
   * ROMs, so `selectedPreparedAssets` gates them on their Library row rather than keeping them
   * unconditionally the way it keeps a core's binary. Derived rather than stored: the registry
   * is the source of truth and a core switched off must stop offering its game.
   */
  function shippedGameKeys(): Set<string> {
    const out = new Set<string>();
    for (const sys of coreRegistry.current.systems) {
      for (const g of sys.shippedGames) out.add(`${sys.folder}/${g.filename}`);
    }
    return out;
  }

  /**
   * The shipped games a SELECTED row wants and `prepareState` does not hold yet.
   *
   * THE BUG THIS EXISTS FOR. `prepareShippedGames` had exactly one caller,
   * `ensureCoresPrepared`, and that runs only inside `runInstall`/`doSdSync`. So a shipped
   * game had no bytes until an install was already under way, and `selectedPreparedAssets`
   * iterates `prepareState.assets` -- a key that is not in that map contributes nothing.
   * Selecting Doom's shareware episode therefore moved the net change by zero: its 4,196,020
   * bytes were not in any of the three provenance buckets, they were absent entirely. The
   * owner's own log showed the shape of it, `assetFiles.artifact: 1` against
   * `preparedAssetsTotal: 3` -- one artifact, `cores/doom.bin`, and no `.whd`.
   *
   * WHY FETCH RATHER THAN COUNT. The manifest declares `bytes`, so the size alone could be
   * added to the number without a fetch. But `buildPreview` caches the image it builds and
   * `runInstall` FLASHES that cached image (`frogfs = builtFrogfs`), so a projection that
   * counted bytes the image does not contain would either report a size the image cannot
   * honour or, worse, invite a placeholder of the right length into something that reaches
   * the device. One set of real bytes keeps the number and the image the same fact.
   *
   * Scoped to selected rows: a core's shipped game is a ROM the user may not want, and
   * fetching every one of them on sight would pull megabytes nobody asked for. Already-held
   * keys are skipped here as well as inside `prepareShippedGames`, so a steady selection
   * costs no request at all.
   */
  function selectedShippedGameFetches(): ShippedGameFetch[] {
    const out: ShippedGameFetch[] = [];
    for (const sys of coreRegistry.current.systems) {
      for (const g of sys.shippedGames) {
        const key = `${sys.folder}/${g.filename}`;
        if (!romSelection.selectedKeys.has(key)) continue;
        if (prepareState.preparedBytesFor(key) !== undefined) continue;
        out.push({ key, url: g.url, sha256: g.sha256 });
      }
    }
    return out;
  }

  /**
   * The core files the DEVICE already holds, as FrogFS paths, sorted.
   *
   * Only a MAPPED artifact reaches FrogFS (`planFlashImage`'s `mappedKeys` override sends one
   * there whatever its `cores/` role says). An ordinary core lives in LittleFS, which the
   * vendored littlefs cannot remove from, so a rebuild can never drop one and it is not this
   * function's business. A mapped half is the opposite: it is packed into the image from
   * scratch every time, so it survives only if something puts its bytes back.
   */
  function deviceCoreFiles(): string[] {
    const files = device.installedFrogfs?.files;
    if (files === undefined) return [];
    return files.map((f) => f.path).filter((p) => p.startsWith("cores/")).sort();
  }

  /**
   * The targets owning those files, minus the ones already prepared.
   *
   * THE BUG THIS EXISTS FOR, and why the core gate's fix could not reach it.
   * `prepareCoreArtifacts` has exactly one caller, `ensureCoresPrepared`, which runs only
   * inside `runInstall`/`doSdSync`. On a fresh page load `prepareState` therefore holds no
   * core bytes at all, and `planFlashImage` builds the FrogFS tree from the bundle plus
   * `userRoms` alone -- nothing carries an on-device file forward. So a mapped core sitting
   * on the device was absent from every rebuilt image, and the projection reported its size
   * as a removal: the owner's standing `-192592`, which is `cores/gba.xip` exactly.
   *
   * `selectionUntouched` could not have cured this. That rule stops `unusedCores` REMOVING a
   * prepared core from `selectedAssets`; here there was nothing to remove, because nothing
   * had been prepared. The gate protected the wrong half of the path.
   *
   * WHY THE DEVICE AND NOT THE SELECTION. `ensureCoresPrepared` resolves what to fetch from
   * `selectedSystems`, which is the right rule for adding a core: Flash follows ROM selection.
   * It is the wrong rule for KEEPING one. What is already installed stays until the user says
   * otherwise, which is the same principle `selectionUntouched` settled one layer down, and
   * it is why this reads the device rather than the selection.
   *
   * It cannot resurrect a core the gate dropped. This only puts the bytes into
   * `prepareState`; `applyCorePolicy` still runs afterwards over `selectedAssets`, so a user
   * who really did deselect a core's last ROM still sees it removed. The two rules compose
   * rather than fight: fetch decides what CAN be kept, the gate decides what IS.
   */
  function deviceCoreFetches(): { key: string; target: Target }[] {
    const names = new Set(deviceCoreFiles().map((p) => p.slice("cores/".length)));
    if (names.size === 0) return [];
    const out: { key: string; target: Target }[] = [];
    const seen = new Set<string>();
    for (const row of sources.rows) {
      if (!row.active || !row.manifest) continue;
      for (const target of row.manifest.targets) {
        if (!(target.artifacts ?? []).some((a) => names.has(a.filename))) continue;
        const key = `${row.repo}#${target.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Already held: costs no request, exactly as the shipped-game list skips its own.
        if (prepareState.preparedBytesFor(key) !== undefined) continue;
        out.push({ key, target });
      }
    }
    return out;
  }

  /**
   * Fetch them, never failing the preview over one.
   *
   * A core whose fetch fails is skipped and logged, the same bargain `ensureCoresPrepared`
   * makes: a projection that is wrong by one core is better than a Library that shows no
   * number at all, and the audit log says which.
   */
  async function prepareDeviceCores(): Promise<void> {
    for (const { key, target } of deviceCoreFetches()) {
      try {
        await prepareState.prepareCoreArtifacts(key, target);
      } catch (e) {
        dbg("[summary] device core artifacts unavailable:", key, errText(e));
      }
    }
  }

  const selectedAssets = $derived.by(() =>
    applyCorePolicy(
      selectedPreparedAssets({
        assets: extractedAssets,
        sourceOf: (k) => prepareState.assetSourceOf(k),
        producedBy: (k) => prepareState.producedKeys(k),
        rows: romSelection.rows,
        selectedRowKeys: romSelection.selectedKeys,
        selectedTitleKeys: romSelection.selectedHomebrewKeys,
        shippedGameKeys: shippedGameKeys(),
      }),
      unusedCoreKeys,
    ),
  );

  /**
   * The relocation facts for the MAPPED artifacts inside `selectedAssets`, keyed the same way,
   * ready for `buildFrogfsImage`.
   *
   * `prepareState` recorded them when it fetched the artifacts (`mappedArtifactMap()`); this
   * narrows them to what this install actually writes and adds the declared byte count, which
   * `relocateMappedInFrogfs` asserts the packed entry against before it patches a single word.
   *
   * `relocBase` and not `placedAt`: these bytes come from the artifact cache exactly as the
   * publisher linked them, so the address they must be rebased FROM is the sentinel the
   * manifest states -- including on a re-install, where the file simply lands at a new offset
   * and is patched from the sentinel again. `placedAt` is for bytes read back off the device,
   * which are already patched to their old address; nothing in this flow produces those.
   */
  const mappedArtifacts = $derived.by(() => {
    const all = prepareState.mappedArtifactMap();
    if (all.size === 0) return undefined;
    const out = new Map<string, MappedSpec>();
    for (const [key, data] of selectedAssets) {
      const m = all.get(key);
      if (!m) continue;
      out.set(key, { ...(m.relocBase === undefined ? {} : { relocBase: m.relocBase }), bytes: data.length });
    }
    return out.size > 0 ? out : undefined;
  });

  // Put back what a previous visit converted. Lazy and fire-and-forget on purpose: converted
  // output is the one cached category that cannot be re-fetched from anywhere (it is derived
  // from the user's own ROM), so a reload must not discard it — but nothing here waits on it,
  // and a title it cannot fully recover simply stays unprepared. `restore()` is idempotent.
  $effect(() => {
    const titles = homebrew.titles;
    if (titles.length > 0) void prepareState.restore(titles);
  });

  // Ask the user's own registered folders whether they already hold what a title's converter
  // wants, BEFORE the prepare button decides to open a picker. Same wiring the Sources tab's
  // "Additional files" section uses (`sources/discoveryWire.svelte.ts`) — deliberately shared,
  // because a user who never opens Configure would otherwise still be asked to go and find a
  // WAD sitting in a folder they registered. Nothing is converted: `prepareTitle` still needs
  // the user's click, this only decides whether it has a question left to ask.
  let lastDiscoverySigs = new Map<string, string>();
  $effect(() => {
    const scan = library.scan;
    const byRepo = new Map<string, { inputs: ConverterInput[]; keys: string[] }>();
    for (const t of homebrew.titles) {
      if (!t.tool) continue;
      const e = byRepo.get(t.repo) ?? { inputs: [], keys: [] };
      for (const i of t.tool.inputs) if (!e.inputs.some((x) => x.id === i.id)) e.inputs.push(i);
      e.keys.push(t.key);
      byRepo.set(t.repo, e);
    }
    for (const [repo, e] of byRepo) {
      const sig = `${discoverySignature(repo, e.inputs.map((i) => i.id), e.keys)}#${scan ? "s" : "-"}`;
      if (lastDiscoverySigs.get(repo) === sig) continue;
      lastDiscoverySigs.set(repo, sig);
      void discoverForSource(repo, e.inputs, e.keys);
    }
  });
  // The title whose converter is waiting on the user's file. Component-local is correct here:
  // the prompt is short-lived and pre-flight (nothing is running on the device yet), unlike
  // `installProgress`, which has to be a store-backed singleton to survive a long write. It is
  // rendered at this component's root, outside every `{#if}` in the table, so nothing can
  // unmount it while it is open.
  let promptFor = $state<HomebrewTitle | null>(null);

  // Carousel State
  let coverUrls = new Map<string, string>();
  let coverVersion = $state(0);
  
  function getCoverUrl(key: string, _version = 0) {
    // A second folder's differing file under the same name is keyed `<path>\0<id>` (see
    // sources/libraryScan.ts). The cover is a sibling of the real path, so the id comes off
    // first — both variants therefore show the one cover that path has, which is correct: the
    // cover is named after the ROM, and on the card there is only one of that name.
    const gameKey = basePath(key);
    if (coverUrls.has(gameKey)) return coverUrls.get(gameKey)!;
    let system = "";
    let base = "";
    
    const hb = homebrew.find(gameKey);
    if (hb) {
      system = "homebrew";
      base = hb.displayName;
    } else if (!gameKey.includes("/")) {
      // Unrecognized ("unknown") homebrew — a bare on-device filename under roms/homebrew/,
      // belonging to no active source's manifest (no displayName to fall back to). Previously
      // this fell through to the split("/") branch below, which requires a "/" and returns ""
      // immediately for a bare filename — so unknown-homebrew covers could never be found even
      // if genuinely present in library.scan.userRoms.
      system = "homebrew";
      base = gameKey.replace(/\.[^/.]+$/, "");
    } else {
      const parts = gameKey.split("/");
      if (parts.length < 2) return "";
      system = parts[0];
      base = parts[1].replace(/\.[^/.]+$/, "");
    }
    
    // Check both standard paths and inline paths (prefer high-quality originals, fallback to .img)
    for (const ext of [".png", ".jpg", ".jpeg", ".img"]) {
      const inlinePath = `${system}/${base}${ext}`;
      const coversPath = `covers/${system}/${base}${ext}`;
      
      let matchPath = null;
      if (library.scan?.userRoms.has(inlinePath)) matchPath = inlinePath;
      else if (library.scan?.userRoms.has(coversPath)) matchPath = coversPath;
      
      if (matchPath) {
        const url = URL.createObjectURL(new Blob([library.scan!.userRoms.get(matchPath) as any]));
        coverUrls.set(gameKey, url);
        return url;
      }
    }
    return "";
  }
  let selectedCarouselId = $state<string>("");
  $effect(() => {
    if (selectedCarouselId && !carouselCovers.some(c => c.id === selectedCarouselId) && !unknownHomebrew.some(g => g.name === selectedCarouselId)) {
      selectedCarouselId = "";
      hasInitializedSelection = false;
    }
    if (!selectedCarouselId && carouselCovers.length > 0 && !hasInitializedSelection) {
      selectedCarouselId = carouselCovers[0].id;
      hasInitializedSelection = true;
    }
  });
  let carouselCovers = $derived.by(() => {
    // Reference coverVersion so this array re-evaluates and triggers the child Carousel correctly
    const v = coverVersion;
    return visibleGames.map(g => ({
      id: g.key,
      name: g.name,
      system: g.system,
      url: getCoverUrl(g.key, v)
    }));
  });

  /**
   * The "prepare" action. The flow itself lives in `sources/prepareState.svelte.ts` (see its
   * header for the two halves and why its outputs are a store); this is the Library's half of
   * it — open the prompt when the title has something to ask for, and apply the Library's OWN
   * selection policy once a run succeeds.
   *
   * Step 2's file is ASKED FOR, never guessed: a tool with any input opens `FilePromptModal`,
   * which renders that input's own `label`/`description`/`variants[]` and hands back only what
   * `sources/inputGate.ts` accepted.
   */
  async function prepareTitle(hb: HomebrewTitle) {
    // `needsPrompt` is `promptsForInput`, not `!selfContained`: a tool whose inputs are all
    // OPTIONAL needs no file to run, but the prompt is the only place those files can be
    // supplied, so it must still open. A title with no tool has nothing to ask about and goes
    // straight to fetching its artifacts.
    if (prepareState.needsPrompt(hb)) {
      promptFor = hb;
      return;
    }
    await runPrepare(hb, []);
  }

  /**
   * The core whose converter feeds this console, if any. `RegisteredSystem.targetKey` and
   * `HomebrewTitle.key` are both `owner/repo#targetId`, so this is a direct lookup rather than
   * a guess — the registry already decided which core owns the folder.
   */
  function coreTitleFor(system: string): HomebrewTitle | undefined {
    const reg = coreRegistry.current.byFolder.get(system.toLowerCase());
    if (!reg) return undefined;
    return homebrew.titles.find((t) => t.key === reg.targetKey);
  }

  /**
   * PREPARE ONE ROM. The input declares `runPerFile`, so each file is its own run and its own
   * row — this offers exactly the one file the user pressed, never the whole folder.
   *
   * The bytes come from the library scan, which already holds them; nothing is re-read and
   * nothing is hashed here. A row whose bytes are not in the scan (a folder that failed to
   * re-open) falls back to the title's normal prepare flow, which asks for the file.
   */
  async function prepareRomRow(g: any): Promise<void> {
    const title = coreTitleFor(g.system);
    if (!title) return;
    if (!title.tool) {
      await prepareTitle(title);
      return;
    }
    const inputId = title.tool.inputs[0]?.id;
    if (!inputId) return;
    const key: string | undefined = g.inputKey;
    const entry = key ? library.scan?.userRoms.get(key) : undefined;
    if (entry) {
      const bytes = await romBytes(entry);
      await runPrepare(title, [{ inputId, filename: g.originFilename, bytes }]);
      return;
    }
    // The scan no longer holds this row's bytes (a folder that failed to re-open between the
    // scan and the press). Discovery may still be holding them for this exact filename — use
    // that rather than falling through to `prepareTitle`, whose EMPTY offer means "convert
    // every file discovery found". Falling through here is what could convert a whole shelf of
    // WADs from one press, which is the opposite of what `runPerFile` promises.
    const fromDiscovery = prepareState
      .discoveredFor(title.repo, inputId)
      .find((f) => f.filename === g.originFilename);
    if (fromDiscovery) {
      await runPrepare(title, [fromDiscovery]);
      return;
    }
    // Nothing holds these bytes any more: ask for the file rather than guessing which one.
    await prepareTitle(title);
  }

  /** Run the shared flow, then select the title here — selection is a Library policy. */
  async function runPrepare(hb: HomebrewTitle, offered: OfferedFile[], unrecognised: string[] = []) {
    if (await prepareState.run(hb, offered, unrecognised)) romSelection.toggleHomebrew(hb.key, true);
  }

  // `deviceCoreFiles()` is in here for a reason that cost a long diagnosis: the partition scan
  // lands before the per-file FrogFS parse, so this effect first runs while `installedFrogfs`
  // is still null. Nothing else in this signature is device-derived, so the preview built in
  // that window was a cache hit forever after and the stale number never settled.
  const selSig = $derived([
    ...romSelection.selectedKeys, 
    ...romSelection.selectedHomebrewKeys, 
    ...extractedAssets.keys(),
    ...deviceCoreFiles(),
    ...Object.entries(configuredCheats).map(([k, v]) => `${k}:${v.join(",")}`),
    ...Object.entries(configuredCheatFiles).map(([k, v]) => `${k}:${v.length}`)
  ].sort().join("|"));
  $effect(() => {
    // This preview exists to learn the FrogFS image's exact size for the Flash-mode gap
    // check below — irrelevant in SD mode (SD capacity is tracked separately via
    // sdUsedBytes). Skip it there so a device that merely happens to be connected while
    // the user manages SD content doesn't trigger a wasted bundle fetch + FrogFS build.
    if (device.targetMedia === "sd" || !device.isConnected || !baseInstalled) return;
    if (builtFrogfs && builtFor === selSig) return; // cache hit
    void buildPreview(selSig);
  });

  const CHEAT_EXTS: Record<string, string> = {
    nes: "ggcodes", gb: "ggcodes", gbc: "ggcodes",
    snes: "ggcodes", md: "ggcodes", gen: "ggcodes", gg: "ggcodes",
    pce: "pceplus", msx: "mcf", col: "mcf", sg1000: "mcf",
  };
  // The firmware reads cheats from a dedicated /cheats tree, NOT from next to the ROM:
  // odroid_system_get_path_buf() strips the "/roms" prefix off the ROM path
  // (Core/Src/porting/odroid_system.c:91-95) and joins the remainder onto
  // ODROID_BASE_PATH_CHEATS = "/cheats" (retro-go-stm32/components/odroid/config.h:63), so
  // /roms/nes/x.nes reads /cheats/nes/x.ggcodes. This app used to write cheats next to the
  // ROM and byte-patch that base string to "/roms" inside every downloaded firmware blob;
  // both halves of that hack are gone.
  function cheatFilePath(rawKey: string): string {
    // Sibling-path derivation, so the internal duplicate id comes off first (see getCoverUrl).
    const key = basePath(rawKey);
    const [system, ...nameParts] = key.split("/");
    const name = nameParts.join("/").replace(/\.[^/.]+$/, "");
    return `cheats/${system}/${name}.${CHEAT_EXTS[system] || "ggcodes"}`;
  }
  // Each entry is "code, description" (see GameDetailsPanel's cheatCode/cheatDescription) —
  // write the whole line as-is. Previously this dropped everything after the first comma,
  // writing bare codes with no description; the firmware falls back to displaying the code
  // itself when no description is present, which is exactly the "I see the cheatcode instead
  // of the description on-device" symptom this fixes.
  function cheatFileContent(cheats: string[]): string {
    return cheats.map((c) => c.trim()).join("\n") + "\n";
  }

  /** Flash mode: full unconditional set (matches flash rebuilding its whole FrogFS image from
   *  scratch every time regardless — no diffing needed or worth it here). */
  function injectCheats(map: Map<string, Uint8Array>) {
    for (const [key, cheats] of Object.entries(configuredCheats)) {
      if (cheats.length === 0) continue;
      map.set(cheatFilePath(key), new TextEncoder().encode(cheatFileContent(cheats)));
    }
    for (const [key, data] of Object.entries(configuredCheatFiles)) {
      if (data.length === 0) continue;
      map.set(cheatFilePath(key), data);
    }
  }

  function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** SD mode: cheat files diffed against the on-device baseline (deviceCheatsBaseline) — only
   *  emits an entry for a game whose overlay actually differs from what's already there
   *  ("added-or-dirty" for cheats, same spirit as SD_SYNC_POLICY below; kept as its own
   *  function rather than routed through changedSdUserRoms/library.dirtyFiles because cheat file
   *  paths are derived from game keys, not folder-sourced — there's no folder file to mark
   *  dirty). Also returns paths that need REMOVING: a game whose cheats were cleared but whose
   *  baseline still has a file on the device (injectCheats' write-only shape has no way to
   *  signal that; without this, clearing a game's cheats never actually cleared the device). */
  function changedCheatEntries(): { changed: Map<string, Uint8Array>; toRemove: string[] } {
    const changed = new Map<string, Uint8Array>();
    const toRemove: string[] = [];
    const keys = new Set([...Object.keys(configuredCheats), ...Object.keys(deviceCheatsBaseline)]);
    for (const key of keys) {
      const cheats = configuredCheats[key] ?? [];
      const baseline = deviceCheatsBaseline[key] ?? [];
      if (cheats.length === baseline.length && cheats.every((c, i) => c === baseline[i])) continue;
      if (cheats.length === 0) {
        if (baseline.length > 0) toRemove.push(cheatFilePath(key));
      } else {
        changed.set(cheatFilePath(key), new TextEncoder().encode(cheatFileContent(cheats)));
      }
    }
    const fileKeys = new Set([...Object.keys(configuredCheatFiles), ...Object.keys(deviceCheatFilesBaseline)]);
    for (const key of fileKeys) {
      const data = configuredCheatFiles[key];
      const baseline = deviceCheatFilesBaseline[key];
      if (data && baseline && bytesEqual(data, baseline)) continue;
      if (!data || data.length === 0) {
        if (baseline && baseline.length > 0) toRemove.push(cheatFilePath(key));
      } else {
        changed.set(cheatFilePath(key), data);
      }
    }
    return { changed, toRemove };
  }

  /**
   * Say WHY the net change is the number the dock shows.
   *
   * The dock renders one subtraction of two whole-image lengths, so a wrong figure has nothing
   * behind it to look at: the owner saw `-0.18 MB` on a fresh install with nothing selected,
   * then `+19.23 MB` after selecting one 48.61 KB ROM -- about 19.36 MB that is not the ROM,
   * with no way to ask what it was. This decomposes the same subtraction into named terms.
   *
   * Three groups, printed together because the bug could be in any of them:
   *
   *   `totals`  -- the arithmetic itself, with the identity `net = files + overhead`. Overhead
   *                is the FrogFS index and alignment padding, which is real and can be
   *                non-zero even when no file changed; folding it into the file numbers would
   *                hide exactly the small-unexplained-delta case.
   *   `moved`   -- per category, before and after, in bytes and file counts. This is what makes
   *                a large positive either honest (a category genuinely arrives) or a bug.
   *   `inputs`  -- what was fed in, including the prepared-asset split by provenance.
   *                `selectedPreparedAssets` keeps every `artifact` asset unconditionally and
   *                filters only `converted` ones, so an artifact that is neither a core binary
   *                nor gated homebrew -- a shipped game, say -- enters the image with no
   *                selection behind it. If that is where the bytes are, this names it.
   *
   * Both sides are exact byte counts of the same kind: the device's own `bin_sz` header and its
   * parsed per-file `dataSize`, against the built image's length and the plan's staged files.
   * Neither side is a declared-name list, so a no-change rebuild must net zero.
   *
   * Diagnostics only -- never throws, and never changes what is installed.
   */
  function reportNetChange(plan: FlashAssemblyPlan, combined: Map<string, Uint8Array>): void {
    try {
      const installed = device.installedFrogfs;
      const diff = diffFrogfs(
        {
          total: currentFrogfsLen ?? 0,
          files: (installed?.files ?? []).map((f) => ({ path: f.path, size: f.dataSize })),
        },
        { total: newFrogfsLen ?? 0, files: plan.frogfsFiles.map((f) => ({ path: f.path, size: f.data.length })) },
      );

      // Provenance of the prepared bytes merged into `combinedRoms`, which is the one input
      // whose contents are not visible from the plan alone.
      const assetBytes = { artifact: 0, converted: 0, unrecorded: 0 };
      const assetFiles = { artifact: 0, converted: 0, unrecorded: 0 };
      for (const [key, data] of selectedAssets) {
        const kind = prepareState.assetSourceOf(key) ?? "unrecorded";
        assetBytes[kind] += data.length;
        assetFiles[kind] += 1;
      }

      dbg(
        // Raw byte counts, deliberately unformatted: this line is for arithmetic, and a
        // rounded MB cannot be checked against the terms that produced it.
        "[summary] net change (bytes) = " +
          `${diff.net} (files ${diff.fileDelta} + overhead ${diff.overheadDelta}) ` +
          `= after ${diff.afterTotal} - before ${diff.beforeTotal} :: ` +
          JSON.stringify({
            totals: {
              beforeTotal: diff.beforeTotal,
              afterTotal: diff.afterTotal,
              net: diff.net,
              fileDelta: diff.fileDelta,
              overheadDelta: diff.overheadDelta,
              beforeFiles: installed?.files.length ?? null,
              afterFiles: plan.frogfsFiles.length,
              deviceRead: installed ? "parsed" : "none",
            },
            moved: movedCategories(diff),
            onlyAfter: diff.onlyAfter,
            onlyBefore: diff.onlyBefore,
            resized: diff.resized,
            inputs: {
              installAllCores,
              combinedRoms: combined.size,
              selectedRoms: romSelection.selectedKeys.size,
              selectedHomebrew: romSelection.selectedHomebrewKeys.size,
              // The two states an empty selection can be in, and what the core gate did with
              // it. A net change on an idle Library is either `selectionTouched` being true
              // when the user touched nothing, or a delta that has nothing to do with cores.
              // Without both printed, the two are indistinguishable from the outside.
              selectionTouched: romSelection.selectionTouched,
              // The gate's verdict AND what it acted on. `unusedCores` as a bare count cannot
              // say whether a missing file was gated away or was never prepared, and those
              // have opposite fixes. `preparedKeys` minus `selectedKeys` is the drop list, so
              // a core absent from the built image is attributable in one line: present in
              // prepared and absent from selected means the gate took it; absent from both
              // means nothing ever fetched it.
              unusedCores: [...unusedCoreKeys],
              preparedAssetKeys: [...extractedAssets.keys()],
              selectedAssetKeys: [...selectedAssets.keys()],
              assetBytes,
              assetFiles,
              preparedAssetsTotal: extractedAssets.size,
              previousFrogfsState: previousFrogfsState
                ? { order: previousFrogfsState.order.length, dataStart: previousFrogfsState.dataStart }
                : null,
            },
          }),
      );
    } catch (e) {
      dbg(`[summary] net-change breakdown unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function buildPreview(sig: string): Promise<void> {
    const token = ++buildToken;
    building = true;
    buildErr = null;
    try {
      const versions = await listVersions();
      if (versions.length === 0) throw new Error("No firmware versions are published yet.");
      const bundle = await fetchBundle(versions[0].tag);
      // Learn the firmware's declared install locations (manifest.paths) — the device read
      // (frogfsDevice.ts) and the SD write below have no bundle of their own to ask.
      rememberInstallPaths(bundle.manifest?.dist?.paths);
      // The Cores summary row's Flash-mode count. Free here — the bundle is already
      // fetched for the preview — where fetching one just to show a number would not be
      // (see coreBundleInfo's comment).
      bundleCoreCount = bundle.manifest.cores.length;
      // BIOS: Flash omits a slot with no games for it (biosState.filterInstall) — the preview
      // must apply the same policy as the install below, or the projected size is wrong.
      // A selected shipped game has no bytes until something fetches it, and the projection can
      // only count bytes it holds. Without this the net change ignored the selection entirely
      // (see `selectedShippedGameFetches`). Idempotent, so an unchanged selection costs nothing;
      // it also leaves `ensureCoresPrepared` with nothing to fetch at install time, which is
      // what lets the install reuse this preview instead of discarding it as predating them.
      await prepareState.prepareShippedGames(selectedShippedGameFetches());
      // Same rule one step over: a core the device already holds needs its bytes back in
      // hand or the rebuilt image silently drops it (see `deviceCoreFetches`).
      await prepareDeviceCores();
      // The selection's bytes, read here and nowhere earlier: the plan above is metadata only.
      const combinedRoms = await materialize(biosState.filterInstall(romSelection.selectedFolderRoms()));
      for (const [k, v] of selectedAssets.entries()) combinedRoms.set(k, v);
      injectCheats(combinedRoms);
      const { frogfs, plan: previewPlan } = await buildFrogfsImage(bundle, installBank, combinedRoms, {
        installAllCores,
        selectedHomebrew: romSelection.selectedHomebrewKeys,
        homebrewTitles: homebrew.titles,
        mappedArtifacts,
        frogfsOffset
      }, previousFrogfsState);
      if (token !== buildToken) return;
      builtFrogfs = frogfs;
      builtPendingLfs = previewPlan.pendingLfsFiles;
      newFrogfsLen = frogfs.length;
      builtFor = sig;
      reportNetChange(previewPlan, combinedRoms);
    } catch (e) {
      if (token !== buildToken) return;
      builtFrogfs = null;
      builtPendingLfs = [];
      newFrogfsLen = null;
      buildErr = e instanceof Error ? e.message : String(e);
    } finally {
      if (token === buildToken) building = false;
    }
  }

  // Where the FrogFS rewrite starts (for the geometry's highlighted "changed" region):
  //  • no existing FrogFS → whole new image is "changed"
  //  • additions only → appended at the current FrogFS end
  //  • any removal → from the earliest removed game's offset (forces a tail rewrite).
  // The FrogFS packer preserves the block order of retained on-device games; the delta is strictly
  // at the end (new games appended) or mid-flash (a game was dropped, shifting everything after it).
  const changedFromOffset = $derived.by<number | null>(() => {
    if (currentFrogfsLen === null) return frogfsOffset;
    if (romSelection.removals.length === 0 && romSelection.deletedUnknownHomebrew.size === 0 && homebrew.titles.every(hb => !hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f)) || romSelection.selectedHomebrewKeys.has(hb.key))) return frogfsOffset + currentFrogfsLen;
    let min = Infinity;
    for (const g of romSelection.removals) {
      const dev = device.installedGames.find((x) => x.system === g.system && x.name === g.name);
      if (dev && dev.dataOffs < min) min = dev.dataOffs;
    }
    for (const hb of homebrew.titles) {
      if (!romSelection.selectedHomebrewKeys.has(hb.key)) {
        for (const f of hb.deviceFiles) {
          const dev = deviceHomebrew.find(g => g.name === f);
          if (dev && dev.dataOffs < min) min = dev.dataOffs;
        }
      }
    }
    for (const name of romSelection.deletedUnknownHomebrew) {
      const dev = deviceHomebrew.find(g => g.name === name);
      if (dev && dev.dataOffs < min) min = dev.dataOffs;
    }
    return min === Infinity ? frogfsOffset + currentFrogfsLen : frogfsOffset + min;
  });

  // Device-flash gap check — meaningless in SD mode (a connected device's flash geometry
  // has nothing to do with SD-card capacity), so always "fits" there.
  const fitsGap = $derived(
    device.targetMedia === "sd" || newFrogfsLen === null || ceilingOffset === null
      ? true
      : frogfsOffset + newFrogfsLen <= ceilingOffset,
  );

  const currentEstSize = $derived.by(() => {
    let bytes = 0;
    for (const g of romSelection.games) {
      if (romSelection.isSelected(g.key)) bytes += g.size;
    }
    for (const k of romSelection.selectedHomebrewKeys) {
      bytes += getHomebrewSize(k);
    }
    return bytes + 65536; // 64KB overhead
  });

  let spaceAlertMessage = $state<string | null>(null);

  function validateFit(extraBytes: number): boolean {
    // Flash-only check: it compares the selection against a CONNECTED DEVICE's flash gap,
    // which is irrelevant when the write target is the SD card (that has its own, separate
    // capacity — see sdUsedBytes below). Without this, a device merely being connected while
    // the user manages SD content would wrongly block selections with a device-space error.
    if (device.targetMedia === "sd") return true;
    if (ceilingOffset === null || frogfsOffset === null) return true;
    const gap = ceilingOffset - frogfsOffset;
    if (currentEstSize + extraBytes > gap) {
      spaceAlertMessage = locale.t.roms.spaceAlert.notEnoughSpace(MiB(currentEstSize + extraBytes), MiB(gap));
      return false;
    }
    return true;
  }

  // --- SD card space scan (used-bytes only; total capacity not exposed by any web API) ----
  let sdUsedBytes = $state<number | null>(null);
  let sdScanBusy = $state(false);
  let _sdScanGen = 0; // non-reactive cancellation token

  $effect(() => {
    const handle = device.sdHandle;
    if (device.targetMedia !== "sd" || !handle) { sdUsedBytes = null; return; }
    const gen = ++_sdScanGen;
    sdScanBusy = true;
    (async () => {
      try {
        let total = 0;
        async function sumDir(dir: any) {
          for await (const [, entry] of dir.entries()) {
            if (gen !== _sdScanGen) return;
            if (entry.kind === "file") total += (await entry.getFile()).size;
            else if (entry.kind === "directory") try { await sumDir(entry); } catch { /* skip unreadable */ }
          }
        }
        await sumDir(handle);
        if (gen === _sdScanGen) sdUsedBytes = total;
      } catch {
        if (gen === _sdScanGen) sdUsedBytes = null;
      } finally {
        if (gen === _sdScanGen) sdScanBusy = false;
      }
    })();
  });

  // --- Install ROMs -----------------------------------------------------------------------
  function openInstall() {
    void installProgress.run({
      title: locale.t.roms.install.installTitle,
      body: confirmBody,
      confirmText: locale.t.shared.confirmModal.defaultConfirmText,
      phases: flashPhases,
      exec: async (report) => {
        onRunning("install-roms", true);
        try {
          await runInstall(report);
        } catch (e) {
          dbg("[install] ERROR:", e instanceof Error ? e.message : String(e));
          throw e;
        } finally {
          onRunning("install-roms", false);
        }
      },
    });
  }

  function openSdSync() {
    void installProgress.run({
      title: locale.t.roms.sdSync.syncTitle,
      body: confirmBody,
      confirmText: locale.t.shared.confirmModal.defaultConfirmText,
      phases: sdPhases,
      exec: async (report) => {
        onRunning("install-roms", true);
        try {
          await doSdSync(report);
        } catch (e) {
          dbg("[sd-sync] ERROR:", e instanceof Error ? e.message : String(e));
          throw e;
        } finally {
          onRunning("install-roms", false);
        }
      },
    });
  }

  const flashPhases: PhaseDef[] = [
    { id: "prepare", label: locale.t.roms.install.phasePrepare },
    { id: "budget", label: locale.t.roms.install.phaseBudget },
    {
      id: "build",
      label: locale.t.roms.install.phaseBuild,
      substeps: [
        { id: "retain", label: locale.t.roms.install.subRetain },
        { id: "pack", label: locale.t.roms.install.subPack },
      ],
    },
    {
      id: "flash",
      label: locale.t.roms.install.phaseFlash,
      // TWO writes, so two substeps. This phase used to declare none, on the grounds that its
      // label already named the single write -- but the LittleFS write (cores, and the language
      // blobs that moved there) runs after the FrogFS flash inside the same phase. With no
      // substep of its own it had no progress and no name, so the bar sat at 100% while work
      // visibly continued, and an install that hung there looked identical to one that had
      // finished. Declared unconditionally: an install with no cores to write still shows the
      // step, completing immediately, rather than the checklist changing shape per run.
      substeps: [
        { id: "frogfs", label: locale.t.roms.install.subFlashImage },
        { id: "cores", label: locale.t.roms.install.subFlashCores },
      ],
    },
    { id: "rescan", label: locale.t.roms.install.phaseRescan },
  ];
  // SD mode only: re-write the cores/bios/fonts bundle (sdContent), AND (on a bank2 install)
  // update_bank2.bin — the two are the same upgrade action from the user's perspective ("Upgrade
  // Retro-Go and Cores"), so a single checkbox drives both; there's no separate "include
  // firmware update" opt-in anymore. OFF by default — these rarely change and are the bulk of
  // the sync's data; only needed when preparing the SD card for a firmware/cores update, not on
  // every ROM/cover/cheat sync.
  let syncCores = $state(false);

  // Version to upgrade cores + Retro-Go to, when syncCores is on — same real
  // multi-version picker pattern as Firmware Setup's Install step (RomSection.svelte). We
  // don't display an "installed" chip here: unlike the device's intflash bank scan, there's no
  // way to read what version the SD card's existing cores/bundle are (no version header we can
  // read back from plain files), so only the target picker is shown.
  let coreVersions = $state<FirmwareVersion[]>([]);
  let selectedCoreVersionTag = $state<string>("");
  let selectedCoreVersionUserSet = false;
  $effect(() => {
    listVersions().then((v) => {
      coreVersions = v;
      if (!selectedCoreVersionUserSet && v.length > 0 && !selectedCoreVersionTag) {
        selectedCoreVersionTag = v[0].tag;
      }
    });
  });

  // Just enough of the bundle to describe what syncCores will actually write — file count +
  // core count — without a full added/changed/removed diff against the SD card (that would
  // need retaining the SD scan's cores/bios bytes AND fetching+unpacking the bundle just to show
  // a summary line; see the "cores/system-files sync delta" research — punted as not worth the
  // eager-fetch cost for a display-only number). This still fetches the (large) bundle eagerly,
  // but only once per version, and only while the checkbox is actually on.
  /** Cores in the bundle the Flash preview built from. Null until a preview has run. */
  let bundleCoreCount = $state<number | null>(null);
  let coreBundleInfo = $state<{ tag: string; fileCount: number; coreCount: number } | null>(null);
  let coreBundleLoading = $state(false);
  let coreBundleErr: string | null = $state(null);
  $effect(() => {
    const tag = selectedCoreVersionTag;
    if (!syncCores || !tag) return;
    if (coreBundleInfo?.tag === tag) return;
    coreBundleLoading = true;
    coreBundleErr = null;
    fetchBundle(tag)
      .then((bundle) => {
        rememberInstallPaths(bundle.manifest?.dist?.paths);
        coreBundleInfo = {
          tag,
          fileCount: bundle.contentFor(installBank, true).size,
          coreCount: bundle.manifest.cores.length,
        };
      })
      .catch((e) => {
        coreBundleErr = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        coreBundleLoading = false;
      });
  });

  // Only relevant for bank2 installs (OFW in bank1, Retro-Go in bank2).
  const isBank2Install = $derived(device.banks.some((b) => b.index === 2 && !!b.retroGoVersion));
  // Which bank's content tree to pull cores/homebrew from. Cores call back into firmware
  // at bank-specific absolute addresses, so this must track where Retro-Go actually lives
  // — the wrong tree hardfaults on the first core callback, it doesn't merely degrade.
  const installBank = $derived<1 | 2>(isBank2Install ? 2 : 1);

  // Sub-steps for the two system-level items (Cores, Firmware Update) only appear in the
  // checklist at all when their corresponding checkbox is actually on — otherwise they're
  // pure no-ops and shouldn't show as a checklist item to click through.
  const sdPhases = $derived<PhaseDef[]>([
    {
      id: "scan",
      label: locale.t.roms.sdSync.phaseScan,
      substeps: [
        { id: "games", label: locale.t.roms.sdSync.subGames },
        { id: "covers", label: locale.t.roms.sdSync.subCovers },
        { id: "cheats", label: locale.t.roms.sdSync.subCheats },
      ],
    },
    {
      id: "write",
      label: locale.t.roms.sdSync.phaseWrite,
      // Order matches the owner's mockup: per-game content first (games/covers/cheats/
      // removals), then the two system-level items grouped together at the end (Cores
      // == cores/bios/fonts bundle, Firmware Update — "tied together"). Both are driven by the
      // single "Upgrade Retro-Go and Cores" checkbox (syncCores) — there's no separate
      // firmware-update opt-in. "fw-update" only exists on a bank2 install (nothing to write
      // update_bank2.bin for otherwise).
      substeps: [
        { id: "games", label: locale.t.roms.sdSync.writeSubGames },
        { id: "covers", label: locale.t.roms.sdSync.writeSubCovers },
        { id: "cheats", label: locale.t.roms.sdSync.writeSubCheats },
        { id: "remove", label: locale.t.roms.sdSync.writeSubRemove },
        ...(favorites.dirty ? [{ id: "favorites", label: locale.t.roms.sdSync.writeSubFavorites }] : []),
        ...(syncCores ? [{ id: "cores", label: locale.t.roms.sdSync.writeSubCores }] : []),
        ...(syncCores && isBank2Install ? [{ id: "fw-update", label: locale.t.roms.sdSync.writeSubFwUpdate }] : []),
      ],
    },
    { id: "rescan", label: locale.t.roms.sdSync.phaseRescan },
    { id: "done", label: locale.t.roms.sdSync.phaseDone },
  ]);

  // Sticky-scroll log: auto-scroll to bottom unless the user has manually scrolled up.
  // Plain (non-reactive) flag — changes don't need to trigger re-renders.
  const hbAdditions = $derived(
    [...romSelection.selectedHomebrewKeys].filter(k => {
      const hb = homebrew.find(k);
      return hb && !hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f));
    }).length
  );
  
  const hbRemovals = $derived(
    homebrew.titles.filter(hb => hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f)) && !romSelection.selectedHomebrewKeys.has(hb.key)).length + romSelection.deletedUnknownHomebrew.size
  );

  /**
   * What an install would write for this title, RIGHT NOW, in bytes.
   *
   * PREPARED FILES ARE ASKED FOR FIRST, AND AS A SET. This used to walk `hb.deviceFiles` and
   * ask `prepareState.get()` per name, which can only ever see files the manifest NAMES:
   * `artifacts[]` plus outputs declaring a `filename`. A derived output declares an extension
   * and is named per input file, so it is absent from that list by construction — OpenLara
   * reported 136.62 KB (`OpenLara.bin` alone) with every converted `.PKD` level ignored, and
   * Doom's `.whd` games were invisible the same way. `preparedBytesFor` sums the run's own
   * provenance instead, so the number covers exactly the bytes that would be written.
   *
   * Each branch is exact for what installs now, and nothing here estimates: a title with a
   * converter it has not run installs its shipped files and no more, which is what the
   * unprepared branch reports; the moment it is prepared the same call returns the real total.
   */
  function getHomebrewSize(hbKey: string): number {
    const hb = homebrew.find(hbKey);
    if (!hb) return 0;
    const prepared = prepareState.preparedBytesFor(hbKey);
    if (prepared !== undefined) return prepared;
    // Nothing prepared this session: the shipped files, plus whatever the device already holds
    // under a name this title declares.
    let total = 0;
    for (const f of hb.deviceFiles) {
      const g = deviceHomebrew.find(x => x.name === f);
      if (g) total += g.size;
    }
    return total;
  }

  const hbAdditionsBytes = $derived.by(() => {
    let bytes = 0;
    for (const k of romSelection.selectedHomebrewKeys) {
      const hb = homebrew.find(k);
      if (hb && !hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f))) {
        bytes += getHomebrewSize(k);
      }
    }
    return bytes;
  });

  const hbRemovalsBytes = $derived.by(() => {
    let bytes = 0;
    for (const hb of homebrew.titles) {
      if (hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f)) && !romSelection.selectedHomebrewKeys.has(hb.key)) {
        bytes += getHomebrewSize(hb.key);
      }
    }
    for (const g of deviceHomebrew) {
      if (romSelection.deletedUnknownHomebrew.has(g.name)) {
        bytes += g.size;
      }
    }
    return bytes;
  });

  const netAdditionBytes = $derived(romSelection.additionsBytes + hbAdditionsBytes);
  const netRemovalBytes = $derived(romSelection.removalsBytes + hbRemovalsBytes);
  // The current configuration's own total footprint (every selected game + homebrew title,
  // installed or not) — deliberately NOT compared against sdUsedBytes (the card's actual total,
  // which includes whatever else is on there — other homebrew, unrelated files). Showing "SD
  // card used now" next to "estimated after sync" put two large, easily-confused absolute
  // numbers side by side that were often near-identical and told the user little; this is our
  // own number, calculated independent of the card's real state, answering "how much space will
  // this configuration take up" before anything gets written.
  const selectedTotalBytes = $derived.by(() => {
    let total = 0;
    for (const g of romSelection.games) if (romSelection.selectedKeys.has(g.key)) total += g.size;
    for (const k of romSelection.selectedHomebrewKeys) total += getHomebrewSize(k);
    return total;
  });

  // Would a "Sync SD Card" actually write anything? A blanket-enabled button just re-syncs
  // the exact same content over and over — no game/homebrew added or removed, no dirty
  // local edits (covers/cheats via GameDetailsPanel — see library.markDirty), and no cores
  // resync requested is a genuine no-op. freshTarget (no installed games yet) is the one
  // exception: a first-time sync writes everything selected even with zero "diff" against
  // nothing, so it counts as a change whenever something is actually selected.
  const cheatsHaveChanges = $derived.by(() => {
    const { changed, toRemove } = changedCheatEntries();
    return changed.size > 0 || toRemove.length > 0;
  });

  // Flash-mode equivalent of sdSyncHasChanges below — same "would this actually change
  // anything on the device" reasoning, minus syncCores (an SD-only checkbox; flash always
  // rebuilds the whole LittleFS/cores region unconditionally, nothing to opt into). Without
  // this, "Install ROMs" was gated ONLY on baseInstalled (does a base install exist at all),
  // so it stayed permanently clickable regardless of whether the selection actually differed
  // from what's already installed — including right after a successful install, since nothing
  // ever signaled "you're already caught up."
  const flashSyncHasChanges = $derived.by(() => {
    const freshTarget = device.installedGames.length === 0;
    const sel = romSelection.selectedKeys.size + romSelection.selectedHomebrewKeys.size;
    if (freshTarget) return sel > 0 || cheatsHaveChanges;
    return (
      romSelection.additions.length + hbAdditions > 0 ||
      romSelection.removals.length + hbRemovals > 0 ||
      library.dirtyFiles.size > 0 ||
      cheatsHaveChanges
    );
  });

  // NOTE: deliberately does NOT require device.isConnected — clicking "Install ROMs" while
  // disconnected in Flash mode is allowed and routes through the connect-gate modal (see
  // handleInstallClick above), rather than the button being unreachable while disconnected.
  const canInstallRoms = $derived(baseInstalled && flashSyncHasChanges);

  const sdSyncHasChanges = $derived.by(() => {
    const freshTarget = device.installedGames.length === 0;
    const sel = romSelection.selectedKeys.size + romSelection.selectedHomebrewKeys.size;
    if (freshTarget) return sel > 0 || cheatsHaveChanges;
    return (
      romSelection.additions.length + hbAdditions > 0 ||
      romSelection.removals.length + hbRemovals > 0 ||
      syncCores ||
      library.dirtyFiles.size > 0 ||
      cheatsHaveChanges
    );
  });

  /** "+N −M" inline addendum (StatRow/ChangeItem's `delta`, shown beside the value rather than
   *  wrapped below it like `detail`) — the shared shape for every category's "what's changing"
   *  count (ROMs, Homebrew, Cheats). Direction is just for coloring: "up" when there's a net
   *  addition (or only additions), "down" when it's removal-only. */
  function changeDelta(added: number, removed: number): { text: string; direction: "up" | "down" } | undefined {
    if (added === 0 && removed === 0) return undefined;
    const parts: string[] = [];
    if (added > 0) parts.push(`+${added}`);
    if (removed > 0) parts.push(`−${removed}`);
    return { text: parts.join(" "), direction: removed > added ? "down" : "up" };
  }

  // --- BIOS ---------------------------------------------------------------------------
  // Discovery, status AND install. A user-supplied file is stored by `biosState.addUserFiles`
  // under the `bios/<dir>/<file>` folder-scan key `biosDestKey` chooses, which is the same map
  // every other install reads — so it is written by the ordinary Flash/SD path, exactly as a
  // cover or a converter output is. The per-system directory comes from the small verified
  // table in `sources/bios.ts` (docs/proposals/bios-placement.md); an unknown system's file
  // goes to the `/bios` root rather than to a guessed subdirectory.
  $effect(() => {
    // Read every input so the effect re-runs when any of them changes.
    void biosState.sourceRefs;
    void biosState.games;
    void biosState.candidates;
    void biosState.refresh();
  });

  /** Declared slots that are present and usable — the "After" count. */
  const biosSatisfied = $derived(biosState.installable.filter((b) => b.present && !b.blocked).length);

  /** The row itself, or undefined when no active source declares a BIOS at all (in which case
   *  a BIOS line would be reporting on something nobody asked for). */
  const biosRow = $derived.by<ChangeItem | undefined>(() => {
    // Whether the row exists at all, and what it claims, is decided by `biosSummaryDecision`
    // (sources/summaryRows.ts) — this only dresses it in strings.
    const d = biosSummaryDecision({
      any: biosState.any,
      satisfied: biosSatisfied,
      outstanding: biosState.outstanding.length,
      // Real now that a BIOS is actually installed: the slots whose file is not on the target
      // medium yet are the ones this install writes.
      pendingWrites: biosState.pendingWrites,
    });
    if (!d) return undefined;
    return {
      label: locale.t.sources.bios.label,
      status: String(d.satisfied),
      kind: d.short ? "warn" : "info",
      note: d.short ? locale.t.sources.bios.needsAFile : undefined,
      delta: changeDelta(d.added, d.removed),
    };
  });

  /** The artboard's side note: the first outstanding slot, named. */
  const biosMissing = $derived(biosState.outstanding[0]);

  /**
   * BIOS IS NOT IN THIS LIST. The owner: "We should only have installable ROMs/Homebrew in the
   * list." It is not lost -- `ui/AdditionalFiles.svelte` on the Sources tab's Configure page
   * already draws every slot a core declares and takes a file for each, and it is a strictly
   * better home than these rows were: it reads `biosState.sorted`/`all` rather than
   * `installable`, so it offers a slot whose system has no games yet, which these rows could
   * not (see that file's own comment about fceumm, pce-go and SMSPlusGX).
   *
   * What stays here is the ASKING, not the browsing: `openBiosPrompt` still fires from the
   * selection and install gates below, because those are about this install rather than about
   * the source.
   */

  /** The system whose BIOS prompt is open, with every slot that system declares. `done` is the
   *  install gate's continuation — resolved on submit AND on cancel, because the gate is a
   *  reminder, not a blocker (the user may install without the file). */
  let biosPromptFor = $state<{ systemName: string; needs: BiosStatus[]; done?: () => void } | null>(null);

  /**
   * Systems the ROM-select prompt has already opened for, this session. Selecting several ROMs
   * at once (or Select All) touches many systems in one go, so the trigger below is written
   * against the SET of systems that have a selected ROM rather than against each toggle: one
   * prompt per system, never one per ROM. Dismissing counts — `openBiosPrompt` records the
   * system when it opens, so a cancelled prompt is not re-offered for that system.
   */
  const biosAskedOnSelect = new Set<string>();
  /** Systems the install-time gate has already offered. Separate from the set above on purpose:
   *  the gate is the safety net for a prompt that was dismissed at selection time, so it gets one
   *  ask of its own — and, having had it, does not nag on every subsequent install. */
  const biosAskedOnInstall = new Set<string>();
  /** False until the first pass of the effect below has recorded what was ALREADY selected when
   *  the tab mounted (the device's installed set is restored into the selection), so arriving on
   *  the tab never opens a modal — only a selection the user makes does. */
  let biosSelectBaseline = false;

  /** Systems with at least one selected ROM. `g.system` is the `roms/<system>` folder key, which
   *  is what `biosState` matches a slot's `systemId` against. */
  const selectedBiosSystems = $derived.by<Set<string>>(() => {
    const out = new Set<string>();
    for (const g of romSelection.games) if (romSelection.isSelected(g.key)) out.add(g.system);
    return out;
  });

  /**
   * Trigger 1 — selecting a ROM for a system whose BIOS requirement is unmet.
   *
   * `biosState.outstanding` is already restricted to `installable`, so the medium policy holds
   * without being restated: on Flash a slot for a system with no games (or a `conditional-idle`
   * one) is not installed and therefore never asked for; on SD every active source's slot counts.
   *
   * One system per pass, and the pass is re-run when the modal closes (`biosPromptFor` is read),
   * so two unmet systems selected together ask one after the other rather than racing.
   */
  $effect(() => {
    const selected = selectedBiosSystems;
    const missing = biosState.outstanding;
    const open = biosPromptFor !== null;
    if (!biosSelectBaseline) {
      biosSelectBaseline = true;
      for (const s of selected) biosAskedOnSelect.add(s);
      return;
    }
    if (open) return;
    const hit = missing.find((b) => selected.has(b.systemId) && !biosAskedOnSelect.has(b.systemId));
    if (hit) void openBiosPrompt(hit);
  });

  /**
   * Trigger 2 — the install itself. A required file still missing when the user commits gets one
   * last offer, then the install runs either way. Nothing is blocked and nothing is confirmed:
   * an unmet slot is the user's call, and an optional one is not raised at all (`outstanding`
   * covers `required` and `conditional-hit` only).
   */
  async function biosInstallGate(): Promise<void> {
    const hit = biosState.outstanding.find((b) => !biosAskedOnInstall.has(b.systemId));
    if (!hit) return;
    biosAskedOnInstall.add(hit.systemId);
    await new Promise<void>((resolve) => {
      void openBiosPrompt(hit, resolve);
    });
  }

  /**
   * Open `FilePromptModal` for a system, not for a single file — `ModalFilesBios` shows all of
   * one system's slots at once (a required System Card beside an optional Game Genie), which is
   * exactly one input per slot.
   */
  async function openBiosPrompt(from: BiosStatus, done: (() => void) | undefined = undefined): Promise<void> {
    biosAskedOnSelect.add(from.systemId);
    const needs = biosState.all.filter((b) => b.repo === from.repo && b.systemId === from.systemId);
    try {
      if (needs.length === 0) throw new Error("no slots");
      // The file is stored in the folder scan, so there has to be one. Existing gate, no new copy.
      await library.ensureFolders(device.targetMedia === "sd");
    } catch {
      // Nothing to ask for, or the folder gate was dismissed. The caller must still proceed —
      // an install is never held up by this.
      done?.();
      return;
    }
    biosPromptFor = { systemName: from.systemName, needs, ...(done ? { done } : {}) };
  }

  /** Close without accepting anything, releasing an install that is waiting on the prompt. */
  function dismissBiosPrompt(): void {
    const done = biosPromptFor?.done;
    biosPromptFor = null;
    done?.();
  }

  /**
   * One BIOS slot as a converter input. Nothing is converted — this reuses the prompt and, more
   * to the point, `inputGate.ts`, so a BIOS is policed by the same hash/size/strict rules as any
   * other user-supplied file.
   *
   * `strict` is only honoured when the entry publishes a `sha1`: `gateInputs` refuses everything
   * that matches no variant, so a strict input with no variants would reject every file. That is
   * `checkBiosFile`'s rule too ("Nothing published to check against"), not a relaxation of it.
   */
  function biosInput(b: BiosStatus): ConverterInput {
    const outstanding = (b.need === "required" || b.need === "conditional-hit") && (!b.present || b.blocked);
    return {
      id: b.key,
      required: outstanding,
      allowMultiple: false,
      extensions: b.filenames.map((f) => f.slice(f.lastIndexOf(".") + 1)).filter((e) => e !== ""),
      // A BIOS is kilobytes; the ceiling only stops something absurd being read into memory.
      maxBytes: Math.max(b.entry.bytes ?? 0, 1024 * 1024),
      variants: b.entry.sha1
        ? [{ id: b.entry.id, sha1: b.entry.sha1, ...(b.entry.bytes !== undefined ? { bytes: b.entry.bytes } : {}) }]
        : [],
      strict: b.entry.sha1 !== undefined && b.entry.strict !== false,
      label: b.entry.label,
      description: b.entry.description,
    };
  }

  /** The synthetic tool the prompt renders. `binary`/`limits`/`outputs` are never read: this
   *  tool is never fetched, compiled or run — the files it gathers are installed as they are. */
  const biosTool = $derived.by<PreparedTool | null>(() => {
    const p = biosPromptFor;
    if (!p) return null;
    return {
      id: "bios",
      title: { en: p.systemName },
      binary: { url: "", bytes: 0, sha256: "" },
      limits: { maxMemoryPages: 0, maxOutputBytes: 0 },
      inputs: p.needs.map(biosInput),
      outputs: [],
    };
  });

  /** Store what the gate accepted, one slot at a time, and let the install pick it up. */
  function acceptBiosFiles(files: OfferedFile[]): void {
    const p = biosPromptFor;
    biosPromptFor = null;
    if (!p) return;
    for (const need of p.needs) {
      const mine = files.filter((f) => f.inputId === need.key);
      // `addUserFiles` mirrors into the folder scan synchronously, so the install that is waiting
      // on `done` below picks the file up without waiting for the (async) re-resolve.
      if (mine.length > 0) biosState.addUserFiles(need, mine);
    }
    void biosState.refresh();
    p.done?.();
  }

  const summaryItems = $derived.by<ChangeItem[]>(() => {
    const sel = romSelection.selectedKeys.size;
    const hbSel = romSelection.selectedHomebrewKeys.size;
    // ROM-only — must NOT include hbAdditions/hbRemovals, or selecting/deselecting homebrew
    // would incorrectly move the "ROMs" row's count, which is supposed to be independent now
    // that Homebrew has its own row.
    const romsAdded = romSelection.additions.length;
    const romsRemoved = romSelection.removals.length;

    const numCheatGames = Object.values(configuredCheats).filter(c => c.length > 0).length;
    // Covers touched THIS SESSION (via library.markDirty(), GameDetailsPanel's cover-edit path) —
    // not a static total of every cover file on disk, which never changes and tells you
    // nothing about what a sync/install would actually do.
    let coversChanged = 0;
    for (const path of library.dirtyFiles) {
      const cls = classifyContentPath(path);
      if (cls.category === "cover" && cls.isDeviceCover) coversChanged++;
    }
    // Games whose cheat list actually differs from what's on the device right now — reuses
    // changedCheatEntries()'s baseline diff (already computed for SD sync gating) instead of
    // a static "how many configured" count that doesn't reflect session activity.
    const { changed: cheatsChangedMap, toRemove: cheatsRemovedList } = changedCheatEntries();
    const cheatsRow: ChangeItem = {
      label: locale.t.roms.summary.cheatsLabel,
      status: numCheatGames > 0 ? locale.t.roms.summary.cheatsConfigured(numCheatGames) : locale.t.roms.summary.noneConfigured,
      kind: numCheatGames > 0 ? "info" : "muted",
      delta: changeDelta(cheatsChangedMap.size, cheatsRemovedList.length),
    };
    // Covers have no real "removed" concept (replacing one isn't semantically removing the
    // old one) — a single "+N" delta, not a fake add/remove split.
    // Always shown now (was: hidden entirely when nothing changed this session, to match
    // ROMs/Homebrew's always-visible pattern instead of popping in/out of the list).
    const coverArtRow: ChangeItem = {
      label: locale.t.roms.summary.coverArtLabel,
      status: coversChanged > 0 ? `+${coversChanged}` : locale.t.roms.summary.noCoverChanges,
      kind: coversChanged > 0 ? "info" : "muted",
    };

    // Cores are not an opt-in any more: both media install cores, so the row is always
    // present and reports the true state. `syncCores` only changes WHAT it can say — with the
    // bundle fetched (that checkbox is the only thing that fetches it in SD mode) it names the
    // version; otherwise it is the plain count, from the Flash preview's bundle or, failing
    // that, from what the device scan found installed.
    const installedCores = device.coreVersionCheck
      ? Object.keys(device.coreVersionCheck.cores).length
      : null;
    let coresStatus: string;
    if (syncCores) {
      coresStatus = coreBundleErr
        ? locale.t.roms.summary.errorFetchingVersionInfo
        : coreBundleInfo && coreBundleInfo.tag === selectedCoreVersionTag
          ? locale.t.roms.summary.coresAndFiles(coreBundleInfo.coreCount, coreBundleInfo.fileCount, coreBundleInfo.tag)
          : coreBundleLoading
            ? locale.t.roms.summary.calculating
            : locale.t.roms.summary.willBeResynced;
    } else {
      const count = device.targetMedia === "sd"
        ? installedCores
        : bundleCoreCount ?? installedCores;
      coresStatus = count === null ? locale.t.roms.summary.calculating : String(count);
    }
    const coresRow: ChangeItem = {
      label: locale.t.roms.summary.coresLabel,
      status: coresStatus,
      kind: syncCores && coreBundleErr ? "warn" : "info",
      detail: syncCores && isBank2Install ? locale.t.roms.summary.includesFirmwareUpdate : undefined,
    };

    // The composition rule's only inputs. `media`/`syncCores` are passed and deliberately not
    // branched on there — see sources/summaryRows.ts.
    const flags = {
      media: device.targetMedia === "sd" ? ("sd" as const) : ("flash" as const),
      syncCores,
      hasBios: biosState.any,
    };

    if (device.targetMedia === "sd") {
      // Order and membership come from `composeSummaryRows` — the same call the Flash branch
      // below makes, so the two branches cannot drift apart.
      return composeSummaryRows(flags, {
        games: {
          label: locale.t.roms.summary.romsLabel,
          status: locale.t.roms.summary.selectedCount(sel),
          kind: sel > 0 ? "info" : "muted",
          delta: changeDelta(romsAdded, romsRemoved),
        },
        homebrew: {
          label: locale.t.roms.summary.homebrewLabel,
          status: hbSel > 0 ? locale.t.roms.summary.selectedCount(hbSel) : locale.t.roms.summary.noneSelected,
          kind: hbSel > 0 ? "info" : "muted",
          delta: changeDelta(hbAdditions, hbRemovals),
        },
        cores: coresRow,
        bios: biosRow,
        covers: coverArtRow,
        cheats: cheatsRow,
        total: {
          label: locale.t.roms.summary.totalProjectedSizeLabel,
          status: formatSize(selectedTotalBytes),
          kind: "info",
          total: true,
        },
      });
    }

    // Flash mode — FrogFS-specific summary. "ROMs" is just the regular-game count (sel) now
    // that Homebrew gets its own row below — the old combined "Total ROMs & Ports" count
    // double-represented the same selection across two rows.
    const sizeStr = newFrogfsLen !== null ? formatSize(newFrogfsLen) : building ? locale.t.roms.summary.calculating : "—";
    let sizeDetail: string | undefined;
    if (newFrogfsLen !== null && currentFrogfsLen !== null) {
      const net = newFrogfsLen - currentFrogfsLen;
      sizeDetail = net === 0 ? undefined : locale.t.roms.summary.netChange(net > 0 ? "+" : "", MiB(net));
    }

    // "Saves" (was: static "Preserved — untouched") and "Compression" (was: static
    // "Uncompressed (raw, XiP)") rows removed — neither conveyed actionable information.
    // Compression should come back here once LZMA is actually functional (see the disabled
    // checkbox below); showing a status for a feature that doesn't work yet was misleading.
    return composeSummaryRows(flags, {
      games: {
        label: locale.t.roms.summary.romsLabel,
        status: locale.t.roms.summary.selectedCount(sel),
        kind: fitsGap ? "info" : "warn",
        detail: !fitsGap ? locale.t.roms.install.wontFitDetail : undefined,
        delta: changeDelta(romsAdded, romsRemoved),
      },
      homebrew: {
        label: locale.t.roms.summary.homebrewLabel,
        status: hbSel > 0 ? locale.t.roms.summary.selectedCount(hbSel) : locale.t.roms.summary.noneSelected,
        kind: hbSel > 0 ? "info" : "muted",
        delta: changeDelta(hbAdditions, hbRemovals),
      },
      cores: coresRow,
      bios: biosRow,
      covers: coverArtRow,
      cheats: cheatsRow,
      total: { label: locale.t.roms.summary.totalProjectedSizeLabel, status: sizeStr, kind: "info", detail: sizeDetail, total: true },
    });
  });

  // SD mode's "before/after space" story and the per-category summaryItems used to render as
  // two separately-boxed panels stacked with a divider between them — genuinely the same kind
  // of data (what's changing this sync), just split for no real reason. United into one flat
  // StatRow[] so a single StatPanel renders the whole thing as one list.
  // summaryItems already orders Games first and "Total projected size" (selectedTotalBytes)
  // last for SD mode — this is now just the ChangeItem -> StatRow shape conversion.

  // ---- Bottom bar (presentation only — every number below already existed) ----

  /** Three-column install-summary rows for the Summary drawer. Same `summaryItems` data,
   *  reshaped: `value` becomes the "After" cell and `delta` the "Change" cell. A value that is
   *  itself a bare signed count (the Cover art row) is a CHANGE, not an after-state, so it
   *  moves to the Change column; a row that reports nothing at all (kind "muted") shows a dim
   *  em dash instead of a sentence. No maths, no new numbers. */
  const summaryGridRows = $derived.by<StatRow[]>(() =>
    summaryItems.map((it) => {
      let after = it.status;
      let delta = it.delta;
      const t = after.trim();
      if (/^[+\u2212-]\d+$/.test(t)) {
        delta = delta ?? { text: t, direction: t.startsWith("+") ? "up" : "down" };
        after = "\u2014";
      } else if (it.kind === "muted") {
        after = "\u2014";
      }
      return { label: it.label, value: after, delta, detail: it.detail, total: it.total, tone: it.kind, note: it.note };
    }),
  );

  /** Flash-only gate copy (device not connected / not scanned / no Retro-Go). Reads
   *  device.partitions-derived state, so it early-returns in SD mode. */
  const flashGateNote = $derived.by<string | null>(() => {
    if (device.targetMedia === "sd") return null;
    if (!device.isConnected) return locale.t.roms.install.connectPrompt;
    if (!partitionsKnown) return device.scanning ? locale.t.roms.install.scanningDevice : locale.t.roms.install.scanDevicePrompt;
    if (!baseInstalled) return locale.t.roms.install.installFirstPrompt;
    return null;
  });
  const flashReady = $derived(device.targetMedia !== "sd" && flashGateNote === null);

  /** SD-only gate copy (RomsSdNoCard.dc.html:241 — the bar's left caption when no card has
   *  been picked). Reads `device.sdReady` only; it must NOT consult device.partitions-derived
   *  state, which is a Flash-mode concept (CLAUDE.md / AUDIT_NOTES #14). */
  const sdGateNote = $derived.by<string | null>(() =>
    device.targetMedia === "sd" && !device.sdReady ? locale.t.roms.sdSync.chooseCardPrompt : null,
  );
  /** Whichever mode's gate copy applies; at most one is ever non-null. */
  const gateNote = $derived(flashGateNote ?? sdGateNote);

  /**
   * Is there a target to summarise AGAINST? The summary's numbers are all statements about a
   * specific destination — the projected FrogFS size against the device's real gap, the net
   * change against what is installed, the core count, what a sync would write — so without
   * one there is nothing to say and the whole panel is withheld rather than padded with
   * "Calculating…" placeholders that may never resolve.
   *
   *   - Flash: a connected device that has been scanned (partitions known) and has Retro-Go
   *     installed — exactly `flashReady`, the same gate the Install button uses, and the state
   *     `flashGateNote` already explains in the bar below.
   *   - SD: a card actually in hand (`device.sdReady` — a picked handle, not merely having
   *     chosen "SD" as the target). A connected device is NOT a target here (CLAUDE.md).
   */
  const targetValid = $derived(device.targetMedia === "sd" ? device.sdReady : flashReady);

  /** The device's real flash gap — Flash-mode only (device.partitions-derived). */
  const gapBytes = $derived(
    device.targetMedia === "sd" || ceilingOffset === null ? null : ceilingOffset - frogfsOffset,
  );
  /** Projected payload for the 3px meter strip; falls back to the current on-device size. */
  const meterUsed = $derived(device.targetMedia === "sd" ? null : (newFrogfsLen ?? currentEstSize));
  const meterPct = $derived(
    gapBytes && gapBytes > 0 && meterUsed !== null ? Math.max(0, Math.min(100, (meterUsed / gapBytes) * 100)) : 0,
  );
  /** Audit S1.8. Roms.dc.html / LibrarySummary.dc.html draw the strip as TWO segments on a
   *  #d8d8d8 track: what is installed today (#3e9e4e) followed by what this install would
   *  add (#9a9aa0). Both figures already exist — `currentFrogfsLen` is the on-device size
   *  and `meterUsed` the projected one; nothing new is computed or fetched. Flash-only, like
   *  the strip itself (see the template guard). */
  const meterInstalledPct = $derived.by(() => {
    if (!gapBytes || gapBytes <= 0 || meterUsed === null) return 0;
    const installed = Math.min(currentFrogfsLen ?? meterUsed, meterUsed);
    return Math.max(0, Math.min(100, (installed / gapBytes) * 100));
  });
  const meterPendingPct = $derived(Math.max(0, meterPct - meterInstalledPct));

  /** Left-hand budget line. Flash: projected / available gap. SD: total projected size. */
  const budgetText = $derived.by<string>(() => {
    if (device.targetMedia === "sd") return formatSize(selectedTotalBytes);
    if (gapBytes === null || meterUsed === null) return "";
    // Artboard (RomsNewSystem/LibrarySummary): `3.54 MB of 50 MB projected` — the figures are
    // runtime data, the surrounding words are copy and belong in the string tables.
    return locale.t.roms.summary.projected(MiB(meterUsed), MiB(gapBytes));
  });

  /** Net change vs. what's on the device now (Flash only — SD has no equivalent baseline). */
  const netChangeText = $derived.by<string | null>(() => {
    if (device.targetMedia === "sd") return null;
    if (newFrogfsLen === null || currentFrogfsLen === null) return null;
    const net = newFrogfsLen - currentFrogfsLen;
    if (net === 0) return null;
    // Same rule as `budgetText`: the artboard reads `+0.12 MB net change`, and
    // `summary.netChange` already carries that sentence in all seven locales.
    return locale.t.roms.summary.netChange(net > 0 ? "+" : "\u2212", MiB(Math.abs(net)));
  });

  /** Title for the "Additional options" drawer — names the selected game. */
  /* RomsOptions.dc.html (2026-09-08 refresh) captions the drawer
     `Additional options — Aerobiz Supersonic`: the section name STAYS, the game name is
     appended after an em dash. Composed from the existing `summary.additionalOptions`
     string (the same words the bar's toggle uses, sentence case as the artboard draws it)
     plus runtime data, so no new translated key is needed. */
  const selectedGameLabel = $derived.by<string>(() => {
    const head = locale.t.roms.summary.additionalOptions;
    const named = (name: string) => `${head} — ${name.replace(/\.[^/.]+$/, "")}`;
    if (!selectedCarouselId) return head;
    const g = visibleGames.find((x) => x.key === selectedCarouselId);
    // A row's `name` is already extension-free; `unknownHomebrew` below is a raw filename.
    if (g) return `${head} — ${g.name}`;
    const hb = unknownHomebrew.find((x) => x.name === selectedCarouselId);
    return hb ? named(hb.name) : head;
  });

  /** Install/sync confirmation sentence — names the device or the SD card per the install target. */
  const confirmBody = $derived(
    device.targetMedia === "sd" ? locale.t.roms.sdSync.syncBody : locale.t.roms.install.installBody,
  );

  /** Convert a userRoms key to its SD card path.
   *  The directories are the FIRMWARE's (manifest `paths`, engine/devicePaths.ts's
   *  `sdDestPath`), the same source `flashImage.ts`'s `userDest()` uses for the flash write —
   *  notably `homebrew/<file>` lands in the manifest's homebrew directory (`/homebrews`), not
   *  under `roms/`. "cheat"/"cover"/"bios" keys already arrive fully rooted in the firmware's
   *  own trees and pass through untouched. */
  function toSdPath(key: string): string {
    return sdDestPath(key, classifyContentPath(key).category, deviceInstallPaths());
  }

  /**
   * The path the FIRMWARE would use for this row, or null when it will not have one.
   *
   * THIS NO LONGER DECIDES WHO GETS A STAR. Every row is starrable; this is the write-time half,
   * used only to build `/data/favorites.txt` from the favourited-and-installed intersection. A
   * row that returns null here is still remembered locally and starts appearing in the file the
   * moment it resolves, with no further action from the user.
   */
  function favoritePathFor(g: any): string | null {
    const key: string | undefined = g.isHomebrew
      ? (g.hb.deviceFiles.length === 1 && g.hb.derivedOutputs === 0
          ? `${HOMEBREW_KEY_PREFIX}/${g.hb.deviceFiles[0]}`
          : undefined)
      : (g.outputKey ?? g.key);
    if (!key || g.needsPrepare) return null;
    const path = toDevicePath(toSdPath(key));
    return isFavoritable(path) ? path : null;
  }

  /**
   * Row id -> the device path it will occupy after this sync, or null.
   *
   * THE INTERSECTION. A row contributes to `/data/favorites.txt` only when it will actually be
   * on the device: already installed, or selected to be written by this very sync. A starred row
   * that is neither stays remembered locally and simply is not in the file, and it appears the
   * next time it is installed without the user starring it again.
   */
  function favoriteWritePath(rowId: string): string | null {
    const g = allFavoritableRows().find((r: any) => r.key === rowId);
    if (!g) return null;
    const landing = g.installed === true || romSelection.isRowSelected(g) === true;
    if (!landing) return null;
    return favoritePathFor(g);
  }

  /** Every row the library knows, whether or not the current filter shows it. */
  function allFavoritableRows(): any[] {
    return [
      ...romSelection.rows.map((r: any) => ({ ...r, name: r.listName, isHomebrew: false })),
      ...homebrew.titles
        .filter((hb) => !hb.isCore)
        .map((hb) => ({ key: hb.key, isHomebrew: true, hb, needsPrepare: false, installed: false })),
    ];
  }

  /** Per-category SD sync policy — the explicit source of truth for "does this category get
   *  (re)written, and when." "always" means unconditionally included regardless of dirty/added
   *  state; "added-or-dirty" defers to the freshTarget/addedKeys/dirtyFiles checks below. A new
   *  category added to ContentCategory MUST get an entry here, or TypeScript's Record will
   *  refuse to compile — that's the whole point (see the homebrew-cover bug this replaced,
   *  where a new category silently fell through a growing ad-hoc boolean chain instead).
   *  "cheat" is "always" here to match injectCheats() unconditionally regenerating cheat
   *  entries afterward regardless (final output is identical either way); "homebrew" is
   *  "always" because those `homebrew/<file>` keys are merged into userRoms in doSdSync() and
   *  DO flow through the write loop (bucketed as "games" by SD_WRITE_BUCKET, pathed by
   *  toSdPath). Note this filter is about DIRTY/ADDED, not about selection: `selectedAssets`
   *  has already dropped the converted bytes of anything deselected. */
  const SD_SYNC_POLICY: Record<ContentCategory, "always" | "added-or-dirty"> = {
    game: "added-or-dirty",
    bios: "added-or-dirty",
    cover: "added-or-dirty", // homebrew covers get an additional carve-out below
    cheat: "always",
    homebrew: "always",
  };

  /** Narrow the full selection down to what actually needs (re)writing to the SD card this
   *  time. A blanket rewrite of every selected ROM/cover/cheat file on every sync is slow and
   *  pointless — most of it is already on the card, untouched. Kept here instead of pushed
   *  into romSelection/roms so the "what's new since last SD sync" concept stays local to the
   *  one place that needs it (Flash mode's FrogFS rebuild has no equivalent cost problem: it's
   *  a single monolithic image regenerated from scratch either way). */
  function changedSdUserRoms(userRoms: Map<string, Uint8Array>): Map<string, Uint8Array> {
    // No games recorded on the SD card at all yet (e.g. a freshly formatted/picked folder) —
    // treat this as a first-time prep and write everything selected, bios included.
    const freshTarget = device.installedGames.length === 0;
    const addedKeys = new Set(romSelection.additions.map((g) => g.key));
    // Homebrew titles aren't tracked in romSelection.additions at all — they're excluded from
    // `games` (NON_GAME_SYSTEMS in romSelection.svelte.ts) since their device files are
    // generated, not folder files. So toggling one on this session never lands in addedKeys,
    // and its cover (covers/homebrew/<displayName>.*, set by GameDetailsPanel) only gets
    // synced by coincidence — if it happens to also be in library.dirtyFiles from an unrelated
    // edit. Compute the homebrew equivalent of "newly added" here so a title's cover reliably
    // ships the first time it's selected, matching how a selected title's prepared files are
    // included below regardless of this dirty/added filter.
    const deviceHomebrewNames = new Set(deviceHomebrew.map((g) => g.name));
    const newlySelectedHomebrew = new Set(
      homebrew.titles.filter(
        (hb) =>
          romSelection.selectedHomebrewKeys.has(hb.key) &&
          !hb.deviceFiles.every((f) => deviceHomebrewNames.has(f)),
      ).map((hb) => hb.displayName),
    );
    const out = new Map<string, Uint8Array>();
    for (const [path, data] of userRoms) {
      const cls = classifyContentPath(path);
      const isNewHomebrewCover = cls.homebrewCoverName !== undefined && newlySelectedHomebrew.has(cls.homebrewCoverName);
      const included =
        freshTarget ||
        SD_SYNC_POLICY[cls.category] === "always" ||
        addedKeys.has(path) ||
        library.dirtyFiles.has(path) ||
        isNewHomebrewCover;
      if (included) out.set(path, data);
    }
    return out;
  }

  /** Sync the current ROM selection (+ covers, cheats, homebrew assets, optionally cores) to
   *  the SD card. Only writes files that are new or changed since the last sync — see
   *  changedSdUserRoms. Chromium: writes directly via FSAA. Firefox (no sdHandle): ZIP download. */
  async function doSdSync(report: PhaseReporter): Promise<void> {
    // Two selected files that are one file on the card cannot both be written. Refused, never
    // renamed around and never silently reduced to one — see romSelection.installNameError().
    const nameClash = romSelection.installNameError();
    if (nameClash) throw nameClash;
    // Same reason as the ROM install: `coreGate` keeps prepared cores, it cannot fetch one, and
    // a core with no bytes writes nothing. The gate is a no-op on SD (every core ships), which
    // makes the fetch matter here too.
    void (await ensureCoresPrepared(report));
    // User content: ROMs + bios (only the changed subset — see changedSdUserRoms), covers,
    // homebrew assets (always freshly-prepared, see prepareTitle), cheats (only the games
    // whose overlay actually differs from the on-device baseline — see changedCheatEntries).
    // Categorize the flat diff by content type so the checklist accurately shows what's
    // actually changing, not just a total file count.
    report.start("scan");
    const freshTarget = device.installedGames.length === 0;
    // filterInstall is a no-op on SD by design: an active source's BIOS is written whether or
    // not the user has games for it, because ROMs reach a card outside this app.
    const userRoms = changedSdUserRoms(await materialize(biosState.filterInstall(romSelection.selectedFolderRoms())));
    for (const [k, v] of selectedAssets) userRoms.set(k, v);
    const { changed: changedCheatFiles, toRemove: cheatsToRemove } = changedCheatEntries();
    for (const [k, v] of changedCheatFiles) userRoms.set(k, v);

    const changedGames = new Map<string, Uint8Array>(); // roms/ + bios/ + homebrew/
    const changedCovers = new Map<string, Uint8Array>();
    const changedCheats = new Map<string, Uint8Array>();
    // Same category set as SD_SYNC_POLICY above, this time mapping to which write bucket (and
    // progress substep) a category lands in, rather than whether it's included at all.
    const SD_WRITE_BUCKET: Record<ContentCategory, Map<string, Uint8Array>> = {
      game: changedGames,
      bios: changedGames,
      homebrew: changedGames,
      cheat: changedCheats,
      cover: changedCovers,
    };
    for (const [path, data] of userRoms) {
      const cls = classifyContentPath(path);
      // convertCoversInMap (library.svelte.ts) keeps BOTH the converted .img sidecar and the
      // original PNG/JPG in the scanned map — the original is for local UI display only.
      // The SD card (like the device) only ever wants the converted .img.
      if (cls.category === "cover" && !cls.isDeviceCover) continue;
      SD_WRITE_BUCKET[cls.category].set(path, data);
    }

    report.subStart("scan", "games");
    report.log(
      "scan",
      msg(
        (t) => t.roms.sdSync.logGamesScanned,
        changedGames.size,
        romSelection.removals.length,
        freshTarget ? msg((t) => t.roms.sdSync.freshTargetSuffix) : "",
      ),
      "games",
    );
    report.subFinish("scan", "games");

    report.subStart("scan", "covers");
    report.log("scan", msg((t) => t.roms.sdSync.logCoversScanned, changedCovers.size), "covers");
    report.subFinish("scan", "covers");

    report.subStart("scan", "cheats");
    report.log("scan", msg((t) => t.roms.sdSync.logCheatsScanned, changedCheats.size), "cheats");
    report.subFinish("scan", "cheats");

    report.log(
      "scan",
      syncCores
        ? msg((t) => t.roms.sdSync.logCoresWillResync, isBank2Install)
        : msg((t) => t.roms.sdSync.logCoresSkipped));
    report.finish("scan");

    // Cores/bios/fonts from the latest bundle — the bulk of the sync's data and rarely
    // changed, so only fetched/written when explicitly requested (syncCores). A bank2 install's
    // update_bank2.bin comes from the same bundle/version and is written under the same
    // checkbox — there's no separate firmware-update opt-in.
    report.start("write");
    const sdHandle = device.sdHandle;
    try {
    const needsBundle = syncCores;
    let sdContent: Map<string, Uint8Array> = new Map();
    let sd2Blob: Uint8Array | undefined;
    if (needsBundle) {
      const tag = selectedCoreVersionTag || (await listVersions())[0]?.tag;
      report.log("write", msg((t) => t.roms.sdSync.logFetchingBundle, tag), "cores");
      const bundle = await fetchBundle(tag);
      rememberInstallPaths(bundle.manifest?.dist?.paths);
      if (syncCores) sdContent = bundle.contentFor(installBank, true);
      sd2Blob = bundle.blobs.sd_2;
    }

    // Pre-seed known totals for the per-file substeps so the checklist shows "[0/N]" for each
    // even before it goes active (owner's mockup: "Remove de-selected games [0/2]" shown while
    // still pending) — the counts are already known from the diff, no need to wait.
    report.progress("write", 0, changedGames.size, "games");
    report.progress("write", 0, changedCovers.size, "covers");
    report.progress("write", 0, changedCheats.size, "cheats");
    report.progress("write", 0, romSelection.removals.length, "remove");

    // A directory handle is not automatically a WRITABLE one: on non-Chromium, pickFolder()
    // returns the `<input webkitdirectory>` shim tree (romScan.ts) and pickSdCardFolder
    // assigns it to device.sdHandle all the same. A shim is truthy but has no
    // getDirectoryHandle/createWritable, so per-file "writes" would silently degrade into N
    // flattened browser downloads while the log claimed a successful card sync. Write-back
    // capability, not mere presence, is what picks the branch.
    if (sdHandle && dirSupportsWriteBack(sdHandle)) {
      // Order matches the owner's mockup: per-game content first, system-level items last.
      report.subStart("write", "games");
      report.log("write", changedGames.size > 0 ? msg((t) => t.roms.sdSync.logWritingGames, changedGames.size) : msg((t) => t.roms.sdSync.logNoGameChanges), "games");
      {
        let done = 0;
        const total = changedGames.size;
        for (const [key, data] of changedGames) {
          const path = toSdPath(key);
          dbg("[sd-sync] game", path);
          report.log("write", path, "games");
          await saveFileToDirOrDownload(sdHandle, path, data);
          done++;
          report.progress("write", done, total, "games");
        }
      }
      report.subFinish("write", "games");

      report.subStart("write", "covers");
      report.log("write", changedCovers.size > 0 ? msg((t) => t.roms.sdSync.logWritingCovers, changedCovers.size) : msg((t) => t.roms.sdSync.logNoCoverChanges), "covers");
      {
        let done = 0;
        const total = changedCovers.size;
        for (const [key, data] of changedCovers) {
          const path = toSdPath(key);
          dbg("[sd-sync] cover", path);
          report.log("write", path, "covers");
          await saveFileToDirOrDownload(sdHandle, path, data);
          done++;
          report.progress("write", done, total, "covers");
        }
      }
      report.subFinish("write", "covers");

      report.subStart("write", "cheats");
      report.log("write", changedCheats.size > 0 ? msg((t) => t.roms.sdSync.logWritingCheats, changedCheats.size) : msg((t) => t.roms.sdSync.logNoCheatChanges), "cheats");
      {
        let done = 0;
        const total = changedCheats.size;
        for (const [key, data] of changedCheats) {
          const path = toSdPath(key);
          dbg("[sd-sync] cheat", path);
          report.log("write", path, "cheats");
          await saveFileToDirOrDownload(sdHandle, path, data);
          done++;
          report.progress("write", done, total, "cheats");
        }
      }
      report.subFinish("write", "cheats");

      // FAVORITES. `/data/favorites.txt` belongs to the firmware, which appends on star and
      // rewrites on unstar (`rg_favorites.c`), so this MERGES rather than replaces: a star set
      // on the device is real data we did not author. Written only when there is something to
      // write, so a sync by a user who never starred anything does not touch the file at all.
      if (favorites.dirty) {
        report.subStart("write", "favorites");
        report.log("write", msg((t) => t.roms.sdSync.logWritingFavorites), "favorites");
        const existing = await readTextFromDir(sdHandle, FAVORITES_DEVICE_PATH);
        const next = favorites.fileFor(existing, favoriteWritePath);
        if (next !== existing) {
          dbg("[sd-sync] favorites", FAVORITES_DEVICE_PATH);
          await saveFileToDirOrDownload(sdHandle, FAVORITES_DEVICE_PATH, new TextEncoder().encode(next));
        }
        report.subFinish("write", "favorites");
      }

      report.subStart("write", "remove");
      if (romSelection.removals.length > 0) {
        report.log("write", msg((t) => t.roms.sdSync.logRemoving, romSelection.removals.length), "remove");
        let done = 0;
        const total = romSelection.removals.length;
        for (const g of romSelection.removals) {
          const path = toSdPath(g.key);
          dbg("[sd-sync] remove", path);
          try {
            await deleteFileFromDir(sdHandle, path);
            report.log("write", msg((t) => t.roms.sdSync.logRemoved, path), "remove");
          } catch (e) {
            report.log("write", msg((t) => t.roms.sdSync.logCouldNotRemove, path, errText(e)), "remove");
          }
          done++;
          report.progress("write", done, total, "remove");
        }
      } else {
        report.log("write", msg((t) => t.roms.sdSync.logNoGamesToRemove), "remove");
      }
      // Cheat files for a game whose overlay was cleared but the baseline still had one on the
      // device — injectCheats' write-only shape can't signal this, changedCheatEntries does.
      for (const path of cheatsToRemove) {
        dbg("[sd-sync] remove cheat", path);
        try {
          await deleteFileFromDir(sdHandle, path);
          report.log("write", msg((t) => t.roms.sdSync.logRemovedClearedCheat, path), "remove");
        } catch (e) {
          report.log("write", msg((t) => t.roms.sdSync.logCouldNotRemove, path, errText(e)), "remove");
        }
      }
      report.subFinish("write", "remove");

      // "cores"/"fw-update" only exist as checklist items when their checkbox is on (see
      // sdPhases) — only report through them when that's actually the case.
      if (syncCores) {
        report.subStart("write", "cores");
        if (sdContent.size > 0) {
          report.log("write", msg((t) => t.roms.sdSync.logWritingCores, sdContent.size, sumBytes(sdContent)), "cores");
          let done = 0;
          const total = sdContent.size;
          report.progress("write", 0, total, "cores");
          for (const [path, data] of sdContent) {
            dbg("[sd-sync] core", path);
            report.log("write", path, "cores");
            await saveFileToDirOrDownload(sdHandle, path, data);
            done++;
            report.progress("write", done, total, "cores");
          }
        } else {
          report.log("write", msg((t) => t.roms.sdSync.logCoresSkippedWrite), "cores");
        }
        report.subFinish("write", "cores");
      }

      if (syncCores && isBank2Install) {
        report.subStart("write", "fw-update");
        if (sd2Blob) {
          // update_bank2.bin = raw intflash binary; the on-device firmware_update app
          // checks for this file directly and flashes it to bank2.
          report.log("write", msg((t) => t.roms.sdSync.logWritingFwUpdate, sd2Blob!.length), "fw-update");
          await saveFileToDirOrDownload(sdHandle, "update_bank2.bin", sd2Blob);
        } else {
          report.log("write", msg((t) => t.roms.sdSync.logFwUpdateSkipped), "fw-update");
        }
        report.subFinish("write", "fw-update");
      }
    } else {
      // Firefox (and any other no-write-back handle) — pack everything into a ZIP for download.
      report.log("write", msg((t) => t.roms.sdSync.logNoSdHandleZip));
      const zip = new JSZip();
      for (const [path, data] of sdContent) zip.file(path, data);
      for (const [key, data] of [...changedGames, ...changedCovers, ...changedCheats]) zip.file(toSdPath(key), data);
      if (syncCores && isBank2Install && sd2Blob) {
        zip.file("update_bank2.bin", sd2Blob);
      }
      // Phase-level (no substepId): this Firefox branch writes no per-file substeps at all,
      // and InstallProgressModal draws the phase bar unconditionally. JSZip's percent is
      // 0..100 and already monotonic; clamped anyway so the bar can never overrun.
      const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
        report.progress("write", Math.max(0, Math.min(100, Math.round(meta.percent))), 100);
      });
      download(locale.t.roms.sdSync.zipDownloadName, blob);
    }
    report.finish("write");
    } finally {
      // Always rescan — success or failure — so the UI reflects what's actually on the SD
      // card right now, not stale pre-sync state. Deliberately NOT in the try body above: if
      // any write throws, everything after it in that block is skipped, and this rescan must
      // still run. library.clearDirty() below is the opposite — it must NOT run on failure, or
      // "Sync SD Card" would go disabled (sdSyncHasChanges) even though the failed writes are
      // still pending, silently hiding that there's still work to do.
      report.start("rescan");
      if (sdHandle) {
        report.log("rescan", msg((t) => t.roms.sdSync.logRescanning));
        await device.scanSdCardGames(); // mirrors runInstall()'s post-FrogFS-flash rescan
        await loadCheatsBaseline(); // re-read cheats/ so the next sync's diff has a fresh baseline
      } else {
        report.log("rescan", msg((t) => t.roms.sdSync.logNoSdHandleRescan));
      }
      report.finish("rescan");
    }

    report.start("done");
    library.clearDirty(); // synced — next sync starts clean unless something changes again
    report.finish("done");
  }

  /**
   * Fetch the artifacts of every core the current selection needs and does not already hold.
   *
   * The registry says which core owns a `roms/<folder>`; `selectedSystems` says which folders
   * have a ROM selected. A core already prepared is left alone, and one whose fetch fails is
   * skipped rather than failing the install: the ROMs still install, and the audit log says
   * what is missing. Both media call this, because a core reaching an SD card needs its bytes
   * exactly as much as one reaching flash does.
   */
  async function ensureCoresPrepared(
    report: PhaseReporter | undefined = undefined,
  ): Promise<boolean> {
    // Resolve the selected systems to their core targets through the registry, then fetch the
    // artifacts of any that are not already prepared.
    //
    // THE TARGET COMES FROM THE SOURCE MANIFEST, NOT FROM `homebrew.titles`. That list is
    // "targets with something to prepare" and drops a core declaring no converter
    // (`homebrewTitles.svelte.ts`: `if (isCore && tool === undefined) continue;`), which is most
    // cores. tgb-dual is exactly that: a core with no converter, absent from `titles`, so the
    // fetch loop matched nothing and a GBC ROM installed with no core at all. Doom was the only
    // core in that list because it happens to convert a WAD.
    const needed = new Set<string>();
    for (const sys of selectedSystems) {
      for (const s of coreRegistry.current.systems) {
        if (s.folder.toLowerCase() === sys) needed.add(s.targetKey);
      }
    }
    let fetched = false;
    const already: string[] = [];
    const got: string[] = [];
    const unresolved: string[] = [];
    for (const key of needed) {
      if (prepareState.preparedBytesFor(key) !== undefined) { already.push(key); continue; }
      const hash = key.lastIndexOf("#");
      const repo = hash < 0 ? key : key.slice(0, hash);
      const targetId = hash < 0 ? "" : key.slice(hash + 1);
      const row = sources.rows.find((r) => r.repo === repo && r.active && r.manifest);
      const target = row?.manifest?.targets.find((t) => t.id === targetId);
      if (!target) { unresolved.push(key); continue; }
      try {
        if (await prepareState.prepareCoreArtifacts(key, target)) {
          got.push(key);
          fetched = true;
        }
        // The games this target SHIPS, fetched in the same pass and for the same reason: a
        // selected row needs bytes by install time, and a shipped game has none until now. Its
        // destination is `roms/<system id>/`, not the core directory, so the key is the
        // system's folder -- the same key space a converted output lands in.
        const shipped = coreRegistry.current.systems
          .filter((sys) => sys.targetKey === key)
          .flatMap((sys) =>
            sys.shippedGames.map((g) => ({ key: `${sys.folder}/${g.filename}`, url: g.url, sha256: g.sha256 })),
          );
        if (await prepareState.prepareShippedGames(shipped)) fetched = true;
      } catch (e) {
        dbg("[install] core artifacts unavailable:", key, errText(e));
        report?.log("build", `core artifacts unavailable: ${key}: ${errText(e)}`, "pack");
      }
    }
    // Raw diagnostic text, not UI copy: the flasher's own device lines go into this log the
    // same way (`report.log("flash", line)`), so this needs no string-table entry. Logged even
    // when everything succeeds, because three steps can drop a core and each was silent.
    const verdict = JSON.stringify({
      selectedSystems: [...selectedSystems],
      neededTargets: [...needed],
      alreadyPrepared: already,
      fetchedNow: got,
      unresolved,
      droppedByGate: [...unusedCoreKeys],
    });
    dbg("[install] cores:", verdict);
    report?.log("build", `cores: ${verdict}`, "pack");
    return fetched;
  }

  async function runInstall(report: PhaseReporter): Promise<void> {
    // Same refusal as doSdSync, and for the same reason — see romSelection.installNameError().
    const nameClash = romSelection.installNameError();
    if (nameClash) throw nameClash;
    report.start("prepare");
    report.log("prepare", msg((t) => t.roms.install.logConnecting));
    dbg("[install] start", { frogfsOffset: hex(frogfsOffset), ceiling: hex(ceilingOffset ?? 0), eraseBlock, extBytes: device.extFlashBytes });
    const flasher = await device.ensureStub();
    report.log("prepare", msg((t) => t.roms.install.logFlashUtilReady, hex(frogfsOffset), eraseBlock, device.extFlashBytes));
    report.finish("prepare");

    report.start("budget");
    // Raw byte counts, not formatted sizes: these are the numbers you compare against a
    // manifest or an offset when a budget check goes wrong. "?" when the ceiling is unknown.
    const gapBytes = ceilingOffset !== null ? String(ceilingOffset - frogfsOffset) : "?";
    if (!fitsGap) {
      report.log("budget", msg((t) => t.roms.install.logBudgetBlocked, currentEstSize, gapBytes));
      throw new Error(locale.t.roms.install.errBudgetBlocked);
    }
    report.log("budget", msg((t) => t.roms.install.logBudgetFits, currentEstSize, gapBytes));
    report.finish("budget");

    report.start("build");
    const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);
    const userRoms = await materialize(biosState.filterInstall(romSelection.selectedFolderRoms()));
    dbg("[install] folder roms:", userRoms.size, "retained:", romSelection.retainedFromDevice.length);
    // Preserve on-device-only selected games by re-reading their bytes from the device FrogFS.
    // Fetch the artifacts of every core this selection needs, BEFORE anything reads
    // `selectedAssets`. `coreGate` can only keep what `prepareState` already holds: it decides
    // which prepared cores survive, it cannot go and get one. A user who selects a GBC ROM
    // without having opened Sources and prepared tgb-dual has no bytes for it, so the gate kept
    // nothing, the packer wrote nothing, and the core never reached `cores/`.
    //
    // `run(title, [])` with an empty offer is the artifact-only path: it fetches the target's
    // artifacts and converts nothing when the title has no tool, which is what a core is.
    //
    // AND IT MUST INVALIDATE THE PREVIEW. `builtFrogfs`/`builtPendingLfs` come from the preview
    // effect, which ran while those bytes were still missing, and `selSig` does not change when
    // a fetch adds them -- so reusing the preview shipped the ROM with no core even though the
    // fetch had just succeeded. That was the second report of this same symptom.
    const fetchedCores = await ensureCoresPrepared(report);
    if (fetchedCores) {
      dbg("[install] cores fetched during install -> rebuilding, the preview predates them");
      builtFrogfs = null;
      builtPendingLfs = [];
    }

    report.subStart("build", "retain");
    const retained = romSelection.retainedFromDevice;
    // Collected first (rather than read inline) purely so the byte total below is known up
    // front — these are multi-MB SWD reads that previously ran with no progress at all.
    const toRead: { path: string; dev: InstalledGame }[] = [];
    for (const g of retained) {
      const dev = device.installedGames.find((x) => x.system === g.system && x.name === g.name);
      if (dev) toRead.push({ path: `${g.system}/${g.name}`, dev });
    }
    // Always preserve on-device HOMEBREW (engine .bin + converter-generated assets): these
    // aren't user-folder games and must survive a repack. The bundle re-adds the .bin engines
    // anyway; re-reading covers the generated assets too. Titles themselves come from the
    // active sources' manifests — see sources/homebrewTitles.svelte.ts.
    const deviceHomebrew = device.installedGames.filter((g) => g.system === "homebrew");
    for (const g of deviceHomebrew) {
      if (romSelection.deletedUnknownHomebrew.has(g.name)) continue;
      const hb = homebrew.owning(g.name);
      if (hb && !romSelection.selectedHomebrewKeys.has(hb.key)) continue;
      toRead.push({ path: `${g.system}/${g.name}`, dev: g });
    }
    // DO NOT RE-READ WHAT WE ALREADY HAVE. Every entry here is a multi-MB SWD read, and
    // deselecting one game made the install re-read every other retained game and every
    // homebrew asset to rebuild the image -- minutes of reading to change one file.
    //
    // A local copy is preferred when one exists at the same key AND its length matches what the
    // device reports for that entry. Length is the only cheap discriminator: FrogFS entries are
    // not 256 KiB aligned, so the stub's chunk hashes cannot speak about one file. A same-length
    // but different build would be taken from the local copy, which is the intended behaviour
    // anyway -- the local library is the source these were installed from.
    // Sizes come from metadata, so a zipped ROM is matched without being inflated; only the
    // one that MATCHES is read, and only then.
    const localFor = async (path: string, size: number): Promise<Uint8Array | undefined> => {
      const candidates: (LibraryFile | undefined)[] = [
        userRoms.get(path),
        selectedAssets.get(path),
        prepareState.assets.get(path),
        library.scan?.userRoms.get(path),
      ];
      for (const c of candidates) if (c && c.length === size) return await romBytes(c);
      return undefined;
    };
    let reusedLocally = 0;
    let reusedBytes = 0;
    for (let i = toRead.length - 1; i >= 0; i--) {
      const r = toRead[i];
      const local = await localFor(r.path, r.dev.size);
      if (!local) continue;
      userRoms.set(r.path, local);
      reusedLocally++;
      reusedBytes += r.dev.size;
      toRead.splice(i, 1);
    }
    if (reusedLocally > 0) {
      report.log(
        "build",
        `retain: ${reusedLocally} file(s) taken from the local library, ${formatSize(reusedBytes)} not read from the device`,
        "retain",
      );
    }

    const retainBytes = toRead.reduce((a, r) => a + r.dev.size, 0);
    {
      const totalBytes = retainBytes;
      let base = 0;
      report.progress("build", 0, totalBytes, "retain", "bytes");
      const readTracked = (off: number, len: number) =>
        dumpRegion(flasher, 0, off, len, (d) => {
          if (totalBytes > 0)
            report.progress("build", Math.min(base + d, totalBytes), totalBytes, "retain", "bytes");
        });
      for (const r of toRead) {
        userRoms.set(r.path, await readGameData(readTracked, frogfsOffset, r.dev));
        base = Math.min(base + r.dev.size, totalBytes);
        report.progress("build", base, totalBytes, "retain", "bytes");
      }
    }
    report.log("build", msg((t) => t.roms.install.logRetainedGames, retained.length, deviceHomebrew.length, retainBytes), "retain");
    report.subFinish("build", "retain");

    report.subStart("build", "pack");
    // Reuse the cached preview only when nothing had to be re-read from the device and it's current.
    const preserved = retained.length > 0 || deviceHomebrew.length > 0;
    let frogfs = !preserved && !fetchedCores && builtFrogfs && builtFor === selSig ? builtFrogfs : null;
    let pendingLfs: StagedFile[] = frogfs ? [...builtPendingLfs] : [];
    if (!frogfs) {
      report.log("build", msg((t) => t.roms.install.logBuildingImage, userRoms.size), "pack");
      const versions = await listVersions();
      if (versions.length === 0) throw new Error(locale.t.roms.install.errNoFirmwareVersions);
      const bundle = await fetchBundle(versions[0].tag);
      rememberInstallPaths(bundle.manifest?.dist?.paths);
      for (const [k, v] of selectedAssets.entries()) userRoms.set(k, v);
      injectCheats(userRoms);
      const built = await buildFrogfsImage(bundle, installBank, userRoms, {
        installAllCores,
        selectedHomebrew: romSelection.selectedHomebrewKeys,
        homebrewTitles: homebrew.titles,
        mappedArtifacts,
        frogfsOffset
      }, previousFrogfsState);
      frogfs = built.frogfs;
      // dbg(), not report.log(): an audit-log line is user-visible copy, and nothing in the
      // string tables says this yet. See docs/MAPPED_ARTIFACTS.md §7.
      for (const m of built.mappedPlaced) {
        dbg("[install] mapped placed:", m.path, hex(m.address), "patched:", m.patched ?? 0);
      }
      // A ROM install writes FrogFS ONLY -- it never rebuilds the LittleFS partition, because
      // that partition also holds saves. The bundle's cores are correctly dropped here (the
      // firmware install already wrote them); these are not, and are written file-by-file into
      // the live partition after the FrogFS write below.
      pendingLfs = built.plan.pendingLfsFiles;
      // What the packer actually decided, beside what the selection asked for. `coreFiles` is
      // everything bound for LittleFS; `pendingLfsFiles` is the subset a ROM install writes.
      const packed = JSON.stringify({
        coreKeysInSelection: [...selectedAssets.keys()].filter((k) => k.startsWith("cores/")),
        coreFiles: built.plan.coreFiles.map((f) => f.path),
        pendingLfs: pendingLfs.map((f) => f.path),
      });
      dbg("[install] cores into the image:", packed);
      report.log("build", `cores into the image: ${packed}`, "pack");
    } else {
      report.log("build", msg((t) => t.roms.install.logReusingPreview, frogfs.length), "pack");
    }
    // What this install is NOT doing, said out loud. A core whose every ROM was deselected is
    // gone from the image above, but only its MAPPED half actually leaves the device: FrogFS is
    // rebuilt, the LittleFS partition is not, and there is no delete path into it at all (see
    // `strandedCoreKeys`). Reporting a removal we half-performed as if it succeeded is the
    // silent-drop shape this whole file keeps paying for.
    //
    // dbg(), not report.log(): an audit-log line is user-visible copy and nothing in the string
    // tables names this state yet, exactly as with the mapped-placement lines above.
    if (unusedCoreList.length > 0) {
      const mapped = new Set(prepareState.mappedArtifactMap().keys());
      for (const core of unusedCoreList) {
        dbg("[install] no selected ROMs for core:", core.targetKey, `(${core.systems.join(", ")})`);
      }
      for (const key of strandedCoreKeys(unusedCoreList, mapped)) {
        dbg("[install] cannot remove from LittleFS, left on the device:", key);
      }
    }
    // Favorites are `/data` state the firmware rewrites at runtime, so they never belong in
    // the FrogFS image (it mounts read-only: `is_frogfs_path`/`_open`, syscalls.c:441,477) and
    // are appended here rather than routed through the plan -- that also keeps them out of the
    // preview signature, where a starred game would needlessly invalidate the cached image.
    // The device's copy is merged in, not replaced: the firmware owns this file and may hold
    // lines from games this session never saw (favorites.svelte.ts:96).
    if (favorites.dirty) {
      let existing = "";
      try {
        existing = new TextDecoder().decode(await readLfsFile(FAVORITES_DEVICE_PATH));
      } catch (e) {
        dbg("[install] no favorites on device yet:", e);
      }
      pendingLfs.push({
        path: FAVORITES_DEVICE_PATH,
        data: new TextEncoder().encode(favorites.fileFor(existing, favoriteWritePath)),
      });
    }

    report.log("build", msg((t) => t.roms.install.logImageReady, frogfs.length, hex(frogfsOffset)), "pack");
    dbg("[install] frogfs built:", frogfs.length, "bytes → flashing @", hex(frogfsOffset));
    report.subFinish("build", "pack");
    report.finish("build");

    // Stall mitigation (hypothesis, NOT proven — see CLAUDE.md / plan notes): give the
    // link a beat + a liveness ping before the first flash write after the CPU/WASM-heavy
    // FrogFS build above. Mirrors the existing 500ms post-flash settle in engine/flasher.ts;
    // does not touch the flashImage() 120s stall watchdog itself. Deliberately NOT a visible
    // phase — an internal mitigation detail, not a user-facing checklist step.
    const pingT0 = Date.now();
    await new Promise((r) => setTimeout(r, 500));
    const stubAlive = device.transport
      ? await raceWithFallback(isStubAlive(device.transport), 2500, false)
      : false;
    report.log("flash", msg((t) => t.roms.install.logConfirmingLinkResponsive, stubAlive, Date.now() - pingT0));

    report.start("flash");
    report.subStart("flash", "frogfs");
    const log = dbgLog("flash", (m) => report.log("flash", m, "frogfs"));
    device.suspendPoll();
    try {
      await flashFrogfsRegion(
        // Silent, but forwards flashImage's own retry-driven `force` flag — consent already
        // granted via the unforced ensureStub() call above; any mid-flash reboot needed to
        // recover from a stall must never re-prompt, but this must still reuse the live cached
        // stub whenever possible rather than resetting the device on every call.
        (force) => device.ensureStub(undefined, force, true),
        frogfs,
        { frogfsOffset, ceilingOffset: ceilingOffset! },
        // Phase-level, NOT substep-level: `flashPhases`'s "flash" entry declares no substeps
        // (deliberately — see its comment), so a substep-scoped report went into
        // `substepProgress["frogfs"]`, which InstallProgressModal only renders by iterating the
        // DECLARED `substeps` array. The result was a flash phase with no progress bar at all.
        // No label is passed: the phase row already names this write, and the old hardcoded
        // English label would become newly-visible untranslated copy.
        (d, t) => report.progress("flash", d, t),
        log,
        report.signal,
      );
    } finally {
      device.resumePoll();
    }
    // The LittleFS half of the same write. It runs inside the flash phase, after FrogFS, and
    // adds files to the live partition rather than rebuilding it -- that partition holds the
    // user's saves. See engine/lfsWrite.ts. Reported through dbg() only: this is a new state
    // and nothing in the string tables names it yet (docs/UI_VOICE.md).
    // DISABLED after two device LittleFS losses on 2026-09-10, and STILL DISABLED.
    //
    // The first loss was a stale `device.lfsBlockCache`: a browse filled it, a firmware install
    // A ROM INSTALL DOES NOT WRITE LITTLEFS. Cores ride in the LittleFS image a firmware
    // install flashes whole (advanced/RomSection.svelte), which is the owner's ruling after
    // living with the alternative.
    //
    // The alternative was writing into the device's live filesystem, because this path cannot
    // rebuild the partition: it holds the user's saves. That meant mounting littlefs over SWD,
    // and it is slow for a structural reason rather than a tunable one. Our block device faults
    // at BLOCK granularity (`wasm/lfs_wrapper.c`'s `bd_read` returns LFS_ERR_IO and the host
    // fetches 4096 bytes), while littlefs asks for `read_size` 16 and `cache_size` 64 -- so
    // every read amplifies 64x, and a comparison of file contents reads the whole payload back.
    // gnwmanager is fast because its driver reads and programs exactly the bytes littlefs asks
    // for (`gnwmanager/filesystem.py`, LfsDriverContext), with no whole-block erase per write.
    //
    // Matching that means rewriting the block device to fault at littlefs's granularity and to
    // program byte ranges rather than diffing whole blocks at the end. That is a real change to
    // failure behaviour (writes would leave the device mid-operation rather than as a verified
    // block diff), so it is not something to slip in beside a install fix.
    //
    // `pendingLfsFiles` still reports what a core would need, so nothing is silently skipped.
    const LFS_WRITE_ENABLED = false;
    // Say so when there is nothing to write. An install that skipped this step silently looked
    // exactly like one that wrote successfully, which is how "lfs cores still empty" took three
    // rounds to localise.
    report.subFinish("flash", "frogfs");
    report.subStart("flash", "cores");
    if (pendingLfs.length === 0) {
      dbg("[install] littlefs: nothing to write (no core files in the plan)");
      report.log("flash", "littlefs: nothing to write (no core files in the plan)", "cores");
    }
    if (LFS_WRITE_ENABLED && pendingLfs.length > 0) {
      // This write happens AFTER the FrogFS flash, inside the same phase. Until it reported
      // anything the bar reached 100% and then visibly kept working, with no indication of what
      // or for how long -- reported as "it never ends now" and "the second hidden flash phase".
      // Raw diagnostic text into the phase log, like the flasher's own device lines.
      report.log(
        "flash",
        `littlefs: ${pendingLfs.length} file(s) queued: ${pendingLfs.map((f) => f.path).join(", ")}`,
        "cores",
      );
      const t0 = Date.now();
      device.suspendPoll();
      try {
        const r = await writeFilesToDeviceLfs(
          (force) => device.ensureStub(undefined, force, true),
          pendingLfs,
          (done, total, phase) => {
            // Both halves drive the same substep bar. The read half has no honest total (the
            // mount decides how much of the partition it needs), so it reports against the
            // partition size and simply advances; the write half is exact.
            report.progress("flash", done, total, "cores");
          },
          log,
          report.signal,
        );
        dbg("[install] littlefs:", r.filesWritten, "files,", r.blocksRead, "blocks read,", r.blocksWritten, "written");
        report.log(
          "flash",
          `littlefs: ${r.filesWritten} file(s) written, ${r.skipped} unchanged, ${r.blocksRead} blocks read, ${r.blocksWritten} blocks written, ${Date.now() - t0} ms`,
          "cores",
        );
      } finally {
        device.resumePoll();
      }
    }
    report.subFinish("flash", "cores");
    report.finish("flash");

    report.start("rescan");
    report.log("rescan", msg((t) => t.roms.install.logRescanning));
    // FrogFS changed → rescan device geometry + installed games, then re-read cheats/ so the
    // next diff has a fresh baseline (installedFrogfs must be repopulated first).
    // AWAITED, not fire-and-forget: this rescan reads the device over SWD, so the header's
    // do-not-disconnect hold (raised by installProgress.confirm(), released in its `finally`
    // once THIS exec resolves) must still be up while it runs. A `void`ed scan here let exec
    // return — and the hold drop to "settling" — with the scan still talking to the device,
    // and the liveness poll (already resumed above) could then markQuiet() mid-scan and clear
    // the warning outright. If the scan throws, it propagates to confirm()'s catch: the phase
    // flips to "error" and the hold is released there, so a failed rescan can't strand it.
    await device.runScan("after ROM install");
    await loadCheatsBaseline();
    report.finish("rescan");
  }
</script>

<!-- The LibrarySummary artboard's caution aside beside the install summary: the first
     outstanding BIOS slot, named. Status only — see the BIOS block in the script above. -->
{#snippet biosMissingNote()}
  {#if biosMissing}
    <!-- Actionable, not just informative: the note itself opens the prompt that supplies the
         file. No added copy — the artboard shows no button here, and inventing one would be
         inventing copy. -->
    <button type="button" class="bios-missing" onclick={() => void openBiosPrompt(biosMissing)}>
      <span class="bm-label">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5 18 17H2z"></path><path d="M10 8.5v3.5"></path><path d="M10 14.3v.2"></path></svg>
        {locale.t.sources.bios.missingFile}
      </span>
      <span class="bm-text">{locale.t.sources.bios.missingDetail(biosMissing.systemName, biosMissing.filenames[0])}</span>
    </button>
  {/if}
{/snippet}


<section class="roms">
  {#if !nativeFolderPickerSupported() && !dismissedFirefoxWarning}
    <div class="page-body">
    <div style="background: var(--surface-sunk); border: 1px solid var(--caution); padding: 0.75rem; border-radius: var(--r-card); margin-bottom: 1rem; position: relative;">
      <button
        aria-label={locale.t.roms.firefoxWarning.dismissAriaLabel}
        onclick={() => dismissedFirefoxWarning = true}
        style="position: absolute; top: 0.5rem; right: 0.5rem; background: none; border: none; color: var(--caution); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <p class="note" style="margin: 0; color: var(--caution); padding-right: 1.5rem;">
        <strong>{locale.t.roms.firefoxWarning.boldLead}</strong>{locale.t.roms.firefoxWarning.body}
      </p>
    </div>
    </div>
  {/if}

  <!-- 1. Select games — the folder ∪ device list; choose what to install. -->
  <div class="group">
    <div class="layered-panel">
      {#if listState === "loading"}
        <!-- LOADING, not empty. Before the registry's IndexedDB pass and the first scan resolve
             we know nothing, so we must not tell a user with folders registered for months to
             "set up your ROM folder". No new copy: the label is the existing approved
             "Loading…" string (its i18n home is `roms.gameDetailsPanel.cheats` only because
             that is where it was first approved — it is the word "Loading…" in all seven
             locales and nothing else; no new copy was invented for this state), and the only
             other text is the relative path of the file being
             read — runtime-derived, not UI copy. The bar is the InstallProgressModal
             track/fill visual (4px, --surface-sunk, --zelda-green) and counts FOLDERS walked;
             with the count unknown it renders as a plain track. -->
        <div class="page-body">
        <div class="gate-empty">
          <p>{locale.t.roms.gameDetailsPanel.cheats.loadingEllipsis}</p>
          <div class="scan-track">
            {#if scanPct !== null}<div class="scan-fill" style:width="{scanPct}%"></div>{/if}
          </div>
          {#if library.progress?.current}
            <!-- Folder and file, both runtime values, joined as a path. The owner asked to see
                 each file go by: at these speeds it is a flash, which is the point. -->
            <p class="scan-current mono" title={scanLine}>{scanLine}</p>
          {/if}
        </div>
        </div>
      {:else if listState === "empty"}
        <div class="page-body">
        <div class="gate-empty">
          <p>{locale.t.roms.selectGames.gateBody}</p>
          <!-- openFolderGate, not ensureFolders: this button is an EXPLICIT click on the empty
               state, which is also reached when a folder IS registered but unreadable (a
               needs-permission row leaves `library.selected` false). ensureFolders now no-ops
               in exactly that case, so it would be a dead button. -->
          <button class="action" onclick={() => library.openFolderGate(device.targetMedia === "sd").catch(() => {})}>
            {locale.t.roms.selectGames.gateButton}
          </button>
        </div>
        </div>
      {:else}
        <div class="seltable">
          <!-- The capped body column. Roms.dc.html:89 draws the dock as a FULL-BLEED sibling of
               the padded body, so the --maxw cap and the 40px sides belong to THIS wrapper.
               While the cap sat on `.tabpane` the dock was nested inside it and could only
               cancel the padding with a negative margin, never the cap — so above a 1440px
               viewport the dock stopped at the capped column instead of the page edge. -->
          <div class="page-body pagecol">
          <!-- Console filter (single-select, incl. All), then the search field and the
               Library refresh. One row: the chips are the growing item and wrap inside their
               own box, and `align-items: center` keeps the field centred against however many
               lines they take rather than pinned to their last one. -->
          <div class="filterrow">
            <div class="consoles">
              <button class="console" class:active={consoleFilter === "all"} onclick={() => (consoleFilter = "all")}>
                {locale.t.roms.selectGames.allFilterLabel(romSelection.games.length + homebrew.titles.length + unknownHomebrew.length)}
              </button>
              <!-- Beside `All`, and carrying the same star the rows do so the two read as one
                   feature. A filter over the library, not a system in it. -->
              <button class="console" class:active={consoleFilter === "favorites"} onclick={() => (consoleFilter = "favorites")}>
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" class="chip-star"
                  ><path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                    fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path></svg
                >{locale.t.roms.selectGames.favoritesFilterLabel(favoritesCount)}
              </button>
              {#each romSelection.systems as s (s.system)}
                <button class="console" class:active={consoleFilter === s.system} onclick={() => (consoleFilter = s.system)}>
                  {s.label} ({s.count})
                </button>
              {/each}
              <button class="console" class:active={consoleFilter === "homebrew"} onclick={() => (consoleFilter = "homebrew")}>
                {locale.t.roms.selectGames.homebrewFilterLabel(homebrew.titles.length + unknownHomebrew.length)}
              </button>
            </div>

            <!-- Beside the chips, not among them. See `searchQuery` for why a text field must
                 not read as one more scope. -->
            <label class="search">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                ><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16" y2="16"></line></svg
              >
              <input
                type="search"
                bind:value={searchQuery}
                placeholder={locale.t.roms.selectGames.searchPlaceholder}
                aria-label={locale.t.roms.selectGames.searchPlaceholder}
              />
            </label>
            <RefreshButton
              onRefresh={() => library.refresh()}
              label={locale.t.roms.selectGames.refreshLibrary}
            />
          </div>

          <div class="two-pane grid12">
            <div class="left-column">
              <div class="games-pane">
                <div class="games-pane-header">
                  <!-- Audit S1.3. Roms.dc.html's header row: `N selected` (11px/700/0.11em
                       uppercase) on the left, `Select all` as a green text link on the right.
                       The collapse chevron and `Unselect all` appear in no artboard and are
                       gone — deselecting stays reachable per row. The folder button STAYS:
                       the artboard puts `Change folder` in the tab strip, which this view does
                       not own, and openFolderGate() has no other call site. -->
                  <span class="sel-count">{locale.t.roms.selectGames.selectedCount(selectedTotal)}</span>
                  <div class="hdr-actions">
                  <!-- THE SORT CONTROL. One control, not a header row of clickable columns: the
                       rows are `display: flex` with intrinsic widths, and the console chip is
                       drawn only under `all`/`favorites`, so headers aligned to those columns
                       would either drift or force the row into a grid -- a large change to
                       markup three artboards pin. NO ARTBOARD DRAWS EITHER, which is worth a
                       board before this settles.

                       The direction is the caret's rotation, never a word: `Ascending` and
                       `Descending` exist as the accessible name only. -->
                  <div class="sortpick">
                    <button
                      class="action-btn"
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={sortMenuOpen}
                      title={locale.t.roms.selectGames.sortLabel}
                      aria-label={`${locale.t.roms.selectGames.sortLabel}: ${sortKeyLabel(sortKey)}, ${
                        sortDir === "asc"
                          ? locale.t.roms.selectGames.sortAscending
                          : locale.t.roms.selectGames.sortDescending
                      }`}
                      onclick={(e) => { e.stopPropagation(); sortMenuOpen = !sortMenuOpen; }}
                    >{sortKeyLabel(sortKey)}<svg
                        class="sortcaret {sortDir}" viewBox="0 0 16 16" width="11" height="11"
                        aria-hidden="true"
                      ><path d="M4 6.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8"
                        stroke-linecap="round" stroke-linejoin="round"></path></svg
                      ></button>
                    {#if sortMenuOpen}
                      <div class="sortmenu" role="menu">
                        {#each LIBRARY_SORT_KEYS as k (k)}
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={sortKey === k}
                            class="sortitem"
                            class:active={sortKey === k}
                            onclick={(e) => { e.stopPropagation(); pickSort(k); }}
                          >{sortKeyLabel(k)}</button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                  <button class="action-btn" onclick={() => {
                    let extraBytes = 0;
                    const toggles: Array<() => void> = [];
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        const state = getActionState(g);
                        if (state.label === 'prepare') {
                          state.action();
                        } else if (state.label === 'not installed') {
                          extraBytes += getHomebrewSize(g.hb.key);
                          toggles.push(() => romSelection.toggleHomebrew(g.hb.key, true));
                        }
                      } else {
                        // Same row rule as `getActionState`: Select All must select the file
                        // that gets copied, not the converter input that never does.
                        if (!romSelection.isRowSelected(g)) {
                          extraBytes += g.size;
                          toggles.push(() => romSelection.toggleRow(g));
                        }
                      }
                    }
                    if (extraBytes > 0 && !validateFit(extraBytes)) return;
                    toggles.forEach(t => t());
                  }}>{locale.t.roms.selectGames.selectAll}</button>
                    <button class="folder-btn" title={locale.t.roms.selectGames.changeFoldersTitle} onclick={() => library.openFolderGate(device.targetMedia === "sd").catch(() => {})}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                  </div>
                </div>

                <div class="rows">
              {#each visibleGames as g (g.key)}
                {@const state = getActionState(g)}
                {@const starred = favorites.has(g.key)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div 
                  class="row {selectedCarouselId === g.key ? 'active' : ''}"
                  style={state.disabled ? "opacity: 0.5; cursor: not-allowed;" : ""}
                  onclick={() => { selectedCarouselId = g.key; }}
                >
                  <!-- A CONTROL, not a message. The row contract above forbids body copy here;
                       it carries no text.

                       AT THE LEFT EDGE, before the badge (LibraryComposed.dc.html). The right
                       end of the row is the action chip, which is the row's one real action and
                       says what happens on sync; a star beside it joins that reading and becomes
                       a STATUS. At the left the stars line up into their own column, which is
                       where a per-row toggle belongs. EVERY row has one: favouriting is a local
                       act on a row, and what reaches `/data/favorites.txt` is filtered at write
                       time instead (see `favoriteWritePath`). -->
                  <button
                    type="button"
                    class="star {starred ? 'on' : ''}"
                    aria-pressed={starred}
                    aria-label={starred ? locale.t.roms.selectGames.favoriteOn : locale.t.roms.selectGames.favoriteOff}
                    onclick={(e) => { e.stopPropagation(); favorites.toggle(g.key); }}
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
                      ><path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                        fill={starred ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.3"
                        stroke-linejoin="round"></path></svg
                    >
                  </button>
                  {#if consoleFilter === "all" || consoleFilter === "favorites"}
                    <StatusChip kind="console">{g.system === 'homebrew' ? locale.t.roms.selectGames.homebrewChip : g.system.toUpperCase()}</StatusChip>
                  {/if}
                  <!-- Already the LIST name (sources/gameRows.ts strips the extension once, at
                       the source). Stripping again here would eat the tail of a name that
                       legitimately contains a dot, e.g. "Sonic 3.5". -->
                  <span class="gname">{g.name}</span>
                  <span class="gsize">{g.size > 0 ? formatSize(g.size) : "—"}</span>
                  <StatusChip kind={state.cls} disabled={state.disabled} onclick={(e) => {
                    e.stopPropagation(); 
                    if (pressAddsBytes(state.label)) {
                      const extraBytes = g.isHomebrew ? getHomebrewSize(g.hb.key) : g.size;
                      if (!validateFit(extraBytes)) return;
                    }
                    state.action(e);
                  }}>{actionLabelText(state.label)}</StatusChip>
                </div>
                <!-- NOTHING ELSE GOES IN A ROW. A row is a game, a size and a state; that is the
                     whole contract (`Roms.dc.html`, `RomsPrepare.dc.html`). A converter's
                     verdict lived here twice — first as the module's full text, which put an
                     eleven-item lump inventory in body copy under a game, then as a short
                     "Prepared with notes" link, which was the same mistake made quieter. Both
                     are gone. `prepareState` still records WHICH verdict belongs to which run;
                     the activity log holds what was said, and the bell raises errors only. -->
                <!-- @NO-ROW-VERDICT (apps/web/test/auditlog.mjs guards this) -->
              {/each}
              
              {#if consoleFilter === "all" || consoleFilter === "homebrew"}
                {#each unknownHomebrew as g (g.name)}
                  <div class="row">
                    <span class="gname mono">{g.name}</span>
                    <span class="gsize">{g.size > 0 ? formatSize(g.size) : "—"}</span>
                    <StatusChip kind="muted" style="background: transparent;" onclick={(e) => {
                      e.preventDefault();
                      romSelection.removeUnknownHomebrew(g.name);
                    }}>{locale.t.roms.selectGames.removeButton}</StatusChip>
                  </div>
                {/each}
              {/if}

              {#if visibleGames.length === 0 && (consoleFilter !== "all" && consoleFilter !== "homebrew")}
                <p class="note">{locale.t.roms.selectGames.noFilterMatch}</p>
              {/if}
                </div>

              </div> <!-- games-pane -->
            </div> <!-- left-column -->
          
          <div class="carousel-pane">
            <div style="flex: 1; min-height: 0;">
              <Carousel 
                covers={carouselCovers} 
                bind:selectedId={selectedCarouselId} 
                getUrl={(key) => getCoverUrl(key, coverVersion)} 
                systemLabel={(c) => c.system}
                version={coverVersion}
              />
            </div>
            
            <div class="info-pane">
              {#if selectedCarouselId}
                {@const activeGame = visibleGames.find(g => g.key === selectedCarouselId)}
                {@const activeHb = !activeGame ? unknownHomebrew.find(g => g.name === selectedCarouselId) : null}
                {#if activeGame}
                  {@const state = getActionState(activeGame)}
                  <div class="info-content">
                    <!-- Roms.dc.html draws the headline big and the filename mono underneath. The
                         headline is the PRETTY name (a matched variant's published title, e.g.
                         "The Ultimate Doom"); the mono line keeps the ORIGINAL filename with its
                         extension, so it stays provenance. With no variant match both fall back to
                         the same extensionless name. See sources/gameRows.ts. -->
                    <h3 class="info-title" style="text-align: center;">{activeGame.prettyName ?? activeGame.name}</h3>
                    <div class="info-details" style="justify-content: center; margin-top: 0.25rem;">
                      <span class="info-system">{activeGame.system === 'homebrew' ? locale.t.roms.selectGames.homebrewTag : consoleLabel(activeGame.system)}</span>
                      <span class="info-dot" aria-hidden="true"></span>
                      <span class="info-meta mono">{activeGame.originFilename ?? activeGame.name}</span>
                      <span class="info-dot" aria-hidden="true"></span>
                      <span class="info-meta mono">{activeGame.size > 0 ? formatSize(activeGame.size) : '—'}</span>
                      {#if state && state.label !== 'missing rom'}
                        <StatusChip kind={state.cls} disabled={state.disabled} style="margin-left: 0.5rem;" onclick={(e) => { 
                          e.stopPropagation(); 
                          if (pressAddsBytes(state.label)) {
                            const extraBytes = activeGame.isHomebrew ? getHomebrewSize(activeGame.hb.key) : activeGame.size;
                            if (!validateFit(extraBytes)) return;
                          }
                          state.action(e);
                        }}>{actionLabelText(state.label)}</StatusChip>
                      {/if}
                    </div>
                  </div>
                {:else if activeHb}
                  <div class="info-content">
                    <h3 class="info-title" style="text-align: center;">{activeHb.name.replace(/\.[^/.]+$/, "")}</h3>
                    <div class="info-details" style="justify-content: center; margin-top: 0.25rem;">
                      <span class="info-system">{locale.t.roms.selectGames.unknownHomebrewTag}</span>
                      <span class="info-dot" aria-hidden="true"></span>
                      <span class="info-meta mono">{activeHb.name}</span>
                      <span class="info-dot" aria-hidden="true"></span>
                      <span class="info-meta mono">{activeHb.size > 0 ? formatSize(activeHb.size) : '—'}</span>
                      <StatusChip kind="caution" style="margin-left: 0.5rem;" onclick={(e) => { e.preventDefault(); romSelection.removeUnknownHomebrew(activeHb.name); }}>{locale.t.roms.selectGames.removeButton}</StatusChip>
                    </div>
                  </div>
                {:else}
                  <div class="info-empty">{locale.t.roms.selectGames.infoEmpty}</div>
                {/if}

                <!-- THE ONLY WAY INTO THE OPTIONS. At the foot of the pane that describes the one
                     game it configures, so the control sits with its subject. Drawn only when
                     something is selected: it configures a game, and with none picked there is
                     nothing for it to open. -->
                {#if activeGame || activeHb}
                  <div class="info-foot">
                    <button class="opts-btn" onclick={() => (optionsOpen = true)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                        ><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg
                      >
                      <span>{locale.t.roms.summary.additionalOptions}</span>
                    </button>
                  </div>
                {/if}
              {:else}
                <div class="info-empty">{locale.t.roms.selectGames.infoEmpty}</div>
              {/if}
            </div>
          </div>
          </div> <!-- two-pane -->
          </div>

          <!-- The page behind the raised summary, darkened a little so the panel reads as
               raised. Earlier sibling than `.dock` and on the same layer, so the dock paints
               over it in document order. Clicking it closes the drawer, which is the only
               dismissal this surface has besides the handle. -->
          {#if openDrawer === "summary"}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="dim" onclick={() => (openDrawer = null)}></div>
          {/if}

          <!-- Bottom dock — one bar with two mutually exclusive drawers rising out of it.
               The Summary tab lives in normal flow ABOVE whichever surface is on top (drawer
               when open, bar otherwise), so it can never be clipped by an overflow ancestor. -->
          <div class="dock">
            <!-- THE HANDLE AND THE DRAWER SHARE A BOX WHOSE BOTTOM EDGE IS THE BAR'S TOP EDGE.
                 The drawer used to be anchored `bottom: 100%` against `.dock`, whose top edge is
                 the HANDLE's top -- so the panel stopped a handle's height short of the bar and a
                 band of page showed through either side of the centred handle. Anchored to this
                 box instead, the panel meets the bar, and the handle (in flow, and raised) draws
                 over the panel's bottom, which is padding and carries no text. -->
            <div class="docktop">
              <div class="tabrow">
                <!-- No valid target ⇒ no summary, and so no way to open one. The bar's
                     `flashGateNote` (Flash) / the folder gate (SD) already say why. -->
                {#if targetValid}
                <button
                  class="summary-tab"
                  onclick={() => (openDrawer = openDrawer === "summary" ? null : "summary")}
                >
                  <span>{locale.t.roms.summary.summaryTab}</span>
                  <svg class="caret" class:up={openDrawer !== "summary"} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                {/if}
              </div>

              {#if openDrawer === "summary" && targetValid}
                <div class="drawer">
                  <!-- The board heads the two COLUMNS ("Install summary" and "Install") as peers
                       inside the grid below, so the drawer carries no title of its own; this row
                       exists for the close control. The handle and the scrim also close it. -->
                  <div class="drawer-head">
                    <button class="drawer-x" aria-label={locale.t.shared.common.close} onclick={() => (openDrawer = null)}>
                      <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>

                  <!-- TWO COLUMNS, as the board draws it (LibraryComposedSummary.dc.html): the
                       per-category table on the left, the install-time settings in their own
                       column on the right. Stacked, the settings read as a footnote to the table
                       rather than as the other half of what a sync will do. -->
                  <div class="drawer-body">
                    <div class="drawer-cols">
                      <div class="drawer-col">
                        <span class="drawer-title">{locale.t.roms.summary.summaryDrawerTitle}</span>
                        <div class="summary-layout">
                          <StatPanel rows={summaryGridRows} variant="grid" />
                          {@render biosMissingNote()}
                        </div>
                        {#if device.targetMedia !== "sd"}
                          {#if building}<p class="note" style="margin-top: 0.5rem;">{locale.t.roms.install.calculatingLayout}</p>{/if}
                          {#if buildErr}<p class="err" style="margin-top: 0.5rem;">{buildErr}</p>{/if}
                        {/if}
                      </div>

                      <div class="drawer-col">
                        <span class="drawer-title">{locale.t.roms.summary.installHeading}</span>
                        <!-- The board draws Compress ROMs and the Retro-Go upgrade together. They
                             are NOT both available: `syncCores` is SD-only by construction (flash
                             always writes cores with the install), and LZMA is not functional yet,
                             so its box ships disabled. Each mode shows the one that is real for it
                             rather than a control that cannot act. -->
                        {#if device.targetMedia === "sd"}
                          <label class="lzma">
                            <input type="checkbox" bind:checked={syncCores} />
                            {locale.t.roms.sdSync.upgradeLabelPre}
                            {#if coreVersions.length > 0}
                              <select
                                class="mono core-version-select"
                                bind:value={selectedCoreVersionTag}
                                onchange={(e) => { selectedCoreVersionUserSet = true; selectedCoreVersionTag = e.currentTarget.value; }}
                                onclick={(e) => e.stopPropagation()}
                              >
                                {#each coreVersions as v (v.tag)}
                                  <option value={v.tag}>{v.tag}{v.prerelease ? " (pre)" : ""}</option>
                                {/each}
                              </select>
                            {/if}
                            <span class="soon">{locale.t.roms.sdSync.updatesWhenBoots}</span>
                          </label>
                        {:else}
                          <label class="lzma">
                            <input type="checkbox" disabled checked={false} />
                            {locale.t.roms.install.lzmaCheckboxLabel}<span class="soon">{locale.t.roms.install.lzmaSoon}</span>
                          </label>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              {/if}
            </div>

            <div class="bar">
              <!-- Storage meter: fused to the bar's TOP edge as a 3px strip so it costs the bar
                   no height. Flash-only — it visualizes the device's real flash gap, which is
                   meaningless in SD mode (see CLAUDE.md's SD-vs-Flash budget note). -->
              {#if device.targetMedia !== "sd" && gapBytes !== null && gapBytes > 0}
                <div class="meter" aria-hidden="true"><div class="meter-fill" class:over={!fitsGap} style="width: {meterInstalledPct}%"></div><div class="meter-pending" class:over={!fitsGap} style="width: {meterPendingPct}%"></div></div>
              {/if}

              <div class="bar-left">
                {#if gateNote}
                  <span class="gate-note">{gateNote}</span>
                {:else}
                  <span class="budget">{budgetText}</span>
                  {#if netChangeText}<span class="net">{netChangeText}</span>{/if}
                {/if}
              </div>

              <!-- NO `Additional options` DISCLOSURE HERE ANY MORE. The trigger is the button at
                   the foot of the info pane, which sits beside the game it configures; this one
                   rose from the bottom edge, opposite the row it acted on. Two controls opening
                   one thing is the duplication this redesign removes (LibraryComposed.dc.html). -->
              <div class="bar-right">
                {#if device.targetMedia === "sd"}
                  {#if nativeFolderPickerSupported()}
                    <button
                      class="install-btn"
                      disabled={!device.sdReady || !sdSyncHasChanges}
                      title={sdSyncHasChanges ? undefined : locale.t.roms.sdSync.nothingToSyncTitle}
                      onclick={handleSdSyncClick}
                    >
                      {locale.t.roms.install.syncLibraryButton}
                    </button>
                  {:else}
                    <button
                      class="install-btn"
                      disabled={!sdSyncHasChanges}
                      title={sdSyncHasChanges ? undefined : locale.t.roms.sdSync.nothingToSyncTitle}
                      onclick={handleSdSyncClick}
                    >
                      {locale.t.roms.sdSync.downloadZipButton}
                    </button>
                  {/if}
                {:else}
                  <button
                    class="install-btn"
                    disabled={!flashReady || !canInstallRoms || building || !fitsGap}
                    onclick={handleInstallClick}
                  >
                    {locale.t.roms.install.syncLibraryButton}
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>


{#if promptFor?.tool}
  <FilePromptModal
    open={true}
    tool={promptFor.tool}
    submitText={locale.t.sources.filePrompt.submitPrepare}
    prefill={(promptFor.tool?.inputs ?? []).flatMap((i) =>
      prepareState.discoveredFor(promptFor?.repo ?? "", i.id),
    )}
    onPickFolder={async () => {
      const keys = promptFor ? [promptFor.key] : [];
      const handle = await pickFolder("gnw-converter-input");
      return handle ? await adoptInputFolder(handle, keys) : null;
    }}
    onCancel={() => (promptFor = null)}
    onSubmit={(r) => {
      const hb = promptFor;
      promptFor = null;
      if (hb) void runPrepare(hb, r.files, r.gate.unrecognised.map((v) => v.filename));
    }}
  />
{/if}

{#if biosTool}
  <FilePromptModal
    open={true}
    tool={biosTool}
    converts={false}
    monoDescriptions={true}
    note={locale.t.sources.filePrompt.subtitleBios(biosPromptFor?.systemName ?? "")}
    submitText={locale.t.sources.filePrompt.submitAddToLibrary}
    onCancel={dismissBiosPrompt}
    onSubmit={(r) => acceptBiosFiles(r.files)}
  />
{/if}

{#if optionsOpen}
  {@const activeGame = visibleGames.find(g => g.key === selectedCarouselId)}
  {@const activeHb = !activeGame ? unknownHomebrew.find(g => g.name === selectedCarouselId) : null}
  <!-- THE OPTIONS, OUT OF THE DOCK. It rose from the bottom edge, opposite the row it acted on,
       and shared one drawer with the summary so the numbers describing a write and the settings
       that change it could never be read together. As a modal the selection stays visible behind
       it and the summary is free to be its own thing.

       `ModalShell` rather than a hand-rolled backdrop: it carries the scrim, the gold lip, the
       Escape and click-outside handling, and `pushDismiss` so Back closes it instead of leaving
       the tab. Wide, because the three sections are read side by side.

       60rem, not the 62 it shipped at. The width is set by ONE row: the cheats manual entry,
       which is a code input, a description input and an Add button on one line. Everything else
       had slack, and Saves had so much of it that the owner read the panel as too wide. Trimming
       two rem and weighting the columns (`GameDetailsPanel.svelte`) spends the saving where it
       is needed instead of dividing it in three. Going narrower starts squeezing that one row,
       which is the thing to check before trimming further. -->
  <ModalShell onDismiss={() => (optionsOpen = false)} maxWidth="60rem">
    {#snippet children()}
      <div class="opts-head">
        <h3 class="opts-title">{selectedGameLabel}</h3>
        <button class="drawer-x" aria-label={locale.t.shared.common.close} onclick={() => (optionsOpen = false)}>
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="opts-body">
        {#if activeGame}
          <GameDetailsPanel
            bare
            gameKey={activeGame.key}
            gameName={activeGame.name}
            system={activeGame.system}
            coverUrl={getCoverUrl(activeGame.key, coverVersion)}
            bind:configuredCheats
            bind:configuredCheatFiles
            onCoverChange={() => { coverUrls.clear(); coverVersion++; }}
          />
        {:else if activeHb}
          <GameDetailsPanel
            bare
            gameKey={activeHb.name}
            gameName={activeHb.name}
            system="homebrew"
            coverUrl={getCoverUrl(activeHb.name, coverVersion)}
            bind:configuredCheats
            bind:configuredCheatFiles
            onCoverChange={() => { coverUrls.clear(); coverVersion++; }}
          />
        {:else}
          <p class="note">{locale.t.roms.selectGames.infoEmpty}</p>
        {/if}
      </div>
    {/snippet}
  </ModalShell>
{/if}

{#if spaceAlertMessage}
  <ModalShell onDismiss={() => spaceAlertMessage = null} borderColor="var(--danger)" zIndex="var(--z-modal-alert)">
    {#snippet children()}
      <h3 style="margin-top: 0; margin-bottom: 0.5rem; font-size: var(--fs-title); letter-spacing: -0.01em; color: var(--danger);">{locale.t.roms.spaceAlert.title}</h3>
      <p style="color: var(--ink-soft); font-size: var(--fs-caption);">{spaceAlertMessage}</p>
      <div style="display: flex; justify-content: flex-end; margin-top: 1rem;">
        <button class="action primary" onclick={() => spaceAlertMessage = null}>{locale.t.roms.spaceAlert.ok}</button>
      </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  /* Caution aside under the install summary (LibrarySummary artboard). A section, not an
     object: no border box on the ground — the label and the space carry it. */
  /* Audit S1.4 used to sit the caution note BESIDE the table, absolutely positioned at the
     right of a full-width `.summary-layout`, as `LibrarySummary.dc.html` drew it. THAT ROOM IS
     GONE: `LibraryComposedSummary` gives the right 300px of the drawer to the install settings,
     so the table's column is the drawer minus 348px, and a 270px note pinned inside it lands on
     top of the After and Change cells. The note stacks under the table now, which is what that
     rule already fell back to below 1100px. Removed rather than parked behind a width nothing
     reaches, which would read as live CSS to the next person. */
  .summary-layout {
    position: relative;
  }
  .bios-missing {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    margin-top: 0.6rem;
    /* A button only so the note is clickable — it must still look exactly like the note. */
    background: none;
    border: 0;
    padding: 0;
    text-align: start;
    font: inherit;
    cursor: pointer;
  }
  .bm-label {
    /* Artboard: a 13px caution triangle sits 6px before the label. */
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-micro);
    font-weight: 600;
    color: var(--caution);
  }
  .bm-text {
    /* Artboard: 12px, line-height 1.45. */
    font-size: var(--fs-chip);
    line-height: 1.45;
    color: var(--ink-soft);
  }

  /* Roms.dc.html / RomsOptions.dc.html (2026-09-08 refresh) made the page frame
     full-viewport (`height: 100vh; overflow: hidden`) with the content region on
     `flex: 1 1 auto; min-height: 0; overflow-y: auto` — a page that fills the window and
     scrolls internally instead of growing. The root of that chain (`.app` / `.page` /
     `.tabpane`) is App.svelte + Advanced.svelte, which this pass does not own; what IS
     owned is everything from here down, so the tab now grows to whatever height it is
     given rather than shrink-wrapping its content. Once the ancestors adopt
     `height: 100vh; overflow: hidden` this chain resolves to the artboard exactly. */
  .roms {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    flex: 1 1 auto;
    min-height: 0;
  }
  /* The loading bar: the same track/fill language InstallProgressModal already uses. */
  .scan-track {
    width: min(320px, 80%);
    height: 4px;
    border-radius: 2px;
    background: var(--surface-sunk);
    overflow: hidden;
  }
  .scan-fill {
    height: 100%;
    background: var(--zelda-green);
    transition: width 150ms ease;
  }
  .scan-current {
    margin: 0;
    max-width: min(420px, 90%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .gate-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
    flex: 1 1 auto;
    min-height: 0;
  }
  /* Select-games table.
     NO GAP. Its only two children are `.pagecol` and `.dock`, so the gap fell in exactly one
     place: between the body column and the bar. THAT was what held the column off the bottom
     bar -- not a floor and not content failing to fill, but a literal 0.6rem flex gap plus the
     dock's own 1rem top margin, 1.6rem of dead space the body could never reach into. The body
     column now runs to the bar at every dock state. */
  .seltable {
    /* The containing block for `.dim`, which covers the body while the summary is raised. */
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0;
    flex: 1 1 auto;
    min-height: 0;
  }
  /* The capped body column inside `.seltable`; the dock is its sibling and stays full-bleed.
     Carries its own 0.6rem gap between the console filter and the table. */
  .pagecol {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    flex: 1 1 auto;
    min-height: 0;
  }
  /* consoles | search | refresh. The chips are the one item that grows and wraps, so they
     take `flex: 1 1 auto` and the other two keep their intrinsic size. `align-items: center`
     is the whole of "the search stays centred to that": the field sits against the MIDDLE of
     however many lines the chips occupy, not against their last line.

     The row itself wraps as a fallback. `.search` carries a 210px floor and will not shrink
     below it, so on a narrow viewport the field and the button drop to their own line rather
     than pushing the row wider than the page -- a floor wider than its track is what put a
     horizontal scrollbar in the options modal. */
  .filterrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .consoles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    /* `flex-basis: 0`, NOT `auto`. A flex item's hypothetical size decides whether the PARENT
       wraps, and with `auto` that size is this box's max-content -- every chip on one line.
       Against `.search`'s 210px floor that never fits, so `.filterrow` wrapped and dropped the
       field below the chips, which is the bug this is fixed from. At `0` the chips wrap inside
       their own box and the field stays beside them; `.filterrow`'s own wrap then fires only
       when the field genuinely cannot fit. */
    flex: 1 1 0;
    min-width: 0;
  }
  /* The star rides inside the chip's own text run, so it inherits the chip's colour in both
     states (dark fill when active) without a second rule. */
  .chip-star {
    margin-inline-end: 5px;
    vertical-align: -1px;
  }
  /* Previously a last child of `.consoles`, pushed right with `margin-inline-start: auto` so
     the chips kept one wrapping run -- which meant the field followed them to the END of their
     last line. The owner asked for the opposite: the chips wrap inside their own box and the
     field stays centred against the whole block, which needs it to be a sibling. */
  .search {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    min-width: 210px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    color: var(--ink-mute);
  }
  .search input {
    font: inherit;
    font-size: var(--fs-btn-sm);
    color: var(--ink);
    background: none;
    border: 0;
    outline: none;
    min-width: 0;
    width: 100%;
  }
  .search:focus-within {
    border-color: var(--accent, var(--ink-soft));
  }
  /* Artboard (unanimous across Roms / RomsNewSystem / RomsOptions / RomsSdNoCard /
     LibrarySummary): the INACTIVE chip is bare text — no fill, no border — and the ACTIVE one
     is a dark filled, square-ish chip. The code had the two inverted. `--ink`/`--surface` is
     the fill/ink pair rather than the artboard's literal #1b1b1b/#ffffff so the chip inverts
     correctly in dark theme (there is no on-fill ink token). */
  .console {
    font: inherit;
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 5px 11px;
    cursor: pointer;
  }
  .console.active {
    background: var(--ink);
    color: var(--surface);
    border-color: var(--ink);
    font-weight: 600;
  }
  .rows {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
  }
  /* HOVER-REVEALED, but always present and always sized, so nothing reflows when it appears
     and a starred row keeps its star when the pointer leaves. `visibility` rather than
     `display` for the same reason: the row's gap must not change under the pointer. */
  /* ALWAYS VISIBLE, as a grey outline when unset (LibraryComposed.dc.html). It was revealed on
     row hover, which is right for an afterthought at the end of a row and wrong for a column:
     a hover-only control at the LEFT edge makes the whole badge column appear to shift as the
     pointer travels the list, and it hides the one thing the `Favorites` filter filters on.

     The box is 18px (14px glyph + 2px padding a side), comfortably under the 26px action chip,
     so the chip stays the row's tallest child and the row height is unchanged. That margin is
     what the board's arithmetic depends on: a star boxed taller than the chip costs a visible
     row out of the eleven that fit. */
  /* `.star-gap` is gone with the BIOS rows: every row in this list now has a real star, so
     there is nothing left to reserve the column for. */
  .star {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
  }
  .star {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    color: var(--ink-mute);
    cursor: pointer;
  }
  .star.on {
    color: var(--warn, #c9a82d);
  }

  .row {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    /* Artboard: `padding: 11px 0; gap: 12px`. The horizontal 16px is carried here rather than
       on `.games-pane` so the rows line up with `.games-pane-header`'s own padding. */
    gap: 12px;
    padding: 11px 1rem;
    font-size: var(--fs-caption);
    /* A rule inside the list's white surface -> --rule (was --surface-sunk, a FILL
       token: #101010, a black line in dark theme). */
    border-bottom: 1px solid var(--rule);
  }
  .row:last-child {
    border-bottom: none;
  }
  /* The status chip stays last in the row and never wraps onto its own line. */
  .row > :global(*:last-child) {
    flex-shrink: 0;
  }
  /* ONE weight for every row, selected or not — the StatusChip at the end of the row is the
     only status signal now (was: bold-when-active / muted-when-not, which competed with it). */
  .gname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 400;
    color: var(--ink);
  }
  /* Always rendered, never replaced or displaced by anything else in the row. */
  .gsize {
    color: var(--ink-soft);
    font-size: var(--fs-chip);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    width: 4.5rem;
    text-align: end;
    flex-shrink: 0;
  }
  /* Audit S1.2: NOT a card. Roms.dc.html draws no container here at all — the tab's
     content sits directly on the page ground and the only surface on the screen is the
     list's own white ground (.games-pane) plus the dock's bar/drawers, which carry their
     own. This is a layout box only: no background, no border, no shadow, no radius. */
  /* Audit S0.2 follow-up. This wrapper's `padding: 1rem` was inset 16px from the
     page's content box, so `.two-pane`'s 12 columns below were computed over a
     box 32px narrower than `.body`'s — each column ~2.67px short and the span-5
     boundary ~29px off the page grid. Zeroed so the columns land on the real
     page grid; nothing else here needed the inset (`.gate-empty` carries its own
     padding, `.seltable`/`.consoles`/`.group` carry none), and it also brings the
     console-filter chips out to the page edge as Roms.dc.html shows them. */
  .layered-panel {
    padding: 0;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .lzma {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .note,
  .err {
    margin: 0;
    font-size: var(--fs-micro);
  }
  .note {
    color: var(--ink-soft);
  }
  .err {
    color: var(--danger);
  }
  .action {
    align-self: flex-start;
    margin-top: 0.2rem;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    /* --ink-on-face, not --ink: this is the silver button cap, and --silver is a device-face
       fill that stays light in dark theme (#c9c9cd -> #9a9aa0) while --ink inverts to #ececec.
       The pair therefore collapsed to ~1.6:1 in dark. Every other silver cap in the app
       (SplitButton `.default .seg`, DeviceControls `.caret`) already reads --ink-on-face. */
    color: var(--ink-on-face);
    background: var(--silver);
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: var(--r-control);
    padding: 0.3rem 0.8rem;
    cursor: pointer;
  }
  .action:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }
  .action.primary {
    color: #fff;
    background: var(--model-accent);
    border-color: var(--model-accent);
  }
  .soon {
    font-size: var(--fs-micro);
    font-weight: 400;
    color: var(--ink-soft);
  }
  .core-version-select {
    font: inherit;
    font-size: var(--fs-micro);
    padding: 0.1rem 0.3rem;
    border-radius: var(--r-control);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--ink);
  }
  /* Audit S0.2. Was `350px 1fr`. Roms.dc.html / RomsOptions.dc.html /
     LibrarySummary.dc.html / RomsSdNoCard.dc.html all put the selection list on
     `grid-column: span 5` and the coverflow/details pane on `span 7` of the
     12-column body, with the same 32px gutter — so the two panes now sit on the
     shared grid (`.grid12`) instead of a screen-local pixel width. Its content
     box is `.body`'s content box (see `.layered-panel` above), so these columns
     really are the page grid's. Layout only: the SD/Flash split above and below
     this row is untouched. */
  /* Audit 1.11 residual. Was a hard `height: 500px`. The newer generation
     (RomsNewSystem.dc.html:89) makes the tab body itself the flex child
     (`flex: 1 1 auto; min-height: 0; overflow-y: auto`) and puts NO height on the
     12-column row, so the row is as tall as its content. `min-height` keeps the old
     500px as a floor — the list still fills a short page — while letting a tall right
     column (coverflow + details) grow the row instead of clipping it. */
  /* THE BODY IS THE FLEXIBLE REGION AND THE DOCK IS PINNED. The owner's ruling: the bar sits on
     the window's bottom edge whether the summary is open or shut, opening the summary grows the
     dock UPWARD into the empty space under the content, that slack is spent first so nothing
     above moves, and only once the dock meets the bottom of the content does the content give
     way. Slack, then displacement, and the dock never overlaps the content.

     All of that falls out of the flex column rather than being computed: `.pagecol` grows,
     `.dock` does not, so the dock is already last and flush. What broke it was the 500px floor
     here, which stopped this row shrinking, pushed `.seltable` past the pane and handed the
     overflow to `.tabpane` -- which scrolls, so the "pinned" bar scrolled away with the page
     exactly when the drawer made it matter.

     `min-height: 0` lets the row give back its slack. `overflow-y: auto` is what makes giving it
     back safe, and it is the lesson of `test/panescroll.mjs` (commit `e66b3db`) applied to the
     same shape: a region that can shrink below its content, does not clip, and sits above an
     opaque pinned bar spills its content UNDER that bar, unreachable and invisible to every
     gate in this repo. This is an inner scroll region inside the pane, which is the sanctioned
     pattern -- `.tabpane` keeps `overflow-y: auto` and remains the page's general scroller, and
     nothing here adds `overflow: hidden` to a pane, shell or page container. */
  .two-pane {
    min-height: 0;
    overflow-y: auto;
    flex: 1 1 auto;
  }
  .left-column {
    grid-column: span 5;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    /* Grid's default `align-items: stretch` already sizes this to the row, so the old
       `height: 100%` (which resolves against a min-height-only parent) is not needed.
       `min-height: 0` lets .games-pane's own scroller shrink below its content. */
    align-self: stretch;
    min-height: 0;
    overflow: hidden;
  }
  .games-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    /* The dense list moves onto a white surface so its --rule row rules have contrast
       (mockups README: "a ground change, not a box"). Artboard: background #ffffff,
       border-radius 6px, no border and no shadow. */
    background: var(--surface);
    border-radius: var(--r-card);
    overflow: hidden;
  }
  .info-pane {
    flex-shrink: 0;
    /* Was a flat 80px, which is the height of the metadata block alone. The `Additional options`
       button now sits under it, so the pane is its content's height with the old figure as a
       floor -- a fixed 80 would have put the button outside the box it belongs to. */
    min-height: 80px;
    /* Artboard: the now-playing block under the coverflow is bare type on the page
       ground — no surface, no border. Spacing carries the boundary. */
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .info-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  /* Artboard (RomsNewSystem): 24px / 600 / -0.015em, centred. */
  .info-title {
    margin: 0;
    font-size: var(--fs-display);
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .info-details {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* Artboard draws the sub-line as one run: the full system name, a 3px round dot,
     then the filename and size together in mono — no chip, no border-left divider. */
  .info-system {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .info-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--ink-dim);
    flex-shrink: 0;
  }
  .info-meta {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .info-empty {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    text-align: center;
    font-style: italic;
  }
  .games-pane-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    /* Audit S1.3: the artboard's header row is on the white surface itself — no tinted
       strip and no <h2>. Only the hairline under it separates it from the rows.
       Artboard box model: the list panel carries `padding: 2px 16px` and the header its own
       `padding-bottom: 12px` — so 2px above the caption, 12px below it, 16px each side. */
    padding: 2px 1rem 12px;
    border-bottom: 1px solid var(--rule);
  }
  /* Artboard: 11px/700/0.11em uppercase, quiet grey. Lower-cased in the string tables so
     each locale reads naturally; the casing is presentational. */
  .sel-count {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .hdr-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  /* The sort control. `position: relative` is the menu's anchor and nothing else. */
  .sortpick {
    position: relative;
    display: inline-flex;
  }
  .sortpick .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* DIRECTION IS THE ROTATION, not a word. Down is ascending, which matches the list reading
     downward from the smallest; `desc` flips it. `transform` mirrors nothing in RTL, and must
     not: a caret pointing up means the same thing in every direction. */
  .sortcaret {
    flex-shrink: 0;
    transition: transform 120ms ease;
  }
  .sortcaret.desc {
    transform: rotate(180deg);
  }
  .sortmenu {
    position: absolute;
    inset-block-start: calc(100% + 4px);
    inset-inline-end: 0;
    z-index: var(--z-popover);
    min-width: 9rem;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.14);
  }
  .sortitem {
    appearance: none;
    background: none;
    border: none;
    border-radius: 4px;
    padding: 6px 10px;
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink);
    text-align: start;
    cursor: pointer;
  }
  .sortitem:hover {
    background: var(--surface-sunk);
  }
  /* The chosen key, drawn the way the console chips draw theirs: filled, not ticked. */
  .sortitem.active {
    background: var(--ink);
    color: var(--surface);
  }
  /* Artboard: the `Change folder` affordance is a quiet grey 16px glyph, not full ink. */
  .folder-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink-soft);
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }
  .folder-btn:hover { background: var(--surface-sunk); }
  /* Roms.dc.html draws these as a bare green 13px/500 text link, no border and no fill.
     Still real <button>s: focusable, Enter/Space activated, focus ring kept explicitly
     since removing the border also removes the default focus affordance. */
  .action-btn {
    padding: 0;
    background: none;
    border: none;
    border-radius: 2px;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--zelda-green);
    cursor: pointer;
    transition: color 0.1s;
  }
  .action-btn:hover { color: var(--gold-deep); }
  .action-btn:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
  }
  .action-btn:disabled {
    color: var(--ink-dim);
    cursor: default;
  }
  /* TOP-ANCHORED, like the list beside it and like every board draws it. It was centred for one
     round, to make the carousel ride up as the summary squeezed the column. The summary does not
     squeeze anything any more -- it is raised over the body -- so the centring had no remaining
     job, and a carousel floating in the middle of a tall column is not what any artboard shows.
     The mechanism went, so the rule it existed for went with it. */
  .carousel-pane {
    grid-column: span 7;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  /* ---- Bottom dock (bar + drawers) ---- */
  /* RomsNewSystem/RomsSdNoCard/LibrarySummary all draw the dock as a full-bleed
     `flex: 0 0 auto` sibling of the padded body, flush with the page's bottom edge: the bar
     carries `padding: 0 40px` itself and the drawer `padding: 26px 40px 30px`. Here the dock
     sits INSIDE `.tabpane.page-body.library`, which already applies `--page-pad-x` and
     `--page-pad-bottom-library`, so without these the caption would sit at 80px, the drawer's
     content at 80px, and a 32px gutter would show under the bar. The negative margins cancel
     exactly those, matching `.panefoot`'s full-column-width treatment in the Advanced panes
     (lib/advanced/FirmwareRail.svelte). */
  .dock {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    /* No top margin: it was the other half of the space holding `.pagecol` off the bar. */
    margin-top: 0;
    /* No negative margins any more: the dock is a SIBLING of the capped `.pagecol`, so it is
       already full-bleed, and `.tabpane.docked { padding-bottom: 0 }` already puts it flush
       with the page's bottom edge. Its `.bar`/drawer carry their own 40px sides. */
    /* No overflow here on purpose: the Summary tab must never be clipped. */
    /* THE DOCK MUST OUTRANK THE PAGE IT COVERS. It used to be a plain static flex sibling,
       and CSS paints non-positioned blocks (painting order step 3) UNDER positioned
       descendants (step 6) no matter which came later in the DOM — so the carousel's
       absolutely-positioned covers, several hundred pixels above, drew straight over this
       drawer and its upward shadow. Positioning it and putting it on the scale is the fix;
       a bigger number on the carousel would not have been. `isolation` keeps the three
       children below ordered against each other only (drawer < bar < tab, the order
       LibrarySummary.dc.html draws with z-index 2/3/4), never against the app. */
    position: relative;
    z-index: var(--z-dock);
    isolation: isolate;
  }
  /* The options modal. `ModalShell` owns the scrim, the frame and the lip; these are only the
     head and the body inside it. The body caps its own height and scrolls, so a tall panel on a
     short window is reachable instead of running off the frame. */
  .opts-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .opts-title {
    margin: 0;
    font-size: var(--fs-title);
    letter-spacing: -0.01em;
  }
  /* THE SCROLLPORT HAS TO REACH THE MODAL'S EDGES, because a child inside it does.
     `GameDetailsPanel`'s tab strip is full-bleed by `margin-inline: -1.5rem`, cancelling the
     1.5rem that `ModalShell`'s `.modal-body.padded` puts on our PARENT so its bottom rule
     reaches both edges of the modal and reads as one divider. But the padding it cancels is not
     ours: this box had none, so the strip's margin box came out 48px wider than the scrollport
     and hung 24px past the inline-end. Overflow past the inline-end of a scroll container is
     scrollable overflow, and this box scrolls on both axes -- `overflow-y: auto` with
     `overflow-x` unset computes the other axis to `auto` -- so it drew a horizontal scrollbar
     with exactly 24px of travel, at every viewport width, whenever the modal was open. That is
     the scrollbar the owner reported; it was never a content width and never about DPI.
     Taking the same negative margin here and giving the padding back on the inside puts the
     scrollport on the modal's inner edges, where the strip already thought it was: the strip's
     margin box now fills the padding box exactly and contributes no overflow. The content keeps
     its 1.5rem inset, and the vertical scrollbar moves out to the modal edge.
     Do not "simplify" either half away; the pair is what makes the arithmetic cancel. */
  .opts-body {
    max-height: min(70vh, 42rem);
    overflow-y: auto;
    margin-inline: -1.5rem;
    padding-inline: 1.5rem;
  }
  /* The one way in, at the foot of the pane that describes the game it configures. */
  .info-foot {
    display: flex;
    justify-content: center;
    margin-top: auto;
    padding-top: 0.75rem;
  }
  .opts-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 5px;
    padding: 0.55rem 1.1rem;
    cursor: pointer;
  }
  .opts-btn:hover {
    border-color: var(--ink-soft);
  }

  /* Half of `ModalShell`'s 0.5 backdrop: "a little", because this is a panel over its own page
     rather than a separate surface. No token exists for it -- the shell's own value is a
     literal too -- so it is stated once here and derived from that one. */
  .dim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    z-index: var(--z-dock);
  }

  /* The drawer's containing block, and the reason it can meet the bar. Its height is the
     handle's alone -- the drawer inside it is absolute and contributes none -- so its bottom
     padding edge sits exactly on the bar's top edge, which is where the drawer's `bottom: 0`
     then lands. Deliberately NOT `.dock` itself: the dock's top edge is the top of the handle,
     which is a handle's height too high and was the gap. */
  .docktop {
    position: relative;
  }
  .tabrow {
    display: flex;
    justify-content: center;
    /* Pulls the handle's bottom border onto the surface below it, so the two read as one piece
       rather than as a stacked pair of edges. It also lowers `.docktop`'s bottom by the same
       1px, which lands the drawer's square bottom over the bar's top border instead of beside
       it -- no double hairline where they meet. */
    margin-bottom: -1px;
  }
  .summary-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    /* Roms.dc.html / RomsOptions.dc.html (2026-09-08 refresh) draw the tab as a QUIET
       handle: 12px/600 in soft ink (not full ink at inherited 400), no bottom border, and a
       soft upward shadow `0 -3px 10px rgba(0,0,0,0.05)` that lifts it off the bar. */
    font-size: var(--fs-chip);
    font-weight: 600;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-bottom-color: var(--surface);
    border-radius: 7px 7px 0 0;
    padding: 7px 20px 8px;
    box-shadow: 0 -3px 10px rgba(0, 0, 0, 0.05);
    cursor: pointer;
    /* The tab is FIRST in the dock's DOM but must sit on top of the bar and drawer that
       follow it (LibrarySummary.dc.html gives it z-index 4 over their 3 and 2), so its
       bottom border can blend into whichever surface is below. Static siblings paint in DOM
       order, which would bury it. Contained by the dock's isolation. */
    position: relative;
    z-index: var(--z-raised);
  }
  .summary-tab .caret {
    transition: transform 0.15s ease;
  }
  .summary-tab .caret.up {
    transform: rotate(180deg);
  }
  /* Artboard (LibrarySummary) gives the drawer a height envelope — it never collapses
     below 180px and never eats more than 46% of the viewport — and scrolls its BODY,
     not its head, so the title and close stay reachable however long the content runs. */
  /* RAISED OVER THE BODY, NOT WEDGED INTO IT. Absolute, so it contributes no height and the
     body keeps its full size whether the summary is open or shut. The previous arrangement grew
     the dock in flow and let the column shrink, which squeezed the carousel to nothing -- that
     mechanism is gone, not disabled.

     `bottom: 0` against `.docktop`, whose own height is the handle's and whose bottom edge is
     therefore the bar's top edge, puts the panel's bottom ON the bar: it rises out of the bar the
     handle belongs to, which is what the handle's affordance promises. Against `.dock` it was
     `bottom: 100%`, and the dock's top edge is the top of the HANDLE, so the panel stopped a
     handle's height short and the page showed through beside the centred handle.

     NOT `ModalShell`. That shell centres a box in the viewport behind a full scrim and brings
     Escape, click-outside and `pushDismiss` with it. This is a panel anchored to its own bar
     inside the page it belongs to, it must leave that bar visible, and the darkening is slight
     rather than a scrim. Reusing the shell would have meant overriding its geometry and turning
     off most of its behaviour, which is not reuse. */
  .drawer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    min-height: 180px;
    max-height: 46vh;
    background: var(--surface);
    border-top: 1px solid var(--hairline);
    border-radius: 10px 10px 0 0;
    box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.09);
    /* Bottom padding clears the handle that now draws over this edge. The handle is roughly
       34px (12px/600 text, 7px and 8px padding, two borders, less `.tabrow`'s -1px), so 44px
       keeps the overlap inside padding whatever the font metrics resolve to. "No text there,
       so it is harmless" is the instruction; this is what makes it structurally true rather
       than true by a few pixels of luck. */
    padding: 26px var(--page-pad-x) 44px;
  }
  .drawer-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .drawer-head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    /* The close control alone, pushed to the end: the headings live on the columns. */
    justify-content: flex-end;
    padding-bottom: 8px;
  }
  /* Board: `minmax(0, 1fr) 300px`, `gap: 48px`, `align-items: start`. The settings column is
     WIDER than the board's 300px, deliberately: the board drew the column, not the string that
     goes in it, and the real one does not fit. `Compress ROMs with LZMA` beside its checkbox and
     its `uncompressed for now` caption measures about 314px at 14px/12px, so at 300px the label
     wrapped to a second line -- and being a flex item it shrinks below max-content to do it.
     A fixed wider number would only move the cliff to whichever locale is longest, so the track
     is a share with a floor: it takes about 437px of a 1440px window, never less than 340px,
     and it stops being the narrowest thing on the row. That also closes the void the board's
     300px left between a table that does not fill its track and a column jammed against the
     right edge.

     `minmax(0, …)` on the table rather than `1fr` because its own grid has a fixed pair of
     numeric columns and would otherwise refuse to shrink. */
  .drawer-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(340px, 0.5fr);
    gap: 48px;
    align-items: start;
  }
  /* One column at narrow widths: 300px beside a table that already carries two numeric columns
     leaves the labels unreadable long before phone width. The settings follow the table. */
  @media (max-width: 900px) {
    .drawer-cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }
  }
  .drawer-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  /* Artboard label scale: 11px / 0.11em, like every other small-caps section label. */
  .drawer-title {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .drawer-x {
    background: none;
    border: none;
    cursor: pointer;
    /* Artboard draws the close glyph a step lighter than the title's soft ink. */
    color: var(--ink-dim);
    display: flex;
    padding: 4px;
    border-radius: 4px;
  }
  .drawer-x:hover {
    background: var(--surface-sunk);
  }
  .bar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 72px;
    max-height: 88px;
    box-sizing: border-box;
    background: var(--surface);
    border-top: 1px solid var(--hairline);
    padding: 0 var(--page-pad-x);
  }
  /* 3px strip fused to the bar's top edge — adds no height to the bar. */
  /* Audit S1.8. Track is the artboard's #d8d8d8 (= --hairline, the structural level: this
     strip is the footer region's own edge), not --rule. Two segments laid side by side:
     installed, then pending. */
  .meter {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    display: flex;
    background: var(--hairline);
  }
  .meter-fill {
    height: 100%;
    background: var(--zelda-green);
  }
  .meter-pending {
    height: 100%;
    background: var(--silver-edge);
  }
  .meter-fill.over,
  .meter-pending.over {
    background: var(--action-red);
  }
  .bar-left {
    display: flex;
    align-items: baseline;
    gap: 14px;
    min-width: 0;
  }
  /* Artboard: both captions are plain 13px sentences, not mono figures — the numbers sit
     inside a sentence now, so a monospaced face would break the line up. */
  .budget {
    font-size: var(--fs-btn-sm);
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
  }
  .net {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--zelda-green);
  }
  .gate-note {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  /* Artboard: the options toggle, its caret and the primary action sit 18px apart. */
  .bar-right {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-shrink: 0;
  }
  .install-btn {
    font: inherit;
    font-size: var(--fs-btn);
    font-weight: 600;
    color: #ffffff;
    background: var(--action-red);
    border: none;
    border-radius: var(--r-btn);
    padding: var(--pad-btn);
    cursor: pointer;
    box-shadow: inset 0 -2px 0 var(--action-red-deep);
  }
  .install-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
