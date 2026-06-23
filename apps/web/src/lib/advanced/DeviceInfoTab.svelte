<script lang="ts">
  // Tab — Device Information. A flat, read-only verbose summary: the long-form of the top
  // status bar. Renders existing store state ONLY (no device reads). Grayed before connect.
  // First cut — content to be refined.
  import { device, modelLabel, firmwareLabel } from "../device.svelte.js";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import { extflashSegments, intflashSegments } from "../engine/classify.js";
  import type { GeoSegment } from "../engine/classify.js";

  const EXTBASE = 0x90000000;
  const hex = (n: number) => "0x" + (n >>> 0).toString(16);

  const isRetroGo = $derived(
    device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old",
  );
  const running = $derived(
    device.utilLoaded ? "Flash Utility" : isRetroGo ? "Retro-Go" : "Unknown / not scanned",
  );
  const ofw = $derived(device.deviceClass?.ofw ?? null);
  const ofwText = $derived(
    ofw ? `${ofw.model === "mario" ? "Mario" : "Zelda"} (${ofw.patched ? "Patched" : "Stock"})` : "None",
  );
  const retroGo = $derived(
    isRetroGo
      ? device.deviceClass!.label.replace(/^Retro-Go\s*/, "")
      : device.deviceClass
        ? "Not installed / broken"
        : "Not scanned yet",
  );
  const storage = $derived(device.extSizeMB != null ? `${device.extSizeMB} MB` : "—");
  const lockText = $derived(device.locked == null ? "—" : device.locked ? "Locked" : "Unlocked");

  // Geometry bars (graceful, in-tab). Width is driven by the SMALLEST real partition: tiny
  // blobs (128/256 KB OFW backups in a multi-MB chip) widen the bar toward the 1200px frame so
  // they stay visible; few/large partitions stay near the 640px status-bar default.
  const extBytes = $derived(device.info?.externalFlashSizeBytes ?? 0);
  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, extBytes));
  const extEnd = $derived(EXTBASE + extBytes);
  const MIN_SEG_PX = 8;
  const extWidth = $derived.by(() => {
    const real = extSegs.filter((s) => s.kind !== "free" && s.pct > 0);
    if (!real.length) return 640;
    const smallestFraction = Math.min(...real.map((s) => s.pct)) / 100;
    if (!(smallestFraction > 0)) return 640;
    return Math.min(1200, Math.max(640, Math.round(MIN_SEG_PX / smallestFraction)));
  });

  // Device log — read retro-go's persistent printf buffer over the live connection.
  let log = $state<string | null>(null);
  let logErr = $state<string | null>(null);
  let reading = $state(false);

  async function readLog() {
    reading = true;
    logErr = null;
    try {
      const r = await device.readLog();
      log = r.text || "(log buffer empty)";
    } catch (e) {
      logErr = e instanceof Error ? e.message : String(e);
    } finally {
      reading = false;
    }
  }

  function downloadLog() {
    if (log == null) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([log], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retro-go-output-${stamp}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  let bootModalOpen = $state(false);
  let bootBank = $state<1 | 2>(1);
  let bootTargetName = $state("");
  let bootTargetAddr = $state("");

  function handleDblClickInt(s: GeoSegment) {
    if (s.bank) {
      bootBank = s.bank;
      bootTargetName = s.label || `Bank ${s.bank}`;
      // Extract address (e.g., "0x08000000 · 1024 KiB used" -> "0x08000000")
      bootTargetAddr = s.detail[1]?.split("·")[0]?.trim() || (s.bank === 1 ? "0x08000000" : "0x08100000");
      bootModalOpen = true;
    }
  }

  async function runBoot(report: any) {
    if (!device.flasher) throw new Error("Flasher not connected.");
    await device.flasher.startBank(bootBank);
  }
</script>

<section class="info">
  {#if !device.isConnected}
    <p class="placeholder">Connect a device to see its details.</p>
  {:else}
    <dl class="grid">
      <dt>Running</dt>
      <dd>{running}</dd>
      <dt>Model</dt>
      <dd>{modelLabel(device.model)}</dd>
      <dt>Firmware</dt>
      <dd>{firmwareLabel(device.firmware)}</dd>
      <dt>Retro-Go</dt>
      <dd>{retroGo}</dd>
      <dt>Official Firmware</dt>
      <dd>{ofwText}</dd>
      <dt>Storage (extflash)</dt>
      <dd>{storage}</dd>
      <dt>Read protection</dt>
      <dd>{lockText}</dd>
    </dl>

    <h3 class="subhead">Internal flash</h3>
    {#if device.banks.length}
      <div class="barwrap" style="max-width:640px">
        <GeometryBar segments={intSegs} leftLabel={hex(0x08000000)} rightLabel={hex(0x08200000)} onDblClick={handleDblClickInt} />
      </div>
    {:else}
      <p class="muted">Not scanned yet — run a Scan from the status bar.</p>
    {/if}

    <h3 class="subhead">External flash</h3>
    {#if device.partitions.length}
      <div class="barwrap" style="max-width:{extWidth}px">
        <GeometryBar segments={extSegs} leftLabel={hex(EXTBASE)} rightLabel={hex(extEnd)} />
      </div>
    {:else}
      <p class="muted">Not scanned yet — run a Scan from the status bar.</p>
    {/if}

    <h3 class="subhead">Device log</h3>
    <div class="logrow">
      <button class="btn" disabled={reading || !device.isConnected} onclick={readLog}>
        {reading ? "Reading…" : "Read device log"}
      </button>
      {#if log != null}
        <button class="btn" onclick={downloadLog}>Download</button>
      {/if}
    </div>
    {#if logErr}<p class="err">{logErr}</p>{/if}
    {#if log != null}<pre class="log mono">{log}</pre>{/if}

    <ConfirmModal
      open={bootModalOpen}
      title="Boot Image"
      body={`Are you sure you want to boot ${bootTargetName} @${bootTargetAddr}?`}
      confirmText="Boot"
      danger={true}
      run={runBoot}
      onClose={() => (bootModalOpen = false)}
    />
  {/if}
</section>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 1rem 1.1rem;
  }
  .placeholder {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    opacity: 0.7;
  }
  .grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1rem;
    margin: 0;
  }
  .grid dt {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .grid dd {
    margin: 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  .subhead {
    margin: 0.4rem 0 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .barwrap {
    width: 100%;
    margin: 0.1rem auto 0;
  }
  .muted {
    margin: 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .logrow {
    display: flex;
    gap: 0.4rem;
  }
  .btn {
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink);
    background: var(--silver);
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: var(--r-control);
    padding: 0.2rem 0.7rem;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .err {
    margin: 0;
    font-size: var(--fs-caption);
    color: #b03030;
  }
  .log {
    margin: 0;
    max-height: 24rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--fs-micro);
    line-height: 1.35;
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.6rem 0.7rem;
  }
</style>
