// Address / size parsing for the Advanced surface (§4.3). One parser everywhere,
// lifted from /dev's `parseAddr` (flashdump.js): decimal by default, `0x…` for
// hex, optional binary k/m/g (or kb/mb/gb) suffix. Richer than Manage's old
// parseNum (which only did hex/decimal).

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

/** The three real bank targets, always shown with their base address (§4.3). */
export const BANK_BASE: Record<number, number> = { 0: 0x90000000, 1: 0x08000000, 2: 0x08100000 };

export interface BankOpt {
  v: number;
  label: string;
  internal: boolean;
}
export const BANKS: BankOpt[] = [
  { v: 0, label: "External · bank0 (0x90000000)", internal: false },
  { v: 1, label: "Internal · bank1 (0x08000000)", internal: true },
  { v: 2, label: "Internal · bank2 (0x08100000)", internal: true },
];

/** Region size (bytes) for a bank: ext from device size, 256 KiB per int bank. */
export const regionSize = (bank: number, extSizeMB: number | null): number =>
  bank === 0 ? (extSizeMB ?? 1) * 1024 * 1024 : 0x40000;

/** Offset alignment for a bank (ext %4096, int %8192) — mirrors validateOffset. */
export const alignFor = (bank: number): number => (bank === 0 ? 4096 : 8192);
