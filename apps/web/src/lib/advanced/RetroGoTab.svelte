<script lang="ts">
  import { device } from "../device.svelte.js";
  import Button from "../ui/Button.svelte";
  import RomSection from "./RomSection.svelte";
  import { locale } from "../i18n/locale.svelte.js";

  // Rail item: "Install / Reinstall Retro-Go". Previously this file was the whole Firmware tab
  // (a group/accordion stack); Phase 4 moved the section list into FirmwareRail.svelte and left
  // this as the install pane only. Logic below is unchanged from the old "install" section.
  let { onRunning }: { onRunning: (running: boolean) => void } = $props();

</script>

<div class="install">
  {#if device.scanning}
    <!-- The bank inference (RomSection's `inferredBank`) and the "Install"/"Reinstall"
         title above both read device.banks, which is empty pre-scan and settles
         asynchronously — rendering the real content here mid-scan means showing a
         bank-1 default that then jumps to whatever the scan actually finds. Mask it
         behind a scanning placeholder instead. -->
    <div class="placeholder">{locale.t.retroGoTab.scanningDevice}</div>
  {:else if device.utilLoaded}
    <RomSection installMode={device.targetMedia} {onRunning} />
  {:else}
    <div><Button variant="action" onclick={() => device.ensureStub()}>{locale.t.retroGoTab.enterRecoveryMode}</Button></div>
  {/if}
</div>

<style>
  .install {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .placeholder {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    opacity: 0.7;
  }
</style>
