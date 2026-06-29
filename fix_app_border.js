const fs = require('fs');
let file = fs.readFileSync('apps/web/src/App.svelte', 'utf-8');

file = file.replace(
  '  .app-header {\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    display: flex;\n    flex-direction: column;\n  }',
  '  .app-header {\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    display: flex;\n    flex-direction: column;\n    border-bottom: 3px solid var(--model-accent);\n    transition: border-color 200ms ease;\n  }'
);

fs.writeFileSync('apps/web/src/App.svelte', file);
