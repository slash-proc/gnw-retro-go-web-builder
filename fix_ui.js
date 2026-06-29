const fs = require('fs');

// 1. Carousel background
let carousel = fs.readFileSync('apps/web/src/lib/ui/Carousel.svelte', 'utf-8');
carousel = carousel.replace('background: #e6e6e6;', 'background: #000;');
fs.writeFileSync('apps/web/src/lib/ui/Carousel.svelte', carousel);

// 2. RomManagementTab
let romTab = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

// move delta
const deltaStr = `
          <p class="delta">
            <strong>+{romSelection.additions.length + hbAdditions}</strong> add ({MiB(romSelection.additionsBytes + hbAdditionsBytes)} MiB)
            · <strong>−{romSelection.removals.length + hbRemovals}</strong> remove ({MiB(romSelection.removalsBytes + hbRemovalsBytes)} MiB)
          </p>`;

romTab = romTab.replace(deltaStr, '');

// insert before </div> <!-- games-pane -->
romTab = romTab.replace(
  '              </div> <!-- games-pane -->',
  deltaStr + '\n              </div> <!-- games-pane -->'
);

// remove margins from info-pane
romTab = romTab.replace(
  '<div class="info-pane" style="margin-top: 1rem; margin-bottom: 1rem;">',
  '<div class="info-pane">'
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', romTab);
