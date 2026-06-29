<script lang="ts">
  import { device } from "../device.svelte.js";
  import { theme } from "../theme.svelte.js";
  import Button from "./Button.svelte";
  import SplitButton from "./SplitButton.svelte";

  const connect = (force = false) =>
    device.connect(undefined, force ? { forcePicker: true } : undefined).catch(() => {});

  const scanned = $derived(device.banks.length > 0);
  const isRetroGo = $derived(
    device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old",
  );

  const statusColor = $derived(
    !device.isConnected ? "red" : device.utilLoaded ? "green" : "yellow",
  );
  const statusText = $derived(
    device.connection === "lost"
      ? "Connection lost"
      : !device.isConnected
        ? "No connection"
        : device.utilLoaded
        ? "Connected (Flash Utility)"
        : isRetroGo
          ? "Connected (Retro-Go)"
          : device.deviceClass
            ? `Connected (${device.deviceClass.label})`
            : "Connected",
  );

  const frogfsPresent = $derived(device.partitions.some((p) => p.fs === "frogfs"));

  const retroGoStatus = $derived(
    device.scanning
      ? "Scanning…"
      : !scanned
        ? "—"
        : isRetroGo
          ? device.deviceClass!.label.replace(/^Retro-Go\s*/, "") // version only (e.g. "SD v1.3.1")
          : frogfsPresent
            ? "Patch missing"
            : "Not installed",
  );
  const ofw = $derived(device.deviceClass?.ofw ?? null);
  const ofwText = $derived(
    device.scanning
      ? "Scanning…"
      : !scanned
        ? "—"
        : ofw
          ? `${ofw.model === "mario" ? "Mario" : "Zelda"} (${ofw.patched ? "Patched" : "Stock"})`
          : "None",
  );

  const scanClickable = $derived(device.isConnected && !device.scanning);
  const scanActionable = $derived(scanClickable && !device.utilLoaded);
</script>

<header class="band">
  <div class="header-left">
    {#if !device.isConnected && !device.everConnected}
      <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>
    {/if}
    <strong class="brand">GNW Web Builder</strong>
  </div>

  {#if device.isConnected || device.everConnected}
    <div class="overview-line">
      <button
        class="scan"
        class:grayed-out={device.utilLoaded}
        disabled={!device.isConnected || device.scanning}
        onclick={() => device.ensureStub().then(() => device.runScan()).catch(() => {})}
      >
        {device.scanning ? "Syncing…" : "Sync"}
      </button>

      <span class="dot {statusColor}" aria-hidden="true"></span>
      <strong class="status">{statusText}</strong>
      
      <span class="divider"></span>

      <span class="key">Retro-Go:</span>
      <span class="val">{retroGoStatus}</span>
      
      <span class="divider"></span>

      <span class="key">Official Firmware:</span>
      <span class="val ofw" class:dim={!ofw}>{ofwText}</span>
    </div>
  {/if}

  <div class="header-right">
    <button class="icon" onclick={() => theme.toggle()} title="Toggle light / dark" aria-label="Toggle theme">
      {theme.mode === "dark" ? "☀" : "☾"}
    </button>
    
    {#if device.isConnected}
      <Button variant="quiet" onclick={() => device.disconnect()}>Disconnect</Button>
    {:else}
      <SplitButton
        variant="default"
        label={device.connection === "connecting" ? "Connecting…" : "Connect"}
        disabled={device.connection === "connecting"}
        onclick={() => connect()}
        items={[{ label: "Choose adapter…", onclick: () => connect(true) }]}
      />
    {/if}
  </div>
</header>

<style>
  .band {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    color: #161616;
    padding: 0.45rem 1.25rem;
    flex-wrap: nowrap;
  }
  .header-left, .header-right {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex: 1;
  }
  .header-right {
    justify-content: flex-end;
  }
  .brand {
    font-size: var(--fs-caption);
    font-weight: 700;
    letter-spacing: 0.02em;
    background: var(--silver);
    color: #161616;
    border: 1px solid #161616;
    border-radius: 3px;
    padding: 0.15rem 0.5rem;
  }

  
  /* Overview Line */
  .overview-line {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-shrink: 0;
  }
  .divider {
    width: 1px;
    height: 14px;
    background: rgba(0,0,0,0.15);
    margin: 0 0.2rem;
  }
  .key {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.55);
  }
  .val, .status {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: #161616;
  }
  .chip {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.8);
    background: rgba(0, 0, 0, 0.06);
    border-radius: var(--r-control);
    padding: 0.1rem 0.5rem;
  }
  .dim {
    opacity: 0.4;
  }

  /* Scan Button */
  .scan {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: #161616;
    background: var(--silver);
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: var(--r-control);
    padding: 0.15rem 0.6rem;
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  .scan:hover:not(:disabled) {
    filter: brightness(1.04);
  }
  .scan:active:not(:disabled) {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) inset;
  }
  .scan:disabled {
    color: rgba(26, 23, 20, 0.45);
    background: rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.15);
    box-shadow: none;
    cursor: not-allowed;
  }
  .scan.grayed-out:not(:disabled) {
    color: rgba(26, 23, 20, 0.6);
    background: rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.15);
    box-shadow: none;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    display: inline-block;
    flex: none;
  }
  .dot.red {
    background: #c0392b;
  }
  .dot.yellow {
    background: #d4a000;
  }
  .dot.green {
    background: #2e9e44;
  }

  /* Right Side Controls */
  .icon {
    font: inherit;
    background: var(--silver);
    border: 1.5px solid var(--model-accent);
    box-shadow: inset 0 -2px 0 var(--silver-edge);
    border-radius: 5px;
    color: #161616;
    cursor: pointer;
    width: 1.9rem;
    height: 1.9rem;
    line-height: 1;
    transition: border-color 200ms ease;
  }
  .icon:hover {
    filter: brightness(0.97);
  }
  .band :global(.btn.quiet) {
    color: #161616;
    text-decoration-color: #161616;
  }
</style>
