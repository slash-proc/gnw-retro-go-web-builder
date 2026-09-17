<script lang="ts">
  // The status LED (icon-console.svg, colored by connection state) doubles as the device
  // actions menu trigger — previously two separate controls (this dropdown lived on its own
  // generic hamburger-style button in the header's top-right, entirely apart from the colored
  // "scan" icon in the overview line). A permanent fixture of the app now — it renders
  // regardless of connection state (DeviceHeader still hides it on the landing page via
  // `showConnectButton`), unlike the Retro-Go/OFW version rows next to it which stay
  // connection-gated.
  import { device, StubLoadCancelled } from "../device.svelte.js";
  import { deviceSafety } from "../installProgress.svelte.js";
  import iconConsole from "../../assets/icon-console.svg";
  import { locale } from "../i18n/locale.svelte.js";
  import { auditLog } from "../auditLog.svelte.js";
  import { msg } from "../logEntry.js";
  import ModalShell from "./ModalShell.svelte";
  import { getKnownProbes } from "../engine/transport.js";

  let { statusColor = "red" }: { statusColor?: string } = $props();

  let open = $state(false);
  let configureOpen = $state(false);
  let configuring = $state(false);
  let configureError = $state<string | null>(null);
  let customFrequency = $state(4_000_000);
  let customFrequencyMode = $state(false);
  let selectedAdapterName = $state<string | null>(null);
  let availableAdapterNames = $state<string[]>([]);

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
    device.rescan("device menu").catch(() => {});
  }
  function toggleRecoveryMode() {
    open = false;
    // NOT a bare `void` (that is what surfaced the stub-boot race as an "Uncaught (in promise)"
    // in the console and nowhere else), and NOT a bare swallow either: a failed Recovery Mode
    // boot must reach the user. The single exception is the user's own Cancel on StubLoadModal,
    // which is not an error state.
    //
    // CAVEAT, verified 2026-09-07: `device.error` has NO renderer anywhere — the store writes it
    // in five places and no `.svelte` file reads it. So this makes the failure catchable and
    // stateful rather than an uncaught console rejection, but the user still sees only the
    // status LED (which for THIS site stays green — the link is fine, only the boot failed).
    //
    // Re-checked 2026-09-08 against every artboard in docs/design/mockups. The HEADER still
    // draws no error state anywhere: the status line only ever carries the four approved
    // strings (Connected (Recovery Mode) / ... Do not disconnect / connection lost / no
    // connection), and FlashFailure.dc.html — the one board that shows a failure — deliberately
    // draws the chrome IDLE: white band, GREEN chip, static 3px gold lip, "Connected (Recovery
    // Mode)". The chip is not an error light. What FlashFailure adds is a MODAL error surface
    // (the BAD_HASH_FLASH spec: named failing blocks, Save log / Close / Retry install), which
    // is specific to a flash-install result, not a general `device.error` renderer. So a
    // renderer for THIS failure (a Recovery Mode boot) is still BLOCKED on the owner drawing
    // the slot. Do not infer one from that modal; see the report on branch agent/wt-err.
    // `startRecoveryMode`, not a bare `ensureStub`: entering recovery resets the target, so the
    // scan taken while Retro-Go was running no longer describes this device. See the store.
    device.startRecoveryMode().catch((e) => {
      if (e instanceof StubLoadCancelled) return;
      device.error = e instanceof Error ? e.message : String(e);
      // AND INTO THE LOG, which is the half `device.error` cannot do. The caveat above is still
      // true -- nothing renders that field -- so until the owner draws the slot this line is
      // the ONLY trace a failed boot leaves. Without it "the boot failed" and "the click never
      // landed" read identically, which is exactly how a real race got reported as a hardware
      // flake. A Cancel returns above, so nothing here fires for the user's own dismissal.
      auditLog.add("error", "device", msg((t) => t.shared.auditLog.recoveryFailed, device.error));
    });
  }
  async function changeAdapter() {
    open = false;
    configureError = null;
    selectedAdapterName = device.probeName;
    const known = await getKnownProbes();
    availableAdapterNames = known.map((d) => d.productName || "CMSIS-DAP");
    if (!selectedAdapterName && known.length === 1) selectedAdapterName = availableAdapterNames[0];
    customFrequency = device.adapterFrequencyHz;
    customFrequencyMode = ![1_000_000, 2_000_000, 4_000_000].includes(device.adapterFrequencyHz);
    configureOpen = true;
  }
  function chooseFrequency(value: number): void {
    customFrequencyMode = value === 0;
    if (value !== 0) {
      customFrequency = value;
      device.setAdapterFrequency(value);
    }
  }
  function applyCustomFrequency(): void {
    const hz = Math.round(customFrequency);
    if (hz >= 1_000_000 && hz <= 10_000_000) device.setAdapterFrequency(hz);
  }
  async function chooseAdapterOnly() {
    device.startAdapterPoll();
    configuring = true;
    configureError = null;
    try {
      await device.chooseAdapter();
      selectedAdapterName = device.probeName;
    } catch (e) {
      configureError = e instanceof Error ? e.message : String(e);
    } finally {
      configuring = false;
    }
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
    class:unsafe={deviceSafety.unsafe}
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

{#if configureOpen}
  <ModalShell onDismiss={() => !configuring && (configureOpen = false)} maxWidth="26rem">
    {#snippet children()}
      <div class="adapter-config">
        <h3>Configure Adapter</h3>
        <div class="adapter-row">
          <span class="adapter-name">{selectedAdapterName ?? "No adapter selected"}</span>
          <button class="choose-adapter" disabled={configuring} onclick={chooseAdapterOnly}>Choose</button>
        </div>
        {#if availableAdapterNames.length > 1}
          <span class="available-adapters">Available adapters: {availableAdapterNames.join(", ")}</span>
        {/if}
        <label for="adapter-frequency">Adapter speed</label>
        <select id="adapter-frequency" value={customFrequencyMode ? "custom" : String(device.adapterFrequencyHz)} onchange={(e) => chooseFrequency(e.currentTarget.value === "custom" ? 0 : Number(e.currentTarget.value))} disabled={configuring}>
          <option value="1000000">1 MHz</option>
          <option value="2000000">2 MHz</option>
          <option value="4000000">4 MHz</option>
          <option value="custom">Custom</option>
        </select>
        {#if customFrequencyMode}
          <div class="custom-frequency">
            <input aria-label="Custom adapter speed" type="number" min="1" max="10" step="0.1" value={customFrequency / 1_000_000} onchange={(e) => { customFrequency = Number(e.currentTarget.value) * 1_000_000; applyCustomFrequency(); }} disabled={configuring} />
            <span>MHz (1–10 MHz)</span>
          </div>
        {/if}
        {#if configureError}<p class="config-error">{configureError}</p>{/if}
        <div class="config-actions">
          <button class="config-cancel" disabled={configuring} onclick={() => (configureOpen = false)}>{locale.t.shared.common.cancel}</button>
          <button class="config-connect" disabled={configuring} onclick={() => { if (customFrequencyMode) applyCustomFrequency(); device.setAdapterFrequency(device.adapterFrequencyHz); configureOpen = false; }}>OK</button>
        </div>
      </div>
    {/snippet}
  </ModalShell>
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
  /* Busy: HeaderBusy.dc.html's amber chip (#b8860b == --caution, the same amber as the hazard
     lip). Set by DeviceHeader's statusColor off deviceSafety — not decided here. */
  .gw-icon-btn.status-amber { background: var(--caution); }

  .gw-icon-btn:hover {
    filter: brightness(1.04);
  }
  .gw-icon-btn:active {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) inset;
  }
  .adapter-config {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .adapter-config h3 { margin: 0; font-size: var(--fs-title); }
  .config-note { margin: 0 0 8px; color: var(--ink-soft); font-size: var(--fs-caption); }
  .adapter-config label { font-size: var(--fs-caption); font-weight: 600; }
  .adapter-config select { font: inherit; padding: 8px; }
  .adapter-row { display: flex; align-items: center; gap: 10px; }
  .adapter-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choose-adapter { font: inherit; padding: 6px 10px; border-radius: var(--r-control); cursor: pointer; color: var(--ink); background: var(--silver); border: 1px solid var(--hairline); }
  .custom-frequency { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: var(--fs-caption); }
  .custom-frequency input { width: 9rem; font: inherit; padding: 7px; }
  .config-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .config-cancel, .config-connect { font: inherit; padding: 8px 14px; border-radius: var(--r-control); cursor: pointer; }
  .config-cancel { color: var(--ink); background: var(--silver); border: 1px solid var(--hairline); }
  .config-connect { color: #fff; background: var(--zelda-green); border: 1px solid var(--zelda-green); }
  .config-error { margin: 4px 0 0; color: var(--danger); font-size: var(--fs-caption); }
  /* No busy ring: HeaderBusy / GuidedFlashing / FlashingCancel / FlashingCancelConfirm all
     draw the writing chip with the SAME `1px solid rgba(0,0,0,0.35)` border and the same inset
     highlight as the idle chip — only the fill (amber) and the throb change. The caution ring
     this rule used to add is drawn by no artboard. `.unsafe` is kept solely to drive the throb
     below. */
  .gw-icon-btn.syncing,
  .gw-icon-btn.unsafe {
    animation: gw-icon-pulse-bg 1.1s ease-in-out infinite;
  }
  @keyframes gw-icon-pulse-bg {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(0.62); }
  }
  /* Same rule as App.svelte's lip: the colour is the state signal and survives, only the
     motion stops. */
  @media (prefers-reduced-motion: reduce) {
    .gw-icon-btn.syncing,
    .gw-icon-btn.unsafe {
      animation: none;
    }
  }

  /* Subtle but unambiguous "this opens something" affordance — bottom-right corner, its own
     small chip so it reads distinctly from the console icon's line art rather than blending
     into it. */
  .caret {
    position: absolute;
    inset-inline-end: -4px;
    bottom: -4px;
    color: var(--ink-on-face);
    background: var(--silver);
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 999px;
    padding: 2px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    inset-inline-start: 0;
    margin-top: 0.5rem;
    min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: var(--z-popover);
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
    text-align: start;
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
    background: var(--rule);
    margin: 0.25rem 0;
  }
</style>
