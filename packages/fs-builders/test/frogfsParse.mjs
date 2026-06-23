/**
 * Round-trip oracle for the FrogFS parser: build images with the byte-exact
 * FrogFsImage builder, parse them back with parseFrogfs, and verify the file list
 * (paths, sizes, and that each entry's data bytes live at the reported dataOffs).
 * Also checks metadata-only parsing (truncated buffer = head+hashtable+headers).
 */
import { FrogFsImage, parseFrogfs, parseFrogfsHead, headersStart } from "../dist/index.js";

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
};

function bytes(n, seed) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

// A representative tree: several systems, nested dirs, varied sizes incl. odd lengths.
const files = [
  ["roms/nes/smb.nes", bytes(40976, 1)],
  ["roms/nes/zelda.nes", bytes(131073, 2)], // non-aligned length
  ["roms/gbc/links_awakening.gbc", bytes(1048576, 3)],
  ["roms/gb/tetris.gb", bytes(32768, 4)],
  ["roms/md/sonic.md", bytes(524288, 5)],
  ["bios/gb_bios.bin", bytes(256, 6)],
  ["fonts/basic.fnt", bytes(7, 7)], // tiny + odd
];

const img = new FrogFsImage();
for (const [p, d] of files) img.addFile(p, d);
const image = img.build();

// Head sanity.
const head = parseFrogfsHead(image);
check(head.magic === 0x474f5246, "magic FROG");
check(head.binSize === image.length, `binSize ${head.binSize} == image length ${image.length}`);

// Full parse → file list matches the inputs.
const { files: parsed } = parseFrogfs(image);
check(parsed.length === files.length, `parsed ${parsed.length} files == ${files.length}`);

const want = new Map(files.map(([p, d]) => [p, d.length]));
for (const f of parsed) {
  check(want.has(f.path), `path present: ${f.path}`);
  check(want.get(f.path) === f.dataSize, `size ${f.path}: ${f.dataSize} == ${want.get(f.path)}`);
  // The bytes at dataOffs must equal the original file data.
  const orig = files.find(([p]) => p === f.path)?.[1];
  if (orig) {
    const slice = image.subarray(f.dataOffs, f.dataOffs + f.dataSize);
    let same = slice.length === orig.length;
    for (let i = 0; same && i < orig.length; i++) if (slice[i] !== orig[i]) same = false;
    check(same, `data bytes match at dataOffs for ${f.path}`);
  }
}

// Metadata-only parse: truncate the image to just head+hashtable+headers (drop file data).
// headersStart + a generous header span (16 + 255 name + pad) per entry upper-bounds it; simplest
// is to cut at the smallest dataOffs (start of file data region).
const minDataOffs = Math.min(...parsed.map((f) => f.dataOffs));
check(minDataOffs >= headersStart(head.numEntries), "data starts after the header region");
const meta = image.subarray(0, minDataOffs);
const metaParsed = parseFrogfs(meta);
check(metaParsed.files.length === files.length, "metadata-only parse lists all files");
const metaPaths = new Set(metaParsed.files.map((f) => f.path));
check(
  files.every(([p]) => metaPaths.has(p)),
  "metadata-only parse recovers every path",
);

// Empty-ish image (no files, just root dir) parses to zero files.
const empty = new FrogFsImage().build();
check(parseFrogfs(empty).files.length === 0, "empty image → 0 files");

console.log(`\nfrogfsParse: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
