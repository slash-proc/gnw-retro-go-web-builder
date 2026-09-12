<script lang="ts">
  // The "SD Card" glyph — the stroked outline card drawn by Landing1.dc.html's second media
  // card (26px, stroke-width 1.2): a notched-corner body with three contact strokes. Pairs
  // with FlashChipIcon.svelte (same viewBox / size / stroke convention) and is shared between
  // Landing.svelte and DeviceHeader.svelte so the two stay pixel-identical.
  //
  // No artboard draws the header in SD mode, so the header reuses this glyph at the flash
  // chip's header metrics (19px / 1.3).
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
  stroke-linejoin="round"
>
  <path d="M5 2.5h6.5L15 6v11.5H5z" />
  <path d="M8.4 3.6v2.6M10.3 3.6v2.6M12.2 4.4v1.8" />
</svg>
