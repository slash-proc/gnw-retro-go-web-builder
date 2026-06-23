/**
 * Orchestration test for the flash-install assembler (flashImage.ts). Validates
 * the parts THIS module adds on top of the byte-exact primitives: the cores→LittleFS
 * vs everything-else→FrogFS split, dest mapping, the /bios merge, msx-bios omission,
 * MD byteswap netting, and that both images are produced.
 *
 * Run: node packages/fs-builders/test/flashImage.mjs   (after `tsc -b`)
 */
import {
  planFlashImage,
  planFlashLayout,
  buildFrogfsFromPlan,
  assembleFlashImages,
  reverseLfsBlocks,
  byteswap16,
  LITTLEFS_FLOOR,
} from "../dist/index.js";

let pass = 0;
const fail = [];
const ok = (c, m) => (c ? pass++ : fail.push(m));
const enc = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

// Inflating stub compressor → every ROM "not smaller" → kept uncompressed, so MD
// stays byteswapped-once and we can inspect raw dests. (Compression is validated
// byte-exact elsewhere; this is an orchestration test.)
const lzmaRaw = (d) => new Uint8Array(d.length + 64);

const defaultContent = new Map([
  ["cores/nes_fceu.bin", enc("nescore")], // → LittleFS
  ["cores/tgb.bin", enc("tgbcore")], //      → LittleFS
  ["bios/nes/palettes.bin", enc("nespal")],
  ["bios/msx/MSX.rom", enc("msxbios")], //   omitted when no MSX games
  ["roms/bios/syscard3.pce", enc("DEFAULTpce")], // roms/bios → /bios
  ["lang/de_de.bin", enc("lang")], //        → FrogFS (loaded from /lang)
  ["roms/homebrew/celeste.bin", enc("celeste")],
]);

const mdInput = Uint8Array.from([0, 1, 2, 3, 4, 5]);
const userRoms = new Map([
  ["nes/mario.nes", enc("mario")],
  ["md/sonic.md", mdInput],
  ["bios/pce/syscard.pce", enc("USERpce")],
]);

const plan = planFlashImage({ defaultContent, userRoms, lzmaRaw });
const frog = new Map(plan.frogfsFiles.map((f) => [f.path, f.data]));
const cores = new Map(plan.coreFiles.map((f) => [f.path, f.data]));

// cores → LittleFS, NOT FrogFS
ok(cores.has("cores/nes_fceu.bin") && cores.has("cores/tgb.bin"), "cores → LittleFS tree");
ok(![...frog.keys()].some((p) => p.startsWith("cores/")), "no cores in FrogFS");
ok(plan.stats.coreFiles === 2, "coreFiles count");

// everything else → FrogFS
ok(frog.has("roms/nes/mario.nes"), "user nes ROM → roms/nes/");
ok(frog.has("lang/de_de.bin"), "lang → FrogFS (/lang)");
ok(frog.has("bios/nes/palettes.bin"), "default bios → FrogFS");
ok(frog.has("roms/homebrew/celeste.bin"), "native homebrew → FrogFS");

// /bios merge
ok(frog.has("bios/pce/syscard.pce"), "user bios → /bios");
ok(frog.has("bios/syscard3.pce"), "default roms/bios → /bios (re-routed)");
ok(![...frog.keys()].some((p) => p.startsWith("roms/bios/")), "nothing left under roms/bios");

// msx-bios omission
ok(!frog.has("bios/msx/MSX.rom"), "bios/msx omitted when no MSX games");
ok(plan.stats.omittedMsxBios === true, "stats.omittedMsxBios true");
ok(
  ["homebrew", "md", "nes"].every((s) => plan.systems.includes(s)) && !plan.systems.includes("msx"),
  `systems = nes/md/homebrew (got ${plan.systems.join(",")})`,
);

// MD byteswap nets to exactly one swap
ok(eq(frog.get("roms/md/sonic.md"), byteswap16(mdInput)), "MD ROM byteswapped exactly once");

// with an MSX game, bios/msx survives
const withMsx = planFlashImage({
  defaultContent,
  userRoms: new Map([...userRoms, ["msx/aleste.rom", enc("aleste")]]),
  lzmaRaw,
});
ok(
  new Set(withMsx.frogfsFiles.map((f) => f.path)).has("bios/msx/MSX.rom"),
  "bios/msx kept when an MSX game is present",
);

// both images build: FrogFS (FROG magic) + LittleFS (cores, non-empty)
const frogImg = buildFrogfsFromPlan(plan);
ok(frogImg.length > 64 && eq(frogImg.subarray(0, 4), Uint8Array.from([0x46, 0x52, 0x4f, 0x47])), "FrogFS image (FROG magic)");

const images = await assembleFlashImages({ defaultContent, userRoms, lzmaRaw }, { blockSize: 4096, blockCount: 64 });
ok(images.frogfs.length > 64, "assembled FrogFS non-empty");
ok(images.littlefs.length > 0, "LittleFS cores image built");
ok(images.plan.coreFiles.length === 2, "assembled plan carries the cores");

// --- layout / budget (planFlashLayout) ---
const MB = 1024 * 1024;
// 16 MB chip, 4 MB FrogFS, 2.43 MB cores → LittleFS = cores+6MB headroom (>8MB floor)
const L = planFlashLayout({ extflashSize: 16 * MB, frogfsLength: 4 * MB, coresSize: Math.round(2.43 * MB) });
ok(L.littlefsLength === Math.ceil((2.43 * MB + 6 * MB) / 4096) * 4096, "LittleFS sized to cores + headroom");
ok(L.littlefsOffset + L.littlefsLength === 16 * MB, "LittleFS top-aligned to extflash end");
ok(L.littlefsOffset >= L.frogfsOffset + L.frogfsLength && L.fits, "16MB chip fits FrogFS+LittleFS");
ok(L.littlefsBlockCount === L.littlefsLength / 4096, "blockCount = littlefsLength / blockSize");

// floor applies when cores are tiny
const Lfloor = planFlashLayout({ extflashSize: 32 * MB, frogfsLength: 1 * MB, coresSize: 256 * 1024 });
ok(Lfloor.littlefsLength === LITTLEFS_FLOOR, "8 MiB floor when cores are small");

// overflow → fits=false, negative freeBytes
const Lover = planFlashLayout({ extflashSize: 16 * MB, frogfsLength: 10 * MB, coresSize: 2 * MB });
ok(!Lover.fits && Lover.freeBytes < 0, "overflow flagged when FrogFS+LittleFS exceed the chip");

// expert overrides: explicit LittleFS size + FrogFS offset (reserved bottom)
const Lo = planFlashLayout({
  extflashSize: 16 * MB, frogfsLength: 4 * MB, coresSize: 2 * MB,
  littlefsLength: 10 * MB, reservedOffset: 64 * 1024,
});
ok(Lo.littlefsLength === 10 * MB, "explicit littlefsLength override used");
ok(Lo.frogfsOffset === 64 * 1024, "reservedOffset sets the FrogFS base offset");
ok(Lo.littlefsOffset + Lo.littlefsLength === 16 * MB, "override still top-aligned to chip end");
ok(Lo.deviceEndOffset === 16 * MB && Lo.aligned, "deviceEndOffset + aligned with overrides");

// --- LittleFS block reversal (device downward layout, == reverse_blocks) ---
// 4 blocks of 2 bytes each: block i = [i, i]. Reversed → block i = [3-i, 3-i].
const lfsImg = Uint8Array.from([0, 0, 1, 1, 2, 2, 3, 3]);
const rev = reverseLfsBlocks(lfsImg, 2, 4);
ok(eq(rev, Uint8Array.from([3, 3, 2, 2, 1, 1, 0, 0])), "reverseLfsBlocks reverses block order");
// short image padded with 0xFF at the (new) bottom, i.e. front blocks become 0xFF
const revShort = reverseLfsBlocks(Uint8Array.from([0, 0, 1, 1]), 2, 4);
ok(eq(revShort, Uint8Array.from([0xff, 0xff, 0xff, 0xff, 1, 1, 0, 0])), "short image padded with erased 0xFF");

console.log(`flashImage orchestration: ${pass} passed, ${fail.length} failed`);
for (const m of fail) console.log("  FAIL:", m);
process.exit(fail.length ? 1 : 0);
