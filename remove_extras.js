const fs = require('fs');

let content = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

// 1. Remove CheatsSection import
content = content.replace('import CheatsSection from "./CheatsSection.svelte";\n', '');

// 2. Change advance target
content = content.replace(
  'onclick={() => advance("select-games", "extras")}',
  'onclick={() => advance("select-games", "install-roms")}'
);

// 3. Remove the entire "Library Extras" block
const blockStart = `  <!-- 3. Library Extras — per-game cover art, saves, cheats. -->`;
const blockEnd = `    </AccordionSection>\n  </div>`;

const startIdx = content.indexOf(blockStart);
if (startIdx !== -1) {
  // Find the end of the accordion block
  const endSearchStr = `    </AccordionSection>\n  </div>`;
  const endIdx = content.indexOf(endSearchStr, startIdx);
  if (endIdx !== -1) {
    content = content.substring(0, startIdx) + content.substring(endIdx + endSearchStr.length + 1); // +1 for newline
  }
}

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', content);
