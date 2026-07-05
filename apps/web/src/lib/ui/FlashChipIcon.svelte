<script lang="ts">
  // The "Flash Memory" glyph — an SOIC-8/SOP-8 package (the real form factor of the on-device
  // SPI flash chip): a body with 4 gull-wing leads per long edge (8 total), a die-window
  // cutout, and a pin-1 dot near the top-left corner. Same flat single-tone silhouette +
  // var(--surface) cutout technique as Landing.svelte's SD card icon. Shared between
  // Landing.svelte (the media-type choice) and DeviceHeader.svelte (the home/change-method
  // button) so the two stay pixel-identical instead of two hand-maintained copies.
  let { size = 48 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
  <!-- Body height matches the SD card icon's ~18-unit (y=3..21) vertical extent, so the two
       read as the same size at a glance despite sharing one square viewBox — a flatter, more
       "realistic" SOIC-8 silhouette looked visibly smaller next to the card at equal render
       size, even though the bounding boxes were identical. -->
  <rect x="6" y="4" width="12" height="16" />
  <rect x="3" y="5" width="3" height="2" />
  <rect x="3" y="9" width="3" height="2" />
  <rect x="3" y="13" width="3" height="2" />
  <rect x="3" y="17" width="3" height="2" />
  <rect x="18" y="5" width="3" height="2" />
  <rect x="18" y="9" width="3" height="2" />
  <rect x="18" y="13" width="3" height="2" />
  <rect x="18" y="17" width="3" height="2" />
  <rect x="8" y="8" width="8" height="8" fill="var(--surface)" />
  <circle cx="7" cy="5.2" r="0.55" fill="var(--surface)" />
</svg>
