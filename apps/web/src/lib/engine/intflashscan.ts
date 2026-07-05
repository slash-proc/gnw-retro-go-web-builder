/**
 * Host-side internal-flash bank recognition over SWD.
 *
 * Scans internal-flash banks using a fast probe-based approach over WebUSB.
 * Phase 1: Quick Probes (Vector table for OFW identification)
 * Phase 2 & 3: Island Discovery & Sizing (4K probes in 32K strides, then circumfix)
 */

import { BANK_BASE } from "./addr.js";
import type { MemReadFn as IntReadFn } from "./addr.js";
import { locateSuperblock, readSuperblock, FLAG_LITTLEFS_LENGTH } from "@gnw/gnw-patch";
export type { IntReadFn };

export const INT_BANK_BASES = [BANK_BASE[1], BANK_BASE[2]] as const;
const BANK_SIZE = 256 << 10; // gnw-flasher INT_BANK_SIZE convention
// OFW initial SP (== gnwmanager's mario/zelda_int_sig as a little-endian u32) identifies
// the device model; stock-vs-patched then comes from the OFW image's last byte.
const OFW_SP: Record<string, number> = { Mario: 0x20011330, Zelda: 0x2001b620 };
const OFW_IMAGE_SIZE = 128 << 10; // a G&W OFW image is 128 KiB; byte (size-1) is the flag
const RETROGO_SIG = "Retro-Go"; // broad product marker — present in any retro-go era

export interface IntflashBank {
  index: 1 | 2;
  base: number;
  /** True used size in bytes (last non-0xFF + 1); 0 when erased. */
  dataSize: number;
  /** Recognized contents, e.g. "Mario OFW (patched)", "Zelda OFW (stock)", "Retro-Go", "unknown app", "empty". */
  type: string;
  /** Retro-Go version token ("v1.2.3…") if the signature is present. */
  retroGoVersion?: string;
  /** True iff the GIT_TAG string said "Retro-Go SD" (the fork name — supports SD-card use,
   *  doesn't mean THIS build is one; see installOrigin in classify.ts for that). */
  retroGoIsSdFork?: boolean;
  /** Official firmware present in this bank (model + stock/patched), or undefined. */
  ofw?: { model: "mario" | "zelda"; patched: boolean };
  /** True iff gnw-patch's own "GWLB" layout superblock is embedded in this bank's intflash
   *  bytes — patched in by BOTH this tool's Flash- and SD-mode install paths (encodes
   *  frogfsOffset/reservedOffset/littlefsLength etc.), so its presence means this bank's image
   *  is web-builder-aware (see classify.ts's installOrigin). */
  layoutSuperblockPresent?: boolean;
  /** True iff that layout superblock has FLAG_LITTLEFS_LENGTH set — patchSuperblock() only
   *  ever sets this when a littlefsLength was actually passed in, which only this tool's
   *  Flash-mode build ever does (SD-mode's patchSuperblock call never passes one). This is a
   *  far more reliable flash-vs-sd signal than probing extflash for a real LittleFS partition
   *  superblock — that scan can miss it even on a genuine Flash-mode device. */
  layoutSuperblockHasLittlefs?: boolean;
}

const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** envprobe _app_valid: sane initial SP + a thumb reset vector in internal flash. */
function appValid(sp: number, pc: number): boolean {
  const spOk = [0x20, 0x24, 0x30, 0x38].includes(sp >>> 24) && sp !== 0 && sp !== 0xffffffff;
  const pcOk = (pc >>> 24) === 0x08 && (pc & 1) === 1 && (pc & ~1) >= 0x08000000 && (pc & ~1) < 0x08200000;
  return spOk && pcOk;
}

/** The OFW model whose initial SP matches, or null. */
function ofwModel(sp: number): string | null {
  for (const name of Object.keys(OFW_SP)) if (sp === OFW_SP[name]) return name;
  return null;
}

const STRIDE = 32 << 10;     // 32K strides
const PROBE_SIZE = 4 << 10;  // 4K probes
const MAX_EMPTY_RUN = 4;     // Stop after 4 empty strides (128K gap)

/** Index of the last non-0xFF byte in `win`, or -1 if all erased. */
function lastNonFF(win: Uint8Array): number {
  for (let i = win.length - 1; i >= 0; i--) if (win[i] !== 0xff) return i;
  return -1;
}

/** Detect Retro-Go in `buf` and pull a "v1.2.3…" version token (GIT_TAG style), plus whether
 *  the "SD" fork-name marker was present. GIT_TAG is baked as "Retro-Go [SD ]<tag>" — "SD" here
 *  just names the fork (it supports SD-card use, doesn't mean this particular build IS one; a
 *  Flash-mode build from the same SD-capable fork still says "Retro-Go SD"), so it must be
 *  preserved for display, not silently dropped. Older, pre-SD-fork retro-go omits it entirely. */
function retroGoInfo(buf: Uint8Array): { present: boolean; version?: string; isSdFork?: boolean } {
  const s = new TextDecoder("latin1").decode(buf);
  const present = s.includes(RETROGO_SIG);
  const m = s.match(/Retro-Go (SD )?(v\d[\w.+-]*|NOTAG)/);
  return { present, version: m ? m[2] : undefined, isSdFork: m ? !!m[1] : undefined };
}

async function getBankDataSize(read: IntReadFn, base: number, maxTop: number): Promise<number> {
  let emptyRun = 0;
  let roughTop = 0;

  // 1. Quick Island Discovery (32K strides)
  for (let top = maxTop; top > 0; top -= STRIDE) {
    const probeLo = Math.max(0, top - PROBE_SIZE);
    let win: Uint8Array;
    try {
      win = await read(base + probeLo, Math.min(PROBE_SIZE, top));
    } catch {
      break; 
    }
    
    if (lastNonFF(win) < 0) {
      if (++emptyRun >= MAX_EMPTY_RUN) break;
    } else {
      roughTop = top;
      break;
    }
  }

  if (roughTop === 0) return 0;

  // 2. Circumfix-scan to find the exact border (16K then 8K steps)
  // We know data exists at `roughTop`. The previous 32K stride's probe was empty,
  // so the true end is somewhere between roughTop and (roughTop + 32K - 4K).
  let searchBase = roughTop;
  const searchCeil = Math.min(maxTop, roughTop + STRIDE - PROBE_SIZE);
  
  for (let step = 16 << 10; step >= 8 << 10; step >>>= 1) {
     if (searchBase + step > searchCeil) continue;
     
     const probeLo = searchBase + step - PROBE_SIZE;
     let win: Uint8Array;
     try {
       win = await read(base + probeLo, PROBE_SIZE);
     } catch { 
       break; 
     }
     
     if (lastNonFF(win) >= 0) {
       // Data found, boundary is higher up
       searchBase += step;
     }
  }
  
  return searchBase;
}

function classify(
  sp: number,
  pc: number,
  hasRetroGo: boolean,
  ofwLastByte?: number,
): string {
  if (!appValid(sp, pc)) return "unknown data";
  const model = ofwModel(sp);
  if (model) {
    // gnwmanager scan_geometry heuristic: the last byte of the 128 KiB OFW image is 0xFF
    // for stock, non-0xFF when patched.
    const patched = ofwLastByte !== undefined && ofwLastByte !== 0xff;
    return `${model} OFW (${patched ? "patched" : "stock"})`;
  }
  if (hasRetroGo) return "Retro-Go";
  return "unknown app";
}

/** Scan both internal-flash banks. `read` reads absolute internal flash over SWD.
 *  Phase 1: Quick Probes (Vector table for OFW identification)
 *  Phase 2 & 3: Island Discovery & Sizing (4K probes in 32K strides, then circumfix)
 *  Phase 4: Deep Search for Retro-Go if not found yet.
 */
export async function scanIntflashBanks(read: IntReadFn): Promise<IntflashBank[]> {
  const banks: IntflashBank[] = [];

  for (let i = 0; i < INT_BANK_BASES.length; i++) {
    const base = INT_BANK_BASES[i];
    const index = (i + 1) as 1 | 2;

    let maxTop = BANK_SIZE;
    let head: Uint8Array;
    try {
      head = await read(base, 8);
    } catch (e) {
      banks.push({ index, base, dataSize: 0, type: `unreadable (${e instanceof Error ? e.message : e})` });
      continue;
    }
    const sp = u32(head, 0);
    const pc = u32(head, 4);

    let ofwLast: number | undefined;
    const model = ofwModel(sp);

    if (model !== null) {
      maxTop = OFW_IMAGE_SIZE;
      try {
        const w = await read(base + OFW_IMAGE_SIZE - 4, 4); // 4-aligned; flag byte = index 3
        ofwLast = w[3];
      } catch {
        /* unreadable → treated as stock */
      }
    }

    const size = await getBankDataSize(read, base, maxTop);
    if (size === 0) {
      banks.push({ index, base, dataSize: 0, type: "empty" });
      continue;
    }

    let retroGoVersion: string | undefined;
    let retroGoIsSdFork: boolean | undefined;
    let hasRetroGo = false;
    let layoutSuperblockPresent = false;
    let layoutSuperblockHasLittlefs = false;

    // Orchestration optimization: If this bank is already confirmed to be Mario/Zelda OFW,
    // we absolutely do not need to download its payload to do a deep search for Retro-Go strings.
    if (model === null) {
      try {
        const len = Math.min((size + 3) & ~3, maxTop);
        const data = await read(base, len);
        const rg = retroGoInfo(data);
        hasRetroGo = rg.present;
        retroGoVersion = rg.version;
        retroGoIsSdFork = rg.isSdFork;
        // Same buffer, no extra device read — just also probe it for gnw-patch's layout
        // superblock (see classify.ts's installOrigin: flash/sd/old discrimination).
        try {
          const off = locateSuperblock(data);
          layoutSuperblockPresent = true;
          const sb = readSuperblock(data, off);
          layoutSuperblockHasLittlefs = !!(sb.flags & FLAG_LITTLEFS_LENGTH) && sb.littlefsLength > 0;
        } catch {
          layoutSuperblockPresent = false;
        }
      } catch (e) {
        // Just fail the Retro-Go search, keep the size.
      }
    }

    const ofw = model
      ? { model: model.toLowerCase() as "mario" | "zelda", patched: ofwLast !== undefined && ofwLast !== 0xff }
      : undefined;

    banks.push({
      index,
      base,
      dataSize: size,
      type: classify(sp, pc, hasRetroGo, ofwLast),
      retroGoVersion,
      retroGoIsSdFork,
      ofw,
      layoutSuperblockPresent,
      layoutSuperblockHasLittlefs,
    });
  }
  return banks;
}
