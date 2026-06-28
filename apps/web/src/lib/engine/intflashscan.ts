/**
 * Host-side internal-flash bank recognition over SWD.
 *
 * Scans internal-flash banks using a fast probe-based approach over WebUSB.
 * Phase 1: Quick Probes (Vector table for OFW identification)
 * Phase 2 & 3: Island Discovery & Sizing (4K probes in 32K strides, then circumfix)
 */

/** Reads `len` bytes of internal flash at absolute `addr` (e.g. 0x08000000). */
export type IntReadFn = (addr: number, len: number) => Promise<Uint8Array>;

export const INT_BANK_BASES = [0x08000000, 0x08100000] as const;
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
  /** Official firmware present in this bank (model + stock/patched), or undefined. */
  ofw?: { model: "mario" | "zelda"; patched: boolean };
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

/** Detect Retro-Go in `buf` and pull a "v1.2.3…" version token (GIT_TAG style). */
function retroGoInfo(buf: Uint8Array): { present: boolean; version?: string } {
  const s = new TextDecoder("latin1").decode(buf);
  const present = s.includes(RETROGO_SIG);
  // GIT_TAG is baked as "Retro-Go [SD ]<tag>". Be tolerant of the "SD " (older retro-go
  // omits it) and capture either a real version ("v1.3.2-13-g…") or the untagged-build
  // sentinel "NOTAG".
  const m = s.match(/Retro-Go (?:SD )?(v\d[\w.+-]*|NOTAG)/);
  return { present, version: m ? m[1] : undefined };
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
    let hasRetroGo = false;

    // Orchestration optimization: If this bank is already confirmed to be Mario/Zelda OFW,
    // we absolutely do not need to download its payload to do a deep search for Retro-Go strings.
    if (model === null) {
      try {
        const len = Math.min((size + 3) & ~3, maxTop);
        const data = await read(base, len);
        const rg = retroGoInfo(data);
        hasRetroGo = rg.present;
        retroGoVersion = rg.version;
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
      ofw,
    });
  }
  return banks;
}
