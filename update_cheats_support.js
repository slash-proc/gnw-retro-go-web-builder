const fs = require('fs');
let content = fs.readFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', 'utf-8');

// Update supported systems based on README
content = content.replace(
  /const supportedCheatSystems: Record<string, string> = {[\s\S]*?};/,
  `const supportedCheatSystems: Record<string, string> = {
    nes: "NES", gb: "Game Boy", gbc: "Game Boy", pce: "PCE", msx: "MSX",
  };
  const isCheatSupported = $derived(!!supportedCheatSystems[system]);`
);

// Apply gray-out styling
content = content.replace(
  '<div class="panel cheats-panel">',
  '<div class="panel cheats-panel" class:disabled={!isCheatSupported}>'
);

// Add an overlay or just let CSS pointer-events handle it
const overlayStr = `      {#if !isCheatSupported}
        <div class="cheats-overlay">
          <p class="muted">Cheats not supported for {system.toUpperCase()}</p>
        </div>
      {/if}
      
      <div class="cheats-columns">`;
      
content = content.replace(
  '<div class="cheats-columns">',
  overlayStr
);

const stylesToAdd = `
  .cheats-panel.disabled {
    opacity: 0.5;
    pointer-events: none;
    position: relative;
  }
  .cheats-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface);
    padding: 0.5rem 1rem;
    border-radius: var(--r-control);
    border: 1px solid var(--hairline);
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  .cheats-columns {
`;

content = content.replace('.cheats-columns {', stylesToAdd);

fs.writeFileSync('apps/web/src/lib/advanced/GameDetailsPanel.svelte', content);
