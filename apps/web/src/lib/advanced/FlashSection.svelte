<script lang="ts">
  import { device } from "../device.svelte.js";
  import { flashImage } from "../engine/flasher.js";
  import { parseAddr, hex8, commas, BANK_BASE, bankOptions, regionSize, alignFor } from "./addr.js";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import FilePick from "../ui/FilePick.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";

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

  let writing = $state(false);
  let ack = $state(false); // bank-1 acknowledgement checkbox
  let result = $state<"success" | null>(null);

  const BANKS = $derived(bankOptions(locale.t.shared.bankSelect));

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
      ? locale.t.flashSection.planBody(
          bank,
          hex8(base),
          hex8(offBytes || 0),
          file.name,
          commas(file.size),
          hex8(padTarget),
        )
      : "",
  );

  const chipKind = $derived<ChipKind>(
    writing ? "running" : lockedGuard ? "locked" : result ? "success" : "idle",
  );
  const chipText = $derived(
    writing ? locale.t.flashSection.writingChip : lockedGuard ? locale.t.flashSection.lockedChip : "",
  );

  const flashPhases: PhaseDef[] = [{ id: "flash", label: locale.t.flashSection.phaseFlashingImage }];

  async function run(report: PhaseReporter) {
    const off = offBytes || 0;
    const data = new Uint8Array(await file!.arrayBuffer());
    report.start("flash");
    device.suspendPoll();
    try {
      await flashImage(
        (force) => device.ensureStub(undefined, force, true),
        bank,
        off,
        data,
        (d, t) => report.progress("flash", d, t),
        undefined,
        { compress, verify },
      );
    } finally {
      device.resumePoll();
    }
    report.finish("flash");
  }

  function openFlash() {
    void installProgress.run({
      title: locale.t.flashSection.modalTitle,
      body: planBody,
      danger: true,
      confirmText: locale.t.flashSection.modalConfirmText,
      phases: flashPhases,
      exec: async (report) => {
        writing = true;
        onRunning?.(true);
        try {
          await run(report);
          result = "success";
        } finally {
          writing = false;
          onRunning?.(false);
        }
      },
    });
  }
</script>

<AccordionSection id="flash-image" title={locale.t.flashSection.title} {open} running={writing} {chipKind} {chipText} {onToggle}>
  {#if device.scanning}
    <div class="placeholder">{locale.t.flashSection.scanningDevice}</div>
  {:else if !device.utilLoaded}
    <Button variant="action" onclick={() => device.ensureStub()}>{locale.t.flashSection.enterRecoveryMode}</Button>
  {:else}
  <div class="stack">
    <p class="muted">{locale.t.flashSection.intro}</p>

    <div class="field"><span>{locale.t.flashSection.imageFileLabel}</span>
      <FilePick accept=".bin" label={locale.t.flashSection.chooseImage} onpick={(f) => { file = f; result = null; }} />
      {#if file}<span class="meta mono">{file.name} · {commas(file.size)} B</span>{/if}
    </div>

    <div class="grid">
      <label class="field"><span>{locale.t.flashSection.bankLabel}</span>
        <select class="mono" bind:value={bank} onchange={() => (ack = false)}>
          {#each BANKS as b (b.v)}<option value={b.v}>{b.label}</option>{/each}
        </select>
      </label>
      <label class="field"><span>{locale.t.flashSection.offsetLabel}</span>
        <input class="mono" bind:value={offset} placeholder={locale.t.flashSection.offsetPlaceholder} />
      </label>
    </div>

    <!-- Transfer options sub-disclosure (transfer mechanics, allowed here). -->
    <div class="sub">
      <button class="sub-toggle" aria-expanded={optsOpen} onclick={() => (optsOpen = !optsOpen)}>
        <span aria-hidden="true">{optsOpen ? "▾" : "▸"}</span> {locale.t.flashSection.transferOptions}
      </button>
      {#if optsOpen}
        <div class="sub-body">
          <label class="check">
            <input type="checkbox" bind:checked={compress} />
            <span>{locale.t.flashSection.compressLabel} <em>{locale.t.flashSection.compressHint}</em></span>
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={verify} />
            <span>{locale.t.flashSection.verifyLabel} <em>{locale.t.flashSection.verifyHint}</em></span>
          </label>
        </div>
      {/if}
    </div>

    {#if lockedGuard}
      <p class="notice">
        {locale.t.flashSection.lockedNotice}
      </p>
    {/if}

    {#if file}
      <div class="well mono">
        <div>{locale.t.flashSection.planLine(bank, hex8(base), hex8(offBytes || 0), file.name)}</div>
        <div>{locale.t.flashSection.planSizeLine(commas(file.size), commas(padTarget), hex8(padTarget))}</div>
        {#if !aligned}<div class="warn">{locale.t.flashSection.alignWarning(align, bank === 0 ? locale.t.flashSection.extIntWordExt : locale.t.flashSection.extIntWordInt)}</div>{/if}
        {#if overrun}<div class="warn">{locale.t.flashSection.overrunWarning(commas(region))}</div>{/if}
      </div>
    {/if}

    {#if needsAck && file && !lockedGuard}
      <label class="check ack">
        <input type="checkbox" bind:checked={ack} />
        <span>{locale.t.flashSection.ackLabel}</span>
      </label>
    {/if}

    <div>
      <Button variant="action" disabled={!valid} onclick={openFlash}>{locale.t.flashSection.flashImageButton}</Button>
    </div>
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
