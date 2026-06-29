const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

const replacement = `
        <div class="saves-preview-container">
          <button 
            class="arrow-btn" 
            disabled={!gameSaves.length || gameSaves.indexOf(selectedSlot) <= 0}
            onclick={() => selectedSlot = gameSaves[gameSaves.indexOf(selectedSlot) - 1]}
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
            disabled={!gameSaves.length || gameSaves.indexOf(selectedSlot) >= gameSaves.length - 1}
            onclick={() => selectedSlot = gameSaves[gameSaves.indexOf(selectedSlot) + 1]}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
`;

content = content.replace(
  /<div class="saves-preview">[\s\S]*?<\/div>/,
  replacement
);

const stylesToAdd = `
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
`;
content = content.replace('.saves-preview {', stylesToAdd);

// Also let's gray out the checkboxes like the mockup if there are NO presets in the DB
content = content.replace(
  '{#if presets.length === 0}',
  '{#if presets.length === 0}\n                <span class="muted" style="font-size: var(--fs-micro);">No presets found</span>'
); // wait I already added that.

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
