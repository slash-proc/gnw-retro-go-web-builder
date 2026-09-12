<script lang="ts">
  // --- LOCAL SOURCES > Cache pane (SourcesCache.dc.html) ---------------------------------
  //
  // What the app is holding in OPFS, broken down by `blobCache.ts`'s seven categories, with a
  // per-category Clear, a Total row, and the origin's storage figures underneath. The footer
  // bar's "Empty cache" is the whole-store version and lives in views/Sources.svelte, which
  // calls `emptyAll()` below — the page has exactly one footer bar.
  //
  // `other` IS RENDERED LIKE ANY OTHER ROW, always, including at zero. The store files
  // anything it cannot parse there precisely so that nothing held is invisible; hiding the
  // row would put bytes on the user's disk that the user cannot see or reclaim.
  //
  // THIS PANE NEVER TOUCHES REGISTRATIONS. The user's directory handles (`gnw-handles`) and
  // the `gnw:` localStorage keys — preferences, `sources.v1`, `localFolders.v1`, and the
  // cache pointers — are not cache. Clearing a handle would silently deregister a folder, so
  // nothing here has any path to them; every action goes through `BlobCache` alone.
  //
  // WITHOUT OPFS (`available === false`) every figure would be a truthful zero that reads as
  // a false "nothing is stored". No artboard covers that state, so rather than invent copy
  // for it the numeric cells render the app's existing unknown mark (an em dash, as
  // `overview.bankUnknown` already uses) and every clearing control is disabled. Nothing is
  // claimed that the browser cannot tell us.
  import { locale } from "../i18n/locale.svelte.js";
  import InfoTip from "./InfoTip.svelte";
  import { formatSize } from "../util.js";
  import { blobCache, BLOB_CATEGORIES, type BlobCategory, type BlobUsage } from "../sources/blobCache.js";

  const t = $derived(locale.t.sources.cache);

  /** The app's mark for a figure the browser will not give us. Not copy — a glyph. */
  const UNKNOWN = "—";

  const cache = blobCache();
  const available = cache.available;

  let usage = $state<BlobUsage | null>(null);
  let estimate = $state<{ usage: number; quota: number } | null>(null);
  let persisted = $state(false);
  /** True while a clear is in flight, so the controls cannot be double-fired. */
  let busy = $state(false);

  async function refresh(): Promise<void> {
    usage = await cache.usage();
    estimate = await cache.estimate();
    persisted = await cache.persisted();
  }

  $effect(() => {
    void refresh();
  });

  /** Empty one category. Exposed only through the row's own Clear. */
  async function clearOne(category: BlobCategory): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await cache.clearCategory(category);
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** The footer bar's "Empty cache". Drops every entry, categories included. */
  export async function emptyAll(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await cache.clear();
      await refresh();
    } finally {
      busy = false;
    }
  }

  const labels = $derived<Record<BlobCategory, string>>({
    firmware: t.catFirmware,
    artifact: t.catArtifact,
    converter: t.catConverter,
    converted: t.catConverted,
    cover: t.catCover,
    offline: t.catOffline,
    other: t.catOther,
  });

  /** One row per category, in the store's declared order — never filtered, never reordered. */
  const rows = $derived(
    BLOB_CATEGORIES.map((c) => ({
      category: c,
      label: labels[c],
      count: usage ? usage.countByCategory[c] : 0,
      size: usage ? usage.byCategory[c] : 0,
    })),
  );

  const usedLine = $derived(
    estimate ? t.usedOf(formatSize(estimate.usage), formatSize(estimate.quota)) : UNKNOWN,
  );
</script>

<div class="cache">
  <section class="section">
    <div class="cap">{t.contents}</div>
    <div class="panel">
      {#each rows as r (r.category)}
        <div class="row">
          <span class="name">{r.label}</span>
          <span class="count">{available ? t.files(r.count) : UNKNOWN}</span>
          <span class="size">{available ? formatSize(r.size) : UNKNOWN}</span>
          <span class="act"
            ><button
              class="clear"
              type="button"
              disabled={!available || busy}
              onclick={() => void clearOne(r.category)}>{t.clear}</button
            ></span
          >
        </div>
      {/each}
      <!-- The trailing aggregate: divider above, bolder, and NO Clear (the whole-store
           action is the footer bar's, not a row's). -->
      <div class="row total">
        <span class="name">{t.total}</span>
        <span class="count">{available && usage ? t.files(usage.count) : UNKNOWN}</span>
        <span class="size">{available && usage ? formatSize(usage.total) : UNKNOWN}</span>
        <span class="act"></span>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="cap">{t.storage}</div>
    <div class="panel">
      <div class="defs">
        <span class="dt">{t.used}</span>
        <span class="dd">{usedLine}</span>
        <span class="dt"
          >{t.protected}<InfoTip label={t.protected} message={t.protectedHelp} /></span
        >
        <span class="dd">{persisted ? t.keptYes : t.keptNo}</span>
      </div>
    </div>
  </section>
</div>

<style>
  .cache {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* The artboard's uppercase section caption, the same one the rail heads use. */
  .cap {
    font-size: var(--fs-badge);
    font-weight: 700;
    letter-spacing: 0.11em;
    color: var(--ink-soft);
    text-transform: uppercase;
  }
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
  /* The last category row and the total row carry no bottom rule; the total takes a heavier
     one on TOP instead, as the artboard draws it. */
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
  }
  .row.total .name {
    font-weight: 600;
  }
  .count {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    width: 84px;
    text-align: end;
  }
  .size {
    font-size: var(--fs-micro);
    width: 84px;
    text-align: end;
  }
  .row.total .size {
    font-weight: 600;
  }
  .act {
    width: 46px;
    display: flex;
    justify-content: flex-end;
  }
  /* The artboard draws Clear as bare grey text, not a boxed control. */
  .clear {
    font: inherit;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .clear:disabled {
    color: var(--ink-faint);
    cursor: default;
  }
  .defs {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr);
    gap: 10px 20px;
    align-items: baseline;
  }
  .dt {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .dd {
    font-size: var(--fs-micro);
  }
</style>
