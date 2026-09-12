<script lang="ts">
  import { device } from "../device.svelte.js";
  import { flashImage } from "../engine/flasher.js";
  import {
    parseAddr, hex8, commas, BANK_BASE, bankForAddr, regionSize, alignFor,
    INT_BAR_NOTE, INT_BAR_SIZE, EXT_BAR_NOTE, extBarSize, destLabel,
  } from "./addr.js";
  import Button from "../ui/Button.svelte";
  import RangeField from "./RangeField.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { formatSize } from "../util.js";
  import { locale } from "../i18n/locale.svelte.js";
  import PaneFooter from "./PaneFooter.svelte";

  // §A.3 — Flash image (blocking write). Real, wired to flash via flashImage.
  let { onRunning }: { onRunning?: (r: boolean) => void } = $props();

  let file = $state<File | null>(null);
  // Absolute destination address; the bank is derived from it (the artboard's Start field
  // reads 0x08100000). Defaults to bank 2, the side that is not the stock OS.
  let start = $state(hex8(BANK_BASE[2]));
  let compress = $state(true);
  let verify = $state(true);

  let writing = $state(false);
  let ack = $state(false); // bank-1 acknowledgement checkbox
  let result = $state<"success" | null>(null);

  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, device.extFlashBytes));

  const startAddr = $derived(parseAddr(start));
  const bank = $derived(bankForAddr(startAddr, device.extSizeMB));
  const inRange = $derived(bank >= 0);
  const offBytes = $derived(inRange ? startAddr - BANK_BASE[bank] : NaN);
  const align = $derived(alignFor(inRange ? bank : 1));
  const region = $derived(inRange ? regionSize(bank, device.extSizeMB) : 0);
  const base = $derived(inRange ? BANK_BASE[bank] : 0);
  const lockedGuard = $derived(device.locked === true && (bank === 1 || bank === 2));

  // Image is padded to the bank's block size for the write plan readout.
  const padTarget = $derived(file ? Math.ceil(file.size / align) * align : 0);
  const aligned = $derived(inRange && Number.isFinite(offBytes) && offBytes >= 0 && offBytes % align === 0);
  const overrun = $derived(!!file && (offBytes || 0) + padTarget > region);
  // bank-1 (stock-side) writes raise friction: an extra ack checkbox (§A.3).
  const needsAck = $derived(bank === 1);
  const valid = $derived(!!file && inRange && aligned && !overrun && !lockedGuard && (!needsAck || ack));

  // Click-to-fill: a bar segment writes its ABSOLUTE start address into the Start field and
  // nothing else — the segment's own offset/bank, straight from the device scan
  // (engine/classify.ts over device.banks / device.partitions). Every check above still runs
  // on the value it wrote (bank derivation, alignment, overrun, lock, the bank-1 ack).
  let filled = $state<GeoSegment | null>(null);
  function handleGeoClick(s: GeoSegment) {
    if (s.bank === undefined || s.offset === undefined) return;
    start = hex8(BANK_BASE[s.bank] + s.offset);
    filled = s;
    ack = false;
  }

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


  // Write.dc.html:94 — the `Overwrites` row: what currently occupies the destination range.
  // Derived from the same device scan the geometry bars are drawn from, so it is device
  // truth, not a guess: for external flash, every non-free scanned partition the padded
  // write range intersects; for an internal bank, that bank's classified occupant
  // (`intflashscan`'s `type`, plus its Retro-Go version when one was found — the artboard's
  // `Retro-Go v1.4.1-44`). Read-only: nothing here feeds `valid`/`overrun`/`aligned`.
  const overwrites = $derived.by(() => {
    if (!file || !inRange) return "";
    const from = offBytes || 0;
    const to = from + padTarget;
    if (bank === 0) {
      const names = extSegs
        .filter(
          (s) =>
            s.kind !== "free" &&
            s.offset !== undefined &&
            s.size !== undefined &&
            s.offset < to &&
            s.offset + s.size > from,
        )
        .map((s) => s.label)
        .filter((l) => l !== "");
      const uniq = [...new Set(names)];
      return uniq.length > 0 ? uniq.join(" · ") : locale.t.shared.geometry.freeSpace;
    }
    const b = device.banks.find((x) => x.index === bank);
    if (!b || b.dataSize === 0) return locale.t.shared.geometry.empty;
    return b.retroGoVersion ? `${b.type} ${b.retroGoVersion}` : b.type;
  });
  // Gold only when something real is lost; plain ink when the range is free/empty.
  const overwritesLoss = $derived(
    overwrites !== "" &&
      overwrites !== locale.t.shared.geometry.freeSpace &&
      overwrites !== locale.t.shared.geometry.empty,
  );

  const flashPhases: PhaseDef[] = [{ id: "flash", label: locale.t.flashSection.phaseFlashingImage }];

  async function run(report: PhaseReporter) {
    // Automatic unlock: a locked device is unlocked before this write, never after it
    // (engine/unlockGate.ts owns the backup-first ordering). No-op when already unlocked.
    await device.ensureUnlocked();
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

  {#if device.scanning}
    <div class="placeholder">{locale.t.flashSection.scanningDevice}</div>
  {:else if !device.utilLoaded}
    <Button variant="action" onclick={() => device.ensureStub()}>{locale.t.flashSection.enterRecoveryMode}</Button>
  {:else}
  <div class="stack">
    <div class="bars">
      {#if intSegs.length > 0}
        <GeometryBar
          size="tall"
          segments={intSegs}
          title={locale.t.flashSection.internalFlashTitle}
          note={INT_BAR_NOTE}
          sizeLabel={INT_BAR_SIZE}
          isSelected={(s) => s === filled}
          onClick={handleGeoClick}
        />
      {/if}
      {#if extSegs.length > 0}
        <GeometryBar
          size="tall"
          segments={extSegs}
          title={locale.t.flashSection.externalFlashTitle}
          note={EXT_BAR_NOTE}
          sizeLabel={extBarSize(device.extSizeMB)}
          isSelected={(s) => s === filled}
          onClick={handleGeoClick}
        />
      {/if}
    </div>

    <p class="muted small barhint">{locale.t.flashSection.barHint}</p>

    <!-- Write.dc.html:83-86 — `Image file` (flex 1.6) and `Start` (flex 1.4) share one
         bottom-aligned row below the bars and the hint. -->
    <div class="fieldrow">
      <!-- Write.dc.html:84 — a 40px bordered field showing the chosen filename in mono, not a
           button + caption. The native input stays (focusable, keyboard-operable); it is
           visually hidden inside the label, which takes the focus ring. -->
      <label class="field img">
        <span>{locale.t.flashSection.imageFileLabel}</span>
        <span class="filefield">
          <input
            class="sr"
            type="file"
            accept=".bin"
            onchange={(e) => { file = e.currentTarget.files?.[0] ?? null; result = null; }}
          />
          <span class="fname mono" class:placeholder={!file}>{file ? file.name : locale.t.flashSection.chooseImage}</span>
        </span>
      </label>
      <div class="startfield">
        <RangeField label={locale.t.flashSection.offsetLabel} bind:value={start} placeholder={locale.t.flashSection.offsetPlaceholder} />
      </div>
    </div>

    {#if file}
      <!-- Write.dc.html:87-88 — the pad readout is a standalone mono caption under the
           field row, not a line inside the plan block. -->
      <p class="padcap mono">{locale.t.flashSection.padCaption(formatSize(file.size), hex8(padTarget), formatSize(padTarget))}</p>
    {/if}

    <!-- Write.dc.html:89-92 — both options sit bare on the page ground, no disclosure. -->
    <div class="opts">
      <label class="check">
        <input type="checkbox" bind:checked={compress} />
        <span>{locale.t.flashSection.compressLabel}</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={verify} />
        <span class:off={!verify}>{locale.t.flashSection.verifyLabel}</span>
      </label>
    </div>

    {#if lockedGuard}
      <p class="notice">
        {locale.t.flashSection.lockedNotice}
      </p>
    {/if}

    <!-- Write.dc.html:93-94 — a white PLAN block of three label/value rows. -->
    {#if file}
      <div class="plan">
        <div class="plancap">{locale.t.flashSection.planCaption}</div>
        <div class="planrows">
          <div class="planrow">
            <span class="pl">{locale.t.flashSection.writesRow}</span>
            <span class="pv mono">{locale.t.flashSection.bytesValue(commas(padTarget))}</span>
          </div>
          <div class="planrow">
            <span class="pl">{locale.t.flashSection.destinationRow}</span>
            <span class="pv mono">{destLabel(bank, hex8(base + (offBytes || 0)))}</span>
          </div>
          <div class="planrow">
            <span class="pl">{locale.t.flashSection.overwritesRow}</span>
            <span class="pv mono" class:loss={overwritesLoss}>{overwrites}</span>
          </div>
        </div>
      </div>
      {#if !aligned}<p class="warn">{locale.t.flashSection.alignWarning(align, bank === 0 ? locale.t.flashSection.extIntWordExt : locale.t.flashSection.extIntWordInt)}</p>{/if}
      {#if overrun}<p class="warn">{locale.t.flashSection.overrunWarning(commas(region))}</p>{/if}
    {/if}

    {#if needsAck && file && !lockedGuard}
      <label class="check ack">
        <input type="checkbox" bind:checked={ack} />
        <span>{locale.t.flashSection.ackLabel}</span>
      </label>
    {/if}

    <PaneFooter summary={locale.t.flashSection.footerSummary}>
      <Button variant="action" disabled={!valid} onclick={openFlash}>{locale.t.flashSection.flashImageButton}</Button>
    </PaneFooter>
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
  .fieldrow {
    display: flex;
    align-items: flex-end;
    gap: 16px;
  }
  .fieldrow .img {
    flex: 1.6;
    min-width: 0;
  }
  .startfield {
    flex: 1.4;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  /* Write/Dump/Erase.dc.html — the bar hint is `font-size: 13px; color: #5c5c5c;
     margin-top: -8px`, i.e. 13px (not the 12px `.small`) and pulled 8px toward the bars. */
  .barhint {
    font-size: var(--fs-btn-sm);
    margin-top: -8px;
  }
  .small {
    font-size: var(--fs-micro);
  }
  @media (max-width: 560px) {
    .fieldrow {
      flex-direction: column;
      align-items: stretch;
    }
  }
  /* Write.dc.html:85 / Dump.dc.html:84-85 — the field label is `13px/500/#5c5c5c`
     and sits 8px above its control. */
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--fs-caption);
  }
  .field > span:first-child {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  /* Write.dc.html:87 — 12px mono, quiet grey, tucked under the field row. */
  .padcap {
    margin: -14px 0 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .mono {
    font-family: var(--font-mono);
  }
  /* Write.dc.html:89 — the two options ride one row on the page ground, `gap: 26px`. */
  .opts {
    display: flex;
    gap: 26px;
    flex-wrap: wrap;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: var(--fs-caption);
  }
  /* Write.dc.html:91 — an unchecked option's label is the quiet grey. */
  .check .off {
    color: var(--ink-soft);
  }
  /* Write.dc.html:96-97 — the acknowledgement is plain 14px ink, not gold/600. */
  .ack {
    font-size: var(--fs-caption);
  }
  /* Write.dc.html:93 — `#ffffff`, `border-radius: 6px`, `padding: 18px 20px`, under an
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
  }
  /* Write.dc.html:94 — the Overwrites value carries the caution gold when the range is
     actually occupied. */
  .pv.loss {
    color: var(--caution);
  }
  /* Write.dc.html:84 — 40px, white, 1px --hairline, 2px radius, mono value inset 12px. */
  .filefield {
    height: 40px;
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    padding: 0 12px;
    cursor: pointer;
    min-width: 0;
    box-sizing: border-box;
  }
  .filefield:focus-within {
    outline: 2px solid var(--zelda-green);
    outline-offset: 1px;
  }
  .fname {
    font-size: var(--fs-caption);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fname.placeholder {
    color: var(--ink-soft);
  }
  /* Visually hidden but still focusable/keyboard-operable. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .warn {
    margin: 0;
    font-size: var(--fs-caption);
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
