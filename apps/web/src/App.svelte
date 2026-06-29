<script lang="ts">
  import { device } from "./lib/device.svelte.js";
  import DeviceHeader from "./lib/ui/DeviceHeader.svelte";
    import Connect from "./lib/views/Connect.svelte";
  import Advanced from "./lib/views/Advanced.svelte";
  import StubLoadModal from "./lib/ui/StubLoadModal.svelte";

  type Mode = "wizard" | "advanced";
  let mode = $state<Mode>("advanced");
  let wasConnected = $state(false);
  // Let users into the interface without a device (e.g. to prep ROM folders, or when WebUSB is
  // unavailable on this origin/browser). A real connection still takes over when it happens.
  let browseAnyway = $state(false);
  // Set when the user connects FROM the Connect homepage → Advanced lands on Device Information
  // (the Connect view is only shown on the homepage, so this can't fire on a later reconnect).
  // One-shot: Advanced clears it once applied.
  let entryTab = $state<"info" | "roms" | undefined>(undefined);

  // Auto-route on connect: a stock device → guided setup; otherwise → advanced.
  // Advanced is never auto-selected as a *choice* of surface beyond this default
  // fallback (UX_ADVANCED §1.2: Guided Setup is the landing surface for stock).
  $effect(() => {
    if (device.isConnected && !wasConnected) {
      mode = device.firmware === "stock-ofw" ? "wizard" : "advanced";
      wasConnected = true;
    } else if (!device.isConnected && wasConnected) {
      wasConnected = false;
    }
  });
</script>

<div class="app" data-model={device.accent ?? undefined}>
  <StubLoadModal />
  <header class="app-header">
    <DeviceHeader />

  </header>
  <main class="body">
    {#if !device.isConnected && !device.everConnected && !browseAnyway}
      <Connect onSkip={() => { browseAnyway = true; entryTab = "roms"; mode = "advanced"; }} onConnected={() => (entryTab = "info")} />
    {:else}
      <Advanced initialTab={entryTab} onInitialApplied={() => (entryTab = undefined)} bind:mode />
    {/if}
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
  }
  .app-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    background: var(--grad-gold);
    border-bottom: 3px solid var(--model-accent);
    transition: border-color 200ms ease;
  }
  .body {
    max-width: var(--maxw);
    margin: 1.5rem auto;
    padding: 0 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
</style>
