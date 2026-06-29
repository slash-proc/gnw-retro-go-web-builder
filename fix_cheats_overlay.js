const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

content = content.replace(
  '  .cheats-panel.disabled {\n    opacity: 0.5;\n    pointer-events: none;\n    position: relative;\n  }',
  `  .cheats-panel.disabled {
    position: relative;
  }
  .cheats-panel.disabled .cheats-columns {
    opacity: 0.3;
    pointer-events: none;
    user-select: none;
  }`
);

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
