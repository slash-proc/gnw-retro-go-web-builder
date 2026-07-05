<script lang="ts">
  import { device } from "./lib/device.svelte.js";
  import "./lib/i18n/registerLocales.js";
  import DeviceHeader from "./lib/ui/DeviceHeader.svelte";
  import Landing from "./lib/views/Landing.svelte";
  import Advanced from "./lib/views/Advanced.svelte";
  import StubLoadModal from "./lib/ui/StubLoadModal.svelte";
  import FolderGateModal from "./lib/ui/FolderGateModal.svelte";
  import ConnectGateModal from "./lib/ui/ConnectGateModal.svelte";
  import InstallProgressModal from "./lib/ui/InstallProgressModal.svelte";

  type Mode = "wizard" | "advanced";
  let mode = $state<Mode>("advanced");
  // Whether to show the initial Landing screen
  let showLanding = $state(true);
  // Set when the user connects FROM the landing homepage
  let entryTab = $state<"info" | "device" | "roms" | undefined>(undefined);

  // true only for "Manage Device" navigations (not "Advanced") — enables firmware-based auto-route.
  let autoRouteEnabled = $state(false);
  // True if the device was already connected when the user clicked "Manage Device".
  // In that case skip auto-route: Overview tab shows current state and no redirect is needed.
  // Only route when a *fresh* connection + scan happens during this session.
  let deviceAlreadyConnected = $state(false);
  // Cleared on disconnect so each new connection re-evaluates.
  let autoRouted = $state(false);

  // Watches firmware after the scan completes — NOT at connection time.
  // `device.firmware` is now a pure derived getter off `deviceClass`, which is only ever
  // populated by _doScan()'s bank scan — so there's no more "premature stock-ofw" race to
  // guard against from a connect-time info read. Still guard on banks.length > 0 (banks are
  // only populated by _doScan()) so we route on real scan data, not the pre-scan default.
  $effect(() => {
    if (!device.isConnected) {
      autoRouted = false;
      return;
    }
    if (showLanding || autoRouted || !autoRouteEnabled || deviceAlreadyConnected) return;
    const fw = device.firmware;
    if (fw === "unknown" || device.scanning || device.banks.length === 0) return;
    autoRouted = true;
    if (fw !== "retro-go") {
      mode = "wizard";
      location.hash = "#firmware";
    }
    // retro-go fully installed → stay on Overview tab
  });

  function handleNavigate(target: 'device' | 'device-advanced' | 'games', media: 'flash' | 'sd') {
    // Landing is a deliberate top-level re-entry point — re-arm auto-reconnect even if the
    // device was explicitly disconnected earlier this session (see allowAutoReconnect's doc
    // comment). Applies to both targets: 'device' connectSilent()s directly below, 'games'
    // (Flash mode) does it via RomManagementTab's own autoProbeRoms() on mount.
    device.allowAutoReconnect();
    device.targetMedia = media;
    mode = 'advanced';
    autoRouted = false;
    if (target === 'games') {
      entryTab = 'roms';
      autoRouteEnabled = false;
    } else {
      // 'device' → Overview tab; auto-route to Guided Setup after scan if firmware needs setup.
      // 'device-advanced' → Firmware Setup tab directly; no auto-route (user asked explicitly).
      entryTab = target === 'device-advanced' ? 'device' : 'info';
      autoRouteEnabled = target === 'device';
      // Snapshot connection state NOW: if already connected, the firmware value is stale/known
      // and we should not auto-route on this navigation.
      deviceAlreadyConnected = device.isConnected;
      void device.connectSilent();
    }
    showLanding = false;
  }
</script>

<div class="app" data-model={device.accent ?? undefined}>
  <StubLoadModal />
  <FolderGateModal />
  <ConnectGateModal />
  <InstallProgressModal />
  <header class="app-header">
    <DeviceHeader showConnectButton={!showLanding} onNavigateHome={() => showLanding = true} />

  </header>
  <main class="body">
    {#if showLanding}
      <Landing onNavigate={handleNavigate} />
    {:else}
      <Advanced initialTab={entryTab} onInitialApplied={() => (entryTab = undefined)} bind:mode />
    {/if}
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
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
    flex: 1;
    width: 100%;
    max-width: var(--maxw);
    margin: 1.5rem auto;
    padding: 0 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
</style>
