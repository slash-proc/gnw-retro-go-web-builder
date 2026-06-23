<script lang="ts">
  // A horizontal partition/geometry bar with hover detail. Segments come from
  // engine/classify.ts (extflashSegments / intflashSegments). Hovering a segment
  // shows chainloader partition-viewer-style detail below the bar.
  import type { GeoSegment } from "../engine/classify.js";

  let {
    segments,
    leftLabel = "",
    rightLabel = "",
    title = "",
    onClick,
    onDblClick,
  }: { segments: GeoSegment[]; leftLabel?: string; rightLabel?: string; title?: string; onClick?: (s: GeoSegment) => void; onDblClick?: (s: GeoSegment) => void } = $props();

  let hovered = $state<GeoSegment | null>(null);
  // Click a segment to PIN its detail so it persists (and the text can be selected/copied);
  // hover just previews. The detail shows the hovered segment, falling back to the pinned one.
  let pinned = $state<GeoSegment | null>(null);
  const shown = $derived(hovered ?? pinned);
  function togglePin(s: GeoSegment) {
    pinned = pinned === s ? null : s;
    if (onClick) onClick(s);
  }
</script>

<div class="gbar-wrap">
  {#if title}<div class="gtitle mono">{title}</div>{/if}
  <div class="gbar">
    {#each segments as s, i (i)}
      <div
        class="gseg {s.kind}"
        class:pinned={pinned === s}
        style="width:{s.pct}%"
        role="button"
        tabindex="0"
        aria-label={s.label}
        onmouseenter={() => (hovered = s)}
        onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = s)}
        onblur={() => (hovered = null)}
        onclick={() => togglePin(s)}
        ondblclick={() => onDblClick?.(s)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePin(s);
          }
        }}
      >
        {#if s.pct > 7 && s.label}<span>{s.label}</span>{/if}
      </div>
    {/each}
  </div>
  {#if leftLabel || rightLabel}
    <div class="glegend mono"><span>{leftLabel}</span><span>{rightLabel}</span></div>
  {/if}
  <div class="gdetail mono" class:show={!!shown}>
    {#if shown}{#each shown.detail as d, i (i)}<span>{d}</span>{/each}{/if}
  </div>
</div>

<style>
  .gbar-wrap {
    width: 100%;
  }
  .gtitle {
    font-size: var(--fs-micro);
    color: rgba(26, 23, 20, 0.6);
    text-align: left;
    margin-bottom: 0.15rem;
  }
  .gbar {
    display: flex;
    width: 100%;
    height: 1.4rem;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.25);
    background: var(--surface-sunk, #d9cdb4);
  }
  .gseg {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: pointer;
    border-right: 1px solid rgba(0, 0, 0, 0.18);
    transition: filter 100ms ease;
  }
  .gseg:hover,
  .gseg:focus-visible {
    filter: brightness(1.12);
    outline: none;
  }
  /* The pinned segment keeps its detail showing below the bar. */
  .gseg.pinned {
    outline: 2px solid rgba(0, 0, 0, 0.6);
    outline-offset: -2px;
  }
  .gseg span {
    font-size: var(--fs-micro);
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    padding: 0 0.3rem;
  }
  /* partition colors (independent of the model accent) */
  .frogfs {
    background: #c0392b;
  }
  /* FrogFS region that the next install will rewrite (new games / removal rewrite). */
  .frogfs-changed {
    background: repeating-linear-gradient(
      45deg,
      #e8743b,
      #e8743b 6px,
      #f0a06a 6px,
      #f0a06a 12px
    );
  }
  .littlefs {
    background: #2e7d32;
  }
  .fat {
    background: #1565c0;
  }
  .ofw {
    background: #8d6e63;
  }
  .assets {
    background: #6a4ca5;
  }
  .data {
    background: #546e7a;
  }
  .bank {
    background: var(--model-accent, #b0853a);
  }
  .bank-empty,
  .free {
    background: transparent;
  }
  .free span {
    color: rgba(26, 23, 20, 0.45);
    text-shadow: none;
  }
  .glegend {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-micro);
    color: rgba(26, 23, 20, 0.55);
    margin-top: 0.15rem;
  }
  .gdetail {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.75rem;
    min-height: 1.1rem;
    margin-top: 0.2rem;
    font-size: var(--fs-micro);
    color: rgba(26, 23, 20, 0.78);
    opacity: 0;
    transition: opacity 100ms ease;
    /* Selectable so pinned addresses/sizes can be copied. */
    user-select: text;
    cursor: text;
  }
  .gdetail.show {
    opacity: 1;
  }
</style>
