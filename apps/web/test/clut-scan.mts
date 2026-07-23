import { findClutInRam, findFullPaletteInRam } from "../src/lib/engine/screenshot.ts";

// Build a synthetic 128 KiB DTCM dump.
const dtcm = new Uint8Array(0x20000);
const words = new Uint32Array(dtcm.buffer);

// Noise: pointers, counters, junk (values > 0xffffff so they can't be
// mistaken for RGB888 entries), plus some zero runs (BSS).
for (let i = 0; i < words.length; i++) {
  words[i] = i % 7 === 0 ? 0 : (0x24000000 + i * 4) >>> 0;
}

// PICO-8 palette (16 entries, RGB888).
const pico8 = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7,
  0xfff1e8, 0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c,
  0xff77a8, 0xffccaa,
];
const darken = (e: number) => {
  const r = Math.floor((((e >>> 16) & 0xff) * 60) / 100);
  const g = Math.floor((((e >>> 8) & 0xff) * 60) / 100);
  const b = Math.floor(((e & 0xff) * 60) / 100);
  return (r << 16) | (g << 8) | b;
};

const base = 0x5432; // arbitrary word offset
for (let i = 0; i < 16; i++) {
  words[base + i] = pico8[i];
  words[base + 16 + i] = darken(pico8[i]);
}
// Overlay entries at [64..68)
words[base + 64] = 0xffff00;
words[base + 65] = 0x00ff00;
words[base + 66] = 0xff0000;
words[base + 67] = 0xffffff;
// Clear the rest of the array footprint (unused slots are BSS zeros).
for (let i = 32; i < 64; i++) words[base + i] = 0;

const scan = findClutInRam(dtcm);
if (!scan) throw new Error("FAIL: palette not found");
if (scan.wordOffset !== base || scan.count !== 16) {
  throw new Error(`FAIL: scan meta off=${scan.wordOffset} count=${scan.count}`);
}
const clut = scan.clut;
for (let i = 0; i < 16; i++) {
  if (clut[i] !== pico8[i]) throw new Error(`FAIL: entry ${i}: ${clut[i].toString(16)} != ${pico8[i].toString(16)}`);
  if (clut[16 + i] !== darken(pico8[i])) throw new Error(`FAIL: twin ${i}`);
}
if (clut[64] !== 0xffff00 || clut[67] !== 0xffffff) throw new Error("FAIL: overlay");

// Negative test: no palette present -> null.
for (let i = 0; i < 68; i++) words[base + i] = 0;
if (findClutInRam(dtcm) !== null) throw new Error("FAIL: false positive on noise");

// --- Full 256-entry palette scan (standalone apps, e.g. Doom) ---
// Synthetic AXI SRAM: pointer noise + a zero run (all-valid but colorless) +
// the real palette, with the "framebuffer" region excluded.
const AXI_BASE = 0x24000000;
const axi = new Uint8Array(0x40000);
const aw = new Uint32Array(axi.buffer);
for (let i = 0; i < aw.length; i++) {
  aw[i] = i % 5 === 0 ? 0 : (0x08000000 + i * 4) >>> 0;
}
for (let i = 0x2000; i < 0x2400; i++) aw[i] = 0; // long zero run (valid words, 1 color)

// Doom-ish palette: 8 ramps of 32 shades each.
const doomPal = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  const ramp = i >> 5, shade = (i & 31) * 8;
  doomPal[i] = ((ramp & 1 ? shade : 0) << 16) | ((ramp & 2 ? shade : 0) << 8) | (ramp & 4 ? shade : shade >> 2);
}
const palOff = 0x9000;
for (let i = 0; i < 256; i++) aw[palOff + i] = doomPal[i];

// Fake framebuffer region inside the dump that would otherwise look like a
// valid table — must be excluded by address range.
const fbOff = 0x4000;
for (let i = 0; i < 300; i++) aw[fbOff + i] = 0x00112233;

const used: number[] = [];
for (let i = 0; i < 256; i += 2) used.push(i); // frame uses 128 distinct indices

const fullScan = findFullPaletteInRam(
  [{ base: AXI_BASE, data: axi }],
  used,
  [{ start: AXI_BASE + fbOff * 4, end: AXI_BASE + (fbOff + 300) * 4 }],
);
if (!fullScan) throw new Error("FAIL: full palette not found");
if (fullScan.addr !== AXI_BASE + palOff * 4) {
  throw new Error(`FAIL: full palette at 0x${fullScan.addr.toString(16)}, expected 0x${(AXI_BASE + palOff * 4).toString(16)}`);
}
for (let i = 0; i < 256; i++) {
  if (fullScan.palette[i] !== doomPal[i]) throw new Error(`FAIL: full palette entry ${i}`);
}

// Negative: no palette present -> null (zero runs and noise alone don't win).
for (let i = 0; i < 256; i++) aw[palOff + i] = 0;
if (findFullPaletteInRam([{ base: AXI_BASE, data: axi }], used,
  [{ start: AXI_BASE + fbOff * 4, end: AXI_BASE + (fbOff + 300) * 4 }]) !== null) {
  throw new Error("FAIL: full-palette false positive");
}

console.log("PASS: engine CLUT scan (PICO-8 + twins + overlay) and full 256-entry palette scan (Doom-style), no false positives");
