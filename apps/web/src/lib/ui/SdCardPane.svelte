<script lang="ts">
  /**
   * The SD card's page: what is on the card, in relation to Retro-Go.
   *
   * docs/design/proposals/sd-source/, where `CardSizeBar` is the chosen board. ONE page drawn in
   * each state it can be in, not an overview and a card page: an earlier pass split those and the
   * owner cut the split.
   *
   * TWO NUMBERS WITH DIFFERENT PROVENANCE, AND THE PAGE HAS TO KEEP THEM APART. Used is MEASURED,
   * every file's size read by the walk. Free is INFERRED from a capacity the USER STATED, because
   * no browser API reports a picked directory's volume (docs/SDCARD_CAPACITY.md). The page says
   * which is which by STRUCTURE rather than by a sentence: stated values are controls and carry a
   * chevron, measured ones are plain text. That is the whole disclaimer.
   *
   * PURE PROPS, NO STORE. Everything arrives as a prop and every action leaves as a callback, so
   * the page renders in a test with no browser, no card and no reactive graph. The stores are
   * wired in Sources.svelte, which is also where the `dbg()` flush hazard would live if any of
   * this logged (it does not).
   *
   * TWO PRIMITIVES REUSED RATHER THAN REINVENTED, both after an earlier pass hand-rolled them:
   *   - the bar is `GeometryBar size="slim"`, the same call `DetailsPane` makes for External
   *     flash, which is the card the board copies. The nine bucket fills ride in on
   *     `GeoSegment.color` so this page's palette stays in `tokens.css` instead of adding nine
   *     rules to a primitive every Advanced pane shares.
   *   - `Contents` is `CachePane`'s row table (`.panel` > `.row` > name/count/size, closed by
   *     `.row.total`), because the owner asked for the Cache view's shape by name. It carries no
   *     `.act` column: Cache rows have a Clear action and these have nothing to act on, since
   *     this page reads a card it must never modify, and a column existing only to match another
   *     page's grid is what UI_VOICE rules out.
   * The `Card` block stays a definition list: Folder and Capacity are label-and-value pairs,
   * which is the thing a `<dl>` is for. Only Contents is a table.
   */
  import { locale } from "../i18n/locale.svelte.js";
  import { formatSize } from "../util.js";
  import GeometryBar from "./GeometryBar.svelte";
  import type { GeoSegment } from "../engine/classify.js";
  import {
    SD_CATEGORIES,
    sortedCategories,
    cardDisplayName,
    MAX_ENTRIES,
    type SdCategory,
    type SdStorageState,
  } from "../sdStorage.svelte.js";
  import {
    SD_NOMINAL_SIZES_GB,
    usableBytesFor,
    sizeFitsUsed,
    sdBarSegments,
    type StatedCard,
  } from "../sdCapacity.js";

  let {
    state,
    stated,
    onChoose,
    onRescan,
    onState,
  }: {
    state: SdStorageState;
    stated: StatedCard | null;
    onChoose: () => void;
    onRescan: () => void;
    onState: (next: StatedCard | null) => void;
  } = $props();

  const t = $derived(locale.t.sources.sd);
  const tf = $derived(locale.t.sources.folders);
  /* The bar's free segment reuses the word the device's own geometry bars already use for it,
     rather than adding a second key for one fact (UI_VOICE mechanics). */
  const tg = $derived(locale.t.shared.geometry);

  const ready = $derived(state.kind === "ready" ? state : null);
  /* `unknown` and `unavailable` are both "no card chosen": the template reaches that state by
     falling past `unreadable` and `ready`, so it needs no derived of its own. */
  const unreadable = $derived(state.kind === "unreadable" ? state : null);

  const folderName = $derived(
    ready ? cardDisplayName(ready.folderName) : unreadable ? cardDisplayName(unreadable.folderName) : null,
  );

  /**
   * The stated size only counts for the card it was stated FOR. A size remembered against a
   * different folder would draw a confident budget the user never claimed for this card.
   */
  const statedHere = $derived(
    stated !== null && folderName !== null && stated.folderName === folderName ? stated : null,
  );

  const usable = $derived(statedHere ? usableBytesFor(statedHere.nominalGB) : null);
  const freeBytes = $derived(usable !== null && ready ? Math.max(0, usable - ready.total) : null);

  /* The total row's count. Summed here rather than added to `SdUsage`, because the store's
     contract is bytes-and-counts per bucket plus the one byte total it calls USED; a display
     sum of numbers it already publishes needs no new field to go stale against. */
  const fileTotal = $derived(
    ready ? SD_CATEGORIES.reduce((n, c) => n + ready.files[c], 0) : 0,
  );

  /** The bar's floor, as a percentage, from the width the board draws it at. */
  const BAR_PX = 684;
  const FLOOR_PX = 2;
  const floorPercent = (FLOOR_PX / BAR_PX) * 100;

  const order = $derived.by<readonly SdCategory[]>(() => {
    const labels = Object.fromEntries(
      SD_CATEGORIES.map((c) => [c, catLabel(c)]),
    ) as Record<SdCategory, string>;
    return sortedCategories(labels, locale.current);
  });

  const segments = $derived(
    ready && usable !== null
      ? sdBarSegments(ready.bytes, order, usable, floorPercent)
      : [],
  );
  const usedPercent = $derived(segments.reduce((n, s) => n + s.percent, 0));

  /**
   * The bucket segments as `GeometryBar` takes them, plus the free remainder.
   *
   * THE FLOOR RULE SURVIVES THE MOVE because `GeometryBar` never computes a width: it renders
   * `pct` verbatim from the caller, and the floor lives in `sdBarSegments` where it always did.
   * So the honesty property is untouched -- a bucket big enough to be drawn to scale still is,
   * no non-empty bucket is invisible, and the whole error still lands on the free remainder.
   *
   * `detail` is what the bar shows on hover. The exact figures are in the table below, so this
   * repeats rather than reveals, which is the right way round: the table is where a reader
   * compares, and the bar's floored widths cannot support a comparison.
   */
  const geoSegments = $derived.by<GeoSegment[]>(() => {
    if (!ready || usable === null) return [];
    const segs: GeoSegment[] = segments.map((s) => ({
      pct: s.percent,
      /* `kind` is GeometryBar's CSS hook. These carry no rule of their own -- the fill arrives
         on `color` -- but naming the bucket keeps each segment identifiable in the markup
         rather than nine indistinguishable `sd` segments. */
      kind: `sd-${s.category}`,
      color: `var(--sd-seg-${s.category})`,
      label: catLabel(s.category as SdCategory),
      detail: [
        `${catLabel(s.category as SdCategory)}: ${formatSize(ready.bytes[s.category as SdCategory])}`,
        t.fileCount(ready.files[s.category as SdCategory]),
      ],
    }));
    const freePct = Math.max(0, 100 - usedPercent);
    if (freePct > 0 && freeBytes !== null) {
      segs.push({
        pct: freePct,
        kind: "free",
        label: tg.freeSpace,
        detail: [`${tg.freeSpace}: ${formatSize(freeBytes)}`],
      });
    }
    return segs;
  });

  function catLabel(c: SdCategory): string {
    switch (c) {
      case "bios":
        return t.catBios;
      case "covers":
        return t.catCovers;
      case "fonts":
        return t.catFonts;
      case "homebrew":
        return t.catHomebrew;
      case "language":
        return t.catLanguage;
      case "roms":
        return t.catRoms;
      case "saves":
        return t.catSaves;
      case "screenshots":
        return t.catScreenshots;
      default:
        return t.catOther;
    }
  }

  /**
   * The truncation sentence, by the cause the store reports rather than by assumption. All three
   * used to read as "too many files"; a deep tree and one unreadable file are not that.
   */
  const truncMessage = $derived(
    !ready || ready.truncatedBy === null
      ? null
      : ready.truncatedBy === "entries"
        ? t.truncEntries(String(MAX_ENTRIES))
        : ready.truncatedBy === "depth"
          ? t.truncDepth
          : t.truncFile,
  );

  function pickSize(raw: string): void {
    if (raw === "") return onState(null);
    const nominalGB = Number(raw);
    if (!Number.isFinite(nominalGB) || folderName === null) return;
    onState({ folderName, nominalGB });
  }

  /** A size the card has already outgrown cannot be chosen. The walked total is real, so the
   *  refusal is a measured fact rather than a guess, and a truncated walk still refuses because
   *  a floor proves the card holds at least that much. */
  function tooSmall(nominalGB: number): boolean {
    return ready !== null && !sizeFitsUsed(nominalGB, ready.total);
  }
</script>

<div class="sdpane">
  <section class="block">
    <h3 class="blockhead">{t.card}</h3>
    <dl class="grid">
      <dt>{tf.fieldFolder}</dt>
      <dd class="folderrow">
        <span class="folder" class:absent={folderName === null}>
          {#if unreadable}<span class="dot" aria-hidden="true"></span>{/if}
          {folderName ?? tf.noFolderChosen}
        </span>
        <button type="button" class="linkish" onclick={onChoose}>{tf.choose}</button>
      </dd>

      {#if ready && truncMessage !== null}
        <dt>{t.files}</dt>
        <dd class="warn">{truncMessage}</dd>
      {/if}

      {#if ready}
        <dt>{t.capacity}</dt>
        <dd>
          <select
            aria-label={t.capacity}
            value={statedHere ? String(statedHere.nominalGB) : ""}
            onchange={(e) => pickSize(e.currentTarget.value)}
          >
            <option value="">{t.none}</option>
            {#each SD_NOMINAL_SIZES_GB as gb (gb)}
              <option value={String(gb)} disabled={tooSmall(gb)}>{gb} GB</option>
            {/each}
          </select>
        </dd>
      {/if}
    </dl>
  </section>

  {#if unreadable}
    <p class="unreadable">{t.unreadable}</p>
    <div class="foot"><button type="button" class="linkish" onclick={onRescan}>{t.rescan}</button></div>
  {:else if ready}
    <section class="block">
      <h3 class="blockhead">{t.contents}</h3>

      {#if usable !== null && freeBytes !== null}
        <GeometryBar size="slim" segments={geoSegments} />
        <p class="caption">{t.freeOf(formatSize(freeBytes), formatSize(usable))}</p>
      {/if}

      <div class="panel">
        {#each order as c (c)}
          <div class="row">
            <span class="name"><span class="swatch swatch-{c}" aria-hidden="true"></span>{catLabel(c)}</span>
            <span class="count">{t.fileCount(ready.files[c])}</span>
            <span class="size">{formatSize(ready.bytes[c])}</span>
          </div>
        {/each}
        <div class="row total">
          <span class="name">{t.total}</span>
          <span class="count">{t.fileCount(fileTotal)}</span>
          <span class="size">{formatSize(ready.total)}</span>
        </div>
      </div>
    </section>
    <div class="foot"><button type="button" class="linkish" onclick={onRescan}>{t.rescan}</button></div>
  {/if}
</div>

<style>
  /* Logical properties throughout: test/direction.mjs fails the build on physical inline ones,
     and Arabic mirrors this pane like every other. */
  .sdpane {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .blockhead {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr);
    gap: 8px 16px;
    margin: 0;
    font-size: 14px;
  }
  .grid dt {
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .grid dd {
    margin: 0;
    min-width: 0;
  }
  .folderrow {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .folder {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .folder.absent {
    color: var(--ink-soft);
  }
  /* The red dot belongs to `unreadable` ONLY. An unselected card has not failed at anything, and
     a dot there would accuse the user of something they did not do. */
  .dot {
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--danger);
    flex-shrink: 0;
  }
  .warn {
    color: var(--caution);
  }
  .unreadable {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--zelda-green);
    cursor: pointer;
    text-decoration: underline;
  }
  .foot {
    display: flex;
  }
  /* The bar itself is GeometryBar; the nine fills ride in on GeoSegment.color, so the only
     palette rules left here are the table's swatches, which are what ties a row to its
     segment. Without them the bar's nine colours would name nothing. */
  .swatch {
    inline-size: 9px;
    block-size: 9px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .swatch-bios { background: var(--sd-seg-bios); }
  .swatch-covers { background: var(--sd-seg-covers); }
  .swatch-fonts { background: var(--sd-seg-fonts); }
  .swatch-homebrew { background: var(--sd-seg-homebrew); }
  .swatch-language { background: var(--sd-seg-language); }
  .swatch-roms { background: var(--sd-seg-roms); }
  .swatch-saves { background: var(--sd-seg-saves); }
  .swatch-screenshots { background: var(--sd-seg-screenshots); }
  .swatch-other { background: var(--sd-seg-other); }
  .caption {
    margin: 0;
    font-size: 13px;
    color: var(--ink-soft);
  }
  /* CachePane's Contents table, row for row. Its `.act` column is deliberately absent: those
     rows carry a Clear action and these have nothing to act on. */
  .panel {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 18px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--rule);
  }
  /* The last bucket row and the total row carry no bottom rule; the total takes a heavier one
     on TOP instead, as CachePane draws it. */
  .row:nth-last-child(2) {
    border-bottom: none;
  }
  .row.total {
    border-bottom: none;
    border-top: 1px solid var(--hairline);
  }
  .name {
    font-size: var(--fs-btn-sm);
    flex-grow: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row.total .name {
    font-weight: 600;
  }
  .count {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    inline-size: 84px;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .size {
    font-size: var(--fs-micro);
    inline-size: 84px;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .row.total .size {
    font-weight: 600;
  }
</style>
