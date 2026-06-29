const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

// 1. Sync information pane with carousel
content = content.replace(
  '  let selectedCarouselId = $state<string>("");',
  `  let selectedCarouselId = $state<string>("");
  $effect(() => {
    if (carouselCovers.length > 0 && !carouselCovers.some(c => c.id === selectedCarouselId)) {
      selectedCarouselId = carouselCovers[0].id;
    }
  });`
);

// 2. Remove file ending in games list
content = content.replace(
  /<span class="gname">\{g\.name\}<\/span>/g,
  '<span class="gname">{g.name.replace(/\\.[^/.]+$/, "")}</span>'
);

// 3. Select all / Unselect all honoring current filter + homebrew conversions
content = content.replace(
  /<button class="action-btn" onclick=\{\(\) => romSelection\.setSystem\(consoleFilter, true\)\}>Select All<\/button>/,
  `<button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        const state = getActionState(g);
                        if (state.label === 'prepare') state.action();
                        else if (state.label === 'not installed') romSelection.toggleHomebrew(g.hb.key, false);
                      } else {
                        romSelection.overrides.set(g.key, true);
                      }
                    }
                  }}>Select All</button>`
);

content = content.replace(
  /<button class="action-btn" onclick=\{\(\) => romSelection\.setSystem\(consoleFilter, false\)\}>Unselect All<\/button>/,
  `<button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        romSelection.toggleHomebrew(g.hb.key, true);
                      } else {
                        romSelection.overrides.set(g.key, false);
                      }
                    }
                  }}>Unselect All</button>`
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', content);
