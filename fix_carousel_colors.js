const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/Carousel.svelte', 'utf-8');

file = file.replace(
  'background: #000; /* black as requested */',
  'background: var(--surface);'
);
file = file.replace(
  'background: #000; /* light gray as per screenshot */',
  'background: var(--surface);'
);
file = file.replace(
  'background: #000;',
  'background: var(--surface);'
);

file = file.replace(
  'background: rgba(255, 255, 255, 0.1);',
  'background: var(--surface-sunk);'
);

file = file.replace(
  'background: #666;',
  'background: var(--ink-soft);'
);

file = file.replace(
  'background: #888;',
  'background: var(--ink);'
);

file = file.replace(
  'background: #111;',
  'background: var(--surface-sunk);'
);

file = file.replace(
  'border: 2px solid #333;',
  'border: 2px solid var(--hairline);'
);

file = file.replace(
  'color: #555;',
  'color: var(--ink-soft);'
);

fs.writeFileSync('apps/web/src/lib/ui/Carousel.svelte', file);
