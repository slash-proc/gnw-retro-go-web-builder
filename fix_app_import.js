const fs = require('fs');
let file = fs.readFileSync('apps/web/src/App.svelte', 'utf-8');

file = file.replace(
  'import DeviceOverview from "./lib/ui/DeviceOverview.svelte";\n',
  ''
);

fs.writeFileSync('apps/web/src/App.svelte', file);
