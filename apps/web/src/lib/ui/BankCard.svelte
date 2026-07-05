<script module lang="ts">
  import type { Snippet } from "svelte";
  import type { GeoSegment } from "../engine/classify.js";
</script>

<script lang="ts">
  import { locale } from "../i18n/locale.svelte.js";
  // Internal-flash bank visualization — a vertical stacked bar of the bank's occupant
  // segments in a titled card. Originally OverviewTab.svelte's local `bankCard` snippet;
  // extracted so it can be reused as an interactive bank SELECTOR elsewhere (RomSection's
  // Install/Reinstall flow) without duplicating the bar/segment markup. Overview tab keeps
  // its own non-interactive usage (with a boot-button footer) by simply not passing
  // `selectable`/`onSelect`.
  let {
    bankNum,
    segs,
    selectable = false,
    selected = false,
    onSelect,
    hoveredBank = null,
    onSegmentDblClick,
    footer,
  }: {
    bankNum: number;
    segs: GeoSegment[];
    /** When true, the whole card becomes a clickable/keyboard-focusable selector — the
     *  non-selected card dims so the choice reads clearly at a glance. */
    selectable?: boolean;
    selected?: boolean;
    onSelect?: () => void;
    hoveredBank?: number | null;
    onSegmentDblClick?: (s: GeoSegment) => void;
    /** Optional footer content (Overview tab's "Boot Image" button) — omitted entirely when
     *  not provided, e.g. for the RomSection selector use. */
    footer?: Snippet;
  } = $props();
</script>

{#snippet cardBody()}
  <div class="bank-title">{locale.t.roms.bankCard.bankTitle(bankNum)}</div>
  <div class="bank-body">
    <div class="bank-bar">
      {#each segs as s}
        <div
          class="v-seg {s.kind} {hoveredBank === bankNum && s.kind !== 'free' && s.kind !== 'bank-empty' ? 'hovered' : ''}"
          style="height: {s.pct * 2}%;"
          title={s.detail ? s.detail.join('\n') : s.label}
          role="presentation"
          ondblclick={() => onSegmentDblClick?.(s)}
        >
          {#if s.pct * 2 > 15 && s.kind !== 'free' && s.kind !== 'bank-empty'}
            <div class="seg-content">
              <span class="seg-label">{s.label}</span>
              <span class="seg-size">{locale.t.roms.bankCard.kbSuffix(Math.round((s.pct * 2 / 100) * 256))}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="bank-total-label">{locale.t.roms.bankCard.bankTotalLabel}</div>
  </div>
  {#if footer}
    <div class="bank-footer">{@render footer()}</div>
  {/if}
{/snippet}

<!-- Split into two literal branches (rather than one div with conditional role/tabindex) so
     each branch's role/tabindex pairing is statically unambiguous for the a11y checker. -->
{#if selectable}
  <div
    class="bank-card selectable"
    class:selected
    class:unselected={!selected}
    role="button"
    tabindex="0"
    onclick={onSelect}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect?.();
      }
    }}
  >
    {@render cardBody()}
  </div>
{:else}
  <div class="bank-card">
    {@render cardBody()}
  </div>
{/if}

<style>
  /* Matches OverviewTab.svelte's .left-panel/.card-title look (Info/Controls cards) — a plain
     bordered box with a plain-text heading, not a separate background-bar title strip. */
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
  .bank-card.selectable {
    cursor: pointer;
    transition: opacity 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .bank-card.selectable:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
  }
  .bank-card.selected {
    border-color: var(--model-accent);
    box-shadow: 0 0 0 2px var(--model-accent);
  }
  .bank-card.unselected {
    opacity: 0.5;
  }
  .bank-card.unselected:hover {
    opacity: 0.75;
  }
  /* Deliberately a step down from .card-title (Info/Controls/Internal Flash headings) — this
     card usually sits nested under one of those (e.g. OverviewTab's "Internal Flash" group),
     so its own "Bank N" label should read as a sub-label, not compete with it. */
  .bank-title {
    margin: 0;
    font-size: var(--fs-caption);
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
  .bank-total-label {
    font-size: 0.75rem;
    color: var(--ink-soft);
    text-align: center;
    font-weight: 600;
  }
  .bank-footer {
    padding-top: 0.75rem;
    border-top: 1px solid var(--surface-sunk);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .bank-bar {
    width: 80px;
    flex: 1;
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    overflow: hidden;
    background: #e0e0e0;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }
  .seg-content {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    height: 100%;
    padding-bottom: 0.4rem;
  }
  .seg-size {
    font-size: 0.65rem;
    opacity: 0.85;
    margin-top: 0.2rem;
  }
  .v-seg {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
    padding: 0 0.25rem;
    transition: filter 0.2s, outline 0.2s;
  }
  .v-seg.hovered {
    filter: brightness(1.25);
    outline: 2px solid var(--action-red);
    outline-offset: -2px;
    z-index: 1;
  }
  .v-seg.ofw { background: #444; }
  .v-seg.data { background: #888; }
  .v-seg.bank { background: #888; }
  .v-seg.free { background: #e0e0e0; color: transparent; }
  .v-seg.bank-empty { background: #e0e0e0; color: transparent; }
  .v-seg.unreadable { background: #f0f0f0; color: #888; }
</style>
