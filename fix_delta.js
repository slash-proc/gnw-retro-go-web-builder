const fs = require('fs');
let romTab = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

romTab = romTab.replace(
  '          <p class="delta">',
  '          <p class="delta" style="padding: 1rem; border-top: 1px solid var(--surface-sunk); background: var(--surface);">'
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', romTab);
