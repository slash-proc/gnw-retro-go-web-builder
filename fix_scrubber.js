const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/Carousel.svelte', 'utf-8');

file = file.replace(
  'return (focusIndex / Math.max(1, covers.length - 1)) * 100;',
  'return (smoothIndex.current / Math.max(1, covers.length - 1)) * 100;'
);

file = file.replace(
  'transition: left 0.1s ease-out, background 0.1s;',
  'transition: background 0.1s;'
);

file = file.replace(
  '.alphabet-scrubber-container {\n    width: 100%;\n    max-width: 400px;',
  '.alphabet-scrubber-container {\n    width: 66%;\n    max-width: none;'
);

fs.writeFileSync('apps/web/src/lib/ui/Carousel.svelte', file);
