const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

// Remove the `{#if !dbConsoleName}` condition for the cheats panel content
content = content.replace(
  /{#if !dbConsoleName}[\s\S]*?{:else}/,
  ''
);

// Remove the matching `{\/if}` at the end of the block
content = content.replace(
  /        <\/div>\n      {\/if}\n    <\/div>\n  <\/div>/,
  '        </div>\n    </div>\n  </div>'
);

// Ensure the presets list looks disabled/grayed out if there are no presets
content = content.replace(
  '<div class="presets-list">',
  '<div class="presets-list" class:disabled={presets.length === 0}>'
);

const styleToAdd = `
  .presets-list.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .cheats-columns {
`;

content = content.replace('.cheats-columns {', styleToAdd);

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
