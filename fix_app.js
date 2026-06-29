const fs = require('fs');
let file = fs.readFileSync('apps/web/src/App.svelte', 'utf-8');

file = file.replace(
  '<div class="app" data-model={device.accent ?? undefined}>\n  <StubLoadModal />\n  <DeviceHeader />\n  <main class="body">\n    {#if !device.isConnected && !device.everConnected && !browseAnyway}\n      <Connect onSkip={() => { browseAnyway = true; entryTab = "roms"; mode = "advanced"; }} onConnected={() => (entryTab = "info")} />\n    {:else}\n      <DeviceOverview />',
  '<div class="app" data-model={device.accent ?? undefined}>\n  <StubLoadModal />\n  <header class="app-header">\n    <DeviceHeader />\n    {#if device.isConnected || device.everConnected || browseAnyway}\n      <DeviceOverview />\n    {/if}\n  </header>\n  <main class="body">\n    {#if !device.isConnected && !device.everConnected && !browseAnyway}\n      <Connect onSkip={() => { browseAnyway = true; entryTab = "roms"; mode = "advanced"; }} onConnected={() => (entryTab = "info")} />\n    {:else}'
);

file = file.replace(
  '  .app {\n    min-height: 100vh;\n  }',
  '  .app {\n    min-height: 100vh;\n  }\n  .app-header {\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    display: flex;\n    flex-direction: column;\n  }'
);

fs.writeFileSync('apps/web/src/App.svelte', file);
