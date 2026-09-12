// Address / size parsing for the Advanced surface (§4.3). One parser everywhere,
// lifted from /dev's `parseAddr` (flashdump.js): decimal by default, `0x…` for
// hex, optional binary k/m/g (or kb/mb/gb) suffix. Richer than Manage's old
// parseNum (which only did hex/decimal).

export { EXTBASE, BANK_BASE } from "../engine/addr.js";
import { EXTBASE, BANK_BASE } from "../engine/addr.js";

const MULT: Record<string, number> = {
  k: 1 << 10,
  kb: 1 << 10,
  m: 1 << 20,
  mb: 1 << 20,
  g: 1 << 30,
  gb: 1 << 30,
};

/** Parse "0x…"/decimal with an optional k/m/g[b] binary suffix. NaN on garbage. */
export function parseAddr(input: string): number {
  let s = input.trim().toLowerCase();
  if (s === "") return NaN;
  let mult = 1;
  const m = s.match(/^(.*?)(kb|mb|gb|k|m|g)$/);
  if (m && m[1] !== "") {
    mult = MULT[m[2]];
    s = m[1].trim();
  }
  const n = s.startsWith("0x") ? parseInt(s, 16) : Number(s);
  return Number.isFinite(n) ? n * mult : NaN;
}

/** 0x-prefixed lowercase hex (unsigned). */
export const hex = (n: number): string => "0x" + (n >>> 0).toString(16);

/** 0x-prefixed 8-digit hex address (matches the engine's hexAddr). */
export const hex8 = (n: number): string => "0x" + (n >>> 0).toString(16).padStart(8, "0");

/** Grouped decimal byte count, e.g. 245,760. */
export const commas = (n: number): string => n.toLocaleString("en-US");

/** Region size (bytes) for a bank: ext from device size, 256 KiB per int bank. */
export const regionSize = (bank: number, extSizeMB: number | null): number =>
  bank === 0 ? (extSizeMB ?? 1) * 1024 * 1024 : 0x40000;

/** Offset alignment for a bank (ext %4096, int %8192) — mirrors validateOffset. */
export const alignFor = (bank: number): number => (bank === 0 ? 4096 : 8192);

/** Internal-flash bank span (each of bank 1 / bank 2 is 256 KiB). */
export const INT_BANK_SPAN = 0x40000;

/**
 * Which bank an ABSOLUTE flash address belongs to, or -1 when it is outside every bank.
 * The range fields hold absolute addresses (the artboards show `0x08100000` / `0x90370000`),
 * so the bank the engine is handed is derived here rather than picked from a <select>.
 * Bounds come from the same device-scanned size the geometry bars are drawn from.
 */
export function bankForAddr(addr: number, extSizeMB: number | null): number {
  // Non-finite input (parseAddr returns NaN for garbage) needs no explicit test: every
  // `>=` below is false for NaN and for -Infinity, so both fall through to the final -1,
  // and +Infinity takes the first branch only to fail its upper bound. Pinned by
  // apps/web/test/addr.mjs.
  if (addr >= EXTBASE) return addr < EXTBASE + regionSize(0, extSizeMB) ? 0 : -1;
  if (addr >= BANK_BASE[2]) return addr < BANK_BASE[2] + INT_BANK_SPAN ? 2 : -1;
  // Bank 1 is bounded like the others: the 0x08040000-0x080fffff gap between the end of
  // bank 1 and bank 2's base belongs to NEITHER bank. Leaving it open resolved a gap
  // address to bank 1 with offset > region, which Dump's overrun clamp then turned into a
  // NEGATIVE read length.
  if (addr >= BANK_BASE[1]) return addr < BANK_BASE[1] + INT_BANK_SPAN ? 1 : -1;
  return -1;
}

/* Mono technical labels for the geometry-bar head row (artboard: "bank 1 · bank 2" / "2 × 256 KB").
   Device-derived / glyph-only, so they stay out of the string tables like the hex addresses do. */
export const INT_BAR_NOTE = "bank 1 · bank 2";
export const INT_BAR_SIZE = "2 × 256 KB";
export const EXT_BAR_NOTE = "bank 0";
/* Write.dc.html:94's Destination value — `internal · bank 2 · 0x08100000`. Mono technical
   label like the bar notes above, so it stays out of the string tables. */
export const destLabel = (bank: number, addr: string): string =>
  `${bank === 0 ? "external" : "internal"} · bank ${bank} · ${addr}`;

export const extBarSize = (extSizeMB: number | null): string => `${extSizeMB ?? 0} MB`;
