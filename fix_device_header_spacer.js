const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');

file = file.replace(
  '<header class="band">\n  {#if !device.isConnected && !device.everConnected}\n    <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>\n  {/if}\n  <strong class="brand">GNW Web Builder</strong>\n\n  {#if device.isConnected || device.everConnected}',
  '<header class="band">\n  {#if !device.isConnected && !device.everConnected}\n    <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>\n  {/if}\n  <strong class="brand">GNW Web Builder</strong>\n  <span class="spacer"></span>\n\n  {#if device.isConnected || device.everConnected}'
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', file);
