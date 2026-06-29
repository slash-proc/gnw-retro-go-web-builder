const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');

file = file.replace(
  '  .band {\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    display: flex;\n    align-items: center;\n    gap: 0.7rem;\n    background: var(--grad-gold);\n    color: #161616;\n    padding: 0.55rem 1.25rem;\n    border-bottom: 3px solid var(--model-accent);\n    transition: border-color 200ms ease;\n  }',
  '  .band {\n    display: flex;\n    align-items: center;\n    gap: 0.7rem;\n    background: var(--grad-gold);\n    color: #161616;\n    padding: 0.55rem 1.25rem;\n    /* border moved to app-header */\n  }'
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', file);
