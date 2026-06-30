<script lang="ts">
  import { fade, slide } from "svelte/transition";
  import { device } from "../device.svelte.js";
  import { runCovers } from "../screenscraper/run.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import cheatDbJson from "../engine/cheatdb.json";
  import { HOMEBREW_TITLES } from "../engine/homebrew.js";
  import { romSelection } from "../romSelection.svelte.js";
  import { roms } from "../roms.svelte.js";
  import { systemIdsFor } from "../screenscraper/config.js";
  import { saveFileToDirOrDownload, nativeFolderPickerSupported } from "../romScan.js";
  import JSZip from "jszip";

  const cheatDb = cheatDbJson as Record<string, Record<string, { c: string; e: string }[]>>;

  let {
    gameKey,
    gameName,
    system,
    coverUrl,
    configuredCheats = $bindable({}),
    onCoverChange
  }: {
    gameKey: string;
    gameName: string;
    system: string;
    coverUrl: string | null;
    configuredCheats: Record<string, string[]>;
    onCoverChange?: () => void;
  } = $props();

  const supportedCheatSystems: Record<string, string> = {
    nes: "NES", gb: "Game Boy", gbc: "Game Boy", pce: "PCE", msx: "MSX",
  };
  const isCheatSupported = $derived(!!supportedCheatSystems[system]);
  const dbConsoleName = $derived(supportedCheatSystems[system]);

  const presets = $derived.by(() => {
    if (!dbConsoleName || !cheatDb[dbConsoleName]) return [];
    const dbGames = cheatDb[dbConsoleName];
    const normalizedName = gameName.replace(/\.[^/.]+$/, "").toLowerCase();
    for (const key of Object.keys(dbGames)) {
      if (key.toLowerCase().includes(normalizedName) || normalizedName.includes(key.toLowerCase())) {
        return dbGames[key];
      }
    }
    return [];
  });

  function parseCheatCode(c: string) {
    return c.split(',')[0].trim();
  }
  function isPresetEnabled(p: {c: string; e: string}) {
    const list = configuredCheats[gameKey] || [];
    const cCode = parseCheatCode(p.c);
    return list.some(x => x.startsWith(cCode));
  }
  function togglePreset(p: {c: string; e: string}) {
    let list = configuredCheats[gameKey] || [];
    if (isPresetEnabled(p)) {
      list = list.filter(x => !x.startsWith(parseCheatCode(p.c)));
    } else {
      list = [...list, `${p.c}, ${p.e}`];
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
    if (!device.utilLoaded) return;
    loadingTree = true;
    try {
      const tree = await ensureLfsTree();
      lfsDataDir = tree.children?.find((c) => c.name === "data" && c.isDirectory) || null;
      lfsTreeReady = true;
    } catch (e) {
      console.error("LFS tree fetch failed", e);
    } finally {
      loadingTree = false;
    }
  }

  // Reload tree when RAM utility comes online
  let wasUtilLoaded = $state(false);
  $effect(() => {
    if (!wasUtilLoaded && device.utilLoaded) {
      if (gameKey && !loadingTree) {
        // Trigger fetch again
        lfsTreeReady = false;
        fetchTreeOnce().then(() => selectDefaultSlot());
      }
    }
    wasUtilLoaded = device.utilLoaded;
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
  let coverSource = $state<"file" | "scraper">(localStorage.getItem("ssUsername") ? "scraper" : "file");
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
        previewError = "ROM file not found.";
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
        previewError = "Cover not found.";
      }
    } catch (e: any) {
      previewError = "Error: " + (e.message || String(e));
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
    
    // Also save the high-res .png to memory so the UI prefers it immediately (since getCoverUrl checks .png first)
    const pngPath = coverPath.replace(/\.img$/, ".png");
    roms.scan?.userRoms.set(pngPath, new Uint8Array(await previewCoverBlob.arrayBuffer()));
    
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
  let ssUsername = $state(localStorage.getItem('ssUsername') || "");
  let ssPassword = $state(localStorage.getItem('ssPassword') || "");
  let ssRemember = $state(localStorage.getItem('ssRemember') === 'true');
  let ssPreferLocal = $state(localStorage.getItem('ssPreferLocal') !== 'false');
  let ssSaveLocal = $state(nativeFolderPickerSupported() && localStorage.getItem('ssSaveLocal') !== 'false');
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
            }
          } catch (e) {
            console.error("Failed to convert cover:", e);
          }
          
          // Also save the high-res .png to memory so the UI prefers it immediately
          const pngPath = imgPath.replace(/\.img$/, ".png");
          roms.scan?.userRoms.set(pngPath, new Uint8Array(await blob.arrayBuffer()));
          
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
    localStorage.setItem('ssRemember', ssRemember.toString());
    localStorage.setItem('ssPreferLocal', ssPreferLocal.toString());
    localStorage.setItem('ssSaveLocal', ssSaveLocal.toString());
    
    if (ssRemember) {
      localStorage.setItem('ssUsername', ssUsername);
      localStorage.setItem('ssPassword', ssPassword);
    } else {
      localStorage.removeItem('ssUsername');
      localStorage.removeItem('ssPassword');
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
        if (device.utilLoaded) {
          fetchTreeOnce().then(() => selectDefaultSlot());
        }
      }, 300); // 300ms debounce when scrubbing
    }
  });

  $effect(() => {
    if (selectedSlot && selectedSlot.rawFile && device.utilLoaded) {
      const p = selectedSlot.rawFile.path;
      downloadingScreenshot = true;
      screenshotDataUrl = null;
      readLfsFile(p).then(data => {
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

  async function downloadSaveFile(file: LittlefsTreeNode) {
    if (downloadingSave) return;
    downloadingSave = true;
    try {
      const data = await readLfsFile(file.path);
      const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to download: " + e);
    } finally {
      downloadingSave = false;
    }
  }

  const configuredCodesCount = $derived(
    (configuredCheats[gameKey] || []).reduce((t, l) => t + (l.split(',')[0].trim() ? l.split(',')[0].split('+').length : 0), 0)
  );
</script>

<div class="details-panels">
  <div class="panel">
    <div style="display: flex; justify-content: space-between; align-items: center; padding-right: 0.5rem;">
      <h3>Cover Art</h3>
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
          <button class="settings-btn" title="Import" onclick={openImportModal} style="background: none; border: none; cursor: pointer; color: var(--ink-soft); display: flex; padding: 4px; border-radius: 4px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
        {/if}
        <button class="settings-btn" title="Settings" onclick={() => showCoverSettings = true} style="background: none; border: none; cursor: pointer; color: var(--ink-soft); display: flex; padding: 4px; border-radius: 4px;">
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
        <label for="cover-source" style="font-size: var(--fs-micro); color: var(--ink-soft); font-weight: 500;">Source:</label>
        <select 
          id="cover-source" 
          bind:value={coverSource}
          style="padding: 0.2rem 0.4rem; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink); flex: 1; margin-left: 1rem; max-width: 120px;"
        >
          <option value="file">File</option>
          <option value="scraper">Scraper</option>
        </select>
      </div>
      
      {#if coverSource === 'scraper'}
        <div class="option-row" style="display: flex; align-items: center; justify-content: space-between;">
          <label for="cover-variant" style="font-size: var(--fs-micro); color: var(--ink-soft); font-weight: 500;">Variant:</label>
          <select 
            id="cover-variant" 
            bind:value={coverVariant}
            style="padding: 0.2rem 0.4rem; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink); flex: 1; margin-left: 1rem; max-width: 120px;"
          >
            <option value="box">Boxart</option>
            <option value="ss">Screenshot</option>
            <option value="mix3">Multi-3</option>
            <option value="mix4">Multi-4</option>
            <option value="mix5">Multi-5</option>
          </select>
        </div>
        
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--hairline); border-radius: 4px; background: rgba(0,0,0,0.05); min-height: 120px; position: relative;">
          {#if isGeneratingPreview}
            <span style="font-size: 0.75rem; color: var(--ink-soft);">Generating preview...</span>
          {:else if previewError}
            <span style="font-size: 0.75rem; color: var(--model-accent);">{previewError}</span>
          {:else if previewUrl}
            <img src={previewUrl} alt="Cover Preview" style="max-height: 120px; max-width: 100%; object-fit: contain;" />
          {:else}
            <span style="font-size: 0.75rem; color: var(--ink-soft);">Configure settings to preview</span>
          {/if}
        </div>
        
        <button onclick={applyPreview} disabled={!previewCoverBlob} style="padding: 0.4rem; background: var(--model-accent); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500; opacity: {previewCoverBlob ? 1 : 0.5};">
          Apply
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
          Drag & Drop or Click to override cover
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
            <span>Requests/Day</span>
            <span style="font-family: monospace;">{ssRequestsUsed} / {ssRequestsTotal}</span>
          </div>
          <div style="width: 100%; height: 4px; background: var(--hairline); border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: {(ssRequestsUsed / ssRequestsTotal) * 100}%; background: var(--ink);"></div>
          </div>
        </div>
      {/if}

      {#if (!nativeFolderPickerSupported() || !ssSaveLocal) && roms.scan}
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
                alert("No converted covers found.");
                return;
              }
              const blob = await zip.generateAsync({ type: "blob" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "covers-img.zip";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download converted covers (.img)
          </button>
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
                alert("No full-size covers found.");
                return;
              }
              const blob = await zip.generateAsync({ type: "blob" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "covers-fullsize.zip";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download full-size covers (.png/.jpg)
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="panel">
    <h3>Saves</h3>
    <hr />
    <div class="panel-content saves-content">
      {#if !device.utilLoaded}
        <div class="saves-overlay">
          <p class="muted">Run the RAM Flasher Util to view saves.</p>
          <button class="action" onclick={() => device.ensureStub()}>Connect</button>
        </div>
      {:else if loadingTree}
        <div class="saves-overlay">
          <p class="muted">Loading saves...</p>
        </div>
      {:else}
        <div class="saves-tabs">
          {#each gameSaves as slot}
            <button 
              class="slot-tab" 
              class:active={selectedSlot === slot}
              onclick={() => selectedSlot = slot}
            >
              {slot.slot === "sram" ? "SRAM" : `Slot ${slot.slot}`}
            </button>
          {/each}
          {#if gameSaves.length === 0}
            <span class="muted" style="font-size: var(--fs-micro);">No saves found</span>
          {/if}
        </div>
        
        <div class="saves-preview-container">
          <button 
            class="arrow-btn" 
            aria-label="Previous Save"
            disabled={!gameSaves.length || gameSaves.indexOf(selectedSlot!) <= 0}
            onclick={() => selectedSlot = gameSaves[gameSaves.indexOf(selectedSlot!) - 1]}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          
          <div class="saves-preview">
            {#if downloadingScreenshot}
              <div class="loading-box">Loading...</div>
            {:else if screenshotDataUrl}
              <img src={screenshotDataUrl} alt="Save Preview" />
            {:else if selectedSlot?.rawFile}
              <div class="loading-box">Failed to render</div>
            {:else}
              <div class="loading-box empty">No preview</div>
            {/if}
          </div>

          <button 
            class="arrow-btn" 
            aria-label="Next Save"
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
          Download Save
        </button>
      {/if}
    </div>
  </div>

  <div class="panel cheats-panel" class:disabled={!isCheatSupported}>
    <h3>Cheats</h3>
    <hr />
    <div class="panel-content cheats-content">
      
              {#if !isCheatSupported}
        <div class="cheats-overlay">
          <p class="muted">Unsupported Console</p>
        </div>
      {/if}
      
      <div class="cheats-columns">
          <div class="cheats-presets">
            <h4 class="cheats-col-head">Presets</h4>
            <div class="presets-list" class:disabled={presets.length === 0}>
              {#each presets as p}
                <label class="preset-label">
                  <input type="checkbox" checked={isPresetEnabled(p)} onchange={() => togglePreset(p)} />
                  <span class="preset-name">{p.e || "Cheat"}</span>
                </label>
              {/each}
              {#if presets.length === 0}
                <span class="muted" style="font-size: var(--fs-micro);">No presets found</span>
                <span class="muted" style="font-size: var(--fs-micro);">No presets found</span>
              {/if}
            </div>
          </div>
          
          <div class="cheats-manual">
            <h4 class="cheats-col-head">Manual Entry</h4>
            <input type="text" class="manual-input" placeholder="Code" bind:value={manualCode} />
            <textarea class="manual-textarea" placeholder="Description" bind:value={manualDesc}></textarea>
            <button class="btn add-cheat-btn" disabled={!manualCode.trim() || configuredCodesCount >= 13} onclick={addManual}>
              Add Cheat
            </button>
          </div>
        </div>
    </div>
  </div>
</div>

{#if showCoverSettings}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;" onclick={(e) => { if (e.target === e.currentTarget) showCoverSettings = false; }}>
    <div class="modal-content" style="background: var(--surface); padding: 1.5rem; border-radius: 8px; width: 320px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
      <h3 style="margin-top: 0; margin-bottom: 1rem; font-size: 1.1rem; color: var(--ink);">ScreenScraper Settings</h3>
      
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div>
          <label style="display: block; font-size: 0.8rem; margin-bottom: 0.25rem; color: var(--ink-soft);">
            Username
            <input type="text" bind:value={ssUsername} style="width: 100%; padding: 0.4rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); margin-top: 0.25rem;" />
          </label>
        </div>
        
        <div>
          <label style="display: block; font-size: 0.8rem; margin-bottom: 0.25rem; color: var(--ink-soft);">
            Password
            <input type="password" bind:value={ssPassword} style="width: 100%; padding: 0.4rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); margin-top: 0.25rem;" />
          </label>
        </div>

        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink); cursor: pointer;">
          <input type="checkbox" bind:checked={ssRemember} />
          Remember credentials
        </label>
        
        <hr style="border: 0; border-top: 1px solid var(--hairline); margin: 0.5rem 0;" />

        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink); cursor: pointer;">
          <input type="checkbox" bind:checked={ssPreferLocal} />
          Prefer local covers
        </label>
        
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink); cursor: pointer; {nativeFolderPickerSupported() ? '' : 'opacity: 0.5; cursor: not-allowed;'}">
          <input type="checkbox" bind:checked={ssSaveLocal} disabled={!nativeFolderPickerSupported()} />
          <div style="display: flex; flex-direction: column;">
            <span>Save downloaded covers to roms folder</span>
            {#if !nativeFolderPickerSupported()}
              <span style="font-size: 0.7rem; color: var(--ink-soft); margin-top: 2px;">(Not supported in Firefox. Use 'Download all covers' instead.)</span>
            {/if}
          </div>
        </label>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
        <button onclick={() => showCoverSettings = false} style="padding: 0.4rem 1rem; border: none; border-radius: 4px; background: var(--hairline); color: var(--ink); cursor: pointer; font-size: 0.85rem; font-weight: 500;">
          Close
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
        <h3 style="margin: 0; font-size: 1.2rem; color: var(--ink);">Import Covers</h3>
        <button aria-label="Close" onclick={() => { if (!isImporting) showImportModal = false; }} style="background: none; border: none; color: var(--ink-soft); cursor: pointer;" disabled={isImporting}>
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="consoles" style="margin-bottom: 0.5rem;">
        <button class="console" class:active={importFilterConsole === "all"} onclick={() => importFilterConsole = "all"}>
          All ({importGamesList.length})
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
              <th style="padding: 0.5rem; text-align: left;">Console</th>
              <th style="padding: 0.5rem; text-align: left; cursor: pointer;" onclick={() => { importSortBy = 'name'; importSortDesc = !importSortDesc; }}>
                Filename {importSortBy === 'name' ? (importSortDesc ? '▼' : '▲') : ''}
              </th>
              <th style="padding: 0.5rem; text-align: center; cursor: pointer;" onclick={() => { importSortBy = 'cover'; importSortDesc = !importSortDesc; }}>
                Cover {importSortBy === 'cover' ? (importSortDesc ? '▼' : '▲') : ''}
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
                <td colspan="4" style="padding: 1rem; text-align: center; color: var(--ink-soft);">No games found</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--ink);">
          Default Variant:
          <select bind:value={defaultVariant} style="padding: 0.3rem 0.5rem; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink);">
            <option value="box">Boxart</option>
            <option value="ss">Screenshot</option>
            <option value="mix3">Multi-3</option>
            <option value="mix4">Multi-4</option>
            <option value="mix5">Multi-5</option>
          </select>
        </label>

        <div style="display: flex; gap: 0.5rem;">
          {#if isImporting}
            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--ink-soft); font-size: 0.8rem; margin-right: 1rem;">
              <span>{importProgress.current} / {importProgress.total}</span>
              <button onclick={() => isImporting = false} style="padding: 0.5rem 1rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); cursor: pointer; font-size: 0.85rem;">
                Stop
              </button>
            </div>
          {:else}
            <button onclick={() => showImportModal = false} style="padding: 0.5rem 1rem; border: 1px solid var(--hairline); border-radius: 4px; background: transparent; color: var(--ink); cursor: pointer; font-size: 0.85rem;">
              Cancel
            </button>
            <button onclick={startImport} style="padding: 0.5rem 1rem; border: none; border-radius: 4px; background: var(--model-accent, #3b82f6); color: white; cursor: pointer; font-size: 0.85rem; font-weight: 500;" disabled={importSelected.size === 0}>
              Import {importSelected.size} Selected
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
  
  .presets-list.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  
  .cheats-panel.disabled {
    position: relative;
  }
  .cheats-panel.disabled .cheats-columns {
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
  .cheats-columns {


    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    flex: 1;
  }
  .cheats-col-head {
    margin: 0 0 0.5rem 0;
    font-size: var(--fs-caption);
    font-weight: 600;
  }
  .presets-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 180px;
    overflow-y: auto;
  }
  .preset-label {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    font-size: var(--fs-micro);
    cursor: pointer;
  }
  .preset-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cheats-manual {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .manual-input, .manual-textarea {
    width: 100%;
    font-family: var(--font-sans);
    font-size: var(--fs-micro);
    padding: 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    background: var(--surface);
    color: var(--ink);
  }
  .manual-textarea {
    resize: vertical;
    min-height: 60px;
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
