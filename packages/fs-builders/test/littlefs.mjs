// Local validation for the LittleFS image builder (no hardware):
//   1. round-trip — build an image, remount it in the same WASM lib, read back.
//   2. writes test/ref/lfs.img + manifest.json for the littlefs-python cross-check
//      (lfs_oracle.py), the same engine gnwmanager uses.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { LittleFsImage, readFileFromImage } from "../dist/index.js";

const BS = 4096;
const BC = 64; // 256 KiB image

const files = {
  "/readme.txt": new TextEncoder().encode("hello Game & Watch\n"),
  "/roms/nes/smb.nes": new Uint8Array(randomBytes(5000)),
  "/roms/gb/tetris.gb": new Uint8Array(randomBytes(32 * 1024)),
  "/empty": new Uint8Array(0),
};
const dirs = ["/roms", "/roms/nes", "/roms/gb"];

const sha = (d) => createHash("sha256").update(d).digest("hex");

const fs = await LittleFsImage.create(BS, BC);
for (const d of dirs) fs.mkdir(d);
for (const [p, d] of Object.entries(files)) fs.writeFile(p, d);
const img = fs.finish();
console.log(`built image: ${img.length} bytes (${BC} × ${BS})`);

let ok = true;
for (const [p, want] of Object.entries(files)) {
  const got = await readFileFromImage(img, BS, BC, p);
  const same = got.length === want.length && sha(got) === sha(want);
  console.log(`  ${same ? "OK " : "FAIL"} ${p} (${want.length} B)`);
  ok &&= same;
}
if (!ok) {
  console.error("round-trip FAILED");
  process.exit(1);
}
console.log("round-trip OK ✓");

mkdirSync(new URL("./ref/", import.meta.url), { recursive: true });
writeFileSync(new URL("./ref/lfs.img", import.meta.url), img);
writeFileSync(
  new URL("./ref/manifest.json", import.meta.url),
  JSON.stringify({ blockSize: BS, blockCount: BC, files: Object.fromEntries(Object.entries(files).map(([p, d]) => [p, sha(d)])) }, null, 2),
);
console.log("wrote ref/lfs.img + manifest.json for littlefs-python cross-check");
