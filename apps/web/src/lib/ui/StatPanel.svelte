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
    /** Marks this row as a trailing aggregate total (e.g. "Total projected size") rather
     *  than a peer category — renders with a divider above and bolder label/value so it
     *  visually reads as "the number the rows above add up to", not just another item in
     *  the same list. */
    total?: boolean;
  }
</script>

<script lang="ts">
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
     *  already-styled container). */
    variant?: "card" | "footer" | "panel-footer" | "bare";
  } = $props();
</script>

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

<style>
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
  /* Restores the pre-unification "bank-footer" look for a fuller partition-detail footer:
     a divider off the bar above it, page background (distinct from the card's own surface),
     and each stat stacked on its own full-width row (label left, value right) — as opposed
     to .footer's single inline caption line, which only fits 1-2 short stats. */
  .stat-panel.panel-footer {
    border-top: 1px solid var(--surface-sunk);
    background: var(--bg);
    padding: 0.75rem 1rem;
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
    text-align: right;
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
