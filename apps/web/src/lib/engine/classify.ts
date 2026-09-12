/**
 * Device classification + geometry-bar segments, from the scan results.
 * The scan runs on connect and this turns it into "what is this device, and what
 * are we looking at" — which drives the UI. See docs/DEVICE_SCAN.md.
 */
import type { DeviceInfo } from "@gnw/gnw-flasher";
import type { ExtPartition } from "./fsscan.js";
import type { IntflashBank } from "./intflashscan.js";
import { INT_BANK_BASES } from "./intflashscan.js";
import { EXTBASE } from "./addr.js";
import { locale } from "../i18n/locale.svelte.js";
import { formatSize } from "../util.js";

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
  /** Which of THIS tool's install paths produced the retro-go image here, if any: a real
   *  LittleFS superblock only ever comes from the Flash-mode path; gnw-patch's own layout
   *  superblock (embedded regardless of LittleFS) without one means the SD-mode path; neither
   *  present means the image predates/is foreign to this tool entirely. Undefined when there's
   *  no retro-go install to classify (stock/locked/unrecognized). */
  installOrigin?: "flash" | "sd" | "old";
}

export function classifyDevice(
  info: DeviceInfo | null,
  banks: IntflashBank[],
  parts: ExtPartition[],
): DeviceClass {
  if (info?.locked)
    return { kind: "locked", label: "Locked — unlock to read", ofw: null, hasGames: false, hasSaves: false, installBanks: [] };

  const bank1 = banks.find((b) => b.index === 1);
  const isPristineStock = bank1?.ofw && !bank1.ofw.patched;

  if (isPristineStock) {
    const model = bank1.ofw!.model;
    return {
      kind: "stock",
      model,
      ofw: { model, patched: false },
      label: `Stock ${model === "mario" ? "Mario" : "Zelda"} firmware`,
      hasGames: false,
      hasSaves: false,
      installBanks: [1, 2], // stock present → bank2 (keep stock) is possible
    };
  }

  const frogfs = parts.some((p) => p.fs === "frogfs");
  const littlefs = parts.some((p) => p.fs === "littlefs");
  const versionBank = banks.find((b) => b.retroGoVersion);
  const version = versionBank?.retroGoVersion;
  const hasApp = banks.some((b) => !["empty", "unknown", "unreadable"].includes(b.type) && !b.type.includes("OFW"));

  // Official firmware (model + stock/patched) detected by the bank scan, if any.
  const ofw = banks.map((b) => b.ofw).find(Boolean) ?? null;

  // installOrigin: driven entirely by the INTFLASH layout superblock's own fields, not by
  // whether the extflash scan happens to find a real LittleFS partition superblock — that scan
  // can miss a real one even on a genuine Flash-mode device, since it doesn't know where to
  // anchor its probe. patchSuperblock() only ever sets FLAG_LITTLEFS_LENGTH when a
  // littlefsLength was actually passed in — only this tool's Flash-mode build path does that;
  // gnw-patch's own layout superblock is patched in by BOTH paths regardless, so present
  // without that flag means SD-mode; not present at all means the image is foreign/predates
  // this tool entirely.
  const layoutSuperblockPresent = banks.some((b) => b.layoutSuperblockPresent);
  const layoutSuperblockHasLittlefs = banks.some((b) => b.layoutSuperblockHasLittlefs);
  const installOrigin: DeviceClass["installOrigin"] = layoutSuperblockHasLittlefs
    ? "flash"
    : layoutSuperblockPresent
      ? "sd"
      : "old";

  // Display string only — "SD" in "Retro-Go SD" just names the fork (it SUPPORTS SD-card use,
  // it doesn't mean this particular build IS one), so it must be preserved verbatim from what
  // was actually found, never hardcoded either way. installOrigin's "-flash"/"-sd" suffix is
  // THIS tool's own classification of which build this is, appended for display only — never
  // fed back into `retroGoVersion` itself, which stays the bare tag for exact-match comparisons
  // (installedVersion/selectedVersionTag/parseSha) elsewhere. "old" (foreign/pre-web-builder
  // image) gets no suffix — there's nothing of ours to name it after.
  const versionLabel = version
    ? `Retro-Go${versionBank?.retroGoIsSdFork ? " SD" : ""} ${version}` +
      (installOrigin === "flash" || installOrigin === "sd" ? `-${installOrigin}` : "")
    : undefined;

  // If there's no app in intflash (neither a version string nor an unknown app),
  // then any leftover FrogFS or LittleFS partitions are just orphaned data.
  if (version || hasApp) {
    // The version string is "Retro-Go SD v…", so finding it ⇒ retro-go-sd (even before
    // games/saves content is written). FrogFS implies SD too.
    if (version || frogfs)
      return {
        kind: "retrogo-sd",
        label: versionLabel ?? "Retro-Go (SD)",
        ofw: ofw ? { ...ofw, patched: true } : null,
        retroGoVersion: version,
        hasGames: frogfs,
        hasSaves: littlefs,
        installBanks: [1],
        installOrigin,
      };

    if (littlefs || hasApp)
      return {
        kind: "retrogo-old",
        label: `Retro-Go ${locale.t.deviceHeader.retroGoOlderSuffix}`,
        ofw: ofw ? { ...ofw, patched: true } : null,
        retroGoVersion: undefined,
        hasGames: false,
        hasSaves: littlefs,
        installBanks: [1],
        installOrigin,
      };
  }

  if (ofw && ofw.patched) {
    return { kind: "unknown", label: `Patched ${ofw.model === "mario" ? "Mario" : "Zelda"}`, ofw, hasGames: false, hasSaves: false, installBanks: [1] };
  }

  return { kind: "unknown", label: "Unrecognized device", ofw, hasGames: false, hasSaves: false, installBanks: [1] };
}

// ── geometry-bar segments ────────────────────────────────────────────────────

export interface GeoSegment {
  /** Width as a percent of the bar. */
  pct: number;
  /** CSS kind: littlefs | frogfs | fat | ofw | assets | data | free | bank | bank-empty. */
  kind: string;
  /**
   * An explicit fill, for a caller whose segments are not device-partition kinds.
   *
   * `GeometryBar`'s palette is a CLOSED set: `.frogfs`, `.littlefs`, `.free` and friends each
   * hardcode a `--seg-*` token in that component's own style block. The SD card pane draws nine
   * CONTENT buckets (BIOS, Covers, Fonts, …), which are not partitions and have no business
   * adding nine rules to a primitive every Advanced pane shares. So a caller outside that
   * vocabulary passes its own token reference here instead, keeping its palette in
   * `tokens.css` where `--sd-seg-*` already lives.
   *
   * Absent for every partition caller, which is what leaves them byte-identical.
   */
  color?: string;
  label: string;
  bank?: 0 | 1 | 2;
  offset?: number;
  size?: number;
  /** Hover-detail lines (chainloader partition-viewer style). */
  detail: string[];
}

const hex = (n: number) => "0x" + (n >>> 0).toString(16);
// Byte sizes in these tooltips go through `formatSize` — the shared helper. It picks MB/KB/B
// by magnitude and takes its unit labels from the active locale, so French reads `Ko`/`Mo`.
// Two earlier hand-rolled versions were wrong in opposite directions: `(n/1048576).toFixed(2)
// + " MB"` forced two decimals onto everything (a 50 MB free run read `50.00 MB`, 40 KB read
// `0.04 MB`), and its replacement `(n/1024).toFixed(0) + " KB"` pinned everything to KB and
// hardcoded an English unit. Don't hand-roll a third.

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
  let lastFrogfsDetail: string[] | null = null;
  
  const free = (from: number, to: number, inheritDetail?: string[] | null) => {
    if (to - from <= 0) return;
    const freeLabel = locale.t.shared.geometry.freeSpace;
    segs.push({ pct: ((to - from) / extSize) * 100, kind: "free", label: freeLabel, detail: inheritDetail || [freeLabel, `${formatSize(to - from)}`], offset: from, size: to - from, bank: 0 });
  };
  for (const p of sorted) {
    if (p.offset < cursor) continue; // overlap (shouldn't happen) — skip
    free(cursor, p.offset, null); // Free space before a partition doesn't inherit
    let label = p.type;
    if (p.fs === "frogfs") label = locale.t.shared.geometry.games;
    if (p.fs === "littlefs") label = locale.t.shared.geometry.coresAndSaves;
    const detail = [label, `${formatSize(p.size)}`];
    segs.push({ pct: (p.size / extSize) * 100, kind: partKind(p), label, offset: p.offset, size: p.size, detail, bank: 0 });
    
    if (p.fs === "frogfs") {
      lastFrogfsDetail = detail;
    } else {
      lastFrogfsDetail = null;
    }
    
    cursor = p.offset + p.size;
  }
  free(cursor, extSize, lastFrogfsDetail);
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
      `${locale.t.shared.geometry.bankLabel(i + 1)}: ${b?.type ?? locale.t.shared.geometry.bankUnknown}`,
      `${formatSize(used)} ${locale.t.shared.geometry.used}`,
      ...(b?.retroGoVersion ? [b.retroGoVersion] : []),
    ];
    if (used > 0)
      segs.push({ pct: usedPct, kind: b?.type === "empty" ? "bank-empty" : "bank", label: b?.type ?? "", offset: 0, size: BANK_SPAN, detail, bank: (i + 1) as 1 | 2 });
    if (50 - usedPct > 0.01)
      segs.push({ pct: 50 - usedPct, kind: "free", label: used ? "" : locale.t.shared.geometry.empty, offset: 0, size: BANK_SPAN, detail: [locale.t.shared.geometry.bankFree(i + 1), `${formatSize(BANK_SPAN - used)} ${locale.t.shared.geometry.free}`], bank: (i + 1) as 1 | 2 });
  }
  return segs;
}

/**
 * Human region label for a failed flash block (gnw-flasher's `FlashBlockRef`).
 *
 * The engine deliberately carries only block identity — bank/offset/address — and
 * leaves naming to the app, so this reuses the SAME already-localized segment
 * labels the geometry bars draw (`extflashSegments` / `intflashSegments`) rather
 * than introducing a second naming scheme. Returns null when nothing covers the
 * block (e.g. the partition scan is unavailable), so callers can fall back to the
 * bare address.
 */
export function regionLabelForBlock(segs: GeoSegment[], block: { bank: number; offset: number }): string | null {
  const hit = segs.filter(
    (s) =>
      s.bank === block.bank &&
      s.offset !== undefined &&
      s.size !== undefined &&
      block.offset >= s.offset &&
      block.offset < s.offset + s.size,
  );
  // A named partition wins over the "Free Space" filler when both cover the offset.
  const named = hit.find((s) => s.kind !== "free" && s.label) ?? hit.find((s) => s.label);
  return named?.label || null;
}
