/**
 * ROM `.lzma` sidecar builder — byte-exact with retro-go's
 * `scripts/rom_frogfs_lzma.py`. Produces the pre-compressed ROM payloads the
 * *game* decodes on-device (7-zip LzmaDec); FrogFS stores them raw.
 *
 * The atomic op is `compress_lzma_raw` = LZMA1 / FORMAT_ALONE / preset 6 /
 * 16 KiB dict, header-stripped — IDENTICAL to the patcher's WASM
 * `lzma_alone_compress`. So this module takes that compressor **injected**
 * (dependency injection — keeps the package free of a gnw-patch runtime dep) and
 * builds every container (GB, SMS+, default) as pure-TS framing over it.
 *
 * See docs/FROGFS_LZMA.md. `.dsk → .cdk` (MSX/Amstrad) is intentionally deferred.
 * Validated byte-for-byte by test/rom_lzma.mjs vs rom_frogfs_lzma.py.
 */

import { byteswap16 } from "./staging.js";
import type { StagedFile } from "./staging.js";

/** Injected raw LZMA1 compressor: == compress_lzma_raw (WASM lzma_alone_compress). */
export type LzmaRaw = (data: Uint8Array) => Uint8Array;

// Per-mode size caps (rom_frogfs_lzma.py / parse_roms.py). Skip → return null.
const MAX_NES = 0x00060010;
const MAX_PCE = 0x00049000;
const MAX_WSV = 0x00080000;
const MAX_SG_COL = 60 * 1024;
const MAX_A2600 = 131072;
const MAX_A7800 = 131200;
const MAX_MSX = 136 * 1024;
const MAX_VIDEOPAC = 136 * 1024;

const CAPPED_MODES: Record<string, number> = {
  nes: MAX_NES,
  pce: MAX_PCE,
  msx_rom: MAX_MSX,
  wsv: MAX_WSV,
  a2600: MAX_A2600,
  a7800: MAX_A7800,
  videopac: MAX_VIDEOPAC,
  col: MAX_SG_COL,
  sg: MAX_SG_COL,
};

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** struct.pack("<l", n) — signed 32-bit little-endian. */
function int32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

function suffixLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

/**
 * Map a path RELATIVE TO roms/ (e.g. "nes/foo.nes") to a compression mode, or
 * null to skip. 1:1 with `_compression_mode_for_path`.
 */
export function modeForPath(relUnderRoms: string): string | null {
  const parts = relUnderRoms.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const top = parts[0].toLowerCase();
  const name = parts[parts.length - 1];
  const suf = suffixLower(name);

  if (top === "nes" && [".nes", ".fds", ".nsf"].includes(suf)) return "nes";
  if (top === "pce" && suf === ".pce") return "pce";
  if ((top === "gb" || top === "gbc") && [".gb", ".gbc"].includes(suf)) return "gb";
  if (top === "sms" && suf === ".sms") return "sms_md";
  if (top === "gg" && suf === ".gg") return "sms_md";
  if (top === "md" && [".md", ".gen", ".bin"].includes(suf)) return "sms_md";
  if (top === "col" && suf === ".col") return "col";
  if (top === "sg" && suf === ".sg") return "sg";
  if (top === "wsv" && [".bin", ".sv"].includes(suf)) return "wsv";
  if (top === "a2600" && [".a26", ".bin"].includes(suf)) return "a2600";
  if (top === "a7800" && [".a78", ".bin"].includes(suf)) return "a7800";
  if (top === "videopac" && suf === ".bin") return "videopac";
  if (top === "msx" && [".rom", ".mx1", ".mx2"].includes(suf)) return "msx_rom";
  return null;
}

/** Split into fixed-size banks (last bank may be short), like raw[i:i+sz]. */
function toBanks(raw: Uint8Array, bankSize: number): Uint8Array[] {
  const banks: Uint8Array[] = [];
  for (let i = 0; i < raw.length; i += bankSize)
    banks.push(raw.subarray(i, Math.min(i + bankSize, raw.length)));
  return banks;
}

/**
 * Return the `.lzma` body for a payload, or null to keep uncompressed.
 * 1:1 with `compress_payload_lzma`. Container modes (gb/sms_md) never return null.
 */
export function compressPayloadLzma(
  mode: string,
  raw: Uint8Array,
  lzmaRaw: LzmaRaw,
  opts: { compressGbSpeed?: boolean } = {},
): Uint8Array | null {
  if (mode === "gb") {
    const bankSize = 16384;
    const banks = toBanks(raw, bankSize);
    const compressedBanks = banks.map((b) => lzmaRaw(b));
    const compressIts = banks.map(() => true);
    if (banks.length > 0) compressIts[0] = false; // bank 0 always raw

    if (opts.compressGbSpeed) {
      let credit = 26;
      const sizes = compressedBanks
        .slice(1)
        .map((b) => b.length)
        .filter((i) => i > 98);
      const ordered = [...sizes].sort((a, b) => a - b);
      if (credit > ordered.length) credit = ordered.length - 1;
      const threshold = ordered.length ? ordered[credit] : 0;
      for (let i = 0; i < compressedBanks.length; i++)
        if (compressedBanks[i].length >= threshold) compressIts[i] = false;
    }

    const outBanks: Uint8Array[] = [];
    for (let i = 0; i < banks.length; i++)
      outBanks.push(compressIts[i] ? compressedBanks[i] : banks[i]);
    return concat(outBanks);
  }

  if (mode === "sms_md") {
    const bankSize = 128 * 1024;
    const banks = toBanks(raw, bankSize);
    const compressedBanks = banks.map((b) => lzmaRaw(b));
    const parts: Uint8Array[] = [
      new Uint8Array([0x53, 0x4d, 0x53, 0x2b]), // "SMS+"
      int32le(compressedBanks.length),
    ];
    for (const b of compressedBanks) parts.push(int32le(b.length));
    for (const b of compressedBanks) parts.push(b);
    return concat(parts);
  }

  const cap = CAPPED_MODES[mode];
  if (cap !== undefined) {
    if (raw.length > cap) return null;
    return lzmaRaw(raw);
  }
  return null;
}

/** Same as Python's `p.stem + ".lzma"` (strip final ext, append .lzma). */
function sidecarName(path: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const base = slash < 0 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot <= 0 ? base : base.slice(0, dot);
  return dir + stem + ".lzma";
}

export interface PackResult {
  files: StagedFile[];
  compressed: number;
  skipped: number;
}

/**
 * Apply ROM `.lzma` pre-compression to a staged tree (in memory), 1:1 with
 * `pack_staged_roms` (minus the deferred `.dsk → .cdk`). Operates on files whose
 * paths are under "roms/"; replaces each compressible ROM with its `.lzma`
 * sidecar (and drops the original), honoring the dedupe + not-smaller skip rules.
 * Non-rom files pass through untouched.
 */
export function packStagedRoms(
  files: StagedFile[],
  lzmaRaw: LzmaRaw,
  opts: { compressGbSpeed?: boolean } = {},
): PackResult {
  // _dedupe_uncompressed_vs_lzma: drop an uncompressed file when a sibling
  // <stem>.lzma already exists in the same dir.
  const present = new Set(files.map((f) => f.path));
  const deduped = files.filter((f) => {
    if (f.path.toLowerCase().endsWith(".lzma")) return true;
    return !present.has(sidecarName(f.path));
  });

  let compressed = 0;
  let skipped = 0;
  const out: StagedFile[] = [];

  for (const f of deduped) {
    const lower = f.path.toLowerCase();
    if (lower.endsWith(".lzma") || lower.endsWith(".cdk")) {
      out.push(f);
      continue;
    }
    // only roms/<...> participate; everything else passes through
    if (!(f.path === "roms" || f.path.startsWith("roms/"))) {
      out.push(f);
      continue;
    }
    const rel = f.path.slice("roms/".length);
    const mode = modeForPath(rel);
    if (mode === null) {
      out.push(f);
      continue;
    }

    let raw = f.data;
    const top = rel.split("/")[0]?.toLowerCase();
    if (top === "md" && mode === "sms_md") raw = byteswap16(raw);

    const body = compressPayloadLzma(mode, raw, lzmaRaw, opts);
    if (body === null || body.length >= raw.length) {
      out.push(f); // keep uncompressed original
      skipped++;
      continue;
    }
    out.push({ path: sidecarName(f.path), data: body });
    compressed++;
  }

  return { files: out, compressed, skipped };
}
