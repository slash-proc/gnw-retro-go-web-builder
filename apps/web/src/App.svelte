<script lang="ts">
  import { device } from "./lib/device.svelte.js";
  import DeviceHeader from "./lib/ui/DeviceHeader.svelte";
  import DeviceOverview from "./lib/ui/DeviceOverview.svelte";
  import Connect from "./lib/views/Connect.svelte";
  import Wizard from "./lib/views/Wizard.svelte";
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
  <DeviceHeader />
  <main class="body">
    {#if !device.isConnected && !device.everConnected && !browseAnyway}
      <Connect onSkip={() => { browseAnyway = true; entryTab = "roms"; mode = "advanced"; }} onConnected={() => (entryTab = "info")} />
    {:else}
      <DeviceOverview />
      <nav class="modeswitch">
        <button class:active={mode === "wizard"} onclick={() => (mode = "wizard")}>Guided Setup</button>
        <button class:active={mode === "advanced"} onclick={() => (mode = "advanced")}>Advanced</button>
      </nav>
      {#if mode === "wizard"}
        <Wizard />
      {:else}
        <Advanced initialTab={entryTab} onInitialApplied={() => (entryTab = undefined)} />
      {/if}
    {/if}
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
  }
  .body {
    max-width: var(--maxw);
    margin: 1.5rem auto;
    padding: 0 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .modeswitch {
    display: flex;
    gap: 0.25rem;
    align-self: center;
    background: var(--surface-sunk);
    border-radius: 999px;
    padding: 0.2rem;
  }
  .modeswitch button {
    font: inherit;
    font-size: var(--fs-caption);
    border: none;
    background: transparent;
    color: var(--ink-soft);
    padding: 0.35rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }
  .modeswitch button.active {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    box-shadow: var(--shadow-card);
  }
</style>
