const fs = require('fs');
let romTab = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

romTab = romTab.replace(
  '  .games-pane {\n    flex: 1;\n    display: flex;\n    flex-direction: column;\n    background: white;',
  '  .games-pane {\n    flex: 1;\n    display: flex;\n    flex-direction: column;\n    background: var(--surface);'
);

romTab = romTab.replace(
  '  .err {\n    color: #b03030;\n  }',
  '  .err {\n    color: var(--danger);\n  }'
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', romTab);
