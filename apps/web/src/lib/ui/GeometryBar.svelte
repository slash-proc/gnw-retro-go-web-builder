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
    note = "",
    sizeLabel = "",
    isSelected = undefined,
    selectionTone = "default",
    size = "default",
    onClick,
    onDblClick,
  }: {
    segments: GeoSegment[];
    leftLabel?: string;
    rightLabel?: string;
    title?: string;
    /** Mono sub-label beside the title ("bank 1 · bank 2"). */
    note?: string;
    /** Mono capacity, right-aligned opposite the title ("2 × 256 KB"). */
    sizeLabel?: string;
    /** When given, the bar marks these segments instead of its own click-pin outline. */
    isSelected?: ((s: GeoSegment) => boolean) | undefined;
    /** Erase.dc.html paints a selected segment FILLED destructive red rather than ringing it
     *  in the shared green (survey A, E-3). Only the Erase pane asks for this. */
    selectionTone?: "default" | "destructive";
    /** Bar height/radius. `default` keeps the historical 1.4rem/4px so an un-migrated caller
     *  cannot shift. `tall` is the Advanced panes' 34px/3px bar (Write/Dump/Erase/
     *  FileBrowser.dc.html), which carries in-segment labels. `slim` is Main.dc.html's
     *  Overview bar — 10px/5px, no inter-segment cut and NO labels: 10px cannot hold text,
     *  so the variant suppresses the label spans outright rather than clipping them. */
    size?: "default" | "tall" | "slim";
    onClick?: (s: GeoSegment, e?: MouseEvent | KeyboardEvent) => void;
    onDblClick?: (s: GeoSegment) => void;
  } = $props();

  // The head row the artboards show (name + mono note left, capacity right) replaces the
  // raw-hex left/right legend for callers that supply either.
  const headed = $derived(note !== "" || sizeLabel !== "");

  let hovered = $state<GeoSegment | null>(null);
  // Click a segment to PIN its detail so it persists (and the text can be selected/copied);
  // hover just previews. The detail shows the hovered segment, falling back to the pinned one.
  let pinned = $state<GeoSegment | null>(null);
  const shown = $derived(hovered ?? pinned);
  function togglePin(s: GeoSegment, e: MouseEvent | KeyboardEvent | undefined = undefined) {
    pinned = pinned === s ? null : s;
    if (onClick) onClick(s, e);
  }
</script>

<div class="gbar-wrap">
  {#if headed}
    <div class="ghead">
      <span class="gname">{title}{#if note}<span class="gnote mono">{note}</span>{/if}</span>
      {#if sizeLabel}<span class="gsize mono">{sizeLabel}</span>{/if}
    </div>
  {:else if title}<div class="gtitle mono">{title}</div>{/if}
  <div class="gbar {size}" class:destructive={selectionTone === "destructive"}>
    {#each segments as s, i (i)}
      <div
        class="gseg {s.kind}"
        class:pinned={!isSelected && pinned === s}
        class:sel={isSelected?.(s)}
        aria-pressed={isSelected ? isSelected(s) : undefined}
        style="width:{s.pct}%"
        role="button"
        tabindex="0"
        aria-label={s.label}
        style:background={s.color}
        onmouseenter={() => (hovered = s)}
        onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = s)}
        onblur={() => (hovered = null)}
        onclick={(e) => togglePin(s, e)}
        ondblclick={() => onDblClick?.(s)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePin(s, e);
          }
        }}
      >
        {#if size !== "slim" && s.pct > 7 && s.label}<span>{s.label}</span>{/if}
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
  .ghead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    /* Write/Dump/Erase/FileBrowser.dc.html:81 — the head row and the bar are one
       `flex-direction: column; gap: 8px` stack. */
    margin-bottom: 8px;
  }
  /* Artboard: `font-size: 13px; font-weight: 500` — --fs-btn-sm, not --fs-caption's 14px. */
  .gname {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink);
  }
  .gnote,
  .gsize {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    font-weight: 400;
  }
  .gnote {
    margin-inline-start: 0.4rem;
  }
  .gtitle {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    text-align: start;
    margin-bottom: 0.15rem;
  }
  /* THE FLASH MAP DOES NOT MIRROR. This bar is a picture of an address space: the low address
     is at the left because that is how a memory map is drawn, not because the page reads that
     way. Under `dir="rtl"` a flex row lays its items from the right, which would silently put
     0x90000000 on the right and reverse every partition.
     `row-reverse` under RTL cancels that and restores left-to-right ORDER, while the segments'
     own text keeps inheriting the document's RTL direction, so Arabic labels inside them still
     read correctly. Pinning with `direction: ltr` here would have fixed the order and broken
     the labels. */
  .gbar {
    display: flex;
    width: 100%;
    height: 1.4rem;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--surface-sunk);
    background: var(--surface-sunk);
  }
  /* Survey A, X-1/A34: the Advanced panes draw the bar at 34px with a 3px radius. */
  .gbar.tall {
    height: 34px;
    border-radius: 3px;
    /* The artboard bar is drawn straight on the #e8e8e8 track with no border; with
       box-sizing: border-box the inherited 1px was also stealing 2px of the 34px. */
    border: none;
  }
  /* Main.dc.html:168 — the Overview bar is 10px tall with a 5px radius, drawn straight on the
     --surface-sunk track with no border and no cut between segments. */
  .gbar.slim {
    height: 10px;
    border-radius: 5px;
    border: none;
  }
  .gbar.slim .gseg:not(:last-child) {
    border-inline-end: none;
  }
  .gseg {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: pointer;
    transition: filter 100ms ease;
  }
  /* Survey A, X-2: Write/Dump/Erase/FileBrowser.dc.html cut the bar with the page ground
     itself — `2px solid #f4f4f4` — and only BETWEEN segments, never after the last one. */
  .gseg:not(:last-child) {
    border-inline-end: 2px solid var(--bg);
  }
  .gseg:hover {
    filter: brightness(1.12);
  }
  /* The pinned segment keeps its detail showing below the bar. */
  .gseg.pinned {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  /* Caller-driven selection ring (the artboards' inset 2px green).
     KNOWN GAP, do not "fix" by picking a colour — it needs an owner ruling.
     The ring is --zelda-green and TWO fills are the same colour, so selecting them produces an
     invisible selection:
       .frogfs / .frogfs-changed  = --seg-games = --zelda-green  (tokens.css:76; reachable from
         FileBrowserSection's partition picker and from Flash/DumpSection's ext bar)
       .bank                      = --model-accent, which IS --zelda-green under
         [data-model="zelda"] (tokens.css:332-334) — so every Zelda unit's internal-flash
         bar has the same problem
     Both collide in dark theme too (--zelda-green #4fb163, --seg-games follows it).
     What the boards actually draw, segment fill -> ring:
       Write.dc.html:81              #c9c9cd (grey)  -> #3e9e4e  (green on grey)
       Dump.dc.html:81               #9a9aa0 (grey)  -> #3e9e4e  (green on grey)
       FileBrowser.dc.html:81        #9a9aa0 (grey)  -> #3e9e4e  (green on grey)
       FileBrowserFrogfs.dc.html:81  #3e9e4e (green) -> #1b1b1b  (near-black on green)
       Erase.dc.html:81              selection FILLED #8a241b, not ringed — already built as
         selectionTone="destructive", and --danger collides with no fill here.
     So the green case IS drawn now. But be honest about what that board is:
     FileBrowserFrogfs.dc.html is OURS, drawn 2026-09-08 (ccef13f), and the agent drawing it
     picked near-black precisely BECAUSE it hit this green-on-green invisibility. It is our
     proposed answer recorded in a board, not independent evidence of a pre-existing intent.
     Read together the five boards are arguably consistent on one principle — the ring
     contrasts with the fill it marks — but that is an inference we drew, not a ruling.
     The owner has not decided. Written up as the nineteenth question in docs/BLOCKED-AUDIT.md,
     now a confirm-or-replace question rather than an unanswerable one. */
  .gseg.sel {
    box-shadow: inset 0 0 0 2px var(--zelda-green);
  }
  /* NARROW EXCEPTION to the ruling above — the one case BOTH boards agree on.
     The global "does the ring follow the fill, or is it one colour?" question stays with the
     owner (BLOCKED-AUDIT #19); this only removes the green-on-green invisibility, which no
     board draws: FileBrowserFrogfs.dc.html:81 rings its green FrogFS segment `#1b1b1b`, and
     FileBrowser.dc.html:81 keeps its `#3e9e4e` ring only over a GREY (#9a9aa0) fill. Every
     other segment's ring is byte-identical to before.
     --ink is exactly the board's #1b1b1b in light theme and flips to #ececec in dark
     (tokens.css:10, :256/:295), so this does not repeat the hard-#1b1b1b-invisible-in-dark
     defect. `.bank` under [data-model="zelda"] is the SAME collision via --model-accent, but
     it is conditional on the model and no board draws it — left to the owner ruling.
     Placed BEFORE the destructive rules so those (equal 0,3,0 specificity) still win. */
  .gseg.sel.frogfs,
  .gseg.sel.frogfs-changed {
    box-shadow: inset 0 0 0 2px var(--ink);
  }
  /* Erase.dc.html:81 — `background: #8a241b; box-shadow: inset 0 0 0 2px #8a241b`, i.e. the
     selection is FILLED in --danger, not ringed. The kind-fill rules below are more specific
     than `.gseg.sel`, so the fill needs the same specificity to win. */
  .gbar.destructive .gseg.sel,
  .gbar.destructive .gseg.sel.free {
    background: var(--danger);
    box-shadow: inset 0 0 0 2px var(--danger);
  }
  .gbar.destructive .gseg.sel span {
    color: #fff;
  }
  .gseg:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  /* Survey A, X-6: the artboards set on-fill ink flat, with no shadow. The `#fff` literal
     stays — an on-fill ink token is audit 8.1's still-open gap. */
  /* --seg-saves is a mid silver; white on it is ~2.8:1. The label there takes dark ink
     instead so the fill can stay exactly the artboard's #9a9aa0. */
  .littlefs span,
  .littlefs-changed span {
    color: var(--ink-on-face);
  }
  /* Artboard segment label: `font-size: 11px; font-weight: 600` — --fs-label. */
  .gseg span {
    font-size: var(--fs-label);
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    padding: 0 0.3rem;
  }
  /* partition colors (independent of the model accent) */
  .frogfs {
    background: var(--seg-games);
  }
  /* FrogFS region that the next install will rewrite (new games / removal rewrite) — the
     partition's own solid color underneath, with real semi-transparent diagonal bars over it
     (not just a second opaque shade), so it visually reads as "projected change", not just a
     different flat color. */
  .frogfs-changed {
    background-color: var(--seg-games);
    background-image: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.32),
      rgba(255, 255, 255, 0.32) 6px,
      transparent 6px,
      transparent 12px
    );
  }
  .littlefs {
    background: var(--seg-saves);
  }
  /* LittleFS region that the next install will reset (not migrating saves). Same treatment as
     .frogfs-changed (solid base color + semi-transparent diagonal overlay), over LittleFS's own
     green, so the two "projected change" regions genuinely match each other visually. */
  .littlefs-changed {
    background-color: var(--seg-saves);
    background-image: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.32),
      rgba(255, 255, 255, 0.32) 6px,
      transparent 6px,
      transparent 12px
    );
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
  /* Free space is the bare track (Main.dc.html leaves it unpainted). */
  .bank-empty,
  .free {
    background: var(--seg-free);
  }
  .free span {
    color: var(--ink-soft);
  }
  .glegend {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    margin-top: 0.15rem;
  }
  .gdetail {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.75rem;
    min-height: 1.1rem;
    margin-top: 0.2rem;
    font-size: var(--fs-micro);
    color: var(--ink);
    opacity: 0;
    transition: opacity 100ms ease;
    /* Selectable so pinned addresses/sizes can be copied. */
    user-select: text;
    cursor: text;
  }
  .gdetail.show {
    opacity: 1;
  }

  :global([dir="rtl"]) .gbar {
    flex-direction: row-reverse;
  }
</style>
