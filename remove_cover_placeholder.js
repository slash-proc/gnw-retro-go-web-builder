const fs = require('fs');

let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

const placeholderBlock = `          <div class="cover-placeholder" style="flex: 0 0 auto;">
            {#if coverUrl}
              <img src={coverUrl} alt="{gameName} cover" />
            {:else}
              <div class="loading-box empty">No Cover Art</div>
            {/if}
          </div>

`;

content = content.replace(placeholderBlock, '');
fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
