<script module lang="ts">
  // The ONE shared "label — bold value" stat-row box. Previously reimplemented three times
  // under three unrelated names for the same visual idea: OverviewTab.svelte's
  // .bank-footer/.ext-fs-single/.fs-stat-row (External Flash partition detail),
  // RomManagementTab.svelte's .sd-summary/.sd-stat/.sd-label/.sd-val/.sd-delta (SD used/
  // projected space), and ChangeSummary's .summary/.row/.label/.status/.detail (pre-install
  // change summary). All three now render through this one component.
  export interface StatRow {
    label: string;
    value: string;
    /** Colors the value text itself (was ChangeSummary's `kind`). */
    tone?: "ok" | "warn" | "muted" | "info";
    /** A separate colored addendum appended after the value, e.g. "(+2.10 MiB)" (was
     *  RomManagementTab's .sd-delta up/down annotation). Distinct from `tone` because a row
     *  can have a plain value with a colored delta suffix at the same time. */
    delta?: { text: string; direction: "up" | "down" };
    /** Secondary subtext line under the row (was ChangeSummary's `detail`). */
    detail?: string;
    /** A short caution note rendered inline beside the LABEL (not the value) — the
     *  approved LibrarySummary artboard's `BIOS  needs a file` row. Only the "grid"
     *  variant renders it; nothing else asks for it. */
    note?: string;
    /** Marks this row as a trailing aggregate total (e.g. "Total projected size") rather
     *  than a peer category — renders with a divider above and bolder label/value so it
     *  visually reads as "the number the rows above add up to", not just another item in
     *  the same list. */
    total?: boolean;
  }
</script>

<script lang="ts">
  import { locale } from "../i18n/locale.svelte.js";
  let {
    rows,
    heading,
    variant = "card",
  }: {
    rows: StatRow[];
    /** Optional heading above the rows (was OverviewTab's .fs-stat-name). */
    heading?: string;
    /** "card": full border + rounded box (standalone use, e.g. the SD summary card or a
     *  boxed ChangeSummary). "footer": a light single-line caption under a bar (the ROMs
     *  tab's InstallGeometry footer — just Capacity/Free, meant to read as a fraction of the
     *  bar's own weight). "panel-footer": the fuller boxed footer for a partition detail with
     *  several stacked stats (OverviewTab's External Flash panel) — border-top divider,
     *  page background, one stat per row. "bare": no box chrome at all (nested inside another
     *  already-styled container). "grid": the three-column install-summary table
     *  (name / After / Change) used by the Library tab's Summary drawer — a genuinely
     *  different shape from the two-column label→value row, so it gets its own variant
     *  rather than bending one of the four above. `value` is the "After" cell and `delta`
     *  is the "Change" cell; either renders a dim em dash when empty. "defs": the
     *  DEFINITION-LIST shape SourcesHomebrewConfig/SourcesCoreConfig draw for a
     *  Release panel — a fixed label column with the value left-aligned beside it in plain
     *  (non-bold, wrapping) ink, rather than a bold right-aligned figure. Same rows, same
     *  component; only the two columns' alignment and weight differ. */
    variant?: "card" | "footer" | "panel-footer" | "bare" | "grid" | "defs";
  } = $props();

  /** Split a delta string like "+2 −1" into its signed tokens so each can be colored by
   *  its own sign (additions green, removals red). No maths — the text is built upstream. */
  function deltaParts(text: string): string[] {
    return text.split(/\s+/).filter(Boolean);
  }
</script>

{#if variant === "grid"}
  <div class="stat-grid">
    <div class="sg-head">
      <span class="sg-name"></span>
      <span class="sg-num">{locale.t.roms.summary.colAfter}</span>
      <span class="sg-num change">{locale.t.roms.summary.colChange}</span>
    </div>
    {#each rows as r (r.label)}
      <div class="sg-row" class:total={r.total}>
        <span class="sg-name">{r.label}{#if r.note}<span class="sg-note">{r.note}</span>{/if}</span>
        <span class="sg-num" class:dash={r.value === "—"}>{r.value}</span>
        <span class="sg-num change">
          {#if r.delta}
            {#each deltaParts(r.delta.text) as p, i (p + i)}
              <span class={p.startsWith("+") ? "add" : "rem"}>{p}</span>{" "}
            {/each}
          {:else}
            <span class="dash">—</span>
          {/if}
        </span>
        {#if r.detail}<span class="sg-detail">{r.detail}</span>{/if}
      </div>
    {/each}
  </div>
{:else}
<div class="stat-panel {variant}">
  {#if heading}<div class="stat-heading">{heading}</div>{/if}
  {#each rows as r (r.label)}
    <div class="stat-row-wrap" class:total={r.total}>
      <div class="stat-row">
        <span class="stat-label">{r.label}</span>
        <span class="stat-value {r.tone ?? ''}"
          >{r.value}{#if r.delta}<span class="stat-delta {r.delta.direction}"> ({r.delta.text})</span>{/if}</span
        >
      </div>
      {#if r.detail}<div class="stat-detail">{r.detail}</div>{/if}
    </div>
  {/each}
</div>
{/if}

<style>
  /* "grid" variant — three columns: name, After, Change. Numeric columns are right-aligned
     tabular monospace so figures line up down the column. */
  /* Audit S1.4. LibrarySummary.dc.html caps the table at `width: 560px; margin: 0 auto`
     so a label stays tied to its figure instead of stretching the full drawer width, and
     gives every row a `1px solid #ededed` rule (= --rule, a rule inside a white surface).
     max-width keeps it from overflowing a narrower drawer. */
  .stat-grid {
    display: flex;
    flex-direction: column;
    width: 560px;
    max-width: 100%;
    margin: 0 auto;
  }
  .sg-head,
  .sg-row {
    display: grid;
    /* Artboard: minmax(0, 1fr) 86px 104px. */
    grid-template-columns: minmax(0, 1fr) 86px 104px;
    align-items: baseline;
    gap: 0.75rem;
  }
  .sg-head {
    font-size: var(--fs-label);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--ink-dim);
    padding: 0 0 7px;
  }
  /* Every row carries the artboard's rule; the trailing total swaps it for its own
     heavier border-top below. */
  .sg-row {
    border-bottom: 1px solid var(--rule);
    padding: 9px 0;
  }
  .sg-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sg-note {
    margin-inline-start: 0.55rem;
    font-size: var(--fs-micro);
    font-weight: 600;
    color: var(--caution);
  }
  /* Artboard: the "After" figure is 14px/600, the "Change" cell 13px. */
  .sg-num {
    text-align: end;
    font-size: 14px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    white-space: nowrap;
  }
  .sg-head .sg-num {
    font-family: inherit;
    font-size: var(--fs-label);
  }
  .sg-num.change {
    font-size: var(--fs-btn-sm);
  }
  .sg-num .add {
    color: var(--zelda-green);
  }
  .sg-num .rem {
    color: var(--danger);
  }
  .dash {
    color: var(--ink-faint);
  }
  /* Artboard: `border-top: 1px solid #d8d8d8; margin-top: 3px; padding: 11px 0 2px` and
     no bottom rule — the total closes the table rather than being another row in it. */
  .sg-row.total {
    border-top: 1px solid var(--hairline);
    border-bottom: none;
    margin-top: 3px;
    padding: 11px 0 2px;
  }
  .sg-row.total .sg-name,
  .sg-row.total .sg-num {
    font-weight: 700;
  }
  .sg-detail {
    grid-column: 1 / -1;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .stat-panel {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem 1rem;
  }
  .stat-panel.card {
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-control);
    background: var(--surface);
  }
  /* Deliberately as light as this component gets: this variant sits directly under a
     GeometryBar as a plain caption line (InstallGeometry.svelte, OverviewTab.svelte's
     External Flash panel) — a fraction of the bar's own visual weight, not a second panel.
     Rows run inline side-by-side rather than stacked, the heading is folded into the same
     line instead of standing on its own, and everything is muted rather than bold-on-ink.
     The detailed change/projection story (what's added/removed, total projected size)
     belongs in the summary further down — never duplicated here. */
  .stat-panel.footer {
    border-top: none;
    background: none;
    padding: 0.2rem 0.75rem 0;
    flex-direction: row;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .stat-panel.footer .stat-heading {
    font-size: var(--fs-micro);
    font-weight: 400;
    color: var(--ink-soft);
  }
  .stat-panel.footer .stat-row-wrap {
    display: contents;
  }
  .stat-panel.footer .stat-row {
    font-size: var(--fs-micro);
    gap: 0.3rem;
  }
  .stat-panel.footer .stat-label::after {
    content: ":";
  }
  .stat-panel.footer .stat-label,
  .stat-panel.footer .stat-value {
    color: var(--ink-soft);
    font-weight: 400;
  }
  .stat-panel.footer .stat-detail {
    display: none; /* not used by this variant — keep it a single caption line */
  }
  .stat-panel.bare {
    padding: 0;
  }
  /* SourcesHomebrewConfig.dc.html's Release grid: `148px minmax(0, 1fr)`, `gap: 10px 20px`,
     baseline-aligned, both cells 13px — the label grey, the value plain ink. The values here
     are manifest prose ("PC Engine, PC Engine CD"), not figures, so they wrap and are not
     tabular. Padding is the panel's own, supplied by the caller's box. */
  .stat-panel.defs {
    padding: 0;
    gap: 10px;
  }
  .stat-panel.defs .stat-row {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr);
    gap: 20px;
  }
  .stat-panel.defs .stat-value {
    font-weight: 400;
    text-align: start;
    white-space: normal;
    font-variant-numeric: normal;
    overflow-wrap: anywhere;
  }
  /* Restores the pre-unification "bank-footer" look for a fuller partition-detail footer:
     a divider off the bar above it, page background (distinct from the card's own surface),
     and each stat stacked on its own full-width row (label left, value right) — as opposed
     to .footer's single inline caption line, which only fits 1-2 short stats. */
  /* A38: its one consumer (OverviewTab's External flash section) no longer sits inside a
     card, so the footer no longer insets itself off a card edge. Main.dc.html:186 draws this
     row as `padding-top: 12px; border-top: 1px solid #d8d8d8` on the page ground — no
     background fill and no horizontal padding, so the row's label lines up with the section
     label above it. */
  .stat-panel.panel-footer {
    border-top: 1px solid var(--hairline);
    padding: 12px 0 0;
  }
  .stat-heading {
    font-weight: 600;
    color: var(--ink);
  }
  .stat-row-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .stat-row-wrap.total {
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--hairline);
  }
  .stat-row-wrap.total .stat-label {
    font-weight: 600;
    color: var(--ink);
  }
  .stat-row-wrap.total .stat-value {
    font-size: var(--fs-body, 1rem);
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    font-size: var(--fs-caption);
  }
  .stat-label {
    color: var(--ink-soft);
  }
  .stat-value {
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-align: end;
  }
  .stat-value.ok {
    color: var(--zelda-green);
  }
  .stat-value.warn {
    color: var(--caution);
  }
  .stat-value.muted {
    color: var(--ink-soft);
  }
  .stat-value.info {
    color: var(--ink);
  }
  .stat-delta {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-micro);
  }
  .stat-delta.up {
    color: var(--caution);
  }
  .stat-delta.down {
    color: var(--zelda-green);
  }
  .stat-detail {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
</style>
