<script lang="ts">
  import { device } from "../device.svelte.js";
  import { flashImage } from "../engine/flasher.js";
  import { parseAddr, hex8, commas, BANK_BASE, BANKS, regionSize, alignFor } from "./addr.js";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import FilePick from "../ui/FilePick.svelte";

  // §A.3 — Flash image (blocking write). Real, wired to flash via flashImage.
  let {
    open = false,
    onToggle,
    onRunning,
  }: { open?: boolean; onToggle?: (id: string) => void; onRunning?: (r: boolean) => void } = $props();

  let file = $state<File | null>(null);
  let bank = $state(1);
  let offset = $state("0x0");
  let optsOpen = $state(false);
  let compress = $state(true);
  let verify = $state(true);

  let modalOpen = $state(false);
  let writing = $state(false);
  let ack = $state(false); // bank-1 acknowledgement checkbox
  let result = $state<"success" | null>(null);

  const offBytes = $derived(parseAddr(offset));
  const align = $derived(alignFor(bank));
  const region = $derived(regionSize(bank, device.extSizeMB));
  const base = $derived(BANK_BASE[bank]);
  const lockedGuard = $derived(device.locked === true && (bank === 1 || bank === 2));

  // Image is padded to the bank's block size for the write plan readout.
  const padTarget = $derived(file ? Math.ceil(file.size / align) * align : 0);
  const aligned = $derived(Number.isFinite(offBytes) && offBytes >= 0 && offBytes % align === 0);
  const overrun = $derived(!!file && (offBytes || 0) + padTarget > region);
  // bank-1 (stock-side) writes raise friction: an extra ack checkbox (§A.3).
  const needsAck = $derived(bank === 1);
  const valid = $derived(!!file && aligned && !overrun && !lockedGuard && (!needsAck || ack));

  const planBody = $derived(
    file
      ? `Plan: bank${bank} (${hex8(base)}) + ${hex8(offBytes || 0)} ← ${file.name} ` +
        `(${commas(file.size)} B, padded → ${hex8(padTarget)}). ` +
        `Don't unplug your device until it finishes.`
      : "",
  );

  const chipKind = $derived<ChipKind>(
    writing ? "running" : lockedGuard ? "locked" : result ? "success" : "idle",
  );
  const chipText = $derived(
    writing ? "writing" : lockedGuard ? "locked" : "",
  );

  async function run(report: (d: number, t: number) => void) {
    const off = offBytes || 0;
    const data = new Uint8Array(await file!.arrayBuffer());
    const flasher = await device.ensureStub();
    await flashImage(flasher, bank, off, data, report, undefined, { compress, verify });
  }
</script>

<AccordionSection id="flash-image" title="Flash image" {open} running={writing} {chipKind} {chipText} {onToggle}>
  <div class="stack">
    <p class="muted">Write an arbitrary image to any bank/offset. You confirm before it writes.</p>

    <div class="field"><span>Image file</span>
      <FilePick accept=".bin" label="Choose image" onpick={(f) => { file = f; result = null; }} />
      {#if file}<span class="meta mono">{file.name} · {commas(file.size)} B</span>{/if}
    </div>

    <div class="grid">
      <label class="field"><span>Bank</span>
        <select class="mono" bind:value={bank} onchange={() => (ack = false)}>
          {#each BANKS as b (b.v)}<option value={b.v}>{b.label}</option>{/each}
        </select>
      </label>
      <label class="field"><span>Offset</span>
        <input class="mono" bind:value={offset} placeholder="0x0" />
      </label>
    </div>

    <!-- Transfer options sub-disclosure (transfer mechanics, allowed here). -->
    <div class="sub">
      <button class="sub-toggle" aria-expanded={optsOpen} onclick={() => (optsOpen = !optsOpen)}>
        <span aria-hidden="true">{optsOpen ? "▾" : "▸"}</span> Transfer options
      </button>
      {#if optsOpen}
        <div class="sub-body">
          <label class="check">
            <input type="checkbox" bind:checked={compress} />
            <span>LZMA compress <em>(faster transfer; device decompresses; auto-skips if it doesn&rsquo;t help)</em></span>
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={verify} />
            <span>Verify writes <em>(read back each buffer to catch probe corruption; slower)</em></span>
          </label>
        </div>
      {/if}
    </div>

    {#if lockedGuard}
      <p class="notice">
        🔒 Internal flash is locked — a locked device rejects writes. Unlocking happens automatically
        during Easy setup&rsquo;s backup step. (Bank 0 / external stays writable.)
      </p>
    {/if}

    {#if file}
      <div class="well mono">
        <div>Plan: bank{bank} ({hex8(base)}) + {hex8(offBytes || 0)} ← {file.name}</div>
        <div>{commas(file.size)} B → padded {commas(padTarget)} B ({hex8(padTarget)})</div>
        {#if !aligned}<div class="warn">Offset must be a multiple of {align} ({bank === 0 ? "ext" : "int"}flash alignment).</div>{/if}
        {#if overrun}<div class="warn">Image overruns the {commas(region)} B region.</div>{/if}
      </div>
    {/if}

    {#if needsAck && file && !lockedGuard}
      <label class="check ack">
        <input type="checkbox" bind:checked={ack} />
        <span>I understand this overwrites the firmware bank; I have a backup.</span>
      </label>
    {/if}

    <div>
      <Button variant="action" disabled={!valid} onclick={() => (modalOpen = true)}>Flash image…</Button>
    </div>
  </div>
</AccordionSection>

<ConfirmModal
  open={modalOpen}
  title="Flash this image?"
  body={planBody}
  danger
  confirmText="Flash"
  run={async (report) => {
    writing = true;
    onRunning?.(true);
    try {
      await run(report);
      result = "success";
    } finally {
      writing = false;
      onRunning?.(false);
    }
  }}
  onClose={() => (modalOpen = false)}
/>

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
  .grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1.6fr 1fr;
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
  .meta {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
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
  .sub {
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
  }
  .sub-toggle {
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    background: var(--surface-sunk);
    color: var(--ink);
    border: none;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
  }
  .sub-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    font-size: var(--fs-caption);
  }
  .check em {
    color: var(--ink-soft);
    font-style: normal;
    font-size: var(--fs-micro);
  }
  .ack {
    color: var(--caution);
    font-weight: 600;
  }
  .well {
    background: var(--surface-sunk);
    border-radius: 0;
    padding: 0.55rem 0.7rem;
    font-size: var(--fs-micro);
    overflow-x: auto;
    white-space: nowrap;
  }
  .well > div {
    line-height: 1.5;
  }
  .warn {
    color: var(--caution);
  }
  .notice {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--caution);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.5rem 0.65rem;
  }
</style>
