const fs = require('fs');
let file = fs.readFileSync('apps/web/src/App.svelte', 'utf-8');

file = file.replace(
  '    {#if device.isConnected || device.everConnected || browseAnyway}\n      <DeviceOverview />\n    {/if}',
  ''
);

fs.writeFileSync('apps/web/src/App.svelte', file);
