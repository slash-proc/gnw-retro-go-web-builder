const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

content = content.replace(
  /<button class="action-btn" onclick=\{\(\) => \{\s*for \(const g of visibleGames\) \{\s*if \(g\.isHomebrew\) \{\s*romSelection\.toggleHomebrew\(g\.hb\.key, true\);\s*\} else \{\s*romSelection\.overrides\.set\(g\.key, false\);\s*\}\s*\}\s*\}\}>Unselect All<\/button>/,
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
