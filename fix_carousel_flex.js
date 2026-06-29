const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/Carousel.svelte', 'utf-8');

file = file.replace(
  '.coverflow-item {\n    position: absolute;\n    top: 0;\n    left: 0;\n    background: transparent;\n    border: none;\n    padding: 0;\n    margin: 0;\n    cursor: pointer;\n    will-change: transform, opacity;\n  }',
  '.coverflow-item {\n    position: absolute;\n    top: 0;\n    left: 0;\n    background: transparent;\n    border: none;\n    padding: 0;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    transition: width 0.2s ease, height 0.2s ease;\n    margin: 0;\n    cursor: pointer;\n    will-change: transform, opacity;\n  }'
);

fs.writeFileSync('apps/web/src/lib/ui/Carousel.svelte', file);
