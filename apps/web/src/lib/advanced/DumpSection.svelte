<script lang="ts">
  import { device } from "../device.svelte.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { download, kb } from "../util.js";
  import { parseAddr, hex, hex8, commas, BANK_BASE, bankOptions, regionSize } from "./addr.js";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import Progress from "../ui/Progress.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import { locale } from "../i18n/locale.svelte.js";

  // §A.2 — Dump flash (cancelable read). Real, wired to readFlash via dumpRegion.
  let {
    open = false,
    onToggle,
    onRunning,
  }: { open?: boolean; onToggle?: (id: string) => void; onRunning?: (r: boolean) => void } = $props();

  let bank = $state(0);
  let offset = $state("0x0");
  let length = $state("");

  let dumping = $state(false);
  let canceled = false;
  let done = $state(0);
  let total = $state(0);
  let error = $state<string | null>(null);
  let result = $state<string | null>(null); // success summary
  let canceledChip = $state(false);
  let startedAt = 0;

  const BANKS = $derived(bankOptions(locale.t.shared.bankSelect));

  const extSize = $derived(device.extFlashBytes);
  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, extSize));

  // A locked device can't read internal flash (§3.1 / validation).
  const lockedGuard = $derived(device.locked === true && (bank === 1 || bank === 2));

  // Resolve offset/length; empty length → whole region from offset (§A.2).
  const offBytes = $derived(parseAddr(offset));
  const region = $derived(regionSize(bank, device.extSizeMB));
  const lenBytes = $derived(length.trim() === "" ? Math.max(0, region - (offBytes || 0)) : parseAddr(length));
  const valid = $derived(
    Number.isFinite(offBytes) && offBytes >= 0 && Number.isFinite(lenBytes) && lenBytes > 0 && !lockedGuard,
  );
  const overrun = $derived(valid && (offBytes || 0) + lenBytes > region);
  const base = $derived(BANK_BASE[bank]);
  const filename = $derived(`${device.model}_bank${bank}_${hex(offBytes || 0)}_${hex(lenBytes || 0)}.bin`);

  const chipKind = $derived<ChipKind>(
    dumping ? "running" : lockedGuard ? "locked" : error ? "error" : result ? "success" : "idle",
  );
  const chipText = $derived(
    dumping
      ? locale.t.dumpSection.readingPct(total > 0 ? Math.round((100 * done) / total) : 0)
      : lockedGuard
        ? locale.t.dumpSection.lockedChip
        : canceledChip
          ? locale.t.dumpSection.canceledChip
          : error
            ? locale.t.dumpSection.errorChip
            : ""
  );

  // Quick-fill chips (§A.2). intflash chip is the stock-OFW internal range.
  function fill(off: number, len: number) {
    offset = hex(off);
    length = hex(len);
  }

  function handleGeoClick(s: GeoSegment) {
    if (s.bank !== undefined) bank = s.bank;
    if (s.offset !== undefined) offset = hex(s.offset);
    if (s.size !== undefined) length = hex(s.size);
  }

  // Dumping intflash (bank 1/2) only needs a connection. Dumping extflash (bank 0) needs
  // Recovery Mode (the stub) — if it's not booted yet, the button becomes "Enter Recovery Mode".
  const needsRecovery = $derived(bank === 0 && !device.utilLoaded);

  async function enterRecovery() {
    error = null;
    try {
      await device.ensureStub();
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

<AccordionSection id="dump" title={locale.t.dumpSection.title} {open} running={dumping} {chipKind} {chipText} {onToggle}>
  {#if device.scanning}
    <!-- The bank/offset quick-fills and geometry bars below all read device.banks/partitions,
         which are mid-flight during a scan — mask the section instead of showing a stale or
         half-populated layout. -->
    <div class="placeholder">{locale.t.dumpSection.scanningDevice}</div>
  {:else}
  <div class="stack">
    <p class="muted">{locale.t.dumpSection.intro}</p>

    <div class="bars">
      {#if intSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            segments={intSegs}
            title={locale.t.dumpSection.internalFlashTitle}
            leftLabel={hex(0x08000000)}
            rightLabel={hex(0x08200000)}
            onClick={handleGeoClick}
          />
        </div>
      {/if}

      {#if extSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            segments={extSegs}
            title={locale.t.dumpSection.externalFlashTitle}
            leftLabel={hex(0x90000000)}
            rightLabel={hex(0x90000000 + extSize)}
            onClick={handleGeoClick}
          />
        </div>
      {/if}
    </div>

    <div class="grid">
      <label class="field"><span>{locale.t.dumpSection.bankLabel}</span>
        <select class="mono" bind:value={bank} disabled={dumping}>
          {#each BANKS as b (b.v)}<option value={b.v}>{b.label}</option>{/each}
        </select>
      </label>
      <label class="field"><span>{locale.t.dumpSection.offsetLabel}</span>
        <input class="mono" bind:value={offset} disabled={dumping} placeholder={locale.t.dumpSection.offsetPlaceholder} />
      </label>
      <label class="field"><span>{locale.t.dumpSection.lengthLabel}</span>
        <input class="mono" bind:value={length} disabled={dumping} placeholder={locale.t.dumpSection.lengthPlaceholder} />
      </label>
    </div>

    <div class="chips">
      <button class="qf" disabled={dumping} onclick={() => fill(0, region)}>{locale.t.dumpSection.quickFillWholeRegion}</button>
      <button class="qf" disabled={dumping} onclick={() => fill(offBytes || 0, 128 * 1024)}>{locale.t.dumpSection.quickFill128Kib}</button>
      <button class="qf" disabled={dumping} onclick={() => fill(offBytes || 0, 1024 * 1024)}>{locale.t.dumpSection.quickFill1Mib}</button>
      <button class="qf" disabled={dumping} onclick={() => fill(0, 0x20000)}>{locale.t.dumpSection.quickFillStockOfw}</button>
    </div>

    {#if lockedGuard}
      <p class="notice">
        {locale.t.dumpSection.lockedNotice}
      </p>
    {:else if length.trim() === ""}
      <p class="muted small">{locale.t.dumpSection.lengthBlankHint}</p>
    {/if}

    <div class="well mono">
      <div>{locale.t.dumpSection.planLine(hex8(base + (offBytes || 0)), hex8(base + (offBytes || 0) + (lenBytes || 0)))}</div>
      <div>{locale.t.dumpSection.planBytesLine(commas(lenBytes || 0), filename)}</div>
      {#if overrun}<div class="warn">{locale.t.dumpSection.overrunWarning(commas(region - (offBytes || 0)))}</div>{/if}
    </div>

    {#if !dumping}
      <div>
        {#if needsRecovery}
          <Button variant="action" onclick={enterRecovery}>{locale.t.dumpSection.enterRecoveryMode}</Button>
        {:else}
          <Button variant="action" disabled={!valid} onclick={dump}>{locale.t.dumpSection.dumpToFile}</Button>
          {#if !valid && !lockedGuard}<span class="hint">{locale.t.dumpSection.invalidHint}</span>{/if}
        {/if}
      </div>
    {:else}
      <Progress value={done} max={total} label={locale.t.dumpSection.progressLabel(String(kb(done)), String(kb(total)))} />
      <div><Button onclick={() => (canceled = true)}>{locale.t.dumpSection.cancel}</Button></div>
      <p class="muted small">{locale.t.dumpSection.cancelHint}</p>
    {/if}

    {#if result}<p class="ok">{result}</p>{/if}
    {#if error}<p class="err mono">{error}</p>{/if}
  </div>
  {/if}
</AccordionSection>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
  .grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1.6fr 1fr 1fr;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 0.25rem;
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
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: var(--fs-caption);
  }
  input,
  select {
    font: inherit;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .qf {
    font: inherit;
    font-size: var(--fs-micro);
    color: var(--ink);
    background: var(--surface-sunk);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
    cursor: pointer;
  }
  .qf:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .well {
    background: var(--surface-sunk);
    border-radius: 0;
    padding: 0.55rem 0.7rem;
    font-size: var(--fs-micro);
    color: var(--ink);
    overflow-x: auto;
    white-space: nowrap;
  }
  .well > div {
    line-height: 1.5;
  }
  .warn,
  .hint {
    color: var(--caution);
  }
  .hint {
    font-size: var(--fs-micro);
    margin-left: 0.6rem;
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
