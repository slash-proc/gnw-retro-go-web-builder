const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

// Update effect to not force selectedCarouselId to first item if empty
file = file.replace(
  '  $effect(() => {\n    if (carouselCovers.length > 0 && !carouselCovers.some(c => c.id === selectedCarouselId)) {\n      selectedCarouselId = carouselCovers[0].id;\n    }\n  });',
  '  $effect(() => {\n    if (selectedCarouselId && !carouselCovers.some(c => c.id === selectedCarouselId) && !unknownHomebrew.some(g => g.name === selectedCarouselId)) {\n      selectedCarouselId = "";\n    }\n  });'
);

// Add global click listener function
file = file.replace(
  '  let consoleFilter = $state<string>("all");',
  '  let consoleFilter = $state<string>("all");\n  function clearSelection(e: MouseEvent) {\n    const target = e.target as HTMLElement;\n    if (!target.closest(".row") && !target.closest(".coverflow-item") && !target.closest(".action-btn")) {\n      selectedCarouselId = "";\n    }\n  }'
);

// Attach svelte:window click listener
file = file.replace(
  '<div class="rom-management-tab">',
  '<svelte:window onclick={clearSelection} />\n<div class="rom-management-tab">'
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', file);
