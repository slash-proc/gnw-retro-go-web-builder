<script lang="ts">
  import type { Snippet } from "svelte";
  import { paneFooterSlot } from "./paneFooter.svelte.js";

  // Declares the Advanced pane's anchored primary-action bar (audit 5.1). Renders nothing
  // here — see paneFooter.svelte.ts for why the bar itself is drawn by FirmwareRail.
  //
  // `summary` is optional on purpose: a screen whose artboard shows no left-hand text renders
  // none rather than inventing a sentence to fill the space.
  let {
    summary = undefined,
    children,
  }: {
    summary?: string | undefined;
    children?: Snippet;
  } = $props();

  const slot = paneFooterSlot();

  $effect(() => {
    if (!slot) return;
    const mine = children ?? null;
    slot.summary = summary ?? null;
    slot.content = mine;
    return () => {
      // Only clear if another section has not already claimed the slot (the outgoing
      // section's teardown runs around the incoming one's mount).
      if (slot.content === mine) {
        slot.summary = null;
        slot.content = null;
      }
    };
  });
</script>
