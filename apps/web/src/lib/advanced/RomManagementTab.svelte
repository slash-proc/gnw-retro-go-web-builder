<script lang="ts">
  // Tab — ROM Management. Three drop-downs, top → bottom:
  //   1. Select games  — the folder ∪ device game list; pick what to install (drives Install ROMs).
  //   2. Library Extras — per-game enrichments (cover art, saves, cheats).
  //   3. Install ROMs   — version-agnostic FrogFS repack from the SELECTION (non-destructive).
  // The ROM FOLDER is OPTIONAL. The on-device games come from device.installedGames (FrogFS read).
  // See memory: romgr-install-architecture.
  import { roms } from "../roms.svelte.js";
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
  let showMissing = $state(false);
  const visibleGames = $derived(
    romSelection.games.filter(
      (g) =>
        (consoleFilter === "all" || g.system === consoleFilter) && (!showMissing || !g.installed),
    ),
  );
  const chipFor = (g: Game): { label: string; cls: string } =>
    g.installed && g.inFolder
      ? { label: "installed", cls: "installed" }
      : g.inFolder
        ? { label: "new", cls: "new" }
        : { label: "on device", cls: "ondevice" };

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
  let extracting = $state<string | null>(null);
  let extractError = $state<string | null>(null);
  let extractedAssets = $state(new Map<string, Uint8Array>());

  async function convertAssets(hb: typeof HOMEBREW_TITLES[0]) {
    const romPath = [...(roms.scan?.userRoms.keys() ?? [])].find(k => k.endsWith(hb.sourceRoms[0]));
    if (!romPath) return;
    const romData = roms.scan!.userRoms.get(romPath)!;
    
    extracting = hb.key;
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
      extracting = null;
    }
  }

  const selSig = $derived([...romSelection.selectedKeys, ...romSelection.selectedHomebrewKeys, ...extractedAssets.keys()].sort().join("|"));
  const previewWanted = $derived(openSet.has("select-games") || openSet.has("install-roms"));

  $effect(() => {
    if (!previewWanted || !device.isConnected || !baseInstalled) return;
    if (builtFrogfs && builtFor === selSig) return; // cache hit
    void buildPreview(selSig);
  });

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
      { label: "Cover art", status: "None — cover scan not built yet", kind: "muted" },
      { label: "Saves", status: "Preserved — LittleFS untouched", kind: "ok" },
      { label: "Cheats", status: "Not modified — cheats UI not built yet", kind: "muted" },
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
  <p class="intro">
    Manage your games. A <strong>ROM folder</strong> is required to manage games and install them to the device.
  </p>

  <!-- Folder selector (mandatory). -->
  <div class="folder">
    {#if !roms.selected}
      <button class="action" disabled={!roms.supported || roms.scanning} onclick={() => roms.pickFolder()}>
        {roms.scanning ? "Scanning…" : "Select ROM folder (required)"}
      </button>
      {#if roms.pendingHandle}
        <button class="link" onclick={() => roms.reconnect()}>Reconnect last ROM folder</button>
      {/if}
      {#if !roms.supported}
        <p class="note">Folder selection needs a Chromium browser (Chrome / Edge).</p>
      {/if}
    {:else}
      <div class="picked">
        <span class="mono"
          >{folderGames.length} ROMs across {folderSystemCount} systems <span class="dim"
            >({roms.scan!.summary.totalFiles} files in folder)</span
          ></span
        >
        <button class="link" onclick={() => roms.pickFolder()}>change folder</button>
        <button class="link" onclick={() => roms.clear()}>clear</button>
      </div>
    {/if}
    {#if roms.error}<p class="err">{roms.error}</p>{/if}
  </div>

  <!-- 1. Select games — the folder ∪ device list; choose what to install. -->
  <div class="group">
    <h3 class="subhead">Select games</h3>
    <AccordionSection id="select-games" title="Select games" open={openSet.has("select-games")} {onToggle}>
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

          <div class="selctrls">
            <label class="missing"><input type="checkbox" bind:checked={showMissing} /> Show missing only</label>
            {#if consoleFilter !== "all" && consoleFilter !== "homebrew"}
              <button class="link" onclick={() => romSelection.setSystem(consoleFilter, true)}>select all</button>
              <button class="link" onclick={() => romSelection.setSystem(consoleFilter, false)}>clear</button>
            {/if}
            {#if consoleFilter === "all" || consoleFilter === "homebrew"}
               <!-- Homebrew special actions could go here if needed -->
            {/if}
            <button class="link" onclick={() => romSelection.selectAllMissing()}>Add all missing</button>
          </div>

          <div class="rows">
            {#each visibleGames as g (g.key)}
              {@const chip = chipFor(g)}
              <label class="row">
                <input type="checkbox" checked={romSelection.isSelected(g.key)} onchange={() => romSelection.toggle(g.key)} />
                <span class="gname">{g.name}</span>
                <span class="gsize mono">{size(g.size)}</span>
                <span class="gchip {chip.cls}">{chip.label}</span>
              </label>
            {/each}

            {#if consoleFilter === "all" || consoleFilter === "homebrew"}
              {#each HOMEBREW_TITLES as hb}
                {@const isCeleste = hb.key === "celeste"}
                {@const onDevice = hb.deviceFiles.every((f) => deviceHomebrew.some((g) => g.name === f))}
                {@const isSelected = romSelection.isHomebrewSelected(hb.key)}
                {@const hasSourceRom = hb.sourceRoms.length > 0 && [...(roms.scan?.userRoms.keys() ?? [])].some(k => k.endsWith(hb.sourceRoms[0]))}
                {@const isExtracting = extracting === hb.key}
                {@const hasExtracted = hb.deviceFiles.some((f) => extractedAssets.has(`homebrew/${f}`))}
                {@const isReady = isCeleste || hasExtracted || onDevice}
                {@const hbSize = getHomebrewSize(hb.key)}
                <div style="display: flex; flex-direction: column;">
                  <label class="row" style={(!isReady && !hasSourceRom) || isExtracting ? "opacity: 0.5; cursor: not-allowed;" : "cursor: pointer;"}>
                    <input type="checkbox" checked={isSelected} disabled={(!isReady && !hasSourceRom) || isExtracting} onchange={(e) => {
                      e.preventDefault();
                      const checked = e.currentTarget.checked;
                      if (checked && !isReady && hasSourceRom) {
                        e.currentTarget.checked = false; // Keep it unchecked until conversion finishes
                        convertAssets(hb);
                      } else {
                        romSelection.toggleHomebrew(hb.key, checked);
                      }
                    }} />
                    <span class="gname">{hb.label}</span>
                    <span class="gsize mono">{hbSize > 0 ? size(hbSize) : '—'}</span>
                    {#if isReady}
                      <span class="gchip {onDevice ? 'installed' : 'new'}">{onDevice ? 'installed' : 'ready'}</span>
                    {:else if hasSourceRom}
                      {#if isExtracting}
                        <span class="gchip muted">extracting...</span>
                      {:else}
                        <span class="gchip muted">convert</span>
                      {/if}
                    {:else}
                      <span class="gchip muted">missing rom</span>
                    {/if}
                  </label>
                  {#if extractError && extracting === null && !isReady}
                    <p class="error" style="margin: 0; padding: 0 0 0.5rem 1.5rem; font-size: 0.8rem;">Error: {extractError}</p>
                  {/if}
                </div>
              {/each}
              {#each unknownHomebrew as g (g.name)}
                <div class="row">
                  <span class="gname mono">{g.name}</span>
                  <span class="gsize mono">{size(g.size)}</span>
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

          <p class="delta">
            <strong>+{romSelection.additions.length + hbAdditions}</strong> add ({MiB(romSelection.additionsBytes + hbAdditionsBytes)} MiB)
            · <strong>−{romSelection.removals.length + hbRemovals}</strong> remove ({MiB(romSelection.removalsBytes + hbRemovalsBytes)} MiB)
          </p>

          {#if canInstallRoms}
            <div style="margin-top: 2.5rem; margin-bottom: 0;">
              <InstallGeometry
                partitions={device.partitions}
                extSize={device.extFlashBytes}
                {frogfsOffset}
                {newFrogfsLen}
                {changedFromOffset}
                title="Extflash layout (existing vs. changes)"
              />
              {#if building}<p class="note" style="margin-top: 0.5rem;">Calculating layout…</p>{/if}
              {#if buildErr}<p class="err" style="margin-top: 0.5rem;">{buildErr}</p>{/if}
            </div>
          {/if}

          <div class="navrow">
            <button class="action primary" onclick={() => advance("select-games", "extras")}>
              Confirm selection
            </button>
          </div>
        </div>
      {/if}
    </AccordionSection>
  </div>

  <!-- 3. Library Extras — per-game cover art, saves, cheats. -->
  <div class="group">
    <h3 class="subhead">Library Extras</h3>
    <AccordionSection id="extras" title="Cover art &amp; cheats" open={openSet.has("extras")} {onToggle}>
      <div class="sections">
        <div class="section">
          <h4 class="head">Cover art</h4>
          <p class="desc">
            Find, convert, and assign box art via CoverStudio. The cover&rarr;IMG step becomes an
            inherent part of installing ROMs when covers are present.
          </p>
          <button class="action" disabled>Manage cover art<span class="soon">coming soon</span></button>
        </div>
        
        <details class="homebrew-dropdown" style="margin-top: 1rem;">
          <summary class="hbhead">Cheat Codes</summary>
          <div class="homebrew-content">
            <p class="desc" style="margin-bottom: 0.5rem; margin-top: 0.5rem;">
              Select cheat codes to generate `.cht` files for your installed games.
            </p>
            <div class="rows">
              <p class="note">Cheat integration coming soon.</p>
            </div>
          </div>
        </details>
      </div>
      <div class="navrow">
        <button class="link" onclick={() => advance("extras", "install-roms")}>
          Skip to Install ROMs →
        </button>
      </div>
    </AccordionSection>
  </div>

  <!-- 3. Install ROMs — repack FrogFS from the selection (non-destructive). -->
  <div class="group">
    <h3 class="subhead">Install ROMs</h3>
    <AccordionSection
      id="install-roms"
      title="Install ROMs"
      open={openSet.has("install-roms")}
      running={installing}
      {onToggle}
    >
      <div class="installroms">
        <p class="desc">
          Repacks your <strong>selection</strong> into the device&rsquo;s <strong>FrogFS</strong>
          region — independent of which Retro-Go version is installed. This is
          <strong>non-destructive</strong>: your saves and emulator cores (LittleFS) are untouched,
          and on-device games you keep selected are preserved.
        </p>

        {#if !device.isConnected}
          <p class="note">Connect a device to install ROMs.</p>
        {:else if !partitionsKnown}
          <p class="note">
            {device.scanning ? "Scanning the device…" : "Scan the device to detect its partitions."}
          </p>
        {:else if !baseInstalled}
          <p class="note">Install Retro-Go first — no LittleFS partition found on this device.</p>
        {:else}
          <p class="note">FrogFS gap: {MiB(ceilingOffset! - frogfsOffset)} MiB available (up to LittleFS).</p>

          <div class="geo">
            <InstallGeometry
              partitions={device.partitions}
              extSize={device.extFlashBytes}
              {frogfsOffset}
              {newFrogfsLen}
              {changedFromOffset}
              title="Extflash layout (existing vs. changes)"
            />
            {#if building}<p class="note">Calculating layout…</p>{/if}
          </div>

          <ChangeSummary items={summaryItems} />
          {#if buildErr}<p class="err">{buildErr}</p>{/if}

          <label class="lzma">
            <input type="checkbox" disabled checked={false} />
            Compress ROMs with LZMA <span class="soon">uncompressed for now</span>
          </label>
        {/if}

        <button
          class="action"
          disabled={!canInstallRoms || installing || building || !fitsGap}
          onclick={() => (installModal = true)}
        >
          {installing ? "Installing…" : "Install ROMs"}
        </button>
        {#if installed}<p class="ok">✓ ROMs installed.</p>{/if}
        {#if installErr}<p class="err">{installErr}</p>{/if}
        {#if flashLog.length}
          <pre class="flashlog">{flashLog.slice(-12).join("\n")}</pre>
        {/if}
      </div>
    </AccordionSection>
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
    max-height: 18rem;
    overflow-y: auto;
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-control);
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
    width: 7rem;
    text-align: center;
    flex-shrink: 0;
    display: inline-block;
  }
  .gchip.installed {
    color: #fff;
    background: var(--zelda-green);
  }
  .gchip.new {
    color: var(--ink);
    background: var(--surface-sunk);
    border: 1px solid var(--model-accent);
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
  .homebrew-dropdown summary {
    cursor: pointer;
    user-select: none;
    outline: none;
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
    color: #b03030;
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
</style>
