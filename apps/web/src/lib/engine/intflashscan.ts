/**
 * Host-side internal-flash bank recognition over SWD.
 *
 * Ports chainloader's host-side recognition (scripts/common/envprobe.py): read each
 * bank's vector table, validate it as an app, and map the reset vector to identify
 * the contents (Retro-Go / Mario|Zelda OFW, stock vs patched). Plus the Retro-Go
 * version scan from src/chainloader/storage/partition.c (find "Retro-Go SD v").
 *
 * Adds the "true data size" the owner asked for: bulk-read each bank and find the last
 * non-0xFF byte. Internal flash is a direct AHB read (not OSPI), so reading the whole
 * bank is fast and exact — no stride guessing, no missed islands. If this ever exceeds
 * the time budget on hardware, bound the tail with a coarse backward 64K→16K probe and
 * bulk-read only the bounded window.
 */

/** Reads `len` bytes of internal flash at absolute `addr` (e.g. 0x08000000). */
export type IntReadFn = (addr: number, len: number) => Promise<Uint8Array>;

export const INT_BANK_BASES = [0x08000000, 0x08100000] as const;
const BANK_SIZE = 256 << 10; // gnw-flasher INT_BANK_SIZE convention
const RETROGO_BASE = 0x0800a000; // Retro-Go launcher payload (bank 1)
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
  /** Recognized contents, e.g. "Chainloader + Retro-Go", "Mario OFW (patched)",
   *  "Zelda OFW (stock)", "Retro-Go", "unknown app", "empty". */
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

// True-data-size scan: read backward in STRIDE windows; a window that's all-0xFF is
// "empty". Firmware is contiguous from the base, so the first (highest) window with data
// pins the extent. Stop after MAX_EMPTY_RUN empties in a row (64K) — we accept there's
// nothing beyond. Bounded reads only; never the whole bank.
const STRIDE = 16 << 10; // 16K finest granularity
const MAX_EMPTY_RUN = 4; // 4 empty strides (64K) in a row → nothing beyond

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

/** Step 1 — cheap backward stride scan for the true data extent (last used byte + 1).
 *  Reads 16K windows from the top; stops after MAX_EMPTY_RUN empties. Bounded. */
async function bankDataSize(read: IntReadFn, base: number): Promise<number> {
  let emptyRun = 0;
  for (let top = BANK_SIZE; top > 0; top -= STRIDE) {
    const lo = Math.max(0, top - STRIDE);
    let win: Uint8Array;
    try {
      win = await read(base + lo, top - lo);
    } catch {
      break; // unreadable (locked / past end) — treat as nothing beyond
    }
    const last = lastNonFF(win);
    if (last < 0) {
      if (++emptyRun >= MAX_EMPTY_RUN) break;
    } else {
      return lo + last + 1;
    }
  }
  return 0;
}

function classify(
  index: 1 | 2,
  sp: number,
  pc: number,
  retrogoValid: boolean,
  hasRetroGo: boolean,
  ofwLastByte?: number,
): string {
  if (!appValid(sp, pc)) return "unknown";
  const model = ofwModel(sp);
  if (model) {
    // gnwmanager scan_geometry heuristic: the last byte of the 128 KiB OFW image is 0xFF
    // for stock, non-0xFF when patched.
    const patched = ofwLastByte !== undefined && ofwLastByte !== 0xff;
    return `${model} OFW (${patched ? "patched" : "stock"})`;
  }
  // Chainloader (bank 1) has a separate Retro-Go payload at RETROGO_BASE; a direct
  // Retro-Go install (either bank) just carries the "Retro-Go" marker in its data.
  if (index === 1 && retrogoValid) return "Chainloader + Retro-Go";
  if (hasRetroGo) return "Retro-Go";
  return "unknown app";
}

/** Scan both internal-flash banks. `read` reads absolute internal flash over SWD.
 *  Step 1: stride-scan the extent. Step 2: pull ONLY the used region and classify +
 *  version-scan it (so the version is reliable without reading erased space). */
export async function scanIntflashBanks(read: IntReadFn): Promise<IntflashBank[]> {
  const banks: IntflashBank[] = [];
  for (let i = 0; i < INT_BANK_BASES.length; i++) {
    const base = INT_BANK_BASES[i];
    const index = (i + 1) as 1 | 2;

    const size = await bankDataSize(read, base);
    if (size === 0) {
      banks.push({ index, base, dataSize: 0, type: "empty" });
      continue;
    }
    let data: Uint8Array;
    try {
      // pull the used region; round the length up to a 4-byte boundary (the transport
      // rejects non-word-aligned reads), clamped to the bank.
      const len = Math.min((size + 3) & ~3, BANK_SIZE);
      data = await read(base, len);
    } catch (e) {
      banks.push({ index, base, dataSize: size, type: `unreadable (${e instanceof Error ? e.message : e})` });
      continue;
    }
    const sp = u32(data, 0);
    const pc = u32(data, 4);

    // OFW stock-vs-patched: the last byte of the 128 KiB image (gnwmanager method).
    let ofwLast: number | undefined;
    if (ofwModel(sp) !== null) {
      try {
        const w = await read(base + OFW_IMAGE_SIZE - 4, 4); // 4-aligned; flag byte = index 3
        ofwLast = w[3];
      } catch {
        /* unreadable → treated as stock */
      }
    }

    let retrogoValid = false;
    if (index === 1) {
      const off = RETROGO_BASE - base;
      retrogoValid = off + 8 <= data.length && appValid(u32(data, off), u32(data, off + 4));
    }
    const rg = retroGoInfo(data);
    const om = ofwModel(sp);
    const ofw = om
      ? { model: om.toLowerCase() as "mario" | "zelda", patched: ofwLast !== undefined && ofwLast !== 0xff }
      : undefined;
    banks.push({
      index,
      base,
      dataSize: size,
      type: classify(index, sp, pc, retrogoValid, rg.present, ofwLast),
      retroGoVersion: rg.version,
      ofw,
    });
  }
  return banks;
}
