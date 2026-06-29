const fs = require('fs');

const renderRgb565 = fs.readFileSync('renderRgb565.txt', 'utf-8');

const svelteContent = `<script lang="ts">
  import { device } from "../device.svelte.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import cheatDbJson from "../engine/cheatdb.json";

  const cheatDb = cheatDbJson as Record<string, Record<string, { c: string; e: string }[]>>;

  let {
    gameKey,
    gameName,
    system,
    coverUrl,
    configuredCheats = $bindable({})
  }: {
    gameKey: string;
    gameName: string;
    system: string;
    coverUrl: string | null;
    configuredCheats: Record<string, string[]>;
  } = $props();

  const supportedCheatSystems: Record<string, string> = {
    nes: "NES", gb: "Game Boy", gbc: "Game Boy", snes: "SNES",
    md: "Genesis", gen: "Genesis", gg: "Game Gear", pce: "PCE", msx: "MSX",
  };
  const dbConsoleName = $derived(supportedCheatSystems[system]);

  const presets = $derived.by(() => {
    if (!dbConsoleName || !cheatDb[dbConsoleName]) return [];
    const dbGames = cheatDb[dbConsoleName];
    const normalizedName = gameName.replace(/\\.[^/.]+$/, "").toLowerCase();
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
      list = [...list, \`\${p.c}, \${p.e}\`];
    }
    configuredCheats[gameKey] = list;
  }

  let manualCode = $state("");
  let manualDesc = $state("");

  function addManual() {
    if (!manualCode.trim()) return;
    let list = configuredCheats[gameKey] || [];
    list = [...list, \`\${manualCode.trim()}, \${manualDesc.trim() || "Manual"}\`];
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

    let baseName = gameName.replace(/\\.[^/.]+$/, "");
    let foundSlots: SaveSlot[] = [];
    
    for (const file of consoleDir.children) {
      if (file.isDirectory) continue;
      let slot = "";
      let type = "";
      if (file.name === \`\${baseName}.sram\`) {
        slot = "sram";
        type = "sram";
      } else {
        const m = file.name.match(/^(.*?)-(\\d+)\\.(raw|sav)$/);
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

  // Debounced load
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

  ${renderRgb565}

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
    <h3>Cover Art</h3>
    <hr />
    <div class="panel-content cover-art-content">
      {#if coverUrl}
        <img src={coverUrl} alt="Cover Art" class="cover-image" />
      {:else}
        <div class="no-cover">No cover art found</div>
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
              {slot.slot === "sram" ? "SRAM" : \`Slot \${slot.slot}\`}
            </button>
          {/each}
          {#if gameSaves.length === 0}
            <span class="muted" style="font-size: var(--fs-micro);">No saves found</span>
          {/if}
        </div>
        
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
          class="btn download-btn" 
          disabled={!selectedSlot?.savFile || downloadingSave}
          onclick={() => downloadSaveFile(selectedSlot!.savFile!)}
        >
          Download Save
        </button>
      {/if}
    </div>
  </div>

  <div class="panel cheats-panel">
    <h3>Cheats</h3>
    <hr />
    <div class="panel-content cheats-content">
      {#if !dbConsoleName}
        <p class="muted" style="padding: 1rem;">Cheats not supported for {system.toUpperCase()}</p>
      {:else}
        <div class="cheats-columns">
          <div class="cheats-presets">
            <h4 class="cheats-col-head">Presets</h4>
            <div class="presets-list">
              {#each presets as p}
                <label class="preset-label">
                  <input type="checkbox" checked={isPresetEnabled(p)} onchange={() => togglePreset(p)} />
                  <span class="preset-name">{p.e || "Cheat"}</span>
                </label>
              {/each}
              {#if presets.length === 0}
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
      {/if}
    </div>
  </div>
</div>

<style>
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
  
  /* Cover Art */
  .cover-art-content {
    align-items: center;
    justify-content: center;
  }
  .cover-image {
    max-width: 100%;
    max-height: 200px;
    object-fit: contain;
    border-radius: 4px;
    border: 1px solid var(--hairline);
  }
  .no-cover {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    font-style: italic;
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
`;

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', svelteContent);

