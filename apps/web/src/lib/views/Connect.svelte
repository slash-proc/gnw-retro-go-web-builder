<script lang="ts">
  import { device } from "../device.svelte.js";
  import { readDeviceLog } from "../engine/devicelog.js";
  import Card from "../ui/Card.svelte";
  import SplitButton from "../ui/SplitButton.svelte";

  let { onSkip, onConnected }: { onSkip: () => void; onConnected?: () => void } = $props();

  const webusb = typeof navigator !== "undefined" && !!navigator.usb;
  // navigator.usb is undefined in a NON-secure context (e.g. http://<lan-ip>:3000) even on a
  // perfectly capable Chromium — so distinguish "insecure origin" from "browser can't do WebUSB"
  // and never wall off the whole interface, just warn.
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const origin = typeof location !== "undefined" ? location.origin : "";
  let busy = $state(false);
  let log = $state<string[]>([]);
  let deviceLog = $state<string | null>(null);
  let logErr = $state<string | null>(null);
  let diag = $state<string | null>(null);

  // Diagnostic: bypass our adapter filters and show whatever device the browser picker returns,
  // plus any already-permitted devices. Reveals whether the probe shows up at all and its USB IDs
  // (so we can tell if our requestDevice filters are excluding it).
  const hex4 = (n: number) => "0x" + n.toString(16).padStart(4, "0");
  async function probeUsb() {
    diag = null;
    if (!navigator.usb) {
      diag = `navigator.usb is undefined — secureContext=${secure}, origin=${origin}. WebUSB needs https:// or a *.localhost origin.`;
      return;
    }
    try {
      const known = await navigator.usb.getDevices();
      const dev = await navigator.usb.requestDevice({ filters: [] }); // no filter = show everything
      const desc = (d: USBDevice) =>
        `${hex4(d.vendorId)}:${hex4(d.productId)}  ${d.manufacturerName ?? "?"} / ${d.productName ?? "?"}`;
      diag =
        `picked: ${desc(dev)}\n` +
        `already-permitted (${known.length}): ${known.map(desc).join(" | ") || "none"}`;
    } catch (e) {
      diag = `requestDevice failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
    }
  }

  async function connect(force = false) {
    busy = true;
    log = [];
    try {
      await device.connect((m) => (log = [...log, m]), force ? { forcePicker: true } : undefined);
      if (device.isConnected) onConnected?.(); // landed here from the homepage → Advanced opens on info
    } catch {
      /* error surfaced via device.error */
    } finally {
      busy = false;
    }
  }

  // Debug: read retro-go's printf log over SWD (no stub boot). Use while the device
  // is powered + running retro-go (e.g. on the corrupt-filesystem screen).
  async function readLog() {
    busy = true;
    deviceLog = null;
    logErr = null;
    try {
      const r = await readDeviceLog();
      deviceLog = r.text || "(log buffer empty)";
    } catch (e) {
      logErr = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="landing">
<Card>
  <div class="stack">
    <h1>Connect your Game &amp; Watch</h1>
    {#if !webusb}
      <p class="warn">
        {#if !secure}
          <strong>WebUSB needs a secure origin.</strong> You opened the app at
          <span class="mono">{origin}</span>, which isn&rsquo;t a secure context, so the browser
          hides USB access. Open it via <span class="mono">https://</span> or
          <span class="mono">http://localhost</span> to connect a device. You can still use the
          rest of the interface below.
        {:else}
          <strong>WebUSB isn&rsquo;t available in this browser.</strong> Device connection needs a
          Chromium-based desktop browser (Chrome, Edge, Opera, Brave…). The rest of the interface
          still works.
        {/if}
      </p>
    {:else}
      <p class="muted">
        Plug in your Game &amp; Watch and a debug probe (ST-Link or a Raspberry Pi
        debugprobe), then connect. We&rsquo;ll read the device and guide you from there.
      </p>
    {/if}
    <div>
      <SplitButton
        label={busy ? "Connecting…" : "Connect"}
        disabled={busy}
        onclick={() => connect()}
        items={[
          { label: "Choose adapter…", onclick: () => connect(true) },
          { label: "Read device log (debug)", onclick: readLog },
        ]}
      />
    </div>
    {#if device.error}<p class="err">{device.error}</p>{/if}
    {#if logErr}<p class="err">{logErr}</p>{/if}
    {#if log.length}<pre class="log">{log.join("\n")}</pre>{/if}
    {#if deviceLog}<pre class="log">{deviceLog}</pre>{/if}

    <details class="diag">
      <summary>Connection diagnostics</summary>
      <pre class="log">origin: {origin}
secureContext: {secure}
navigator.usb: {webusb ? "present" : "MISSING"}</pre>
      <button class="skip" onclick={probeUsb}>Probe USB (show all devices, no filter)</button>
      {#if diag}<pre class="log">{diag}</pre>{/if}
    </details>

    <button class="skip" onclick={onSkip}>Manage ROMs</button>
  </div>
</Card>
</div>

<style>
  /* The landing prompt is a single card — keep it compact + centered like the status bar,
     not sprawled across the wide frame. */
  .landing {
    align-self: center;
    width: 100%;
    max-width: 640px;
  }
  h1 {
    font-size: var(--fs-display);
  }
  .skip {
    align-self: flex-start;
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 0.2rem 0;
    cursor: pointer;
    text-decoration: underline;
  }
  .skip:hover {
    color: var(--ink);
  }
  .warn {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink);
    background: var(--surface-sunk);
    border-left: 3px solid var(--caution);
    border-radius: var(--r-control);
    padding: 0.55rem 0.7rem;
  }
</style>
