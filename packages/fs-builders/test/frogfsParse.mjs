/**
 * Round-trip oracle for the FrogFS parser: build images with the byte-exact
 * FrogFsImage builder, parse them back with parseFrogfs, and verify the file list
 * (paths, sizes, and that each entry's data bytes live at the reported dataOffs).
 * Also checks metadata-only parsing (truncated buffer = head+hashtable+headers).
 */
import { FrogFsImage, parseFrogfs, parseFrogfsHead, headersStart, FrogFsParseError } from "../dist/index.js";

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
// Pin the formula itself — the inequality above stays true if headersStart
// merely shrinks, so on its own it does not pin where the headers begin.
check(headersStart(head.numEntries) === 12 + 8 * head.numEntries,
  `headersStart(${head.numEntries}) == 12 + 8*n (got ${headersStart(head.numEntries)})`);
check(headersStart(0) === 12 && headersStart(1) === 20 && headersStart(29) === 244,
  "headersStart is exact for 0/1/29 entries");
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

// A COMPRESSED entry is REFUSED, not misparsed as a directory.
//
// The entry header is `<IHBB parent, child_count, seg_sz, opts>`; `child_count` is a count for a
// directory, exactly 0xFF00 for an uncompressed file, and >0xFF00 for a compressed one (the low
// byte is the compressor id). The parser used to test only `=== 0xFF00`, so a compressed entry
// fell through to the DIRECTORY arm and read 0xFF01 as a child count of 65281, whose name
// offset runs past the buffer -- surfacing as "entry name past end of buffer", a corruption
// report for an image that is not corrupt. Our builder never emits one, so
// the case is manufactured here by hand: build a normal image and bump one file's child_count.
{
  const one = new FrogFsImage();
  one.addFile("roms/nes/smb.nes", bytes(1024, 9));
  const img2 = one.build();
  const dv = new DataView(img2.buffer, img2.byteOffset, img2.byteLength);
  const n = dv.getUint16(6, true); // head: <I magic, B major, B minor, H num_ent, I bin_sz>
  let hdr = -1;
  for (let i = 0; i < n; i++) {
    const off = dv.getUint32(12 + i * 8 + 4, true);
    if (dv.getUint16(off + 4, true) === 0xff00) { hdr = off; break; }
  }
  check(hdr >= 0, "found an uncompressed file entry header to mutate");
  check(parseFrogfs(img2).files.length === 1, "control: the unmutated image parses");
  dv.setUint16(hdr + 4, 0xff01, true); // compressed, compressor id 1
  let threw = null;
  try { parseFrogfs(img2); } catch (e) { threw = e; }
  check(threw instanceof FrogFsParseError, `compressed entry throws FrogFsParseError (got ${threw})`);
  check(threw !== null && /compressed/.test(threw.message), `the message names compression (got ${threw?.message})`);
}

console.log(`\nfrogfsParse: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
