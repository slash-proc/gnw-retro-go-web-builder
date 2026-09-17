<script lang="ts">
  import { device } from "../device.svelte.js";
  import { flashImage } from "../engine/flasher.js";
  import Button from "../ui/Button.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import {
    hex, hex8, commas, parseAddr, EXTBASE, BANK_BASE, bankForAddr, regionSize, alignFor,
    INT_BAR_NOTE, INT_BAR_SIZE, EXT_BAR_NOTE, extBarSize,
  } from "./addr.js";
  import RangeField from "./RangeField.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { msg } from "../logEntry.js";
  import { dbgLog } from "../debug.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { formatSize } from "../util.js";
  import PaneFooter from "./PaneFooter.svelte";

  let { onRunning }: { onRunning?: (r: boolean) => void } = $props();

  let selectedList = $state<GeoSegment[]>([]);

  let writing = $state(false);
  let result = $state<"success" | null>(null);

  const extSize = $derived(device.extFlashBytes);
  
  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, extSize));

  // --- Custom range (artboard: "Custom range…") -------------------------------------------
  // A typed range becomes an ordinary selection entry, so the confirm modal, the locked
  // guard and the erase loop below treat it exactly like a scanned partition. Its bank is
  // derived from the absolute address by the same helper the Write/Dump fields use, and it
  // must be erase-block aligned and fit inside that bank.
  let customOpen = $state(false);
  let customStart = $state(hex8(EXTBASE));
  let customSize = $state("");

  const cStart = $derived(parseAddr(customStart));
  const cBank = $derived(bankForAddr(cStart, device.extSizeMB));
  const cSize = $derived(parseAddr(customSize));
  const cOffset = $derived(cBank >= 0 ? cStart - BANK_BASE[cBank] : NaN);
  const customValid = $derived(
    cBank >= 0 &&
      Number.isFinite(cOffset) &&
      cOffset >= 0 &&
      cOffset % alignFor(cBank) === 0 &&
      Number.isFinite(cSize) &&
      cSize > 0 &&
      cSize % alignFor(cBank) === 0 &&
      cOffset + cSize <= regionSize(cBank, device.extSizeMB),
  );

  const customSeg = $derived<GeoSegment | null>(
    customOpen && customValid
      ? { pct: 0, kind: "data", label: hex8(cStart), bank: cBank as 0 | 1 | 2, offset: cOffset, size: cSize, detail: [] }
      : null,
  );
  // What the confirm modal and the erase loop actually operate on: the clicked partitions
  // plus the typed range, once it is complete and valid. The fields stay the source of truth.
  const selection = $derived(customSeg ? [...selectedList, customSeg] : selectedList);


  const lockedGuard = $derived(device.locked === true && selection.some((s) => s.bank === 1 || s.bank === 2));

  // Footer summary (Erase.dc.html: "6.22 MB will be erased. This cannot be undone."). The
  // byte count is device-derived, so it is interpolated, not translated. With nothing
  // selected no artboard gives a line — render none rather than invent one.
  const eraseBytes = $derived(selection.reduce((n, s) => n + (s.size || 0), 0));
  const valid = $derived(selection.length > 0 && !lockedGuard);


  function handleClick(s: GeoSegment, e: MouseEvent | KeyboardEvent | undefined = undefined) {
    if (s.kind === "free" || s.kind === "bank-empty") return;

    if (e && ('ctrlKey' in e) && (e.ctrlKey || e.metaKey)) {
      if (selectedList.includes(s)) {
        selectedList = selectedList.filter(x => x !== s);
      } else {
        selectedList = [...selectedList, s];
      }
    } else {
      selectedList = [s];
    }
  }

  function eraseSubstepId(s: GeoSegment, i: number): string {
    return `seg-${i}`;
  }

  function erasePhases(list: GeoSegment[]): PhaseDef[] {
    return [
      {
        id: "erase",
        label: locale.t.eraseSection.phaseErase,
        substeps: list.map((s, i) => ({
          id: eraseSubstepId(s, i),
          label: s.label || locale.t.eraseSection.partitionAtFallback(hex(BANK_BASE[s.bank ?? 0] + (s.offset || 0))),
        })),
      },
      { id: "rescan", label: locale.t.eraseSection.phaseRescan },
    ];
  }

  async function run(report: PhaseReporter) {
    // Automatic unlock: a locked device is unlocked before this write, never after it
    // (engine/unlockGate.ts owns the backup-first ordering). No-op when already unlocked.
    await device.ensureUnlocked();
    const list = selection;
    if (list.length === 0) return;
    await device.ensureStub();

    report.start("erase");
    device.suspendPoll();
    try {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.offset === undefined || s.size === undefined) continue;
        const targetBank = s.bank ?? 0;
        const substepId = eraseSubstepId(s, i);
        report.subStart("erase", substepId);
        report.log(
          "erase",
          msg(
            (t) => t.eraseSection.erasingLog,
            s.label || msg((t) => t.eraseSection.partitionFallback),
            commas(s.size),
            hex(BANK_BASE[targetBank] + s.offset),
          ),
          substepId,
        );

        if (targetBank !== 0) {
          // Internal flash operations must be chunked to <= 256K to prevent stub buffer overflow
          // when decompressed on-device.
          const CHUNK_SIZE = 262144;
          const data = new Uint8Array(s.size).fill(0xff);
          for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
            const chunk = data.subarray(offset, offset + CHUNK_SIZE);
            await flashImage((force) => device.ensureStub(undefined, force, true), targetBank, s.offset + offset, chunk, (d) => {
              report.progress("erase", offset + d, data.length, substepId, "bytes");
            }, dbgLog("erase", (line) => report.log("erase", line, substepId)), { compress: true, verify: false, abortSignal: report.signal });
            await new Promise(res => setTimeout(res, 50));
          }
        } else {
          const data = new Uint8Array(s.size).fill(0xff);
          await flashImage((force) => device.ensureStub(undefined, force, true), targetBank, s.offset, data, (d) => {
            report.progress("erase", d, s.size!, substepId, "bytes");
          }, dbgLog("erase", (line) => report.log("erase", line, substepId)), { compress: true, verify: false, abortSignal: report.signal });
          await new Promise(res => setTimeout(res, 50));
        }
        report.subFinish("erase", substepId);
      }
    } finally {
      device.resumePoll();
    }
    report.finish("erase");

    report.start("rescan");
    report.log("rescan", msg((t) => t.eraseSection.rescanningLog));
    await device.runScan("after erase");
    report.finish("rescan");
  }

  function openErase() {
    void installProgress.run({
      title: locale.t.eraseSection.modalTitle(selection.length, selection.length !== 1),
      body: locale.t.eraseSection.modalBody(selection.length !== 1),
      danger: true,
      confirmText: locale.t.eraseSection.modalConfirmText,
      phases: erasePhases(selection),
      exec: async (report) => {
        writing = true;
        onRunning?.(true);
        try {
          await run(report);
          result = "success";
        } finally {
          writing = false;
          onRunning?.(false);
          selectedList = [];
          customOpen = false;
          customSize = "";
        }
      },
    });
  }
</script>

  {#if device.scanning}
    <div class="placeholder">{locale.t.eraseSection.scanningDevice}</div>
  {:else if !device.utilLoaded}
    <Button variant="action" onclick={() => void device.startRecoveryMode()}>{locale.t.eraseSection.enterRecoveryMode}</Button>
  {:else}
  <div class="stack">
    <div class="bars">
      {#if intSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            size="tall"
            segments={intSegs}
            title={locale.t.eraseSection.internalFlashTitle}
            note={INT_BAR_NOTE}
            sizeLabel={INT_BAR_SIZE}
            isSelected={(s) => selectedList.includes(s)}
            selectionTone="destructive"
            onClick={handleClick}
          />
        </div>
      {/if}

      {#if extSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            size="tall"
            segments={extSegs}
            title={locale.t.eraseSection.externalFlashTitle}
            note={EXT_BAR_NOTE}
            sizeLabel={extBarSize(device.extSizeMB)}
            isSelected={(s) => selectedList.includes(s)}
            selectionTone="destructive"
            onClick={handleClick}
          />
        </div>
      {/if}
    </div>

    <p class="muted small barhint">{locale.t.eraseSection.barHint}</p>

    {#if lockedGuard}
      <p class="notice">
        {locale.t.eraseSection.lockedNotice}
      </p>
    {/if}

    {#if selection.length > 0}
      <div class="selection-box">
        <div class="selection-title">{locale.t.eraseSection.selectedTitle}</div>
        <ul class="selection-list">
          {#each selection as s}
            <li class="selection-row">
              <span class="sname">{s.label}</span>
              <span class="svalue mono">{locale.t.eraseSection.selectedSizeAt(commas(s.size || 0), hex(BANK_BASE[s.bank ?? 0] + (s.offset || 0)))}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="caution-row">
      {#if selection.some((s) => s.bank === 1 || s.bank === 2) && !lockedGuard}
        <p class="warn-text">{locale.t.eraseSection.bankWipeWarning}</p>
      {:else}
        <span></span>
      {/if}
      <button class="linkish" aria-expanded={customOpen} onclick={() => (customOpen = !customOpen)}>
        {locale.t.eraseSection.customRange}
      </button>
    </div>

    {#if customOpen}
      <div class="custom">
        <RangeField label={locale.t.dumpSection.offsetLabel} bind:value={customStart} />
        <RangeField label={locale.t.dumpSection.lengthLabel} bind:value={customSize} />
      </div>
    {/if}

    <PaneFooter summary={selection.length > 0 ? locale.t.eraseSection.footerSummary(formatSize(eraseBytes)) : undefined}>
      <Button variant="destructive" disabled={!valid} onclick={openErase}>{locale.t.eraseSection.eraseButton(selection.length, selection.length > 1)}</Button>
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
  .bars {
    display: flex;
    flex-direction: column;
    gap: 18px;
    color: var(--ink);
  }
  .small {
    font-size: var(--fs-micro);
  }
  /* Write/Dump/Erase.dc.html — the bar hint is `font-size: 13px; color: #5c5c5c;
     margin-top: -8px`, i.e. 13px (not the 12px `.small`) and pulled 8px toward the bars. */
  .barhint {
    font-size: var(--fs-btn-sm);
    margin-top: -8px;
  }
  /* Erase.dc.html:85 — `align-items: center; justify-content: space-between; gap: 16px`. */
  .caution-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  /* Erase.dc.html:87 — 13px/600 in the quiet grey, not the green action ink. */
  .linkish {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    background: none;
    border: none;
    padding: 0;
    color: var(--ink-soft);
    cursor: pointer;
    white-space: nowrap;
  }
  .linkish:hover {
    text-decoration: underline;
  }
  .custom {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .bar-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  /* Erase.dc.html:83 — an uppercase caption on the page ground, then the rows on a
     white surface (`border-radius: 6px; padding: 2px 16px`) ruled by `1px solid #ededed`. */
  .selection-box {
    display: flex;
    flex-direction: column;
    color: var(--ink);
  }
  .selection-title {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    color: var(--ink-soft);
    text-transform: uppercase;
  }
  .selection-list {
    margin: 0;
    /* 2px 16px on the surface plus the artboard's 6px inner top pad. */
    padding: 8px 16px 2px;
    list-style: none;
    background: var(--surface);
    border-radius: var(--r-card);
  }
  .selection-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
  }
  .sname {
    font-size: var(--fs-caption);
    font-weight: 600;
  }
  /* 13px: the artboards' small mono value size; no 13px type token exists. */
  .svalue {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    text-align: end;
  }
  .mono {
    font-family: var(--font-mono);
  }
  /* Erase.dc.html:86 — `font-size: 13px; color: #5c5c5c; border-left: 2px solid #b8860b;
     padding-inline-start: 12px`. Only the rule is gold; the sentence itself is the quiet grey. */
  .warn-text {
    color: var(--ink-soft);
    font-size: var(--fs-btn-sm);
    margin: 0;
    border-inline-start: 2px solid var(--caution);
    padding-inline-start: 12px;
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
