const fs = require('fs');

let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

// The corrupted block starts around line 320 and ends around line 390
// Let's just find the start of saves-tabs and the start of download-btn, and replace everything in between.

const startStr = `        <div class="saves-tabs">`;
const endStr = `        <button 
          class="btn download-btn" 
          disabled={!selectedSlot?.savFile || downloadingSave}
          onclick={() => downloadSaveFile(selectedSlot!.savFile!)}
        >
          Download Save
        </button>`;

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
  const goodMiddle = `        <div class="saves-tabs">
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

  content = content.substring(0, startIdx) + goodMiddle + content.substring(endIdx);
  fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
}

