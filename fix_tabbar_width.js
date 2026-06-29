const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/views/Advanced.svelte', 'utf-8');

file = file.replace(
  '  .tabbar {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    gap: 0.15rem;',
  '  .tabbar {\n    width: fit-content;\n    margin: 0 auto;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    gap: 0.15rem;'
);

fs.writeFileSync('apps/web/src/lib/views/Advanced.svelte', file);
