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
  parseFrogfs,
  relocateMappedInFrogfs,
  MappedRelocError,
  EXTFLASH_BASE,
} from "../dist/index.js";
import { crc32 } from "../dist/frogfs.js";
// userDest is not re-exported from the package index; import it directly rather
// than widening the public surface just for a test.
import { userDest } from "../dist/flashImage.js";
import { resolveInstallPaths, DEFAULT_INSTALL_PATHS, InstallPathError } from "../dist/installPaths.js";

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
  ["bios/logo.bin", enc("logo")], //          the firmware's boot logo; never overridable
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
  // cheats/, covers/ and the "<system>_bios/" convention were never staged, so
  // every one of userDest()'s routing rules but the plain roms/ fallback was
  // unpinned — each could be deleted with this suite still green.
  ["cheats/nes/mario.mcf", enc("cheat")],
  ["covers/nes/mario.img", enc("cover")],
  ["gb_bios/dmg_boot.bin", enc("gbbios")],
  ["roms/gb/tetris.gb", enc("tetris")],
  // Sorts BETWEEN "mario.mcf" and "mario.nes" by plain path ('!' < '.'), so the
  // ROM and its cheat file stay adjacent only if the ordering really groups by
  // game base. Without it, plain path order looked identical and the grouping
  // rule was unpinned.
  ["nes/mario!.nes", enc("marioalt")],
]);

const plan = planFlashImage({ defaultContent, userRoms, lzmaRaw });
const frog = new Map(plan.frogfsFiles.map((f) => [f.path, f.data]));
const cores = new Map(plan.coreFiles.map((f) => [f.path, f.data]));

// userDest routing, rule by rule
ok(userDest("nes/mario.nes") === "roms/nes/mario.nes", "userDest: bare system → roms/");
ok(userDest("roms/nes/mario.nes") === "roms/nes/mario.nes", "userDest: roms/ passthrough");
ok(userDest("covers/nes/a.img") === "covers/nes/a.img", "userDest: covers/ passthrough");
ok(userDest("bios/pce/x.pce") === "bios/pce/x.pce", "userDest: bios/ passthrough");
ok(userDest("cheats/nes/mario.mcf") === "cheats/nes/mario.mcf", "userDest: cheats/ kept (the firmware reads /cheats, not next to the ROM)");
ok(userDest("cheats/md/sonic.ggcodes") === "cheats/md/sonic.ggcodes", "userDest: cheats/ deeper path kept");
ok(userDest("gb_bios/dmg_boot.bin") === "bios/gb/dmg_boot.bin", "userDest: <sys>_bios/ → bios/<sys>/");
ok(userDest("msx_bios/MSX.rom") === "bios/msx/MSX.rom", "userDest: msx_bios/ → bios/msx/");
ok(userDest("readme.txt") === "roms/readme.txt", "userDest: no slash → roms/");

// cores → LittleFS, NOT FrogFS
ok(cores.has("cores/nes_fceu.bin") && cores.has("cores/tgb.bin"), "cores → LittleFS tree");
ok(![...frog.keys()].some((p) => p.startsWith("cores/")), "no cores in FrogFS");
// THREE, not two: `coreFiles` is everything bound for the LittleFS partition, which is the
// cores plus the language blob above. The name predates lang/ joining them.
ok(plan.stats.coreFiles === 3, "LittleFS-bound file count");

// everything else → FrogFS
ok(frog.has("roms/nes/mario.nes"), "user nes ROM → roms/nes/");
// lang → LittleFS, not FrogFS. `rg_i18n.c`'s `i18n_load_from_sd` opens these with a plain
// `fopen`, and `syscalls.c`'s `is_frogfs_path()` routes only roms/covers/bios/fonts/font and
// cores/pico8.ro to FrogFS, so a blob in FrogFS is invisible to that open. This asserted the
// opposite and passed for as long as the bug shipped.
ok(!frog.has("lang/de_de.bin"), "lang is NOT in FrogFS");
ok(cores.has("lang/de_de.bin"), "lang → LittleFS (rg_i18n opens it with fopen)");
ok(frog.has("bios/nes/palettes.bin"), "default bios → FrogFS");
ok(frog.has("roms/homebrew/celeste.bin"), "native homebrew → FrogFS");

// /bios merge
ok(frog.has("bios/pce/syscard.pce"), "user bios → /bios");
ok(frog.has("bios/syscard3.pce"), "default roms/bios → /bios (re-routed)");
ok(![...frog.keys()].some((p) => p.startsWith("roms/bios/")), "nothing left under roms/bios");

// msx-bios omission
ok(!frog.has("bios/msx/MSX.rom"), "bios/msx omitted when no MSX games");
ok(plan.stats.omittedMsxBios === true, "stats.omittedMsxBios true");

// the staged user files land where userDest says
ok(frog.has("cheats/nes/mario.mcf"), "user cheats/ file staged under cheats/");
ok(!frog.has("roms/nes/mario.mcf"), "cheat file is NOT staged next to the ROM (regression guard: a firmware byte-patch once made that work)");
ok(frog.has("covers/nes/mario.img"), "user covers/ .img staged under covers/");
ok(frog.has("bios/gb/dmg_boot.bin"), "user <sys>_bios/ staged under bios/<sys>/");

// systems list is sorted and holds exactly the /roms systems present
ok(JSON.stringify(plan.systems) === JSON.stringify([...plan.systems].sort()), "plan.systems is sorted");
ok(JSON.stringify(plan.systems) === JSON.stringify(["gb", "homebrew", "md", "nes"]),
   `plan.systems == [gb,homebrew,md,nes] (got ${JSON.stringify(plan.systems)})`);

// file order: grouped by game base (ROM and its cheat file adjacent), so adding
// a game does not reshuffle unrelated payloads
{
  const order = plan.frogfsFiles.map((f) => f.path);
  const iRom = order.indexOf("roms/nes/mario.nes");
  const iCheat = order.indexOf("cheats/nes/mario.mcf");
  const iCover = order.indexOf("covers/nes/mario.img");
  // The invariant is that ONE game's payloads occupy a contiguous run — that is what keeps
  // adding an unrelated game from reshuffling (and re-hashing) everything else. It is not
  // "the ROM and the cheat touch": all three of this game's files share the base
  // "nes/mario", and the tie-break is full path, so the cover sorts between them.
  const group = [iRom, iCheat, iCover];
  ok(group.every((i) => i >= 0) && Math.max(...group) - Math.min(...group) === group.length - 1,
     `one game's ROM, cheat and cover form a contiguous run (${JSON.stringify(group)})`);
  ok(order.indexOf("roms/nes/mario!.nes") > Math.max(iRom, iCheat),
     "the interleaving path sorts after the grouped pair (base grouping, not path order)");
}

// compress:false must skip compression entirely
{
  const planNo = planFlashImage({ defaultContent, userRoms, lzmaRaw, compress: false });
  ok(planNo.stats.compressed === 0, `compress:false → compressed 0 (got ${planNo.stats.compressed})`);
  ok(planNo.stats.skipped === planNo.frogfsFiles.length,
     `compress:false → every file skipped (${planNo.stats.skipped}/${planNo.frogfsFiles.length})`);
  ok(!planNo.frogfsFiles.some((f) => f.path.endsWith(".lzma")), "compress:false → no .lzma sidecars");
}
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

// The firmware's own bios/logo.bin is not overridable from a user's folder.
//
// Retro-Go opens the boot logo by that exact name (rg_logos.c:49) and the bundle ships it, so
// the device's copy comes from defaultContent. The tree is seeded from defaultContent and
// userRoms is merged AFTERWARDS onto the same destination keys, so a same-named folder file
// would silently overwrite it -- last write wins. apps/web's biosState.filterInstall drops it
// before the packer ever sees it (test/biosscope.mjs), which is where the rule is enforced;
// this pins the packer half of the fact: the bundle's bytes are what land, and a folder file
// that somehow arrived would replace them, so that filter is load-bearing rather than belt-and-
// braces.
ok(eq(frog.get("bios/logo.bin"), enc("logo")), "the bundle's logo.bin lands in the image");
const overridden = planFlashImage({
  defaultContent,
  userRoms: new Map([...userRoms, ["bios/logo.bin", enc("evil")]]),
  lzmaRaw,
});
const overriddenFrog = new Map(overridden.frogfsFiles.map((f) => [f.path, f.data]));
ok(
  eq(overriddenFrog.get("bios/logo.bin"), enc("evil")),
  "a folder bios/logo.bin overwrites the bundle's in the packer, so the app-side filter is what protects it",
);

// both images build: FrogFS (FROG magic) + LittleFS (cores, non-empty)
const frogImg = buildFrogfsFromPlan(plan);
ok(frogImg.length > 64 && eq(frogImg.subarray(0, 4), Uint8Array.from([0x46, 0x52, 0x4f, 0x47])), "FrogFS image (FROG magic)");

const images = await assembleFlashImages({ defaultContent, userRoms, lzmaRaw }, { blockSize: 4096, blockCount: 64 });
ok(images.frogfs.length > 64, "assembled FrogFS non-empty");
ok(images.littlefs.length > 0, "LittleFS cores image built");
ok(images.plan.coreFiles.length === 3, "assembled plan carries the LittleFS-bound files");

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

// --- manifest-declared install paths (installPaths.ts) ------------------------------
// The live firmware manifest, verbatim from docs/FIRMWARE_DIST.md's `paths` section.
const LIVE_PATHS = {
  cores: "/cores", homebrew: "/homebrews", bios: "/bios", roms: "/roms",
  covers: "/covers", cheats: "/cheats", data: "/data",
};

// the leading slash is stripped exactly once, and no trailing one is left behind
const rp = resolveInstallPaths(LIVE_PATHS);
ok(rp.roms === "roms" && rp.homebrew === "homebrews", "leading slash stripped exactly once");
ok(resolveInstallPaths({ roms: "/roms/" }).roms === "roms", "a trailing slash is not kept");
ok(resolveInstallPaths({ roms: "/a/b" }).roms === "a/b", "interior separators survive untouched");

// a role the manifest does not declare falls back to the historical literal
const partial = resolveInstallPaths({ homebrew: "/homebrews" });
ok(partial.roms === DEFAULT_INSTALL_PATHS.roms, "a missing role falls back to the hardcoded default");
ok(partial.homebrew === "homebrews", "a declared role still wins over the default");
ok(resolveInstallPaths(undefined).roms === "roms", "no paths object at all ⇒ all defaults");
ok(
  Object.values(resolveInstallPaths({})).every((v) => v !== undefined),
  "no role can ever resolve to undefined",
);

// the object is open: an unknown role is carried, not refused
ok(resolveInstallPaths({ ...LIVE_PATHS, shaders: "/shaders" }).extra.shaders === "shaders",
   "an unknown role is kept in extra, not refused");

// malformed values are REFUSED, never sanitised
const refuses = (v, why) => {
  let threw = null;
  try { resolveInstallPaths({ roms: v }); } catch (e) { threw = e; }
  ok(threw instanceof InstallPathError, `refused: ${why}`);
};
refuses("/roms/../../etc", "a .. segment");
refuses("../roms", "a relative path");
refuses("/roms/./x", "a . segment");
refuses("\\roms", "a backslash (not absolute)");
refuses("/roms\\nes", "an interior backslash");
refuses("/roms\u0000nes", "a NUL control character");
refuses("/roms\nnes", "a newline control character");
refuses("/", "the bare storage root");
refuses("roms", "no leading slash");
refuses(42, "a non-string");

// planFlashImage USES the declared paths rather than the constants
const hbContent = new Map([
  ["cores/nes_fceu.bin", enc("nescore")],
  ["homebrews/celeste.bin", enc("celeste")],
  ["roms/bios/pce/x.pce", enc("pcebios")],
  ["roms/nes/a.nes", enc("anes")],
]);
const hbPlan = planFlashImage({
  defaultContent: hbContent,
  userRoms: new Map([["homebrew/engine.bin", enc("engine")], ["nes/b.nes", enc("bnes")]]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
});
const hbPaths = new Set(hbPlan.frogfsFiles.map((f) => f.path));
ok(hbPaths.has("homebrews/engine.bin"), "homebrew lands in /homebrews, the manifest's directory");
ok(!hbPaths.has("roms/homebrew/engine.bin"), "and NOT in the old hardcoded roms/homebrew");
ok(hbPaths.has("bios/pce/x.pce"), "the roms/bios → bios hoist still uses the declared roles");

// the same content with NO manifest paths keeps today's behaviour
const legacy = planFlashImage({
  defaultContent: hbContent,
  userRoms: new Map([["homebrew/engine.bin", enc("engine")]]),
  lzmaRaw,
  compress: false,
});
ok(new Set(legacy.frogfsFiles.map((f) => f.path)).has("roms/homebrew/engine.bin"),
   "with no manifest, homebrew falls back to roms/homebrew");

// homebrew pruning follows the declared directory too
const pruned = planFlashImage({
  defaultContent: hbContent,
  userRoms: new Map(),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
  opts: { selectedHomebrew: new Set(), homebrewTitles: [{ key: "celeste", deviceFiles: ["celeste.bin"] }] },
});
ok(!new Set(pruned.frogfsFiles.map((f) => f.path)).has("homebrews/celeste.bin"),
   "unselected homebrew is pruned from the manifest-declared directory");

// a malformed manifest path refuses the whole plan
let planThrew = null;
try {
  planFlashImage({ defaultContent: hbContent, userRoms: new Map(), lzmaRaw, compress: false,
                   paths: { ...LIVE_PATHS, roms: "/roms/../.." } });
} catch (e) { planThrew = e; }
ok(planThrew instanceof InstallPathError, "planFlashImage refuses a malformed declared path");

// userDest defaults to the historical layout when given no paths
ok(userDest("homebrew/x.bin") === "roms/homebrew/x.bin", "userDest default is unchanged");
ok(userDest("homebrew/x.bin", rp) === "homebrews/x.bin", "userDest follows the resolved paths");

// --- A core from a SOURCE (not the bundle) --------------------------------------------------
// The block at the top only ever fed cores through `defaultContent`, which planFlashImage
// splits to LittleFS on its own. A core supplied by a source arrives in `userRoms` instead and
// goes through `userDest` with the rest of the user content: it was prefixed to
// `roms/cores/doom.bin` AND left in the FrogFS tree. Both halves are pinned here, because
// fixing only the path would still ship the core in the wrong filesystem.
ok(userDest("cores/doom.bin") === "cores/doom.bin", "userDest: cores/ passthrough (default paths)");
ok(userDest("cores/doom.bin", rp) === "cores/doom.bin", "userDest: cores/ passthrough (resolved paths)");
ok(!userDest("cores/doom.bin", rp).startsWith("roms/"), "a core is never prefixed with the roms directory");

const srcCorePlan = planFlashImage({
  defaultContent: new Map(),
  userRoms: new Map([["cores/doom.bin", enc("doomcore")], ["doom/DOOM.whd", enc("whd")]]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
});
const srcCoreFrog = srcCorePlan.frogfsFiles.map((f) => f.path);
const srcCoreLfs = srcCorePlan.coreFiles.map((f) => f.path);
ok(srcCoreLfs.includes("cores/doom.bin"), "a source core lands in the LittleFS tree");
ok(!srcCoreFrog.some((p) => p.includes("cores/")), "a source core is not in the FrogFS tree");
ok(srcCoreFrog.includes("roms/doom/DOOM.whd"), "its converted game is still a ROM in FrogFS");
ok(srcCorePlan.pendingLfsFiles.map((f) => f.path).includes("cores/doom.bin"),
  "a source core is listed as pending: a FrogFS-only install must deliver it itself");

// --- `/data` is LittleFS, not FrogFS ----------------------------------------------------------
// The firmware's `is_frogfs_path` (references/game-and-watch-retro-go-sd/Core/Src/syscalls.c:441)
// lists roms/covers/bios/fonts/font and cores/pico8.ro and nothing else, so on a flash-only
// device every other path -- `/data` included -- resolves to LittleFS. A `/data` file placed in
// FrogFS opens EROFS (`_open`, syscalls.c:477): Retro-Go rewrites `/data/favorites.txt` at
// runtime, so putting it in the read-only image makes favorites unusable on flash.
ok(userDest("data/favorites.txt", rp) === "data/favorites.txt",
  "userDest: data/ passthrough, never prefixed into roms/");
const dataPlan = planFlashImage({
  defaultContent: new Map([["data/CONFIG", enc("bundlecfg")]]),
  userRoms: new Map([["data/favorites.txt", enc("/roms/nes/smb.nes\n")]]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
});
const dataFrog = dataPlan.frogfsFiles.map((f) => f.path);
const dataLfs = dataPlan.coreFiles.map((f) => f.path);
ok(dataLfs.includes("data/favorites.txt"), "a /data file lands in the LittleFS tree");
ok(!dataFrog.some((f) => f.startsWith("data/") || f.includes("/data/")),
  `no /data file reaches FrogFS (${JSON.stringify(dataFrog)})`);
ok(dataLfs.includes("data/CONFIG"), "the bundle's own /data files go to LittleFS too");
ok(dataPlan.pendingLfsFiles.map((f) => f.path).includes("data/favorites.txt"),
  "a user-supplied /data file is pending: the ROM install must write it");
ok(!dataPlan.pendingLfsFiles.map((f) => f.path).includes("data/CONFIG"),
  "the bundle's /data files are NOT pending -- the firmware install already wrote them");

// --- A SPLIT core survives the installAllCores filter -----------------------------------------
// gpSP ships two files: `gba.bin` runs from RAM, `gba.xip` is executed in place. The filter
// derived a core's name with `.replace(".bin", "")`, so `gba.xip` yielded the name "gba.xip",
// which is never a member of `systems` -- it deleted the XIP half and kept the half that
// cannot run without it. `cores/pico8.ro` has the same shape.
const splitCorePlan = planFlashImage({
  defaultContent: new Map([
    ["cores/gba.bin", enc("gbacore")],
    ["cores/gba.xip", enc("gbaxip")],
    ["cores/pico8.ro", enc("p8ro")],
    ["cores/nes.bin", enc("nescore")],
  ]),
  userRoms: new Map([["gba/game.gba", enc("rom")]]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
  opts: { installAllCores: false },
});
const splitLfs = splitCorePlan.coreFiles.map((f) => f.path);
ok(splitLfs.includes("cores/gba.bin"), "a split core keeps its RAM half when its system is active");
ok(splitLfs.includes("cores/gba.xip"), "a split core keeps its XIP half too, not just the .bin");
ok(!splitLfs.includes("cores/nes.bin"), "a core for an inactive system is still filtered out");
ok(!splitLfs.includes("cores/pico8.ro"), "and a non-.bin core for an inactive system too");

// --- A source core is DISTINGUISHABLE from a bundle core ---------------------------------------
// A FrogFS-only caller discards `coreFiles` wholesale. That is right for the bundle's cores
// (already on the device from the firmware install) and wrong for a source's (never written by
// anything), so the two must not be indistinguishable in the plan.
const mixedPlan = planFlashImage({
  defaultContent: new Map([["cores/nes.bin", enc("bundlecore")]]),
  userRoms: new Map([["cores/gba.bin", enc("srccore")], ["cores/gba.xip", enc("srcxip")]]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
});
const mixedAll = mixedPlan.coreFiles.map((f) => f.path).sort();
const mixedSrc = mixedPlan.pendingLfsFiles.map((f) => f.path).sort();
ok(mixedAll.join(",") === "cores/gba.bin,cores/gba.xip,cores/nes.bin",
  "every core is in coreFiles regardless of where it came from");
ok(mixedSrc.join(",") === "cores/gba.bin,cores/gba.xip",
  "pendingLfsFiles names exactly the cores that came from a source");
ok(!mixedSrc.includes("cores/nes.bin"), "a bundle core is never reported as a source core");

const noSrcPlan = planFlashImage({
  defaultContent: new Map([["cores/nes.bin", enc("bundlecore")]]),
  userRoms: new Map([["nes/game.nes", enc("rom")]]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
});
ok(noSrcPlan.pendingLfsFiles.length === 0, "with no source core, pendingLfsFiles is empty");

// A renamed cores role is followed, so the pass-through is not a hardcoded literal.
const renamedCores = resolveInstallPaths({ ...LIVE_PATHS, cores: "/engines" });
ok(userDest("engines/doom.bin", renamedCores) === "engines/doom.bin", "a renamed cores role passes through");
ok(userDest("cores/doom.bin", renamedCores) === "roms/cores/doom.bin",
  "with cores renamed, a `cores/` key is just a ROM system again");


// --- A MAPPED artifact ----------------------------------------------------------------------
// `mapped: true` means the file must live at a real address, which on flash means FrogFS: it is
// the contiguous image, and only a contiguous file has an address at all. So `mapped` OVERRIDES
// the cores/ routing above -- a GBA core's `gba.xip` carries the `cores` role and must still land
// in FrogFS, beside a `gba.bin` that goes to LittleFS like any other core.
//
// Everything below is a port of `references/game-and-watch-retro-go-sd/scripts/frogfs_pico8_ro.py`
// + `pico8_ro_build_patch.py`, which do exactly this to the firmware's own frogfs.bin.
const RELOC_BASE = 0xbeef0000;
const XIP_WORDS = [
  RELOC_BASE + 0x10, //          inside the window          -> rebased
  RELOC_BASE + 0x11, //          inside, Thumb bit set      -> rebased, bit kept
  RELOC_BASE, //                 the base itself (inclusive)-> rebased
  RELOC_BASE - 4, //             below the window           -> untouched
  0x00000000, //                 not an address at all      -> untouched
  0xdeadbeef, //                 far outside                -> untouched
];
const XIP_SIZE = XIP_WORDS.length * 4 + 4; // + one trailing word, so the last word is in range
const xip = new Uint8Array(XIP_SIZE);
{
  const dv = new DataView(xip.buffer);
  XIP_WORDS.forEach((w, i) => dv.setUint32(i * 4, w >>> 0, true));
  dv.setUint32(XIP_WORDS.length * 4, (RELOC_BASE + XIP_SIZE) >>> 0, true); // == upper bound, EXCLUSIVE
}

const mapPlan = planFlashImage({
  defaultContent: new Map(),
  userRoms: new Map([
    ["cores/gba.bin", enc("gbacore")],
    ["cores/gba.xip", xip],
    ["gba/pokemon.gba", enc("rom")],
  ]),
  lzmaRaw,
  compress: false,
  paths: LIVE_PATHS,
  mappedKeys: new Set(["cores/gba.xip"]),
});
const mapFrog = mapPlan.frogfsFiles.map((f) => f.path);
const mapLfs = mapPlan.coreFiles.map((f) => f.path);
ok(mapFrog.includes("cores/gba.xip"), "a mapped artifact lands in FrogFS despite its cores/ role");
ok(!mapLfs.includes("cores/gba.xip"), "a mapped artifact is NOT in the LittleFS cores tree");
ok(mapLfs.includes("cores/gba.bin"), "its sibling .bin still goes to LittleFS");
ok(mapPlan.mappedDests.length === 1 && mapPlan.mappedDests[0].key === "cores/gba.xip" &&
   mapPlan.mappedDests[0].dest === "cores/gba.xip",
  `mappedDests carries key->dest (got ${JSON.stringify(mapPlan.mappedDests)})`);

const mapImage = buildFrogfsFromPlan(mapPlan);
const FROGFS_OFFSET = 0x00300000;
const placed = relocateMappedInFrogfs(mapImage, FROGFS_OFFSET, new Map([
  ["cores/gba.xip", { relocBase: RELOC_BASE, bytes: XIP_SIZE }],
]));
ok(placed.length === 1, "one mapped artifact placed");

// The address is the firmware's formula, and the entry is stored raw, contiguous and aligned.
const entry = parseFrogfs(mapImage).files.find((f) => f.path === "cores/gba.xip");
ok(!!entry, "the mapped entry is in the packed image");
ok(entry.dataSize === XIP_SIZE, `stored uncompressed: dataSize ${entry?.dataSize} == ${XIP_SIZE}`);
ok(entry.dataOffs % 4 === 0, `data offset is 4-byte aligned (got ${entry?.dataOffs})`);
const wantAddr = (EXTFLASH_BASE + FROGFS_OFFSET + entry.dataOffs) >>> 0;
ok(placed[0].address === wantAddr,
  `address == EXTFLASH_BASE + frogfsOffset + dataOffs (got ${placed[0].address.toString(16)}, want ${wantAddr.toString(16)})`);
ok(placed[0].patched === 3, `exactly the three in-window words were patched (got ${placed[0].patched})`);

// The patched words: those in [base, base+size) moved by the delta, the Thumb bit survived
// because the delta is added to the UNMASKED value, and nothing else moved.
{
  const delta = (wantAddr - RELOC_BASE) | 0;
  const got = new DataView(mapImage.buffer, mapImage.byteOffset + entry.dataOffs, XIP_SIZE);
  const want = [
    (RELOC_BASE + 0x10 + delta) >>> 0,
    (RELOC_BASE + 0x11 + delta) >>> 0,
    (RELOC_BASE + delta) >>> 0,
    (RELOC_BASE - 4) >>> 0,
    0x00000000,
    0xdeadbeef,
    (RELOC_BASE + XIP_SIZE) >>> 0,
  ];
  want.forEach((w, i) =>
    ok(got.getUint32(i * 4, true) === w,
      `word ${i}: ${got.getUint32(i * 4, true).toString(16)} == ${w.toString(16)}`));
  ok((got.getUint32(4, true) & 1) === 1, "the Thumb bit survived the rebase");
}

// The trailing CRC32 covers the body, so patching in place must rewrite it or the firmware
// rejects the image (`frogfs_pico8_ro.py` does exactly this at the end).
{
  const body = mapImage.subarray(0, mapImage.length - 4);
  const foot = new DataView(mapImage.buffer, mapImage.byteOffset + mapImage.length - 4, 4);
  ok(foot.getUint32(0, true) === crc32(body), "the trailing CRC32 is valid after patching");
}

// A RE-PLACE rebases off where the blob currently lives, not off the sentinel. Same scan, new
// base: the bytes above are now linked at `wantAddr`, so moving the image rebases from there.
{
  const moved = mapImage.slice();
  const NEW_OFFSET = FROGFS_OFFSET + 0x10000;
  const re = relocateMappedInFrogfs(moved, NEW_OFFSET, new Map([
    ["cores/gba.xip", { placedAt: wantAddr, bytes: XIP_SIZE, expectPatched: 3 }],
  ]));
  const addr2 = (EXTFLASH_BASE + NEW_OFFSET + entry.dataOffs) >>> 0;
  ok(re[0].address === addr2, "a re-place derives the new address the same way");
  ok(re[0].patched === 3, `a re-place patches the same three words (got ${re[0].patched})`);
  const dv2 = new DataView(moved.buffer, moved.byteOffset + entry.dataOffs, XIP_SIZE);
  ok(dv2.getUint32(0, true) === ((addr2 + 0x10) >>> 0), "the rebased word points at the NEW address");
  ok(dv2.getUint32(4, true) === ((addr2 + 0x11) >>> 0), "and the Thumb-bit word with it");
  // Rebasing from the SENTINEL instead would find nothing to patch -- which is the whole reason
  // the patch count is declared: a wrong base is silent otherwise.
  let threw = null;
  try {
    relocateMappedInFrogfs(moved.slice(), NEW_OFFSET, new Map([
      ["cores/gba.xip", { relocBase: RELOC_BASE, bytes: XIP_SIZE, expectPatched: 3 }],
    ]));
  } catch (e) { threw = e; }
  ok(threw instanceof MappedRelocError, `a stale base is caught by the patch count (got ${threw})`);
}

// A declared byte count that disagrees with the packed entry refuses rather than patching
// whatever happens to be there.
{
  let threw = null;
  try {
    relocateMappedInFrogfs(mapImage.slice(), FROGFS_OFFSET, new Map([
      ["cores/gba.xip", { relocBase: RELOC_BASE, bytes: XIP_SIZE + 4 }],
    ]));
  } catch (e) { threw = e; }
  ok(threw instanceof MappedRelocError, `a size disagreement refuses (got ${threw})`);
}

// A mapped path that is not in the image is an error, not a silent skip.
{
  let threw = null;
  try {
    relocateMappedInFrogfs(mapImage.slice(), FROGFS_OFFSET, new Map([
      ["cores/nope.xip", { relocBase: RELOC_BASE }],
    ]));
  } catch (e) { threw = e; }
  ok(threw instanceof MappedRelocError, `a missing mapped entry refuses (got ${threw})`);
}

console.log(`flashImage orchestration: ${pass} passed, ${fail.length} failed`);
for (const m of fail) console.log("  FAIL:", m);
process.exit(fail.length ? 1 : 0);
