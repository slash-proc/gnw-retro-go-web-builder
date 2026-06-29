<script lang="ts">
  import { device } from "../device.svelte.js";
  import { flashImage } from "../engine/flasher.js";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments, type GeoSegment } from "../engine/classify.js";
  import { hex, commas } from "./addr.js";

  let {
    open = false,
    onToggle,
    onRunning,
  }: { open?: boolean; onToggle?: (id: string) => void; onRunning?: (r: boolean) => void } = $props();

  let selectedList = $state<GeoSegment[]>([]);

  let modalOpen = $state(false);
  let writing = $state(false);
  let result = $state<"success" | null>(null);

  const EXTBASE = 0x90000000;
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
    writing ? "erasing" : lockedGuard ? "locked" : "",
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

  function withTimeout<T>(
    runFn: (report: (...args: any[]) => void) => Promise<T>,
    timeoutMs: number,
    onProgressUpdate: (...args: any[]) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout>;
      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          reject(new Error("Operation timed out (device may have hung). Please restart the device and try again."));
        }, timeoutMs);
      };

      resetTimeout();
      
      const wrappedReport = (...args: any[]) => {
        resetTimeout();
        onProgressUpdate(...args);
      };
      
      runFn(wrappedReport).then(
        (val) => {
          clearTimeout(timeoutId);
          resolve(val);
        },
        (err) => {
          clearTimeout(timeoutId);
          reject(err);
        }
      );
    });
  }

  async function run(report: (d: number, t: number) => void) {
    if (selectedList.length === 0) return;
    const flasher = await device.ensureStub();
    
    let completed = 0;
    const totalSize = selectedList.reduce((acc, s) => acc + (s.size || 0), 0);

    await withTimeout(
      async (r) => {
        for (const s of selectedList) {
          if (s.offset === undefined || s.size === undefined) continue;
          const targetBank = s.bank ?? 0;
          
          if (targetBank !== 0) {
            // Internal flash operations must be chunked to <= 256K to prevent stub buffer overflow
            // when decompressed on-device.
            const CHUNK_SIZE = 262144;
            const data = new Uint8Array(s.size).fill(0xff);
            for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
              const chunk = data.subarray(offset, offset + CHUNK_SIZE);
              await flashImage(flasher, targetBank, s.offset + offset, chunk, (d) => {
                r(completed + offset + d, totalSize);
              }, undefined, { compress: true, verify: false });
              await new Promise(res => setTimeout(res, 50));
            }
            completed += s.size;
          } else {
            const data = new Uint8Array(s.size).fill(0xff);
            await flashImage(flasher, targetBank, s.offset, data, (d) => {
              r(completed + d, totalSize);
            }, undefined, { compress: true, verify: false });
            completed += s.size;
            await new Promise(res => setTimeout(res, 50));
          }
        }
      },
      30000,
      report
    );
    
    await device.runScan();
  }
</script>

<AccordionSection id="erase-flash" title="Erase flash" {open} running={writing} {chipKind} {chipText} {onToggle}>
  <div class="stack">
    <p class="muted">Click a partition below to select it for erasure. Hold <strong>Ctrl/Cmd</strong> to select multiple partitions.</p>

    <div class="bars">
      {#if intSegs.length > 0}
        <div class="bar-group">
          <GeometryBar 
            segments={intSegs} 
            title="Internal Flash (1 MiB)" 
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
            title="External Flash" 
            leftLabel={hex(EXTBASE)} 
            rightLabel={hex(extEnd)}
            onClick={handleClick}
          />
        </div>
      {/if}
    </div>

    {#if lockedGuard}
      <p class="notice">
        🔒 Internal flash is locked — a locked device rejects writes. Unlocking happens automatically
        during Easy setup&rsquo;s backup step. (External flash stays erasable.)
      </p>
    {/if}

    {#if selectedList.length > 0}
      <div class="selection-box">
        <div class="selection-title">Selected:</div>
        <ul class="selection-list">
          {#each selectedList as s}
            <li>
              <strong>{s.label}</strong> 
              <span class="muted">({commas(s.size || 0)} bytes at {hex((s.bank ?? 0) === 0 ? EXTBASE + (s.offset || 0) : 0x08000000 + (s.bank === 2 ? 0x100000 : 0) + (s.offset || 0))})</span>
            </li>
          {/each}
        </ul>
      </div>
      {#if selectedList.some(s => s.bank === 1 || s.bank === 2) && !lockedGuard}
        <p class="warn-text">
          Warning: Erasing an internal bank may wipe the operating system (stock or Retro-Go)!
        </p>
      {/if}
    {/if}

    <div>
      <Button variant="action" disabled={!valid} onclick={() => (modalOpen = true)}>Erase {selectedList.length > 1 ? "partitions" : "partition"}…</Button>
    </div>
  </div>
</AccordionSection>

<ConfirmModal
  open={modalOpen}
  title={`Erase ${selectedList.length} partition${selectedList.length !== 1 ? 's' : ''}?`}
  body={`This will permanently erase the selected partition${selectedList.length !== 1 ? 's' : ''} by filling them with 0xFF. Any data or firmware on them will be lost.`}
  danger
  confirmText="Erase"
  run={async (report) => {
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
  }}
  onClose={() => (modalOpen = false)}
/>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
