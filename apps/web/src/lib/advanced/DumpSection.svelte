<script lang="ts">
  import { device } from "../device.svelte.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { download, kb } from "../util.js";
  import {
    parseAddr, hex, hex8, commas, BANK_BASE, EXTBASE, bankForAddr, regionSize,
    INT_BAR_NOTE, INT_BAR_SIZE, EXT_BAR_NOTE, extBarSize,
  } from "./addr.js";
  import Button from "../ui/Button.svelte";
  import Progress from "../ui/Progress.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import RangeField from "./RangeField.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import { locale } from "../i18n/locale.svelte.js";
  import PaneFooter from "./PaneFooter.svelte";

  // §A.2 — Dump flash (cancelable read). Real, wired to readFlash via dumpRegion.
  let { onRunning }: { onRunning?: (r: boolean) => void } = $props();

  // The range fields are the source of truth (docs/design/mockups README: the bars are only a
  // shortcut that writes into them). `start` holds an ABSOLUTE address; the bank is derived.
  let start = $state(hex8(EXTBASE));
  let length = $state("");

  let dumping = $state(false);
  let canceled = false;
  let done = $state(0);
  let total = $state(0);
  let error = $state<string | null>(null);
  let result = $state<string | null>(null); // success summary
  let canceledChip = $state(false);
  let startedAt = 0;

  const extSize = $derived(device.extFlashBytes);
  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, extSize));

  const startAddr = $derived(parseAddr(start));
  const bank = $derived(bankForAddr(startAddr, device.extSizeMB));
  const inRange = $derived(bank >= 0);

  // A locked device can't read internal flash (§3.1 / validation).
  const lockedGuard = $derived(device.locked === true && (bank === 1 || bank === 2));

  // Resolve offset/length; empty length → whole region from offset (§A.2).
  const offBytes = $derived(inRange ? startAddr - BANK_BASE[bank] : NaN);
  const region = $derived(inRange ? regionSize(bank, device.extSizeMB) : 0);
  const lenBytes = $derived(length.trim() === "" ? Math.max(0, region - (offBytes || 0)) : parseAddr(length));
  const valid = $derived(
    inRange && Number.isFinite(offBytes) && offBytes >= 0 && Number.isFinite(lenBytes) && lenBytes > 0 && !lockedGuard,
  );
  const overrun = $derived(valid && (offBytes || 0) + lenBytes > region);
  const base = $derived(inRange ? BANK_BASE[bank] : 0);
  const filename = $derived(`${device.model}_bank${bank}_${hex(offBytes || 0)}_${hex(lenBytes || 0)}.bin`);


  // Dump.dc.html:88 — the caption's trailing `matches LittleFS` clause: true only when the
  // resolved range is EXACTLY a scanned partition (or a whole internal bank). Read-only —
  // it feeds nothing but the caption.
  const matchLabel = $derived.by(() => {
    if (!valid || overrun) return "";
    const hit = [...intSegs, ...extSegs].find(
      (sg) =>
        sg.bank === bank &&
        sg.kind !== "free" &&
        sg.label !== "" &&
        sg.offset === (offBytes || 0) &&
        sg.size === lenBytes,
    );
    return hit ? hit.label : "";
  });

  // Click-to-fill: writes the segment's ABSOLUTE start and its size into the two range
  // fields and nothing else. Both values come from the scanned segment itself
  // (engine/classify.ts over device.banks / device.partitions), never from a constant here.
  let filled = $state<GeoSegment | null>(null);
  function handleGeoClick(s: GeoSegment) {
    if (s.bank === undefined || s.offset === undefined) return;
    start = hex8(BANK_BASE[s.bank] + s.offset);
    if (s.size !== undefined) length = hex(s.size);
    filled = s;
  }

  // Dumping intflash (bank 1/2) only needs a connection. Dumping extflash (bank 0) needs
  // Recovery Mode (the stub) — if it's not booted yet, the button becomes "Enter Recovery Mode".
  const needsRecovery = $derived(bank === 0 && !device.utilLoaded);

  async function enterRecovery() {
    error = null;
    try {
      await device.startRecoveryMode();
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("cancelled"))) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  async function dump() {
    if (!device.isConnected || !valid) return;
    const off = offBytes;
    const len = overrun ? region - off : lenBytes;
    dumping = true;
    canceled = false;
    canceledChip = false;
    error = null;
    result = null;
    done = total = 0;
    startedAt = Date.now();
    onRunning?.(true);
    try {
      const flasher = await device.ensureStub();
      const data = await dumpRegion(flasher, bank, off, len, (d, t) => {
        if (canceled) throw new Error("Canceled");
        done = d;
        total = t;
      });
      download(filename, data);
      const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      result = locale.t.dumpSection.resultSummary((data.length / (1 << 20)).toFixed(1), secs);
    } catch (e) {
      if (canceled) canceledChip = true;
      else error = e instanceof Error ? e.message : String(e);
    } finally {
      dumping = false;
      onRunning?.(false);
    }
  }
</script>

  {#if device.scanning}
    <!-- The range fields and geometry bars below all read device.banks/partitions,
         which are mid-flight during a scan — mask the section instead of showing a stale or
         half-populated layout. -->
    <div class="placeholder">{locale.t.dumpSection.scanningDevice}</div>
  {:else}
  <div class="stack">
    <div class="bars">
      {#if intSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            size="tall"
            segments={intSegs}
            title={locale.t.dumpSection.internalFlashTitle}
            note={INT_BAR_NOTE}
            sizeLabel={INT_BAR_SIZE}
            isSelected={(s) => s === filled}
            onClick={handleGeoClick}
          />
        </div>
      {/if}

      {#if extSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            size="tall"
            segments={extSegs}
            title={locale.t.dumpSection.externalFlashTitle}
            note={EXT_BAR_NOTE}
            sizeLabel={extBarSize(device.extSizeMB)}
            isSelected={(s) => s === filled}
            onClick={handleGeoClick}
          />
        </div>
      {/if}
    </div>

    <p class="muted small barhint">{locale.t.dumpSection.barHint}</p>

    <div class="grid">
      <RangeField label={locale.t.dumpSection.offsetLabel} bind:value={start} disabled={dumping} placeholder={locale.t.dumpSection.offsetPlaceholder} />
      <RangeField label={locale.t.dumpSection.lengthLabel} bind:value={length} disabled={dumping} placeholder={locale.t.dumpSection.lengthPlaceholder} />
    </div>

    {#if lockedGuard}
      <p class="notice">
        {locale.t.dumpSection.lockedNotice}
      </p>
    {/if}

    <!-- Dump.dc.html:87-88 — the resolved range is one mono caption under the fields,
         with the artboard's trailing `matches <partition>` clause when the range is
         exactly a scanned partition. -->
    <p class="rangecap mono">
      {hex8(base + (offBytes || 0))} → {hex8(base + (offBytes || 0) + (lenBytes || 0))} · {locale.t.dumpSection.bytesValue(commas(lenBytes || 0))}{matchLabel ? ` · ${locale.t.dumpSection.matchesPartition(matchLabel)}` : ""}
    </p>

    <!-- Dump.dc.html:89-90 — a white PLAN block of label/value rows. -->
    <div class="plan">
      <div class="plancap">{locale.t.dumpSection.planCaption}</div>
      <div class="planrows">
        <div class="planrow">
          <span class="pl">{locale.t.dumpSection.readsRow}</span>
          <span class="pv mono">{locale.t.dumpSection.bytesValue(commas(lenBytes || 0))}</span>
        </div>
        <div class="planrow">
          <span class="pl">{locale.t.dumpSection.toFileRow}</span>
          <span class="pv mono">{filename}</span>
        </div>
      </div>
    </div>

    {#if overrun}<p class="warn">{locale.t.dumpSection.overrunWarning(commas(region - (offBytes || 0)))}</p>{/if}

    <!-- Dump.dc.html:93 — the footer bar carries only the summary sentence and the primary
         button (survey A, D-8). The invalid-range hint belongs to the range fields, so it
         states itself in the body next to the overrun warning. -->
    {#if !dumping && !needsRecovery && !valid && !lockedGuard}
      <p class="hint">{locale.t.dumpSection.invalidHint}</p>
    {/if}

    {#if !dumping}
      <PaneFooter summary={locale.t.dumpSection.footerSummary}>
        {#if needsRecovery}
          <Button variant="action" onclick={enterRecovery}>{locale.t.dumpSection.enterRecoveryMode}</Button>
        {:else}
          <Button variant="action" disabled={!valid} onclick={dump}>{locale.t.dumpSection.dumpToFile}</Button>
        {/if}
      </PaneFooter>
    {:else}
      <Progress value={done} max={total} label={locale.t.dumpSection.progressLabel(String(kb(done)), String(kb(total)))} />
      <div><Button onclick={() => (canceled = true)}>{locale.t.dumpSection.cancel}</Button></div>
      <p class="muted small">{locale.t.dumpSection.cancelHint}</p>
    {/if}

    {#if result}<p class="ok">{result}</p>{/if}
    {#if error}<p class="err mono">{error}</p>{/if}
  </div>
  {/if}

<style>
  /* Write/Dump/Erase/FileBrowser.dc.html — the pane body column is `gap: 28px`
     (FirmwareRail's `.panebody` already is); the section's own stack continues that
     column, so it uses the same rhythm. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  .placeholder {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    opacity: 0.7;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    margin: 0;
  }
  .small {
    font-size: var(--fs-micro);
  }
  /* Dump.dc.html:83 — `display: flex; gap: 16px; align-items: flex-end` with the two
     fields at flex 1.4 / 1, spanning the pane body's full width (no cap), matching
     Write's `.fieldrow`. The 32rem cap was ours. */
  .grid {
    display: grid;
    gap: 16px;
    align-items: end;
    grid-template-columns: 1.4fr 1fr;
  }
  /* Write/Dump/Erase.dc.html — the bar hint is `font-size: 13px; color: #5c5c5c;
     margin-top: -8px`, i.e. 13px (not the 12px `.small`) and pulled 8px toward the bars. */
  .barhint {
    font-size: var(--fs-btn-sm);
    margin-top: -8px;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .bar-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  @media (max-width: 560px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .mono {
    font-family: var(--font-mono);
  }
  /* Dump.dc.html:87 — 12px mono, quiet grey, tucked under the field row. */
  .rangecap {
    margin: -14px 0 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    overflow-x: auto;
  }
  /* Dump.dc.html:89 — `#ffffff`, `border-radius: 6px`, `padding: 18px 20px`, under an
     11px/700/0.11em uppercase PLAN caption. */
  .plan {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 18px 20px;
    background: var(--surface);
    border-radius: var(--r-card);
  }
  .plancap {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    color: var(--ink-soft);
    text-transform: uppercase;
  }
  .planrows {
    padding-top: 6px;
  }
  .planrow {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 5px 0;
  }
  .pl {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .pv {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
    text-align: end;
    overflow-wrap: anywhere;
  }
  .warn,
  .hint {
    color: var(--caution);
    margin: 0;
  }
  .warn {
    font-size: var(--fs-caption);
  }
  .hint {
    font-size: var(--fs-micro);
  }
  .notice {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--caution);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.5rem 0.65rem;
  }
  .ok {
    color: var(--zelda-green);
    font-weight: 600;
    margin: 0;
  }
  .err {
    color: var(--danger);
    margin: 0;
    overflow-x: auto;
  }
</style>
