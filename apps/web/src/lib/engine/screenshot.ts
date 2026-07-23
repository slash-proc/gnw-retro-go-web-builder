import type { SwdTransport } from "@gnw/swd-transport";

// LTDC layer-1 registers (STM32H7B0).
const LTDC_BASE = 0x50001000;
const LTDC_L1CFBAR = LTDC_BASE + 0x0AC;
const LTDC_L1CFBLR = LTDC_BASE + 0x0B0;
const LTDC_L1WHPCR = LTDC_BASE + 0x088;
const LTDC_L1WVPCR = LTDC_BASE + 0x08C;
const LTDC_L1PFCR = LTDC_BASE + 0x094;

const PIXEL_FORMATS: Record<number, { bpp: number; fmt: string }> = {
  0x00: { bpp: 4, fmt: "ARGB8888" },
  0x01: { bpp: 3, fmt: "RGB888" },
  0x02: { bpp: 2, fmt: "RGB565" },
  0x04: { bpp: 2, fmt: "ARGB4444" },
  0x05: { bpp: 1, fmt: "L8" },
  0x07: { bpp: 2, fmt: "AL88" },
};

// --- L8 (LUT8) palette recovery -------------------------------------------
// The LTDC's CLUT is write-only (LTDC_LxCLUTWR), so the palette can't be read
// back from the peripheral. The Retro-Go firmware, however, stages the CLUT in
// a static `active_clut[]` uint32 RGB888 array in DTCM BSS
// (references/game-and-watch-retro-go-sd/Core/Src/gw_lcd.c): cart entries at
// [0..count), exact 40%-darkened twins at [count..2*count) (channel*60/100,
// integer math), overlay theme at [64..68). The address varies per build (no
// ELF symbols in the browser), but the entry/darkened-twin pairing is a
// distinctive fingerprint — so we dump DTCM (128 KiB @ 0x20000000) during the
// halt window and scan for it.
const DTCM_BASE = 0x20000000;
const DTCM_SIZE = 0x20000;
// AXI SRAM — scanned for full 256-entry palettes (standalone/homebrew apps
// like Doom that drive the LTDC CLUT with all 256 slots rather than going
// through the engine's 32-entry lcd_set_clut ABI).
const AXI_BASE = 0x24000000;
const AXI_SIZE = 0x100000;
const CLUT_ENTRIES = 68; // LCD_CLUT_CACHE_MAX*2 + LCD_OVERLAY_CLUT_MAX
const DARKEN_KEEP = 60;  // 100 - LCD_DARKEN_PERCENT

function darkenEntry(e: number): number {
  const r = Math.floor((((e >>> 16) & 0xff) * DARKEN_KEEP) / 100);
  const g = Math.floor((((e >>> 8) & 0xff) * DARKEN_KEEP) / 100);
  const b = Math.floor(((e & 0xff) * DARKEN_KEEP) / 100);
  return (r << 16) | (g << 8) | b;
}

export interface ClutScanResult {
  clut: Uint32Array;   // full 68-entry RGB888 array
  wordOffset: number;  // word offset of active_clut[] within the DTCM dump
  count: number;       // detected cart-palette entry count
}

/** Locate active_clut[] in a DTCM dump; returns the full 68-entry RGB888
 *  array (plus scan metadata), or null if the fingerprint isn't found. */
export function findClutInRam(dtcm: Uint8Array): ClutScanResult | null {
  const words = new Uint32Array(
    dtcm.buffer, dtcm.byteOffset, Math.floor(dtcm.byteLength / 4),
  );
  let bestOff = -1;
  let bestCount = 0;
  let bestNonZero = 0;

  for (let b = 0; b + CLUT_ENTRIES <= words.length; b++) {
    if (words[b] > 0xffffff) continue;
    // Try the largest plausible cart-palette count first (twins live at
    // [b+c .. b+2c), so the relation itself depends on c).
    for (let c = 32; c >= 2; c--) {
      if (b + 2 * c > words.length) continue;
      let ok = true;
      let nonZero = 0;
      for (let k = 0; k < c; k++) {
        const e = words[b + k];
        if (e > 0xffffff || words[b + c + k] !== darkenEntry(e)) { ok = false; break; }
        if (e !== 0) nonZero++;
      }
      // Zeros trivially darken to zero — demand real colors so we don't
      // lock onto a stretch of blank BSS.
      if (!ok || nonZero < Math.max(2, c >> 3)) continue;
      if (c > bestCount || (c === bestCount && nonZero > bestNonZero)) {
        bestOff = b; bestCount = c; bestNonZero = nonZero;
      }
      break; // largest valid c at this offset found
    }
  }

  if (bestOff < 0) return null;
  const clut = new Uint32Array(CLUT_ENTRIES);
  const avail = Math.min(CLUT_ENTRIES, words.length - bestOff);
  for (let i = 0; i < avail; i++) clut[i] = words[bestOff + i] & 0xffffff;
  return { clut, wordOffset: bestOff, count: bestCount };
}

export interface PaletteScanResult {
  palette: Uint32Array; // 256 RGB888 entries
  addr: number;         // absolute device address of the table
  distinct: number;     // distinct colors it yields for the used indices
}

/** Locate a full 256-entry RGB888 CLUT source table in RAM dumps.
 *
 *  There is no structural fingerprint for an arbitrary app's palette, but a
 *  real CLUT table must (a) be 256 consecutive words with a clear alpha/top
 *  byte (HAL_LTDC_ConfigCLUT source format), and (b) map the indices the
 *  framebuffer ACTUALLY uses onto many distinct colors — junk or zero runs
 *  map them onto few. Scan every word offset, score by that distinctness.
 *
 *  `usedIndices` = the distinct pixel bytes present in the framebuffer.
 *  `exclude` = absolute address ranges to skip (the framebuffer itself —
 *  index bytes can masquerade as valid words in black-heavy scenes). */
export function findFullPaletteInRam(
  regions: { base: number; data: Uint8Array }[],
  usedIndices: number[],
  exclude: { start: number; end: number }[] = [],
): PaletteScanResult | null {
  const minDistinct = Math.max(8, usedIndices.length >> 2);
  const candidates: { words: Uint32Array; i: number; base: number; distinct: number; anchored: boolean }[] = [];

  for (const { base, data } of regions) {
    const words = new Uint32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    // validRun[i] = length of the run of RGB888-range words starting at i.
    const validRun = new Int32Array(words.length + 1);
    for (let i = words.length - 1; i >= 0; i--) {
      const addr = base + i * 4;
      const excluded = exclude.some(r => addr >= r.start && addr < r.end);
      validRun[i] = !excluded && words[i] <= 0xffffff ? validRun[i + 1] + 1 : 0;
    }
    for (let i = 0; i + 256 <= words.length; i++) {
      if (validRun[i] < 256) continue;
      const colors = new Set<number>();
      for (const idx of usedIndices) colors.add(words[i + idx]);
      if (colors.size < minDistinct) continue;
      // "Anchored" = the word before the window is NOT an RGB888-range value,
      // i.e. this looks like the true start of an array rather than a window
      // slid into the middle of one.
      candidates.push({ words, i, base, distinct: colors.size, anchored: i === 0 || validRun[i - 1] === 0 });
    }
  }
  if (candidates.length === 0) return null;

  // Distinctness alone can't tell a real table from the same table shifted by
  // a word (both map the used indices onto ~equally many colors) — among the
  // near-best scorers, prefer an anchored start, then the lowest address.
  const maxDistinct = Math.max(...candidates.map(c => c.distinct));
  const near = candidates.filter(c => c.distinct >= maxDistinct * 0.9);
  const pick = near.find(c => c.anchored) ?? near[0];

  const palette = new Uint32Array(256);
  for (let k = 0; k < 256; k++) palette[k] = pick.words[pick.i + k] & 0xffffff;
  return { palette, addr: pick.base + pick.i * 4, distinct: pick.distinct };
}

// Address of the last successfully recovered full palette table. Standalone
// apps keep their CLUT source table at a stable address, so subsequent
// captures revalidate it with a single ~1 KB read instead of re-scanning RAM.
let cachedPaletteAddr: number | null = null;

export async function captureScreenshot(
  transport: SwdTransport,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageData> {
  await transport.halt();
  let fb_addr = 0;
  let pitch = 0;
  let width = 0;
  let height = 0;
  let bpp = 0;
  let fmt = "";
  let raw: Uint8Array;
  let dtcm: Uint8Array | null = null;
  let fullPal: PaletteScanResult | null = null;
  const hist = new Uint32Array(256);
  const usedIndices: number[] = [];

  try {
    fb_addr = (await transport.readWord(LTDC_L1CFBAR)) >>> 0;
    const cfblr = (await transport.readWord(LTDC_L1CFBLR)) >>> 0;
    const whpcr = (await transport.readWord(LTDC_L1WHPCR)) >>> 0;
    const wvpcr = (await transport.readWord(LTDC_L1WVPCR)) >>> 0;
    const pfcr  = (await transport.readWord(LTDC_L1PFCR))  >>> 0;

    width  = ((whpcr >>> 16) & 0x0fff) - (whpcr & 0x0fff);
    height = ((wvpcr >>> 16) & 0x07ff) - (wvpcr & 0x07ff);
    if (width  === 319) width  = 320;
    if (height === 239) height = 240;

    pitch = (cfblr >>> 16) & 0x1fff;
    const formatInfo = PIXEL_FORMATS[pfcr & 0x07] ?? { bpp: 0, fmt: "Unknown" };
    bpp = formatInfo.bpp;
    fmt = formatInfo.fmt;
    if (bpp === 0) throw new Error(`Unsupported pixel format: ${fmt} (PFCR: ${pfcr})`);

    const size = pitch * height;

    // Read the framebuffer in 64 KiB chunks. Passing 64 KiB to readMemory keeps all
    // the 10 ms inter-chunk pacing INSIDE the serialTransport queue entry (busy=true
    // throughout), so the liveness poll cannot fire mid-screenshot and the ST-Link
    // clone never sees an idle SWD bus between chunks.
    // Deliberately NOT using engine/chunkedRead.ts's readMemoryPaced helper here — that
    // helper defaults to small chunks with no delay (good for yielding to other queued
    // ops), which is the OPPOSITE of what this path needs. See AUDIT_NOTES.md item #2.
    const CHUNK = 65536;
    // All reads share the framebuffer pacing (64 KiB chunks, 10 ms apart —
    // see comment above). `total` is the projected grand total for the
    // progress bar; it grows if we decide mid-capture to also dump AXI SRAM,
    // and `last` keeps the bar monotonic. `more` forces the inter-read delay
    // even on a region's final chunk when another region follows.
    let done = 0;
    let total = size + (fmt === "L8" ? DTCM_SIZE : 0);
    const readPaced = async (base: number, len: number, more: boolean): Promise<Uint8Array> => {
      const buf = new Uint8Array(len);
      for (let offset = 0; offset < len; offset += CHUNK) {
        const readLen = Math.min(CHUNK, len - offset);
        const chunk = await transport.readMemory(base + offset, readLen);
        buf.set(chunk, offset);
        done += chunk.length;
        if (onProgress) onProgress(done, total);
        if (offset + readLen < len || more) await new Promise(r => setTimeout(r, 10));
      }
      return buf;
    };

    raw = await readPaced(fb_addr, size, fmt === "L8");
    if (fmt === "L8") {
      // Palette recovery — all extra reads must happen inside this same halt
      // window. Engine carts (≤32-color palettes + darken twins + overlay)
      // resolve from Retro-Go's staged array in DTCM; a framebuffer using
      // indices past that staged-array range means a standalone app (e.g.
      // Doom) driving a full 256-entry CLUT, whose source table could live
      // anywhere in RAM. Reads are ordered cheapest-first: cached address
      // (~1 KB), then DTCM (128 KB), then AXI SRAM streamed 64 KiB at a time
      // with early exit — never the flat 1.2 MB every capture.
      for (const b of raw) hist[b]++;
      for (let i = 0; i < 256; i++) if (hist[i]) usedIndices.push(i);
      const maxIdx = usedIndices.length ? usedIndices[usedIndices.length - 1] : 0;
      const fullPalMode = maxIdx >= 48;
      const exclude = [{ start: fb_addr, end: fb_addr + size }];
      // A wrong-but-plausible table still needs to explain most of the frame's
      // index diversity before we stop looking.
      const goodThresh = Math.max(8, usedIndices.length >> 1);

      if (fullPalMode && cachedPaletteAddr !== null) {
        const start = cachedPaletteAddr - 4;
        const data = await transport.readMemory(start, 4 + 1024);
        const cand = findFullPaletteInRam([{ base: start, data }], usedIndices, exclude);
        if (cand && cand.addr === cachedPaletteAddr && cand.distinct >= goodThresh) {
          fullPal = cand;
        } else {
          cachedPaletteAddr = null; // app changed — fall through to a fresh scan
        }
      }

      if (!fullPal) {
        dtcm = await readPaced(DTCM_BASE, DTCM_SIZE, false);
        if (fullPalMode) {
          const cand = findFullPaletteInRam([{ base: DTCM_BASE, data: dtcm }], usedIndices, exclude);
          if (cand && cand.distinct >= goodThresh) fullPal = cand;
        }
        if (fullPalMode && !fullPal) {
          total += AXI_SIZE;
          const CARRY = 255 * 4;
          let prev: Uint8Array | null = null;
          let best: PaletteScanResult | null = null;
          for (let off = 0; off < AXI_SIZE; off += CHUNK) {
            const chunk = await readPaced(AXI_BASE + off, Math.min(CHUNK, AXI_SIZE - off), true);
            // Prepend the previous chunk's tail so a table straddling the
            // chunk boundary is still seen whole.
            let base = AXI_BASE + off;
            let data = chunk;
            if (prev) {
              const joined = new Uint8Array(prev.length + chunk.length);
              joined.set(prev);
              joined.set(chunk, prev.length);
              base -= prev.length;
              data = joined;
            }
            const cand = findFullPaletteInRam([{ base, data }], usedIndices, exclude);
            if (cand && (!best || cand.distinct > best.distinct)) best = cand;
            if (best && best.distinct >= goodThresh) break;
            prev = chunk.slice(chunk.length - CARRY);
          }
          fullPal = best;
          if (onProgress) onProgress(total, total);
        }
      }
      if (fullPal) cachedPaletteAddr = fullPal.addr;
    }
  } finally {
    await transport.resume();
  }

  // Convert to RGBA ImageData (CPU is resumed before this point)
  const out = new Uint8ClampedArray(width * height * 4);
  const dataView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  if (fmt === "RGB565") {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * pitch;
      for (let x = 0; x < width; x++) {
        const px = dataView.getUint16(rowOffset + x * 2, true);
        const r = ((px >> 11) & 0x1f) << 3;
        const g = ((px >> 5) & 0x3f) << 2;
        const b = (px & 0x1f) << 3;
        const outIdx = (y * width + x) * 4;
        out[outIdx] = r;
        out[outIdx + 1] = g;
        out[outIdx + 2] = b;
        out[outIdx + 3] = 255;
      }
    }
  } else if (fmt === "ARGB8888") {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * pitch;
      for (let x = 0; x < width; x++) {
        const px = dataView.getUint32(rowOffset + x * 4, true);
        const outIdx = (y * width + x) * 4;
        out[outIdx] = (px >> 16) & 0xff;
        out[outIdx + 1] = (px >> 8) & 0xff;
        out[outIdx + 2] = px & 0xff;
        out[outIdx + 3] = (px >> 24) & 0xff;
      }
    }
  } else if (fmt === "L8") {
    const full = fullPal;
    // Engine-cart mode: locate Retro-Go's staged active_clut[] by its
    // darken-twin fingerprint in the DTCM dump.
    const scan = !full && dtcm ? findClutInRam(dtcm) : null;
    const clut = scan?.clut ?? null;

    // Diagnostics for palette-recovery debugging on real hardware.
    {
      const top = usedIndices.slice().sort((a, b) => hist[b] - hist[a]).slice(0, 10)
        .map(idx => `0x${idx.toString(16)}:${hist[idx]}`).join(" ");
      console.info(
        `[screenshot L8] fb=0x${fb_addr.toString(16)} pitch=${pitch} ${width}x${height}; ` +
        `${usedIndices.length} distinct indices, top 10: ${top}`,
      );
      if (full) {
        console.info(
          `[screenshot L8] full 256-entry palette found at 0x${full.addr.toString(16)} ` +
          `(${full.distinct} distinct colors for the used indices)`,
        );
      } else if (scan) {
        const pal = [...scan.clut].map((e, i) => `${i}:${e.toString(16).padStart(6, "0")}`).join(" ");
        console.info(
          `[screenshot L8] engine CLUT found at DTCM+0x${(scan.wordOffset * 4).toString(16)} ` +
          `count=${scan.count}; entries: ${pal}`,
        );
      } else {
        console.warn("[screenshot L8] no palette found in RAM dumps — grayscale fallback");
      }
    }

    for (let y = 0; y < height; y++) {
      const rowOffset = y * pitch;
      for (let x = 0; x < width; x++) {
        const idx = raw[rowOffset + x];
        const outIdx = (y * width + x) * 4;
        if (full) {
          const e = full.palette[idx];
          out[outIdx] = (e >>> 16) & 0xff;
          out[outIdx + 1] = (e >>> 8) & 0xff;
          out[outIdx + 2] = e & 0xff;
        } else if (clut) {
          let e = idx < CLUT_ENTRIES ? clut[idx] : 0;
          // LCD_DARKEN_BIT (0x20) indices whose staged slot is empty (cart
          // palette < 32 entries): reconstruct the intended 40%-darkened
          // twin of the base entry instead of showing black.
          if (e === 0 && idx >= 0x20 && idx < 0x40) e = darkenEntry(clut[idx & 0x1f]);
          out[outIdx] = (e >>> 16) & 0xff;
          out[outIdx + 1] = (e >>> 8) & 0xff;
          out[outIdx + 2] = e & 0xff;
        } else {
          // No palette found — grayscale fallback so the capture still
          // yields a recognizable image instead of failing.
          const v = Math.min(255, idx * 8);
          out[outIdx] = v;
          out[outIdx + 1] = v;
          out[outIdx + 2] = v;
        }
        out[outIdx + 3] = 255;
      }
    }
  } else {
    throw new Error(`Format ${fmt} conversion not implemented in JS yet`);
  }

  return new ImageData(out, width, height);
}
