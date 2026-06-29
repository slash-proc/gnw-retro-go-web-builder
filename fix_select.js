const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

content = content.replace(
  /<button class="action-btn" onclick=\{\(\) => \{[^}]*romSelection\.overrides\.set\(g\.key, true\);[^}]*\}\}>Select All<\/button>/,
  `<button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        const state = getActionState(g);
                        if (state.label === 'prepare') state.action();
                        else if (state.label === 'not installed') romSelection.toggleHomebrew(g.hb.key, false);
                      } else {
                        if (!romSelection.isSelected(g.key)) romSelection.toggle(g.key);
                      }
                    }
                  }}>Select All</button>`
);

content = content.replace(
  /<button class="action-btn" onclick=\{\(\) => \{[^}]*romSelection\.overrides\.set\(g\.key, false\);[^}]*\}\}>Unselect All<\/button>/,
  `<button class="action-btn" onclick={() => {
                    for (const g of visibleGames) {
                      if (g.isHomebrew) {
                        if (romSelection.isHomebrewSelected(g.hb.key)) romSelection.toggleHomebrew(g.hb.key, true);
                      } else {
                        if (romSelection.isSelected(g.key)) romSelection.toggle(g.key);
                      }
                    }
                  }}>Unselect All</button>`
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', content);
