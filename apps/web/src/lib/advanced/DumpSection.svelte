<script lang="ts">
  import { device } from "../device.svelte.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { download, kb } from "../util.js";
  import { parseAddr, hex, hex8, commas, BANK_BASE, BANKS, regionSize } from "./addr.js";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import Progress from "../ui/Progress.svelte";

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
      ? `reading ${total > 0 ? Math.round((100 * done) / total) : 0}%`
      : lockedGuard
        ? "locked"
        : canceledChip
          ? "canceled"
          : error
            ? "error"
            : result
              ? "✓ done"
              : "idle",
  );

  // Quick-fill chips (§A.2). intflash chip is the stock-OFW internal range.
  function fill(off: number, len: number) {
    offset = hex(off);
    length = hex(len);
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
      result = `${(data.length / (1 << 20)).toFixed(1)} MiB read in ${secs} s`;
    } catch (e) {
      if (canceled) canceledChip = true;
      else error = e instanceof Error ? e.message : String(e);
    } finally {
      dumping = false;
      onRunning?.(false);
    }
  }
</script>

<AccordionSection id="dump" title="Dump flash" {open} running={dumping} {chipKind} {chipText} {onToggle}>
  <div class="stack">
    <p class="muted">Read any region of any bank to a downloaded file. You can cancel mid-read.</p>

    <div class="grid">
      <label class="field"><span>Bank</span>
        <select class="mono" bind:value={bank} disabled={dumping}>
          {#each BANKS as b (b.v)}<option value={b.v}>{b.label}</option>{/each}
        </select>
      </label>
      <label class="field"><span>Offset</span>
        <input class="mono" bind:value={offset} disabled={dumping} placeholder="0x0" />
      </label>
      <label class="field"><span>Length</span>
        <input class="mono" bind:value={length} disabled={dumping} placeholder="whole region" />
      </label>
    </div>

    <div class="chips">
      <button class="qf" disabled={dumping} onclick={() => fill(0, region)}>Whole region</button>
      <button class="qf" disabled={dumping} onclick={() => fill(offBytes || 0, 128 * 1024)}>128 KiB</button>
      <button class="qf" disabled={dumping} onclick={() => fill(offBytes || 0, 1024 * 1024)}>1 MiB</button>
      <button class="qf" disabled={dumping} onclick={() => fill(0, 0x20000)}>Stock OFW intflash (0–0x20000)</button>
    </div>

    {#if lockedGuard}
      <p class="notice">
        🔒 Internal flash is unreadable while the device is locked — unlocking happens automatically
        during Easy setup&rsquo;s backup step. (Bank 0 / external stays readable.)
      </p>
    {:else if length.trim() === ""}
      <p class="muted small">Length blank = whole region from offset.</p>
    {/if}

    <div class="well mono">
      <div>Plan: {hex8(base + (offBytes || 0))} → {hex8(base + (offBytes || 0) + (lenBytes || 0))}</div>
      <div>{commas(lenBytes || 0)} bytes → {filename}</div>
      {#if overrun}<div class="warn">Length exceeds region; will clamp to {commas(region - (offBytes || 0))} bytes.</div>{/if}
    </div>

    {#if !dumping}
      <div>
        <Button variant="action" disabled={!valid} onclick={dump}>Dump to file</Button>
        {#if !valid && !lockedGuard}<span class="hint">Enter a valid offset and length.</span>{/if}
      </div>
    {:else}
      <Progress value={done} max={total} label={`${kb(done)} / ${kb(total)} KB`} />
      <div><Button onclick={() => (canceled = true)}>Cancel</Button></div>
      <p class="muted small">A read is non-destructive — cancel discards the partial dump (no file).</p>
    {/if}

    {#if result}<p class="ok">{result}</p>{/if}
    {#if error}<p class="err mono">{error}</p>{/if}
  </div>
</AccordionSection>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
