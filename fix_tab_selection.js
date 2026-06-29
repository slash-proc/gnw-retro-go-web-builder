const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

file = file.replace(
  '  let consoleFilter = $state<string>("all");\n  function clearSelection(e: MouseEvent) {\n    const target = e.target as HTMLElement;\n    if (!target.closest(".row") && !target.closest(".coverflow-item") && !target.closest(".action-btn")) {\n      selectedCarouselId = "";\n    }\n  }',
  '  let consoleFilter = $state<string>("all");\n  let hasInitializedSelection = $state(false);\n\n  $effect(() => {\n    // When filter changes, reset the initialization flag\n    consoleFilter;\n    hasInitializedSelection = false;\n  });\n\n  function clearSelection(e: MouseEvent) {\n    const target = e.target as HTMLElement;\n    if (!target.closest(".row") && !target.closest(".coverflow-item") && !target.closest(".action-btn")) {\n      selectedCarouselId = "";\n      hasInitializedSelection = true;\n    }\n  }'
);

file = file.replace(
  '  $effect(() => {\n    if (selectedCarouselId && !carouselCovers.some(c => c.id === selectedCarouselId) && !unknownHomebrew.some(g => g.name === selectedCarouselId)) {\n      selectedCarouselId = "";\n    }\n  });',
  '  $effect(() => {\n    if (selectedCarouselId && !carouselCovers.some(c => c.id === selectedCarouselId) && !unknownHomebrew.some(g => g.name === selectedCarouselId)) {\n      selectedCarouselId = "";\n      hasInitializedSelection = false;\n    }\n    if (!selectedCarouselId && carouselCovers.length > 0 && !hasInitializedSelection) {\n      selectedCarouselId = carouselCovers[0].id;\n      hasInitializedSelection = true;\n    }\n  });'
);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', file);
