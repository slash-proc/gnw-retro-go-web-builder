<script lang="ts">
  // Tab — Overview. A flat, read-only verbose summary: the long-form of the top status bar.
  // Renders existing store state ONLY (no device reads). Grayed before connect.
  // First cut — content to be refined.
  import { tick } from "svelte";
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { attachFlasher } from "../engine/flasher.js";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import BankCard from "../ui/BankCard.svelte";
  import StatPanel, { type StatRow } from "../ui/StatPanel.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import Button from "../ui/Button.svelte";
  import { extflashSegments, intflashSegments } from "../engine/classify.js";
  import type { GeoSegment } from "../engine/classify.js";
  import { download } from "../util.js";
  import { loadSel, saveSel } from "../persist.js";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";

  let { openSet }: { openSet?: Set<string> } = $props();

  // This tab is a dead end without a device — auto-surface the shared connect gate the
  // moment it's viewed while disconnected (no click required). No-ops instantly if already
  // connected. Re-armed if the user cancels and later reconnects/redisconnects.
  let gateActive = false;
  $effect(() => {
    if (device.isConnected || gateActive) return;
    gateActive = true;
    device.ensureConnectGate().catch(() => {}).finally(() => (gateActive = false));
  });

  const hex = (n: number) => "0x" + (n >>> 0).toString(16);

  const isRetroGo = $derived(
    device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old",
  );
  const running = $derived(
    device.utilLoaded
      ? locale.t.overview.info.runningFlashUtility
      : isRetroGo
        ? locale.t.overview.info.runningRetroGo
        : locale.t.overview.info.runningUnknown,
  );
  const ofw = $derived(device.deviceClass?.ofw ?? null);
  const ofwText = $derived(
    ofw
      ? locale.t.overview.info.ofwLabel(ofw.model === "mario" ? "Mario" : "Zelda", ofw.patched)
      : locale.t.overview.info.ofwNone,
  );
  const retroGo = $derived(
    isRetroGo
      ? device.deviceClass!.label.replace(/^Retro-Go\s*(SD\s*)?/, "") // version + our -flash/-sd suffix only, no "SD" fork name
      : device.deviceClass
        ? locale.t.overview.info.retroGoNotInstalled
        : locale.t.overview.info.retroGoNotScanned,
  );
  const storage = $derived(
    device.extSizeMB != null ? locale.t.overview.info.storageValue(device.extSizeMB) : locale.t.overview.info.unknownValue,
  );
  const lockText = $derived(
    device.locked == null
      ? locale.t.overview.info.unknownValue
      : device.locked
        ? locale.t.overview.info.lockLocked
        : locale.t.overview.info.lockUnlocked,
  );

  // Geometry bars (graceful, in-tab). Width is driven by the SMALLEST real partition: tiny
  // blobs (128/256 KB OFW backups in a multi-MB chip) widen the bar toward the 1200px frame so
  // they stay visible; few/large partitions stay near the 640px status-bar default.
  const extBytes = $derived(device.info?.externalFlashSizeBytes ?? 0);
  const intSegs = $derived(intflashSegments(device.banks));
  const bank1Segs = $derived(intSegs.filter(s => s.bank === 1));
  const bank2Segs = $derived(intSegs.filter(s => s.bank === 2));
  const bootableBank = (n: 1 | 2) =>
    device.banks.some((b) => b.index === n && b.type !== "empty" && b.type !== "unknown" && b.type !== "unreadable");
  const bank1Bootable = $derived(bootableBank(1));
  const bank2Bootable = $derived(bootableBank(2));
  const extSegs = $derived(extflashSegments(device.partitions, extBytes));

  let explicitSelectedExtPart = $state<any>(null);
  let activeExtPart = $derived(explicitSelectedExtPart || device.partitions.find(p => p.fs === 'frogfs') || device.partitions[0]);

  const extFsHeading = $derived.by((): string | undefined => {
    const p = activeExtPart;
    if (!p) return undefined;
    return p.fs === 'frogfs' ? locale.t.overview.extFlash.headingGames : p.fs === 'littlefs' ? locale.t.overview.extFlash.headingCoresAndSaves : p.type;
  });
  const extFsRows = $derived.by((): StatRow[] => {
    const p = activeExtPart;
    if (!p) return [];
    if (!p.fs) {
      return [
        { label: locale.t.overview.extFlash.typeLabel, value: locale.t.overview.extFlash.dataValue },
        { label: locale.t.overview.extFlash.usedLabel, value: `${(p.size / 1048576).toFixed(2)} MB` },
      ];
    }
    const nextOffsets = device.partitions.filter((x) => x.offset > p.offset).map((x) => x.offset);
    const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : extBytes;
    const isFrog = p.fs === 'frogfs';
    const free = isFrog ? nextOffset - (p.offset + p.size) : device.fsStats[p.offset]?.freeBytes ?? null;
    const used = isFrog ? p.size : device.fsStats[p.offset]?.usedBytes ?? null;
    const total = isFrog ? p.size + (free ?? 0) : p.size;
    return [
      { label: locale.t.overview.extFlash.typeLabel, value: p.fs === 'frogfs' ? 'FrogFS' : p.fs === 'littlefs' ? 'LittleFS' : p.type },
      { label: locale.t.overview.extFlash.totalLabel, value: `${(total / 1048576).toFixed(2)} MB` },
      { label: locale.t.overview.extFlash.usedLabel, value: used !== null ? `${(used / 1048576).toFixed(2)} MB` : locale.t.overview.extFlash.calculating },
      { label: locale.t.overview.extFlash.freeLabel, value: free !== null ? `${(free / 1048576).toFixed(2)} MB` : locale.t.overview.extFlash.calculating },
    ];
  });

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
      // "(log buffer empty)" / the "\n---\n" join below are, like report.log() audit-trail
      // text, deliberately English-only in every locale: this text is interleaved with the
      // device's own raw printf output in the same <pre>, not real UI chrome.
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
    download(`retro-go-output-${stamp}.log`, new Blob([log], { type: "text/plain" }));
  }

  let bootModalOpen = $state(false);
  let bootBank = $state<1 | 2>(1);
  let bootTargetName = $state("");
  let bootTargetAddr = $state("");
  let hoveredBank = $state<1 | 2 | null>(null);

  function handleDblClickInt(s: GeoSegment) {
    if (s.bank) {
      bootBank = s.bank;
      bootTargetName = s.label || locale.t.overview.bootModal.bankFallbackLabel(s.bank);
      bootTargetAddr = s.detail[1]?.split("·")[0]?.trim() || (s.bank === 1 ? "0x08000000" : "0x08100000");
      bootModalOpen = true;
    }
  }

  function getBankButtonLabel(bank: any) {
    if (bank.ofw) {
      return locale.t.overview.bankButton.startFirmware(bank.ofw.model === "mario" ? "Mario" : "Zelda");
    }
    if (bank.retroGoVersion || bank.type.includes("Retro-Go")) {
      return locale.t.overview.bankButton.startRetroGo;
    }
    return locale.t.overview.bankButton.startType(bank.type);
  }

  async function runBoot(report: any) {
    if (!device.transport) throw new Error("Not connected.");
    // startBank only needs the SWD transport — no stub required.
    const flasher = device.flasher ?? attachFlasher(device.transport);
    await flasher.startBank(bootBank);
  }

  // Screenshot
  let isCapturingScreenshot = $state(false);
  let screenshotProgress = $state({ done: 0, total: 1 });
  let latestScreenshotUrl = $state<string | null>(null);
  let screenshotErr = $state<string | null>(null);
  let logAccordionOpen = $state(false);
  let logAccordionEl = $state<HTMLElement | null>(null);

  $effect(() => {
    if (openSet?.has("log")) {
      logAccordionOpen = true;
      tick().then(() => logAccordionEl?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  });

  async function startFlashUtil() {
    try {
      await device.ensureStub(undefined, device.utilLoaded);
      await device.runScan();
    } catch (e) {
      if (e instanceof Error && e.message.includes("cancelled")) return;
      alert(locale.t.overview.controls.startFlashUtilFailed(String(e)));
    }
  }

  let extScanErr = $state<string | null>(null);

  async function enterRecoveryToScan() {
    extScanErr = null;
    try {
      await device.ensureStub();
      await device.runScan();
    } catch (e) {
      if (e instanceof Error && e.message.includes("cancelled")) return;
      extScanErr = e instanceof Error ? e.message : String(e);
    }
  }

  // Single-phase, no substeps — a screenshot capture has no natural internal decomposition
  // beyond "capturing" with a byte-progress counter (see engine/screenshot.ts's halt/64KiB
  // chunk/resume sequence, which this must NOT touch).
  const screenshotPhases = $derived<PhaseDef[]>([{ id: "capture", label: locale.t.overview.screenshot.phaseCapturing }]);

  async function runScreenshot(report: PhaseReporter) {
    report.start("capture");
    const imageData = await device.captureScreenshot((done, total) => {
      report.progress("capture", done, total);
    });
    latestScreenshotUrl = renderImageDataToUrl(imageData);
    report.finish("capture");
  }

  async function triggerScreenshot() {
    screenshotErr = null;
    if (loadSel("skip-screenshot-confirm", false)) {
      isCapturingScreenshot = true;
      try {
        const imageData = await device.captureScreenshot((done, total) => {
          screenshotProgress = { done, total };
        });
        latestScreenshotUrl = renderImageDataToUrl(imageData);
      } catch (err) {
        screenshotErr = err instanceof Error ? err.message : String(err);
      } finally {
        isCapturingScreenshot = false;
      }
      return;
    }
    void installProgress.run({
      title: locale.t.overview.screenshot.modalTitle,
      body: locale.t.overview.screenshot.modalBody,
      confirmText: locale.t.overview.screenshot.modalConfirm,
      phases: screenshotPhases,
      checkboxes: [{ id: "remember", label: locale.t.overview.screenshot.rememberCheckbox }],
      exec: async (report) => {
        if (installProgress.checkboxValues["remember"]) saveSel("skip-screenshot-confirm", true);
        try {
          await runScreenshot(report);
        } catch (e) {
          screenshotErr = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    });
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
    <p class="placeholder">{locale.t.overview.waitingForConnection}</p>
  {:else}
    <div class="dashboard">
      <div class="left-col">
        <div class="left-panel info-card">
          <h4 class="card-title">{locale.t.overview.info.title}</h4>
          <dl class="grid">
            <dt>{locale.t.overview.info.running}</dt>
            <dd>{running}</dd>
            <dt>{locale.t.overview.info.gameAndWatch}</dt>
            <dd>{ofwText}</dd>
            <dt>{locale.t.overview.info.retroGo}</dt>
            <dd>{retroGo}</dd>
            <dt>{locale.t.overview.info.storageExtflash}</dt>
            <dd>{storage}</dd>
            <dt>{locale.t.overview.info.readProtection}</dt>
            <dd>{lockText}</dd>
          </dl>
        </div>

        <div class="left-panel controls-card">
          <h4 class="card-title">{locale.t.overview.controls.title}</h4>
          <div class="controls">
            <button class="btn" onclick={startFlashUtil} disabled={device.scanning}>
              {device.utilLoaded ? locale.t.overview.controls.restartFlashUtil : locale.t.overview.controls.startFlashUtil}
            </button>

            <button class="btn" disabled={isCapturingScreenshot || !device.isConnected} onclick={triggerScreenshot}>
              {isCapturingScreenshot ? locale.t.overview.controls.capturingPercent(Math.round((screenshotProgress.done / screenshotProgress.total) * 100)) : locale.t.overview.controls.captureScreenshot}
            </button>
          </div>
          {#if screenshotErr}<p class="err">{screenshotErr}</p>{/if}
        </div>
      </div>

      <div class="left-panel screenshot-card">
        <div class="screenshot-area">
          {#if latestScreenshotUrl}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <img
              src={latestScreenshotUrl}
              alt={locale.t.overview.screenshot.alt}
              onclick={downloadScreenshot}
              title={locale.t.overview.screenshot.clickToDownload}
            />
          {:else}
            <div class="screenshot-placeholder">{locale.t.overview.screenshot.noScreenshotCaptured}</div>
          {/if}
        </div>
      </div>

      <div class="left-panel banks-card">
        <h4 class="card-title">{locale.t.overview.banks.heading}</h4>
        <div class="banks-panel">
          {#if device.banks.length}
            <BankCard bankNum={1} segs={bank1Segs} {hoveredBank} onSegmentDblClick={handleDblClickInt} footer={bank1Bootable ? bank1Footer : undefined} />
            <BankCard bankNum={2} segs={bank2Segs} {hoveredBank} onSegmentDblClick={handleDblClickInt} footer={bank2Bootable ? bank2Footer : undefined} />
          {/if}
        </div>
      </div>

      {#snippet bank1Footer()}
        {#each device.banks.filter((b) => b.index === 1) as bank}
          {#if bank.type !== 'empty' && bank.type !== 'unknown' && bank.type !== 'unreadable'}
            <button
              class="btn primary bank-boot-btn"
              onclick={() => {
                bootBank = bank.index;
                bootTargetName = bank.type;
                bootTargetAddr = "0x08000000";
                bootModalOpen = true;
              }}
              onmouseenter={() => (hoveredBank = bank.index)}
              onmouseleave={() => (hoveredBank = null)}
            >
              {getBankButtonLabel(bank)}
            </button>
          {/if}
        {/each}
      {/snippet}

      {#snippet bank2Footer()}
        {#each device.banks.filter((b) => b.index === 2) as bank}
          {#if bank.type !== 'empty' && bank.type !== 'unknown' && bank.type !== 'unreadable'}
            <button
              class="btn primary bank-boot-btn"
              onclick={() => {
                bootBank = bank.index;
                bootTargetName = bank.type;
                bootTargetAddr = "0x08100000";
                bootModalOpen = true;
              }}
              onmouseenter={() => (hoveredBank = bank.index)}
              onmouseleave={() => (hoveredBank = null)}
            >
              {getBankButtonLabel(bank)}
            </button>
          {/if}
        {/each}
      {/snippet}

      <div class="ext-panel">
        {#if device.partitions.length}
          <div class="bank-card ext-card">
            <div class="ext-card-heading">
              <div class="bank-title">{locale.t.overview.extFlash.title}</div>
              <div class="ext-card-capacity">{storage}</div>
            </div>
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
            
            {#if activeExtPart}
              <StatPanel rows={extFsRows} heading={extFsHeading} variant="panel-footer" />
            {/if}
          </div>
        {:else if device.scanning}
          <div class="placeholder ext-placeholder">{locale.t.overview.extFlash.scanningPleaseWait}</div>
        {:else}
          <div class="placeholder ext-placeholder ext-placeholder-col">
            <!-- ensureStub() (device.svelte.ts) never scans on its own — partitions only get
                 populated by runScan()'s Tier-2 step, and only if the stub was ALREADY loaded
                 when that ran. So the stub can be loaded (utilLoaded=true, status bar correctly
                 says "Connected (Recovery Mode)") while partitions is still empty here — showing
                 "Enter Recovery Mode" in that state is misleading since recovery mode is already
                 active; only a (re)scan is actually needed. enterRecoveryToScan() itself already
                 safely handles both cases (ensureStub() no-ops if already loaded, then runScan()
                 always runs) — this only fixes the label to match reality. -->
            <Button variant="action" onclick={enterRecoveryToScan}>
              {device.utilLoaded ? locale.t.overview.extFlash.scan : locale.t.overview.extFlash.enterRecoveryToScan}
            </Button>
            {#if extScanErr}<p class="err">{extScanErr}</p>{/if}
          </div>
        {/if}
      </div>
    </div>

    <ConfirmModal
      open={bootModalOpen}
      title={locale.t.overview.bootModal.title}
      body={locale.t.overview.bootModal.body(bootTargetName, bootTargetAddr)}
      confirmText={locale.t.overview.bootModal.confirm}
      onClose={() => (bootModalOpen = false)}
      run={runBoot}
    />

    <div class="log-accordion {logAccordionOpen ? 'open' : ''}" bind:this={logAccordionEl}>
      <button class="log-accordion-header" onclick={() => logAccordionOpen = !logAccordionOpen}>
        <h3 class="subhead" style="margin: 0;">{locale.t.overview.log.heading}</h3>
        <span class="chevron">{logAccordionOpen ? '▼' : '▶'}</span>
      </button>

      {#if logAccordionOpen}
        <div class="log-accordion-body">
          <div class="logrow">
            <button class="btn" disabled={reading || !device.isConnected} onclick={readLog}>
              {reading ? locale.t.overview.log.reading : locale.t.overview.log.readLog}
            </button>
            {#if log != null}
              <button class="btn" onclick={downloadLog}>{locale.t.overview.log.download}</button>
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
    grid-template-columns: 2fr 2.5fr;
    gap: 1.5rem 2rem;
    align-items: stretch;
    margin-top: 1rem;
    max-width: 100%;
    box-sizing: border-box;
  }
  .left-col {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-width: 0;
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
  .screenshot-card {
    justify-content: center;
  }
  .card-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .controls {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  /* Not ".bank-footer .btn.primary" — .bank-footer's own wrapper div now lives in
     BankCard.svelte's scope (this content is passed in as a snippet prop), so a descendant
     selector rooted there wouldn't match under Svelte's per-file CSS scoping. .bank-boot-btn
     alone (defined on this same button, in this file) is enough to scope it correctly. */
  .bank-boot-btn.primary {
    background: var(--action-red);
    color: white;
    border-color: rgba(0,0,0,0.2);
  }
  .banks-panel {
    display: flex;
    gap: 1rem;
    min-width: 0;
  }
  /* Matches .left-panel/.card-title (Info/Controls cards) — a plain bordered box with a
     plain-text heading, not a separate background-bar title strip. */
  .bank-card {
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    padding: 1rem;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .bank-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .bank-body {
    display: flex;
    flex-direction: column;
    height: 200px;
    gap: 0.5rem;
    align-items: center;
  }
  .bank-boot-btn {
    width: 100%;
    text-align: center;
  }
  .ext-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .ext-card {
    flex: 1;
    width: auto; /* override bank-card width: 200px */
  }
  .ext-card-heading {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  /* Capacity ("64 MB") demoted to a quiet caption under the heading, rather than crammed
     inline as "External Flash (64 MB)" — matches BankCard's own less-prominent sub-label
     treatment. */
  .ext-card-capacity {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
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
  .ext-placeholder-col {
    flex-direction: column;
    gap: 0.5rem;
  }
  .ext-body {
    height: auto;
    min-height: 80px;
    justify-content: center;
    align-items: stretch;
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
  /* Fixed at the G&W's native 320x240 framebuffer size — never anything fluid/scaled. */
  .screenshot-area {
    width: 320px;
    height: 240px;
    margin: 0 auto;
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
