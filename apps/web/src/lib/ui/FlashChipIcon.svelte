<script lang="ts">
  // The "Flash Memory" glyph — the stroked outline package drawn by every artboard that shows
  // it: Landing1/Landing2's media card (26px, stroke-width 1.2) and the header home button in
  // Main / RomsNewSystem / RomsSdNoCard / HeaderBusy (19px, stroke-width 1.3). All five draw
  // the identical path, so this one component covers every call site.
  //
  // It is a 12-lead outline, not the SOIC-8 the real chip is — the artboard's call, taken
  // verbatim under "artboard wins on pure paint". Shared between Landing.svelte and
  // DeviceHeader.svelte so the two stay pixel-identical.
  let { size = 48, strokeWidth = 1.2 }: { size?: number; strokeWidth?: number } = $props();
</script>

<svg
  viewBox="0 0 20 20"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
>
  <rect x="5" y="5" width="10" height="10" rx="1.2" />
  <path
    d="M7.5 5V3M10 5V3M12.5 5V3M7.5 17v-2M10 17v-2M12.5 17v-2M5 7.5H3M5 10H3M5 12.5H3M17 7.5h-2M17 10h-2M17 12.5h-2"
  />
</svg>
