const fs = require('fs');

let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

// 1. Add state variables near the top
const stateInjection = `  // --- Cover Art State ---
  let coverSource = $state<"file" | "scraper">("file");
  let coverVariant = $state<"screenshot" | "boxart" | "multi-3" | "multi-4" | "multi-5">("screenshot");

  // --- Saves State ---`;
  
content = content.replace('  // --- Saves State ---', stateInjection);

// 2. Replace Cover Art Column HTML
const oldCoverPanel = `      <!-- Cover Art Column -->
      <div class="panel cover-panel">
        <h4 class="panel-header">Cover Art</h4>
        <div class="panel-content">
          <div class="cover-placeholder">
            {#if coverUrl}
              <img src={coverUrl} alt="{gameName} cover" />
            {:else}
              <div class="loading-box empty">No Cover Art</div>
            {/if}
          </div>
          <!-- Settings / placeholders go here -->
          <div class="cover-actions">
            <!-- Add buttons later -->
          </div>
        </div>
      </div>`;

const newCoverPanel = `      <!-- Cover Art Column -->
      <div class="panel cover-panel">
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h4 style="margin: 0; font-size: var(--fs-small); color: var(--ink);">Cover Art</h4>
          <button class="settings-btn" title="Settings" style="background: none; border: none; cursor: pointer; color: var(--ink-soft); display: flex; padding: 2px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
        <div class="panel-content" style="display: flex; flex-direction: column; gap: 0.75rem;">
          <div class="cover-placeholder" style="flex: 0 0 auto;">
            {#if coverUrl}
              <img src={coverUrl} alt="{gameName} cover" />
            {:else}
              <div class="loading-box empty">No Cover Art</div>
            {/if}
          </div>

          <div class="cover-options" style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
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
                  <option value="screenshot">Screenshot</option>
                  <option value="boxart">Boxart</option>
                  <option value="multi-3">Multi-3</option>
                  <option value="multi-4">Multi-4</option>
                  <option value="multi-5">Multi-5</option>
                </select>
              </div>
            {/if}
          </div>
        </div>
      </div>`;

content = content.replace(oldCoverPanel, newCoverPanel);

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
