const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/views/Advanced.svelte', 'utf-8');

// Add Wizard import
file = file.replace(
  'import RomManagementTab from "./RomManagementTab.svelte";',
  'import RomManagementTab from "./RomManagementTab.svelte";\n  import Wizard from "./Wizard.svelte";'
);

// Add mode export
file = file.replace(
  '  let { initialTab, onInitialApplied }:',
  '  let { initialTab, onInitialApplied, mode = "advanced" }:'
);
file = file.replace(
  '  }: { initialTab?: Tab; onInitialApplied?: () => void } = $props();',
  '  }: { initialTab?: Tab; onInitialApplied?: () => void; mode?: "wizard" | "advanced" } = $props();'
);

// We need to use $props, but we also want it bindable. Actually, Svelte 5 uses `bind:mode`.
// Wait, if we use `$props()`, we can just do:
// let { initialTab, onInitialApplied, mode = $bindable("advanced") } = $props();
file = file.replace(
  '  }: { initialTab?: Tab; onInitialApplied?: () => void; mode?: "wizard" | "advanced" } = $props();',
  '' // wait, need to carefully replace the $props line
);

fs.writeFileSync('apps/web/src/lib/views/Advanced.svelte', file);
