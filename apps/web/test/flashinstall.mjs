#!/usr/bin/env node
/**
 * Offline coverage for the FLASH INSTALL PLANNER — `buildFlashInstall()`,
 * `buildFrogfsImage()`, `flashFrogfsRegion()` and `flashInstallToDevice()` in
 * src/lib/engine/flashInstall.ts. This is the code that decides WHAT BYTES the device
 * gets: which content lands in FrogFS, which cores land in LittleFS, where each region
 * is written, and what geometry is baked into the intflash superblock.
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/flashinstall.mjs'
 *
 * Plain node, no framework (repo convention). NOTHING here touches a device.
 *
 * WHERE THE SEAM IS, AND WHY
 * --------------------------
 * The seam is placed BELOW the whole planning/assembly pipeline. `@gnw/fs-builders`
 * (planFlashImage, buildFrogfsFromPlan, planFlashLayout, buildCoresLittlefs incl. the real
 * littlefs WASM) and `@gnw/gnw-patch` (patchSuperblock) are marked external and resolve to
 * the REAL built packages — they run for real here, over synthetic content maps. That is
 * deliberate: those packages have byte-exact oracle tests of their own, but nothing
 * anywhere tests what flashInstall.ts *asks* them to build, and the rules under test
 * (user-override precedence, msx-bios omission, homebrew pruning, core filtering,
 * dataStart preservation) are only observable in the composed result. Faking the builder
 * would have meant asserting against my own fake.
 *
 * Only three things are stubbed, all at the lowest possible boundary:
 *  - `./patch.js`'s `loadLiblzma` — returns an lzmaRaw that THROWS if ever called. Both
 *    entry points pass `compress: false` (RAW ROMs, XiP, no on-device heap OOM), so a
 *    throw would be a real regression. The stub is an assertion, not a convenience.
 *  - `./flasher.js`'s `flashImage` — the device write. Recorded, never performed.
 *  - the littlefs `?url` Vite asset — rewritten to the real .wasm path on disk, so the
 *    genuine WASM builder runs.
 *
 * The `FirmwareBundle` is duck-typed: it is a network/zip artifact, and `defaultContent`
 * is exactly the synthetic input this suite needs to control. Its `contentFor(bank, sd)`
 * arguments ARE asserted (bank-specific cores call firmware at absolute addresses — a
 * wrong bank here is the documented 0x0810cdcd hardfault).
 *
 * Read-back of built FrogFS images uses `parseFrogfs` (packages/fs-builders'
 * independent parser, the reverse of the builder), not the builder's own bookkeeping.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- Tiny harness ----------------------------------------------------------------------
let passed = 0;
const failures = [];
const say = console.log.bind(console);
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => void passed++,
    (e) => void failures.push(`${name}: ${e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e}`),
  );
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function deepEq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg || "not equal"}:\n  got  ${x}\n  want ${y}`);
}
function bytesEq(a, b, msg) {
  assert(a && b, `${msg}: missing buffer`);
  assert(a.length === b.length, `${msg}: length ${a.length} != ${b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${msg}: byte ${i} differs (${a[i]} != ${b[i]})`);
}
async function throwsWith(fn, re, msg) {
  try { await fn(); } catch (e) { assert(re.test(String(e && e.message)), `${msg}: wrong error "${e && e.message}"`); return e; }
  throw new Error(`${msg}: expected a throw, got none`);
}

// --- Compile the module under test -------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const LITTLEFS_WASM = join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.wasm");
const out = mkdtempSync(join(tmpdir(), "gnw-flashinstall-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/flashInstall.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      // Vite `?url` assets. The littlefs one is rewritten to the REAL wasm on disk so
      // buildCoresLittlefs actually runs; anything else would be a silent stub, so it
      // resolves to a poison string that emscripten would fail on loudly.
      name: "url-assets",
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "url-asset" }));
        b.onLoad({ filter: /.*/, namespace: "url-asset" }, (a) => ({
          contents: `export default ${JSON.stringify(
            /littlefs\.wasm/.test(a.path) ? LITTLEFS_WASM : "asset:UNSTUBBED:" + a.path,
          )};`,
          loader: "js",
        }));
      },
    },
    {
      // engine/patch.ts pulls the gnw-patch WASM liblzma over fetch(). Both planner entry
      // points pass compress:false, so the compressor must never be invoked — this stub
      // makes that a hard assertion instead of an assumption.
      name: "stub-patch",
      setup(b) {
        b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "st" }));
        b.onLoad({ filter: /^patch-stub$/, namespace: "st" }, () => ({
          contents:
            `export async function loadLiblzma(){ globalThis.__lzmaLoads++; ` +
            `return () => { throw new Error("lzmaRaw was invoked — compress:false was not honoured"); }; }`,
          loader: "js",
        }));
      },
    },
    {
      // The device write. Recorded verbatim; never performed.
      name: "stub-flasher",
      setup(b) {
        b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "flasher-stub", namespace: "st" }));
        b.onLoad({ filter: /^flasher-stub$/, namespace: "st" }, () => ({
          contents:
            `export async function flashImage(f, bank, offset, data, onProgress, log, opts){ ` +
            `return globalThis.__flashImage(f, bank, offset, data, onProgress, log, opts); }`,
          loader: "js",
        }));
      },
    },
  ],
});
const mod = await import(pathToFileURL(join(out, "flashInstall.js")).href);
const { buildFlashInstall, buildFrogfsImage, flashFrogfsRegion, flashInstallToDevice, BudgetError, FLASH_REGIONS } = mod;

// fs-builders' independent FrogFS parser (reverse of the builder) — read-back oracle.
const { parseFrogfs } = await import(
  pathToFileURL(join(repoRoot, "packages/fs-builders/dist/frogfsParse.js")).href
);
const { readSuperblock, superblockCrcValid, FLAG_RESERVED_OFFSET, FLAG_EXTFLASH_SIZE, FLAG_LITTLEFS_LENGTH } =
  await import(pathToFileURL(join(repoRoot, "packages/gnw-patch/dist/superblock.js")).href);

globalThis.__lzmaLoads = 0;
let writes = [];
globalThis.__flashImage = async (f, bank, offset, data, onProgress, log, opts) => {
  writes.push({ bank, offset, bytes: Uint8Array.from(data), opts: { ...opts } });
  onProgress?.(data.length, data.length);
};

// The real littlefs WASM logs progress on every create/mkdir/write. Silence it; `say`
// keeps this suite's own output.
console.log = () => {};

// --- Fixtures ----------------------------------------------------------------------------
const KB = 1024, MB = 1024 * 1024;
const bytes = (len, seed) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + seed * 97) & 0xff);

/** A 4 KiB intflash blob carrying one valid v2 GWLB layout superblock at 0x400. */
function blob(seed, len = 4096) {
  const b = bytes(len, seed);
  const off = 0x400;
  b.fill(0, off, off + 36);
  b.set([0x47, 0x57, 0x4c, 0x42], off);        // "GWLB"
  b[off + 4] = 2;                               // version = 2
  b[off + 6] = 36;                              // struct_size = 36
  // Scrub any accidental second magic elsewhere in the pseudo-random filler — locateSuperblock
  // refuses an image with two candidates, and a fixture that trips that would fail every test
  // for the wrong reason.
  for (let i = 0; i + 4 <= b.length; i += 4) {
    if (i === off) continue;
    if (b[i] === 0x47 && b[i + 1] === 0x57 && b[i + 2] === 0x4c && b[i + 3] === 0x42) b[i] ^= 0xff;
  }
  return b;
}

/**
 * The bundle's default content, keyed relative to sd_content/ exactly as
 * artifacts.ts contentFor() yields it. Deliberately ARMED: it contains the msx BIOS, two
 * KNOWN default homebrew titles, one UNKNOWN homebrew, four cores, a non-msx BIOS and a
 * default `roms/nes/game.nes` — so every "X is dropped" assertion below is made against a
 * map in which X would otherwise appear, and the same map proves it appears when the
 * condition flips.
 */
function defaultContent() {
  return new Map([
    ["cores/nes.bin",            bytes(64, 1)],
    ["cores/gb.bin",             bytes(64, 2)],
    ["cores/msx.bin",            bytes(64, 3)],
    ["cores/md.bin",             bytes(64, 4)],
    ["bios/msx/MSX.rom",         bytes(96, 5)],
    ["bios/msx/MSX2EXT.rom",     bytes(96, 6)],
    ["bios/gb/gb_bios.bin",      bytes(96, 7)],
    ["roms/homebrew/celeste.bin", bytes(128, 8)],
    ["roms/homebrew/tetris.bin",  bytes(128, 9)],
    ["roms/homebrew/mystery.bin", bytes(128, 10)],
    ["roms/nes/game.nes",         bytes(256, 11)],   // BUNDLED copy — user override target
    ["fonts/f.bin",               bytes(48, 12)],
    ["lang/de_de.bin",            bytes(48, 13)],
  ]);
}

const HOMEBREW_TITLES = [
  { key: "celeste", deviceFiles: ["celeste.bin"] },
  { key: "tetris", deviceFiles: ["tetris.bin"] },
];

/** Duck-typed FirmwareBundle. Records every contentFor() call so bank threading is checked. */
function bundle(content = defaultContent(), paths = undefined) {
  const calls = [];
  return {
    calls,
    // `dist` is the parsed firmware manifest, carried through verbatim by artifacts.ts.
    // `paths` undefined ⇒ the manifest declared none ⇒ the historical defaults.
    manifest: { cores: [], dist: { paths } },
    blobs: { 1: blob(101), 2: blob(102), sd_1: blob(103), sd_2: blob(104) },
    contentFor(bank, sd) { calls.push([bank, sd]); return new Map(content); },
  };
}

const EXT = 4 * MB, BLOCK = 4096, LFS_LEN = 256 * KB;
/** buildFlashInstall with fast, explicit geometry (a small LittleFS keeps the real WASM
 *  build quick; the auto path is exercised separately). */
const install = (over = {}) =>
  buildFlashInstall({
    bundle: over.bundle ?? bundle(),
    bank: 1,
    extflashSize: EXT,
    blockSize: BLOCK,
    userRoms: new Map(),
    littlefsLength: LFS_LEN,
    ...over,
  });

const frogPaths = (plan) => plan.frogfsFiles.map((f) => f.path).sort();
// `coreFiles` is everything bound for LittleFS, which since `lang/` moved there is cores AND
// language blobs. These assertions are about CORE FILTERING, so they look at cores only; a test
// that folded lang/ into its expectations would fail on every locale the release adds.
const corePaths = (plan) =>
  plan.coreFiles.map((f) => f.path).filter((p) => p.startsWith("cores/")).sort();
const lfsPaths = (plan) => plan.coreFiles.map((f) => f.path).sort();
const frogData = (plan, path) => plan.frogfsFiles.find((f) => f.path === path)?.data;
const has = (list, p) => list.includes(p);

// ========================================================================================
// 1. User files override bundle files of the same name
// ========================================================================================
// This is the mechanism the entire Sources install path relies on: a ROM the user supplies
// must WIN over the bundle's copy of the same dest. If it silently lost, the user would
// flash successfully and get the wrong game, with no error anywhere.

await check("a user ROM overrides the bundle's file of the same dest — and the bundle's copy is what lands without it", async () => {
  const b = bundle();
  const userBytes = bytes(300, 77);
  const withUser = await install({ bundle: b, userRoms: new Map([["nes/game.nes", userBytes]]) });
  bytesEq(frogData(withUser.plan, "roms/nes/game.nes"), userBytes, "user bytes must win");

  // ARMED: the identical build without the user entry yields the BUNDLED bytes, proving
  // the assertion above is not vacuously true of any content map.
  const withoutUser = await install({ bundle: bundle() });
  bytesEq(frogData(withoutUser.plan, "roms/nes/game.nes"), defaultContent().get("roms/nes/game.nes"),
    "the bundle's copy must land when the user supplies none");
  // ...and the two really are different bytes, or the check above proves nothing.
  assert(withUser.frogfs.length >= 0 && frogData(withUser.plan, "roms/nes/game.nes")[0] !==
    frogData(withoutUser.plan, "roms/nes/game.nes")[0], "fixture bug: user and bundle bytes are identical");

  // Exactly one entry for that dest — an override must REPLACE, never duplicate.
  eq(withUser.plan.frogfsFiles.filter((f) => f.path === "roms/nes/game.nes").length, 1, "no duplicate dest");
});

await check("the same override holds through buildFrogfsImage (the ROM-install path)", async () => {
  const userBytes = bytes(300, 78);
  const { plan } = await buildFrogfsImage(bundle(), 1, new Map([["nes/game.nes", userBytes]]));
  bytesEq(frogData(plan, "roms/nes/game.nes"), userBytes, "user bytes must win here too");
  const base = await buildFrogfsImage(bundle(), 1, new Map());
  bytesEq(frogData(base.plan, "roms/nes/game.nes"), defaultContent().get("roms/nes/game.nes"), "armed negative");
});

await check("a source core is reported as pending by the ROM-install path", async () => {
  // THE REAL CALL PATH, deliberately: `buildFrogfsImage` is what a ROM install uses, and it
  // returns only the FrogFS image -- `plan.coreFiles` is computed and dropped, because this
  // path never rebuilds the LittleFS partition (saves live there). For the bundle's cores the
  // drop is correct; they were written by the firmware install. A core supplied by a SOURCE
  // has been written by nothing, so the drop is silent data loss, and this is the seam where
  // the caller can still notice, and deliver them with `writeFilesToDeviceLfs`. Asserting on
  // planFlashImage alone would prove the rule while this path stayed blind to it.
  const { plan } = await buildFrogfsImage(bundle(), 1, new Map([
    ["cores/gba.bin", bytes(64, 11)],
    ["cores/gba.xip", bytes(64, 22)],
    ["nes/game.nes", bytes(32, 33)],
  ]));
  const src = plan.pendingLfsFiles.map((f) => f.path).sort();
  eq(src.join(","), "cores/gba.bin,cores/gba.xip", "both halves of the source core are reported");
  // And they are genuinely absent from the image this path actually writes.
  eq(plan.frogfsFiles.filter((f) => f.path.includes("cores/")).length, 0,
    "no core is smuggled into the FrogFS image instead");

  // Same seam, for `/data`: Retro-Go rewrites `/data/favorites.txt` at runtime, so it can never
  // sit in the read-only FrogFS image (`is_frogfs_path`/`_open`, syscalls.c:441,477).
  const { plan: dataPlan } = await buildFrogfsImage(bundle(), 1, new Map([
    ["data/favorites.txt", bytes(16, 44)],
  ]));
  eq(dataPlan.pendingLfsFiles.map((f) => f.path).join(","), "data/favorites.txt",
    "a /data file is pending, not dropped");
  eq(dataPlan.frogfsFiles.filter((f) => f.path.includes("data/")).length, 0,
    "no /data file is smuggled into the read-only FrogFS image");

  const clean = await buildFrogfsImage(bundle(), 1, new Map([["nes/game.nes", bytes(32, 33)]]));
  eq(clean.plan.pendingLfsFiles.length, 0, "armed negative: no source core, nothing reported");
});

// ========================================================================================
// 2. bios/msx omission — both directions
// ========================================================================================
// Shipping the MSX BIOS with no MSX games wastes scarce FrogFS space; dropping it when
// there ARE MSX games makes every MSX title fail to boot on-device.

await check("bios/msx is dropped when no MSX game is present, and kept when one is", async () => {
  // Negative direction. ARMED: this exact content map contains bios/msx/*, and the
  // positive case below keeps it from the SAME map.
  const none = await install({ userRoms: new Map([["nes/a.nes", bytes(64, 20)]]) });
  eq(none.plan.stats.omittedMsxBios, true, "omittedMsxBios must be true with no MSX games");
  assert(!frogPaths(none.plan).some((p) => p.startsWith("bios/msx")), `bios/msx survived: ${frogPaths(none.plan)}`);
  // Scoped: a non-MSX BIOS must NOT be collateral damage.
  assert(has(frogPaths(none.plan), "bios/gb/gb_bios.bin"), "bios/gb was wrongly deleted");

  // Positive direction, same content map, one MSX game added.
  const one = await install({ userRoms: new Map([["nes/a.nes", bytes(64, 20)], ["msx/g.rom", bytes(64, 21)]]) });
  eq(one.plan.stats.omittedMsxBios, false, "omittedMsxBios must be false with an MSX game");
  deepEq(frogPaths(one.plan).filter((p) => p.startsWith("bios/msx")),
    ["bios/msx/MSX.rom", "bios/msx/MSX2EXT.rom"], "both MSX BIOS files must survive");
  assert(has(one.plan.systems, "msx"), `msx must be an active system: ${one.plan.systems}`);
  assert(!has(none.plan.systems, "msx"), "msx must not be an active system without a game");
});

await check("a BUNDLED msx game (not a user one) is enough to keep the msx BIOS", async () => {
  // The system scan runs over the merged tree, so bundle-supplied MSX content must count
  // too. Same fixture, msx game injected on the bundle side instead of the user side.
  const c = defaultContent();
  c.set("roms/msx/bundled.rom", bytes(64, 22));
  const r = await install({ bundle: bundle(c) });
  eq(r.plan.stats.omittedMsxBios, false, "a bundled MSX game must keep the BIOS");
  assert(has(frogPaths(r.plan), "bios/msx/MSX.rom"), "MSX.rom must survive");
});

// ========================================================================================
// 3. Homebrew pruning
// ========================================================================================
// The bundle ALWAYS ships its own homebrew (celeste.bin). Unselecting it in the UI must
// actually remove it from the image, or the user sees a game they explicitly deleted come
// back after every install.

await check("unselected default homebrew is pruned; selected homebrew and unknown homebrew survive", async () => {
  const only = (sel) => install({ opts: { selectedHomebrew: new Set(sel), homebrewTitles: HOMEBREW_TITLES } });

  const tetrisOnly = await only(["tetris"]);
  const p = frogPaths(tetrisOnly.plan);
  assert(!has(p, "roms/homebrew/celeste.bin"), "unselected celeste must be pruned");
  assert(has(p, "roms/homebrew/tetris.bin"), "selected tetris must survive");
  // Unrecognised homebrew has no title entry, so the planner must leave it alone rather
  // than guess. (Documented behaviour in flashImage.ts step 2.5.)
  assert(has(p, "roms/homebrew/mystery.bin"), "unknown homebrew must be left alone");

  // ARMED, flipped: the SAME content map keeps celeste when it is selected.
  const both = await only(["celeste", "tetris"]);
  assert(has(frogPaths(both.plan), "roms/homebrew/celeste.bin"), "selected celeste must survive");
  assert(has(frogPaths(both.plan), "roms/homebrew/tetris.bin"), "selected tetris must survive");

  // Neither selected: both known titles go, the unknown one stays.
  const neither = await only([]);
  const pn = frogPaths(neither.plan);
  assert(!has(pn, "roms/homebrew/celeste.bin") && !has(pn, "roms/homebrew/tetris.bin"),
    `both known homebrew must be pruned: ${pn}`);
  assert(has(pn, "roms/homebrew/mystery.bin"), "unknown homebrew must still survive");

  // No selection passed at all ⇒ no pruning (the filter is opt-in).
  const noOpts = await install({});
  assert(has(frogPaths(noOpts.plan), "roms/homebrew/celeste.bin"), "no opts must mean no pruning");
});

await check("homebrew pruning needs homebrewTitles to resolve a filename to a key", async () => {
  // Without the title table the planner cannot map celeste.bin → "celeste", so it must
  // keep the file rather than delete something it cannot identify. Guards against a caller
  // that passes a selection but forgets the table (which would otherwise silently wipe or
  // silently keep, depending on the implementation).
  const r = await install({ opts: { selectedHomebrew: new Set([]) } });
  assert(has(frogPaths(r.plan), "roms/homebrew/celeste.bin"), "no title table ⇒ no pruning");
});

await check("homebrew pruning also applies on the buildFrogfsImage path", async () => {
  const { plan } = await buildFrogfsImage(bundle(), 1, new Map(),
    { selectedHomebrew: new Set(["tetris"]), homebrewTitles: HOMEBREW_TITLES });
  assert(!has(frogPaths(plan), "roms/homebrew/celeste.bin"), "celeste must be pruned here too");
  assert(has(frogPaths(plan), "roms/homebrew/tetris.bin"), "tetris must survive");
  const both = await buildFrogfsImage(bundle(), 1, new Map(),
    { selectedHomebrew: new Set(["celeste", "tetris"]), homebrewTitles: HOMEBREW_TITLES });
  assert(has(frogPaths(both.plan), "roms/homebrew/celeste.bin"), "armed negative");
});

// ========================================================================================
// 4. Core filtering
// ========================================================================================
// Cores go to LittleFS, which is the same partition as SAVES. Shipping four cores where
// one is needed eats save space; dropping the one that IS needed makes the system
// unlaunchable.

await check("installAllCores:false keeps only cores for active systems; true keeps them all", async () => {
  const roms = new Map([["nes/a.nes", bytes(64, 30)], ["gb/b.gb", bytes(64, 31)]]);

  const filtered = await install({ userRoms: roms, opts: { installAllCores: false } });
  deepEq(corePaths(filtered.plan), ["cores/gb.bin", "cores/nes.bin"], "only nes+gb cores");
  // ARMED: the same bundle DOES carry msx/md cores, and they come back when the flag flips.
  const all = await install({ userRoms: roms, opts: { installAllCores: true } });
  deepEq(corePaths(all.plan), ["cores/gb.bin", "cores/md.bin", "cores/msx.bin", "cores/nes.bin"], "all four cores");
  // Default (opts absent) must behave like `true` — the documented default.
  const dflt = await install({ userRoms: roms });
  deepEq(corePaths(dflt.plan), corePaths(all.plan), "omitting installAllCores must keep all cores");

  // Cores never leak into FrogFS, and FrogFS content never leaks into the cores tree.
  assert(!frogPaths(all.plan).some((p) => p.startsWith("cores/")), "cores must not be in FrogFS");
  assert(!corePaths(all.plan).some((p) => !p.startsWith("cores/")), "non-cores must not be in LittleFS");
});

await check("core filtering follows the systems the USER supplied, not the bundle's core list", async () => {
  // A bundle with NO default roms/, so the active-system set comes purely from the user's
  // folder. Only an md game ⇒ only the md core survives. Proves the filter reads the
  // active-system set rather than, say, keeping the first N cores or a fixed list.
  const c = defaultContent();
  for (const k of [...c.keys()]) if (k.startsWith("roms/")) c.delete(k);
  const r = await install({ bundle: bundle(c), userRoms: new Map([["md/s.md", bytes(64, 32)]]), opts: { installAllCores: false } });
  deepEq(corePaths(r.plan), ["cores/md.bin"], "only the md core");
  // ARMED: the bundle really does carry the other three, and they return when the flag flips.
  const all = await install({ bundle: bundle(c), userRoms: new Map([["md/s.md", bytes(64, 32)]]), opts: { installAllCores: true } });
  eq(corePaths(all.plan).length, 4, "the same bundle carries four cores");
  // ...and a bundle-supplied ROM counts as an active system too (the merged-tree scan).
  const withNes = new Map(c); withNes.set("roms/nes/bundled.nes", bytes(64, 35));
  const r2 = await install({ bundle: bundle(withNes), userRoms: new Map([["md/s.md", bytes(64, 32)]]), opts: { installAllCores: false } });
  deepEq(corePaths(r2.plan), ["cores/md.bin", "cores/nes.bin"], "a bundled ROM activates its core too");
});

await check("lfsData files are injected into the LittleFS tree and survive core filtering", async () => {
  // Save/config migration path — these must not be swept away by the installAllCores
  // filter, which only prunes `cores/<system>.bin`.
  const r = await install({
    userRoms: new Map([["nes/a.nes", bytes(64, 33)]]),
    opts: { installAllCores: false },
    lfsData: new Map([["retro-go/config", bytes(32, 34)]]),
  });
  // lfsData is not a core, so it is read off the full LittleFS-bound list, not corePaths.
  assert(has(lfsPaths(r.plan), "retro-go/config"), `lfsData must survive: ${lfsPaths(r.plan)}`);
  assert(has(corePaths(r.plan), "cores/nes.bin"), "the active core must survive");
  assert(!has(corePaths(r.plan), "cores/md.bin"), "an inactive core must still be pruned");
});

// ========================================================================================
// 5. dataStart preservation — the incremental-flash property
// ========================================================================================
// CLAUDE.md: "Missing skips are almost universally caused by opts.dataStart shifting,
// invalidating every hash block." A lost dataStart is not an error — it is a full rewrite
// where a ~20 ms skip was expected, every time, forever.

/** Lowest file data offset in a built image — the same quantity readFrogfsState reports. */
const imageDataStart = (img) => Math.min(...parseFrogfs(img).files.map((f) => f.dataOffs));
const offsetOf = (img, path) => parseFrogfs(img).files.find((f) => f.path === path)?.dataOffs;

await check("buildFlashInstall preserves a device-reported dataStart across a rebuild that adds a file", async () => {
  const roms1 = new Map([["nes/a.nes", bytes(200, 40)]]);
  const natural = imageDataStart((await install({ userRoms: roms1 })).frogfs);
  assert(natural > 0, "fixture bug: baseline dataStart is 0");

  // Stand in for readFrogfsState()'s result. dataStart is deliberately HIGHER than this
  // content's natural 4 KiB-aligned start — a real device image was packed with more (or
  // longer-named) files, which is exactly the situation where a dropped dataStart silently
  // relocates every byte of data and invalidates all 256 KiB hash blocks.
  const r1 = await install({ userRoms: roms1, frogfsState: { order: [], dataStart: natural + 4096 } });
  const state = {
    order: parseFrogfs(r1.frogfs).files.map((f) => f.path),
    dataStart: natural + 4096,
  };
  eq(imageDataStart(r1.frogfs), state.dataStart, "the requested dataStart must be honoured");

  // Add a ROM whose name sorts BEFORE the existing one, so without previousOrder it would
  // be laid down first and push the retained file's data offset along.
  const roms2 = new Map([["nes/a.nes", bytes(200, 40)], ["nes/AAA.nes", bytes(200, 41)]]);
  const r2 = await install({ userRoms: roms2, frogfsState: state });
  eq(imageDataStart(r2.frogfs), state.dataStart, "dataStart must be preserved across the rebuild");
  eq(offsetOf(r2.frogfs, "roms/nes/a.nes"), offsetOf(r1.frogfs, "roms/nes/a.nes"),
    "a retained file must keep its exact data offset (this is what makes 256 KiB hash blocks skip)");

  // ARMED: the identical pair of builds WITHOUT frogfsState really does move both the data
  // start and the retained file — so the assertions above test the threading, not an
  // invariant that would hold regardless.
  const u1 = await install({ userRoms: roms1 });
  const u2 = await install({ userRoms: roms2 });
  assert(imageDataStart(u1.frogfs) !== state.dataStart,
    "fixture bug: the natural dataStart already equals the requested one, so nothing is proven");
  assert(offsetOf(u2.frogfs, "roms/nes/a.nes") !== offsetOf(u1.frogfs, "roms/nes/a.nes"),
    "fixture bug: the retained file does not move without frogfsState, so ordering proves nothing");
});

await check("buildFrogfsImage preserves dataStart and retained data offsets across a rebuild that adds a file", async () => {
  // The sibling of the buildFlashInstall check above. buildFrogfsImage()'s output goes
  // straight to flashFrogfsRegion() — the incremental differential-flash path — so it needs
  // the same `previousOrder`/`dataStart` threading, from the same device source
  // (RomManagementTab's `previousFrogfsState`, derived from device.installedFrogfs).
  const roms1 = new Map([["nes/a.nes", bytes(200, 42)]]);
  const natural = imageDataStart((await buildFrogfsImage(bundle(), 1, roms1)).frogfs);
  assert(natural > 0, "fixture bug: baseline dataStart is 0");

  // dataStart deliberately ABOVE the natural one — a real device image packed with more (or
  // longer-named) files. Without this the assertions below would hold for free.
  const f1 = (await buildFrogfsImage(bundle(), 1, roms1, undefined,
    { order: [], dataStart: natural + 4096 })).frogfs;
  const state = {
    order: parseFrogfs(f1).files.map((f) => f.path),
    dataStart: natural + 4096,
  };
  eq(imageDataStart(f1), state.dataStart, "the requested dataStart must be honoured");

  // The added ROM sorts BEFORE the existing one, so without previousOrder it is laid down
  // first and pushes the retained file's data offset along.
  const roms2 = new Map([["nes/a.nes", bytes(200, 42)], ["nes/AAA.nes", bytes(200, 43)]]);
  const f2 = (await buildFrogfsImage(bundle(), 1, roms2, undefined, state)).frogfs;
  eq(imageDataStart(f2), state.dataStart, "dataStart must be preserved across the rebuild");
  eq(offsetOf(f2, "roms/nes/a.nes"), offsetOf(f1, "roms/nes/a.nes"),
    "a retained file must keep its exact data offset (this is what makes 256 KiB hash blocks skip)");

  // ARMED: the same pair of builds WITHOUT the state really does move both.
  const u1 = (await buildFrogfsImage(bundle(), 1, roms1)).frogfs;
  const u2 = (await buildFrogfsImage(bundle(), 1, roms2)).frogfs;
  assert(imageDataStart(u1) !== state.dataStart,
    "fixture bug: the natural dataStart already equals the requested one, so nothing is proven");
  assert(offsetOf(u2, "roms/nes/a.nes") !== offsetOf(u1, "roms/nes/a.nes"),
    "fixture bug: the retained file does not move without the state, so ordering proves nothing");
});

// ========================================================================================
// 6. Bank threading — content AND blob
// ========================================================================================
// Cores and homebrew binaries embed bank-specific absolute firmware addresses. Flashing
// bank-1 content into bank 2 is the documented 0x0810cdcd hardfault.

await check("the chosen bank selects BOTH the content set and the intflash blob", async () => {
  const b1 = bundle(); const r1 = await install({ bundle: b1, bank: 1 });
  deepEq(b1.calls, [[1, false]], "contentFor must be called once with (1, false)");
  eq(r1.bank, 1, "install.bank");

  const b2 = bundle(); const r2 = await install({ bundle: b2, bank: 2 });
  deepEq(b2.calls, [[2, false]], "contentFor must be called once with (2, false)");
  eq(r2.bank, 2, "install.bank");

  // The patched image must derive from THAT bank's blob. Compare a byte far from the
  // superblock, which patching does not touch.
  eq(r1.intflash[0], b1.blobs[1][0], "bank 1 must patch blobs[1]");
  eq(r2.intflash[0], b2.blobs[2][0], "bank 2 must patch blobs[2]");
  assert(b1.blobs[1][0] !== b1.blobs[2][0], "fixture bug: the two bank blobs start with the same byte");
});

await check("buildFrogfsImage requires and forwards the bank", async () => {
  const b = bundle();
  await buildFrogfsImage(b, 2, new Map());
  deepEq(b.calls, [[2, false]], "contentFor(2, false)");
});

// ========================================================================================
// 7. Layout + superblock — the geometry actually baked into the flashed blob
// ========================================================================================

await check("the superblock is patched with the computed layout, and stays CRC-valid", async () => {
  const RESERVED = 1 * MB;
  const r = await install({ reservedOffset: RESERVED, littlefsLength: LFS_LEN });
  assert(superblockCrcValid(r.intflash), "the patched superblock must pass the firmware's CRC check");
  const sb = readSuperblock(r.intflash);
  eq(sb.frogfsOffset, RESERVED, "frogfsOffset == reservedOffset");
  eq(sb.frogfsOffset, r.layout.frogfsOffset, "superblock must match the layout it was built from");
  eq(sb.frogfsLength, r.frogfs.length, "frogfsLength must be the REAL built image length");
  eq(sb.extflashSize, EXT, "extflashSize");
  eq(sb.littlefsLength, LFS_LEN, "littlefsLength");
  eq(r.layout.littlefsOffset, EXT - LFS_LEN, "LittleFS grows down from the top of the chip");
  eq(r.littlefs.length, LFS_LEN, "the built LittleFS image must exactly fill its partition");
  assert(r.layout.fits && r.layout.aligned, "a 4 MiB chip with a 1 MiB reserve must fit and be aligned");
  // FINDING-adjacent: the flash path sets extflash/littlefs override flags but NOT
  // FLAG_RESERVED_OFFSET (see the report). Asserted as current behaviour.
  assert((sb.flags & FLAG_EXTFLASH_SIZE) !== 0, "extflashSize override flag");
  assert((sb.flags & FLAG_LITTLEFS_LENGTH) !== 0, "littlefsLength override flag");
  eq(sb.flags & FLAG_RESERVED_OFFSET, 0, "flash path does not set FLAG_RESERVED_OFFSET (current behaviour)");
});

await check("patchSuperblockEnabled:false returns an unpatched, non-aliased copy of the blob", async () => {
  const b = bundle();
  const r = await install({ bundle: b, patchSuperblockEnabled: false });
  bytesEq(r.intflash, b.blobs[1], "the blob must be passed through byte-for-byte");
  r.intflash[0] ^= 0xff;
  assert(r.intflash[0] !== b.blobs[1][0], "the result must be a COPY — mutating it must not touch the bundle");
  // ARMED: with patching on, the same blob comes back CHANGED.
  const patched = await install({ bundle: bundle() });
  assert(patched.intflash[0x400 + 8] !== 0 || patched.intflash[0x420] !== 0,
    "fixture bug: patching produced a byte-identical blob");
});

await check("blobOverride replaces the bundle blob and is still superblock-patched", async () => {
  const custom = blob(200);
  const r = await install({ blobOverride: custom });
  eq(r.intflash[0], custom[0], "the override must be the base image");
  eq(readSuperblock(r.intflash).extflashSize, EXT, "the override must still be patched");
});

await check("BudgetError when content cannot fit the chip, and it fits when the chip is big enough", async () => {
  // ARMED both ways: same content, only the chip size differs.
  const tooSmall = await throwsWith(
    () => install({ extflashSize: 512 * KB, littlefsLength: 512 * KB, userRoms: new Map([["nes/a.nes", bytes(400 * KB, 50)]]) }),
    /doesn't fit this extflash/, "an over-budget install must throw");
  assert(tooSmall instanceof BudgetError, "must be a BudgetError, not a bare Error");
  const ok = await install({ extflashSize: 4 * MB, littlefsLength: 512 * KB, userRoms: new Map([["nes/a.nes", bytes(400 * KB, 50)]]) });
  assert(ok.layout.fits, "the same content must fit a 4 MiB chip");
});

await check("auto LittleFS sizing honours the 8 MiB floor", async () => {
  // No littlefsLength ⇒ max(LITTLEFS_FLOOR, cores + headroom). Small cores ⇒ the floor.
  const r = await install({ extflashSize: 64 * MB, littlefsLength: undefined });
  eq(r.layout.littlefsLength, 8 * MB, "the 8 MiB floor");
  eq(r.layout.littlefsOffset, 64 * MB - 8 * MB, "partition base");
});

// ========================================================================================
// 8. onStep sequencing (drives the install progress checklist)
// ========================================================================================

await check("onStep fires frogfs → littlefs → superblock, once each", async () => {
  const steps = [];
  await install({ onStep: (s) => steps.push(s) });
  deepEq(steps, ["frogfs", "littlefs", "superblock"], "step order");
});

await check("onStep is not fired past the point of failure", async () => {
  // A budget failure happens after the FrogFS build but before LittleFS — the checklist
  // must not claim steps that never ran.
  const steps = [];
  await throwsWith(
    () => install({ extflashSize: 512 * KB, littlefsLength: 512 * KB, userRoms: new Map([["nes/a.nes", bytes(400 * KB, 51)]]), onStep: (s) => steps.push(s) }),
    /doesn't fit/, "must throw");
  deepEq(steps, ["frogfs"], "only the steps that actually completed");
});

// ========================================================================================
// 9. The SD-card branch
// ========================================================================================

await check("sdCard uses the sd_<bank> blob, patches reservedOffset, and skips image building", async () => {
  const b = bundle();
  const steps = [];
  const RESERVED = 2 * MB;
  const r = await buildFlashInstall({
    bundle: b, bank: 2, extflashSize: EXT, blockSize: BLOCK, userRoms: new Map(),
    sdCard: true, reservedOffset: RESERVED, onStep: (s) => steps.push(s),
  });
  eq(r.sdCard, true, "sdCard flag");
  deepEq(steps, ["sdcache"], "the SD path fires only sdcache");
  deepEq(b.calls, [], "the SD path must not fetch flash content at all");
  eq(r.intflash[0], b.blobs.sd_2[0], "must use the sd_2 blob for bank 2");
  eq(r.frogfs.length, 0, "no FrogFS image");
  eq(r.littlefs.length, 0, "no LittleFS image");
  const sb = readSuperblock(r.intflash);
  // The documented fix: the round-robin ROM cache reads reservedOffset to know where it
  // may start writing. ARMED — a non-zero reserve that a dropped assignment would show as 0.
  eq(sb.reservedOffset, RESERVED, "reservedOffset must reach the superblock");
  assert((sb.flags & FLAG_RESERVED_OFFSET) !== 0, "FLAG_RESERVED_OFFSET must be set");
  eq(sb.frogfsOffset, 0, "frogfsOffset is an inert placeholder for SD builds");
  assert(superblockCrcValid(r.intflash), "CRC must be valid");
});

await check("a missing SD blob is an explicit error, not a silent empty flash", async () => {
  const b = bundle(); b.blobs.sd_1 = undefined;
  await throwsWith(
    () => buildFlashInstall({ bundle: b, bank: 1, extflashSize: EXT, blockSize: BLOCK, userRoms: new Map(), sdCard: true }),
    /SD blob missing/, "must throw");
  // ARMED: with the blob present the same call succeeds.
  const ok = await buildFlashInstall({ bundle: bundle(), bank: 1, extflashSize: EXT, blockSize: BLOCK, userRoms: new Map(), sdCard: true });
  eq(ok.sdCard, true, "the armed twin succeeds");
});

// ========================================================================================
// 10. Writing to the device — offsets, banks and options
// ========================================================================================
// Every assertion here is about WHERE bytes go. A wrong offset erases saves or the OFW
// backup at the bottom of the chip.

await check("flashInstallToDevice writes intflash→bank, FrogFS and LittleFS→bank 0 at their layout offsets", async () => {
  writes = [];
  const r = await install({ bank: 2, reservedOffset: 1 * MB });
  const regions = [];
  await flashInstallToDevice(undefined, r, undefined, undefined, undefined, (reg, ev) => regions.push(`${reg}:${ev}`));
  deepEq(regions, ["intflash:start", "intflash:done", "frogfs:start", "frogfs:done", "littlefs:start", "littlefs:done"],
    "region order + start/done pairing");
  eq(writes.length, 3, "one write per region (the 4 KiB blob is a single chunk)");
  deepEq(writes.map((w) => [w.bank, w.offset]),
    [[2, 0], [0, r.layout.frogfsOffset], [0, r.layout.littlefsOffset]], "bank/offset per region");
  bytesEq(writes[1].bytes, r.frogfs, "the FrogFS bytes written must be the built image");
  bytesEq(writes[2].bytes, r.littlefs, "the LittleFS bytes written must be the built image");
  // No read-back verify (CLAUDE.md: it tripled WebUSB traffic and caused ST-Link stalls).
  for (const w of writes) { eq(w.opts.compress, true, "compress"); eq(w.opts.verify, false, "verify must stay false"); }
});

await check("intflash emits real byte progress under its own region name (drives the phase bar)", async () => {
  // Wizard step 2 routes this region's progress to the PHASE level (no substepId) because the
  // artboard's "Flashing Retro-Go" phase has no intflash sub-step row — so the phase's percent
  // and 4px bar are fed by exactly these events. If this stops firing, that bar goes dead.
  writes = [];
  const seen = [];
  const r = await install({ blobOverride: blob(211, 640 * KB) });
  await flashInstallToDevice(undefined, r, (phase, d, t) => seen.push([phase, d, t]), undefined, ["intflash"]);
  assert(seen.length > 0, "intflash must report progress at all");
  assert(seen.every(([phase]) => phase === "intflash"), "every event must be tagged intflash");
  assert(seen.every(([, , t]) => t === r.intflash.length), "total must be the whole intflash image");
  eq(seen[seen.length - 1][1], r.intflash.length, "the last event must reach 100%");
  let prev = -1;
  for (const [, d] of seen) { assert(d > prev, "done must advance monotonically"); prev = d; }
});

await check("intflash is written in 256 KiB chunks at ascending offsets", async () => {
  writes = [];
  const r = await install({ blobOverride: blob(210, 640 * KB) });
  await flashInstallToDevice(undefined, r, undefined, undefined, ["intflash"]);
  deepEq(writes.map((w) => [w.bank, w.offset, w.bytes.length]),
    [[1, 0, 262144], [1, 262144, 262144], [1, 524288, 640 * KB - 524288]], "chunking");
  // Reassembled, the chunks must be exactly the patched image — no gap, no overlap.
  const joined = new Uint8Array(640 * KB);
  for (const w of writes) joined.set(w.bytes, w.offset);
  bytesEq(joined, r.intflash, "chunks must reassemble to the patched intflash");
});

await check("a region subset writes only those regions; an SD install writes intflash only", async () => {
  writes = [];
  const r = await install({});
  await flashInstallToDevice(undefined, r, undefined, undefined, ["frogfs"]);
  eq(writes.length, 1, "only one region"); eq(writes[0].offset, r.layout.frogfsOffset, "the FrogFS region");

  writes = [];
  const sd = await buildFlashInstall({ bundle: bundle(), bank: 1, extflashSize: EXT, blockSize: BLOCK, userRoms: new Map(), sdCard: true });
  // ARMED: FLASH_REGIONS (all three) is passed, and the SD flag alone must narrow it.
  await flashInstallToDevice(undefined, sd, undefined, undefined, FLASH_REGIONS);
  eq(writes.length, 1, "an SD install must write exactly one region");
  deepEq([writes[0].bank, writes[0].offset], [1, 0], "the intflash bank only — never the empty ext images");
});

await check("flashFrogfsRegion refuses an image that overruns the LittleFS ceiling, and writes one that fits", async () => {
  const geom = { frogfsOffset: 1 * MB, ceilingOffset: 1 * MB + 64 * KB };
  writes = [];
  const err = await throwsWith(() => flashFrogfsRegion(undefined, new Uint8Array(64 * KB + 1), geom),
    /don't fit the FrogFS gap/, "over-ceiling must throw");
  assert(err instanceof BudgetError, "must be a BudgetError");
  eq(writes.length, 0, "nothing may be written when the fit check fails");

  // ARMED: one byte smaller — exactly filling the gap — is accepted and written.
  const img = bytes(64 * KB, 60);
  await flashFrogfsRegion(undefined, img, geom);
  eq(writes.length, 1, "an exactly-fitting image must be written");
  deepEq([writes[0].bank, writes[0].offset], [0, 1 * MB], "extflash bank 0 at frogfsOffset");
  bytesEq(writes[0].bytes, img, "verbatim bytes");
  eq(writes[0].opts.verify, false, "no read-back verify");
  eq(writes[0].opts.compress, true, "LZMA transfer");
});

// ========================================================================================
// 11. Cross-cutting invariants
// ========================================================================================

await check("ROMs are stored RAW — the LZMA compressor is never invoked", async () => {
  // The stubbed lzmaRaw throws if called. Packing .lzma sidecars would decompress to the
  // heap on-device and HardFault (memory: emulator OOM). `skipped == frogfsFiles` is the
  // planner's own record of "nothing was compressed".
  const before = globalThis.__lzmaLoads;
  const r = await install({ userRoms: new Map([["nes/a.nes", bytes(4096, 70)]]) });
  eq(r.plan.stats.compressed, 0, "nothing may be compressed");
  eq(r.plan.stats.skipped, r.plan.stats.frogfsFiles, "every file must be stored raw");
  assert(globalThis.__lzmaLoads > before, "loadLiblzma must still be reached (the seam is live)");
  const f = await buildFrogfsImage(bundle(), 1, new Map([["nes/a.nes", bytes(4096, 71)]]));
  eq(f.plan.stats.compressed, 0, "buildFrogfsImage must be raw too");
  assert(!frogPaths(f.plan).some((p) => p.endsWith(".lzma")), "no .lzma sidecars");
});

await check("the built FrogFS image parses back to exactly the planned file set and contents", async () => {
  // End-to-end: plan → image → independent parser. Catches a plan whose files never make
  // it into the image (or arrive truncated), which no plan-level assertion above would see.
  const userBytes = bytes(777, 80);
  const r = await install({ userRoms: new Map([["nes/a.nes", userBytes], ["msx/g.rom", bytes(64, 81)]]) });
  const parsed = parseFrogfs(r.frogfs);
  deepEq(parsed.files.map((f) => f.path).sort(), frogPaths(r.plan), "image contents == plan contents");
  eq(parsed.head.binSize, r.frogfs.length, "the image self-describes its own length");
  const a = parsed.files.find((f) => f.path === "roms/nes/a.nes");
  bytesEq(r.frogfs.subarray(a.dataOffs, a.dataOffs + a.dataSize), userBytes, "the user's ROM bytes, verbatim, in the image");
});

await check("buildFlashInstall does not mutate the caller's userRoms map or the bundle blobs", async () => {
  const b = bundle();
  const blobCopy = Uint8Array.from(b.blobs[1]);
  const roms = new Map([["nes/a.nes", bytes(64, 90)]]);
  await install({ bundle: b, userRoms: roms });
  eq(roms.size, 1, "userRoms must not gain entries");
  deepEq([...roms.keys()], ["nes/a.nes"], "userRoms keys must be untouched");
  bytesEq(b.blobs[1], blobCopy, "the bundle blob must not be patched in place");
});

await check("install locations come from the firmware manifest's `paths`, not from constants", async () => {
  // The live manifest (docs/FIRMWARE_DIST.md `paths`) names the homebrew directory
  // `/homebrews`, plural — deliberately NOT the `roms/homebrew` this code hardcoded.
  const LIVE = { cores: "/cores", homebrew: "/homebrews", bios: "/bios", roms: "/roms",
                 covers: "/covers", cheats: "/cheats", data: "/data" };
  const content = new Map([
    ["cores/nes.bin", bytes(64, 1)],
    ["homebrews/celeste.bin", bytes(128, 2)],
    ["roms/nes/game.nes", bytes(128, 3)],
  ]);
  const r = await install({
    bundle: bundle(content, LIVE),
    userRoms: new Map([["homebrew/engine.bin", bytes(64, 4)]]),
  });
  const p = frogPaths(r.plan);
  assert(has(p, "homebrews/engine.bin"), "user homebrew lands in the declared /homebrews");
  assert(!has(p, "roms/homebrew/engine.bin"), "and not in the old hardcoded roms/homebrew");
  assert(has(p, "homebrews/celeste.bin"), "bundled homebrew keeps the manifest's directory");

  // The same call through the ROM-install entry point.
  const f = await buildFrogfsImage(bundle(content, LIVE), 1,
    new Map([["homebrew/engine.bin", bytes(64, 4)]]));
  assert(has(frogPaths(f.plan), "homebrews/engine.bin"),
    "buildFrogfsImage threads the manifest paths too");
});

await check("a manifest with no `paths` falls back to the hardcoded defaults", async () => {
  // A missing role is not an error: the schema does not mark roles required, so absence
  // carries no intent. Falling back reproduces exactly the pre-manifest behaviour.
  const content = new Map([["cores/nes.bin", bytes(64, 1)], ["roms/nes/game.nes", bytes(128, 3)]]);
  const r = await install({
    bundle: bundle(content, undefined),
    userRoms: new Map([["homebrew/engine.bin", bytes(64, 4)]]),
  });
  assert(has(frogPaths(r.plan), "roms/homebrew/engine.bin"), "default homebrew directory used");
  // Partially-declared paths: only the declared role moves.
  const partial = await install({
    bundle: bundle(content, { homebrew: "/homebrews" }),
    userRoms: new Map([["homebrew/engine.bin", bytes(64, 4)], ["nes/a.nes", bytes(64, 5)]]),
  });
  const pp = frogPaths(partial.plan);
  assert(has(pp, "homebrews/engine.bin"), "the declared role moves");
  assert(has(pp, "roms/nes/a.nes"), "an undeclared role keeps its default");
});

await check("a malformed manifest path is refused, not sanitised", async () => {
  const content = new Map([["cores/nes.bin", bytes(64, 1)]]);
  for (const badPath of ["/roms/../../etc", "/roms\\nes", "roms", "/"]) {
    let threw = null;
    try {
      await install({ bundle: bundle(content, { roms: badPath }), userRoms: new Map() });
    } catch (e) { threw = e; }
    assert(threw !== null && /paths\.roms/.test(String(threw.message)),
      `a bad path (${JSON.stringify(badPath)}) must abort the build, naming the role`);
  }
});

// --- Report -----------------------------------------------------------------------------
console.log = say;
say(`\nflashinstall: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
