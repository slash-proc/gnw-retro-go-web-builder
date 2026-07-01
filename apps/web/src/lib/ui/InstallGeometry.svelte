<script lang="ts">
  // ONE extflash geometry bar showing existing layout vs. the FrogFS change in place.
  // The FrogFS region is split into an UNCHANGED part [frogfsOffset, changedFromOffset) and a
  // highlighted CHANGED part [changedFromOffset, frogfsOffset+newFrogfsLen) — where new games get
  // written (additions append at the current end) or a removal forces a rewrite (from the earliest
  // removed game's offset). Reused by the Select-games and Install-ROMs drop-downs.
  import GeometryBar from "./GeometryBar.svelte";
  import { extflashSegments, type GeoSegment } from "../engine/classify.js";
  import type { ExtPartition } from "../engine/fsscan.js";
  import { device } from "../device.svelte.js";

  let {
    partitions,
    extSize,
    frogfsOffset,
    newFrogfsLen,
    changedFromOffset,
    title = "",
    additionsCount = 0,
    additionsBytes = 0,
    removalsCount = 0,
    removalsBytes = 0,
  }: {
    partitions: ExtPartition[];
    extSize: number;
    frogfsOffset: number;
    newFrogfsLen: number | null;
    changedFromOffset: number | null;
    title?: string;
    additionsCount?: number;
    additionsBytes?: number;
    removalsCount?: number;
    removalsBytes?: number;
  } = $props();

  const EXTBASE = 0x90000000;
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
      if (p.fs === "littlefs") label = "Cores & Saves";
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
        label: "Games (unchanged)",
        detail: ["Games (unchanged)", mib(cf - frogfsOffset)],
      });
    if (newEnd - cf > 0)
      regions.push({
        offset: cf,
        size: newEnd - cf,
        kind: "frogfs-changed",
        label: "Games (projected)",
        detail: ["Games (projected)", mib(newEnd - cf)],
      });

    regions.sort((a, b) => a.offset - b.offset);
    const out: GeoSegment[] = [];
    let cursor = 0;
    const free = (from: number, to: number): void => {
      if (to - from > 0)
        out.push({
          pct: ((to - from) / extSize) * 100,
          kind: "free",
          label: "Free Space",
          detail: ["Free Space", mib(to - from)],
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

    <div class="bank-footer ext-fs-single">
      {#if activeExtPart}
        {@const p = activeExtPart}
        {#if p.fs === 'frogfs'}
          {@const nextOffsets = partitions.filter(x => x.offset > p.offset).map(x => x.offset)}
          {@const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : extSize}
          {@const free = nextOffset - (p.offset + p.size)}
          {@const total = p.size + free}
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <div class="fs-stat-name">Games</div>
            <div class="fs-stat-row" style="width: auto;"><span>Capacity:</span> <span style="margin-left: 0.5rem;">{(total / 1048576).toFixed(2)} MB</span></div>
          </div>
          <div class="fs-stat-row"><span>Used (Projected):</span> <span>{(p.size / 1048576).toFixed(2)} MB</span></div>
          <div class="fs-stat-row"><span>Free (Projected):</span> <span>{(free / 1048576).toFixed(2)} MB</span></div>
          
          <div class="fs-stat-row" style="margin-top: 0.5rem; justify-content: center; gap: 1rem; width: 100%; padding-top: 0.5rem; border-top: 1px solid var(--hairline);">
            <span style="color: {additionsCount > 0 ? '#007bff' : 'var(--ink-soft)'}"><strong>+{additionsCount}</strong> add ({(additionsBytes / 1048576).toFixed(2)} MiB)</span>
            <span style="color: var(--ink-soft)"> · </span>
            <span style="color: {removalsCount > 0 ? 'var(--caution, #d32f2f)' : 'var(--ink-soft)'}"><strong>−{removalsCount}</strong> remove ({(removalsBytes / 1048576).toFixed(2)} MiB)</span>
          </div>
        {:else if p.fs}
          {@const nextOffsets = partitions.filter(x => x.offset > p.offset).map(x => x.offset)}
          {@const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : extSize}
          {@const free = device.fsStats[p.offset]?.freeBytes ?? null}
          {@const used = device.fsStats[p.offset]?.usedBytes ?? null}
          {@const total = p.size}
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <div class="fs-stat-name">{p.fs === 'littlefs' ? 'Cores & Saves' : p.type}</div>
            <div class="fs-stat-row" style="width: auto;"><span>Capacity:</span> <span style="margin-left: 0.5rem;">{(total / 1048576).toFixed(2)} MB</span></div>
          </div>
          <div class="fs-stat-row"><span>Used:</span> <span>{used !== null ? (used / 1048576).toFixed(2) + ' MB' : 'Calculating...'}</span></div>
          <div class="fs-stat-row"><span>Free:</span> <span>{free !== null ? (free / 1048576).toFixed(2) + ' MB' : 'Calculating...'}</span></div>
        {:else}
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <div class="fs-stat-name">{p.type}</div>
            <div class="fs-stat-row" style="width: auto;"><span>Capacity:</span> <span style="margin-left: 0.5rem;">{(p.size / 1048576).toFixed(2)} MB</span></div>
          </div>
        {/if}
      {/if}
    </div>
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
  .bank-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--surface-sunk);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .fs-stat-name {
    font-weight: 600;
    margin-bottom: 0;
    color: var(--ink);
  }
  .fs-stat-row {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .fs-stat-row span:last-child {
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .ext-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
