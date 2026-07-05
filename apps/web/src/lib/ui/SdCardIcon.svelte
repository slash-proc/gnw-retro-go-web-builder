<script lang="ts">
  // The "SD Card" glyph — a simple notched-corner card silhouette with 3 contact pins.
  // Shared between Landing.svelte (the media-type choice) and DeviceHeader.svelte (the
  // home/change-method button) so the two stay pixel-identical instead of two hand-maintained
  // copies. Pairs visually with FlashChipIcon.svelte (same viewBox/size/fill convention).
  let { size = 48 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
  <path d="M19 3H9l-5 5v13h15V3zm-9 2h2v4h-2V5zm3 0h2v4h-2V5zm3 0h2v4h-2V5z" />
</svg>
