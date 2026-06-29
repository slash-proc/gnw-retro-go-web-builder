const fs = require('fs');

let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

if (!content.includes('import { HOMEBREW_TITLES } from "../engine/homebrew.js";')) {
  content = content.replace(
    'import cheatDbJson from "../engine/cheatdb.json";',
    'import cheatDbJson from "../engine/cheatdb.json";\n  import { HOMEBREW_TITLES } from "../engine/homebrew.js";'
  );
}

content = content.replace(
  '    let baseName = gameName;\n    let foundSlots: SaveSlot[] = [];',
  `    let baseName = gameName;
    if (system === 'homebrew') {
      const hb = HOMEBREW_TITLES.find(h => h.key === gameKey || h.label === gameName);
      if (hb) {
        const binFile = hb.deviceFiles.find(f => f.endsWith('.bin'));
        if (binFile) {
          baseName = binFile;
        }
      }
    }
    let foundSlots: SaveSlot[] = [];`
);

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
