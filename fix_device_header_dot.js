const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');

file = file.replace(
  '<header class="band">\n  <strong class="brand">GNW Web Builder</strong>\n\n  {#if device.isConnected || device.everConnected}\n    <div class="overview-line">\n      <span class="dot {statusColor}" aria-hidden="true"></span>',
  '<header class="band">\n  {#if !device.isConnected && !device.everConnected}\n    <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>\n  {/if}\n  <strong class="brand">GNW Web Builder</strong>\n\n  {#if device.isConnected || device.everConnected}\n    <div class="overview-line">\n      <span class="dot {statusColor}" aria-hidden="true"></span>'
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', file);
