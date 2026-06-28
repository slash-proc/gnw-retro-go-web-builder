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
  let selectedSlot = $state<SaveSlot | null>(null);
  let screenshotDataUrl = $state<string | null>(null);
  let downloading = $state<string | null>(null);

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

  async function downloadFile(file: LittlefsTreeNode, ev: Event) {
    ev.stopPropagation();
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

  function renderRgb565(raw: Uint8Array): string {
    const width = 320;
    const height = 240;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(width, height);
    
    // STM32/Retro-Go often stores RGB565 in little endian or byteswapped
    let o = 0;
    for (let i = 0; i < width * height; i++) {
      // Assuming little endian, if colors are wrong this might be big endian
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

  async function selectSlot(slot: SaveSlot) {
    if (selectedSlot === slot) return;
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

<div class="saves-section" class:has-selection={selectedSlot !== null}>
  {#if loading}
    <p class="muted">Reading LittleFS partition over SWD ({Math.round(progress * 100)}%)...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if saves.length === 0}
    <p class="muted">No saves found in /data.</p>
  {:else}
    <div class="split">
      <div class="left-pane">
        <div class="table-scroll">
          <table class="grid">
            <thead>
              <tr>
                <th>Game</th>
                <th>Saves</th>
              </tr>
            </thead>
            <tbody>
              {#each saves as gs}
                <tr>
                  <td>
                    <span class="chip">{gs.console}</span>
                    <strong class="game-name">{gs.game}</strong>
                  </td>
                  <td>
                    <div class="slots">
                      {#each gs.slots as slot}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div 
                          class="slot-row" 
                          class:active={selectedSlot === slot}
                          onclick={() => selectSlot(slot)}>
                          <span class="slot-name">{slot.slot === "sram" ? "SRAM" : `Slot ${slot.slot}`}</span>
                          <span class="indicators">
                            {#if slot.rawFile}<span class="icon" title="Has Screenshot">🖼️</span>{/if}
                            {#if slot.savFile}<span class="icon" title="Has Save Data">💾</span>{/if}
                          </span>
                        </div>
                      {/each}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      
      {#if selectedSlot}
        <div class="right-pane">
          <h4 class="preview-title">
            Preview: {selectedSlot.slot === "sram" ? "SRAM" : `Slot ${selectedSlot.slot}`}
          </h4>
          
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
                class="action" 
                disabled={downloading === selectedSlot.savFile.path}
                onclick={(e) => downloadFile(selectedSlot!.savFile!, e)}>
                Download Save
              </button>
            {/if}
            {#if selectedSlot.rawFile}
              <button 
                class="action secondary" 
                disabled={downloading === selectedSlot.rawFile.path}
                onclick={(e) => downloadFile(selectedSlot!.rawFile!, e)}>
                Download Raw Image
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
    background: var(--surface);
    border-radius: var(--r-card);
    transition: all 0.3s ease;
  }
  .split {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
  }
  .left-pane {
    flex: 1;
    min-width: 0;
  }
  .right-pane {
    width: 340px;
    background: var(--surface-sunk);
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    padding: 1rem;
    position: sticky;
    top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .table-scroll {
    max-height: 600px;
    overflow-y: auto;
  }
  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }
  .grid th, .grid td {
    padding: 0.75rem;
    border-bottom: 1px solid var(--surface-sunk);
    text-align: left;
    vertical-align: top;
  }
  .grid th {
    position: sticky;
    top: 0;
    background: var(--surface);
    z-index: 1;
  }
  
  .chip {
    background: var(--surface-sunk);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 0.8em;
    text-transform: uppercase;
    margin-right: 0.5rem;
    display: inline-block;
  }
  .game-name {
    display: inline-block;
  }
  
  .slots {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .slot-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .slot-row:hover {
    background: var(--surface-sunk);
  }
  .slot-row.active {
    background: var(--surface-sunk);
    border-color: var(--model-accent, var(--brand-blue));
  }
  .slot-name {
    font-weight: 500;
  }
  .indicators .icon {
    font-size: 1.1em;
    margin-left: 0.2rem;
    opacity: 0.8;
  }
  
  .preview-title {
    margin: 0;
    font-size: 1.1em;
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
  .action {
    width: 100%;
    justify-content: center;
  }
  .action.secondary {
    background: transparent;
    border: 1px solid var(--ink-soft);
    color: var(--ink);
  }
  .action.secondary:hover {
    background: var(--surface);
  }
</style>
