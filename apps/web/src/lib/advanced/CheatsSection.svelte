<script lang="ts">
  import type { Game } from "../romSelection.svelte";
  import cheatDbJson from "../engine/cheatdb.json";

  const cheatDb = cheatDbJson as Record<string, Record<string, { c: string; e: string }[]>>;

  let consoleFilter = $state("all");
  let selectedGame = $state<Game | null>(null);
  let manualCode = $state("");

  // Cheats state per game
  let { configuredCheats = $bindable({}), games = [] }: { configuredCheats: Record<string, string[]>, games: Game[] } = $props();

  // Consoles logic
  const systems = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const g of games) {
      counts.set(g.system, (counts.get(g.system) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([system, count]) => ({ system, count }))
      .sort((a, b) => a.system.localeCompare(b.system));
  });

  const visibleGames = $derived.by(() => {
    let result = games;
    if (consoleFilter !== "all") {
      result = result.filter((g) => g.system === consoleFilter);
    }
    return result;
  });

  const supportedCheatSystems: Record<string, string> = {
    nes: "NES",
    gb: "Game Boy",
    gbc: "Game Boy",
    snes: "SNES",
    md: "Genesis",
    gen: "Genesis",
    gg: "Game Gear",
    pce: "PCE",
    msx: "MSX",
  };

  const dbConsoleName = $derived(selectedGame ? supportedCheatSystems[selectedGame.system] : null);
  
  // Fuzzy search preset matching
  const presets = $derived.by(() => {
    if (!selectedGame || !dbConsoleName || !cheatDb[dbConsoleName]) return [];
    
    const dbGames = cheatDb[dbConsoleName];
    // Very simple fuzzy search: check if selected game name is included in db game name (ignoring case/extension)
    const normalizedName = selectedGame.name.replace(/\.[^/.]+$/, "").toLowerCase();
    
    let bestMatchKey = null;
    for (const key of Object.keys(dbGames)) {
      if (key.toLowerCase().includes(normalizedName) || normalizedName.includes(key.toLowerCase())) {
        bestMatchKey = key;
        break; // take first match for now
      }
    }
    
    if (bestMatchKey) {
      return dbGames[bestMatchKey];
    }
    return [];
  });

  function selectGame(g: Game) {
    selectedGame = g;
    manualCode = "";
  }

  function countCodes(cheats: string[]): number {
    return cheats.reduce((total, cheatLine) => {
      const codePart = cheatLine.split(',')[0] || "";
      return total + (codePart.trim() ? codePart.split('+').length : 0);
    }, 0);
  }

  function addPreset(preset: { c: string; e: string }) {
    if (!selectedGame) return;
    const key = `${selectedGame.system}/${selectedGame.name}`;
    const current = configuredCheats[key] || [];
    
    // Clean up spacing around + to match Retro-Go expected format
    const code = preset.c.replace(/\s*\+\s*/g, '+').trim();
    const newCodesCount = code.split('+').length;
    
    if (countCodes(current) + newCodesCount > 13) {
      alert("Maximum 13 total codes allowed per game.");
      return;
    }
    configuredCheats[key] = [...current, `${code}, ${preset.e}`];
  }

  function addManual() {
    if (!selectedGame || !manualCode.trim()) return;
    const key = `${selectedGame.system}/${selectedGame.name}`;
    const current = configuredCheats[key] || [];
    
    const codePart = manualCode.split(',')[0] || "";
    const newCodesCount = codePart.trim() ? codePart.split('+').length : 0;

    if (countCodes(current) + newCodesCount > 13) {
      alert("Maximum 13 total codes allowed per game.");
      return;
    }
    configuredCheats[key] = [...current, manualCode.trim()];
    manualCode = "";
  }

  function removeCheat(index: number) {
    if (!selectedGame) return;
    const key = `${selectedGame.system}/${selectedGame.name}`;
    const current = configuredCheats[key] || [];
    configuredCheats[key] = current.filter((_, i) => i !== index);
  }

</script>

<div class="saves-section">
  <div class="split">
    <div class="left-pane">
      <div class="seltable">
        <div class="consoles">
          <button class="console" class:active={consoleFilter === "all"} onclick={() => (consoleFilter = "all")}>
            All ({games.length})
          </button>
          {#each systems as s}
            <button class="console" class:active={consoleFilter === s.system} onclick={() => (consoleFilter = s.system)}>
              {s.system} ({s.count})
            </button>
          {/each}
        </div>

        <div class="rows">
          {#each visibleGames as gs}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <label class="row" class:active={selectedGame === gs} onclick={() => selectGame(gs)}>
              <span class="gchip console-chip">{gs.system}</span>
              <span class="gname">{gs.name}</span>
              {#if (configuredCheats[`${gs.system}/${gs.name}`] || []).length > 0}
                <span class="gsize mono" style="color: var(--brand-green);">
                  {countCodes(configuredCheats[`${gs.system}/${gs.name}`] || [])} cheats
                </span>
              {/if}
            </label>
          {/each}
          {#if visibleGames.length === 0}
            <p class="muted" style="padding: 1rem;">No games match this filter.</p>
          {/if}
        </div>
      </div>
    </div>
    
    {#if selectedGame}
      <div class="right-pane">
        <div class="preview-header">
          <h4 class="preview-title">{selectedGame.name}</h4>
          {#if !dbConsoleName}
            <span class="gsize muted">Cheats not supported for {selectedGame.system}</span>
          {/if}
        </div>
        
        {#if dbConsoleName}
          <div class="controls-area">
            {#if presets.length > 0}
              <div class="field">
                <span class="muted" style="font-size: var(--fs-micro); margin-bottom: 0.25rem; display: block;">Presets from Database</span>
                <div class="preset-list">
                  {#each presets as p}
                    <button class="preset-btn" onclick={() => addPreset(p)}>
                      <span class="preset-code">{p.c}</span>
                      <span class="preset-desc">{p.e}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="field" style="margin-top: 1rem;">
              <span class="muted" style="font-size: var(--fs-micro); margin-bottom: 0.25rem; display: block;">Manual Entry (Code, Desc)</span>
              <div style="display: flex; gap: 0.5rem;">
                <input type="text" bind:value={manualCode} placeholder="e.g. SXIOPO, Inf lives" onkeydown={(e) => e.key === 'Enter' && addManual()} />
                <button class="btn secondary-action" onclick={addManual}>Add</button>
              </div>
            </div>
          </div>
          
          <div class="leger">
            <span class="muted" style="font-size: var(--fs-micro); margin-bottom: 0.5rem; display: block;">Enabled Cheats ({countCodes(configuredCheats[`${selectedGame.system}/${selectedGame.name}`] || [])}/13)</span>
            <div class="leger-list">
              {#each configuredCheats[`${selectedGame.system}/${selectedGame.name}`] || [] as cheat, i}
                <div class="leger-item">
                  <span class="cheat-text">{cheat}</span>
                  <button class="del-btn" onclick={() => removeCheat(i)}>✕</button>
                </div>
              {/each}
              {#if (configuredCheats[`${selectedGame.system}/${selectedGame.name}`] || []).length === 0}
                <p class="muted" style="font-size: var(--fs-micro);">No cheats enabled.</p>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
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
    gap: 0.25rem;
  }
  .preview-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 150px;
    overflow-y: auto;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    background: var(--surface);
  }
  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.25rem 0.5rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--surface-sunk);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }
  .preset-btn:hover {
    background: var(--surface-sunk);
  }
  .preset-code {
    font-family: monospace;
    font-weight: bold;
    font-size: var(--fs-micro);
    color: var(--ink);
  }
  .preset-desc {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }
  
  .leger {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--hairline);
    padding-top: 0.75rem;
  }
  .leger-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow-y: auto;
    max-height: 150px;
  }
  .leger-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    border: 1px solid var(--hairline);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: var(--fs-micro);
  }
  .cheat-text {
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .del-btn {
    background: transparent;
    border: none;
    color: var(--brand-red, red);
    cursor: pointer;
    font-weight: bold;
  }
  .del-btn:hover {
    opacity: 0.7;
  }

  input[type="text"] {
    flex: 1;
    min-width: 0;
    padding: 0.25rem;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    font-family: monospace;
    font-size: var(--fs-micro);
  }
  .btn {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: var(--fs-micro);
    cursor: pointer;
    border: 1px solid var(--hairline);
    background: var(--surface);
  }
</style>
