const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');

file = file.replace(
  '  .ofw {\n    color: rgba(26, 23, 20, 0.7);\n  }\n',
  ''
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', file);
