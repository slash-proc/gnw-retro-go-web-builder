<script lang="ts">
  import { device } from "../device.svelte.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";

  let loading = $state(false);
  let progress = $state(0);
  let error = $state<string | null>(null);
  
  interface SaveSlot {
    slot: string; // "0", "1", "2", "3", "sram"
    savFile?: LittlefsTreeNode;
    rawFile?: LittlefsTreeNode;
  }
  
  interface GameSaves {
    game: string;
    console: string;
    slots: SaveSlot[];
  }

  let saves = $state<GameSaves[]>([]);
  let loaded = $state(false);
  
  let selectedGame = $state<GameSaves | null>(null);
  let selectedSlot = $state<SaveSlot | null>(null);
  let screenshotDataUrl = $state<string | null>(null);
  let downloading = $state<string | null>(null);
  
  let consoleFilter = $state<string>("all");

  const systems = $derived.by(() => {
    const map = new Map<string, number>();
    for (const gs of saves) {
      map.set(gs.console, (map.get(gs.console) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([system, count]) => ({ system, count }))
      .sort((a, b) => a.system.localeCompare(b.system));
  });

  const visibleSaves = $derived(
    saves.filter(gs => consoleFilter === "all" || gs.console === consoleFilter)
  );

  async function loadSaves() {
    if (loading || loaded) return;
    loading = true;
    error = null;
    try {
      const tree = await ensureLfsTree((p) => { progress = p; });
      const dataDir = tree.children?.find((c) => c.name === "data" && c.isDirectory);
      if (!dataDir || !dataDir.children) {
        saves = [];
        return;
      }
      
      const parsedSaves = new Map<string, GameSaves>();
      
      for (const consoleDir of dataDir.children) {
        if (!consoleDir.isDirectory || !consoleDir.children) continue;
        
        for (const file of consoleDir.children) {
          if (file.isDirectory) continue;
          
          let gameName = "";
          let slot = "";
          let type = "";
          
          if (file.name.endsWith(".sram")) {
            gameName = file.name.replace(/\.sram$/, "");
            slot = "sram";
            type = "sram";
          } else {
            const m = file.name.match(/^(.*?)-(\d+)\.(raw|sav)$/);
            if (m) {
              gameName = m[1];
              slot = m[2];
              type = m[3];
            } else {
              continue;
            }
          }
          
          const key = `${consoleDir.name}/${gameName}`;
          if (!parsedSaves.has(key)) {
            parsedSaves.set(key, { game: gameName, console: consoleDir.name, slots: [] });
          }
          const gs = parsedSaves.get(key)!;
          
          let slotObj = gs.slots.find((s) => s.slot === slot);
          if (!slotObj) {
            slotObj = { slot };
            gs.slots.push(slotObj);
          }
          
          if (type === "sav" || type === "sram") slotObj.savFile = file;
          if (type === "raw") slotObj.rawFile = file;
        }
      }
      
      const result = Array.from(parsedSaves.values());
      result.forEach(gs => {
        gs.slots.sort((a, b) => a.slot === "sram" ? -1 : b.slot === "sram" ? 1 : a.slot.localeCompare(b.slot));
      });
      result.sort((a, b) => {
        if (a.console !== b.console) return a.console.localeCompare(b.console);
        return a.game.localeCompare(b.game);
      });
      saves = result;
      
      // Auto-select first game with a screenshot, or just first game
      if (saves.length > 0) {
        const gameWithScreenshot = saves.find(gs => gs.slots.some(s => s.rawFile)) || saves[0];
        selectGame(gameWithScreenshot);
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      loaded = true;
    }
  }

  $effect(() => {
    if (!loaded && !loading && !error) {
      loadSaves();
    }
  });

  async function downloadFile(file: LittlefsTreeNode) {
    if (downloading) return;
    downloading = file.path;
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
      downloading = null;
    }
  }

  async function downloadRawImageAsPng(file: LittlefsTreeNode) {
    if (downloading) return;
    downloading = file.path;
    try {
      let dataUrl = screenshotDataUrl;
      if (!dataUrl || selectedSlot?.rawFile?.path !== file.path) {
        const data = await readLfsFile(file.path);
        dataUrl = renderRgb565(data);
      }
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = file.name.replace(/\.raw$/, ".png");
      a.click();
    } catch (e) {
      alert("Failed to download image: " + e);
    } finally {
      downloading = null;
    }
  }

  function renderRgb565(raw: Uint8Array): string {
    const width = 320;
    const height = 240;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(width, height);
    
    let o = 0;
    for (let i = 0; i < width * height; i++) {
      const p = raw[i * 2] | (raw[i * 2 + 1] << 8);
      const r = ((p >> 11) & 0x1f) * 255 / 31;
      const g = ((p >> 5) & 0x3f) * 255 / 63;
      const b = (p & 0x1f) * 255 / 31;
      imgData.data[o++] = r;
      imgData.data[o++] = g;
      imgData.data[o++] = b;
      imgData.data[o++] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function selectGame(gs: GameSaves) {
    selectedGame = gs;
    const slot0 = gs.slots.find(s => s.slot === "0") || gs.slots.find(s => s.rawFile) || gs.slots[0];
    if (slot0) selectSlot(slot0);
  }

  async function selectSlot(slot: SaveSlot) {
    if (selectedSlot === slot && screenshotDataUrl) return;
    selectedSlot = slot;
    screenshotDataUrl = null;
    
    if (slot.rawFile) {
      const path = slot.rawFile.path;
      downloading = path;
      try {
        const data = await readLfsFile(path);
        screenshotDataUrl = renderRgb565(data);
      } catch (e) {
        console.error("Failed to load screenshot:", e);
      } finally {
        downloading = null;
      }
    }
  }
</script>

<div class="saves-section">
  {#if loading}
    <p class="muted">Reading LittleFS partition over SWD ({Math.round(progress * 100)}%)....</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if saves.length === 0}
    <p class="muted">No saves found in /data.</p>
  {:else}
    <div class="split">
      <div class="left-pane">
        <div class="seltable">
          <div class="consoles">
            <button class="console" class:active={consoleFilter === "all"} onclick={() => (consoleFilter = "all")}>
              All ({saves.length})
            </button>
            {#each systems as s}
              <button class="console" class:active={consoleFilter === s.system} onclick={() => (consoleFilter = s.system)}>
                {s.system} ({s.count})
              </button>
            {/each}
          </div>

          <div class="rows">
            {#each visibleSaves as gs}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <label class="row" class:active={selectedGame === gs} onclick={() => selectGame(gs)}>
                <span class="gchip console-chip">{gs.console}</span>
                <span class="gname">{gs.game}</span>
                <span class="gsize mono">{gs.slots.length} files</span>
              </label>
            {/each}
            {#if visibleSaves.length === 0}
              <p class="muted" style="padding: 1rem;">No games match this filter.</p>
            {/if}
          </div>
        </div>
      </div>
      
      {#if selectedGame && selectedSlot}
        <div class="right-pane">
          <div class="preview-header">
            <h4 class="preview-title">{selectedGame.game}</h4>
            <div class="slot-tabs">
              {#each selectedGame.slots as slot}
                <button 
                  class="slot-tab" 
                  class:active={selectedSlot === slot}
                  onclick={() => selectSlot(slot)}>
                  {slot.slot === "sram" ? "SRAM" : `Slot ${slot.slot}`}
                </button>
              {/each}
            </div>
          </div>
          
          <div class="preview-image">
            {#if downloading === selectedSlot.rawFile?.path}
              <div class="loading-box">Loading...</div>
            {:else if screenshotDataUrl}
              <img src={screenshotDataUrl} alt="Screenshot" />
            {:else if selectedSlot.rawFile}
              <div class="loading-box">Failed to render</div>
            {:else}
              <div class="loading-box empty">No screenshot</div>
            {/if}
          </div>
          
          <div class="actions">
            {#if selectedSlot.savFile}
              <button 
                class="btn primary-action" 
                disabled={downloading === selectedSlot.savFile.path}
                onclick={() => downloadFile(selectedSlot!.savFile!)}>
                <span class="icon">💾</span> Download Save
              </button>
            {/if}
            {#if selectedSlot.rawFile}
              <button 
                class="btn secondary-action" 
                disabled={downloading === selectedSlot.rawFile.path}
                onclick={() => downloadRawImageAsPng(selectedSlot!.rawFile!)}>
                <span class="icon">🖼️</span> Download Image
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .saves-section {
    padding: 0;
  }
  .split {
    display: flex;
    gap: 1rem;
    align-items: stretch;
  }
  .left-pane {
    flex: 1;
    min-width: 0;
  }
  .right-pane {
    width: 320px;
    background: var(--surface-sunk);
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
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
  
  .rows {
    display: flex;
    flex-direction: column;
    max-height: 24rem;
    overflow-y: auto;
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-control);
    background: var(--surface);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.5rem;
    font-size: var(--fs-caption);
    border-bottom: 1px solid var(--surface-sunk);
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface-sunk);
  }
  .row.active {
    background: var(--surface-sunk);
    border-left: 3px solid var(--model-accent, var(--brand-blue));
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
    font-weight: 500;
  }
  .gsize {
    color: var(--ink-soft);
    font-size: var(--fs-micro);
  }
  .gchip {
    font-size: var(--fs-micro);
    font-weight: 600;
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    white-space: nowrap;
  }
  .console-chip {
    background: var(--surface-sunk);
    color: var(--ink-soft);
    border: 1px solid var(--hairline);
    text-transform: uppercase;
  }
  
  .preview-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .preview-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slot-tabs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .slot-tab {
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--ink-soft);
    border-radius: var(--r-control);
    padding: 0.2rem 0.5rem;
    font-size: var(--fs-micro);
    cursor: pointer;
    font-family: inherit;
  }
  .slot-tab:hover {
    background: var(--surface-sunk);
    color: var(--ink);
  }
  .slot-tab.active {
    background: var(--model-accent, var(--brand-blue));
    color: #fff;
    border-color: var(--model-accent, var(--brand-blue));
    font-weight: 600;
  }
  
  .preview-image {
    width: 100%;
    aspect-ratio: 4/3;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ink-soft);
  }
  .preview-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .loading-box {
    color: #fff;
    font-size: 0.9em;
    opacity: 0.7;
  }
  .empty {
    color: var(--ink-soft);
  }
  
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    border-radius: var(--r-control);
    font-family: inherit;
    font-size: var(--fs-caption);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .primary-action {
    background: var(--surface);
    border-color: var(--hairline);
    color: var(--ink);
  }
  .primary-action:hover:not(:disabled) {
    border-color: var(--ink-soft);
  }
  .secondary-action {
    background: transparent;
    border-color: transparent;
    color: var(--ink-soft);
  }
  .secondary-action:hover:not(:disabled) {
    color: var(--ink);
  }
</style>
