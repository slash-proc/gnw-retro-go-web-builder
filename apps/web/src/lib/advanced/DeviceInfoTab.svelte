<script lang="ts">
  // Tab — Device Information. A flat, read-only verbose summary: the long-form of the top
  // status bar. Renders existing store state ONLY (no device reads). Grayed before connect.
  // First cut — content to be refined.
  import { device, modelLabel, firmwareLabel } from "../device.svelte.js";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import { extflashSegments, intflashSegments } from "../engine/classify.js";
  import type { GeoSegment } from "../engine/classify.js";

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
  const bank1Segs = $derived(intSegs.filter(s => s.bank === 1));
  const bank2Segs = $derived(intSegs.filter(s => s.bank === 2));
  const extSegs = $derived(extflashSegments(device.partitions, extBytes));

  let explicitSelectedExtPart = $state<any>(null);
  let activeExtPart = $derived(explicitSelectedExtPart || device.partitions.find(p => p.fs === 'frogfs') || device.partitions[0]);

  // Device log — read retro-go's persistent printf buffer over the live connection.
  let log = $state<string | null>(null);
  let logErr = $state<string | null>(null);
  let logContainer: HTMLElement | null = $state(null);
  let reading = $state(false);

  async function readLog() {
    reading = true;
    logErr = null;
    try {
      const r = await device.readLog();
      const newText = r.text || "(log buffer empty)";
      if (!log || newText === "(log buffer empty)") {
        log = newText;
      } else {
        let overlap = 0;
        for (let i = Math.min(log.length, newText.length); i > 0; i--) {
          if (log.endsWith(newText.slice(0, i))) {
            overlap = i;
            break;
          }
        }
        if (overlap > 0) {
          log += newText.slice(overlap);
        } else {
          log += "\n---\n" + newText;
        }
      }
      setTimeout(() => {
        if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
      }, 0);
    } catch (e) {
      logErr = e instanceof Error ? e.message : String(e);
    } finally {
      reading = false;
    }
  }

  $effect(() => {
    if (device.isConnected && device.partitions.length > 0 && !log && !reading) {
      readLog();
    }
  });

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
  let hoveredBank = $state<1 | 2 | null>(null);

  function handleDblClickInt(s: GeoSegment) {
    if (s.bank) {
      bootBank = s.bank;
      bootTargetName = s.label || `Bank ${s.bank}`;
      bootTargetAddr = s.detail[1]?.split("·")[0]?.trim() || (s.bank === 1 ? "0x08000000" : "0x08100000");
      bootModalOpen = true;
    }
  }

  function getBankButtonLabel(bank: any) {
    if (bank.ofw) {
      return `Start ${bank.ofw.model === "mario" ? "Mario" : "Zelda"} Firmware`;
    }
    if (bank.retroGoVersion || bank.type.includes("Retro-Go")) {
      return "Start Retro-Go";
    }
    return `Start ${bank.type}`;
  }

  async function runBoot(report: any) {
    if (!device.flasher) throw new Error("Flasher not connected.");
    await device.flasher.startBank(bootBank);
  }

  // Screenshot
  let screenshotOpen = $state(false);
  let rememberScreenshot = $state(false);
  let isCapturingScreenshot = $state(false);
  let screenshotProgress = $state({ done: 0, total: 1 });
  let latestScreenshotUrl = $state<string | null>(null);
  let logAccordionOpen = $state(false);

  async function startFlashUtil() {
    try {
      await device.ensureStub(undefined, device.utilLoaded);
      await device.runScan();
    } catch (e) {
      if (e instanceof Error && e.message.includes("cancelled")) return;
      alert("Failed to start flash utility: " + e);
    }
  }

  async function triggerScreenshot() {
    if (localStorage.getItem("gnw_skip_screenshot_confirm") === "true") {
      isCapturingScreenshot = true;
      try {
        const imageData = await device.captureScreenshot((done, total) => {
          screenshotProgress = { done, total };
        });
        const url = renderImageDataToUrl(imageData);
        latestScreenshotUrl = url;
      } catch (err) {
        alert("Screenshot failed: " + err);
      } finally {
        isCapturingScreenshot = false;
      }
    } else {
      screenshotOpen = true;
    }
  }

  function renderImageDataToUrl(imageData: ImageData): string {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d")!.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function downloadScreenshot() {
    if (!latestScreenshotUrl) return;
    const a = document.createElement("a");
    a.href = latestScreenshotUrl;
    a.download = `gnw_screenshot_${Date.now()}.png`;
    a.click();
  }
</script>

<section class="info">
  {#if !device.isConnected}
    <p class="placeholder">Connect a device to see its details.</p>
  {:else}
    <div class="dashboard">
      <div class="left-panel info-card">
        <dl class="grid">
          <dt>Running</dt>
          <dd>{running}</dd>
          <dt>Model</dt>
          <dd>{modelLabel(device.model)}</dd>
          <dt>Firmware</dt>
          <dd>{device.deviceClass?.label || "Unknown / not scanned"}</dd>
          <dt>Base Firmware</dt>
          <dd>{ofwText}</dd>
          <dt>Storage (extflash)</dt>
          <dd>{storage}</dd>
          <dt>Read protection</dt>
          <dd>{lockText}</dd>
        </dl>
      </div>

      <div class="left-panel controls-card">
        <div class="controls-layout">
          <div class="controls-actions">
            <h4 class="card-title">Device Controls</h4>
            <div class="controls">
              <button class="btn" onclick={startFlashUtil} disabled={device.scanning}>
                {device.utilLoaded ? "Restart Flash Util" : "Start Flash Util"}
              </button>
              
              <button class="btn" disabled={isCapturingScreenshot || !device.isConnected} onclick={triggerScreenshot}>
                {isCapturingScreenshot ? `Capturing (${Math.round((screenshotProgress.done / screenshotProgress.total) * 100)}%)` : "Capture Screenshot"}
              </button>
            </div>
          </div>
          <div class="screenshot-area">
            {#if latestScreenshotUrl}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <img 
                src={latestScreenshotUrl} 
                alt="Screenshot" 
                onclick={downloadScreenshot} 
                title="Click to download screenshot" 
              />
            {:else}
              <div class="screenshot-placeholder">No screenshot captured</div>
            {/if}
          </div>
        </div>
      </div>

      <div class="banks-panel">
        {#if device.banks.length}
          {@render bankCard(1, bank1Segs)}
          {@render bankCard(2, bank2Segs)}
        {/if}
      </div>

      <div class="ext-panel">
        {#if device.partitions.length}
          <div class="bank-card ext-card">
            <div class="bank-title">External Flash ({storage})</div>
            <div class="bank-body ext-body">
              <GeometryBar 
                segments={extSegs}
                onClick={(s) => {
                  let p = device.partitions.find(x => x.offset === s.offset);
                  if (s.kind === 'free') {
                    p = device.partitions.find(x => x.fs === 'frogfs');
                  }
                  if (p) explicitSelectedExtPart = p;
                }}
              />
            </div>
            
            <div class="bank-footer ext-fs-single">
              {#if activeExtPart}
                {@const p = activeExtPart}
                <div class="fs-stat-name">{p.fs === 'frogfs' ? 'Games' : p.fs === 'littlefs' ? 'Cores & Saves' : p.type}</div>
                {#if p.fs}
                  {@const nextOffsets = device.partitions.filter(x => x.offset > p.offset).map(x => x.offset)}
                  {@const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : extBytes}
                  {@const isFrog = p.fs === 'frogfs'}
                  {@const free = isFrog ? nextOffset - (p.offset + p.size) : device.fsStats[p.offset]?.freeBytes ?? null}
                  {@const used = isFrog ? p.size : device.fsStats[p.offset]?.usedBytes ?? null}
                  {@const total = isFrog ? p.size + (free ?? 0) : p.size}
                  <div class="fs-stat-row"><span>Type:</span> <span>{p.fs === 'frogfs' ? 'FrogFS' : p.fs === 'littlefs' ? 'LittleFS' : p.type}</span></div>
                  <div class="fs-stat-row"><span>Total:</span> <span>{(total / 1048576).toFixed(2)} MB</span></div>
                  <div class="fs-stat-row"><span>Used:</span> <span>{used !== null ? (used / 1048576).toFixed(2) + ' MB' : 'Calculating...'}</span></div>
                  <div class="fs-stat-row"><span>Free:</span> <span>{free !== null ? (free / 1048576).toFixed(2) + ' MB' : 'Calculating...'}</span></div>
                {:else}
                  <div class="fs-stat-row"><span>Type:</span> <span>Data</span></div>
                  <div class="fs-stat-row"><span>Used:</span> <span>{(p.size / 1048576).toFixed(2)} MB</span></div>
                {/if}
              {/if}
            </div>
          </div>
        {:else}
          <div class="placeholder ext-placeholder">Not scanned yet — run a Scan from the status bar.</div>
        {/if}
      </div>
    </div>

    {#snippet bankCard(bankNum: number, segs: GeoSegment[])}
      <div class="bank-card">
        <div class="bank-title">Bank {bankNum} (Internal Flash)</div>
        <div class="bank-body">
          <div class="bank-bar">
            {#each segs as s}
              <div 
                class="v-seg {s.kind} {hoveredBank === bankNum && s.kind !== 'free' && s.kind !== 'bank-empty' ? 'hovered' : ''}" 
                style="height: {s.pct * 2}%;"
                title={s.detail ? s.detail.join('\n') : s.label}
                ondblclick={() => handleDblClickInt(s)}
              >
                {#if s.pct * 2 > 15 && s.kind !== 'free' && s.kind !== 'bank-empty'}
                  <div class="seg-content">
                    <span class="seg-label">{s.label}</span>
                    <span class="seg-size">{Math.round((s.pct * 2 / 100) * 256)} KB</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="bank-total-label">256 KB</div>
        </div>
        {#if device.banks.filter(b => b.index === bankNum && b.type !== 'empty' && b.type !== 'unknown' && b.type !== 'unreadable').length > 0}
          <div class="bank-footer">
            {#each device.banks.filter(b => b.index === bankNum) as bank}
              {#if bank.type !== 'empty' && bank.type !== 'unknown' && bank.type !== 'unreadable'}
                <button class="btn primary bank-boot-btn" 
                  onclick={() => {
                    bootBank = bank.index;
                    bootTargetName = bank.type;
                    bootTargetAddr = bank.index === 1 ? "0x08000000" : "0x08100000";
                    bootModalOpen = true;
                  }}
                  onmouseenter={() => hoveredBank = bank.index}
                  onmouseleave={() => hoveredBank = null}
                >
                  {getBankButtonLabel(bank)}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/snippet}

    <ConfirmModal
      open={bootModalOpen}
      title="Boot Image"
      body="The device will be reset to boot {bootTargetName} from {bootTargetAddr}."
      confirmText="Boot"
      onClose={() => (bootModalOpen = false)}
      run={runBoot}
    />

    <ConfirmModal
      open={screenshotOpen}
      title="Capture Screenshot"
      body="This will briefly halt the device to read the display buffer."
      confirmText="Capture"
      onClose={() => (screenshotOpen = false)}
      run={async (report) => {
        if (rememberScreenshot) localStorage.setItem("gnw_skip_screenshot_confirm", "true");
        const imageData = await device.captureScreenshot(report);
        latestScreenshotUrl = renderImageDataToUrl(imageData);
      }}
    >
      {#snippet summary()}
        <label style="display:flex; align-items:center; gap:0.5rem; margin-top: 1rem; color: var(--ink-soft);">
          <input type="checkbox" bind:checked={rememberScreenshot} />
          Don't ask me again
        </label>
      {/snippet}
    </ConfirmModal>

    <div class="log-accordion {logAccordionOpen ? 'open' : ''}">
      <button class="log-accordion-header" onclick={() => logAccordionOpen = !logAccordionOpen}>
        <h3 class="subhead" style="margin: 0;">Device log</h3>
        <span class="chevron">{logAccordionOpen ? '▼' : '▶'}</span>
      </button>
      
      {#if logAccordionOpen}
        <div class="log-accordion-body">
          <div class="logrow">
            <button class="btn" disabled={reading || !device.isConnected} onclick={readLog}>
              {reading ? "Reading…" : "Read device log"}
            </button>
            {#if log != null}
              <button class="btn" onclick={downloadLog}>Download</button>
            {/if}
          </div>
          {#if logErr}<p class="err">{logErr}</p>{/if}
          {#if log != null}<pre class="log mono" bind:this={logContainer}>{log}</pre>{/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .info {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 0.6rem;
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 1rem 1.1rem;
  }
  .logrow {
    display: flex;
    justify-content: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .log {
    margin: 0;
    flex: 1;
    min-height: 150px;
    max-height: 800px;
    overflow-y: auto;
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.6rem 0.7rem;
  }
  .log-accordion {
    display: flex;
    flex-direction: column;
    margin-top: 1rem;
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    background: var(--bg);
  }
  .log-accordion.open {
    flex: 1;
  }
  .log-accordion-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    color: var(--ink);
  }
  .log-accordion-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    padding: 0 1rem 1rem 1rem;
    animation: slideDown 0.2s ease-out;
  }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
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
  .dashboard {
    width: 100%;
    display: grid;
    grid-template-columns: 2fr 3fr;
    gap: 1.5rem 2rem;
    align-items: stretch;
    margin-top: 1rem;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }
  .left-panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    padding: 1rem;
    min-width: 0;
  }
  .info-card {
    justify-content: flex-start;
  }
  .controls-card {
    justify-content: flex-start;
  }
  .card-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .controls .btn {
    align-self: flex-start;
  }
  .bank-footer .btn.primary {
    background: var(--action-red);
    color: white;
    border-color: rgba(0,0,0,0.2);
  }
  .banks-panel {
    display: flex;
    gap: 1rem;
    min-width: 0;
  }
  .bank-card {
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bank-title {
    background: var(--surface);
    border-bottom: 1px solid var(--surface-sunk);
    padding: 0.5rem;
    text-align: center;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .bank-body {
    display: flex;
    flex-direction: column;
    padding: 1rem;
    height: 200px;
    gap: 0.5rem;
    align-items: center;
  }
  .bank-total-label {
    font-size: 0.75rem;
    color: var(--ink-soft);
    text-align: center;
    font-weight: 600;
  }
  .bank-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--surface-sunk);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .bank-boot-btn {
    width: 100%;
    text-align: center;
  }
  .bank-bar {
    width: 80px;
    flex: 1;
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    overflow: hidden;
    background: #e0e0e0;
    border: 1px solid rgba(0,0,0,0.1);
  }
  .seg-content {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    height: 100%;
    padding-bottom: 0.4rem;
  }
  .seg-size {
    font-size: 0.65rem;
    opacity: 0.85;
    margin-top: 0.2rem;
  }
  .v-seg {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
    padding: 0 0.25rem;
    transition: filter 0.2s, outline 0.2s;
  }
  .v-seg.hovered {
    filter: brightness(1.25);
    outline: 2px solid var(--action-red);
    outline-offset: -2px;
    z-index: 1;
  }
  .v-seg.ofw { background: #444; }
  .v-seg.data { background: #888; }
  .v-seg.bank { background: #888; }
  .v-seg.free { background: #e0e0e0; color: transparent; }
  .v-seg.bank-empty { background: #e0e0e0; color: transparent; }
  .v-seg.unreadable { background: #f0f0f0; color: #888; }
  .ext-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .ext-card {
    flex: 1;
    width: auto; /* override bank-card width: 200px */
  }
  .ext-placeholder {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--surface-sunk);
    border-radius: var(--r-card);
    color: var(--ink-soft);
  }
  .ext-body {
    height: auto;
    min-height: 80px;
    padding: 1.5rem 1rem;
    justify-content: center;
    align-items: stretch;
  }
  .ext-fs-single {
    padding: 1rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .fs-stat-name {
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--ink);
  }
  .fs-stat-row {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .fs-stat-row span:last-child {
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
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
  .controls-layout {
    display: flex;
    flex-direction: row;
    gap: 1.5rem;
    align-items: stretch;
    min-width: 0;
  }
  .controls-actions {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .screenshot-area {
    flex: 0 1 320px;
    aspect-ratio: 4 / 3;
    height: auto;
    background: #000;
    border-radius: 4px;
    border: 1px solid var(--surface-sunk);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
  }
  .screenshot-area img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    cursor: pointer;
    transition: filter 0.2s;
  }
  .screenshot-area img:hover {
    filter: brightness(1.1);
  }
  .screenshot-placeholder {
    color: var(--ink-soft);
    font-size: var(--fs-micro);
  }
</style>
