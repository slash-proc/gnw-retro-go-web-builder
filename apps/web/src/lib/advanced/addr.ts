// Address / size parsing for the Advanced surface (§4.3). One parser everywhere,
// lifted from /dev's `parseAddr` (flashdump.js): decimal by default, `0x…` for
// hex, optional binary k/m/g (or kb/mb/gb) suffix. Richer than Manage's old
// parseNum (which only did hex/decimal).

export { EXTBASE, BANK_BASE } from "../engine/addr.js";
import { BANK_BASE } from "../engine/addr.js";

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

export interface BankOpt {
  v: number;
  label: string;
  internal: boolean;
}

// Base metadata (locale-independent) for the bank picker <select> — DumpSection and
// FlashSection both render this exact three-entry list. Labels are supplied by the caller
// (via `bankOptions()`) so they route through the current locale instead of being hardcoded
// English baked into this data table.
const BANK_META: { v: number; internal: boolean }[] = [
  { v: 0, internal: false },
  { v: 1, internal: true },
  { v: 2, internal: true },
];

/** Build the bank <select> options using the shared `bankSelect` locale strings. */
export function bankOptions(t: { external: (addr: string) => string; internal: (bank: number, addr: string) => string }): BankOpt[] {
  return BANK_META.map((b) => ({
    v: b.v,
    internal: b.internal,
    label: b.internal ? t.internal(b.v, hex(BANK_BASE[b.v])) : t.external(hex(BANK_BASE[b.v])),
  }));
}

/** Region size (bytes) for a bank: ext from device size, 256 KiB per int bank. */
export const regionSize = (bank: number, extSizeMB: number | null): number =>
  bank === 0 ? (extSizeMB ?? 1) * 1024 * 1024 : 0x40000;

/** Offset alignment for a bank (ext %4096, int %8192) — mirrors validateOffset. */
export const alignFor = (bank: number): number => (bank === 0 ? 4096 : 8192);
