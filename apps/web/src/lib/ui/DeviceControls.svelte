<script lang="ts">
  // The status LED (icon-console.svg, colored by connection state) doubles as the device
  // actions menu trigger — previously two separate controls (this dropdown lived on its own
  // generic hamburger-style button in the header's top-right, entirely apart from the colored
  // "scan" icon in the overview line). A permanent fixture of the app now — it renders
  // regardless of connection state (DeviceHeader still hides it on the landing page via
  // `showConnectButton`), unlike the Retro-Go/OFW version rows next to it which stay
  // connection-gated.
  import { device } from "../device.svelte.js";
  import iconConsole from "../../assets/icon-console.svg";
  import { locale } from "../i18n/locale.svelte.js";

  let { statusColor = "red" }: { statusColor?: string } = $props();

  let open = $state(false);

  function toggle() {
    open = !open;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".device-controls")) {
      open = false;
    }
  }

  import { onMount } from "svelte";
  onMount(() => {
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  });

  function rescan() {
    open = false;
    device.ensureStub().then(() => device.runScan()).catch(() => {});
  }
  function toggleRecoveryMode() {
    open = false;
    void device.ensureStub(undefined, true);
  }
  function changeAdapter() {
    open = false;
    void device.connect(undefined, { forcePicker: true });
  }
  function disconnectDevice() {
    open = false;
    device.disconnect();
  }
  function connect() {
    open = false;
    void device.connect();
  }
</script>

<div class="device-controls">
  <button
    class="gw-icon-btn status-{statusColor}"
    class:syncing={device.scanning}
    onclick={toggle}
    title={locale.t.shared.deviceControls.deviceActions}
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <img class="gw-icon" src={iconConsole} alt="" />
    <svg class="caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
      <path d="M0 0 L5 6 L10 0 Z" fill="currentColor" />
    </svg>
  </button>

  {#if open}
    <div class="dropdown-menu" role="menu">
      {#if device.isConnected}
        {#if device.utilLoaded}
          <button class="menu-item" role="menuitem" onclick={rescan}>{locale.t.shared.deviceControls.rescan}</button>
          <button class="menu-item" role="menuitem" onclick={toggleRecoveryMode}>{locale.t.shared.deviceControls.restartRecoveryMode}</button>
        {:else}
          <button class="menu-item" role="menuitem" onclick={toggleRecoveryMode}>{locale.t.shared.deviceControls.startRecoveryMode}</button>
        {/if}
        <div class="divider"></div>
        <button class="menu-item" role="menuitem" onclick={changeAdapter}>{locale.t.shared.deviceControls.changeAdapter}</button>
        <button class="menu-item danger" role="menuitem" onclick={disconnectDevice}>{locale.t.shared.deviceControls.disconnectDevice}</button>
      {:else}
        <button class="menu-item" role="menuitem" onclick={connect}>{locale.t.shared.common.connect}</button>
        <button class="menu-item" role="menuitem" onclick={changeAdapter}>{locale.t.shared.deviceControls.changeAdapter}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .device-controls {
    position: relative;
    display: inline-block;
  }

  /* Same visual language as the old standalone "scan" button (icon-console.svg's own canvas
     ratio sizes the button, status-{red,yellow,green} colors its background) — this button now
     also opens the actions menu, so a caret is layered into its corner to signal that. */
  .gw-icon-btn {
    box-sizing: border-box;
    position: relative;
    height: var(--header-control-h, 1.7rem);
    aspect-ratio: 8702 / 5131;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: var(--silver);
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: var(--r-control);
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 1px 2px rgba(0, 0, 0, 0.25);
    overflow: visible;
  }
  .gw-icon {
    height: 100%;
    width: 100%;
    object-fit: contain;
    display: block;
  }
  .gw-icon-btn.status-red { background: var(--status-red); }
  .gw-icon-btn.status-yellow { background: var(--status-yellow); }
  .gw-icon-btn.status-green { background: var(--status-green); }

  .gw-icon-btn:hover {
    filter: brightness(1.04);
  }
  .gw-icon-btn:active {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) inset;
  }
  .gw-icon-btn.syncing {
    animation: gw-icon-pulse-bg 1.1s ease-in-out infinite;
  }
  @keyframes gw-icon-pulse-bg {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(0.6); }
  }

  /* Subtle but unambiguous "this opens something" affordance — bottom-right corner, its own
     small chip so it reads distinctly from the console icon's line art rather than blending
     into it. */
  .caret {
    position: absolute;
    right: -4px;
    bottom: -4px;
    color: var(--ink, #161616);
    background: var(--silver);
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 999px;
    padding: 2px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 0.5rem;
    min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    padding: 0.4rem 0;
    display: flex;
    flex-direction: column;
  }
  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0.55rem 1rem;
    background: none;
    border: none;
    text-align: left;
    color: var(--ink);
    font-size: var(--fs-caption);
    cursor: pointer;
  }
  .menu-item:hover {
    background: var(--surface-sunk);
  }
  .menu-item.danger {
    color: var(--danger, #e74c3c);
  }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.25rem 0;
  }
</style>
