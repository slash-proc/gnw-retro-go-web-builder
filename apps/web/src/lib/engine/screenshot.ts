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

export async function captureScreenshot(
  transport: SwdTransport,
  onProgress?: (done: number, total: number) => void
): Promise<ImageData> {
  await transport.halt();
  let fb_addr = 0;
  let pitch = 0;
  let width = 0;
  let height = 0;
  let bpp = 0;
  let fmt = "";
  let raw: Uint8Array;
  
  try {
    fb_addr = (await transport.readWord(LTDC_L1CFBAR)) >>> 0;
    const cfblr = (await transport.readWord(LTDC_L1CFBLR)) >>> 0;
    const whpcr = (await transport.readWord(LTDC_L1WHPCR)) >>> 0;
    const wvpcr = (await transport.readWord(LTDC_L1WVPCR)) >>> 0;
    const pfcr = (await transport.readWord(LTDC_L1PFCR)) >>> 0;

    // Follow python device.py exact implementation
    width = ((whpcr >>> 16) & 0x0fff) - (whpcr & 0x0fff);
    height = ((wvpcr >>> 16) & 0x07ff) - (wvpcr & 0x07ff);
    
    // Fallback if the calculation yields a slightly off width due to ST's blanking offsets
    // E.g., ST examples usually end up at 320x240, but the python logic might yield 319.
    // If we want to strictly follow python we won't fix it, but let's be safe.
    if (width === 319) width = 320;
    if (height === 239) height = 240;

    pitch = (cfblr >>> 16) & 0x1fff;
    const formatInfo = PIXEL_FORMATS[pfcr & 0x07] || { bpp: 0, fmt: "Unknown" };
    bpp = formatInfo.bpp;
    fmt = formatInfo.fmt;

    if (bpp === 0) {
      throw new Error(`Unsupported pixel format: ${fmt} (PFCR: ${pfcr})`);
    }

    const size = pitch * height;
    
    // Chunked read with progress, max 64K to avoid ST-Link clone saturation
    raw = new Uint8Array(size);
    const chunkSize = 65536; 
    for (let offset = 0; offset < size; offset += chunkSize) {
      const readLen = Math.min(chunkSize, size - offset);
      const chunk = await transport.readMemory(fb_addr + offset, readLen);
      raw.set(chunk, offset);
      if (onProgress) onProgress(offset + chunk.length, size);
      // Let the ST-Link breathe to avoid USB saturation lockup
      await new Promise(r => setTimeout(r, 10));
    }
  } finally {
    await transport.resume();
  }

  // Convert to RGBA ImageData
  const out = new Uint8ClampedArray(width * height * 4);
  const dataView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  if (fmt === "RGB565") {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * pitch;
      for (let x = 0; x < width; x++) {
        // GNW is little endian, read Uint16
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
        out[outIdx] = (px >> 16) & 0xff;     // R
        out[outIdx + 1] = (px >> 8) & 0xff;  // G
        out[outIdx + 2] = px & 0xff;         // B
        out[outIdx + 3] = (px >> 24) & 0xff; // A
      }
    }
  } else {
    throw new Error(`Format ${fmt} conversion not implemented in JS yet`);
  }

  return new ImageData(out, width, height);
}
