// writeIntoLittleFs: add a file to an EXISTING littlefs partition without rebuilding it.
//
// A flash-only ROM install cannot reformat the littlefs partition, because that partition
// also holds the user's saves. This suite stands in for the device: it builds a partition,
// serves its blocks one at a time through the lazy-fetch protocol, writes a source-supplied
// core into it, applies ONLY the reported dirty blocks, and then remounts to check that both
// the new core and every pre-existing save are readable.
//
// The two properties that matter beyond "it round-trips":
//   * the dirty set is a small fraction of the partition (otherwise this is a rebuild wearing
//     a different name, and the saves are only surviving by luck);
//   * a block that was never fetched is never reported dirty (it is 0xFF in the working image
//     AND in the baseline, so a naive diff would have to be wrong on purpose to flag it).
import { randomBytes, createHash } from "node:crypto";
import { LittleFsImage, readFileFromImage, listDirFromImage, writeIntoLittleFs } from "../dist/index.js";

const BS = 4096;
const BC = 512; // 2 MiB
const sha = (d) => createHash("sha256").update(d).digest("hex");
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};

// A partition as the firmware install would have left it: cores from the bundle, plus saves.
const existing = {
  "/cores/nes.bin": new Uint8Array(randomBytes(120 * 1024)),
  "/saves/nes/smb.sav": new Uint8Array(randomBytes(40 * 1024)),
  "/saves/gb/tetris.sav": new Uint8Array(randomBytes(8 * 1024)),
  "/data/favorites.txt": new TextEncoder().encode("/roms/nes/smb.nes\n"),
};
const base = await (async () => {
  const img = await LittleFsImage.create(BS, BC);
  for (const d of ["/cores", "/saves", "/saves/nes", "/saves/gb", "/data"]) img.mkdir(d);
  for (const [p, d] of Object.entries(existing)) img.writeFile(p, d);
  return img.finish();
})();
if (base.length !== BS * BC) fail(`base image is ${base.length} bytes, expected ${BS * BC}`);

// The device. Every block read is counted; nothing is handed over unasked.
const served = new Set();
const fetchBlock = async (b) => {
  served.add(b);
  return base.slice(b * BS, (b + 1) * BS);
};

const added = {
  "/cores/gba.bin": new Uint8Array(randomBytes(200 * 1024)),
  "/data/favorites.txt": new TextEncoder().encode("/roms/nes/smb.nes\n/roms/gba/x.gba\n"),
};
const res = await writeIntoLittleFs(BS, BC, new Map(Object.entries(added)), fetchBlock);

// Apply the dirty blocks, and ONLY those, to the device's copy.
const after = base.slice();
for (const { block, data } of res.dirty) {
  if (block < 0 || block >= BC) fail(`dirty block ${block} out of range`);
  if (data.length !== BS) fail(`dirty block ${block} is ${data.length} bytes`);
  after.set(data, block * BS);
}

// Every file, old and new, must read back correctly from the patched partition.
for (const [p, want] of Object.entries({ ...existing, ...added })) {
  const got = await readFileFromImage(after, BS, BC, p);
  if (!got) fail(`${p} is missing after the write`);
  if (sha(got) !== sha(want)) fail(`${p} differs after the write (${got.length} vs ${want.length} bytes)`);
}
console.log(`round-trip OK ✓ (${Object.keys(existing).length} pre-existing files survived, ${Object.keys(added).length} written)`);

// Directory structure survives too, not just the bytes we went looking for.
const names = (await listDirFromImage(after, BS, BC, "/saves/nes")).map((e) => e.name);
if (!names.includes("smb.sav")) fail(`/saves/nes lost its entries: ${JSON.stringify(names)}`);

// A rebuild would touch everything. Bound both the write-back and the device traffic.
const dataBlocks = Math.ceil(Object.values(added).reduce((n, d) => n + d.length, 0) / BS);
// Slack is for littlefs's own metadata commits, not for blocks we merely happened to read:
// re-writing a fetched-but-unchanged block is harmless on the device and therefore invisible
// to the round-trip above, so this bound is the only thing that holds the baseline honest.
if (res.dirty.length > dataBlocks + 16) fail(`${res.dirty.length} dirty blocks for ${dataBlocks} blocks of new data — this is rebuilding, not patching`);
if (res.fetched.length > BC / 4) fail(`fetched ${res.fetched.length} of ${BC} blocks — the mount is not lazy`);
console.log(`dirty ${res.dirty.length} blocks, fetched ${res.fetched.length} of ${BC} ✓`);

// The device was never asked for a block outside the partition, and never asked twice.
for (const b of res.fetched) if (!served.has(b)) fail(`block ${b} reported fetched but never requested`);
if (served.size !== res.fetched.length) fail(`requested ${served.size} blocks but reported ${res.fetched.length}`);

// A block neither fetched nor written must be reported clean. Un-fetched blocks sit at 0xFF
// in the working image; if the baseline were taken any other way they would all read dirty.
const untouched = [];
for (let b = 0; b < BC; b++) if (!served.has(b) && !res.dirty.some((d) => d.block === b)) untouched.push(b);
if (untouched.length < BC / 2) fail(`only ${untouched.length} of ${BC} blocks were left alone`);
for (const b of untouched) {
  const slice = after.subarray(b * BS, (b + 1) * BS);
  const orig = base.subarray(b * BS, (b + 1) * BS);
  for (let i = 0; i < BS; i++) if (slice[i] !== orig[i]) fail(`untouched block ${b} changed at byte ${i}`);
}
console.log(`${untouched.length} of ${BC} blocks left untouched ✓`);

// --- an unchanged file is not rewritten -----------------------------------------------------
// littlefs is copy-on-write, so rewriting a file allocates new data blocks and every one comes
// back dirty even when the bytes are identical. Measured on a device-shaped 8 MiB partition,
// rewriting 483 KiB of unchanged files cost 1677 dirty blocks, 6.55 MiB of flash writes, and the
// amplification grows with how full the partition is. An install showed "[176/1561]" for a
// handful of cores because of it.
{
  const fetchAfter = async (b) => after.slice(b * BS, (b + 1) * BS);
  const again = new Map(Object.entries(added));
  const res2 = await writeIntoLittleFs(BS, BC, again, fetchAfter);
  if (res2.skipped !== again.size) fail(`all ${again.size} unchanged files should be skipped (got ${res2.skipped})`);
  if (res2.dirty.length !== 0) fail(`writing identical content dirtied ${res2.dirty.length} block(s)`);

  // ARMED: the same call with one byte changed must still write, or the check above would pass
  // for a writer that never writes anything.
  const changed = new Map(Object.entries(added));
  const [k0, v0] = [...changed][0];
  const mutated = Uint8Array.from(v0);
  mutated[0] ^= 0xff;
  changed.set(k0, mutated);
  const res3 = await writeIntoLittleFs(BS, BC, changed, fetchAfter);
  if (res3.skipped !== changed.size - 1) fail(`only the unchanged files should be skipped (got ${res3.skipped})`);
  if (res3.dirty.length === 0) fail("a changed byte produced no write");
  console.log(`unchanged files skipped ✓ (${res2.skipped} skipped, 0 dirty; one changed byte still writes ${res3.dirty.length} block(s))`);
}
