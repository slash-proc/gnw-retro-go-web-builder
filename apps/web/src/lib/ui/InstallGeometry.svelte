<script lang="ts">
  // ONE extflash geometry bar showing existing layout vs. the FrogFS change in place.
  // The FrogFS region is split into an UNCHANGED part [frogfsOffset, changedFromOffset) and a
  // highlighted CHANGED part [changedFromOffset, frogfsOffset+newFrogfsLen) — where new games get
  // written (additions append at the current end) or a removal forces a rewrite (from the earliest
  // removed game's offset). Reused by the Select-games and Install-ROMs drop-downs.
  import GeometryBar from "./GeometryBar.svelte";
  import { extflashSegments, type GeoSegment } from "../engine/classify.js";
  import type { ExtPartition } from "../engine/fsscan.js";

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
      regions.push({
        offset: p.offset,
        size: p.size,
        kind: kindOf(p),
        label: p.type,
        detail: [p.type, `${hex(EXTBASE + p.offset)} · ${mib(p.size)}`],
      });
    }
    if (cf - frogfsOffset > 0)
      regions.push({
        offset: frogfsOffset,
        size: cf - frogfsOffset,
        kind: "frogfs",
        label: "FrogFS",
        detail: ["FrogFS (unchanged)", `${hex(EXTBASE + frogfsOffset)} · ${mib(cf - frogfsOffset)}`],
      });
    if (newEnd - cf > 0)
      regions.push({
        offset: cf,
        size: newEnd - cf,
        kind: "frogfs-changed",
        label: "new/changed",
        detail: ["FrogFS new/changed", `${hex(EXTBASE + cf)} · ${mib(newEnd - cf)}`],
      });

    regions.sort((a, b) => a.offset - b.offset);
    const out: GeoSegment[] = [];
    let cursor = 0;
    const free = (from: number, to: number): void => {
      if (to - from > 0)
        out.push({
          pct: ((to - from) / extSize) * 100,
          kind: "free",
          label: "free",
          detail: [`free ${mib(to - from)}`, `${hex(EXTBASE + from)}–${hex(EXTBASE + to)}`],
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
</script>

<GeometryBar
  {segments}
  {title}
  leftLabel={hex(EXTBASE)}
  rightLabel={hex(EXTBASE + extSize)}
/>
