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
  import { roms } from "../roms.svelte.js";
  import { nativeFolderPickerSupported, saveFileToDirOrDownload, deleteFileFromDir, scanRomDirectory, getValidRoot } from "../romScan.js";
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { romSelection, type Game, classifyContentPath, type ContentCategory } from "../romSelection.svelte.js";
  import { buildFrogfsImage, flashFrogfsRegion } from "../engine/flashInstall.js";
  import { readGameData } from "../engine/frogfsDevice.js";
  import { homebrewStatus, HOMEBREW_DEVICE_FILES, HOMEBREW_TITLES } from "../engine/homebrew.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { dbg, dbgLog } from "../debug.js";
  import { extractHomebrewAssets } from "@gnw/gnw-restool";
  import restoolsZipUrl from "@gnw/gnw-restool/dist/restools.zip?url";
  import { listVersions, fetchBundle, type FirmwareVersion } from "../artifacts.js";
  import AccordionSection from "../advanced/AccordionSection.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { isStubAlive } from "../engine/flasher.js";
  import { raceWithFallback } from "../engine/timeout.js";
  import InstallGeometry from "../ui/InstallGeometry.svelte";
  import ModalShell from "../ui/ModalShell.svelte";
  import ChangeSummary, { type ChangeItem } from "../ui/ChangeSummary.svelte";
  import StatPanel, { type StatRow } from "../ui/StatPanel.svelte";
  import Carousel from "../ui/Carousel.svelte";
  import GameDetailsPanel from "./GameDetailsPanel.svelte";
  import { EXTBASE } from "../engine/addr.js";
  import { download } from "../util.js";
  import JSZip from "jszip";

  let dismissedFirefoxWarning = $state(false);

  // Fire the folder-gate modal as soon as this tab is shown, if required folders are missing.
  // Also apply the connection policy for this tab (SD+ROMs: never auto-connect; Flash+ROMs:
  // silently attempt the known/trusted adapter in the background, no modal — see
  // device.autoProbeRoms()'s doc comment).
  onMount(() => {
    roms.ensureFolders(device.targetMedia === "sd").catch(() => {});
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
    if (device.targetMedia === "sd" && device.sdHandle && device.sdHandle !== sdAutoScannedHandle) {
      sdAutoScannedHandle = device.sdHandle;
      void device.scanSdCardGames();
    }
  });
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

  // Cheat files live directly next to their ROM (roms/<system>/<name>.<ext> — confirmed on
  // real hardware for both flash and SD), so a path looks identical in shape to a game's;
  // only the extension tells them apart.
  function parseCheatsFile(
    path: string,
    data: Uint8Array,
    out: Record<string, string[]>,
    outFiles: Record<string, Uint8Array>,
  ): void {
    if (!path.startsWith("roms/")) return;
    if (!(path.endsWith(".ggcodes") || path.endsWith(".mcf") || path.endsWith(".pceplus"))) return;
    const parts = path.split("/");
    if (parts.length < 3) return;
    const system = parts[1];
    const baseName = parts.slice(2).join("/").replace(/\.[^/.]+$/, "");
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
      for (const [path, data] of scan.userRoms) parseCheatsFile(path, data, parsed, parsedFiles);
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
  const MiB = (n: number): string => (n / 1048576).toFixed(2);
  const size = (n: number): string => (n >= 1048576 ? `${MiB(n)} MiB` : `${(n / 1024).toFixed(0)} KiB`);

  let {
    openSet,
    onToggle,
    onRunning,
  }: {
    openSet: Set<string>;
    onToggle: (id: string) => void;
    onRunning: (id: string, running: boolean) => void;
  } = $props();

  // Silently re-adopt the last-used ROM folder (no prompt); reconnect button if it needs a re-grant.
  $effect(() => {
    void roms.restoreLast();
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
    openInstall();
  }

  // Guided flow between the three drop-downs: collapse the current section + open the next.
  // onToggle flips one id; the two ids differ, so two checked toggles move between sections.
  function advance(closeId: string, openId: string): void {
    if (openSet.has(closeId)) onToggle(closeId);
    if (!openSet.has(openId)) onToggle(openId);
  }

  // Recognized ROMs in the folder (after filtering cover art / docs / non-game systems) — the
  // folder's raw file count (roms.scan.summary) includes those, which is why it can read e.g. "25
  // files / 5 systems" while only 7 ROMs across 3 systems are actually recognized.
  const folderGames = $derived(romSelection.games.filter((g) => g.inFolder));
  const folderSystemCount = $derived(new Set(folderGames.map((g) => g.system)).size);

  // --- Homebrew (shown as TITLES, not removable game files; always preserved on install) ------
  const deviceHomebrew = $derived(device.installedGames.filter((g) => g.system === "homebrew"));
  const homebrewTitles = $derived(homebrewStatus(deviceHomebrew.map((g) => g.name)));
  const unknownHomebrew = $derived(
    deviceHomebrew.filter((g) => !HOMEBREW_TITLES.some((h) => h.deviceFiles.includes(g.name)) && !romSelection.deletedUnknownHomebrew.has(g.name)),
  );



  // --- Select-games table state -----------------------------------------------------------
  let consoleFilter = $state<string>("all");
  let listCollapsed = $state<boolean>(false);
  let hasInitializedSelection = $state(false);

  $effect(() => {
    // When filter changes, reset the initialization flag
    consoleFilter;
    hasInitializedSelection = false;
  });

  function clearSelection(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".row") && !target.closest(".coverflow-item") && !target.closest(".action-btn")) {
      selectedCarouselId = "";
      hasInitializedSelection = true;
    }
  }
  let showMissing = $state(false);
  const visibleGames = $derived.by(() => {
    let list: any[] = romSelection.games.filter(
      (g) =>
        (consoleFilter === "all" || g.system === consoleFilter) && (!showMissing || !g.installed),
    ).map(g => ({ ...g, isHomebrew: false }));

    if (consoleFilter === "all" || consoleFilter === "homebrew") {
      HOMEBREW_TITLES.forEach(hb => {
        list.push({
          key: hb.key,
          system: "homebrew",
          name: hb.label,
          size: getHomebrewSize(hb.key),
          inFolder: false,
          installed: false,
          isHomebrew: true,
          hb: hb // Keep reference to original object
        });
      });
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
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
      const hb = g.hb;
      const isCeleste = hb.key === "celeste";
      const onDevice = hb.deviceFiles.every((f: string) => deviceHomebrew.some((d) => d.name === f));
      const isSelected = romSelection.isHomebrewSelected(hb.key);
      const hasSourceRom = hb.sourceRoms.length > 0 && [...(roms.scan?.userRoms.keys() ?? [])].some(k => k.endsWith(hb.sourceRoms[0]));
      const isExtracting = extracting.has(hb.key);
      const hasExtracted = hb.deviceFiles.some((f: string) => extractedAssets.has(`homebrew/${f}`));
      const isReady = isCeleste || hasExtracted || onDevice;

      if (onDevice) {
        if (isSelected) return { label: "installed", cls: "installed", action: () => romSelection.toggleHomebrew(hb.key, false), disabled: false };
        else return { label: "uninstall", cls: "uninstall", action: () => romSelection.toggleHomebrew(hb.key, true), disabled: false };
      } else {
        if (!isReady) {
          if (hasSourceRom && !isExtracting) return { label: "prepare", cls: "muted", action: () => convertAssets(hb), disabled: false };
          if (isExtracting) return { label: "extracting...", cls: "muted", action: () => {}, disabled: true };
          return { label: "missing rom", cls: "muted", action: () => {}, disabled: true };
        } else {
          if (isSelected) return { label: "install", cls: "new", action: () => romSelection.toggleHomebrew(hb.key, false), disabled: false };
          else return { label: "not installed", cls: "muted", action: () => romSelection.toggleHomebrew(hb.key, true), disabled: false };
        }
      }
    } else {
      const isSelected = romSelection.isSelected(g.key);
      if (g.installed) {
        if (isSelected) return { label: "installed", cls: "installed", action: () => romSelection.toggle(g.key), disabled: false };
        else return { label: "uninstall", cls: "uninstall", action: () => romSelection.toggle(g.key), disabled: false };
      } else {
        if (isSelected) return { label: "install", cls: "new", action: () => romSelection.toggle(g.key), disabled: false };
        else return { label: "not installed", cls: "muted", action: () => romSelection.toggle(g.key), disabled: false };
      }
    }
  }

  // --- Lazy preview: build the RAW FrogFS from the SELECTION to learn its size + reuse for flash.
  // Built when Select-games or Install-ROMs is open + the device is base-installed; rebuilt when the
  // selection changes. (The preview uses folder bytes only; on-device-only retained games add a
  // little size the install accounts for — exact in the common case where the folder has everything.)
  let builtFrogfs = $state<Uint8Array | null>(null);
  let newFrogfsLen = $state<number | null>(null);
  let building = $state(false);
  let buildErr = $state<string | null>(null);
  const installAllCores = true;
  let builtFor = $state<string | null>(null);
  let buildToken = 0;

  // Pyodide Extraction State
  let extracting = $state(new Set<string>());
  let extractError = $state<string | null>(null);
  let extractedAssets = $state(new Map<string, Uint8Array>());

  // Carousel State
  let coverUrls = new Map<string, string>();
  let coverVersion = $state(0);
  
  function getCoverUrl(gameKey: string, _version = 0) {
    if (coverUrls.has(gameKey)) return coverUrls.get(gameKey)!;
    let system = "";
    let base = "";
    
    const hb = HOMEBREW_TITLES.find(h => h.key === gameKey);
    if (hb) {
      system = "homebrew";
      base = hb.displayName;
    } else if (!gameKey.includes("/")) {
      // Unrecognized ("unknown") homebrew — a bare on-device filename under roms/homebrew/,
      // not one of the curated HOMEBREW_TITLES (no displayName to fall back to). Previously
      // this fell through to the split("/") branch below, which requires a "/" and returns ""
      // immediately for a bare filename — so unknown-homebrew covers could never be found even
      // if genuinely present in roms.scan.userRoms.
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
      if (roms.scan?.userRoms.has(inlinePath)) matchPath = inlinePath;
      else if (roms.scan?.userRoms.has(coversPath)) matchPath = coversPath;
      
      if (matchPath) {
        const url = URL.createObjectURL(new Blob([roms.scan!.userRoms.get(matchPath) as any]));
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

  async function convertAssets(hb: typeof HOMEBREW_TITLES[0]) {
    const romPath = [...(roms.scan?.userRoms.keys() ?? [])].find(k => k.endsWith(hb.sourceRoms[0]));
    if (!romPath) return;
    const romData = roms.scan!.userRoms.get(romPath)!;
    
    extracting.add(hb.key);
    extracting = new Set(extracting);
    extractError = null;
    try {
      const res = await Promise.race([
        extractHomebrewAssets(hb.key as any, romData, restoolsZipUrl),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Extraction timed out after 60s")), 60000))
      ]);
      if (!res.success) throw new Error(res.error);
      for (const [fname, data] of Object.entries(res.files || {}) as [string, Uint8Array][]) {
        extractedAssets.set(`homebrew/${fname}`, data);
      }
      extractedAssets = new Map(extractedAssets);
      romSelection.toggleHomebrew(hb.key, true);
    } catch (err: any) {
      extractError = err.message;
    } finally {
      extracting.delete(hb.key);
      extracting = new Set(extracting);
    }
  }

  const selSig = $derived([
    ...romSelection.selectedKeys, 
    ...romSelection.selectedHomebrewKeys, 
    ...extractedAssets.keys(),
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
  // Confirmed on real hardware (both flash and SD): despite the README/odroid_system.c path
  // helpers suggesting a dedicated cheats/<system>/ directory, the firmware actually looks for
  // cheat files DIRECTLY NEXT TO the ROM — same directory, same base name, cheat extension.
  function cheatFilePath(key: string): string {
    const [system, ...nameParts] = key.split("/");
    const name = nameParts.join("/").replace(/\.[^/.]+$/, "");
    return `${system}/${name}.${CHEAT_EXTS[system] || "ggcodes"}`;
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
   *  function rather than routed through changedSdUserRoms/roms.dirtyFiles because cheat file
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

  async function buildPreview(sig: string): Promise<void> {
    const token = ++buildToken;
    building = true;
    buildErr = null;
    try {
      const versions = await listVersions();
      if (versions.length === 0) throw new Error("No firmware versions are published yet.");
      const bundle = await fetchBundle(versions[0].tag);
      const combinedRoms = romSelection.selectedFolderRoms();
      for (const [k, v] of extractedAssets.entries()) combinedRoms.set(k, v);
      injectCheats(combinedRoms);
      const { frogfs } = await buildFrogfsImage(bundle, combinedRoms, { 
        installAllCores,
        selectedHomebrew: romSelection.selectedHomebrewKeys,
        homebrewTitles: HOMEBREW_TITLES
      });
      if (token !== buildToken) return;
      builtFrogfs = frogfs;
      newFrogfsLen = frogfs.length;
      builtFor = sig;
    } catch (e) {
      if (token !== buildToken) return;
      builtFrogfs = null;
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
    if (romSelection.removals.length === 0 && romSelection.deletedUnknownHomebrew.size === 0 && HOMEBREW_TITLES.every(hb => !hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f)) || romSelection.selectedHomebrewKeys.has(hb.key))) return frogfsOffset + currentFrogfsLen;
    let min = Infinity;
    for (const g of romSelection.removals) {
      const dev = device.installedGames.find((x) => x.system === g.system && x.name === g.name);
      if (dev && dev.dataOffs < min) min = dev.dataOffs;
    }
    for (const hb of HOMEBREW_TITLES) {
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
      body: installBody,
      danger: true,
      confirmText: locale.t.roms.install.installConfirm,
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
      body: locale.t.roms.sdSync.syncBody,
      confirmText: locale.t.roms.sdSync.syncConfirm,
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
      // "Flashing games, BIOS, languages" already names this single write — a substep here
      // would be tautological, same reasoning as Wizard.svelte's "Flashing Retro-Go" phase
      // omitting an "Internal firmware" substep. This flow never touches intflash at all.
    },
    { id: "rescan", label: locale.t.roms.install.phaseRescan },
  ];
  // SD mode only: re-write the cores/bios/fonts bundle (sdContent), AND (on a bank2 install)
  // update_bank2.bin — the two are the same upgrade action from the user's perspective ("Upgrade
  // Retro-Go and Emulators"), so a single checkbox drives both; there's no separate "include
  // firmware update" opt-in anymore. OFF by default — these rarely change and are the bulk of
  // the sync's data; only needed when preparing the SD card for a firmware/cores update, not on
  // every ROM/cover/cheat sync.
  let syncCores = $state(false);

  // Version to upgrade Emulators/cores + Retro-Go to, when syncCores is on — same real
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
  // emulator count — without a full added/changed/removed diff against the SD card (that would
  // need retaining the SD scan's cores/bios bytes AND fetching+unpacking the bundle just to show
  // a summary line; see the "cores/system-files sync delta" research — punted as not worth the
  // eager-fetch cost for a display-only number). This still fetches the (large) bundle eagerly,
  // but only once per version, and only while the checkbox is actually on.
  let coreBundleInfo = $state<{ tag: string; fileCount: number; emulatorCount: number } | null>(null);
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
        coreBundleInfo = { tag, fileCount: bundle.sdContent.size, emulatorCount: bundle.manifest.cores.length };
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

  // Sub-steps for the two system-level items (Emulators, Firmware Update) only appear in the
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
      // removals), then the two system-level items grouped together at the end (Emulators
      // == cores/bios/fonts bundle, Firmware Update — "tied together"). Both are driven by the
      // single "Upgrade Retro-Go and Emulators" checkbox (syncCores) — there's no separate
      // firmware-update opt-in. "fw-update" only exists on a bank2 install (nothing to write
      // update_bank2.bin for otherwise).
      substeps: [
        { id: "games", label: locale.t.roms.sdSync.writeSubGames },
        { id: "covers", label: locale.t.roms.sdSync.writeSubCovers },
        { id: "cheats", label: locale.t.roms.sdSync.writeSubCheats },
        { id: "remove", label: locale.t.roms.sdSync.writeSubRemove },
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
      const hb = HOMEBREW_TITLES.find(t => t.key === k);
      return hb && !hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f));
    }).length
  );
  
  const hbRemovals = $derived(
    HOMEBREW_TITLES.filter(hb => hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f)) && !romSelection.selectedHomebrewKeys.has(hb.key)).length + romSelection.deletedUnknownHomebrew.size
  );

  function getHomebrewSize(hbKey: string): number {
    const hb = HOMEBREW_TITLES.find(h => h.key === hbKey);
    if (!hb) return 0;
    let total = 0;
    for (const f of hb.deviceFiles) {
      if (extractedAssets.has(`homebrew/${f}`)) {
        total += extractedAssets.get(`homebrew/${f}`)!.length;
      } else {
        const g = deviceHomebrew.find(x => x.name === f);
        if (g) total += g.size;
      }
    }
    return total;
  }

  const hbAdditionsBytes = $derived.by(() => {
    let bytes = 0;
    for (const k of romSelection.selectedHomebrewKeys) {
      const hb = HOMEBREW_TITLES.find(t => t.key === k);
      if (hb && !hb.deviceFiles.every(f => deviceHomebrew.some(g => g.name === f))) {
        bytes += getHomebrewSize(k);
      }
    }
    return bytes;
  });

  const hbRemovalsBytes = $derived.by(() => {
    let bytes = 0;
    for (const hb of HOMEBREW_TITLES) {
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
  // local edits (covers/cheats via GameDetailsPanel — see roms.markDirty), and no cores
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
      roms.dirtyFiles.size > 0 ||
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
      roms.dirtyFiles.size > 0 ||
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

  const summaryItems = $derived.by<ChangeItem[]>(() => {
    const sel = romSelection.selectedKeys.size;
    const hbSel = romSelection.selectedHomebrewKeys.size;
    // ROM-only — must NOT include hbAdditions/hbRemovals, or selecting/deselecting homebrew
    // would incorrectly move the "ROMs" row's count, which is supposed to be independent now
    // that Homebrew has its own row.
    const romsAdded = romSelection.additions.length;
    const romsRemoved = romSelection.removals.length;

    const numCheatGames = Object.values(configuredCheats).filter(c => c.length > 0).length;
    // Covers touched THIS SESSION (via roms.markDirty(), GameDetailsPanel's cover-edit path) —
    // not a static total of every cover file on disk, which never changes and tells you
    // nothing about what a sync/install would actually do.
    let coversChanged = 0;
    for (const path of roms.dirtyFiles) {
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

    if (device.targetMedia === "sd") {
      const rows: ChangeItem[] = [
        {
          label: locale.t.roms.summary.romsLabel,
          status: locale.t.roms.summary.selectedCount(sel),
          kind: sel > 0 ? "info" : "muted",
          delta: changeDelta(romsAdded, romsRemoved),
        },
        {
          label: locale.t.roms.summary.homebrewLabel,
          status: hbSel > 0 ? locale.t.roms.summary.selectedCount(hbSel) : locale.t.roms.summary.noneSelected,
          kind: hbSel > 0 ? "info" : "muted",
          delta: changeDelta(hbAdditions, hbRemovals),
        },
        coverArtRow,
      ];
      rows.push(cheatsRow);
      // Only shown when the user has actually opted in (syncCores) — "Skipped (unchanged)"
      // is the default, unremarkable state for every sync and doesn't need its own row.
      if (syncCores) {
        const status = coreBundleErr
          ? locale.t.roms.summary.errorFetchingVersionInfo
          : coreBundleInfo && coreBundleInfo.tag === selectedCoreVersionTag
            ? locale.t.roms.summary.emulatorsAndFiles(coreBundleInfo.emulatorCount, coreBundleInfo.fileCount, coreBundleInfo.tag)
            : coreBundleLoading
              ? locale.t.roms.summary.calculating
              : locale.t.roms.summary.willBeResynced;
        rows.push({
          label: locale.t.roms.summary.coresLabel,
          status,
          kind: coreBundleErr ? "warn" : "info",
          detail: isBank2Install ? locale.t.roms.summary.includesFirmwareUpdate : undefined,
        });
      }
      // Total projected size always LAST — the summary line the rest of the panel builds up to.
      rows.push({
        label: locale.t.roms.summary.totalProjectedSizeLabel,
        status: `${MiB(selectedTotalBytes)} MiB`,
        kind: "info",
        total: true,
      });
      return rows;
    }

    // Flash mode — FrogFS-specific summary. "ROMs" is just the regular-game count (sel) now
    // that Homebrew gets its own row below — the old combined "Total ROMs & Ports" count
    // double-represented the same selection across two rows.
    const sizeStr = newFrogfsLen !== null ? `${MiB(newFrogfsLen)} MiB` : building ? locale.t.roms.summary.calculating : "—";
    let sizeDetail: string | undefined;
    if (newFrogfsLen !== null && currentFrogfsLen !== null) {
      const net = newFrogfsLen - currentFrogfsLen;
      sizeDetail = net === 0 ? undefined : locale.t.roms.summary.netChange(net > 0 ? "+" : "", MiB(net));
    }

    const rows: ChangeItem[] = [
      {
        label: locale.t.roms.summary.romsLabel,
        status: locale.t.roms.summary.selectedCount(sel),
        kind: fitsGap ? "info" : "warn",
        detail: !fitsGap ? locale.t.roms.install.wontFitDetail : undefined,
        delta: changeDelta(romsAdded, romsRemoved),
      },
      {
        label: locale.t.roms.summary.homebrewLabel,
        status: hbSel > 0 ? locale.t.roms.summary.selectedCount(hbSel) : locale.t.roms.summary.noneSelected,
        kind: hbSel > 0 ? "info" : "muted",
        delta: changeDelta(hbAdditions, hbRemovals),
      },
    ];
    rows.push(coverArtRow);
    rows.push(cheatsRow);
    // "Saves" (was: static "Preserved — untouched") and "Compression" (was: static
    // "Uncompressed (raw, XiP)") rows removed — neither conveyed actionable information.
    // Compression should come back here once LZMA is actually functional (see the disabled
    // checkbox below); showing a status for a feature that doesn't work yet was misleading.
    // Total projected size always LAST.
    rows.push({ label: locale.t.roms.summary.totalProjectedSizeLabel, status: sizeStr, kind: "info", detail: sizeDetail, total: true });
    return rows;
  });

  // SD mode's "before/after space" story and the per-category summaryItems used to render as
  // two separately-boxed panels stacked with a divider between them — genuinely the same kind
  // of data (what's changing this sync), just split for no real reason. United into one flat
  // StatRow[] so a single StatPanel renders the whole thing as one list.
  // summaryItems already orders Games first and "Total projected size" (selectedTotalBytes)
  // last for SD mode — this is now just the ChangeItem -> StatRow shape conversion.
  const sdSummaryRows = $derived.by<StatRow[]>(() =>
    summaryItems.map((it) => ({ label: it.label, value: it.status, tone: it.kind, detail: it.detail, delta: it.delta, total: it.total })),
  );

  const installBody = $derived(locale.t.roms.install.installBody(hex(EXTBASE + frogfsOffset)));

  /** Convert a userRoms key to its SD card path (retro-go directory layout). */
  function toSdPath(key: string): string {
    const cat = classifyContentPath(key).category;
    // "cheat" deliberately excluded here — confirmed on real hardware that cheat files live
    // directly next to their ROM (under roms/<system>/), same as a game, not their own
    // top-level directory. cheatFilePath() already builds keys in that same-directory shape.
    if (cat === "cover" || cat === "bios") return key;
    return `roms/${key}`; // GBC/zelda.gbc → roms/GBC/zelda.gbc
  }

  /** Per-category SD sync policy — the explicit source of truth for "does this category get
   *  (re)written, and when." "always" means unconditionally included regardless of dirty/added
   *  state; "added-or-dirty" defers to the freshTarget/addedKeys/dirtyFiles checks below. A new
   *  category added to ContentCategory MUST get an entry here, or TypeScript's Record will
   *  refuse to compile — that's the whole point (see the homebrew-cover bug this replaced,
   *  where a new category silently fell through a growing ad-hoc boolean chain instead).
   *  "cheat" is "always" here to match injectCheats() unconditionally regenerating cheat
   *  entries afterward regardless (final output is identical either way); "homebrew" is
   *  "always" for the same reason as extractedAssets' unconditional merge below, though in
   *  practice a "homebrew" category path never reaches this function at all — selectedFolderRoms
   *  structurally excludes it, only game/bios/cheat/cover paths are ever in its output. */
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
    // synced by coincidence — if it happens to also be in roms.dirtyFiles from an unrelated
    // edit. Compute the homebrew equivalent of "newly added" here so a title's cover reliably
    // ships the first time it's selected, matching how extractedAssets (its engine files) are
    // already unconditionally included below regardless of this filter.
    const deviceHomebrewNames = new Set(deviceHomebrew.map((g) => g.name));
    const newlySelectedHomebrew = new Set(
      HOMEBREW_TITLES.filter(
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
        roms.dirtyFiles.has(path) ||
        isNewHomebrewCover;
      if (included) out.set(path, data);
    }
    return out;
  }

  /** Sync the current ROM selection (+ covers, cheats, homebrew assets, optionally cores) to
   *  the SD card. Only writes files that are new or changed since the last sync — see
   *  changedSdUserRoms. Chromium: writes directly via FSAA. Firefox (no sdHandle): ZIP download. */
  async function doSdSync(report: PhaseReporter): Promise<void> {
    // User content: ROMs + bios (only the changed subset — see changedSdUserRoms), covers,
    // homebrew assets (always freshly-prepared, see convertAssets), cheats (only the games
    // whose overlay actually differs from the on-device baseline — see changedCheatEntries).
    // Categorize the flat diff by content type so the checklist accurately shows what's
    // actually changing, not just a total file count.
    report.start("scan");
    const freshTarget = device.installedGames.length === 0;
    const userRoms = changedSdUserRoms(romSelection.selectedFolderRoms());
    for (const [k, v] of extractedAssets) userRoms.set(k, v);
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
      // convertCoversInMap (roms.svelte.ts) keeps BOTH the converted .img sidecar and the
      // original PNG/JPG in the scanned map — the original is for local UI display only.
      // The SD card (like the device) only ever wants the converted .img.
      if (cls.category === "cover" && !cls.isDeviceCover) continue;
      SD_WRITE_BUCKET[cls.category].set(path, data);
    }

    report.subStart("scan", "games");
    report.log(
      "scan",
      locale.t.roms.sdSync.logGamesScanned(
        changedGames.size,
        romSelection.removals.length,
        freshTarget ? locale.t.roms.sdSync.freshTargetSuffix : "",
      ),
      "games",
    );
    report.subFinish("scan", "games");

    report.subStart("scan", "covers");
    report.log("scan", locale.t.roms.sdSync.logCoversScanned(changedCovers.size), "covers");
    report.subFinish("scan", "covers");

    report.subStart("scan", "cheats");
    report.log("scan", locale.t.roms.sdSync.logCheatsScanned(changedCheats.size), "cheats");
    report.subFinish("scan", "cheats");

    report.log(
      "scan",
      syncCores
        ? locale.t.roms.sdSync.logCoresWillResync(isBank2Install)
        : locale.t.roms.sdSync.logCoresSkipped,
    );
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
      report.log("write", locale.t.roms.sdSync.logFetchingBundle(tag), "cores");
      const bundle = await fetchBundle(tag);
      if (syncCores) sdContent = bundle.sdContent;
      sd2Blob = bundle.blobs.sd_2;
    }

    // Pre-seed known totals for the per-file substeps so the checklist shows "[0/N]" for each
    // even before it goes active (owner's mockup: "Remove de-selected games [0/2]" shown while
    // still pending) — the counts are already known from the diff, no need to wait.
    report.progress("write", 0, changedGames.size, undefined, "games");
    report.progress("write", 0, changedCovers.size, undefined, "covers");
    report.progress("write", 0, changedCheats.size, undefined, "cheats");
    report.progress("write", 0, romSelection.removals.length, undefined, "remove");

    if (sdHandle) {
      // Order matches the owner's mockup: per-game content first, system-level items last.
      report.subStart("write", "games");
      report.log("write", changedGames.size > 0 ? locale.t.roms.sdSync.logWritingGames(changedGames.size) : locale.t.roms.sdSync.logNoGameChanges, "games");
      {
        let done = 0;
        const total = changedGames.size;
        for (const [key, data] of changedGames) {
          const path = toSdPath(key);
          dbg("[sd-sync] game", path);
          report.log("write", path, "games");
          await saveFileToDirOrDownload(sdHandle, path, data);
          done++;
          report.progress("write", done, total, undefined, "games");
        }
      }
      report.subFinish("write", "games");

      report.subStart("write", "covers");
      report.log("write", changedCovers.size > 0 ? locale.t.roms.sdSync.logWritingCovers(changedCovers.size) : locale.t.roms.sdSync.logNoCoverChanges, "covers");
      {
        let done = 0;
        const total = changedCovers.size;
        for (const [key, data] of changedCovers) {
          const path = toSdPath(key);
          dbg("[sd-sync] cover", path);
          report.log("write", path, "covers");
          await saveFileToDirOrDownload(sdHandle, path, data);
          done++;
          report.progress("write", done, total, undefined, "covers");
        }
      }
      report.subFinish("write", "covers");

      report.subStart("write", "cheats");
      report.log("write", changedCheats.size > 0 ? locale.t.roms.sdSync.logWritingCheats(changedCheats.size) : locale.t.roms.sdSync.logNoCheatChanges, "cheats");
      {
        let done = 0;
        const total = changedCheats.size;
        for (const [key, data] of changedCheats) {
          const path = toSdPath(key);
          dbg("[sd-sync] cheat", path);
          report.log("write", path, "cheats");
          await saveFileToDirOrDownload(sdHandle, path, data);
          done++;
          report.progress("write", done, total, undefined, "cheats");
        }
      }
      report.subFinish("write", "cheats");

      report.subStart("write", "remove");
      if (romSelection.removals.length > 0) {
        report.log("write", locale.t.roms.sdSync.logRemoving(romSelection.removals.length), "remove");
        let done = 0;
        const total = romSelection.removals.length;
        for (const g of romSelection.removals) {
          const path = toSdPath(g.key);
          dbg("[sd-sync] remove", path);
          try {
            await deleteFileFromDir(sdHandle, path);
            report.log("write", locale.t.roms.sdSync.logRemoved(path), "remove");
          } catch (e) {
            report.log("write", locale.t.roms.sdSync.logCouldNotRemove(path, e instanceof Error ? e.message : String(e)), "remove");
          }
          done++;
          report.progress("write", done, total, undefined, "remove");
        }
      } else {
        report.log("write", locale.t.roms.sdSync.logNoGamesToRemove, "remove");
      }
      // Cheat files for a game whose overlay was cleared but the baseline still had one on the
      // device — injectCheats' write-only shape can't signal this, changedCheatEntries does.
      for (const path of cheatsToRemove) {
        dbg("[sd-sync] remove cheat", path);
        try {
          await deleteFileFromDir(sdHandle, path);
          report.log("write", locale.t.roms.sdSync.logRemovedClearedCheat(path), "remove");
        } catch (e) {
          report.log("write", locale.t.roms.sdSync.logCouldNotRemove(path, e instanceof Error ? e.message : String(e)), "remove");
        }
      }
      report.subFinish("write", "remove");

      // "cores"/"fw-update" only exist as checklist items when their checkbox is on (see
      // sdPhases) — only report through them when that's actually the case.
      if (syncCores) {
        report.subStart("write", "cores");
        if (sdContent.size > 0) {
          report.log("write", locale.t.roms.sdSync.logWritingCores(sdContent.size), "cores");
          for (const [path, data] of sdContent) {
            dbg("[sd-sync] core", path);
            report.log("write", path, "cores");
            await saveFileToDirOrDownload(sdHandle, path, data);
          }
        } else {
          report.log("write", locale.t.roms.sdSync.logCoresSkippedWrite, "cores");
        }
        report.subFinish("write", "cores");
      }

      if (syncCores && isBank2Install) {
        report.subStart("write", "fw-update");
        if (sd2Blob) {
          // update_bank2.bin = raw intflash binary; the on-device firmware_update app
          // checks for this file directly and flashes it to bank2.
          report.log("write", locale.t.roms.sdSync.logWritingFwUpdate, "fw-update");
          await saveFileToDirOrDownload(sdHandle, "update_bank2.bin", sd2Blob);
        } else {
          report.log("write", locale.t.roms.sdSync.logFwUpdateSkipped, "fw-update");
        }
        report.subFinish("write", "fw-update");
      }
    } else {
      // Firefox fallback — pack everything into a ZIP for download.
      report.log("write", locale.t.roms.sdSync.logNoSdHandleZip);
      const zip = new JSZip();
      for (const [path, data] of sdContent) zip.file(path, data);
      for (const [key, data] of [...changedGames, ...changedCovers, ...changedCheats]) zip.file(toSdPath(key), data);
      if (syncCores && isBank2Install && sd2Blob) {
        zip.file("update_bank2.bin", sd2Blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      download(locale.t.roms.sdSync.zipDownloadName, blob);
    }
    report.finish("write");
    } finally {
      // Always rescan — success or failure — so the UI reflects what's actually on the SD
      // card right now, not stale pre-sync state. Deliberately NOT in the try body above: if
      // any write throws, everything after it in that block is skipped, and this rescan must
      // still run. roms.clearDirty() below is the opposite — it must NOT run on failure, or
      // "Sync SD Card" would go disabled (sdSyncHasChanges) even though the failed writes are
      // still pending, silently hiding that there's still work to do.
      report.start("rescan");
      if (sdHandle) {
        report.log("rescan", locale.t.roms.sdSync.logRescanning);
        await device.scanSdCardGames(); // mirrors runInstall()'s post-FrogFS-flash rescan
        await loadCheatsBaseline(); // re-read cheats/ so the next sync's diff has a fresh baseline
      } else {
        report.log("rescan", locale.t.roms.sdSync.logNoSdHandleRescan);
      }
      report.finish("rescan");
    }

    report.start("done");
    roms.clearDirty(); // synced — next sync starts clean unless something changes again
    report.finish("done");
  }

  async function runInstall(report: PhaseReporter): Promise<void> {
    report.start("prepare");
    report.log("prepare", locale.t.roms.install.logConnecting);
    dbg("[install] start", { frogfsOffset: hex(frogfsOffset), ceiling: hex(ceilingOffset ?? 0), eraseBlock, extBytes: device.extFlashBytes });
    const flasher = await device.ensureStub();
    report.log("prepare", locale.t.roms.install.logFlashUtilReady(hex(frogfsOffset), eraseBlock));
    report.finish("prepare");

    report.start("budget");
    if (!fitsGap) {
      report.log("budget", locale.t.roms.install.logBudgetBlocked(MiB(currentEstSize)));
      throw new Error(locale.t.roms.install.errBudgetBlocked);
    }
    const gapMiB = ceilingOffset !== null ? MiB(ceilingOffset - frogfsOffset) : "?";
    report.log("budget", locale.t.roms.install.logBudgetFits(MiB(currentEstSize), gapMiB));
    report.finish("budget");

    report.start("build");
    const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);
    const userRoms = romSelection.selectedFolderRoms();
    dbg("[install] folder roms:", userRoms.size, "retained:", romSelection.retainedFromDevice.length);
    // Preserve on-device-only selected games by re-reading their bytes from the device FrogFS.
    report.subStart("build", "retain");
    const retained = romSelection.retainedFromDevice;
    for (const g of retained) {
      const dev = device.installedGames.find((x) => x.system === g.system && x.name === g.name);
      if (dev) userRoms.set(`${g.system}/${g.name}`, await readGameData(read, frogfsOffset, dev));
    }
    // Always preserve on-device HOMEBREW (engine .bin + restool-generated assets like zelda3.ro):
    // these aren't user-folder games and must survive a repack. The bundle re-adds the .bin engines
    // anyway; re-reading covers the generated assets too. (Restool/install of NEW homebrew is the
    // deferred module — see engine/homebrew.ts.)
    const deviceHomebrew = device.installedGames.filter((g) => g.system === "homebrew");
    for (const g of deviceHomebrew) {
      if (romSelection.deletedUnknownHomebrew.has(g.name)) continue;
      const hb = HOMEBREW_TITLES.find((t) => t.deviceFiles.includes(g.name));
      if (hb && !romSelection.selectedHomebrewKeys.has(hb.key)) continue;
      userRoms.set(`${g.system}/${g.name}`, await readGameData(read, frogfsOffset, g));
    }
    report.log("build", locale.t.roms.install.logRetainedGames(retained.length, deviceHomebrew.length), "retain");
    report.subFinish("build", "retain");

    report.subStart("build", "pack");
    // Reuse the cached preview only when nothing had to be re-read from the device and it's current.
    const preserved = retained.length > 0 || deviceHomebrew.length > 0;
    let frogfs = !preserved && builtFrogfs && builtFor === selSig ? builtFrogfs : null;
    if (!frogfs) {
      report.log("build", locale.t.roms.install.logBuildingImage, "pack");
      const versions = await listVersions();
      if (versions.length === 0) throw new Error(locale.t.roms.install.errNoFirmwareVersions);
      const bundle = await fetchBundle(versions[0].tag);
      for (const [k, v] of extractedAssets.entries()) userRoms.set(k, v);
      injectCheats(userRoms);
      frogfs = (await buildFrogfsImage(bundle, userRoms, {
        installAllCores,
        selectedHomebrew: romSelection.selectedHomebrewKeys,
        homebrewTitles: HOMEBREW_TITLES
      })).frogfs;
    } else {
      report.log("build", locale.t.roms.install.logReusingPreview, "pack");
    }
    report.log("build", locale.t.roms.install.logImageReady(MiB(frogfs.length), hex(frogfsOffset)), "pack");
    dbg("[install] frogfs built:", frogfs.length, "bytes → flashing @", hex(frogfsOffset));
    report.subFinish("build", "pack");
    report.finish("build");

    // Stall mitigation (hypothesis, NOT proven — see CLAUDE.md / plan notes): give the
    // link a beat + a liveness ping before the first flash write after the CPU/WASM-heavy
    // FrogFS build above. Mirrors the existing 500ms post-flash settle in engine/flasher.ts;
    // does not touch the flashImage() 15s watchdog itself. Deliberately NOT a visible
    // phase — an internal mitigation detail, not a user-facing checklist step.
    report.log("flash", locale.t.roms.install.logConfirmingLinkResponsive);
    await new Promise((r) => setTimeout(r, 500));
    if (device.transport) {
      await raceWithFallback(isStubAlive(device.transport), 2500, false);
    }

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
        (d, t) => report.progress("flash", d, t, "Games, BIOS, languages → ext", "frogfs"),
        log,
      );
    } finally {
      device.resumePoll();
    }
    report.subFinish("flash", "frogfs");
    report.finish("flash");

    report.start("rescan");
    report.log("rescan", locale.t.roms.install.logRescanning);
    // FrogFS changed → rescan device geometry + installed games, then re-read cheats/ so the
    // next diff has a fresh baseline (installedFrogfs must be repopulated first).
    void device.runScan().then(() => loadCheatsBaseline());
    report.finish("rescan");
  }
</script>

<section class="roms">
  {#if !nativeFolderPickerSupported() && !dismissedFirefoxWarning}
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
  {/if}

  <!-- 1. Select games — the folder ∪ device list; choose what to install. -->
  <div class="group">
    <div class="layered-panel">
      {#if !roms.selected}
        <div class="gate-empty">
          <p>{locale.t.roms.selectGames.gateBody}</p>
          <button class="action" onclick={() => roms.ensureFolders(device.targetMedia === "sd").catch(() => {})}>
            {locale.t.roms.selectGames.gateButton}
          </button>
        </div>
      {:else}
        <div class="seltable">
          <!-- Console filter (single-select, incl. All). -->
          <div class="consoles">
            <button class="console" class:active={consoleFilter === "all"} onclick={() => (consoleFilter = "all")}>
              {locale.t.roms.selectGames.allFilterLabel(romSelection.games.length + HOMEBREW_TITLES.length + unknownHomebrew.length)}
            </button>
            {#each romSelection.systems as s (s.system)}
              <button class="console" class:active={consoleFilter === s.system} onclick={() => (consoleFilter = s.system)}>
                {s.label} ({s.count})
              </button>
            {/each}
            <button class="console" class:active={consoleFilter === "homebrew"} onclick={() => (consoleFilter = "homebrew")}>
              {locale.t.roms.selectGames.homebrewFilterLabel(HOMEBREW_TITLES.length + unknownHomebrew.length)}
            </button>
          </div>

          <div class="two-pane" class:collapsed={listCollapsed}>
            <div class="left-column">
              <div class="games-pane">
                <div class="games-pane-header" style={listCollapsed ? "flex-direction: column; align-items: center; justify-content: start; gap: 1rem; padding: 0.5rem 0;" : ""}>
                  {#if !listCollapsed}
                    <h2>{locale.t.roms.selectGames.gamesHeading}</h2>
                  {/if}
                  <div style="display: flex; gap: 0.5rem; flex-direction: {listCollapsed ? 'column' : 'row'};">
                    <button class="folder-btn" title={listCollapsed ? locale.t.roms.selectGames.expandListTitle : locale.t.roms.selectGames.collapseListTitle} onclick={() => listCollapsed = !listCollapsed} style="padding: 4px;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        {#if listCollapsed}
                          <polyline points="13 17 18 12 13 7"></polyline>
                          <polyline points="6 17 11 12 6 7"></polyline>
                        {:else}
                          <polyline points="11 17 6 12 11 7"></polyline>
                          <polyline points="18 17 13 12 18 7"></polyline>
                        {/if}
                      </svg>
                    </button>
                    <button class="folder-btn" title={locale.t.roms.selectGames.changeFoldersTitle} onclick={() => roms.openFolderGate(device.targetMedia === "sd").catch(() => {})} style="padding: 4px;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                  </div>
                </div>
                
                {#if !listCollapsed}
                  <div class="selctrls">
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
                        if (!romSelection.isSelected(g.key)) {
                          extraBytes += g.size;
                          toggles.push(() => romSelection.toggle(g.key));
                        }
                      }
                    }
                    if (extraBytes > 0 && !validateFit(extraBytes)) return;
                    toggles.forEach(t => t());
                  }}>{locale.t.roms.selectGames.selectAll}</button>
                  <button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        if (romSelection.isHomebrewSelected(g.hb.key)) romSelection.toggleHomebrew(g.hb.key, true);
                      } else {
                        if (romSelection.isSelected(g.key)) romSelection.toggle(g.key);
                      }
                    }
                  }}>{locale.t.roms.selectGames.unselectAll}</button>
                </div>

                <div class="rows">
              {#each visibleGames as g (g.key)}
                {@const state = getActionState(g)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div 
                  class="row {selectedCarouselId === g.key ? 'active' : ''}"
                  style={state.disabled ? "opacity: 0.5; cursor: not-allowed;" : ""}
                  onclick={() => { selectedCarouselId = g.key; }}
                >
                  {#if consoleFilter === "all"}
                    <span class="gchip console-chip">{g.system === 'homebrew' ? locale.t.roms.selectGames.homebrewChip : g.system.toUpperCase()}</span>
                  {/if}
                  <span class="gname">{g.name.replace(/\.[^/.]+$/, "")}</span>
                  <button class="gchip {state.cls}" disabled={state.disabled} style={!state.disabled ? "cursor: pointer; border: none;" : "border: none;"} onclick={(e) => { 
                    e.stopPropagation(); 
                    if (state.label === 'install' || state.label === 'not installed') {
                      const extraBytes = g.isHomebrew ? getHomebrewSize(g.hb.key) : g.size;
                      if (!validateFit(extraBytes)) return;
                    }
                    state.action(e);
                  }}>{actionLabelText(state.label)}</button>
                </div>
                {#if g.isHomebrew && extractError && extracting.size === 0 && !(['installed', 'install', 'not installed', 'uninstall'].includes(state.label))}
                  <p class="error" style="margin: 0; padding: 0 0 0.5rem 1.5rem; font-size: 0.8rem;">{locale.t.roms.selectGames.errorPrefix(extractError)}</p>
                {/if}
              {/each}
              
              {#if consoleFilter === "all" || consoleFilter === "homebrew"}
                {#each unknownHomebrew as g (g.name)}
                  <div class="row">
                    <span class="gname mono">{g.name}</span>
                    <button class="gchip muted" style="cursor: pointer; border: none; background: transparent;" onclick={(e) => {
                      e.preventDefault();
                      romSelection.removeUnknownHomebrew(g.name);
                    }}>{locale.t.roms.selectGames.removeButton}</button>
                  </div>
                {/each}
              {/if}

              {#if visibleGames.length === 0 && (consoleFilter !== "all" && consoleFilter !== "homebrew")}
                <p class="note">{locale.t.roms.selectGames.noFilterMatch}</p>
              {/if}
                </div>
              {/if}

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
                    <h3 class="info-title" style="text-align: center;">{activeGame.name.replace(/\.[^/.]+$/, "")}</h3>
                    <div class="info-details" style="justify-content: center; margin-top: 0.25rem;">
                      <span class="info-tag">{activeGame.system === 'homebrew' ? locale.t.roms.selectGames.homebrewTag : activeGame.system.toUpperCase()}</span>
                      <span class="info-size mono">{activeGame.size > 0 ? size(activeGame.size) : '—'}</span>
                      <span class="info-filename" style="color: var(--ink-soft); font-size: 0.8rem; border-left: 1px solid var(--hairline); padding-left: 0.5rem;">{activeGame.name}</span>
                      {#if state && state.label !== 'missing rom'}
                        <button class="gchip {state.cls}" disabled={state.disabled} style="margin-left: 0.5rem; border: none; font-size: 0.75rem; cursor: {state.disabled ? 'not-allowed' : 'pointer'};" onclick={(e) => { 
                          e.stopPropagation(); 
                          if (state.label === 'install' || state.label === 'not installed') {
                            const extraBytes = activeGame.isHomebrew ? getHomebrewSize(activeGame.hb.key) : activeGame.size;
                            if (!validateFit(extraBytes)) return;
                          }
                          state.action(e);
                        }}>{actionLabelText(state.label)}</button>
                      {/if}
                    </div>
                  </div>
                {:else if activeHb}
                  <div class="info-content">
                    <h3 class="info-title" style="text-align: center;">{activeHb.name.replace(/\.[^/.]+$/, "")}</h3>
                    <div class="info-details" style="justify-content: center; margin-top: 0.25rem;">
                      <span class="info-tag">{locale.t.roms.selectGames.unknownHomebrewTag}</span>
                      <span class="info-size mono">{activeHb.size > 0 ? size(activeHb.size) : '—'}</span>
                      <span class="info-filename" style="color: var(--ink-soft); font-size: 0.8rem; border-left: 1px solid var(--hairline); padding-left: 0.5rem;">{activeHb.name}</span>
                      <button class="gchip caution" style="margin-left: 0.5rem; border: none; font-size: 0.75rem; cursor: pointer;" onclick={(e) => { e.preventDefault(); romSelection.removeUnknownHomebrew(activeHb.name); }}>{locale.t.roms.selectGames.removeButton}</button>
                    </div>
                  </div>
                {:else}
                  <div class="info-empty">{locale.t.roms.selectGames.infoEmpty}</div>
                {/if}
              {:else}
                <div class="info-empty">{locale.t.roms.selectGames.infoEmpty}</div>
              {/if}
            </div>
          </div>
          </div> <!-- two-pane -->

          <!-- Game Details Panel spanning below carousel & list -->
          {#if selectedCarouselId}
            {@const activeGame = visibleGames.find(g => g.key === selectedCarouselId)}
            {@const activeHb = !activeGame ? unknownHomebrew.find(g => g.name === selectedCarouselId) : null}
            {#if activeGame}
              <GameDetailsPanel 
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
                gameKey={activeHb.name}
                gameName={activeHb.name}
                system="homebrew"
                coverUrl={getCoverUrl(activeHb.name, coverVersion)}
                bind:configuredCheats
                bind:configuredCheatFiles
                onCoverChange={() => { coverUrls.clear(); coverVersion++; }}
              />
            {/if}
          {/if}


          <div>
            {#if device.targetMedia === "sd"}
              <!-- SD mode: no device connection or partition check; space from SD handle scan.
                   One united list: the before/after space story (what's actually on the card
                   now vs. what it'll be after this sync) and the per-category diff rows Flash
                   mode also uses, all in the same StatPanel — not two separately-boxed,
                   unrelated-looking numbers. -->
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
              <div style="margin-top: 1rem;">
                <StatPanel rows={sdSummaryRows} variant="card" />
              </div>

              <div class="navrow" style="margin-top: 1rem; justify-content: flex-end;">
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
                  <div style="display: flex; gap: 0.5rem; align-items: center;">
                    {#if nativeFolderPickerSupported()}
                      <button
                        class="action primary"
                        disabled={!device.sdReady || !sdSyncHasChanges}
                        title={sdSyncHasChanges ? undefined : locale.t.roms.sdSync.nothingToSyncTitle}
                        onclick={openSdSync}
                      >
                        {locale.t.roms.sdSync.syncButton}
                      </button>
                    {:else}
                      <button
                        class="action primary"
                        disabled={!sdSyncHasChanges}
                        title={sdSyncHasChanges ? undefined : locale.t.roms.sdSync.nothingToSyncTitle}
                        onclick={openSdSync}
                      >
                        {locale.t.roms.sdSync.downloadZipButton}
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <!-- Flash mode: device connection + partition checks -->
              {#if !device.isConnected}
                <p class="note" style="margin-top: 0.5rem;">{locale.t.roms.install.connectPrompt}</p>
              {:else if !partitionsKnown}
                <p class="note" style="margin-top: 0.5rem;">
                  {device.scanning ? locale.t.roms.install.scanningDevice : locale.t.roms.install.scanDevicePrompt}
                </p>
              {:else if !baseInstalled}
                <p class="note" style="margin-top: 0.5rem;">{locale.t.roms.install.installFirstPrompt}</p>
              {:else}
                <InstallGeometry
                  partitions={device.partitions}
                  extSize={device.extFlashBytes}
                  {frogfsOffset}
                  newFrogfsLen={newFrogfsLen ?? currentEstSize}
                  {changedFromOffset}
                  title=""
                />
                <ChangeSummary items={summaryItems} />
                {#if building}<p class="note" style="margin-top: 0.5rem;">{locale.t.roms.install.calculatingLayout}</p>{/if}
                {#if buildErr}<p class="err" style="margin-top: 0.5rem;">{buildErr}</p>{/if}

                <label class="lzma" style="margin-top: 1rem;">
                  <input type="checkbox" disabled checked={false} />
                  {locale.t.roms.install.lzmaCheckboxLabel}<span class="soon">{locale.t.roms.install.lzmaSoon}</span>
                </label>

                <div class="navrow" style="margin-top: 1.5rem; justify-content: flex-end;">
                  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                      <button
                        class="action primary"
                        disabled={!canInstallRoms || building || !fitsGap}
                        onclick={handleInstallClick}
                      >
                        {locale.t.roms.install.installButton}
                      </button>
                    </div>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>


{#if spaceAlertMessage}
  <ModalShell onDismiss={() => spaceAlertMessage = null} borderColor="var(--danger, #d32f2f)" zIndex={200}>
    {#snippet children()}
      <h3 style="margin-top: 0; font-size: var(--fs-lg); color: var(--danger, #d32f2f);">{locale.t.roms.spaceAlert.title}</h3>
      <p style="color: var(--ink-soft);">{spaceAlertMessage}</p>
      <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
        <button class="action primary" onclick={() => spaceAlertMessage = null}>{locale.t.roms.spaceAlert.ok}</button>
      </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  .roms {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
  }
  .subhead {
    margin: 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink-soft);
  }
  /* Select-games table */
  .seltable {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .consoles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .console {
    font: inherit;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    background: var(--surface-sunk);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
    cursor: pointer;
  }
  .console.active {
    background: var(--surface);
    color: var(--ink);
    border-color: var(--model-accent);
    font-weight: 600;
  }
  .selctrls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-size: var(--fs-caption);
  }
  .missing {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--ink-soft);
  }
  .rows {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.25rem 0.5rem;
    font-size: var(--fs-caption);
    border-bottom: 1px solid var(--surface-sunk);
  }
  .row:last-child {
    border-bottom: none;
  }
  .gname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink);
  }
  .gsize {
    color: var(--ink-soft);
    font-size: var(--fs-micro);
    width: 4.5rem;
    text-align: right;
    flex-shrink: 0;
  }
  .gchip {
    font-size: var(--fs-micro);
    font-weight: 600;
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    white-space: nowrap;
    min-width: 5rem;
    text-align: center;
    flex-shrink: 0;
    display: inline-block;
  }
  .gchip.installed {
    color: #fff;
    background: var(--zelda-green);
  }
  .gchip.new {
    color: #fff;
    background: #007bff;
    border: none;
  }
  .gchip.ondevice {
    color: #161616;
    background: var(--caution);
  }
  .gchip.ok {
    color: #fff;
    background: var(--zelda-green);
  }
  .gchip.warn {
    color: #161616;
    background: var(--caution);
  }
  .gchip.muted {
    color: var(--ink-soft);
    background: var(--surface-sunk);
  }
  .gchip.uninstall {
    color: #161616;
    background: var(--caution, #d32f2f);
  }
  .console-chip {
    width: 3rem;
    min-width: 3rem;
    text-transform: uppercase;
    background: #333;
    color: #fff;
    margin-right: 0.5rem;
    border-radius: 4px;
    font-size: var(--fs-micro);
  }
  .homebrew {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-top: 1px solid var(--surface-sunk);
    padding-top: 0.5rem;
  }
  .hbhead {
    margin: 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  .homebrew-dropdown {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .hbnote {
    font-weight: 400;
    color: var(--ink-soft);
  }
  .dim {
    color: var(--ink-soft);
  }
  .hbrow {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.25rem 0;
  }
  .hbrow:not(:last-child) {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .delta {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .layered-panel {
    background: var(--surface);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    padding: 1rem;
    border: 1px solid var(--surface-sunk);
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    background: var(--surface);
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.7rem 0.9rem;
  }
  .installroms {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .geo {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.25rem 0;
  }
  .lzma {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .head {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink);
  }
  .desc {
    margin: 0;
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
  .ok {
    margin: 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--zelda-green);
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
    color: var(--ink);
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
  .flashlog {
    margin: 0.5rem 0 0;
    max-height: 11rem;
    overflow: auto;
    font-size: var(--fs-micro);
    line-height: 1.35;
    color: var(--ink-soft);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.5rem 0.65rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .navrow {
    display: flex;
    justify-content: flex-start;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-sunk);
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
  .link {
    font: inherit;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    background: transparent;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .two-pane {
    display: grid;
    grid-template-columns: 350px 1fr;
    gap: 1rem;
    height: 500px;
    transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .two-pane.collapsed {
    grid-template-columns: 48px 1fr;
  }
  .left-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
    overflow: hidden;
  }
  .games-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--r-card);
    border: 1px solid var(--surface-sunk);
    overflow: hidden;
  }
  .info-pane {
    flex-shrink: 0;
    height: 80px;
    background: var(--surface);
    border-radius: var(--r-card);
    border: 1px solid var(--surface-sunk);
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
  .info-title {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
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
  .info-tag {
    font-size: var(--fs-micro);
    font-weight: 600;
    text-transform: uppercase;
    background: #333;
    color: #fff;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }
  .info-size {
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
    align-items: center;
    padding: 0.5rem 1rem;
    background: var(--bg-soft);
    border-bottom: 1px solid var(--border-light);
  }
  .games-pane-header h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .folder-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }
  .folder-btn:hover { background: var(--bg-hover); }
  .action-btn {
    flex: 1;
    padding: 0.5rem;
    background: var(--bg-soft);
    border: 1px solid var(--border-light);
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.1s;
  }
  .action-btn:hover { background: var(--bg-hover); }
  .carousel-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
</style>
