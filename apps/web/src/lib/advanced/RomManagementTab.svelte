<script lang="ts">
  // Tab — ROM Management. Three drop-downs, top → bottom:
  //   1. Select games  — the folder ∪ device game list; pick what to install (drives Install ROMs).
  //   2. Library Extras — per-game enrichments (cover art, saves, cheats).
  //   3. Install ROMs   — version-agnostic FrogFS repack from the SELECTION (non-destructive).
  // The ROM FOLDER is OPTIONAL. The on-device games come from device.installedGames (FrogFS read).
  // See memory: romgr-install-architecture.
  import { roms } from "../roms.svelte.js";
  import { nativeFolderPickerSupported } from "../romScan.js";
  import { device } from "../device.svelte.js";
  import { romSelection, type Game } from "../romSelection.svelte.js";
  import { buildFrogfsImage, flashFrogfsRegion, BudgetError } from "../engine/flashInstall.js";
  import { readGameData } from "../engine/frogfsDevice.js";
  import { homebrewStatus, HOMEBREW_DEVICE_FILES, HOMEBREW_TITLES } from "../engine/homebrew.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { dbg, dbgLog } from "../debug.js";
  import { extractHomebrewAssets } from "@gnw/gnw-restool";
  import restoolsZipUrl from "@gnw/gnw-restool/dist/restools.zip?url";
  import { listVersions, fetchBundle } from "../artifacts.js";
  import AccordionSection from "./AccordionSection.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import InstallGeometry from "../ui/InstallGeometry.svelte";
  import ChangeSummary, { type ChangeItem } from "../ui/ChangeSummary.svelte";
  import Carousel from "../ui/Carousel.svelte";
  import GameDetailsPanel from "./GameDetailsPanel.svelte";
  import JSZip from "jszip";

  let dismissedFirefoxWarning = $state(false);
  let configuredCheats = $state<Record<string, string[]>>({});

  let lastCheatsScan = $state<unknown>(null);
  $effect(() => {
    if (roms.scan && roms.scan !== lastCheatsScan) {
      lastCheatsScan = roms.scan;
      const parsed: Record<string, string[]> = {};
      const decoder = new TextDecoder();
      for (const [path, data] of roms.scan.userRoms) {
        if (path.endsWith(".ggcodes") || path.endsWith(".mcf") || path.endsWith(".pceplus")) {
          let system = "";
          let baseName = "";
          const parts = path.split("/");
          if (path.startsWith("cheats/") && parts.length >= 3) {
            system = parts[1];
            baseName = parts.slice(2).join("/").replace(/\.[^/.]+$/, "");
          } else if (parts.length >= 2) {
            system = parts[0];
            baseName = parts.slice(1).join("/").replace(/\.[^/.]+$/, "");
          }
          if (system && baseName) {
            const game = romSelection.games.find(g => 
              g.system === system && g.name.replace(/\.[^/.]+$/, "") === baseName
            );
            if (game) {
              try {
                const text = decoder.decode(data);
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                parsed[game.key] = lines;
              } catch (e) {}
            }
          }
        }
      }
      configuredCheats = parsed;
    }
  });

  const EXTBASE = 0x90000000;
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
  const canInstallRoms = $derived(device.isConnected && baseInstalled);

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
    ...Object.entries(configuredCheats).map(([k, v]) => `${k}:${v.join(",")}`)
  ].sort().join("|"));
  const previewWanted = $derived(openSet.has("select-games") || openSet.has("install-roms"));

  $effect(() => {
    if (!previewWanted || !device.isConnected || !baseInstalled) return;
    if (builtFrogfs && builtFor === selSig) return; // cache hit
    void buildPreview(selSig);
  });

  function injectCheats(map: Map<string, Uint8Array>) {
    for (const [key, cheats] of Object.entries(configuredCheats)) {
      if (cheats.length === 0) continue;
      const [system, ...nameParts] = key.split("/");
      const name = nameParts.join("/");
      const cheatExts: Record<string, string> = {
        nes: "ggcodes", gb: "ggcodes", gbc: "ggcodes", 
        snes: "ggcodes", md: "ggcodes", gen: "ggcodes", gg: "ggcodes",
        pce: "pceplus", msx: "mcf"
      };
      const ext = cheatExts[system] || "ggcodes";
      const noExtName = name.replace(/\.[^/.]+$/, "");
      const cheatContent = cheats.map(c => c.split(',')[0].trim()).join("\n") + "\n";
      map.set(`cheats/${system}/${noExtName}.${ext}`, new TextEncoder().encode(cheatContent));
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
    if (newFrogfsLen === null) return null;
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

  const fitsGap = $derived(
    newFrogfsLen === null || ceilingOffset === null ? true : frogfsOffset + newFrogfsLen <= ceilingOffset,
  );

  // --- Install ROMs -----------------------------------------------------------------------
  let installModal = $state(false);
  let installing = $state(false);
  let installErr = $state<string | null>(null);
  let installed = $state(false);
  let flashLog = $state<string[]>([]); // surfaced so a stall is visible (last line = where it's stuck)
  
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

  const summaryItems = $derived.by<ChangeItem[]>(() => {
    const sel = romSelection.selectedKeys.size;
    const hbSel = romSelection.selectedHomebrewKeys.size;
    const sz = newFrogfsLen !== null ? `${MiB(newFrogfsLen)} MiB (raw)` : building ? "calculating…" : "—";
    
    let hbDetail = "No changes";
    if (hbAdditions > 0 || hbRemovals > 0) {
      hbDetail = `+${hbAdditions} add · −${hbRemovals} remove`;
    }
    
    let netChangeStr = "";
    if (newFrogfsLen !== null && currentFrogfsLen !== null) {
      const net = newFrogfsLen - currentFrogfsLen;
      if (net > 0) netChangeStr = ` (+${MiB(net)} MiB net)`;
      else if (net < 0) netChangeStr = ` (${MiB(net)} MiB net)`;
      else netChangeStr = " (no net size change)";
    }

    const numCheatGames = Object.values(configuredCheats).filter(c => c.length > 0).length;
    let numCovers = 0;
    for (const key of (roms.scan?.userRoms?.keys() ?? [])) {
      if (key.startsWith("covers/") && key.endsWith(".img")) numCovers++;
    }

    return [
      {
        label: "Total ROMs & Ports (FrogFS)",
        status: `${sel + hbSel} items · ${sz}`,
        kind: fitsGap ? "info" : "warn",
        detail: fitsGap
          ? `+${romSelection.additions.length + hbAdditions} items added · −${romSelection.removals.length + hbRemovals} items removed${netChangeStr}`
          : "Won't fit the FrogFS gap — deselect some games.",
      },
      {
        label: "Homebrew & Ports",
        status: `${hbSel} selected`,
        kind: hbSel > 0 ? "info" : "muted",
        detail: hbDetail,
      },
      {
        label: "Cover art",
        status: numCovers > 0 ? `${numCovers} ready` : "None found",
        kind: numCovers > 0 ? "ok" : "muted"
      },
      { label: "Saves", status: "Preserved — LittleFS untouched", kind: "ok" },
      { 
        label: "Cheats", 
        status: numCheatGames > 0 ? `${numCheatGames} games configured` : "None configured", 
        kind: numCheatGames > 0 ? "info" : "muted" 
      },
      { label: "Compression", status: "Uncompressed (raw, XiP)", kind: "info" },
    ];
  });

  const installBody = $derived(
    `Repacks the games (FrogFS) at ${hex(EXTBASE + frogfsOffset)} from your selection. Saves and ` +
      `emulator cores (LittleFS) are NOT touched. Don't unplug the device until it finishes.`,
  );

  async function runInstall(
    report: (d: number, t: number, sub?: { value: number; max: number; label: string }) => void,
  ): Promise<void> {
    flashLog = [];
    const log = dbgLog("flash", (m) => (flashLog = [...flashLog, m]));
    dbg("[install] start", { frogfsOffset: hex(frogfsOffset), ceiling: hex(ceilingOffset ?? 0), eraseBlock, extBytes: device.extFlashBytes });
    dbg("[install] ensureStub…");
    const flasher = await device.ensureStub();
    dbg("[install] stub ready");
    const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);
    const userRoms = romSelection.selectedFolderRoms();
    dbg("[install] folder roms:", userRoms.size, "retained:", romSelection.retainedFromDevice.length);
    // Preserve on-device-only selected games by re-reading their bytes from the device FrogFS.
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
    // Reuse the cached preview only when nothing had to be re-read from the device and it's current.
    const preserved = retained.length > 0 || deviceHomebrew.length > 0;
    let frogfs = !preserved && builtFrogfs && builtFor === selSig ? builtFrogfs : null;
    if (!frogfs) {
      const versions = await listVersions();
      if (versions.length === 0) throw new Error("No firmware versions are published yet.");
      const bundle = await fetchBundle(versions[0].tag);
      for (const [k, v] of extractedAssets.entries()) userRoms.set(k, v);
      injectCheats(userRoms);
      frogfs = (await buildFrogfsImage(bundle, userRoms, { 
        installAllCores,
        selectedHomebrew: romSelection.selectedHomebrewKeys,
        homebrewTitles: HOMEBREW_TITLES
      })).frogfs;
    }
    dbg("[install] frogfs built:", frogfs.length, "bytes → flashing @", hex(frogfsOffset));
    await flashFrogfsRegion(
      flasher,
      frogfs,
      { frogfsOffset, ceilingOffset: ceilingOffset! },
      (d, t) => report(d, t, { value: d, max: t, label: "FrogFS → ext" }),
      log,
    );
  }
</script>

<section class="roms">
  {#if !roms.selected}
    <p class="intro">
      Manage your games. A <strong>ROM folder</strong> is required to manage games and install them to the device.
    </p>
  {/if}

  {#if !nativeFolderPickerSupported() && !dismissedFirefoxWarning}
    <div style="background: var(--surface-sunk); border: 1px solid var(--caution); padding: 0.75rem; border-radius: var(--r-card); margin-bottom: 1rem; position: relative;">
      <button 
        aria-label="Dismiss warning"
        onclick={() => dismissedFirefoxWarning = true} 
        style="position: absolute; top: 0.5rem; right: 0.5rem; background: none; border: none; color: var(--caution); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <p class="note" style="margin: 0; color: var(--caution); padding-right: 1.5rem;">
        <strong>Firefox is only partially supported.</strong> Firefox doesn't allow for easily saving covers next to ROM files, so the only option is to export all covers to a zip file. To save downloaded/imported covers directly, please use Chromium, Chrome, Edge, etc instead.
      </p>
    </div>
  {/if}

  <div class="folder">
    {#if !roms.selected}
      <button class="action" disabled={!roms.supported || roms.scanning} onclick={() => roms.pickFolder()}>
        {roms.scanning ? "Scanning…" : "Select ROM folder (required)"}
      </button>
      {#if roms.pendingHandle}
        <button class="link" onclick={() => roms.reconnect()}>Reconnect last ROM folder</button>
      {/if}
      
      {#if roms.error}<p class="err">{roms.error}</p>{/if}
    {/if}
  </div>
  <!-- 1. Select games — the folder ∪ device list; choose what to install. -->
  <div class="group">
    <div class="layered-panel">
      {#if !roms.selected}
        <p class="note">
          Select a ROM folder above to choose games.
        </p>
      {:else}
        <div class="seltable">
          <!-- Console filter (single-select, incl. All). -->
          <div class="consoles">
            <button class="console" class:active={consoleFilter === "all"} onclick={() => (consoleFilter = "all")}>
              All ({romSelection.games.length + HOMEBREW_TITLES.length + unknownHomebrew.length})
            </button>
            {#each romSelection.systems as s (s.system)}
              <button class="console" class:active={consoleFilter === s.system} onclick={() => (consoleFilter = s.system)}>
                {s.label} ({s.count})
              </button>
            {/each}
            <button class="console" class:active={consoleFilter === "homebrew"} onclick={() => (consoleFilter = "homebrew")}>
              Homebrew ({HOMEBREW_TITLES.length + unknownHomebrew.length})
            </button>
          </div>

          <div class="two-pane">
            <div class="left-column">
              <div class="games-pane">
                <div class="games-pane-header">
                  <h2>Games</h2>
                  <button class="folder-btn" title="Change ROM Folder" onclick={() => roms.pickFolder()}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                  </button>
                </div>
                
                <div class="selctrls">
                  <button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        const state = getActionState(g);
                        if (state.label === 'prepare') state.action();
                        else if (state.label === 'not installed') romSelection.toggleHomebrew(g.hb.key, false);
                      } else {
                        if (!romSelection.isSelected(g.key)) romSelection.toggle(g.key);
                      }
                    }
                  }}>Select All</button>
                  <button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        if (romSelection.isHomebrewSelected(g.hb.key)) romSelection.toggleHomebrew(g.hb.key, true);
                      } else {
                        if (romSelection.isSelected(g.key)) romSelection.toggle(g.key);
                      }
                    }
                  }}>Unselect All</button>
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
                    <span class="gchip console-chip">{g.system === 'homebrew' ? 'HB' : g.system.toUpperCase()}</span>
                  {/if}
                  <span class="gname">{g.name.replace(/\.[^/.]+$/, "")}</span>
                  <button class="gchip {state.cls}" disabled={state.disabled} style={!state.disabled ? "cursor: pointer; border: none;" : "border: none;"} onclick={(e) => { e.stopPropagation(); state.action(e); }}>{state.label}</button>
                </div>
                {#if g.isHomebrew && extractError && extracting.size === 0 && !(['installed', 'install', 'not installed', 'uninstall'].includes(state.label))}
                  <p class="error" style="margin: 0; padding: 0 0 0.5rem 1.5rem; font-size: 0.8rem;">Error: {extractError}</p>
                {/if}
              {/each}
              
              {#if consoleFilter === "all" || consoleFilter === "homebrew"}
                {#each unknownHomebrew as g (g.name)}
                  <div class="row">
                    <span class="gname mono">{g.name}</span>
                    <button class="gchip muted" style="cursor: pointer; border: none; background: transparent;" onclick={(e) => {
                      e.preventDefault();
                      romSelection.removeUnknownHomebrew(g.name);
                    }}>remove</button>
                  </div>
                {/each}
              {/if}

              {#if visibleGames.length === 0 && (consoleFilter !== "all" && consoleFilter !== "homebrew")}
                <p class="note">No games match this filter.</p>
              {/if}
                </div>

          <p class="delta" style="padding: 1rem; border-top: 1px solid var(--surface-sunk); background: var(--surface); text-align: center;">
            <span style="color: {(romSelection.additions.length + hbAdditions) > 0 ? '#007bff' : 'var(--ink-soft)'}"><strong>+{(romSelection.additions.length + hbAdditions)}</strong> add ({MiB(romSelection.additionsBytes + hbAdditionsBytes)} MiB)</span>
            <span style="color: var(--ink-soft)"> · </span>
            <span style="color: {(romSelection.removals.length + hbRemovals) > 0 ? 'var(--caution, #d32f2f)' : 'var(--ink-soft)'}"><strong>−{(romSelection.removals.length + hbRemovals)}</strong> remove ({MiB(romSelection.removalsBytes + hbRemovalsBytes)} MiB)</span>
          </p>
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
                      <span class="info-tag">{activeGame.system === 'homebrew' ? 'HOMEBREW' : activeGame.system.toUpperCase()}</span>
                      <span class="info-size mono">{activeGame.size > 0 ? size(activeGame.size) : '—'}</span>
                      <span class="info-filename" style="color: var(--ink-soft); font-size: 0.8rem; border-left: 1px solid var(--hairline); padding-left: 0.5rem;">{activeGame.name}</span>
                      {#if state && state.label !== 'missing rom'}
                        <button class="gchip {state.cls}" disabled={state.disabled} style="margin-left: 0.5rem; border: none; font-size: 0.75rem; cursor: {state.disabled ? 'not-allowed' : 'pointer'};" onclick={(e) => { e.stopPropagation(); state.action(e); }}>{state.label}</button>
                      {/if}
                    </div>
                  </div>
                {:else if activeHb}
                  <div class="info-content">
                    <h3 class="info-title" style="text-align: center;">{activeHb.name.replace(/\.[^/.]+$/, "")}</h3>
                    <div class="info-details" style="justify-content: center; margin-top: 0.25rem;">
                      <span class="info-tag">UNKNOWN HOMEBREW</span>
                      <span class="info-size mono">{activeHb.size > 0 ? size(activeHb.size) : '—'}</span>
                      <span class="info-filename" style="color: var(--ink-soft); font-size: 0.8rem; border-left: 1px solid var(--hairline); padding-left: 0.5rem;">{activeHb.name}</span>
                      <button class="gchip caution" style="margin-left: 0.5rem; border: none; font-size: 0.75rem; cursor: pointer;" onclick={(e) => { e.preventDefault(); romSelection.removeUnknownHomebrew(activeHb.name); }}>remove</button>
                    </div>
                  </div>
                {:else}
                  <div class="info-empty">Select a game to see details</div>
                {/if}
              {:else}
                <div class="info-empty">Select a game to see details</div>
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
                onCoverChange={() => { coverUrls.clear(); coverVersion++; }}
              />
            {:else if activeHb}
              <GameDetailsPanel 
                gameKey={activeHb.name} 
                gameName={activeHb.name} 
                system="homebrew" 
                coverUrl={null} 
                bind:configuredCheats 
                onCoverChange={() => { coverUrls.clear(); coverVersion++; }}
              />
            {/if}
          {/if}


          <div style="margin-top: 2.5rem; margin-bottom: 0;">
            {#if !device.isConnected}
              <p class="note" style="margin-top: 0.5rem;">Connect a device to install ROMs.</p>
            {:else if !partitionsKnown}
              <p class="note" style="margin-top: 0.5rem;">
                {device.scanning ? "Scanning the device…" : "Scan the device to detect its partitions."}
              </p>
            {:else if !baseInstalled}
              <p class="note" style="margin-top: 0.5rem;">Install Retro-Go first — no LittleFS partition found on this device.</p>
            {:else}
              <p class="note" style="margin-top: 0.5rem;">FrogFS gap: {MiB(ceilingOffset! - frogfsOffset)} MiB available (up to LittleFS).</p>
              <InstallGeometry
                partitions={device.partitions}
                extSize={device.extFlashBytes}
                {frogfsOffset}
                {newFrogfsLen}
                {changedFromOffset}
                title="Extflash layout (existing vs. changes)"
              />
              <ChangeSummary items={summaryItems} />
              {#if building}<p class="note" style="margin-top: 0.5rem;">Calculating layout…</p>{/if}
              {#if buildErr}<p class="err" style="margin-top: 0.5rem;">{buildErr}</p>{/if}

              <label class="lzma" style="margin-top: 1rem;">
                <input type="checkbox" disabled checked={false} />
                Compress ROMs with LZMA <span class="soon">uncompressed for now</span>
              </label>

              <div class="navrow" style="margin-top: 1.5rem; justify-content: flex-end;">
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
                  <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button
                      class="action primary"
                      disabled={!canInstallRoms || installing || building || !fitsGap}
                      onclick={() => (installModal = true)}
                    >
                      {installing ? "Installing…" : "Install ROMs"}
                    </button>
                  </div>
                  {#if installed}<p class="ok">✓ ROMs installed.</p>{/if}
                  {#if installErr}<p class="err">{installErr}</p>{/if}
                </div>
              </div>
              {#if flashLog.length}
                <pre class="flashlog" style="margin-top: 1rem;">{flashLog.slice(-12).join("\n")}</pre>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>

<ConfirmModal
  open={installModal}
  title="Install ROMs?"
  body={installBody}
  danger
  confirmText="Install"
  run={async (report) => {
    installing = true;
    installErr = null;
    installed = false;
    onRunning("install-roms", true);
    try {
      await runInstall(report);
      installed = true;
      void device.runScan(); // FrogFS changed → rescan device geometry + installed games
    } catch (e) {
      installErr = e instanceof BudgetError ? e.message : e instanceof Error ? e.message : String(e);
      dbg("[install] ERROR:", installErr);
      throw e;
    } finally {
      installing = false;
      onRunning("install-roms", false);
    }
  }}
  onClose={() => (installModal = false)}
>
  {#snippet summary()}
    <ChangeSummary items={summaryItems} />
  {/snippet}
  {#snippet detail()}
    {#if flashLog.length}<pre class="flashlog">{flashLog.slice(-14).join("\n")}</pre>{/if}
  {/snippet}
</ConfirmModal>

<style>
  .roms {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .intro {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .folder {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .picked {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-size: var(--fs-caption);
    color: var(--ink);
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
    width: 5rem;
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
