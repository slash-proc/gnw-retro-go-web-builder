<script lang="ts">
  // Top status: a sleek two-line bar. Line 1 = at-a-glance connection status (LED + text)
  // + storage + Scan; line 2 = what's installed (retro-go) + official firmware. The
  // flash-geometry visualization moved down to ROM/homebrew management. No adapter/probe
  // info up here (that belongs in the Debugging view, which we'll hide/remove later).
  import { device } from "../device.svelte.js";

  // A scan has populated the geometry once banks have been read.
  const scanned = $derived(device.banks.length > 0);

  const isRetroGo = $derived(
    device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old",
  );

  // LED = connection status. red = no connection/adapter; yellow = connected but the flash
  // util (RAM app) isn't running, so no writes; green = connected AND flash util running.
  // (With the current connect flow the util always boots → green; the yellow branch is for #3.)
  const statusColor = $derived(
    !device.isConnected ? "red" : device.utilLoaded ? "green" : "yellow",
  );
  // Quick-glance status text — no "Device Status:" label; the value + LED carry it.
  const statusText = $derived(
    device.connection === "lost"
      ? "Connection lost — reconnect"
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

  const retroGoStatus = $derived(
    device.scanning
      ? "Scanning…"
      : !scanned
        ? "—"
        : isRetroGo
          ? device.deviceClass!.label.replace(/^Retro-Go\s*/, "") // version only (e.g. "SD v1.3.1")
          : "Not installed/Broken",
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

  // Scan is possible whenever connected and not already scanning. (#3: also false once the
  // background poll is active.)
  const scanClickable = $derived(device.isConnected && !device.scanning);
  // The LED is only "hot" (red, a prompt to act) when a scan is actually needed — i.e. we're
  // connected with something OTHER than the util running. Once the util is up (auto-scanned),
  // the button is just a neutral re-scan control.
  const scanActionable = $derived(scanClickable && !device.utilLoaded);
</script>

<section class="overview">
  <div class="row">
    <span class="dot {statusColor}" aria-hidden="true"></span>
    <strong class="status">{statusText}</strong>
    <span class="spacer"></span>
    <span class="chip mono" class:dim={!scanned}>
      Storage: {scanned ? `${device.extSizeMB ?? "?"} MB` : "— MB"}
    </span>
    <button
      class="scan"
      disabled={!scanClickable}
      onclick={() => device.ensureStub().then(() => device.runScan()).catch(() => {})}
    >
      <span class="scanled" class:hot={scanActionable} aria-hidden="true"></span>
      {scanClickable ? "Scan" : device.scanning ? "Scanning…" : "No connection"}
    </button>
  </div>

  <div class="row second">
    <span class="key">Retro-Go:</span>
    <span class="val">{retroGoStatus}</span>
    <span class="spacer"></span>
    <span class="ofw" class:dim={!ofw}>Official Firmware: {ofwText}</span>
  </div>
</section>

<style>
  /* The device "lip": a champagne-gold bar framed in the model color. Black legends in
     both themes (gold reads light either way). Sleek — two compact rows. */
  .overview {
    /* Compact + centered — the two rows are glance-able, so it shouldn't sprawl across the
       full wide frame. */
    align-self: center;
    width: 100%;
    max-width: 640px;
    background: var(--grad-gold);
    color: #161616;
    border: 3px solid var(--model-accent);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    padding: 0.55rem 0.9rem;
    transition: border-color 200ms ease;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .key {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.55);
  }
  .status {
    font-size: var(--fs-body);
    font-weight: 600;
    color: #161616;
  }
  .second .val {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.8);
  }
  .chip {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.8);
    background: rgba(0, 0, 0, 0.06);
    border-radius: var(--r-control);
    padding: 0.1rem 0.5rem;
  }
  .ofw {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.7);
  }
  .dim {
    opacity: 0.4;
  }
  /* Scan: a metallic silver/gray push-button (the G&W function-button cap). Grays to a
     flat inert chip when not clickable. */
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
    padding: 0.2rem 0.8rem;
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  /* The button's status LED: bright red when a scan is available, gray when inert. */
  .scanled {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.28); /* neutral by default — the util's up, no prompt */
    flex: none;
  }
  .scanled.hot {
    background: #e02020;
    box-shadow: 0 0 3px rgba(224, 32, 32, 0.7);
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
  .scan:disabled .scanled {
    background: rgba(0, 0, 0, 0.25);
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
</style>
