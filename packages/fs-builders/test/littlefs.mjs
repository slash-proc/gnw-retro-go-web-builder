// Local validation for the LittleFS image builder (no hardware):
//   1. round-trip — build an image, remount it in the same WASM lib, read back.
//      This alone only proves self-consistency: the same library wrote and read
//      the image, so a format error that is symmetric passes.
//   2. the real check — hand ref/lfs.img + manifest.json to littlefs-python (the
//      same engine gnwmanager uses) via lfs_oracle.py and require it to mount our
//      image and match every file. This used to be a separate manual step nobody
//      ran; it now runs here, and a missing littlefs-python is reported loudly
//      instead of leaving the suite quietly self-referential.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
if (img.length !== BS * BC) {
  console.error(`image is ${img.length} bytes, expected exactly ${BS * BC} (${BC} × ${BS})`);
  process.exit(1);
}

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
console.log("wrote ref/lfs.img + manifest.json for the littlefs-python cross-check");

// ── 2. cross-check with littlefs-python ──────────────────────────────────────
const oracle = fileURLToPath(new URL("./lfs_oracle.py", import.meta.url));
const py = spawnSync("python3", [oracle], { encoding: "utf8" });
process.stdout.write(py.stdout || "");
if (py.status !== 0) {
  process.stderr.write(py.stderr || "");
  if ((py.stderr || "").includes("No module named 'littlefs'")) {
    console.error(
      "\nlittlefs-python is NOT installed in this container, so the image was only\n" +
        "round-tripped through the same WASM library that wrote it. That is NOT a\n" +
        "cross-check. Install it (pip3 install --break-system-packages littlefs-python==0.17.1)\n" +
        "or add it to docker/Dockerfile, then re-run.",
    );
  }
  console.error("littlefs-python cross-check FAILED");
  process.exit(1);
}

// The manifest must actually describe the files, or the oracle verifies nothing.
if (Object.keys(files).length === 0) {
  console.error("empty file set — the cross-check would be vacuous");
  process.exit(1);
}

// Directories must survive too (the oracle prints the tree; assert it here).
const missingDirs = [];
for (const d of dirs) {
  if (!py.stdout.includes(`'${d}'`) && d !== "/") missingDirs.push(d);
}
if (missingDirs.length) {
  console.error("littlefs-python did not see these directories:", missingDirs.join(", "));
  process.exit(1);
}

console.log("littlefs-python cross-check OK ✓");
