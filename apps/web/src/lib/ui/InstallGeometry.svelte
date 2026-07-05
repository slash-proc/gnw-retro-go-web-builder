<script lang="ts">
  // ONE extflash geometry bar showing existing layout vs. the FrogFS change in place.
  // The FrogFS region is split into an UNCHANGED part [frogfsOffset, changedFromOffset) and a
  // highlighted CHANGED part [changedFromOffset, frogfsOffset+newFrogfsLen) — where new games get
  // written (additions append at the current end) or a removal forces a rewrite (from the earliest
  // removed game's offset). Reused by the Select-games and Install-ROMs drop-downs.
  import GeometryBar from "./GeometryBar.svelte";
  import StatPanel, { type StatRow } from "./StatPanel.svelte";
  import { extflashSegments, type GeoSegment } from "../engine/classify.js";
  import type { ExtPartition } from "../engine/fsscan.js";
  import { device } from "../device.svelte.js";
  import { EXTBASE } from "../engine/addr.js";
  import { locale } from "../i18n/locale.svelte.js";

  // additionsCount/additionsBytes/removalsCount/removalsBytes were removed from this
  // component's props — they duplicated the "N new, N removed" detail already shown on
  // ChangeSummary's "ROMs" row (this component's own footer now sticks to describing
  // whichever partition is clicked, not re-summarizing the whole selection).
  let {
    partitions,
    extSize,
    frogfsOffset,
    newFrogfsLen,
    changedFromOffset,
    title = "",
  }: {
    partitions: ExtPartition[];
    extSize: number;
    frogfsOffset: number;
    newFrogfsLen: number | null;
    changedFromOffset: number | null;
    title?: string;
  } = $props();

  const hex = (n: number): string => "0x" + (n >>> 0).toString(16);
  const mib = (n: number): string => (n / 1048576).toFixed(2) + " MiB";

  function kindOf(p: ExtPartition): string {
    if (p.fs) return p.fs;
    if (/OFW/.test(p.type)) return "ofw";
    if (/Assets/.test(p.type)) return "assets";
    return "data";
  }

  const segments = $derived.by<GeoSegment[]>(() => {
    if (!extSize) return [];
    if (newFrogfsLen === null) return extflashSegments(partitions, extSize);

    const newEnd = frogfsOffset + newFrogfsLen;
    const cf =
      changedFromOffset === null
        ? newEnd
        : Math.max(frogfsOffset, Math.min(changedFromOffset, newEnd));

    type Region = { offset: number; size: number; kind: string; label: string; detail: string[] };
    const regions: Region[] = [];
    for (const p of partitions) {
      if (p.fs === "frogfs") continue; // replaced by the synthetic FrogFS below
      let label = p.type;
      if (p.fs === "littlefs") label = locale.t.roms.installGeometry.coresAndSaves;
      regions.push({
        offset: p.offset,
        size: p.size,
        kind: kindOf(p),
        label: label,
        detail: [label, mib(p.size)],
      });
    }
    if (cf - frogfsOffset > 0)
      regions.push({
        offset: frogfsOffset,
        size: cf - frogfsOffset,
        kind: "frogfs",
        label: locale.t.roms.installGeometry.gamesUnchanged,
        detail: [locale.t.roms.installGeometry.gamesUnchanged, mib(cf - frogfsOffset)],
      });
    if (newEnd - cf > 0)
      regions.push({
        offset: cf,
        size: newEnd - cf,
        kind: "frogfs-changed",
        label: locale.t.roms.installGeometry.gamesProjected,
        detail: [locale.t.roms.installGeometry.gamesProjected, mib(newEnd - cf)],
      });

    regions.sort((a, b) => a.offset - b.offset);
    const out: GeoSegment[] = [];
    let cursor = 0;
    const free = (from: number, to: number): void => {
      if (to - from > 0)
        out.push({
          pct: ((to - from) / extSize) * 100,
          kind: "free",
          label: locale.t.roms.installGeometry.freeSpace,
          detail: [locale.t.roms.installGeometry.freeSpace, mib(to - from)],
        });
    };
    for (const r of regions) {
      if (r.offset < cursor) continue; // overlap guard (shouldn't happen)
      free(cursor, r.offset);
      out.push({ pct: (r.size / extSize) * 100, kind: r.kind, label: r.label, detail: r.detail });
      cursor = r.offset + r.size;
    }
    free(cursor, extSize);
    return out;
  });

  let activeExtPart = $state<ExtPartition | { offset: number; size: number; fs: "frogfs"; type: string } | null>(null);

  $effect(() => {
    if (!activeExtPart && partitions.length > 0) {
      activeExtPart = partitions.find((p) => p.fs === "frogfs") || null;
    }
  });

  const footerHeading = $derived.by((): string | undefined => {
    const p = activeExtPart;
    if (!p) return undefined;
    if (p.fs === "frogfs") return locale.t.roms.installGeometry.games;
    if (p.fs === "littlefs") return locale.t.roms.installGeometry.coresAndSaves;
    return p.fs ? p.type : p.type;
  });

  // Capacity + Free only — Used is dropped here on purpose. The detailed change/projection
  // story (what's added/removed, total projected size) lives in the summary further down;
  // this footer is just a low-key caption under the bar, not a second stats section.
  const footerRows = $derived.by((): StatRow[] => {
    const p = activeExtPart;
    if (!p) return [];
    if (p.fs === "frogfs") {
      const nextOffsets = partitions.filter((x) => x.offset > p.offset).map((x) => x.offset);
      const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : extSize;
      const free = nextOffset - (p.offset + p.size);
      const total = p.size + free;
      return [
        { label: locale.t.roms.installGeometry.capacity, value: mib(total) },
        { label: locale.t.roms.installGeometry.freeProjected, value: mib(free) },
      ];
    }
    if (p.fs) {
      const free = device.fsStats[p.offset]?.freeBytes ?? null;
      return [
        { label: locale.t.roms.installGeometry.capacity, value: mib(p.size) },
        { label: locale.t.roms.installGeometry.free, value: free !== null ? mib(free) : locale.t.roms.installGeometry.calculating },
      ];
    }
    return [{ label: locale.t.roms.installGeometry.capacity, value: mib(p.size) }];
  });
</script>

<div class="ext-panel">
  <div class="bank-card ext-card">
    {#if title}
      <div class="bank-title">{title}</div>
    {/if}
    <div class="bank-body ext-body">
      <GeometryBar
        {segments}
        onClick={(s) => {
          let p: any = partitions.find(x => x.offset === s.offset);
          if (s.kind === 'free' || s.kind === 'frogfs' || s.kind === 'frogfs-changed') {
            const fOffset = s.kind === 'free' ? undefined : frogfsOffset;
            const size = newFrogfsLen !== null ? newFrogfsLen : (partitions.find(x => x.fs === 'frogfs')?.size ?? 0);
            if (fOffset !== undefined) {
              p = { offset: fOffset, size, fs: 'frogfs', type: 'FrogFS' };
            } else {
              p = partitions.find(x => x.fs === 'frogfs');
            }
          }
          if (p) activeExtPart = p;
        }}
      />
    </div>

    {#if activeExtPart}
      <StatPanel variant="footer" heading={footerHeading} rows={footerRows} />
    {/if}
  </div>
</div>

<style>
  /* Hide the default geometry bar detail; we use the custom footer below instead. */
  .ext-body :global(.gdetail) {
    display: none !important;
  }
  
  .bank-card {
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ext-card {
    flex: 1;
    width: auto;
  }
  .bank-title {
    background: var(--surface);
    border-bottom: 1px solid var(--surface-sunk);
    padding: 0.5rem;
    text-align: center;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .bank-body {
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.5rem;
    align-items: center;
  }
  .ext-body {
    height: auto;
  }
  .ext-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
