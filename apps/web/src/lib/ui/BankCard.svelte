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
    variant = undefined,
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
    /** `full` is the five bank artboards' Overview card (head row
     *  + 54x124 bar + occupant block). `target` is Firmware.dc.html:123-141's stripped install
     *  target: a 34x84 bar with the bank name and one caption BESIDE it, no capacity row and
     *  no occupant block. Defaults to `target` when `selectable` (the bank picker is the only
     *  selectable use, and it is exactly that artboard) and `full` otherwise, so neither
     *  existing call site has to change. */
    variant?: "full" | "target" | undefined;
  } = $props();

  const kind = $derived(variant ?? (selectable ? "target" : "full"));

  // Artboard state: the bank running Retro-Go is drawn in the success green (card border +
  // bar fill) — Main/NoStockBank1/NoStockBank2.dc.html; an OFW bank stays neutral. The
  // occupant name comes from intflashscan's classify() ("Retro-Go"), carried on the bank
  // segment's label.
  const isRetro = (s: GeoSegment) => s.kind === "bank" && /retro-go/i.test(s.label);
  let occupied = $derived(segs.some(isRetro));
  // The segments that name something actually resident in the bank — the free/empty track
  // is the bar's background, not an occupant.
  let occupants = $derived(segs.filter((s) => s.kind !== "free" && s.kind !== "bank-empty"));
  // BothEmpty/NoStockBank1/NoStockBank2.dc.html: a bank with nothing resident in it takes the
  // empty treatment — a dashed frame, a page-ground track with no segment children, a dimmed
  // title (survey A, A48/A49) and the `Empty` / `—` occupant block (A50).
  let empty = $derived(occupants.length === 0);
</script>

{#snippet cardBody()}
  <!-- Main/StockUnpatched/NoStockBank1/NoStockBank2/BothEmpty.dc.html: the head row is the
       bank name on the left and the bank's total capacity, mono, hard right on the same
       baseline — not a title alone with the capacity captioned under the bar. -->
  <div class="bank-head">
    <span class="bank-title" class:empty>{locale.t.roms.bankCard.bankTitle(bankNum)}</span>
    <span class="bank-total">{locale.t.roms.bankCard.bankTotalLabel}</span>
  </div>
  <div class="bank-body">
    <div class="bank-bar" class:empty>
      {#each empty ? [] : segs as s}
        <div
          class="v-seg {s.kind} {isRetro(s) ? 'retro' : ''} {hoveredBank === bankNum && s.kind !== 'free' && s.kind !== 'bank-empty' ? 'hovered' : ''}"
          style="height: {s.pct * 2}%;"
          title={s.detail ? s.detail.join('\n') : s.label}
          role="presentation"
          ondblclick={() => onSegmentDblClick?.(s)}
        ></div>
      {/each}
    </div>
  </div>
  <!-- The occupant's name and size sit BELOW the bar as a two-line block (name 13/500 ink,
       size mono 12 --ink-soft), not as white-on-fill text inside the segment. The artboards
       draw one occupant per bank; the loop is the honest generalisation for a bank the scan
       resolves into more than one. An empty bank keeps the same two-line block, both lines in
       --silver-edge: BothEmpty.dc.html's `Empty` over an em dash (survey A, A50). Drawing
       nothing there read as broken rather than as empty. The dash is a typographic
       placeholder, not copy, so it stays literal. -->
  {#if empty}
    <div class="occupant">
      <span class="occ-name dim">{locale.t.roms.bankCard.empty}</span>
      <span class="occ-size dim">—</span>
    </div>
  {/if}
  {#each occupants as s}
    <div class="occupant">
      <span class="occ-name">{s.label}</span>
      <span class="occ-size">{locale.t.roms.bankCard.kbSuffix(Math.round((s.pct * 2 / 100) * 256))}</span>
    </div>
  {/each}
  {#if footer}
    <div class="bank-footer">{@render footer()}</div>
  {/if}
{/snippet}

{#snippet targetBody()}
  <!-- Firmware.dc.html:124 — a 34x84 --surface-sunk track, 3px radius, filled from the top
       by the bank's own occupant segments (50% grey for stock, 97% green for Retro-Go on the
       artboard; here the real scan drives it). -->
  <div class="target-bar">
    {#each empty ? [] : segs as s}
      <div
        class="v-seg {s.kind} {isRetro(s) ? 'retro' : ''}"
        style="height: {s.pct * 2}%;"
        title={s.detail ? s.detail.join('\n') : s.label}
        role="presentation"
        ondblclick={() => onSegmentDblClick?.(s)}
      ></div>
    {/each}
  </div>
  <!-- `gap: 3px`, name 13/600, caption 12 --ink-soft. The caption is the caller's `footer`
       snippet (`Replaces stock` / `Dual boot`), which already carries exactly that type. -->
  <div class="target-text">
    <span class="bank-title">{locale.t.roms.bankCard.bankTitle(bankNum)}</span>
    {#if footer}{@render footer()}{/if}
  </div>
{/snippet}

<!-- Split into two literal branches (rather than one div with conditional role/tabindex) so
     each branch's role/tabindex pairing is statically unambiguous for the a11y checker. -->
{#if selectable}
  <div
    class="bank-card selectable"
    class:target={kind === "target"}
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
    {#if kind === "target"}{@render targetBody()}{:else}{@render cardBody()}{/if}
  </div>
{:else}
  <div class="bank-card" class:target={kind === "target"} class:occupied class:empty>
    {#if kind === "target"}{@render targetBody()}{:else}{@render cardBody()}{/if}
  </div>
{/if}

<style>
  /* A bank IS a real object, so the card keeps its border (the redesign's container rule) —
     a structural region edge, hence --hairline on a white surface. */
  .bank-card {
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    background: var(--surface);
    padding: 18px;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  /* Main/NoStockBank1/NoStockBank2.dc.html give the Retro-Go bank `border: 1px solid #3e9e4e`.
     Only the non-interactive (Overview) card: the selector's border is its selection state. */
  .bank-card.occupied {
    border-color: var(--zelda-green);
  }
  /* BothEmpty.dc.html: `border: 1px dashed #d8d8d8` on a bank holding nothing. */
  .bank-card.empty {
    border-style: dashed;
  }
  .bank-card.selectable {
    cursor: pointer;
    transition: opacity 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  /* Audit S0.5 / S5.13: choosing a target bank is navigation, not a statement about the
     device model, so the selection edge must not follow --model-accent (which would render
     it Mario-scarlet on a Mario device). Firmware.dc.html's target picker draws the chosen
     bank at `border: 1px solid #3e9e4e` = --zelda-green, the same edge Main.dc.html gives
     the occupied bank. The 2px ring is kept as the selection affordance; only its hue moves. */
  .bank-card.selectable:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
  }
  .bank-card.selected {
    border-color: var(--zelda-green);
    box-shadow: 0 0 0 2px var(--zelda-green);
  }
  .bank-card.unselected {
    opacity: 0.5;
  }
  .bank-card.unselected:hover {
    opacity: 0.75;
  }
  /* --- target variant (Firmware.dc.html:123-141) ---------------------------------
     `padding: 16px; display: flex; align-items: center; gap: 16px` — a horizontal card, so
     the column layout and its 14px gap are both overridden. */
  .bank-card.target {
    flex-direction: row;
    align-items: center;
    gap: 16px;
    padding: 16px;
  }
  /* The artboard draws both target cards at full opacity and marks the chosen one with the
     green border alone — no dimming of the other and no 2px outer ring. */
  .bank-card.target.selected {
    box-shadow: none;
  }
  .bank-card.target.unselected {
    opacity: 1;
  }
  .target-bar {
    width: 34px;
    height: 84px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-radius: 3px;
    overflow: hidden;
    background: var(--surface-sunk);
  }
  .target-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .bank-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  /* 13px/600 in full ink — the artboards read this as the card's name, not as a small-caps
     section label (that treatment belongs to the "Internal flash" heading above the grid). */
  .bank-title {
    margin: 0;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink);
  }
  /* BothEmpty.dc.html dims the name of an empty bank to #9a9aa0 = --silver-edge. */
  .bank-title.empty {
    color: var(--silver-edge);
  }
  .bank-total {
    font-size: var(--fs-micro);
    font-family: var(--font-mono);
    color: var(--ink-soft);
  }
  .bank-body {
    display: flex;
    justify-content: center;
  }
  .occupant {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .occ-name {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .occ-size {
    font-size: var(--fs-micro);
    font-family: var(--font-mono);
    color: var(--ink-soft);
  }
  /* BothEmpty.dc.html dims both lines of the empty occupant block to #9a9aa0, matching the
     bank name above it. */
  .occ-name.dim,
  .occ-size.dim {
    color: var(--silver-edge);
  }
  /* No rule here: the five bank artboards are a plain flex column (gap 14px) with the action
     row at `padding-top: 2px` — no divider above it. */
  .bank-footer {
    padding-top: 2px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* 54 x 124, `border-radius: 3px`, no border, --surface-sunk track — every bank artboard. */
  .bank-bar {
    width: 54px;
    height: 124px;
    display: flex;
    flex-direction: column;
    border-radius: 3px;
    overflow: hidden;
    /* A hovered segment lifts over its neighbours so its outline is not overdrawn by the
       next segment. That is ordering within this bar only, so it is contained here rather
       than competing with the app's scale (tokens.css, --z-raised). */
    isolation: isolate;
    background: var(--surface-sunk);
  }
  /* An empty bank's track drops to the page ground so the dashed card reads as a hole. */
  .bank-bar.empty {
    background: var(--bg);
  }
  .v-seg {
    overflow: hidden;
    transition: filter 0.2s, outline 0.2s;
  }
  .v-seg.hovered {
    filter: brightness(1.25);
    outline: 2px solid var(--action-red);
    outline-offset: -2px;
    z-index: var(--z-raised);
  }
  /* The artboards use one neutral occupant fill (#9a9aa0 = --silver-edge) over an
     --surface-sunk track; the Retro-Go occupant is the success green. */
  .v-seg.ofw { background: var(--silver-edge); }
  .v-seg.data { background: var(--silver-edge); }
  .v-seg.bank { background: var(--silver-edge); }
  .v-seg.bank.retro { background: var(--zelda-green); }
  .v-seg.free { background: var(--surface-sunk); }
  .v-seg.bank-empty { background: var(--surface-sunk); }
  .v-seg.unreadable { background: var(--surface-sunk); }
</style>
