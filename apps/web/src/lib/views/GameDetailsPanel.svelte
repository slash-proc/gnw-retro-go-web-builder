<script module lang="ts">
  // Module-level (not per-instance) so it survives this component being torn down and
  // recreated — which happens whenever selectedCarouselId transiently clears (e.g. the
  // currently-selected game leaving the filtered list on a console-filter change, or any
  // other selection churn in RomManagementTab.svelte). A plain instance-scoped $state or
  // native <details> DOM state would silently reset to closed on every one of those remounts.
  let additionalOptionsOpen = $state(false);
</script>

<script lang="ts">
  import { scoped } from "../storageScope.js";
  import { fade, slide } from "svelte/transition";
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { fetchAccount, runCovers } from "../screenscraper/run.js";
  import { dbg } from "../debug.js";
  import { auditLog } from "../auditLog.svelte.js";
  import { literal, msg } from "../logEntry.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import { MCF_WHOLE_FILE_SYSTEMS, findMcfPreset, mcfAssetUrl, loadCheatsForSystem, resolveCheatGame, type Cheat, type CheatGame } from "../cheats/index.js";
  import { onMount } from "svelte";
  import { homebrew } from "../sources/homebrewTitles.svelte.js";
  import { romSelection } from "../romSelection.svelte.js";
  import { library } from "../library.svelte.js";
  import { systemIdsFor, isKnownSystemFolder } from "../screenscraper/config.js";
  import { coverSystemFor } from "../sources/coverSystem.js";
  import { basePath } from "../sources/libraryScan.js";
  import { coreRegistry } from "../sources/coreRegistry.svelte.js";
  import { saveFileToDirOrDownload, nativeFolderPickerSupported, romBytes } from "../romScan.js";
  import { isLazy } from "../lazyBytes.js";
  import { obfuscate, deobfuscate } from "../localCrypt.js";
  import { download } from "../util.js";
  import JSZip from "jszip";


  // ScreenScraper credentials and preferences. These predate `persist.ts` and are read with
  // bare `localStorage` calls, so they are scoped HERE rather than inheriting `persist.ts`'s
  // namespace. A non-production build must not read a production user's saved login.
  const SS_KEYS = {
    ssUsername: scoped("gnw:ssUsername"),
    ssPassword: scoped("gnw:ssPassword"),
    ssRemember: scoped("gnw:ssRemember"),
    ssPreferLocal: scoped("gnw:ssPreferLocal"),
    ssSaveLocal: scoped("gnw:ssSaveLocal"),
  } as const;

  let {
    gameKey,
    gameName,
    system,
    coverUrl,
    configuredCheats = $bindable({}),
    configuredCheatFiles = $bindable({}),
    onCoverChange,
    bare = false
  }: {
    gameKey: string;
    gameName: string;
    system: string;
    coverUrl: string | null;
    configuredCheats: Record<string, string[]>;
    configuredCheatFiles: Record<string, Uint8Array>;
    onCoverChange?: () => void;
    /** Render the panel body directly, with no <details>/<summary> accordion chrome and with
     *  the three sub-panels un-boxed — for hosts that already provide a surface and a title
     *  (the Library tab's "Additional options" drawer). Default false keeps the accordion. */
    bare?: boolean;
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
      .catch((e) => {
        // THE DATABASE NEVER ARRIVED. This swallowed, and swallowing made the Cheats tab
        // indistinguishable from a game with no cheats: `systemGames` stays null, so the
        // `[cheats]` line below never runs either and the log showed nothing at all. The
        // owner spent a round on "cheats do not auto-detect" with this as a live possibility.
        //
        // `queueMicrotask` even though a `.catch()` callback already runs after the flush:
        // the rule `test/effectloop.mjs` pins is textual and cannot tell the two apart, and
        // writing state from inside an $effect body is not a thing to get right by argument.
        queueMicrotask(() =>
          auditLog.add(
            "error",
            "sources",
            msg((t) => t.shared.auditLog.cheatsFailed, e instanceof Error ? e.message : String(e)),
            sys,
          ),
        );
      });
  });
  // One matcher, in cheats/index.ts. This used to be an inline exact-key Map lookup here while
  // an unused findGameCheats() sat in the module, which is how the filename shapes the ladder
  // now handles went unreachable without anything failing.
  const autoDetectedGame = $derived.by((): CheatGame | null => {
    if (!systemGames) return null;
    const hit = resolveCheatGame(systemGames, gameName);
    return hit?.game ?? null;
  });
  /**
   * The whole hop in one line: the row's system id, the database that id chose, how many titles
   * it holds and what the filename resolved to. A cheat that does not auto-detect has three
   * places to fail -- the id, the database selection, the match -- and they are indistinguishable
   * from the outside, which cost a wrong diagnosis already.
   *
   * TWO HAZARDS, and each one broke this tab once. Change nothing here without reading both.
   *
   * 1. It may not live in the `$derived` above. `dbg()` writes through its sink into `auditLog`,
   *    which assigns `$state`, and assigning state inside a `$derived` throws
   *    `state_unsafe_mutation`. That took the Cheats tab down.
   * 2. The `dbg()` call may not run SYNCHRONOUSLY inside this effect either. `auditLog.add()`
   *    assigns `$state`, and a state write performed during the effect flush re-dirties the
   *    batch this effect belongs to, so the effect runs again, writes again, and the runtime
   *    ends it with `effect_update_depth_exceeded`. `untrack()` does NOT help -- measured, not
   *    assumed: synchronous and untracked both ran 301 times in `test/effectloop.mjs`'s probe,
   *    deferred ran once.
   *
   *    That error aborts the whole effect flush, so EVERY effect declared after this one stops
   *    running too. That is how moving the call here to fix hazard 1 took out the SAVES tab as
   *    well (its LFS-tree loader is the next effect down), while Cover art, which needs no
   *    effect, went on working.
   *
   * So: build the line inside the effect, where the values are right, and hand it to `dbg()`
   * outside the flush. A diagnostic has no business taking part in the reactive graph.
   */
  $effect(() => {
    if (!systemGames) return;
    const line = `[cheats] ${JSON.stringify({
      system, db: dbConsoleName ?? null, titles: systemGames.size,
      file: gameName, match: autoDetectedGame?.title ?? null,
    })}`;
    queueMicrotask(() => dbg(line));
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
        if (library.scan) {
          for (const [path, data] of library.scan.userRoms) {
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
      dbg(`[saves] reading the device save tree failed: ${e instanceof Error ? e.message : String(e)}`);
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
      const hb = homebrew.titles.find(h => h.key === gameKey || h.label === gameName);
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
  // Defaults to the scraper whether or not an account is saved: it works without one, and the
  // file picker is the deliberate choice (a cover you already have), not the fallback.
  let coverSource = $state<"file" | "scraper">("scraper");
  let coverVariant = $state<"box" | "ss" | "mix3" | "mix4" | "mix5">("box");
  let lastScrapeLog = "";
  let missLog = "";
  
  let previewCoverBlob = $state<Blob | null>(null);
  /** The preview came from the ladder's last rung, a name search with no system. A guess. */
  let previewIsGuess = $state(false);
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
    // NO ACCOUNT NEEDED. ScreenScraper authenticates on the app's DEVELOPER credentials; a user
    // account only raises the quota. Requiring a username here meant someone with no account,
    // or one they had lost the password to, could not scrape at all -- and `readCreds` already
    // omits an empty login, so the anonymous path was always there and simply unreachable.
    if (coverSource !== "scraper") return;
    isGeneratingPreview = true;
    previewError = null;
    previewCoverBlob = null;
    previewIsGuess = false;
    /** The scraper's last line, so a miss can say WHICH miss. Cleared per run, not per app. */
    lastScrapeLog = "";
    missLog = "";
    
    const hb = homebrew.find(basePath(gameKey));
    let buffer: Uint8Array | undefined;
    
    let filename = "";
    let webkitPath = "";
    let sysId: number | null = null;
    /** The manifest's `originalName`, used AS GIVEN when stated. Null means "use the filename". */
    let lookupName: string | null = null;
    
    if (hb && !hb.originalSystem) {
      // No `originalSystem` on the manifest (spec/03-manifest.md) means we have no idea which
      // art library this title belongs to, and a name-based search on a homebrew is a guess we
      // are not willing to make. Say so plainly rather than scraping blind or doing nothing.
      previewError = locale.t.roms.gameDetailsPanel.coverArt.errNoOriginalSystem;
      isGeneratingPreview = false;
      return;
    }

    if (hb) {
      // Try to find the converter's source file to get a real hash. Matched by EXTENSION now
      // (the manifest names inputs by extension + hash, never by filename), so the user may
      // call it whatever they like.
      if (hb.sourceExtensions.length > 0 && library.scan) {
        for (const [k, v] of library.scan.userRoms) {
          const dot = k.lastIndexOf(".");
          if (dot >= 0 && hb.sourceExtensions.includes(k.slice(dot).toLowerCase())) {
            buffer = await romBytes(v);
            break;
          }
        }
      }
      // If we couldn't find the source file, use a dummy buffer (NOT 0-bytes) so we don't hit the 0-byte Amstrad game collision, forcing a name-based search.
      if (!buffer) {
        buffer = new TextEncoder().encode("dummy_data_for_homebrew_" + hb.key);
      }

      filename = hb.displayName;
      // `webkitPath` is a LOOKUP SOURCE, not a destination: the scraper reads the parent
      // directory of this synthetic path to decide which system to search (screenscraper/
      // scanner.js). The manifest's `originalSystem` is exactly that hint, so it names the
      // directory here. Where the resulting cover is FILED on the device is decided
      // separately by applyPreview() and stays `covers/homebrew/` — unchanged.
      // The absent case never reaches this branch (guarded above).
      webkitPath = `root/${hb.originalSystem}/${filename}`;
      const ids = systemIdsFor(hb.originalSystem!);
      sysId = ids.length > 0 ? ids[0] : null;
      // A project's name is not the work's name: ScreenScraper has no "ccleste" and no
      // "zelda3", it has "Celeste Classic" and "The Legend of Zelda - A Link to the Past".
      lookupName = hb.originalName ?? null;
    } else {
      const romEntry = library.scan?.userRoms.get(gameKey);
      buffer = romEntry ? await romBytes(romEntry) : undefined;
      if (!buffer) {
        previewError = locale.t.roms.gameDetailsPanel.coverArt.errRomNotFound;
        isGeneratingPreview = false;
        return;
      }
      // basePath first: a doubled ROM's key carries a `\0<id>` suffix, and handing that to the
      // scraper searches for a filename no database can hold.
      const parts = basePath(gameKey).split("/");
      filename = parts.pop() || "unknown.rom";
      // THE FOLDER IS NOT ALWAYS A CONSOLE. `doom/` is the Doom core's ingest folder, and
      // ScreenScraper has no `doom` platform, so deriving from the folder alone could only fail
      // there ("Unknown system for doom.wad (folder 'doom')"). Where a core owns the folder, its
      // manifest's `originalSystem` says which art library the work belongs to, and that value
      // resolves through ScreenScraper's own shortcodes -- "dos" reaches PC Dos with nothing
      // hand-written. See sources/coverSystem.ts for why the folder is still tried first.
      const resolved = coverSystemFor(
        gameKey,
        coreRegistry.current.systems,
        homebrew.titles,
        isKnownSystemFolder,
      );
      if (resolved.kind === "unstated") {
        // Same reasoning as the homebrew branch above, and the same string: with no
        // `originalSystem` we have no idea which art library this belongs to, and a name-based
        // search on a converter's output is a guess we are not willing to make.
        previewError = locale.t.roms.gameDetailsPanel.coverArt.errNoOriginalSystem;
        isGeneratingPreview = false;
        return;
      }
      if (resolved.kind === "manifest") {
        // `webkitPath` is a LOOKUP SOURCE, not a destination: the scraper reads the parent
        // directory to decide which system to search. Where the cover is FILED is decided by
        // applyPreview() and is unchanged.
        webkitPath = `root/${resolved.system}/${filename}`;
        const ids = systemIdsFor(resolved.system);
        sysId = ids.length > 0 ? ids[0] : null;
        lookupName = resolved.name ?? null;
      } else {
        // A real console folder, or a folder nothing claims. Unchanged: the scraper derives the
        // system from the path and, where it cannot, says so naming the folder.
        webkitPath = "root/" + gameKey;
      }
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
        forceName: lookupName,
      }, {
        // THE SCRAPER EXPLAINS ITSELF; DO NOT DISCARD IT. This was `() => {}`, and the panel
        // then rendered one opaque "Cover not found." for four different outcomes -- no system
        // for the folder, no game for the hash, no media of the requested type, or the image
        // fetch failing. Diagnosing a miss meant reading the source and guessing which.
        //
        // Kept BOTH: `dbg` for the whole run, and the last line held for the panel. `dbg` alone
        // was not enough -- it lands in the Activity pane at `debug` severity, which that pane's
        // "all" filter deliberately excludes, so the answer was there and invisible unless you
        // already knew to turn debug on. The person who needs it is looking at this panel.
        //
        // Runtime text from the scraper (a filename, a media type), not UI copy, so it rides
        // `errPrefix` rather than needing a string table entry, the same way a device error does.
        onLog: (msg: string) => { lastScrapeLog = msg; dbg("[cover]", msg); },
        // THE LINE AT THE MOMENT OF THE MISS, not the last line of the run. Every run ends with
        // a summary ("No image produced -- no .zip."), which is CoverStudio's batch-zip
        // vocabulary, means nothing for one cover, and clobbered the useful line. The scraper
        // logs the real reason immediately before reporting each miss, so the line standing when
        // `onMiss` fires IS that reason.
        onMiss: () => { missLog = lastScrapeLog; },
        onProgress: () => {},
        onStatus: () => {},
        // @ts-ignore
        onAccount: (acc: any) => {
          if (acc.perDay) ssRequestsTotal = acc.perDay;
          if (acc.used !== null) ssRequestsUsed = acc.used;
        },
        onCover: (cover: any) => {
          previewCoverBlob = cover.blob;
          // WHICH RUNG FOUND IT. The unscoped search can be confidently wrong -- "mine sweeper"
          // returns hits on Master System, Atari 2600 and Atari ST, none of them this homebrew --
          // so a cover from it must not sit there looking like a hash match.
          previewIsGuess = cover.rung === "unscoped";
        },
        shouldCancel: () => false
      });
      
      if (!previewCoverBlob) {
        previewError = missLog
          ? locale.t.roms.gameDetailsPanel.coverArt.errPrefix(missLog.trim())
          : locale.t.roms.gameDetailsPanel.coverArt.errCoverNotFound;
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
      dbg(`[covers] converting the cover to JPEG failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // The RAW key can carry a duplicate id (`<path>\0<id>`, sources/libraryScan.ts): a second
    // folder's differing file under the same name. That module states the rule this once
    // broke -- `basePath()` is the ONLY thing that may derive a SIBLING path (a cover, a cheat
    // file) from a key. Without it a cover for a doubled ROM was written under a key holding a
    // NUL byte, which `getCoverUrl()` (which does strip) can never read back, so the cover
    // survived exactly as long as the in-memory map that received it and was gone on reload.
    const rowPath = basePath(gameKey);
    const hb = homebrew.find(rowPath);
    let coverPath = "";
    let baseName = "";
    const parts = rowPath.split("/");

    if (hb) {
      baseName = hb.displayName;
      coverPath = `covers/homebrew/${baseName}.img`;
    } else {
      const filename = parts[parts.length - 1];
      baseName = filename.replace(/\.[^/.]+$/, "");
      coverPath = "covers/" + parts.slice(0, -1).join("/") + "/" + baseName + ".img";
    }
    
    library.scan?.userRoms.set(coverPath, arr);
    library.markDirty(coverPath);
    
    // Also save the high-res .png to memory so the UI prefers it immediately (since getCoverUrl checks .png first)
    const pngPath = coverPath.replace(/\.img$/, ".png");
    library.scan?.userRoms.set(pngPath, new Uint8Array(await previewCoverBlob.arrayBuffer()));
    library.markDirty(pngPath);
    
    // If an inline cover exists in memory, remove it so the UI doesn't prioritize the old stale inline cover over the new covers/ one!
    let prefix = parts.slice(0, -1).join("/");
    if (hb) prefix = "homebrew";
    
    const inlineImg = prefix ? `${prefix}/${baseName}.img` : `${baseName}.img`;
    const inlinePng = prefix ? `${prefix}/${baseName}.png` : `${baseName}.png`;
    const inlineJpg = prefix ? `${prefix}/${baseName}.jpg` : `${baseName}.jpg`;
    if (library.scan?.userRoms.has(inlineImg)) library.scan.userRoms.delete(inlineImg);
    if (library.scan?.userRoms.has(inlinePng)) library.scan.userRoms.delete(inlinePng);
    if (library.scan?.userRoms.has(inlineJpg)) library.scan.userRoms.delete(inlineJpg);
    
    // Save ORIGINAL cover to disk (not the converted .img — conversion is session-only)
    if (ssSaveLocal && nativeFolderPickerSupported() && library.scan?.dir) {
      try {
        let relativePath = baseName + ".png";
        let isRomsFolder = library.scan.dir.name.toLowerCase() === "roms";
        
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
        
        await saveFileToDirOrDownload(library.writeDirFor(rowPath) ?? library.scan.dir, relativePath, previewCoverBlob);
      } catch (e) {
        // The owner reported covers that "work for the session and then disappear". A
        // write-back that failed said so only in devtools, which a deployed build has no
        // way to show him.
        dbg(`[covers] writing the applied cover to disk failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    if (onCoverChange) onCoverChange();
  }

  // --- ScreenScraper State ---
  let showCoverSettings = $state(false);
  let ssUsername = $state(localStorage.getItem(SS_KEYS.ssUsername) || "");
  // Obfuscated at rest (see localCrypt.ts) — decoded async right after init, below.
  let ssPassword = $state("");
  (async () => {
    ssPassword = await deobfuscate(localStorage.getItem(SS_KEYS.ssPassword));
  })();
  let ssRemember = $state(localStorage.getItem(SS_KEYS.ssRemember) === 'true');
  let ssPreferLocal = $state(localStorage.getItem(SS_KEYS.ssPreferLocal) !== 'false');
  let ssSaveLocal = $state(nativeFolderPickerSupported() && localStorage.getItem(SS_KEYS.ssSaveLocal) !== 'false');
  let ssRequestsTotal = $state<number | null>(null);
  let ssRequestsUsed = $state<number | null>(null);
  let ssQuota = $state<any>(null);
  let quotaRequestId = 0;
  let quotaTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const username = ssUsername.trim();
    const password = ssPassword;
    const requestId = ++quotaRequestId;

    if (!username || !password) {
      ssQuota = null;
      ssRequestsTotal = null;
      ssRequestsUsed = null;
      return;
    }

    quotaTimer = setTimeout(() => {
      fetchAccount(username, password).then((quota) => {
        if (requestId !== quotaRequestId) return;
        if (quota.status !== "ok" || quota.perDay === null || quota.today === null) {
          ssQuota = null;
          ssRequestsTotal = null;
          ssRequestsUsed = null;
          return;
        }
        ssQuota = quota;
        ssRequestsTotal = quota.perDay;
        ssRequestsUsed = quota.today;
      }).catch(() => {
        if (requestId !== quotaRequestId) return;
        ssQuota = null;
        ssRequestsTotal = null;
        ssRequestsUsed = null;
      });
    }, 350);

    return () => {
      if (quotaTimer) clearTimeout(quotaTimer);
    };
  });

  // --- Import Modal State ---
  let showImportModal = $state(false);
  let importSelected = $state<Set<string>>(new Set());
  let importSortBy = $state<"name" | "cover">("name");
  let importSortDesc = $state(false);
  let importFilterConsole = $state<string>("all");
  let defaultVariant = $state<"box" | "ss" | "mix3" | "mix4" | "mix5">("box");
  
  let isImporting = $state(false);
  let importProgress = $state({ current: 0, total: 0 });
  let showGeneratedCovers = $state(true);
  let skipExistingCovers = $state(true);
  let importPreviewBlob = $state<Blob | null>(null);
  let importPreviewUrl = $state<string | null>(null);
  let importPreviewMessage = $state<string | null>(null);

  $effect(() => {
    if (!importPreviewBlob) {
      importPreviewUrl = null;
      return;
    }
    const url = URL.createObjectURL(importPreviewBlob);
    importPreviewUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  async function startImport() {
    isImporting = true;
    importPreviewBlob = null;
    importPreviewMessage = null;
    
    const filesToScrape: File[] = [];
    const coverSourceDirs = new Map<string, RomDirHandle>();
    const keysToImport = [...importSelected].filter(key => !skipExistingCovers || !hasLocalCover(key));
    for (const key of keysToImport) {
      const entry = library.scan?.userRoms.get(key);
      if (!entry) continue;
      const buffer = await romBytes(entry);
      const parts = key.split("/");
      const filename = parts.pop();
      if (!filename) continue;
      const file = new File([buffer as BlobPart], filename);
      
      // Same rule as generatePreview(): a homebrew with no `originalSystem` has no art
      // library to search, so it is SKIPPED rather than scraped blind by name. The directory
      // in this synthetic path is the scraper's system hint, not a destination.
      const hb = homebrew.find(key);
      if (hb && !hb.originalSystem) {
        dbg(`[covers] ${filename}: ${locale.t.roms.gameDetailsPanel.coverArt.errNoOriginalSystem}`);
        continue;
      }
      const webkitPath = hb ? `root/${hb.originalSystem}/${filename}` : `root/${key}`;
      
      Object.defineProperty(file, 'webkitRelativePath', { value: webkitPath });
      filesToScrape.push(file);
      const sourceDir = library.writeDirFor(key) ?? library.scan?.dir;
      if (sourceDir) coverSourceDirs.set(key.toLowerCase(), sourceDir);
      // The scraper now owns this File copy for the batch. Release the decoded source cache so
      // a large mass import does not retain two copies of every selected ROM.
      if (isLazy(entry)) entry.release?.();
    }

    importProgress = { current: 0, total: filesToScrape.length };
    if (filesToScrape.length === 0) {
      isImporting = false;
      return;
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
        quota: ssQuota?.status === "ok" ? ssQuota : null,
      }, {
        onLog: (msg: string) => {
          dbg(`[cover] ${msg}`);
        },
        onMiss: (miss: any) => {
          if (showGeneratedCovers) {
            importPreviewBlob = null;
            importPreviewMessage = locale.t.roms.gameDetailsPanel.importModal.coverNotFound(miss.name);
          }
          auditLog.add(
            "warning",
            "sources",
            literal(`Cover not scraped: ${miss.name} (${miss.reason})`),
            miss.name,
          );
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
          if (showGeneratedCovers) {
            importPreviewMessage = null;
            importPreviewBlob = blob;
          }
          
          // Re-map back to homebrew/ if this was a homebrew title we injected a console dir for
          const hb = homebrew.titles.find(t => t.displayName === name || t.key === name);
          let relPath = outputPath.startsWith("root/") ? outputPath.slice(5) : outputPath;
          // GW conversion already returns a `covers/...` path. Normalize that prefix before the
          // handler constructs its canonical `covers/<path>.img` and `.png` entries; otherwise
          // the first imported Doom cover is stored as `covers/covers/doom/...` and disappears
          // after reload because the reader only checks the single-prefix form.
          if (relPath.startsWith("covers/")) relPath = relPath.slice("covers/".length);
          if (hb) {
            // Replace the injected console directory with "homebrew" (a no-op when none was
            // published and we already filed it under homebrew/)
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
              library.scan?.userRoms.set(imgPath, new Uint8Array(await gwBlob.arrayBuffer()));
              if (library.scan) library.markDirty(imgPath);
            }
          } catch (e) {
            dbg(`[covers] converting a scraped cover failed: ${e instanceof Error ? e.message : String(e)}`);
          }
          
          // Also save the high-res .png to memory so the UI prefers it immediately
          const pngPath = imgPath.replace(/\.img$/, ".png");
          library.scan?.userRoms.set(pngPath, new Uint8Array(await blob.arrayBuffer()));
          if (library.scan) library.markDirty(pngPath);
          
          const inlineImgPath = relPath.replace(/\.[^/.]+$/, ".img");
          const inlinePngPath = relPath.replace(/\.[^/.]+$/, ".png");
          const inlineJpgPath = relPath.replace(/\.[^/.]+$/, ".jpg");
          if (library.scan?.userRoms.has(inlineImgPath)) library.scan.userRoms.delete(inlineImgPath);
          if (library.scan?.userRoms.has(inlinePngPath)) library.scan.userRoms.delete(inlinePngPath);
          if (library.scan?.userRoms.has(inlineJpgPath)) library.scan.userRoms.delete(inlineJpgPath);
          
          // Save ORIGINAL format to disk (not the converted .img)
          if (ssSaveLocal && nativeFolderPickerSupported() && library.scan?.dir) {
            try {
              const parts = relPath.split("/");
              let relativePath = parts[parts.length - 1];
              let isRomsFolder = library.scan.dir.name.toLowerCase() === "roms";
              
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
              
              const coverSource = coverSourceDirs.get(relPath.toLowerCase())
                ?? library.writeDirFor(relPath)
                ?? library.scan.dir;
              await saveFileToDirOrDownload(coverSource, relativePath, blob);
            } catch (e) {
              dbg(`[covers] writing a scraped cover to disk failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          
          if (onCoverChange) onCoverChange();
        },
        shouldCancel: () => !isImporting
      });
      importSelected = new Set();
      showImportModal = false;
    } catch (e: any) {
      dbg(`[covers] the cover import failed: ${e?.message || String(e)}`);
      auditLog.add(
        "error",
        "sources",
        literal(`Cover import failed: ${e?.message || String(e)}`),
        "cover import",
      );
    } finally {
      isImporting = false;
    }
  }

  function hasLocalCover(gameKey: string) {
    // Same sibling-path rule as applyPreview above: strip the duplicate id first, or a doubled
    // ROM reports no cover however many it has.
    const rowPath = basePath(gameKey);
    const hb = homebrew.find(rowPath);
    let coverPathBase = "";

    if (hb) {
      coverPathBase = `covers/homebrew/${hb.displayName}`;
    } else {
      const parts = rowPath.split("/");
      if (parts.length < 2) return false;
      const filename = parts[parts.length - 1];
      const baseName = filename.replace(/\.[^/.]+$/, "");
      coverPathBase = "covers/" + parts.slice(0, -1).join("/") + "/" + baseName;
    }
    
    for (const ext of [".img", ".png", ".jpg", ".jpeg"]) {
      if (library.scan?.userRoms.has(`${coverPathBase}${ext}`)) return true;
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

  let importableSelectedCount = $derived(
    [...importSelected].filter(key => !skipExistingCovers || !hasLocalCover(key)).length
  );



  $effect(() => {
    localStorage.setItem(SS_KEYS.ssRemember, ssRemember.toString());
    localStorage.setItem(SS_KEYS.ssPreferLocal, ssPreferLocal.toString());
    localStorage.setItem(SS_KEYS.ssSaveLocal, ssSaveLocal.toString());

    if (ssRemember) {
      localStorage.setItem(SS_KEYS.ssUsername, ssUsername);
      // Obfuscated, not encrypted with a user secret — see localCrypt.ts's header comment.
      // Deters casual plaintext exposure (devtools/localStorage dumps), not a real security
      // boundary; the key ships in the JS bundle.
      obfuscate(ssPassword).then(enc => localStorage.setItem(SS_KEYS.ssPassword, enc));
    } else {
      localStorage.removeItem(SS_KEYS.ssUsername);
      localStorage.removeItem(SS_KEYS.ssPassword);
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
      }).catch((e) => queueMicrotask(() => dbg(`[screenshot] capture failed: ${e instanceof Error ? e.message : String(e)}`)))
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
      const data = library.scan?.userRoms.get(path);
      if (!data) throw new Error("File not found on SD card: " + path);
      return await romBytes(data);
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

  // --- The tabs (bare mode only) -----------------------------------------------------------
  //
  // ONE SECTION AT A TIME, which is what the approved boards draw
  // (`LibraryComposedOptions{,Saves,Cheats}.dc.html`). The three shipped side by side in one
  // grid, so the modal had to be wide enough for the widest of them and Saves -- a slot strip,
  // a preview, a date and a link -- sat in a third of a 60rem frame holding almost nothing.
  //
  // The tab LABEL IS THE SECTION HEADING, so this adds no string: `coverArt.heading`,
  // `saves.heading` and `cheats.heading` already say exactly what the boards' tabs say. The
  // in-panel `<h3>` is hidden in tabbed mode instead of being drawn twice, and the panel is
  // `aria-labelledby` its tab, so the heading is still announced.
  //
  // Only `bare` gets tabs. The accordion path is a different host contract (its own
  // `<summary>` already gates the whole body) and nothing in the app uses it today, so giving
  // it tabs would be inventing behaviour for a caller that does not exist.
  type OptTab = "cover" | "saves" | "cheats";
  const TAB_IDS: OptTab[] = ["cover", "saves", "cheats"];
  let activeTab = $state<OptTab>("cover");
  const tabLabel = $derived((id: OptTab) =>
    id === "cover"
      ? locale.t.roms.gameDetailsPanel.coverArt.heading
      : id === "saves"
        ? locale.t.roms.gameDetailsPanel.saves.heading
        : locale.t.roms.gameDetailsPanel.cheats.heading,
  );

  /**
   * Arrow keys move between tabs, Home and End jump to the ends.
   *
   * Required by the tablist pattern rather than optional polish: with `tabindex=-1` on the
   * inactive tabs (which is what stops Tab walking all three before reaching the panel), the
   * arrows are the ONLY way to reach them from the keyboard.
   */
  function onTabKey(e: KeyboardEvent, id: OptTab): void {
    const i = TAB_IDS.indexOf(id);
    let next: OptTab | null = null;
    if (e.key === "ArrowRight") next = TAB_IDS[(i + 1) % TAB_IDS.length]!;
    else if (e.key === "ArrowLeft") next = TAB_IDS[(i - 1 + TAB_IDS.length) % TAB_IDS.length]!;
    else if (e.key === "Home") next = TAB_IDS[0]!;
    else if (e.key === "End") next = TAB_IDS[TAB_IDS.length - 1]!;
    if (!next) return;
    e.preventDefault();
    activeTab = next;
    // Focus follows selection, which is the pattern's default for tabs whose panels are cheap
    // to show. The panel is already rendered by the time this runs.
    document.getElementById(`opt-tab-${next}`)?.focus();
  }
</script>

{#snippet detailsPanels()}
    {#if bare}
      <!-- Same shape as the Library tab's own nav and the console filter strip: the active item
           carries an inset bottom rule rather than a filled chip (boards: `padding: 0 2px 12px;
           box-shadow: inset 0 -3px 0 #3e9e4e`). A third idiom for the same job would be noise. -->
      <div class="opt-tabs" role="tablist" aria-label={locale.t.roms.gameDetailsPanel.additionalOptions}>
        {#each TAB_IDS as id (id)}
          <button
            type="button"
            role="tab"
            id="opt-tab-{id}"
            class="opt-tab"
            class:active={activeTab === id}
            aria-selected={activeTab === id}
            aria-controls="opt-panel-{id}"
            tabindex={activeTab === id ? 0 : -1}
            onclick={() => (activeTab = id)}
            onkeydown={(e) => onTabKey(e, id)}
          >{tabLabel(id)}</button>
        {/each}
      </div>
    {/if}
    <div class="details-panels">
      {#if !bare || activeTab === "cover"}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- A tabpanel IS focusable in the tabs pattern: Tab out of the strip lands in the panel.
           The rule fires because the role here is conditional (`bare` only) and cannot be read statically. -->
      <div
        class="panel"
        role={bare ? "tabpanel" : undefined}
        id={bare ? "opt-panel-cover" : undefined}
        aria-labelledby={bare ? "opt-tab-cover" : undefined}
        tabindex={bare ? 0 : undefined}
      >
    <div class="panel-head">
      <h3>{locale.t.roms.gameDetailsPanel.coverArt.heading}</h3>
      <div class="panel-head-actions">
        {#if ssUsername}
          {@const openImportModal = () => {
            const toSelect = new Set<string>();
            for (const g of importGamesList) {
              if (!g.hasCover) toSelect.add(g.key);
            }
            importSelected = toSelect;
            showImportModal = true;
          }}
          <button class="settings-btn" title={locale.t.roms.gameDetailsPanel.coverArt.importTitle} onclick={openImportModal}>
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
        {/if}
        <button class="settings-btn" title={locale.t.roms.gameDetailsPanel.coverArt.settingsTitle} onclick={() => showCoverSettings = true}>
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </div>
    <hr />
    <div class="panel-content cover-options">
      <div class="option-row">
        <label for="cover-source">{locale.t.roms.gameDetailsPanel.coverArt.sourceLabel}</label>
        <select
          id="cover-source"
          bind:value={coverSource}
          class="cover-select"
        >
          <option value="file">{locale.t.roms.gameDetailsPanel.coverArt.sourceFile}</option>
          <option value="scraper">{locale.t.roms.gameDetailsPanel.coverArt.sourceScraper}</option>
        </select>
      </div>

      {#if coverSource === 'scraper'}
        <div class="option-row">
          <label for="cover-variant">{locale.t.roms.gameDetailsPanel.coverArt.variantLabel}</label>
          <select
            id="cover-variant"
            bind:value={coverVariant}
            class="cover-select"
          >
            <option value="box">{locale.t.roms.gameDetailsPanel.coverArt.variantBoxart}</option>
            <option value="ss">{locale.t.roms.gameDetailsPanel.coverArt.variantScreenshot}</option>
            <option value="mix3">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti3}</option>
            <option value="mix4">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti4}</option>
            <option value="mix5">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti5}</option>
          </select>
        </div>

        <div class="cover-preview-box">
          {#if isGeneratingPreview}
            <span class="cover-preview-msg">{locale.t.roms.gameDetailsPanel.coverArt.generatingPreview}</span>
          {:else if previewError}
            <span class="cover-preview-msg accent">{previewError}</span>
          {:else if previewUrl}
            <img src={previewUrl} alt={locale.t.roms.gameDetailsPanel.coverArt.coverPreviewAlt} class="cover-preview-img" />
            {#if previewIsGuess}
              <!-- The ladder's last rung: a name search with no system, which can be confidently
                   wrong. Said plainly next to the image, because the image itself looks exactly
                   as convincing as one found by hash. -->
              <span class="cover-preview-msg accent">{locale.t.roms.gameDetailsPanel.coverArt.guessNotice}</span>
            {/if}
          {:else}
            <span class="cover-preview-msg">{locale.t.roms.gameDetailsPanel.coverArt.configureToPreview}</span>
          {/if}
        </div>

        <button class="apply-btn" onclick={applyPreview} disabled={!previewCoverBlob} style="opacity: {previewCoverBlob ? 1 : 0.5};">
          {locale.t.roms.gameDetailsPanel.coverArt.apply}
        </button>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="file-drop-area"
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

      {#if ssRequestsTotal !== null && ssRequestsUsed !== null}
        <div class="requests-bar">
          <div class="requests-head">
            <span>{locale.t.roms.gameDetailsPanel.coverArt.requestsToday}</span>
            <span class="requests-count">{ssRequestsUsed} / {ssRequestsTotal}</span>
          </div>
          <div class="requests-track">
            <div class="requests-fill" style="width: {Math.min(100, Math.max(0, (ssRequestsUsed / ssRequestsTotal) * 100))}%;"></div>
          </div>
        </div>
      {/if}

      {#if library.scan}
        <div class="download-row">
          <button 
            class="action action-sm"
            onclick={async () => {
              const zip = new JSZip();
              let count = 0;
              for (const [path, data] of library.scan!.userRoms) {
                if (path.startsWith("covers/") && path.endsWith(".img")) {
                  zip.file(path, await romBytes(data));
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
              class="action action-sm"
              onclick={async () => {
              const zip = new JSZip();
              let count = 0;
              for (const [path, data] of library.scan!.userRoms) {
                const lp = path.toLowerCase();
                if (lp.endsWith(".png") || lp.endsWith(".jpg") || lp.endsWith(".jpeg")) {
                  zip.file(path, await romBytes(data));
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

  {/if}

  {#if !bare || activeTab === "saves"}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- A tabpanel IS focusable in the tabs pattern: Tab out of the strip lands in the panel.
       The rule fires because the role here is conditional (`bare` only) and cannot be read statically. -->
  <div
    class="panel"
    role={bare ? "tabpanel" : undefined}
    id={bare ? "opt-panel-saves" : undefined}
    aria-labelledby={bare ? "opt-tab-saves" : undefined}
    tabindex={bare ? 0 : undefined}
  >
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
            <span class="muted sm">{locale.t.roms.gameDetailsPanel.saves.noSavesFound}</span>
          {/if}
        </div>

        <div class="saves-preview-container">
          <button
            class="arrow-btn"
            aria-label={locale.t.roms.gameDetailsPanel.saves.previousSaveAriaLabel}
            disabled={!gameSaves.length || gameSaves.indexOf(selectedSlot!) <= 0}
            onclick={() => selectedSlot = gameSaves[gameSaves.indexOf(selectedSlot!) - 1]}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
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
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
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

  {/if}

  {#if !bare || activeTab === "cheats"}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- A tabpanel IS focusable in the tabs pattern: Tab out of the strip lands in the panel.
       The rule fires because the role here is conditional (`bare` only) and cannot be read statically. -->
  <div
    class="panel cheats-panel"
    class:disabled={!isCheatSupported}
    role={bare ? "tabpanel" : undefined}
    id={bare ? "opt-panel-cheats" : undefined}
    aria-labelledby={bare ? "opt-tab-cheats" : undefined}
    tabindex={bare ? 0 : undefined}
  >
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
          <div class="cheats-row span">
            <h4 class="cheats-row-head">{locale.t.roms.gameDetailsPanel.cheats.builtInCheatFileHeading}</h4>
            {#if mcfAttached}
              <p class="muted sm">
                {mcfPresetName ? locale.t.roms.gameDetailsPanel.cheats.attachedFromLibrary(mcfPresetName) : locale.t.roms.gameDetailsPanel.cheats.attachedCustom}
              </p>
              <button class="btn" onclick={removeMcfCheat}>{locale.t.roms.gameDetailsPanel.cheats.removeCheatFile}</button>
            {:else if mcfPresetName}
              <p class="muted sm">
                {locale.t.roms.gameDetailsPanel.cheats.builtInFoundBody(mcfPresetName)}
              </p>
              <button class="btn" disabled={mcfLoading} onclick={attachMcfPreset}>
                {mcfLoading ? locale.t.roms.gameDetailsPanel.cheats.loadingEllipsis : locale.t.roms.gameDetailsPanel.cheats.useBuiltInCheatFile}
              </button>
              {#if mcfError}<p class="muted err">{mcfError}</p>{/if}
            {:else}
              <p class="muted sm">{locale.t.roms.gameDetailsPanel.cheats.noBuiltInCheatFile}</p>
            {/if}
          </div>
        </div>
      {:else}
      <div class="cheats-rows">
        {#if systemGames && allSystemGames.length > 0}
          <div class="cheats-row col-a">
            <!-- Artboard (RomsOptions) draws Detected game as a label BESIDE its control,
                 the same row shape as the Cover art column's Source/Variant rows - not as a
                 sub-heading stacked above it. -->
            <div class="option-row">
            <label for="detected-game">{locale.t.roms.gameDetailsPanel.cheats.detectedGameHeading}</label>
            <select
              id="detected-game"
              class="mono detected-game-select"
              value={gameOverrideKey[gameKey] ?? autoDetectedGame?.key ?? ""}
              onchange={(e) => { gameOverrideKey = { ...gameOverrideKey, [gameKey]: e.currentTarget.value }; }}
            >
              {#if !autoDetectedGame}<option value="">{locale.t.roms.gameDetailsPanel.cheats.noMatchOption}</option>{/if}
              {#each allSystemGames as g (g.key)}
                <option value={g.key}>{g.title}{g.key === autoDetectedGame?.key ? locale.t.roms.gameDetailsPanel.cheats.autoDetectedSuffix : ""}</option>
              {/each}
            </select>
            </div>
            {#if !selectedGame}
              <p class="muted sm">{locale.t.roms.gameDetailsPanel.cheats.noPresetMatch}</p>
            {/if}
          </div>
        {/if}

        {#if presets.length > 0}
          <div class="cheats-row col-a">
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

        <div class="cheats-row col-b">
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

        <div class="cheats-row col-b">
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
              <span class="muted sm">{locale.t.roms.gameDetailsPanel.cheats.noCheatsConfigured}</span>
            {/if}
          </div>
        </div>
      </div>
      {/if}

        <div class="download-row">
          <button
            class="action action-sm"
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
  {/if}
    </div>
{/snippet}

<div class="game-details-accordion" class:bare>
  {#if bare}
    {@render detailsPanels()}
  {:else}
    <details bind:open={additionalOptionsOpen}>
      <summary>{locale.t.roms.gameDetailsPanel.additionalOptions}</summary>
      {@render detailsPanels()}
    </details>
  {/if}
</div>

{#if showCoverSettings}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showCoverSettings = false; }}>
    <div class="modal-content settings">
      <h3 class="modal-title">{locale.t.roms.gameDetailsPanel.screenScraperSettings.title}</h3>

      <div class="settings-fields">
        <div>
          <label class="field-label">
            {locale.t.roms.gameDetailsPanel.screenScraperSettings.username}
            <input type="text" bind:value={ssUsername} class="field-input" />
          </label>
        </div>

        <div>
          <label class="field-label">
            {locale.t.roms.gameDetailsPanel.screenScraperSettings.password}
            <input type="password" bind:value={ssPassword} class="field-input" />
          </label>
        </div>

        <label class="check-label">
          <input type="checkbox" bind:checked={ssRemember} />
          {locale.t.roms.gameDetailsPanel.screenScraperSettings.rememberCredentials}
        </label>
        {#if ssRemember}
          <p class="field-note">
            {locale.t.roms.gameDetailsPanel.screenScraperSettings.rememberNote}
          </p>
        {/if}

        <hr class="modal-rule" />

        <label class="check-label">
          <input type="checkbox" bind:checked={ssPreferLocal} />
          {locale.t.roms.gameDetailsPanel.screenScraperSettings.preferLocalCovers}
        </label>

        <label class="check-label" class:disabled={!nativeFolderPickerSupported()}>
          <input type="checkbox" bind:checked={ssSaveLocal} disabled={!nativeFolderPickerSupported()} />
          <div class="check-stack">
            <span>{locale.t.roms.gameDetailsPanel.screenScraperSettings.saveToRomsFolder}</span>
            {#if !nativeFolderPickerSupported()}
              <span class="sub-note">{locale.t.roms.gameDetailsPanel.screenScraperSettings.saveToRomsFolderFirefoxNote}</span>
            {/if}
          </div>
        </label>
      </div>

      <div class="modal-actions">
        <button class="close-btn" onclick={() => showCoverSettings = false}>
          {locale.t.shared.common.close}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showImportModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- The import dialog is deliberately modal: clicking the dimmed page must not discard the
       user's selection or stop a running batch. The explicit X is the dismissal control. -->
  <div class="modal-backdrop">
    <div class="modal-content import">
      <div class="import-head">
        <h3 class="import-title">{locale.t.roms.gameDetailsPanel.importModal.title}</h3>
        <button aria-label={locale.t.shared.common.close} onclick={() => showImportModal = false} class="modal-close">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      {#if !isImporting}
      <div class="consoles import-filter">
        <button class="console" class:active={importFilterConsole === "all"} onclick={() => importFilterConsole = "all"}>
          {locale.t.roms.gameDetailsPanel.importModal.allFilterLabel(importGamesList.length)}
        </button>
        {#each romSelection.systems as s (s.system)}
          <button class="console" class:active={importFilterConsole === s.system} onclick={() => importFilterConsole = s.system}>
            {s.label} ({s.count})
          </button>
        {/each}
      </div>

      <div class="import-table-wrap">
        <table class="import-table">
          <thead>
            <tr>
              <th class="check">
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
              <th>{locale.t.roms.gameDetailsPanel.importModal.consoleColumn}</th>
              <th class="sortable" onclick={() => { importSortBy = 'name'; importSortDesc = !importSortDesc; }}>
                {locale.t.roms.gameDetailsPanel.importModal.filenameColumn(importSortBy === 'name' ? (importSortDesc ? '▼' : '▲') : '')}
              </th>
              <th class="sortable c" onclick={() => { importSortBy = 'cover'; importSortDesc = !importSortDesc; }}>
                {locale.t.roms.gameDetailsPanel.importModal.coverColumn(importSortBy === 'cover' ? (importSortDesc ? '▼' : '▲') : '')}
              </th>
            </tr>
          </thead>
          <tbody>
            {#each sortedImportGames as g}
              <tr>
                <td class="c">
                  <input type="checkbox" checked={importSelected.has(g.key)} onchange={(e) => {
                    const next = new Set(importSelected);
                    if (e.currentTarget.checked) next.add(g.key);
                    else next.delete(g.key);
                    importSelected = next;
                  }} />
                </td>
                <td class="sys">{g.system.toUpperCase()}</td>
                <td class="name">{g.name}</td>
                <td class="c">
                  {#if g.hasCover}
                    <span class="has-cover">✓</span>
                  {:else}
                    <span class="no-cover">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
            {#if sortedImportGames.length === 0}
              <tr>
                <td colspan="4" class="empty">{locale.t.roms.gameDetailsPanel.importModal.noGamesFound}</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>

      <div class="import-options">
        <label class="check-label">
          <input type="checkbox" bind:checked={showGeneratedCovers} />
          {locale.t.roms.gameDetailsPanel.importModal.showGeneratedCovers}
        </label>
        <label class="check-label">
          <input type="checkbox" bind:checked={skipExistingCovers} />
          {locale.t.roms.gameDetailsPanel.importModal.skipExistingCovers}
        </label>
      </div>

      <div class="import-foot">
          <label class="variant-label">
            {locale.t.roms.gameDetailsPanel.importModal.defaultVariantLabel}
            <select bind:value={defaultVariant} class="variant-select">
              <option value="box">{locale.t.roms.gameDetailsPanel.coverArt.variantBoxart}</option>
              <option value="ss">{locale.t.roms.gameDetailsPanel.coverArt.variantScreenshot}</option>
              <option value="mix3">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti3}</option>
              <option value="mix4">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti4}</option>
              <option value="mix5">{locale.t.roms.gameDetailsPanel.coverArt.variantMulti5}</option>
            </select>
          </label>

        <div class="import-btns">
          <button class="mbtn" onclick={() => showImportModal = false}>
            {locale.t.shared.common.cancel}
          </button>
          <button class="mbtn primary" onclick={startImport} disabled={importableSelectedCount === 0}>
            {locale.t.roms.gameDetailsPanel.importModal.importSelected(importableSelectedCount)}
          </button>
        </div>
      </div>
      {:else}
        <div class="import-running">
          {#if showGeneratedCovers}
            <div class="import-preview-viewport">
              {#if importPreviewUrl}
                <img src={importPreviewUrl} alt={locale.t.roms.gameDetailsPanel.importModal.generatedCoverPreviewAlt} />
              {:else if importPreviewMessage}
                <span>{importPreviewMessage}</span>
              {:else}
                <span>{locale.t.roms.gameDetailsPanel.importModal.showGeneratedCovers}</span>
              {/if}
            </div>
          {/if}
          <div class="importing">
            <div class="import-progress" role="progressbar"
              aria-label={locale.t.roms.gameDetailsPanel.importModal.progressLabel(importProgress.current, importProgress.total)}
              aria-valuemin="0" aria-valuemax={importProgress.total} aria-valuenow={importProgress.current}>
              <div class="import-progress-fill" style={`width: ${importProgress.total > 0 ? Math.round(importProgress.current / importProgress.total * 100) : 0}%`}></div>
            </div>
            <span class="import-progress-label">{locale.t.roms.gameDetailsPanel.importModal.progressLabel(importProgress.current, importProgress.total)}</span>
            <button class="mbtn" onclick={() => isImporting = false}>
              {locale.t.roms.gameDetailsPanel.importModal.stop}
            </button>
          </div>
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
  .details-panels {
    display: grid;
    grid-template-columns: 1fr 1fr 1.25fr;
    gap: 1rem;
    margin-top: 1rem;
  }
  
  /* --- The tab strip -----------------------------------------------------------------------
     Boards: `padding: 18px 28px 0; display: flex; gap: 28px; border-bottom: 1px solid #d8d8d8`
     with the active item carrying `box-shadow: inset 0 -3px 0` in the accent. Same shape as the
     app's own tab nav and the Library's console filters, so this is the third use of one idiom
     rather than a new one. The strip is full-bleed to the modal's padding by negative margins,
     because its bottom rule is the divider between the strip and the panel and has to reach
     both edges to read as one. */
  .opt-tabs {
    display: flex;
    align-items: stretch;
    gap: 28px;
    border-bottom: 1px solid var(--hairline);
    margin: -0.25rem -1.5rem 0;
    padding: 0 1.5rem;
  }
  .opt-tab {
    background: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink-soft);
    padding: 0 2px 12px;
    box-shadow: inset 0 -3px 0 transparent;
  }
  .opt-tab:hover { color: var(--ink); }
  .opt-tab.active {
    font-weight: 700;
    color: var(--ink);
    box-shadow: inset 0 -3px 0 var(--model-accent);
  }
  /* The strip is the modal's own heading row, so a focus ring has to sit inside it rather than
     bleed over the rule beneath. */
  .opt-tab:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: -2px;
  }
  /* A tabpanel is focusable so the keyboard lands somewhere after the tab, and its ring would
     otherwise trace the whole panel. */
  .game-details-accordion.bare .panel:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 4px;
  }

  /* Un-boxed inside the Library tab's white "Additional options" drawer — the drawer already
     provides the surface, so nesting a white/sunk card inside it reads as a box in a box. */
  .game-details-accordion.bare .details-panels {
    margin-top: 0;
    /* ONE PANEL AT A TIME. The three sections are tabs, not columns: the boards
       (`LibraryComposedOptions.dc.html`, `…Saves.dc.html`, `…Cheats.dc.html`) each draw the
       same 980px frame with a single body under the strip, so the grid here carries one track.
       `minmax(0, 1fr)`, not a bare `fr`: an `<input>` carries an intrinsic minimum width, and a
       bare track floors at it and blows the grid out past the modal. That was the reason the
       earlier three-column version spelled every track this way, and it still applies to one. */
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    padding-top: 24px;
  }
  .game-details-accordion.bare .panel {
    background: none;
    border: none;
    border-radius: 0;
    padding: 0;
  }
  /* With one panel visible the hairline that divided columns 2-3 has nothing to divide, and a
     stray inline border on the only panel would draw a line down the body's left edge. */
  .game-details-accordion.bare .panel + .panel {
    border-inline-start: none;
    padding-inline-start: 0;
  }
  /* THE TAB IS THE HEADING. The boards draw each section's name once, in the strip — the panel
     below it has no repeated title. Hiding rather than deleting keeps the non-tabbed accordion
     path (the `bare = false` default) drawing its three headings unchanged, and the panel is
     still named to a screen reader through `aria-labelledby` pointing at its tab. */
  .game-details-accordion.bare .panel > h3,
  .game-details-accordion.bare .panel-head h3 {
    display: none;
  }
  /* Cover art's head row keeps its actions; with the title gone they sit alone on the right. */
  .game-details-accordion.bare .panel-head:has(.panel-head-actions) {
    justify-content: flex-end;
  }

  /* --- Per-tab bodies ----------------------------------------------------------------------
     Boards: Cover art uses a 2:3 content-to-preview split, while Saves keeps its fixed preview
     column and Cheats uses two equal columns because it has nothing to preview.
     The preview sits mid-list among its siblings in the markup (it is drawn where it belongs in
     reading order), so it is PLACED into column 2 rather than moved, and everything else is
     told to stay in column 1. */
  .game-details-accordion.bare .panel-content.cover-options,
  .game-details-accordion.bare .panel-content.saves-content {
    display: grid;
    /* COLUMN GAP ONLY, and the rhythm between the column-1 items carried by their own margin.
       A row gap is charged once per pair of adjacent ROWS, not once per pair of siblings, and
       the preview below spans 99 of them. At 36px that was 98 gutters, about 3500px of nothing
       under a body a few hundred pixels tall: the oversized scroll the owner reported on both
       Cover art and Saves. Cheats has no spanning child, which is why it was the one tab that
       looked right. Do not fold these back into a `gap` shorthand. */
    column-gap: 36px;
    row-gap: 0;
    align-items: start;
    align-content: start;
    flex: none;
  }
  .game-details-accordion.bare .panel-content.cover-options {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  }
  .game-details-accordion.bare .panel-content.saves-content {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .game-details-accordion.bare .panel-content.cover-options > *,
  .game-details-accordion.bare .panel-content.saves-content > * {
    grid-column: 1;
    min-width: 0;
    margin-block-end: 36px;
  }
  .game-details-accordion.bare .panel-content.cover-options > *:last-child,
  .game-details-accordion.bare .panel-content.saves-content > *:last-child {
    margin-block-end: 0;
  }
  /* THE PREVIEW IS THE ONE CHILD IN COLUMN 2, and it has to be named through the same body
     selector as the `> *` rule above to get there. Svelte scopes a rule by appending its hash
     inside `:where()`, which carries no specificity, so the two rules are counted on their
     authored classes alone: `.game-details-accordion.bare .panel-content.cover-options > *` is
     five classes and the shorter `.game-details-accordion.bare .cover-preview-box` was four.
     The `> *` rule therefore won and `grid-column: 1` applied, which put the preview in the
     stack it was supposed to sit beside, left column 2 empty, and pushed every other child
     past the 99 rows the preview had claimed. Matching the body prefix here makes the two
     equal and lets source order decide, which is what the original spelling assumed.
     The span itself is deliberate and stays: it keeps column 1's stack independent of the
     preview's height, where a single row would let a 152px plate push the second option row
     down by its full height. With no row gap the empty tracks cost nothing, and a preview
     taller than the column still grows the grid, because a spanning item distributes its size
     across the tracks it covers. */
  .game-details-accordion.bare .panel-content.cover-options > .cover-preview-box,
  .game-details-accordion.bare .panel-content.saves-content > .saves-preview-container {
    grid-column: 2;
    grid-row: 1 / span 99;
    align-self: start;
    margin-block-end: 0;
  }
  .game-details-accordion.bare .panel-content.cover-options > .cover-preview-box {
    height: 300px;
    min-height: 300px;
  }
  .game-details-accordion.bare .panel-content.cover-options > .cover-preview-box .cover-preview-img {
    max-height: 100%;
  }
  /* Cheats: left is what is already set (detected game, presets), right is what you can add
     (manual entry, the configured list). The `isWholeFileSystem` branch is a single row with
     nothing to pair it with, so it spans. */
  .game-details-accordion.bare .cheats-rows {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 36px;
    align-items: start;
  }
  .game-details-accordion.bare .cheats-row.col-a { grid-column: 1; }
  .game-details-accordion.bare .cheats-row.col-b { grid-column: 2; }
  .game-details-accordion.bare .cheats-row.span { grid-column: 1 / -1; }
  /* A phone is narrower than the fixed preview column plus anything, so both bodies fold to one
     column rather than letting the pane scroll sideways (`.tabpane` is the only scroller). */
  @media (max-width: 720px) {
    .game-details-accordion.bare .panel-content.cover-options,
    .game-details-accordion.bare .panel-content.saves-content,
    .game-details-accordion.bare .cheats-rows {
      grid-template-columns: minmax(0, 1fr);
      column-gap: 14px;
      row-gap: 14px;
    }
    /* One column, and the preview stops spanning just below, so an ordinary row gap does the
       spacing again here. The margin that stands in for it on the wide layout would otherwise
       be added on top of this gap. */
    .game-details-accordion.bare .panel-content.cover-options > *,
    .game-details-accordion.bare .panel-content.saves-content > * {
      margin-block-end: 0;
    }
    /* The same body prefix as the wide rule, for the same specificity reason: a media query
       adds no specificity of its own, so the shorter spelling would lose to the placement
       above and the 99 rows would come straight back on a phone. */
    .game-details-accordion.bare .panel-content.cover-options > .cover-preview-box,
    .game-details-accordion.bare .panel-content.saves-content > .saves-preview-container {
      grid-column: 1;
      grid-row: auto;
    }
    .game-details-accordion.bare .panel-content.cover-options > .cover-preview-box {
      height: 152px;
      min-height: 152px;
    }
    .game-details-accordion.bare .cheats-row.col-a,
    .game-details-accordion.bare .cheats-row.col-b {
      grid-column: 1;
      grid-row: auto;
    }
    .opt-tabs { gap: 18px; }
  }
  .game-details-accordion.bare .panel h3 {
    margin: 0 0 14px 0;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .game-details-accordion.bare .panel-head {
    margin-bottom: 14px;
  }
  .game-details-accordion.bare .panel-head h3 {
    margin-bottom: 0;
  }
  .game-details-accordion.bare .panel hr {
    display: none;
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
    font-size: var(--fs-body);
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
  /* Artboard: the Saves column is a normal 14px stack whose children run the full column
     width (the preview plate stretches between the two chevrons) — not centred and
     shrink-wrapped. */
  .saves-content {
    gap: 14px;
    align-items: stretch;
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
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-start;
    width: 100%;
  }
  /* Artboard: same shape as the Library tab's console filters — the inactive tab is bare
     12px/500 text with no border and no fill, the active one a dark filled 3px chip. */
  .slot-tab {
    background: none;
    border: 1px solid transparent;
    color: var(--ink-soft);
    border-radius: 3px;
    padding: 5px 11px;
    font-size: var(--fs-chip);
    font-weight: 500;
    cursor: pointer;
  }
  .slot-tab.active {
    background: var(--ink);
    color: var(--surface);
    border-color: var(--ink);
    font-weight: 600;
  }
  
  .saves-preview-container {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
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
  /* Artboard: the preview plate fills the width between the two chevrons at 168px tall,
     on the same grey as the cover preview — not a fixed 160x120 black tile. */
  .saves-preview {
    flex: 1 1 auto;
    min-width: 0;
    height: 168px;
    background: var(--surface-sunk);
    border-radius: var(--r-card);
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
    color: var(--ink-soft);
    font-size: var(--fs-chip);
  }
  .loading-box.empty {
    color: var(--ink-soft);
  }
  .btn {
    font-family: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--r-control);
    border: none;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* RomsOptions: a bare green text link (13px/600), not a filled button. */
  .download-btn {
    background: none;
    color: var(--zelda-green);
    border: 0;
    border-radius: 0;
    box-shadow: none;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    padding: 0;
    width: max-content;
  }
  .download-btn:hover:not(:disabled) {
    text-decoration: underline;
  }
  .download-btn:disabled {
    color: var(--ink-dim);
  }

  /* Cheats */
  .cheats-content {
    flex-direction: column;
  }
  
  .cheats-panel.disabled {
    position: relative;
    /* Containing block for `.cheats-overlay`, and the stacking context that keeps its lift
       inside this panel instead of competing with the app's scale (tokens.css, --z-raised). */
    isolation: isolate;
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
    z-index: var(--z-raised);
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
  /* Artboard: `Presets` / `Manual entry` are small-caps section labels (11px/700/0.09em),
     one step tighter than the panel headings' 0.11em. */
  .cheats-row-head {
    margin: 0 0 9px 0;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .presets-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
    max-height: 130px;
    overflow-y: auto;
  }
  /* Artboard: 13px preset names on a 10px gutter. */
  .preset-label {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: var(--fs-btn-sm);
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
    gap: 8px;
    align-items: center;
  }
  /* BOTH INPUTS NEED A SHRINK GUARD, and this row is the modal's narrowest-fitting content.
     A flex item's `min-width` defaults to `auto`, and for a form control that resolves to the
     control's intrinsic width, not to zero: an `<input>` with no `size` attribute is 20
     characters wide and will not go below it. Two of them plus the Add button gave this row a
     floor of roughly 400px that no container could talk it out of, so in the band between the
     720px fold and a viewport wide enough to give column 2 that much, the row spilled out of
     its track. The spill surfaced as a HORIZONTAL SCROLLBAR ON `.opts-body`
     (`RomManagementTab.svelte`), which declares only `overflow-y: auto` -- and a box with one
     axis not `visible` computes the other to `auto`, so an overflow-y box silently scrolls
     sideways too. That is the scrollbar the owner reported, and it is why the fix belongs here,
     on the thing that would not shrink, rather than on the box that reported it. Do not reach
     for `overflow-x: hidden` there: it would clip the row instead of fitting it.
     `flex-basis: 40%` is proportional, so once the floor is gone the pair scales with the
     column. The Add button keeps its own intrinsic floor on purpose; a button squeezed to
     nothing is not a button. */
  .manual-input-code {
    flex: 0 0 40%;
    min-width: 0;
  }
  .manual-input-desc {
    flex: 1;
    min-width: 0;
  }
  /* Artboard: the same 32px / `0 10px` / 13px control box as the two <select>s above. */
  .manual-input-code, .manual-input-desc {
    font-family: var(--font-sans);
    font-size: var(--fs-btn-sm);
    padding: 0 10px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
    height: 32px;
  }
  .manual-input-code.mono {
    font-family: var(--font-mono);
  }
  .detected-game-select {
    flex: 0 1 auto;
    min-width: 148px;
    max-width: 100%;
    font-size: var(--fs-btn-sm);
    padding: 0 10px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
    height: 32px;
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
    border-radius: var(--r-control);
    font-size: var(--fs-micro);
    flex-shrink: 0;
  }
  .cc-code {
    flex: 0 0 auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
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
    border-radius: var(--r-control);
  }
  .cc-remove:hover {
    color: var(--danger);
    /* A 5%-black wash darkens in BOTH themes, so on the dark --surface (#212121) the hover
       state was a ~1% shift — effectively invisible. --surface-sunk is the app's hover fill
       (DeviceControls `.menu-item:hover`) and flips with the theme. */
    background: var(--surface-sunk);
  }
  /* Artboard: `Add` is a bare green 13px/600 text action on the entry row, not a filled
     gradient button — the same treatment as `Download save` in the Saves column. */
  .add-cheat-btn {
    background: none;
    color: var(--zelda-green);
    border: none;
    border-radius: 0;
    box-shadow: none;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    padding: 0 14px;
    height: 32px;
    margin-top: 0;
    width: max-content;
  }
  .add-cheat-btn:hover:not(:disabled) {
    text-decoration: underline;
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

  .muted.sm {
    font-size: var(--fs-micro);
  }
  .muted.err {
    color: var(--danger);
  }

  /* Cover-art panel */
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-inline-end: 0.5rem;
  }
  .panel-head-actions {
    display: flex;
    gap: 0.25rem;
  }
  .settings-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink-soft);
    display: flex;
    padding: 4px;
    border-radius: var(--r-control);
  }
  /* RomsOptions.dc.html: the column's children sit 14px apart, and the heading row above
     already carries its own 14px margin — so no extra top margin here. */
  .cover-options {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 14px;
    margin-top: 0;
  }
  .option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  /* Artboard: row labels are 13px regular quiet ink, not a 12px medium. */
  .option-row label {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    font-weight: 400;
  }
  /* Artboard control: 32px tall, `0 10px` padding, 13px, flat 2px radius, 148px minimum —
     the same box the Cheats column's controls use. */
  .cover-select {
    height: 32px;
    padding: 0 10px;
    font-size: var(--fs-btn-sm);
    border-radius: var(--r-control);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--ink);
    flex: 0 1 auto;
    min-width: 148px;
  }
  /* Artboard: a plain 152px grey plate — no border, and it does not stretch. Radius is
     --r-card (6px) against the artboard's 4px; there is no 4px token and 6px is the
     surface-radius step this design already uses everywhere else. */
  .cover-preview-box {
    flex: 0 0 auto;
    height: 152px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--r-card);
    background: var(--surface-sunk);
    position: relative;
  }
  .cover-preview-msg {
    font-size: var(--fs-chip);
    color: var(--ink-soft);
  }
  .cover-preview-msg.accent {
    color: var(--model-accent);
  }
  .cover-preview-img {
    max-height: 152px;
    max-width: 100%;
    object-fit: contain;
  }
  /* Artboard: a compact green pill sized to its label (`7px 16px`, 13px/600, 4px radius),
     left-aligned on its own row — not a full-width block. The fill is --zelda-green, the
     literal the artboard draws, rather than --model-accent, which shifts with the console
     model and would not be green on a Mario unit. */
  .apply-btn {
    align-self: flex-start;
    padding: 7px 16px;
    background: var(--zelda-green);
    color: #fff;
    border: none;
    border-radius: var(--r-btn);
    cursor: pointer;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
  }
  /* The artboard puts `Drop an image to override` beside Apply as a bare 13px caption. It
     stays a distinct target here because the code makes the two mutually exclusive on
     `coverSource` (see the note in the head of this file) — only its paint is quietened:
     a 1px rule instead of a 2px dash, and the artboard's 13px caption ink. */
  .file-drop-area {
    border: 1px dashed var(--hairline);
    border-radius: var(--r-card);
    padding: 1.5rem 1rem;
    text-align: center;
    color: var(--ink-soft);
    font-size: var(--fs-btn-sm);
    cursor: pointer;
    margin-top: 0;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }
  /* Artboard: an 11px label/value pair 5px above a 3px track, closing the column. */
  .requests-bar {
    margin-top: auto;
    font-size: var(--fs-label);
    color: var(--ink-soft);
    padding-top: 8px;
  }
  .requests-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }
  .requests-count {
    font-family: var(--font-mono);
  }
  .requests-track {
    width: 100%;
    height: 3px;
    background: var(--hairline);
    border-radius: var(--r-control);
    overflow: hidden;
  }
  .requests-fill {
    height: 100%;
    background: var(--ink);
  }
  .download-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
    border-top: 1px solid var(--hairline);
    padding-top: 1rem;
  }
  .action-sm {
    font-size: var(--fs-micro);
    justify-content: center;
  }

  /* Modals (ScreenScraper settings + cover import) */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-content {
    background: var(--surface);
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  }
  /* Hard-width audit: these two hand-rolled dialogs (no artboard covers them) carried a bare
     `width` with no floor, so below a 320/600px viewport they overflowed the backdrop and
     forced horizontal scroll. `max-width: 100%` is a shrink guard, not a new design value. */
  .modal-content.settings {
    width: 320px;
    max-width: 100%;
  }
  .modal-content.import {
    width: 600px;
    max-width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }
  .modal-title {
    margin: 0 0 1rem;
    font-size: var(--fs-body);
    color: var(--ink);
  }
  .settings-fields {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .field-label {
    display: block;
    font-size: var(--fs-micro);
    margin-bottom: 0.25rem;
    color: var(--ink-soft);
  }
  .field-input {
    width: 100%;
    padding: 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: transparent;
    color: var(--ink);
    margin-top: 0.25rem;
  }
  .check-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-micro);
    color: var(--ink);
    cursor: pointer;
  }
  .check-label.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .check-stack {
    display: flex;
    flex-direction: column;
  }
  .field-note {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    margin: -0.25rem 0 0;
  }
  .sub-note {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    margin-top: 2px;
  }
  .modal-rule {
    border: 0;
    border-top: 1px solid var(--hairline);
    margin: 0.5rem 0;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }
  .close-btn {
    padding: 0.4rem 1rem;
    border: none;
    border-radius: var(--r-control);
    background: var(--hairline);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-caption);
    font-weight: 500;
  }
  .import-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .import-title {
    margin: 0;
    font-size: var(--fs-title);
    color: var(--ink);
  }
  .modal-close {
    background: none;
    border: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .consoles.import-filter {
    margin-bottom: 0.5rem;
  }
  .import-table-wrap {
    flex: 1;
    overflow-y: auto;
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    margin-bottom: 1rem;
  }
  .import-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-micro);
  }
  .import-table thead {
    position: sticky;
    top: 0;
    background: var(--surface);
    border-bottom: 1px solid var(--hairline);
  }
  .import-table th {
    padding: 0.5rem;
    text-align: start;
  }
  .import-table th.check {
    text-align: center;
    width: 40px;
  }
  .import-table th.sortable {
    cursor: pointer;
  }
  .import-table th.c,
  .import-table td.c {
    text-align: center;
  }
  .import-table tbody tr {
    border-bottom: 1px solid var(--hairline);
  }
  .import-table td {
    padding: 0.4rem;
  }
  .import-table td.sys {
    color: var(--ink-soft);
  }
  .import-table td.name {
    color: var(--ink);
  }
  .import-table td.empty {
    padding: 1rem;
    text-align: center;
    color: var(--ink-soft);
  }
  .has-cover {
    color: var(--zelda-green);
  }
  .no-cover {
    color: var(--ink-soft);
    opacity: 0.5;
  }
  .import-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .variant-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-micro);
    color: var(--ink);
  }
  .variant-select {
    padding: 0.3rem 0.5rem;
    border-radius: var(--r-control);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--ink);
  }
  .import-btns {
    display: flex;
    gap: 0.5rem;
  }
  .import-options {
    display: flex;
    gap: 1.25rem;
    margin-top: 0.75rem;
  }
  .import-running {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .import-preview-viewport {
    height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: var(--r-card);
    background: var(--surface-sunk);
  }
  .import-preview-viewport img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .import-preview-viewport span {
    color: var(--ink-soft);
    font-size: var(--fs-micro);
  }
  .importing {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink-soft);
    font-size: var(--fs-micro);
    margin-inline-end: 1rem;
  }
  .import-progress {
    width: 10rem;
    height: 0.45rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--hairline);
  }
  .import-progress-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--model-accent);
    transition: width 120ms ease-out;
  }
  .import-progress-label {
    white-space: nowrap;
  }
  .mbtn {
    padding: 0.5rem 1rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-caption);
  }
  .mbtn.primary {
    border: none;
    background: var(--model-accent);
    color: #fff;
    font-weight: 500;
  }
</style>
