<script lang="ts">
  import { device } from "../device.svelte.js";
  import { flashImage } from "../engine/flasher.js";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import { hex, commas, EXTBASE, BANK_BASE } from "./addr.js";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";

  let {
    open = false,
    onToggle,
    onRunning,
  }: { open?: boolean; onToggle?: (id: string) => void; onRunning?: (r: boolean) => void } = $props();

  let selectedList = $state<GeoSegment[]>([]);

  let writing = $state(false);
  let result = $state<"success" | null>(null);

  const extSize = $derived(device.extFlashBytes);
  const extEnd = $derived(EXTBASE + extSize);
  
  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, extSize));

  const lockedGuard = $derived(device.locked === true && selectedList.some(s => s.bank === 1 || s.bank === 2));
  const valid = $derived(selectedList.length > 0 && !lockedGuard);

  const chipKind = $derived<ChipKind>(
    writing ? "running" : lockedGuard ? "locked" : result ? "success" : "idle",
  );
  const chipText = $derived(
    writing ? locale.t.eraseSection.erasingChip : lockedGuard ? locale.t.eraseSection.lockedChip : "",
  );

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
    if (selectedList.length === 0) return;
    await device.ensureStub();

    report.start("erase");
    device.suspendPoll();
    try {
      for (let i = 0; i < selectedList.length; i++) {
        const s = selectedList[i];
        if (s.offset === undefined || s.size === undefined) continue;
        const targetBank = s.bank ?? 0;
        const substepId = eraseSubstepId(s, i);
        report.subStart("erase", substepId);
        report.log(
          "erase",
          locale.t.eraseSection.erasingLog(
            s.label || locale.t.eraseSection.partitionFallback,
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
              report.progress("erase", offset + d, data.length, undefined, substepId);
            }, undefined, { compress: true, verify: false });
            await new Promise(res => setTimeout(res, 50));
          }
        } else {
          const data = new Uint8Array(s.size).fill(0xff);
          await flashImage((force) => device.ensureStub(undefined, force, true), targetBank, s.offset, data, (d) => {
            report.progress("erase", d, s.size!, undefined, substepId);
          }, undefined, { compress: true, verify: false });
          await new Promise(res => setTimeout(res, 50));
        }
        report.subFinish("erase", substepId);
      }
    } finally {
      device.resumePoll();
    }
    report.finish("erase");

    report.start("rescan");
    report.log("rescan", locale.t.eraseSection.rescanningLog);
    await device.runScan();
    report.finish("rescan");
  }

  function openErase() {
    void installProgress.run({
      title: locale.t.eraseSection.modalTitle(selectedList.length, selectedList.length !== 1),
      body: locale.t.eraseSection.modalBody(selectedList.length !== 1),
      danger: true,
      confirmText: locale.t.eraseSection.modalConfirmText,
      phases: erasePhases(selectedList),
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
        }
      },
    });
  }
</script>

<AccordionSection id="erase-flash" title={locale.t.eraseSection.title} {open} running={writing} {chipKind} {chipText} {onToggle}>
  {#if device.scanning}
    <div class="placeholder">{locale.t.eraseSection.scanningDevice}</div>
  {:else if !device.utilLoaded}
    <Button variant="action" onclick={() => device.ensureStub()}>{locale.t.eraseSection.enterRecoveryMode}</Button>
  {:else}
  <div class="stack">
    <p class="muted">{locale.t.eraseSection.intro}</p>

    <div class="bars">
      {#if intSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            segments={intSegs}
            title={locale.t.eraseSection.internalFlashTitle}
            leftLabel={hex(0x08000000)}
            rightLabel={hex(0x08200000)}
            onClick={handleClick}
          />
        </div>
      {/if}

      {#if extSegs.length > 0}
        <div class="bar-group">
          <GeometryBar
            segments={extSegs}
            title={locale.t.eraseSection.externalFlashTitle}
            leftLabel={hex(EXTBASE)}
            rightLabel={hex(extEnd)}
            onClick={handleClick}
          />
        </div>
      {/if}
    </div>

    {#if lockedGuard}
      <p class="notice">
        {locale.t.eraseSection.lockedNotice}
      </p>
    {/if}

    {#if selectedList.length > 0}
      <div class="selection-box">
        <div class="selection-title">{locale.t.eraseSection.selectedTitle}</div>
        <ul class="selection-list">
          {#each selectedList as s}
            <li>
              <strong>{s.label}</strong>
              <span class="muted">{locale.t.eraseSection.selectedSizeAt(commas(s.size || 0), hex(BANK_BASE[s.bank ?? 0] + (s.offset || 0)))}</span>
            </li>
          {/each}
        </ul>
      </div>
      {#if selectedList.some(s => s.bank === 1 || s.bank === 2) && !lockedGuard}
        <p class="warn-text">
          {locale.t.eraseSection.bankWipeWarning}
        </p>
      {/if}
    {/if}

    <div>
      <Button variant="action" disabled={!valid} onclick={openErase}>{locale.t.eraseSection.eraseButton(selectedList.length > 1)}</Button>
    </div>
  </div>
  {/if}
</AccordionSection>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
    gap: 1.5rem;
    padding: 1rem;
    background: var(--surface-sunk);
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    color: var(--ink);
  }
  .bar-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .selection-box {
    background: var(--surface-sunk);
    padding: 0.75rem 1rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    font-size: var(--fs-body);
    color: var(--ink);
  }
  .selection-title {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }
  .selection-list {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .warn-text {
    color: var(--caution);
    font-weight: 600;
    font-size: var(--fs-caption);
    margin: 0;
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
