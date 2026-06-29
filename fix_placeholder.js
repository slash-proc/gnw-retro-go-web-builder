const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/Carousel.svelte', 'utf-8');

file = file.replace(
  '.coverflow-item--selected img, .coverflow-item--selected .coverflow-item__placeholder {\n    filter: drop-shadow(0 0 15px #007bff) drop-shadow(0 0 5px #007bff);\n  }',
  '.coverflow-item--selected img {\n    filter: drop-shadow(0 0 15px #007bff) drop-shadow(0 0 5px #007bff);\n  }\n  .coverflow-item--selected .coverflow-item__placeholder {\n    border-color: #007bff;\n    box-shadow: inset 0 0 15px rgba(0,0,0,0.8), 0 0 15px #007bff;\n  }'
);

fs.writeFileSync('apps/web/src/lib/ui/Carousel.svelte', file);
