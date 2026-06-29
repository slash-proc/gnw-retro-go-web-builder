const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');

file = file.replace(
  '<span class="key">RG:</span>',
  '<span class="key">Retro-Go:</span>'
);

file = file.replace(
  '<span class="key">OFW:</span>',
  '<span class="key">Official Firmware:</span>'
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', file);
