/**
 * Device classification + geometry-bar segments, from the scan results.
 * The scan runs on connect and this turns it into "what is this device, and what
 * are we looking at" — which drives the UI. See docs/DEVICE_SCAN.md.
 */
import type { DeviceInfo } from "@gnw/gnw-flasher";
import type { ExtPartition } from "./fsscan.js";
import type { IntflashBank } from "./intflashscan.js";
import { INT_BANK_BASES } from "./intflashscan.js";

export type DeviceKind = "stock" | "retrogo-sd" | "retrogo-old" | "unknown" | "locked";

export interface DeviceClass {
  kind: DeviceKind;
  label: string;
  bank?: 1 | 2;
  model?: "mario" | "zelda";
  /** Official firmware on the device (model + stock/patched), or null if none. */
  ofw?: { model: "mario" | "zelda"; patched: boolean } | null;
  retroGoVersion?: string;
  /** FrogFS present (games). */
  hasGames: boolean;
  /** LittleFS present (saves/screenshots). */
  hasSaves: boolean;
  /** Banks an install may target for this class (Unknown/non-stock = bank 1 only). */
  installBanks: (1 | 2)[];
}

export function classifyDevice(
  info: DeviceInfo | null,
  banks: IntflashBank[],
  parts: ExtPartition[],
): DeviceClass {
  if (info?.locked)
    return { kind: "locked", label: "Locked — unlock to read", ofw: null, hasGames: false, hasSaves: false, installBanks: [] };

  // Official firmware (model + stock/patched) detected by the bank scan, if any.
  const ofw = banks.map((b) => b.ofw).find(Boolean) ?? null;

  const stock = info?.detectedStockFirmware;
  if (stock === "MARIO" || stock === "ZELDA") {
    const model = stock.toLowerCase() as "mario" | "zelda";
    return {
      kind: "stock",
      model,
      ofw: ofw ?? { model, patched: false },
      label: `Stock ${model === "mario" ? "Mario" : "Zelda"} firmware`,
      hasGames: false,
      hasSaves: false,
      installBanks: [1, 2], // stock present → bank2 (keep stock) is possible
    };
  }

  const frogfs = parts.some((p) => p.fs === "frogfs");
  const littlefs = parts.some((p) => p.fs === "littlefs");
  const version = banks.map((b) => b.retroGoVersion).find(Boolean);
  const hasApp = banks.some((b) => !["empty", "unknown", "unreadable"].includes(b.type));

  // The version string is "Retro-Go SD v…", so finding it ⇒ retro-go-sd (even before
  // games/saves content is written). FrogFS implies SD too.
  if (version || frogfs)
    return {
      kind: "retrogo-sd",
      label: version ? `Retro-Go ${version}` : "Retro-Go (SD)",
      ofw: ofw ? { ...ofw, patched: true } : null,
      retroGoVersion: version,
      hasGames: frogfs,
      hasSaves: littlefs,
      installBanks: [1],
    };

  if (littlefs || hasApp)
    return {
      kind: "retrogo-old",
      label: "Retro-Go (older)",
      ofw: ofw ? { ...ofw, patched: true } : null,
      retroGoVersion: undefined,
      hasGames: false,
      hasSaves: littlefs,
      installBanks: [1],
    };

  return { kind: "unknown", label: "Unrecognized device", ofw, hasGames: false, hasSaves: false, installBanks: [1] };
}

// ── geometry-bar segments ────────────────────────────────────────────────────

export interface GeoSegment {
  /** Width as a percent of the bar. */
  pct: number;
  /** CSS kind: littlefs | frogfs | fat | ofw | assets | data | free | bank | bank-empty. */
  kind: string;
  label: string;
  bank?: 1 | 2;
  /** Hover-detail lines (chainloader partition-viewer style). */
  detail: string[];
}

const EXTBASE = 0x90000000;
const hex = (n: number) => "0x" + (n >>> 0).toString(16);
const mib = (n: number) => (n / 1048576).toFixed(2) + " MiB";
const kib = (n: number) => (n / 1024).toFixed(0) + " KiB";

function partKind(p: ExtPartition): string {
  if (p.fs) return p.fs; // littlefs | frogfs | fat
  if (/OFW/.test(p.type)) return "ofw";
  if (/Assets/.test(p.type)) return "assets";
  return "data";
}

/** Extflash partition bar — sorted by offset with free-space gaps filled. */
export function extflashSegments(parts: ExtPartition[], extSize: number): GeoSegment[] {
  if (!extSize) return [];
  const sorted = [...parts].sort((a, b) => a.offset - b.offset);
  const segs: GeoSegment[] = [];
  let cursor = 0;
  const free = (from: number, to: number) => {
    if (to - from <= 0) return;
    segs.push({ pct: ((to - from) / extSize) * 100, kind: "free", label: "free", detail: [`free ${mib(to - from)}`, `${hex(EXTBASE + from)}–${hex(EXTBASE + to)}`] });
  };
  for (const p of sorted) {
    if (p.offset < cursor) continue; // overlap (shouldn't happen) — skip
    free(cursor, p.offset);
    const detail = [p.type, `${hex(EXTBASE + p.offset)} · ${mib(p.size)}`];
    if (p.fs === "littlefs" && p.meta) detail.push(`block ${p.meta.blockSize} × ${p.meta.blockCount}`);
    if (p.fs === "fat" && p.meta) detail.push(`${p.meta.bytesPerSector} B/sec × ${p.meta.totalSectors}`);
    segs.push({ pct: (p.size / extSize) * 100, kind: partKind(p), label: p.type, detail });
    cursor = p.offset + p.size;
  }
  free(cursor, extSize);
  return segs;
}

/** Internal-flash bar — two banks, each half the width; data fill vs free within. */
export function intflashSegments(banks: IntflashBank[]): GeoSegment[] {
  const BANK_SPAN = 256 << 10; // matches the scan convention
  const segs: GeoSegment[] = [];
  for (let i = 0; i < INT_BANK_BASES.length; i++) {
    const b = banks.find((x) => x.index === ((i + 1) as 1 | 2));
    const base = INT_BANK_BASES[i];
    const used = b?.dataSize ?? 0;
    const usedPct = (used / BANK_SPAN) * 50; // each bank is 50% of the bar
    const detail = [
      `Bank ${i + 1}: ${b?.type ?? "—"}`,
      `${hex(base)} · ${kib(used)} used`,
      ...(b?.retroGoVersion ? [b.retroGoVersion] : []),
    ];
    if (used > 0)
      segs.push({ pct: usedPct, kind: b?.type === "empty" ? "bank-empty" : "bank", label: `B${i + 1} ${b?.type ?? ""}`, detail, bank: (i + 1) as 1 | 2 });
    if (50 - usedPct > 0.01)
      segs.push({ pct: 50 - usedPct, kind: "free", label: used ? "" : `B${i + 1} empty`, detail: [`Bank ${i + 1} free`, `${kib(BANK_SPAN - used)} free`], bank: (i + 1) as 1 | 2 });
  }
  return segs;
}
