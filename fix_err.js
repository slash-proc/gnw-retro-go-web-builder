const fs = require('fs');
let romTab = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

romTab = romTab.replace(
  'color: #b03030;',
  'color: var(--danger);'
);

romTab = romTab.replace(
  /background: #333;/g,
  'background: var(--ink);'
);
romTab = romTab.replace(
  /color: #fff;/g,
  'color: var(--surface);'
);
romTab = romTab.replace(
  /color: #161616;/g,
  'color: var(--surface);'
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', romTab);
