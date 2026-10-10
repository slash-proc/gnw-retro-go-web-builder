#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-carouselatlas-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/carouselAtlas.ts")],
  outfile: join(out, "carouselAtlas.mjs"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "silent",
});
const { carouselAtlasFiles, carouselAtlasCacheSignature, carouselAtlasSignature, carouselAtlasContentFingerprint, carouselImageDimensions } = await import(pathToFileURL(join(out, "carouselAtlas.mjs")).href);

const sourceId = "covers-source";
const owner = "celeste-title";
const lower = "homebrew/celeste.png";
const upper = "homebrew/Celeste.png\u0000duplicate";
const owners = new Map([[`${sourceId}\u0000${lower}`, owner]]);
const origins = new Map([[lower, sourceId], [upper, sourceId]]);
const names = new Map([[owner, "Celeste"]]);
const files = new Map([[lower, new Uint8Array([1])], [upper, new Uint8Array([2])]]);
const conflicts = [];
const selected = carouselAtlasFiles(files, origins, owners, names, new Map(), (key, candidates, chosen) => {
  conflicts.push({ key, candidates, chosen });
});
if (selected.length !== 1 || selected[0].path !== upper || selected[0].file[0] !== 2) {
  throw new Error("the displayed spelling must choose the matching original art");
}
if (conflicts.length !== 1 || conflicts[0].candidates.length !== 2) {
  throw new Error("multiple covers must be reported once per game");
}
const reversed = carouselAtlasFiles(new Map([...files].reverse()), origins, owners, names);
if (reversed[0].path !== upper) throw new Error("scan order must not change the chosen art");
const overridden = carouselAtlasFiles(files, origins, owners, names, new Map([[owner, lower]]));
if (overridden[0].path !== lower) throw new Error("an explicit cover update must take precedence");
const signature = (path) => carouselAtlasCacheSignature(sourceId, [{ key: owner, path, size: 1 }]);
if (signature(lower) === signature(upper)) throw new Error("a changed winner must invalidate the atlas cache");
// Oracle for the persisted format: the previous BigInt algorithm. Include unsigned
// carries, nonzero byte offsets, and Unicode metadata so existing caches stay valid.
function referenceFingerprint(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}
for (const bytes of [new Uint8Array(), new TextEncoder().encode("cover/日本語.png"),
  Uint8Array.from({ length: 65539 }, (_, i) => (i * 73 + 255) & 255).subarray(3)]) {
  if (carouselAtlasContentFingerprint(bytes) !== referenceFingerprint(bytes)) {
    throw new Error("atlas fingerprint must match the persisted FNV-1a oracle");
  }
}
const metadata = [
  { key: "日本語", path: "covers/a.png", size: 123, lastModified: 456 },
  { key: "abc", path: "covers/b.png", size: 321, contentFingerprint: "f00" },
];
const ordered = [...metadata].sort((a, b) => a.key.localeCompare(b.key));
const text = `${sourceId}\n${ordered.map(e => `${e.key}\0${e.path ?? ""}\0${e.size}\0${e.lastModified ?? 0}${e.contentFingerprint === undefined ? "" : `\0${e.contentFingerprint}`}`).join("\n")}`;
if (carouselAtlasSignature(sourceId, metadata) !== referenceFingerprint(new TextEncoder().encode(text))) {
  throw new Error("atlas metadata signature must preserve existing cache identity");
}
const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47], 0);
new DataView(png.buffer).setUint32(16, 640, false);
new DataView(png.buffer).setUint32(20, 480, false);
if (JSON.stringify(carouselImageDimensions(png)) !== JSON.stringify({ width: 640, height: 480 })) throw new Error("PNG dimensions must be read from its header");
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00]);
if (JSON.stringify(carouselImageDimensions(jpeg)) !== JSON.stringify({ width: 640, height: 480 })) throw new Error("JPEG dimensions must be read from its SOF header");
const webp = new Uint8Array(30);
webp.set([0x52, 0x49, 0x46, 0x46], 0);
webp.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
webp[24] = 127; webp[25] = 1; webp[27] = 169; webp[28] = 0;
if (JSON.stringify(carouselImageDimensions(webp)) !== JSON.stringify({ width: 384, height: 170 })) throw new Error("WebP dimensions must be read from its extended header");
const bmp = new Uint8Array(54);
bmp.set([0x42, 0x4d], 0);
new DataView(bmp.buffer).setUint32(14, 40, true);
new DataView(bmp.buffer).setInt32(18, 640, true);
new DataView(bmp.buffer).setInt32(22, 480, true);
if (JSON.stringify(carouselImageDimensions(bmp)) !== JSON.stringify({ width: 640, height: 480 })) throw new Error("BMP dimensions must be read from its DIB header");
if (carouselImageDimensions(new Uint8Array([0, 1, 2, 3])) !== null) throw new Error("unknown image headers must retain the normal browser decode path");
console.log("carousel atlas cover selection, cache fingerprints, and thumbnail dimension readers: 14 checks passed");
