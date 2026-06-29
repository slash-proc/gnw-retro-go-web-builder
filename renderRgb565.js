const fs = require('fs');
const content = fs.readFileSync('apps/web/src/lib/advanced/SavesSection.svelte', 'utf-8');
const match = content.match(/(function renderRgb565[\s\S]*?return canvas\.toDataURL\("image\/png"\);\n  })/);
if (match) {
  fs.writeFileSync('renderRgb565.txt', match[1]);
}
