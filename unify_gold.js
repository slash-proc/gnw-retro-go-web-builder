const fs = require('fs');

let app = fs.readFileSync('apps/web/src/App.svelte', 'utf-8');
app = app.replace(
  '    border-bottom: 3px solid var(--model-accent);',
  '    background: var(--grad-gold);\n    border-bottom: 3px solid var(--model-accent);'
);
fs.writeFileSync('apps/web/src/App.svelte', app);

let header = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');
header = header.replace(
  '    background: var(--grad-gold);\n    color: #161616;',
  '    background: transparent;\n    color: #161616;'
);
fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', header);

let overview = fs.readFileSync('apps/web/src/lib/ui/DeviceOverview.svelte', 'utf-8');
overview = overview.replace(
  '    background: var(--grad-gold);\n    color: #161616;',
  '    background: transparent;\n    color: #161616;'
);
fs.writeFileSync('apps/web/src/lib/ui/DeviceOverview.svelte', overview);
