<script module lang="ts">
  // Module-level (not per-instance) so it survives this component being torn down and
  // recreated — which happens whenever selectedCarouselId transiently clears (e.g. the
  // currently-selected game leaving the filtered list on a console-filter change, or any
  // other selection churn in RomManagementTab.svelte). A plain instance-scoped $state or
  // native <details> DOM state would silently reset to closed on every one of those remounts.
  let additionalOptionsOpen = $state(false);
</script>

<script lang="ts">
  import { fade, slide } from "svelte/transition";
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { runCovers } from "../screenscraper/run.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import { MCF_WHOLE_FILE_SYSTEMS, findMcfPreset, mcfAssetUrl, loadCheatsForSystem, normalizeTitle, type Cheat, type CheatGame } from "../cheats/index.js";
  import { onMount } from "svelte";
  import { HOMEBREW_TITLES } from "../engine/homebrew.js";
  import { romSelection } from "../romSelection.svelte.js";
  import { roms } from "../roms.svelte.js";
  import { systemIdsFor } from "../screenscraper/config.js";
  import { saveFileToDirOrDownload, nativeFolderPickerSupported } from "../romScan.js";
  import { obfuscate, deobfuscate } from "../localCrypt.js";
  import { download } from "../util.js";
  import JSZip from "jszip";

  let {
    gameKey,
    gameName,
    system,
    coverUrl,
    configuredCheats = $bindable({}),
    configuredCheatFiles = $bindable({}),
    onCoverChange
  }: {
    gameKey: string;
    gameName: string;
    system: string;
    coverUrl: string | null;
    configuredCheats: Record<string, string[]>;
    configuredCheatFiles: Record<string, Uint8Array>;
    onCoverChange?: () => void;
  } = $props();

  // Firmware only applies cheats on GB/GBC/NES/PCE (line-based Game Genie/patch codes) and
  // MSX/Coleco/SG-1000 (whole blueMSX .mcf file per game). SNES/Genesis/Game Gear have no
  // on-device cheat-application path at all — deliberately NOT offered here, even though
  // cheats.json still has (inert) preset data for them; see cheat-codes memory note.
  const lineCheatSystems: Record<string, string> = {
    nes: "nes", gb: "gb", gbc: "gb", pce: "pce",
  };
  const isWholeFileSystem = $derived(system in MCF_WHOLE_FILE_SYSTEMS);
  const isLineSystem = $derived(!!lineCheatSystems[system]);
  const isCheatSupported = $derived(isLineSystem || isWholeFileSystem);
  const dbConsoleName = $derived(lineCheatSystems[system]);

  // One JSON per system (ingest.py, tracked back to references/Game Genie Code Compilation -
  // Shared.xlsx) — see cheats/index.ts. Fetched lazily per-system (only nes/gb/pce are ever
  // requested here; snes/genesis/gamegear have no firmware cheat support and aren't in
  // lineCheatSystems) rather than one combined ~1.8MB file; presets stay empty until resolved.
  let systemGames = $state<Map<string, CheatGame> | null>(null);
  let systemGamesFor = $state<string | null>(null);
  $effect(() => {
    const sys = dbConsoleName;
    if (!sys || sys === systemGamesFor) return;
    systemGamesFor = sys;
    loadCheatsForSystem(sys)
      .then((games) => {
        if (sys !== dbConsoleName) return; // stale — system changed while loading
        systemGames = new Map(games.map((g) => [g.key, g]));
      })
      .catch(() => {});
  });
  const autoDetectedKey = $derived(gameName.replace(/\.[^/.]+$/, ""));
  const autoDetectedGame = $derived.by((): CheatGame | null => {
    if (!systemGames) return null;
    return systemGames.get(normalizeTitle(autoDetectedKey)) ?? null;
  });
  // Manual "detected game" override, per gameKey — a safety net for when auto-matching (exact
  // normalized-title match) fails or picks the wrong region/variant. Session-local only (not
  // persisted, not written to the device overlay by itself): it just changes which game's
  // preset LIST is being displayed/toggled from; actually adding/removing a specific cheat
  // still goes through togglePreset()/manual-entry/the Configured list below, unchanged.
  let gameOverrideKey = $state<Record<string, string>>({});
  const selectedGame = $derived.by((): CheatGame | null => {
    const override = gameOverrideKey[gameKey];
    if (override !== undefined) {
      if (override === "") return null; // explicit "No match" selection
      return systemGames?.get(override) ?? null;
    }
    return autoDetectedGame;
  });
  const presets = $derived(selectedGame?.cheats ?? []);
  /** Every game in the currently-loaded system, sorted for the dropdown. */
  const allSystemGames = $derived.by((): CheatGame[] => {
    if (!systemGames) return [];
    return [...systemGames.values()].sort((a, b) => a.title.localeCompare(b.title));
  });

  // --- MSX/Coleco/SG-1000 whole-file MCF preset ---
  const mcfPresetName = $derived(isWholeFileSystem ? findMcfPreset(system, gameName.replace(/\.[^/.]+$/, "")) : null);
  const mcfAttached = $derived(!!(configuredCheatFiles[gameKey] && configuredCheatFiles[gameKey].length > 0));
  let mcfLoading = $state(false);
  let mcfError = $state<string | null>(null);
  async function attachMcfPreset() {
    if (!mcfPresetName) return;
    mcfLoading = true;
    mcfError = null;
    try {
      const res = await fetch(mcfAssetUrl(system, mcfPresetName));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      configuredCheatFiles[gameKey] = buf;
    } catch (e) {
      mcfError = e instanceof Error ? e.message : String(e);
    } finally {
      mcfLoading = false;
    }
  }
  function removeMcfCheat() {
    delete configuredCheatFiles[gameKey];
    configuredCheatFiles = { ...configuredCheatFiles };
  }

  function parseCheatCode(c: string) {
    return c.split(',')[0].trim();
  }
  function isPresetEnabled(p: Cheat) {
    const list = configuredCheats[gameKey] || [];
    const cCode = parseCheatCode(p.code);
    return list.some(x => x.startsWith(cCode));
  }
  function togglePreset(p: Cheat) {
    let list = configuredCheats[gameKey] || [];
    if (isPresetEnabled(p)) {
      list = list.filter(x => !x.startsWith(parseCheatCode(p.code)));
    } else {
      list = [...list, `${p.code}, ${p.effect}`];
    }
    configuredCheats[gameKey] = list;
  }

  let manualCode = $state("");
  let manualDesc = $state("");

  function addManual() {
    if (!manualCode.trim()) return;
    let list = configuredCheats[gameKey] || [];
    list = [...list, `${manualCode.trim()}, ${manualDesc.trim() || "Manual"}`];
    configuredCheats[gameKey] = list;
    manualCode = "";
    manualDesc = "";
  }

  function removeCheat(entry: string) {
    configuredCheats[gameKey] = (configuredCheats[gameKey] || []).filter((x) => x !== entry);
  }
  function cheatCode(entry: string): string {
    return entry.split(",")[0].trim();
  }
  function cheatDescription(entry: string): string {
    const idx = entry.indexOf(",");
    return idx >= 0 ? entry.slice(idx + 1).trim() : "";
  }
  
  // --- Saves ---
  interface SaveSlot {
    slot: string; // "0", "1", "2", "3", "sram"
    savFile?: LittlefsTreeNode;
    rawFile?: LittlefsTreeNode;
  }

  let lfsTreeReady = $state(false);
  let lfsDataDir = $state<LittlefsTreeNode | null>(null);
  let loadingTree = $state(false);
  
  async function fetchTreeOnce() {
    if (lfsTreeReady || loadingTree) return;
    if (device.targetMedia !== 'sd' && !device.utilLoaded) return;
    loadingTree = true;
    try {
      if (device.targetMedia === 'sd') {
        const root: LittlefsTreeNode = { name: "data", path: "data", isDirectory: true, children: [] };
        if (roms.scan) {
          for (const [path, data] of roms.scan.userRoms) {
            if (path.startsWith("data/")) {
              const parts = path.split("/");
              let current = root;
              for (let i = 1; i < parts.length - 1; i++) {
                let next = current.children!.find(c => c.name === parts[i]);
                if (!next) {
                  next = { name: parts[i], path: parts.slice(0, i+1).join("/"), isDirectory: true, children: [] };
                  current.children!.push(next);
                }
                current = next;
              }
              const fileName = parts[parts.length - 1];
              current.children!.push({ name: fileName, path, isDirectory: false, size: data.length });
            }
          }
        }
        lfsDataDir = root;
        lfsTreeReady = true;
      } else {
        const tree = await ensureLfsTree();
        lfsDataDir = tree.children?.find((c) => c.name === "data" && c.isDirectory) || null;
        lfsTreeReady = true;
      }
    } catch (e) {
      console.error("LFS tree fetch failed", e);
    } finally {
      loadingTree = false;
    }
  }

  // Reload tree when RAM utility comes online or media changes
  let wasUtilLoaded = $state(false);
  let lastTargetMedia = $state("");
  $effect(() => {
    if ((!wasUtilLoaded && device.utilLoaded) || (lastTargetMedia !== device.targetMedia)) {
      if (gameKey && !loadingTree) {
        // Trigger fetch again
        lfsTreeReady = false;
        fetchTreeOnce().then(() => selectDefaultSlot());
      }
    }
    wasUtilLoaded = device.utilLoaded;
    lastTargetMedia = device.targetMedia;
  });

  const gameSaves = $derived.by(() => {
    if (!lfsTreeReady || !lfsDataDir || !lfsDataDir.children) return [];
    
    // Find console dir
    const consoleDirName = system === 'homebrew' ? 'homebrew' : system;
    const consoleDir = lfsDataDir.children.find(c => c.name === consoleDirName);
    if (!consoleDir || !consoleDir.children) return [];

    let baseName = gameName;
    if (system === 'homebrew') {
      const hb = HOMEBREW_TITLES.find(h => h.key === gameKey || h.label === gameName);
      if (hb) {
        const binFile = hb.deviceFiles.find(f => f.endsWith('.bin'));
        if (binFile) {
          baseName = binFile;
        }
      }
    }
    let foundSlots: SaveSlot[] = [];
    
    for (const file of consoleDir.children) {
      if (file.isDirectory) continue;
      let slot = "";
      let type = "";
      if (file.name === `${baseName}.sram`) {
        slot = "sram";
        type = "sram";
      } else {
        const m = file.name.match(/^(.*?)-(\d+)\.(raw|sav)$/);
        if (m && m[1] === baseName) {
          slot = m[2];
          type = m[3];
        }
      }
      if (slot) {
        let slotObj = foundSlots.find(s => s.slot === slot);
        if (!slotObj) {
          slotObj = { slot };
          foundSlots.push(slotObj);
        }
        if (type === "sav" || type === "sram") slotObj.savFile = file;
        if (type === "raw") slotObj.rawFile = file;
      }
    }
    foundSlots.sort((a, b) => a.slot === "sram" ? -1 : b.slot === "sram" ? 1 : a.slot.localeCompare(b.slot));
    return foundSlots;
  });

  let selectedSlot = $state<SaveSlot | null>(null);
  let screenshotDataUrl = $state<string | null>(null);
  let downloadingScreenshot = $state(false);
  let downloadingSave = $state(false);

  function selectDefaultSlot() {
    if (gameSaves.length > 0) {
      selectedSlot = gameSaves.find(s => s.rawFile) || gameSaves[0];
    }
  }

  // --- Cover Art State ---
  let coverSource = $state<"file" | "scraper">(localStorage.getItem("gnw:ssUsername") ? "scraper" : "file");
  let coverVariant = $state<"box" | "ss" | "mix3" | "mix4" | "mix5">("box");
  
  let previewCoverBlob = $state<Blob | null>(null);
  let isGeneratingPreview = $state(false);
  let previewError = $state<string | null>(null);
  let previewUrl = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function handleOverrideFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    previewCoverBlob = new Blob([await file.arrayBuffer()], { type: file.type });
    await applyPreview();
  }
  
  $effect(() => {
    if (previewCoverBlob) {
      const url = URL.createObjectURL(previewCoverBlob);
      previewUrl = url;
      return () => URL.revokeObjectURL(url);
    } else {
      previewUrl = null;
    }
  });

  async function generatePreview() {
    if (coverSource !== 'scraper' || !ssUsername) return;
    isGeneratingPreview = true;
    previewError = null;
    previewCoverBlob = null;
    
    const hb = HOMEBREW_TITLES.find(t => t.key === gameKey);
    let buffer: Uint8Array | undefined;
    
    let filename = "";
    let webkitPath = "";
    let sysId: number | null = null;
    
    if (hb) {
      // Try to find the actual source ROM to get a real hash
      if (hb.sourceRoms.length > 0 && roms.scan) {
        for (const [k, v] of roms.scan.userRoms) {
          if (k.endsWith(hb.sourceRoms[0])) {
            buffer = v;
            break;
          }
        }
      }
      // If we couldn't find the source ROM, use a dummy buffer (NOT 0-bytes) so we don't hit the 0-byte Amstrad game collision, forcing a name-based search.
      if (!buffer) {
        buffer = new TextEncoder().encode("dummy_data_for_homebrew_" + hb.key);
      }
      
      filename = hb.displayName;
      webkitPath = `root/${hb.virtualConsole}/${filename}`;
      const ids = systemIdsFor(hb.virtualConsole);
      sysId = ids.length > 0 ? ids[0] : null;
    } else {
      buffer = roms.scan?.userRoms.get(gameKey);
      if (!buffer) {
        previewError = locale.t.roms.gameDetailsPanel.coverArt.errRomNotFound;
        isGeneratingPreview = false;
        return;
      }
      const parts = gameKey.split("/");
      filename = parts.pop() || "unknown.rom";
      webkitPath = "root/" + gameKey;
    }
    
    const file = new File([buffer as any], filename);
    Object.defineProperty(file, 'webkitRelativePath', { value: webkitPath });
    
    try {
      await runCovers({
        files: [file],
        source: coverVariant,
        convert: "none",
        ssid: ssUsername,
        sspassword: ssPassword,
        skipExisting: false,
        mixFile: null,
        useCache: true,
        forceSys: sysId,
      }, {
        onLog: () => {},
        onProgress: () => {},
        onStatus: () => {},
        // @ts-ignore
        onAccount: (acc: any) => {
          if (acc.perDay) ssRequestsTotal = acc.perDay;
          if (acc.used !== null) ssRequestsUsed = acc.used;
        },
        onCover: (cover: any) => {
          previewCoverBlob = cover.blob;
        },
        shouldCancel: () => false
      });
      
      if (!previewCoverBlob) {
        previewError = locale.t.roms.gameDetailsPanel.coverArt.errCoverNotFound;
      }
    } catch (e: any) {
      previewError = locale.t.roms.gameDetailsPanel.coverArt.errPrefix(e.message || String(e));
    } finally {
      isGeneratingPreview = false;
    }
  }

  let previewTimeout: any;
  $effect(() => {
    const _cv = coverVariant;
    const _cs = coverSource;
    const _gk = gameKey;
    clearTimeout(previewTimeout);
    if (_cs === 'scraper') {
      previewTimeout = setTimeout(() => {
        generatePreview();
      }, 500);
    }
  });

  import { toGWCover } from "../screenscraper/gw.js";

  async function applyPreview() {
    if (!previewCoverBlob) return;
    
    let arr: Uint8Array;
    try {
      const gwBlob = await toGWCover(previewCoverBlob);
      if (!gwBlob) throw new Error("Conversion returned null");
      arr = new Uint8Array(await gwBlob.arrayBuffer());
    } catch (e) {
      console.error("Failed to convert cover to JPEG:", e);
      return;
    }

    const hb = HOMEBREW_TITLES.find(t => t.key === gameKey);
    let coverPath = "";
    let baseName = "";
    const parts = gameKey.split("/");
    
    if (hb) {
      baseName = hb.displayName;
      coverPath = `covers/homebrew/${baseName}.img`;
    } else {
      const filename = parts[parts.length - 1];
      baseName = filename.replace(/\.[^/.]+$/, "");
      coverPath = "covers/" + parts.slice(0, -1).join("/") + "/" + baseName + ".img";
    }
    
    roms.scan?.userRoms.set(coverPath, arr);
    roms.markDirty(coverPath);
    
    // Also save the high-res .png to memory so the UI prefers it immediately (since getCoverUrl checks .png first)
    const pngPath = coverPath.replace(/\.img$/, ".png");
    roms.scan?.userRoms.set(pngPath, new Uint8Array(await previewCoverBlob.arrayBuffer()));
    roms.markDirty(pngPath);
    
    // If an inline cover exists in memory, remove it so the UI doesn't prioritize the old stale inline cover over the new covers/ one!
    let prefix = parts.slice(0, -1).join("/");
    if (hb) prefix = "homebrew";
    
    const inlineImg = prefix ? `${prefix}/${baseName}.img` : `${baseName}.img`;
    const inlinePng = prefix ? `${prefix}/${baseName}.png` : `${baseName}.png`;
    const inlineJpg = prefix ? `${prefix}/${baseName}.jpg` : `${baseName}.jpg`;
    if (roms.scan?.userRoms.has(inlineImg)) roms.scan.userRoms.delete(inlineImg);
    if (roms.scan?.userRoms.has(inlinePng)) roms.scan.userRoms.delete(inlinePng);
    if (roms.scan?.userRoms.has(inlineJpg)) roms.scan.userRoms.delete(inlineJpg);
    
    // Save ORIGINAL cover to disk (not the converted .img — conversion is session-only)
    if (ssSaveLocal && nativeFolderPickerSupported() && roms.scan?.dir) {
      try {
        let relativePath = baseName + ".png";
        let isRomsFolder = roms.scan.dir.name.toLowerCase() === "roms";
        
        // If not the 'roms' folder directly, stick it in 'covers/'
        if (!isRomsFolder) {
          relativePath = "covers/" + relativePath;
        }

        if (hb) {
          relativePath = (isRomsFolder ? "homebrew/" : "covers/homebrew/") + baseName + ".png";
        } else {
          // e.g. parts = ["nes", "smb.nes"]
          // We want "nes/smb.png" or "covers/nes/smb.png"
          const pathPrefix = parts.slice(0, -1).join("/");
          if (pathPrefix) {
            relativePath = (isRomsFolder ? "" : "covers/") + pathPrefix + "/" + baseName + ".png";
          }
        }
        
        await saveFileToDirOrDownload(roms.scan.dir, relativePath, previewCoverBlob);
      } catch (e) {
        console.error("Failed to save applied cover to disk", e);
      }
    }
    
    if (onCoverChange) onCoverChange();
  }

  // --- ScreenScraper State ---
  let showCoverSettings = $state(false);
  let ssUsername = $state(localStorage.getItem('gnw:ssUsername') || "");
  // Obfuscated at rest (see localCrypt.ts) — decoded async right after init, below.
  let ssPassword = $state("");
  (async () => {
    ssPassword = await deobfuscate(localStorage.getItem('gnw:ssPassword'));
  })();
  let ssRemember = $state(localStorage.getItem('gnw:ssRemember') === 'true');
  let ssPreferLocal = $state(localStorage.getItem('gnw:ssPreferLocal') !== 'false');
  let ssSaveLocal = $state(nativeFolderPickerSupported() && localStorage.getItem('gnw:ssSaveLocal') !== 'false');
  let ssRequestsTotal = $state(50000);
  let ssRequestsUsed = $state(1500);

  // --- Import Modal State ---
  let showImportModal = $state(false);
  let importSelected = $state<Set<string>>(new Set());
  let importSortBy = $state<"name" | "cover">("name");
  let importSortDesc = $state(false);
  let importFilterConsole = $state<string>("all");
  let defaultVariant = $state<"box" | "ss" | "mix3" | "mix4" | "mix5">("box");
  
  let isImporting = $state(false);
  let importProgress = $state({ current: 0, total: 0, log: [] as string[] });

  async function startImport() {
    isImporting = true;
    importProgress = { current: 0, total: importSelected.size, log: [] };
    
    const filesToScrape: File[] = [];
    for (const key of importSelected) {
      const buffer = roms.scan?.userRoms.get(key);
      if (!buffer) continue;
      const parts = key.split("/");
      const filename = parts.pop();
      if (!filename) continue;
      const file = new File([buffer as any], filename);
      
      const hb = HOMEBREW_TITLES.find(t => t.key === key);
      const webkitPath = hb ? `root/${hb.virtualConsole}/${filename}` : `root/${key}`;
      
      Object.defineProperty(file, 'webkitRelativePath', { value: webkitPath });
      filesToScrape.push(file);
    }
    
    try {
      await runCovers({
        files: filesToScrape,
        source: defaultVariant,
        convert: "none",
        ssid: ssUsername,
        sspassword: ssPassword,
        skipExisting: ssPreferLocal,
        mixFile: null,
        useCache: false,
        forceSys: null,
      }, {
        onLog: (msg: string) => {
          importProgress.log = [...importProgress.log, msg];
        },
        onProgress: (done: number, total: number) => {
          importProgress.current = done;
          importProgress.total = total;
        },
        onStatus: () => {},
        // @ts-ignore
        onAccount: (acc: any) => {
          if (acc.perDay) ssRequestsTotal = acc.perDay;
          if (acc.used !== null) ssRequestsUsed = acc.used;
        },
        onCover: async (cover: any) => {
          const { blob, outputPath, name } = cover;
          
          // Re-map back to homebrew/ if this was a homebrew game we injected a virtualConsole for
          const hb = HOMEBREW_TITLES.find(t => t.displayName === name || t.key === name);
          let relPath = outputPath.startsWith("root/") ? outputPath.slice(5) : outputPath;
          if (hb) {
            // Replace the virtualConsole directory with "homebrew"
            const parts = relPath.split("/");
            parts[0] = "homebrew";
            relPath = parts.join("/");
          }
          
          const baseName = relPath.replace(/\.[^/.]+$/, "");
          const imgPath = `covers/${baseName}.img`;
          
          // Convert to .img JPEG on ingest
          try {
            const gwBlob = await toGWCover(blob);
            if (gwBlob) {
              roms.scan?.userRoms.set(imgPath, new Uint8Array(await gwBlob.arrayBuffer()));
              if (roms.scan) roms.markDirty(imgPath);
            }
          } catch (e) {
            console.error("Failed to convert cover:", e);
          }
          
          // Also save the high-res .png to memory so the UI prefers it immediately
          const pngPath = imgPath.replace(/\.img$/, ".png");
          roms.scan?.userRoms.set(pngPath, new Uint8Array(await blob.arrayBuffer()));
          if (roms.scan) roms.markDirty(pngPath);
          
          const inlineImgPath = relPath.replace(/\.[^/.]+$/, ".img");
          const inlinePngPath = relPath.replace(/\.[^/.]+$/, ".png");
          const inlineJpgPath = relPath.replace(/\.[^/.]+$/, ".jpg");
          if (roms.scan?.userRoms.has(inlineImgPath)) roms.scan.userRoms.delete(inlineImgPath);
          if (roms.scan?.userRoms.has(inlinePngPath)) roms.scan.userRoms.delete(inlinePngPath);
          if (roms.scan?.userRoms.has(inlineJpgPath)) roms.scan.userRoms.delete(inlineJpgPath);
          
          // Save ORIGINAL format to disk (not the converted .img)
          if (ssSaveLocal && nativeFolderPickerSupported() && roms.scan?.dir) {
            try {
              const parts = relPath.split("/");
              let relativePath = parts[parts.length - 1];
              let isRomsFolder = roms.scan.dir.name.toLowerCase() === "roms";
              
              if (!isRomsFolder) {
                relativePath = "covers/" + relativePath;
              }
              
              if (hb) {
                relativePath = (isRomsFolder ? "homebrew/" : "covers/homebrew/") + parts[parts.length - 1];
              } else {
                const pathPrefix = parts.slice(0, -1).join("/");
                if (pathPrefix) {
                  relativePath = (isRomsFolder ? "" : "covers/") + pathPrefix + "/" + parts[parts.length - 1];
                }
              }
              
              await saveFileToDirOrDownload(roms.scan.dir, relativePath, blob);
            } catch (e) {
              console.error("Failed to save cover to disk", e);
            }
          }
          
          if (onCoverChange) onCoverChange();
        },
        shouldCancel: () => !isImporting
      });
      importSelected = new Set();
      showImportModal = false;
    } catch (e: any) {
      console.error(e);
      importProgress.log = [...importProgress.log, "Fatal Error: " + (e.message || String(e))];
    } finally {
      isImporting = false;
    }
  }

  function hasLocalCover(gameKey: string) {
    const hb = HOMEBREW_TITLES.find(t => t.key === gameKey);
    let coverPathBase = "";
    
    if (hb) {
      coverPathBase = `covers/homebrew/${hb.displayName}`;
    } else {
      const parts = gameKey.split("/");
      if (parts.length < 2) return false;
      const filename = parts[parts.length - 1];
      const baseName = filename.replace(/\.[^/.]+$/, "");
      coverPathBase = "covers/" + parts.slice(0, -1).join("/") + "/" + baseName;
    }
    
    for (const ext of [".img", ".png", ".jpg", ".jpeg"]) {
      if (roms.scan?.userRoms.has(`${coverPathBase}${ext}`)) return true;
    }
    return false;
  }

  let importGamesList = $derived.by(() => {
    return romSelection.games.map(g => ({
      ...g,
      hasCover: hasLocalCover(g.key)
    }));
  });

  let sortedImportGames = $derived.by(() => {
    let filtered = importGamesList;
    if (importFilterConsole !== "all") {
      filtered = filtered.filter(g => g.system === importFilterConsole);
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (importSortBy === 'cover') {
        const cmp = (a.hasCover ? 1 : 0) - (b.hasCover ? 1 : 0);
        if (cmp !== 0) return importSortDesc ? -cmp : cmp;
      }
      return a.name.localeCompare(b.name);
    });
    return sorted;
  });



  $effect(() => {
    localStorage.setItem('gnw:ssRemember', ssRemember.toString());
    localStorage.setItem('gnw:ssPreferLocal', ssPreferLocal.toString());
    localStorage.setItem('gnw:ssSaveLocal', ssSaveLocal.toString());

    if (ssRemember) {
      localStorage.setItem('gnw:ssUsername', ssUsername);
      // Obfuscated, not encrypted with a user secret — see localCrypt.ts's header comment.
      // Deters casual plaintext exposure (devtools/localStorage dumps), not a real security
      // boundary; the key ships in the JS bundle.
      obfuscate(ssPassword).then(enc => localStorage.setItem('gnw:ssPassword', enc));
    } else {
      localStorage.removeItem('gnw:ssUsername');
      localStorage.removeItem('gnw:ssPassword');
    }
  });

  // --- Saves State ---
  let loadTimeout: any;
  $effect(() => {
    // track changes to gameKey
    if (gameKey) {
      clearTimeout(loadTimeout);
      selectedSlot = null;
      screenshotDataUrl = null;
      
      loadTimeout = setTimeout(() => {
        if (device.utilLoaded || device.targetMedia === 'sd') {
          fetchTreeOnce().then(() => selectDefaultSlot());
        }
      }, 300); // 300ms debounce when scrubbing
    }
  });

  $effect(() => {
    if (selectedSlot && selectedSlot.rawFile && (device.utilLoaded || device.targetMedia === 'sd')) {
      const p = selectedSlot.rawFile.path;
      downloadingScreenshot = true;
      screenshotDataUrl = null;
      readSaveFileLocal(p).then(data => {
        if (selectedSlot?.rawFile?.path === p) {
          screenshotDataUrl = renderRgb565(data);
        }
      }).catch(e => console.error("Screenshot err:", e))
      .finally(() => downloadingScreenshot = false);
    }
  });

  function renderRgb565(raw: Uint8Array): string {
    const pixels = Math.floor(raw.length / 2);
    let width = 320;
    let height = 240;
    
    // Match known Retro-Go framebuffer exact dimensions
    if (pixels === 320 * 240) { width = 320; height = 240; }
    else if (pixels === 256 * 240) { width = 256; height = 240; } // NES
    else if (pixels === 256 * 224) { width = 256; height = 224; } // SNES/PCE
    else if (pixels === 256 * 192) { width = 256; height = 192; } // SMS/Coleco
    else if (pixels === 240 * 160) { width = 240; height = 160; } // GBA
    else if (pixels === 160 * 144) { width = 160; height = 144; } // GB/GBC/GG
    else {
      // Fallback best effort guess if slightly off
      for (const w of [320, 256, 240, 160]) {
        if (pixels % w === 0) {
          const h = pixels / w;
          if (h >= 120 && h <= 240) {
            width = w;
            height = h;
            break;
          }
        }
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(width, height);
    
    let o = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = raw[i * 2] | (raw[i * 2 + 1] << 8);
        const r = ((p >> 11) & 0x1f) * 255 / 31;
        const g = ((p >> 5) & 0x3f) * 255 / 63;
        const b = (p & 0x1f) * 255 / 31;
        
        if (p !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        
        imgData.data[o++] = r;
        imgData.data[o++] = g;
        imgData.data[o++] = b;
        imgData.data[o++] = 255;
      }
    }
    
    // If the image is completely blank, fallback to full size
    if (minX > maxX || minY > maxY) {
      minX = 0; maxX = width - 1;
      minY = 0; maxY = height - 1;
    }
    
    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    
    // Create an intermediate canvas to hold the full uncropped image
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = width;
    fullCanvas.height = height;
    fullCanvas.getContext("2d")!.putImageData(imgData, 0, 0);
    
    // Size the final canvas to the cropped bounding box
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    ctx.drawImage(fullCanvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    
    return canvas.toDataURL("image/png");
  }

  async function readSaveFileLocal(path: string): Promise<Uint8Array> {
    if (device.targetMedia === 'sd') {
      const data = roms.scan?.userRoms.get(path);
      if (!data) throw new Error("File not found on SD card: " + path);
      return data;
    } else {
      return await readLfsFile(path);
    }
  }

  async function downloadSaveFile(file: LittlefsTreeNode) {
    if (downloadingSave) return;
    downloadingSave = true;
    try {
      const data = await readSaveFileLocal(file.path);
      download(file.name, new Uint8Array(data));
    } catch (e) {
      alert(locale.t.roms.gameDetailsPanel.saves.alertDownloadFailed(String(e)));
    } finally {
      downloadingSave = false;
    }
  }

  const configuredCodesCount = $derived(
    (configuredCheats[gameKey] || []).reduce((t, l) => t + (l.split(',')[0].trim() ? l.split(',')[0].split('+').length : 0), 0)
  );
</script>

<div class="game-details-accordion">
  <details bind:open={additionalOptionsOpen}>
    <summary>{locale.t.roms.gameDetailsPanel.additionalOptions}</summary>
    <div class="details-panels">
      <div class="panel">
    <div style="display: flex; justify-content: space-between; align-items: center; padding-right: 0.5rem;">
      <h3>{locale.t.roms.gameDetailsPanel.coverArt.heading}</h3>
      <div style="display: flex; gap: 0.25rem;">
        {#if ssUsername}
          {@const openImportModal = () => {
            const toSelect = new Set<string>();
            for (const g of importGamesList) {
              if (!g.hasCover) toSelect.add(g.key);
            }
            importSelected = toSelect;
            showImportModal = true;
          }}
          <button class="settings-btn" title={locale.t.roms.gameDetailsPanel.coverArt.importTitle} onclick={openImportModal} style="background: none; border: none; cursor: pointer; color: var(--ink-soft); display: flex; padding: 4px; border-radius: 4px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
        {/if}
        <button class="settings-btn" title={locale.t.roms.gameDetailsPanel.coverArt.settingsTitle} onclick={() => showCoverSettings = true} style="background: none; border: none; cursor: pointer; color: var(--ink-soft); display: flex; padding: 4px; border-radius: 4px;">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </div>
    <hr />
    <div class="panel-content cover-options" style="display: flex; flex-direction: column; flex: 1; gap: 0.5rem; margin-top: 0.5rem;">
      <div class="option-row" style="display: flex; align-items: center; justify-content: space-between;">
        <label for="cover-source" style="font-size: var(--fs-micro); color: var(--ink-soft); font-weight: 500;">{locale.t.roms.gameDetailsPanel.coverArt.sourceLabel}</label>
        <select
          id="cover-source"
          bind:value={coverSource}
          style="padding: 0.2rem 0.4rem; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink); flex: 1; margin-left: 1rem; max-width: 120px;"
        >
          <option value="file">{locale.t.roms.gameDetailsPanel.coverArt.sourceFile}</option>
          <option value="scraper">{locale.t.roms.gameDetailsPanel.coverArt.sourceScraper}</option>
        </select>
      </div>

      {#if coverSource === 'scraper'}
        <div class="option-row" style="display: flex; align-items: center; justify-content: space-between;">
          <label for="cover-variant" style="font-size: var(--fs-micro); color: var(--ink-soft); font-weight: 500;">{locale.t.roms.gameDetailsPanel.coverArt.variantLabel}</label>
          <select
            id="cover-variant"
            bind:value={coverVariant}
            style="padding: 0.2rem 0.4rem; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink); flex: 1; margin-left: 1rem; max-width: 120px;"
          >
            <option value="box">{locale.t.roms.gameDetailsPanel.coverArt.variantBoxart}</option>
            <option value="ss">{locale.t.roms.gameDetailsPanel.coverArt.variantScreenshot}</option>
            <option value="mix3">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti3}</option>
            <option value="mix4">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti4}</option>
            <option value="mix5">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti5}</option>
          </select>
        </div>

        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--hairline); border-radius: 4px; background: rgba(0,0,0,0.05); min-height: 120px; position: relative;">
          {#if isGeneratingPreview}
            <span style="font-size: 0.75rem; color: var(--ink-soft);">{locale.t.roms.gameDetailsPanel.coverArt.generatingPreview}</span>
          {:else if previewError}
            <span style="font-size: 0.75rem; color: var(--model-accent);">{previewError}</span>
          {:else if previewUrl}
            <img src={previewUrl} alt={locale.t.roms.gameDetailsPanel.coverArt.coverPreviewAlt} style="max-height: 120px; max-width: 100%; object-fit: contain;" />
          {:else}
            <span style="font-size: 0.75rem; color: var(--ink-soft);">{locale.t.roms.gameDetailsPanel.coverArt.configureToPreview}</span>
          {/if}
        </div>

        <button onclick={applyPreview} disabled={!previewCoverBlob} style="padding: 0.4rem; background: var(--model-accent); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500; opacity: {previewCoverBlob ? 1 : 0.5};">
          {locale.t.roms.gameDetailsPanel.coverArt.apply}
        </button>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="file-drop-area"
          style="border: 2px dashed var(--hairline); border-radius: 4px; padding: 1.5rem 1rem; text-align: center; color: var(--ink-soft); font-size: 0.75rem; cursor: pointer; margin-top: 0.5rem; transition: background 0.2s; display: flex; align-items: center; justify-content: center; flex: 1;"
          onclick={() => fileInput?.click()}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }}
          ondrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer?.files?.length) handleOverrideFile(e.dataTransfer.files[0]);
          }}
        >
          {locale.t.roms.gameDetailsPanel.coverArt.dragDropOverride}
          <input
            type="file" 
            bind:this={fileInput} 
            accept=".png,.jpg,.jpeg,.bmp" 
            style="display: none" 
            onchange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) handleOverrideFile(f);
            }} 
          />
        </div>
      {/if}

      {#if ssUsername}
        <div class="requests-bar" style="margin-top: auto; font-size: 0.65rem; color: var(--ink-soft); padding-top: 1rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>{locale.t.roms.gameDetailsPanel.coverArt.requestsPerDay}</span>
            <span style="font-family: monospace;">{ssRequestsUsed} / {ssRequestsTotal}</span>
          </div>
          <div style="width: 100%; height: 4px; background: var(--hairline); border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: {(ssRequestsUsed / ssRequestsTotal) * 100}%; background: var(--ink);"></div>
          </div>
        </div>
      {/if}

      {#if roms.scan}
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; border-top: 1px solid var(--hairline); padding-top: 1rem;">
          <button 
            class="action" 
            style="font-size: 0.75rem; justify-content: center;"
            onclick={async () => {
              const zip = new JSZip();
              let count = 0;
              for (const [path, data] of roms.scan!.userRoms) {
                if (path.startsWith("covers/") && path.endsWith(".img")) {
                  zip.file(path, data instanceof Uint8Array ? data : new Uint8Array(await (data as Blob).arrayBuffer()));
                  count++;
                }
              }
              if (count === 0) {
                alert(locale.t.roms.gameDetailsPanel.coverArt.alertNoConvertedCovers);
                return;
              }
              const blob = await zip.generateAsync({ type: "blob" });
              download("covers-img.zip", blob);
            }}
          >
            {locale.t.roms.gameDetailsPanel.coverArt.downloadConvertedCovers}
          </button>
          {#if !nativeFolderPickerSupported() || !ssSaveLocal}
            <button
              class="action"
              style="font-size: 0.75rem; justify-content: center;"
              onclick={async () => {
              const zip = new JSZip();
              let count = 0;
              for (const [path, data] of roms.scan!.userRoms) {
                const lp = path.toLowerCase();
                if (lp.endsWith(".png") || lp.endsWith(".jpg") || lp.endsWith(".jpeg")) {
                  zip.file(path, data instanceof Uint8Array ? data : new Uint8Array(await (data as Blob).arrayBuffer()));
                  count++;
                }
              }
              if (count === 0) {
                alert(locale.t.roms.gameDetailsPanel.coverArt.alertNoFullsizeCovers);
                return;
              }
              const blob = await zip.generateAsync({ type: "blob" });
              download("covers-fullsize.zip", blob);
            }}
          >
            {locale.t.roms.gameDetailsPanel.coverArt.downloadScrapedCovers}
          </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="panel">
    <h3>{locale.t.roms.gameDetailsPanel.saves.heading}</h3>
    <hr />
    <div class="panel-content saves-content">
      {#if !device.utilLoaded && device.targetMedia !== 'sd'}
        <div class="saves-overlay">
          <p class="muted">{locale.t.roms.gameDetailsPanel.saves.runUtilPrompt}</p>
          <button class="action" onclick={() => device.ensureStub()}>{locale.t.shared.common.connect}</button>
        </div>
      {:else if loadingTree}
        <div class="saves-overlay">
          <p class="muted">{locale.t.roms.gameDetailsPanel.saves.loadingSaves}</p>
        </div>
      {:else}
        <div class="saves-tabs">
          {#each gameSaves as slot}
            <button
              class="slot-tab"
              class:active={selectedSlot === slot}
              onclick={() => selectedSlot = slot}
            >
              {slot.slot === "sram" ? locale.t.roms.gameDetailsPanel.saves.sram : locale.t.roms.gameDetailsPanel.saves.slotLabel(slot.slot)}
            </button>
          {/each}
          {#if gameSaves.length === 0}
            <span class="muted" style="font-size: var(--fs-micro);">{locale.t.roms.gameDetailsPanel.saves.noSavesFound}</span>
          {/if}
        </div>

        <div class="saves-preview-container">
          <button
            class="arrow-btn"
            aria-label={locale.t.roms.gameDetailsPanel.saves.previousSaveAriaLabel}
            disabled={!gameSaves.length || gameSaves.indexOf(selectedSlot!) <= 0}
            onclick={() => selectedSlot = gameSaves[gameSaves.indexOf(selectedSlot!) - 1]}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>

          <div class="saves-preview">
            {#if downloadingScreenshot}
              <div class="loading-box">{locale.t.roms.gameDetailsPanel.saves.loading}</div>
            {:else if screenshotDataUrl}
              <img src={screenshotDataUrl} alt={locale.t.roms.gameDetailsPanel.saves.savePreviewAlt} />
            {:else if selectedSlot?.rawFile}
              <div class="loading-box">{locale.t.roms.gameDetailsPanel.saves.failedToRender}</div>
            {:else}
              <div class="loading-box empty">{locale.t.roms.gameDetailsPanel.saves.noPreview}</div>
            {/if}
          </div>

          <button
            class="arrow-btn"
            aria-label={locale.t.roms.gameDetailsPanel.saves.nextSaveAriaLabel}
            disabled={!gameSaves.length || gameSaves.indexOf(selectedSlot!) >= gameSaves.length - 1}
            onclick={() => selectedSlot = gameSaves[gameSaves.indexOf(selectedSlot!) + 1]}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>

        <button
          class="btn download-btn"
          disabled={!selectedSlot?.savFile || downloadingSave}
          onclick={() => downloadSaveFile(selectedSlot!.savFile!)}
        >
          {locale.t.roms.gameDetailsPanel.saves.downloadSave}
        </button>
      {/if}
    </div>
  </div>

  <div class="panel cheats-panel" class:disabled={!isCheatSupported}>
    <h3>{locale.t.roms.gameDetailsPanel.cheats.heading}</h3>
    <hr />
    <div class="panel-content cheats-content">

              {#if !isCheatSupported}
        <div class="cheats-overlay">
          <p class="muted">{locale.t.roms.gameDetailsPanel.cheats.unsupportedConsole}</p>
        </div>
      {/if}
      
      {#if isWholeFileSystem}
        <!-- MSX/Coleco/SG-1000: cheats are one whole .mcf file per game, not a toggleable code
             list — so this is a single atomic attach/detach action, not a checklist. -->
        <div class="cheats-rows">
          <div class="cheats-row">
            <h4 class="cheats-row-head">{locale.t.roms.gameDetailsPanel.cheats.builtInCheatFileHeading}</h4>
            {#if mcfAttached}
              <p class="muted" style="font-size: var(--fs-micro);">
                {mcfPresetName ? locale.t.roms.gameDetailsPanel.cheats.attachedFromLibrary(mcfPresetName) : locale.t.roms.gameDetailsPanel.cheats.attachedCustom}
              </p>
              <button class="btn" onclick={removeMcfCheat}>{locale.t.roms.gameDetailsPanel.cheats.removeCheatFile}</button>
            {:else if mcfPresetName}
              <p class="muted" style="font-size: var(--fs-micro);">
                {locale.t.roms.gameDetailsPanel.cheats.builtInFoundBody(mcfPresetName)}
              </p>
              <button class="btn" disabled={mcfLoading} onclick={attachMcfPreset}>
                {mcfLoading ? locale.t.roms.gameDetailsPanel.cheats.loadingEllipsis : locale.t.roms.gameDetailsPanel.cheats.useBuiltInCheatFile}
              </button>
              {#if mcfError}<p class="muted" style="color: var(--err, #c00);">{mcfError}</p>{/if}
            {:else}
              <p class="muted" style="font-size: var(--fs-micro);">{locale.t.roms.gameDetailsPanel.cheats.noBuiltInCheatFile}</p>
            {/if}
          </div>
        </div>
      {:else}
      <div class="cheats-rows">
        {#if systemGames && allSystemGames.length > 0}
          <div class="cheats-row">
            <h4 class="cheats-row-head">{locale.t.roms.gameDetailsPanel.cheats.detectedGameHeading}</h4>
            <select
              class="mono detected-game-select"
              value={gameOverrideKey[gameKey] ?? autoDetectedGame?.key ?? ""}
              onchange={(e) => { gameOverrideKey = { ...gameOverrideKey, [gameKey]: e.currentTarget.value }; }}
            >
              {#if !autoDetectedGame}<option value="">{locale.t.roms.gameDetailsPanel.cheats.noMatchOption}</option>{/if}
              {#each allSystemGames as g (g.key)}
                <option value={g.key}>{g.title}{g.key === autoDetectedGame?.key ? locale.t.roms.gameDetailsPanel.cheats.autoDetectedSuffix : ""}</option>
              {/each}
            </select>
            {#if !selectedGame}
              <p class="muted" style="font-size: var(--fs-micro);">{locale.t.roms.gameDetailsPanel.cheats.noPresetMatch}</p>
            {/if}
          </div>
        {/if}

        {#if presets.length > 0}
          <div class="cheats-row">
            <h4 class="cheats-row-head">{locale.t.roms.gameDetailsPanel.cheats.presetsHeading}</h4>
            <div class="presets-list">
              {#each presets as p}
                <label class="preset-label" title={p.effect || locale.t.roms.gameDetailsPanel.cheats.defaultCheatName}>
                  <input type="checkbox" checked={isPresetEnabled(p)} onchange={() => togglePreset(p)} />
                  <span class="preset-name">{p.effect || locale.t.roms.gameDetailsPanel.cheats.defaultCheatName}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}

        <div class="cheats-row">
          <h4 class="cheats-row-head">{locale.t.roms.gameDetailsPanel.cheats.manualEntryHeading}</h4>
          <div class="manual-entry-row">
            <input
              type="text"
              class="manual-input-code mono"
              placeholder={locale.t.roms.gameDetailsPanel.cheats.codePlaceholder}
              bind:value={manualCode}
              onkeydown={(e) => { if (e.key === "Enter") addManual(); }}
            />
            <input
              type="text"
              class="manual-input-desc"
              placeholder={locale.t.roms.gameDetailsPanel.cheats.descriptionPlaceholder}
              bind:value={manualDesc}
              onkeydown={(e) => { if (e.key === "Enter") addManual(); }}
            />
            <button class="btn add-cheat-btn" disabled={!manualCode.trim() || configuredCodesCount >= 13} onclick={addManual}>
              {locale.t.roms.gameDetailsPanel.cheats.add}
            </button>
          </div>
        </div>

        <div class="cheats-row">
          <h4 class="cheats-row-head">{locale.t.roms.gameDetailsPanel.cheats.configuredHeading((configuredCheats[gameKey] || []).length)}</h4>
          <div class="configured-cheats-list">
            {#each (configuredCheats[gameKey] || []) as entry (entry)}
              <div class="configured-cheat-item">
                <span class="cc-code mono" title={cheatCode(entry)}>{cheatCode(entry)}</span>
                <span class="cc-desc">{cheatDescription(entry)}</span>
                <button class="cc-remove" title={locale.t.roms.gameDetailsPanel.cheats.removeTitle} onclick={() => removeCheat(entry)}>
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            {/each}
            {#if (configuredCheats[gameKey] || []).length === 0}
              <span class="muted" style="font-size: var(--fs-micro);">{locale.t.roms.gameDetailsPanel.cheats.noCheatsConfigured}</span>
            {/if}
          </div>
        </div>
      </div>
      {/if}

        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; border-top: 1px solid var(--hairline); padding-top: 1rem;">
          <button
            class="action"
            style="font-size: 0.75rem; justify-content: center;"
            onclick={async () => {
              const zip = new JSZip();
              let count = 0;
              for (const [key, cheats] of Object.entries(configuredCheats)) {
                if (cheats.length === 0) continue;
                const [sys, ...nameParts] = key.split("/");
                const name = nameParts.join("/");
                const cheatExts: Record<string, string> = {
                  nes: "ggcodes", gb: "ggcodes", gbc: "ggcodes",
                  snes: "ggcodes", md: "ggcodes", gen: "ggcodes", gg: "ggcodes",
                  pce: "pceplus", msx: "mcf", col: "mcf", sg1000: "mcf"
                };
                const ext = cheatExts[sys] || "ggcodes";
                const noExtName = name.replace(/\.[^/.]+$/, "");
                const cheatContent = cheats.join("\n") + "\n";
                zip.file(`cheats/${sys}/${noExtName}.${ext}`, cheatContent);
                count++;
              }
              for (const [key, data] of Object.entries(configuredCheatFiles)) {
                if (data.length === 0) continue;
                const [sys, ...nameParts] = key.split("/");
                const name = nameParts.join("/").replace(/\.[^/.]+$/, "");
                zip.file(`cheats/${sys}/${name}.mcf`, data);
                count++;
              }
              if (count === 0) {
                alert(locale.t.roms.gameDetailsPanel.cheats.alertNoConfiguredCheats);
                return;
              }
              const blob = await zip.generateAsync({ type: "blob" });
              download("retro-go-cheats.zip", blob);
            }}
          >
            {locale.t.roms.gameDetailsPanel.cheats.downloadCheatsFiles}
          </button>
        </div>
    </div>
  </div>
    </div>
  </details>
</div>

{#if showCoverSettings}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;" onclick={(e) => { if (e.target === e.currentTarget) showCoverSettings = false; }}>
    <div class="modal-content" style="background: var(--surface); padding: 1.5rem; border-radius: 8px; width: 320px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
      <h3 style="margin-top: 0; margin-bottom: 1rem; font-size: 1.1rem; color: var(--ink);">{locale.t.roms.gameDetailsPanel.screenScraperSettings.title}</h3>

      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div>
          <label style="display: block; font-size: 0.8rem; margin-bottom: 0.25rem; color: var(--ink-soft);">
            {locale.t.roms.gameDetailsPanel.screenScraperSettings.username}
            <input type="text" bind:value={ssUsername} style="width: 100%; padding: 0.4rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); margin-top: 0.25rem;" />
          </label>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; margin-bottom: 0.25rem; color: var(--ink-soft);">
            {locale.t.roms.gameDetailsPanel.screenScraperSettings.password}
            <input type="password" bind:value={ssPassword} style="width: 100%; padding: 0.4rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); margin-top: 0.25rem;" />
          </label>
        </div>

        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink); cursor: pointer;">
          <input type="checkbox" bind:checked={ssRemember} />
          {locale.t.roms.gameDetailsPanel.screenScraperSettings.rememberCredentials}
        </label>
        {#if ssRemember}
          <p style="font-size: 0.7rem; color: var(--ink-soft); margin: -0.25rem 0 0;">
            {locale.t.roms.gameDetailsPanel.screenScraperSettings.rememberNote}
          </p>
        {/if}

        <hr style="border: 0; border-top: 1px solid var(--hairline); margin: 0.5rem 0;" />

        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink); cursor: pointer;">
          <input type="checkbox" bind:checked={ssPreferLocal} />
          {locale.t.roms.gameDetailsPanel.screenScraperSettings.preferLocalCovers}
        </label>

        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink); cursor: pointer; {nativeFolderPickerSupported() ? '' : 'opacity: 0.5; cursor: not-allowed;'}">
          <input type="checkbox" bind:checked={ssSaveLocal} disabled={!nativeFolderPickerSupported()} />
          <div style="display: flex; flex-direction: column;">
            <span>{locale.t.roms.gameDetailsPanel.screenScraperSettings.saveToRomsFolder}</span>
            {#if !nativeFolderPickerSupported()}
              <span style="font-size: 0.7rem; color: var(--ink-soft); margin-top: 2px;">{locale.t.roms.gameDetailsPanel.screenScraperSettings.saveToRomsFolderFirefoxNote}</span>
            {/if}
          </div>
        </label>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
        <button onclick={() => showCoverSettings = false} style="padding: 0.4rem 1rem; border: none; border-radius: 4px; background: var(--hairline); color: var(--ink); cursor: pointer; font-size: 0.85rem; font-weight: 500;">
          {locale.t.shared.common.close}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showImportModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;" onclick={(e) => { if (e.target === e.currentTarget) showImportModal = false; }}>
    <div class="modal-content" style="background: var(--surface); padding: 1.5rem; border-radius: 8px; width: 600px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h3 style="margin: 0; font-size: 1.2rem; color: var(--ink);">{locale.t.roms.gameDetailsPanel.importModal.title}</h3>
        <button aria-label={locale.t.shared.common.close} onclick={() => { if (!isImporting) showImportModal = false; }} style="background: none; border: none; color: var(--ink-soft); cursor: pointer;" disabled={isImporting}>
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="consoles" style="margin-bottom: 0.5rem;">
        <button class="console" class:active={importFilterConsole === "all"} onclick={() => importFilterConsole = "all"}>
          {locale.t.roms.gameDetailsPanel.importModal.allFilterLabel(importGamesList.length)}
        </button>
        {#each romSelection.systems as s (s.system)}
          <button class="console" class:active={importFilterConsole === s.system} onclick={() => importFilterConsole = s.system}>
            {s.label} ({s.count})
          </button>
        {/each}
      </div>

      <div style="flex: 1; overflow-y: auto; border: 1px solid var(--hairline); border-radius: 4px; margin-bottom: 1rem;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
          <thead style="position: sticky; top: 0; background: var(--surface); border-bottom: 1px solid var(--hairline);">
            <tr>
              <th style="padding: 0.5rem; text-align: center; width: 40px;">
                <input type="checkbox" 
                  checked={sortedImportGames.length > 0 && sortedImportGames.every(g => importSelected.has(g.key))} 
                  indeterminate={sortedImportGames.some(g => importSelected.has(g.key)) && !sortedImportGames.every(g => importSelected.has(g.key))}
                  onchange={(e) => {
                    const isAllSelected = sortedImportGames.length > 0 && sortedImportGames.every(g => importSelected.has(g.key));
                    const next = new Set(importSelected);
                    if (isAllSelected) {
                      sortedImportGames.forEach(g => next.delete(g.key));
                    } else {
                      sortedImportGames.forEach(g => next.add(g.key));
                    }
                    importSelected = next;
                  }} 
                />
              </th>
              <th style="padding: 0.5rem; text-align: left;">{locale.t.roms.gameDetailsPanel.importModal.consoleColumn}</th>
              <th style="padding: 0.5rem; text-align: left; cursor: pointer;" onclick={() => { importSortBy = 'name'; importSortDesc = !importSortDesc; }}>
                {locale.t.roms.gameDetailsPanel.importModal.filenameColumn(importSortBy === 'name' ? (importSortDesc ? '▼' : '▲') : '')}
              </th>
              <th style="padding: 0.5rem; text-align: center; cursor: pointer;" onclick={() => { importSortBy = 'cover'; importSortDesc = !importSortDesc; }}>
                {locale.t.roms.gameDetailsPanel.importModal.coverColumn(importSortBy === 'cover' ? (importSortDesc ? '▼' : '▲') : '')}
              </th>
            </tr>
          </thead>
          <tbody>
            {#each sortedImportGames as g}
              <tr style="border-bottom: 1px solid var(--hairline);">
                <td style="padding: 0.4rem; text-align: center;">
                  <input type="checkbox" checked={importSelected.has(g.key)} onchange={(e) => {
                    const next = new Set(importSelected);
                    if (e.currentTarget.checked) next.add(g.key);
                    else next.delete(g.key);
                    importSelected = next;
                  }} />
                </td>
                <td style="padding: 0.4rem; color: var(--ink-soft);">{g.system.toUpperCase()}</td>
                <td style="padding: 0.4rem; color: var(--ink);">{g.name}</td>
                <td style="padding: 0.4rem; text-align: center;">
                  {#if g.hasCover}
                    <span style="color: green;">✓</span>
                  {:else}
                    <span style="color: var(--ink-soft); opacity: 0.5;">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
            {#if sortedImportGames.length === 0}
              <tr>
                <td colspan="4" style="padding: 1rem; text-align: center; color: var(--ink-soft);">{locale.t.roms.gameDetailsPanel.importModal.noGamesFound}</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink);">
          {locale.t.roms.gameDetailsPanel.importModal.defaultVariantLabel}
          <select bind:value={defaultVariant} style="padding: 0.3rem 0.5rem; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink);">
            <option value="box">{locale.t.roms.gameDetailsPanel.coverArt.variantBoxart}</option>
            <option value="ss">{locale.t.roms.gameDetailsPanel.coverArt.variantScreenshot}</option>
            <option value="mix3">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti3}</option>
            <option value="mix4">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti4}</option>
            <option value="mix5">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti5}</option>
          </select>
        </label>

        <div style="display: flex; gap: 0.5rem;">
          {#if isImporting}
            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--ink-soft); font-size: 0.8rem; margin-right: 1rem;">
              <span>{importProgress.current} / {importProgress.total}</span>
              <button onclick={() => isImporting = false} style="padding: 0.5rem 1rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); cursor: pointer; font-size: 0.85rem;">
                {locale.t.roms.gameDetailsPanel.importModal.stop}
              </button>
            </div>
          {:else}
            <button onclick={() => showImportModal = false} style="padding: 0.5rem 1rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); cursor: pointer; font-size: 0.85rem;">
              {locale.t.shared.common.cancel}
            </button>
            <button onclick={startImport} style="padding: 0.5rem 1rem; border: none; border-radius: 4px; background: var(--model-accent, #3b82f6); color: white; cursor: pointer; font-size: 0.85rem; font-weight: 500;" disabled={importSelected.size === 0}>
              {locale.t.roms.gameDetailsPanel.importModal.importSelected(importSelected.size)}
            </button>
          {/if}
        </div>
      </div>

      {#if importProgress.log.length > 0}
        <div style="margin-top: 1rem; max-height: 150px; overflow-y: auto; background: var(--hairline); border-radius: 4px; padding: 0.5rem; font-size: 0.75rem; font-family: monospace; color: var(--ink);">
          {#each importProgress.log as logEntry}
            <div>{logEntry}</div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .game-details-accordion details {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    margin-bottom: 0.5rem;
    overflow: hidden;
  }
  .game-details-accordion summary {
    padding: 0.75rem 1rem;
    font-weight: 600;
    cursor: pointer;
    background: var(--surface-sunk);
    user-select: none;
    border-bottom: 1px solid transparent;
    transition: background 0.2s;
  }
  .game-details-accordion summary:hover {
    background: var(--hairline);
  }
  .game-details-accordion details[open] summary {
    border-bottom-color: var(--hairline);
  }

  .consoles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .console {
    font: inherit;
    font-size: 0.75rem;
    color: var(--ink-soft);
    background: var(--surface-sunk, rgba(0,0,0,0.05));
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
    cursor: pointer;
  }
  .console.active {
    background: var(--surface);
    color: var(--ink);
    border-color: var(--model-accent, #3b82f6);
    font-weight: 600;
  }
  .details-panels {
    display: grid;
    grid-template-columns: 1fr 1fr 1.25fr;
    gap: 1rem;
    margin-top: 1rem;
  }
  
  .panel {
    background: var(--surface-sunk);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  
  .panel h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    font-weight: 600;
  }
  
  .panel hr {
    border: none;
    border-bottom: 1px solid var(--hairline);
    margin: 0 0 0.75rem 0;
  }
  
  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 200px;
    min-width: 0;
  }
  
  /* Saves */
  .saves-content {
    gap: 0.5rem;
    align-items: center;
  }
  .saves-overlay {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .saves-tabs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }
  .slot-tab {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--ink-soft);
    border-radius: 4px;
    padding: 0.15rem 0.4rem;
    font-size: var(--fs-micro);
    cursor: pointer;
  }
  .slot-tab.active {
    background: var(--model-accent, var(--brand-blue));
    color: #fff;
    border-color: var(--model-accent, var(--brand-blue));
  }
  
  .saves-preview-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
  }
  .arrow-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .arrow-btn:hover:not(:disabled) {
    color: var(--ink);
  }
  .arrow-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .saves-preview {

    width: 160px;
    height: 120px;
    background: #000;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    margin: 0.5rem 0;
  }
  .saves-preview img {
    max-width: 100%;
    max-height: 100%;
    image-rendering: pixelated;
  }
  .loading-box {
    color: #fff;
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .loading-box.empty {
    color: var(--ink-soft);
  }
  .btn {
    font-family: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    cursor: pointer;
    border-radius: 4px;
    border: none;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .download-btn {
    background: linear-gradient(180deg, #ffde6a 0%, #d4aa18 100%);
    color: #111;
    border: 1px solid #b38e0c;
    padding: 0.4rem 1rem;
    width: max-content;
  }

  /* Cheats */
  .cheats-content {
    flex-direction: column;
  }
  
  .cheats-panel.disabled {
    position: relative;
  }
  .cheats-panel.disabled .cheats-rows {
    opacity: 0.3;
    pointer-events: none;
    user-select: none;
  }
  .cheats-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface);
    padding: 0.5rem 1rem;
    border-radius: var(--r-control);
    border: 1px solid var(--hairline);
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  .cheats-rows {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }
  .cheats-row {
    min-width: 0;
    max-width: 100%;
  }
  .cheats-row-head {
    margin: 0 0 0.4rem 0;
    font-size: var(--fs-caption);
    font-weight: 600;
  }
  .presets-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 130px;
    overflow-y: auto;
  }
  .preset-label {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    font-size: var(--fs-micro);
    cursor: pointer;
    overflow: hidden;
    max-width: 100%;
    flex-shrink: 0;
  }
  .preset-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .manual-entry-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .manual-input-code {
    flex: 0 0 40%;
  }
  .manual-input-desc {
    flex: 1;
  }
  .manual-input-code, .manual-input-desc {
    font-family: var(--font-sans);
    font-size: var(--fs-micro);
    padding: 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    background: var(--surface);
    color: var(--ink);
    height: 2rem;
  }
  .manual-input-code.mono {
    font-family: var(--font-mono, monospace);
  }
  .detected-game-select {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    font-size: var(--fs-micro);
    padding: 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    background: var(--surface);
    color: var(--ink);
    height: 2rem;
  }
  .configured-cheats-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 160px;
    overflow-y: auto;
  }
  .configured-cheat-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.4rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    font-size: var(--fs-micro);
    flex-shrink: 0;
  }
  .cc-code {
    flex: 0 0 auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
  }
  .cc-desc {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .cc-remove {
    flex: 0 0 auto;
    background: none;
    border: none;
    color: var(--ink-soft);
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 2px;
    border-radius: 4px;
  }
  .cc-remove:hover {
    color: var(--danger, #d32f2f);
    background: rgba(0,0,0,0.05);
  }
  .add-cheat-btn {
    background: linear-gradient(180deg, #99e075 0%, #68a34a 100%);
    color: #fff;
    border: 1px solid #55873b;
    padding: 0.4rem;
    margin-top: auto;
  }
  
  .action {
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: #fff;
    background: var(--model-accent);
    border: 1px solid var(--model-accent);
    border-radius: var(--r-control);
    padding: 0.3rem 0.8rem;
    cursor: pointer;
  }
</style>
