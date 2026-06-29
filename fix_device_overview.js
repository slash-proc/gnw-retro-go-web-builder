const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceOverview.svelte', 'utf-8');

file = file.replace(
  '<section class="overview">\n  <div class="row">',
  '<section class="overview">\n  <div class="overview-content">\n  <div class="row">'
);

file = file.replace(
  '    <span class="ofw" class:dim={!ofw}>Official Firmware: {ofwText}</span>\n  </div>\n</section>',
  '    <span class="ofw" class:dim={!ofw}>Official Firmware: {ofwText}</span>\n  </div>\n  </div>\n</section>'
);

file = file.replace(
  '  .overview {\n    /* Compact + centered — the two rows are glance-able, so it shouldn\'t sprawl across the\n       full wide frame. */\n    align-self: center;\n    width: 100%;\n    max-width: 640px;\n    background: var(--grad-gold);\n    color: #161616;\n    border: 3px solid var(--model-accent);\n    border-radius: var(--r-card);\n    box-shadow: var(--shadow-card);\n    padding: 0.55rem 0.9rem;\n    transition: border-color 200ms ease;\n    display: flex;\n    flex-direction: column;\n    gap: 0.2rem;\n  }',
  '  .overview {\n    width: 100%;\n    background: var(--grad-gold);\n    color: #161616;\n    padding-bottom: 0.55rem;\n    display: flex;\n    justify-content: center;\n  }\n  .overview-content {\n    width: 100%;\n    max-width: 640px;\n    display: flex;\n    flex-direction: column;\n    gap: 0.2rem;\n    padding: 0 0.9rem;\n  }'
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceOverview.svelte', file);
