#!/usr/bin/env node
/**
 * Offline coverage for the MANIFEST-DECLARED install locations as seen by the two sites that
 * do NOT have a firmware bundle in hand:
 *
 *  - `src/lib/engine/frogfsDevice.ts` — reading the games installed in the device's FrogFS.
 *  - `src/lib/engine/devicePaths.ts`'s `sdDestPath()` — where an SD sync writes each key
 *    (`RomManagementTab.svelte`'s `toSdPath` is a one-liner over it).
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/devicepaths.mjs'
 *
 * Plain node, no framework (repo convention). Nothing here touches a device.
 *
 * WHY: the firmware declares `paths.homebrew` as `/homebrews` (plural), where this code had
 * always assumed `roms/homebrew`. The WRITE side moved to the manifest (`flashImage.ts`'s
 * `userDest`); the device READ and the SD write did not, so installed homebrew read back as
 * nothing at all (and every "is this installed" check downstream silently said no), and an SD
 * sync put homebrew at `roms/homebrew/<file>` on the user's card. Both directions are pinned
 * here against a RENAMED homebrew role, so a re-hardcoded literal fails rather than passing
 * by coincidence with the defaults.
 *
 * The FrogFS image is built with the REAL builder (`FrogFsImage`, @gnw/fs-builders) and read
 * back through the real parser — no fixture bytes, no fake.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gnwResolveFor, gnwImport } from "./gnwResolve.mjs";

// --- Tiny harness ----------------------------------------------------------------------
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function assert(c, msg) { if (!c) throw new Error(msg || "assertion failed"); }

// --- Compile the modules under test ------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-devicepaths-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [
    join(here, "../src/lib/engine/frogfsDevice.ts"),
    join(here, "../src/lib/engine/devicePaths.ts"),
  ],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  plugins: [gnwResolveFor(import.meta.url)],
  logLevel: "warning",
});
const { readInstalledFrogfs } = await import(pathToFileURL(join(out, "frogfsDevice.js")).href);
const { sdDestPath, deviceInstallPaths, rememberInstallPaths, forgetInstallPaths, homebrewDirs,
        classifySdScanKey, homebrewScanPrefixes, nonGameDirs, shadowedLegacyHomebrewKeys } =
  await import(pathToFileURL(join(out, "devicePaths.js")).href);

// The REAL romScan walk, with only its store imports faked (same shape as fsnode.mjs). The SD
// read is a round trip -- what sdDestPath WROTE has to come back through the scan and classify
// as the same thing -- so both halves have to be the real code, not a re-implementation.
await esbuild.build({
  entryPoints: [join(here, "../src/lib/romScan.ts")],
  outfile: join(out, "romScan.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), {
    name: "romscan-fakes",
    setup(build) {
      const fakes = {
        // The homebrew whitelist: SMW's two device files, so the walk keeps them the way a real
        // session with that source added would. `devicePaths.js` is deliberately NOT faked --
        // the directory rule under test lives there.
        "homebrewTitles.svelte.js":
          "export const homebrew = { deviceFiles: new Set([\"SMW.bin\", \"smw_assets.bin\"]) };" +
          "export const isHomebrewSourceFile = () => false;",
        "coreRegistry.svelte.js":
          "export const coreRegistry = { current: { systems: [], byFolder: new Map(), declaredFolders: new Set(), hasCoreSources: false } };",
        "debug.js": "export const dbg = () => {}; export const setDbgSink = () => {};",
        "util.js": "export const download = () => {};",
        "device.svelte.js": "export const device = { sdHandle: null, scanSdCardGames: async () => {} };",
        "sdFolderPick.svelte.js": "export const runSdCardFolderPick = async () => {};",
      };
      build.onResolve(
        { filter: /(homebrewTitles\.svelte|coreRegistry\.svelte|device\.svelte|sdFolderPick\.svelte|debug|util)\.js$/ },
        (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "rs-fake" }),
      );
      build.onLoad({ filter: /.*/, namespace: "rs-fake" }, (a) => ({ contents: fakes[a.path], loader: "js" }));
    },
  }],
});
const { scanRomDirectory, getValidRoot } = await import(pathToFileURL(join(out, "romScan.js")).href);

/** A fake card: a nested plain-object directory handle, files as strings. */
function card(tree) {
  const dir = (node) => ({
    kind: "directory",
    async *entries() {
      for (const [name, v] of Object.entries(node)) {
        yield [name, typeof v === "string"
          ? { kind: "file", async getFile() { return { size: v.length, async arrayBuffer() { return new TextEncoder().encode(v).buffer; } }; } }
          : dir(v)];
      }
    },
  });
  return dir(tree);
}

/** The whole SD read: real walk, real classifier. Returns InstalledGame-shaped rows. */
async function readCard(tree, paths) {
  const root = await getValidRoot(card(tree), { systems: [], byFolder: new Map(), declaredFolders: new Set(), hasCoreSources: false });
  if (!root) return null;
  const scan = await scanRomDirectory(root);
  const games = [];
  for (const [key, data] of scan.userRoms.entries()) {
    const g = classifySdScanKey(key, paths);
    if (g) games.push({ ...g, size: data.length });
  }
  return games;
}

/** The real completeness rule (homebrewTitles.ts:303), which is what the UI actually asks. */
const isComplete = (deviceFiles, games) => {
  const present = new Set(games.filter((g) => g.system === "homebrew").map((g) => g.name));
  return deviceFiles.length > 0 && deviceFiles.every((f) => present.has(f));
};
// The SHIPPED attribution rule -- `homebrew.owning()` is a one-line delegate to this. Built on
// its own: a second entry point from another directory changes esbuild's outdir layout.
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/homebrewOwner.ts")],
  outfile: join(out, "homebrewOwner.js"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022",
  external: ["@gnw/*"], plugins: [gnwResolveFor(import.meta.url)], logLevel: "warning",
});
const { owningTitle } = await import(pathToFileURL(join(out, "homebrewOwner.js")).href);
const { FrogFsImage, resolveInstallPaths, DEFAULT_INSTALL_PATHS } =
  await gnwImport(import.meta.url, "fs-builders");

// The live manifest's shape (docs/FIRMWARE_DIST.md), homebrew plural and absolute.
const LIVE_PATHS_RAW = {
  cores: "/cores",
  homebrew: "/homebrews",
  bios: "/bios",
  roms: "/roms",
  covers: "/covers",
  cheats: "/cheats",
  data: "/data",
};
const LIVE = resolveInstallPaths(LIVE_PATHS_RAW);
// A DIFFERENT rename, so nothing can pass by matching the live literal either.
const RENAMED = resolveInstallPaths({ ...LIVE_PATHS_RAW, homebrew: "/hb-apps", roms: "/games" });

function image(files) {
  const img = new FrogFsImage();
  for (const [path, text] of files) img.addFile(path, new TextEncoder().encode(text));
  return img.build();
}
const readerFor = (bytes) => async (off, len) => bytes.slice(off, Math.min(off + len, bytes.length));

// --- The device read ---------------------------------------------------------------------
await check("homebrew under the manifest's paths.homebrew reads back as an installed game", async () => {
  const bytes = image([
    ["homebrews/celeste.bin", "hb"],
    ["roms/nes/smb.nes", "rom"],
    ["bios/gb_bios.bin", "bios"],
  ]);
  const res = await readInstalledFrogfs(readerFor(bytes), 0, LIVE);
  const hb = res.games.filter((g) => g.system === "homebrew");
  eq(hb.length, 1, "one homebrew game read back");
  eq(hb[0].name, "celeste.bin", "homebrew file name");
  eq(hb[0].path, "homebrews/celeste.bin", "homebrew device path preserved");
  assert(hb[0].size > 0, "homebrew size read back");
  eq(res.games.filter((g) => g.system === "nes").length, 1, "the ROM is still a game");
  eq(res.games.length, 2, "bios/ is not a game");
});

await check("a RENAMED homebrew role flows through the read", async () => {
  const bytes = image([["hb-apps/tetris.bin", "hb"], ["games/gbc/zelda.gbc", "rom"]]);
  const res = await readInstalledFrogfs(readerFor(bytes), 0, RENAMED);
  eq(res.games.filter((g) => g.system === "homebrew").map((g) => g.name).join(), "tetris.bin", "renamed homebrew dir");
  eq(res.games.filter((g) => g.system === "gbc").map((g) => g.name).join(), "zelda.gbc", "renamed roms dir");
});

await check("the pre-manifest layout still reads back (a device installed before the cutover)", async () => {
  const bytes = image([["roms/homebrew/celeste.bin", "hb"], ["roms/nes/smb.nes", "rom"]]);
  // Read with the LIVE manifest — the device's own content predates it.
  const res = await readInstalledFrogfs(readerFor(bytes), 0, LIVE);
  eq(res.games.filter((g) => g.system === "homebrew").map((g) => g.name).join(), "celeste.bin", "legacy homebrew dir");
  eq(res.games.filter((g) => g.system === "nes").length, 1, "roms unaffected");
  // …and with the defaults, which is what an un-learned session uses.
  const res2 = await readInstalledFrogfs(readerFor(bytes), 0, DEFAULT_INSTALL_PATHS);
  eq(res2.games.filter((g) => g.system === "homebrew").length, 1, "defaults classify homebrew");
});

await check("homebrewDirs() never repeats the default", () => {
  eq(homebrewDirs(DEFAULT_INSTALL_PATHS).length, 1, "defaults: one dir");
  eq(homebrewDirs(LIVE).join(), `homebrews,${DEFAULT_INSTALL_PATHS.homebrew}`, "manifest dir first, default second");
});

// --- The SD write ------------------------------------------------------------------------
await check("SD sync writes homebrew to the manifest's homebrew directory", () => {
  eq(sdDestPath("homebrew/celeste.bin", "homebrew", LIVE), "homebrews/celeste.bin", "live manifest");
  assert(!sdDestPath("homebrew/celeste.bin", "homebrew", LIVE).startsWith("roms/"), "never under roms/");
  eq(sdDestPath("homebrew/celeste.bin", "homebrew", RENAMED), "hb-apps/celeste.bin", "renamed role");
  eq(sdDestPath("homebrew/celeste.bin", "homebrew", DEFAULT_INSTALL_PATHS), "roms/homebrew/celeste.bin", "pre-manifest default");
});

await check("SD sync paths for every other category are unchanged", () => {
  eq(sdDestPath("GBC/zelda.gbc", "game", LIVE), "roms/GBC/zelda.gbc", "game");
  eq(sdDestPath("GBC/zelda.gbc", "game", RENAMED), "games/GBC/zelda.gbc", "game, renamed roms role");
  eq(sdDestPath("covers/nes/smb.img", "cover", LIVE), "covers/nes/smb.img", "cover passes through");
  eq(sdDestPath("bios/gb_bios.bin", "bios", LIVE), "bios/gb_bios.bin", "bios passes through");
  eq(sdDestPath("cheats/nes/smb.ggcodes", "cheat", LIVE), "cheats/nes/smb.ggcodes", "cheat passes through");
});

// --- Learning the paths from a manifest ---------------------------------------------------
await check("rememberInstallPaths teaches both directions; forgetting returns to the defaults", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
  try {
    forgetInstallPaths();
    eq(deviceInstallPaths().homebrew, DEFAULT_INSTALL_PATHS.homebrew, "nothing learned yet");
    rememberInstallPaths(LIVE_PATHS_RAW);
    eq(deviceInstallPaths().homebrew, "homebrews", "learned from the manifest");
    // …and the defaulted parameters of both sites now follow it.
    eq(sdDestPath("homebrew/celeste.bin", "homebrew"), "homebrews/celeste.bin", "SD write uses the learned paths");
    const bytes = image([["homebrews/celeste.bin", "hb"]]);
    const res = await readInstalledFrogfs(readerFor(bytes), 0);
    eq(res.games.length, 1, "device read uses the learned paths");
    assert(store.size > 0, "the manifest paths were persisted");
    forgetInstallPaths();
    eq(deviceInstallPaths().homebrew, DEFAULT_INSTALL_PATHS.homebrew, "forgotten");
  } finally {
    delete globalThis.localStorage;
  }
});

// --- Bug 3: the SD write branch must test WRITE-BACK, not mere presence -------------------
// `pickFolder()` returns the `<input webkitdirectory>` shim tree on non-Chromium and
// `pickSdCardFolder()` assigns it to `device.sdHandle` regardless, so a truthy handle proves
// nothing. Two halves: the predicate itself, and the branch that must consult it.
await check("dirSupportsWriteBack rejects a read-only shim handle", async () => {
  const romOut = mkdtempSync(join(tmpdir(), "gnw-romscan-"));
  const { writeFileSync } = await import("node:fs");
  // romScan pulls the device store and the homebrew-titles rune store; neither is used by the
  // predicate under test and neither compiles under plain esbuild ($state). CommonJS stub:
  // esbuild's interop allows any NAMED import off it.
  const stub = join(romOut, "rune-stub.cjs");
  writeFileSync(stub, "module.exports = new Proxy({}, { get: () => new Proxy(function(){}, { get: () => undefined }) });\n");
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/romScan.ts")],
    outdir: romOut,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["@gnw/*"],
    plugins: [
      gnwResolveFor(import.meta.url),
      {
        name: "rune-stores",
        setup(b) {
          b.onResolve({ filter: /\.svelte\.js$/ }, () => ({ path: stub }));
        },
      },
    ],
    logLevel: "warning",
  });
  const { dirSupportsWriteBack } = await import(pathToFileURL(join(romOut, "romScan.js")).href);
  eq(dirSupportsWriteBack(null), false, "no handle");
  // The shim tree: real directory entries, no FSAA write surface.
  eq(dirSupportsWriteBack({ name: "roms", entries: () => [] }), false, "webkitdirectory shim");
  eq(dirSupportsWriteBack({ getDirectoryHandle: () => {}, getFileHandle: () => {} }), true, "native FSAA handle");
});

await check("doSdSync's per-file write branch is gated on write-back, with a ZIP fallback", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  assert(
    /if \(sdHandle && dirSupportsWriteBack\(sdHandle\)\) \{/.test(src),
    "the write branch must test dirSupportsWriteBack(sdHandle), not just `if (sdHandle)` — a shim handle is truthy",
  );
  assert(/new JSZip\(\)/.test(src), "the else branch still packs a ZIP");
  assert(
    src.indexOf("dirSupportsWriteBack") < src.indexOf("new JSZip()"),
    "the gate precedes the fallback",
  );
});

// --- The SD read (the third site: what an SD sync wrote, read back) -----------------------
// The owner's report: "On SD, the UI isn't recognizing that I already have smw installed."
// The scan took the key's top segment as the system verbatim, so homebrew at the manifest's
// `/homebrews` arrived as system "homebrews" while every consumer filters for "homebrew".
const SMW = ["SMW.bin", "smw_assets.bin"];

await check("SD: a homebrew title installed at the manifest's homebrew directory reads as installed", async () => {
  const games = await readCard({
    homebrews: { "SMW.bin": "bin", "smw_assets.bin": "assets" },
    roms: { nes: { "smb.nes": "rom" } },
  }, LIVE);
  assert(games, "the card is a valid root");
  assert(isComplete(SMW, games), "SMW reads as installed");
  const hb = games.filter((g) => g.system === "homebrew");
  eq(hb.length, 2, "both device files classify as homebrew");
  eq(hb.map((g) => g.name).sort().join(), "SMW.bin,smw_assets.bin", "names are relative to the homebrew dir");
  eq(hb.find((g) => g.name === "SMW.bin").path, "homebrews/SMW.bin", "path is where the file really is");
  eq(games.filter((g) => g.system === "nes").length, 1, "the ROM is still a game");
});

await check("SD: the system is never the raw directory name", async () => {
  const games = await readCard({
    homebrews: { "SMW.bin": "bin" },
    roms: { nes: { "smb.nes": "rom" } },
  }, LIVE);
  assert(!games.some((g) => g.system === "homebrews"), "no game carries the plural directory as its system");
});

await check("SD: a RENAMED homebrew role flows through the read", async () => {
  // The console dir sits at the root here so `getValidRoot` accepts the card: root DETECTION
  // still hardcodes "roms" (romScan.ts:196) and does not follow `paths.roms`. That is the same
  // class of literal and is deliberately out of scope -- no shipped manifest renames the roms
  // role, and root detection also governs a locally picked ROM folder, so widening it is a
  // bigger change than the bug being fixed. Recorded, not fixed.
  const games = await readCard({
    "hb-apps": { "SMW.bin": "bin", "smw_assets.bin": "assets" },
    nes: { "smb.nes": "rom" },
  }, RENAMED);
  assert(games, "the card is a valid root");
  assert(isComplete(SMW, games), "SMW reads as installed under a renamed homebrew role");
  eq(games.filter((g) => g.system === "nes").length, 1, "the ROM is still a game");
});

await check("SD: the pre-manifest layout still reads back", async () => {
  const tree = { roms: { homebrew: { "SMW.bin": "bin", "smw_assets.bin": "assets" }, nes: { "smb.nes": "rom" } } };
  assert(isComplete(SMW, await readCard(tree, LIVE)), "read with the live manifest");
  assert(isComplete(SMW, await readCard(tree, DEFAULT_INSTALL_PATHS)), "read with the defaults");
});

await check("SD: assets are not games, and follow the manifest too", async () => {
  const games = await readCard({
    roms: { nes: { "smb.nes": "rom" } },
    covers: { nes: { "smb.img": "c" } },
    bios: { "gb_bios.bin": "b" },
    cheats: { nes: { "smb.ggcodes": "x" } },
  }, LIVE);
  eq(games.length, 1, "only the ROM is a game");
  eq(games[0].system, "nes", "and it is the ROM");
});

// The owner's report: "On SD, the Library shows games with a 'cores' chip... That's very
// incorrect. We only look at /roms/<console>/ and /homebrews/ - that's it."
//
// Stated as an ALLOW-LIST on purpose. The bug was an exclusion list that named three asset
// directories and treated every other top segment as a console, so a check that only asserted
// `cores/` is rejected would pass while fonts/, lang/, data/ and screenshots/ still became
// systems. This lays the whole firmware root on one card and asserts what SURVIVES.
await check("SD: only the roms directory and homebrew hold games, everything else is furniture", async () => {
  const games = await readCard({
    roms: { gb: { "tetris.gb": "rom" } },
    homebrews: { "SMW.bin": "bin" },
    // Every other directory a real card carries. Manifest roles...
    cores: { "gba.bin": "core", "doom.bin": "core" },
    bios: { "gb_bios.bin": "b" },
    covers: { gb: { "tetris.img": "c" } },
    cheats: { gb: { "tetris.ggcodes": "x" } },
    data: { "tetris.sav": "save" },
    // ...and the firmware's own directories that no manifest role names.
    fonts: { "cp1252_serif.bin": "f" },
    font: { "legacy.bin": "f" },
    lang: { "de_de.bin": "l" },
    screenshots: { "0001-tetris.bmp": "s" },
  }, LIVE);
  assert(games, "the card is a valid root");
  const systems = [...new Set(games.map((g) => g.system))].sort();
  eq(systems.join(), "gb,homebrew", `only the console and homebrew are games, got: ${systems.join()}`);
  eq(games.filter((g) => g.system === "gb").length, 1, "the ROM is still a game");
  eq(games.filter((g) => g.system === "homebrew").length, 1, "the homebrew is still a game");
});

// Named individually as well as collectively: the sweep above proves the SET is right, these
// prove each directory the owner listed is rejected for its OWN reason and name the offender in
// the failure text when one regresses.
for (const [dir, file] of [
  ["cores", "gba.bin"], ["fonts", "cp1252_serif.bin"], ["font", "legacy.bin"],
  ["lang", "de_de.bin"], ["data", "tetris.sav"], ["screenshots", "0001.bmp"],
]) {
  await check(`SD: ${dir}/ is not a console`, () => {
    eq(classifySdScanKey(`${dir}/${file}`, LIVE), null,
      `${dir}/${file} classified as a game, so the Library draws it with a "${dir}" chip`);
  });
}

await check("SD: the exclusion follows the manifest, including roles this codebase does not use", () => {
  // `extra` is what `resolveInstallPaths` carries through for a role a LATER firmware declares.
  // A hardcoded list could not know about it; this is why nonGameDirs is derived.
  const future = resolveInstallPaths({ ...LIVE_PATHS_RAW, shaders: "/shaders" });
  assert(nonGameDirs(future).includes("shaders"), "a role only the manifest knows is still not a console");
  eq(classifySdScanKey("shaders/crt.bin", future), null, "and a file under it is not a game");
  // The roms directory itself must never end up excluded, whatever the manifest says.
  assert(!nonGameDirs(future).includes(future.roms), "the games directory is not excluded");
});

await check("SD: a file loose in the roms directory belongs to no console", () => {
  // The firmware reads `/roms/<system>/`, so `roms/foo.gb` names no system. The scan strips the
  // `roms/` prefix, so this arrives with no slash at all -- the same shape as a file at the
  // storage root, and rejected for the same reason.
  eq(classifySdScanKey("foo.gb", LIVE), null, "a bare filename is not a game");
});

await check("SD: what sdDestPath WRITES is what the read classifies back", async () => {
  // One key through the write side, laid on a card at exactly that path, read back.
  const dest = sdDestPath("homebrew/SMW.bin", "homebrew", LIVE);
  eq(dest, "homebrews/SMW.bin", "the write side, for reference");
  const tree = { roms: { nes: { "smb.nes": "r" } } };
  let node = tree;
  const segs = dest.split("/");
  for (const seg of segs.slice(0, -1)) node = node[seg] ??= {};
  node[segs[segs.length - 1]] = "bin";
  const games = await readCard(tree, LIVE);
  const hb = games.filter((g) => g.system === "homebrew");
  eq(hb.length, 1, "the written file reads back as one homebrew game");
  eq(hb[0].path, dest, "and at the path the write side chose");
});

await check("walk() looks for homebrew where the manifest says, in both key spaces", () => {
  const live = homebrewScanPrefixes(LIVE);
  assert(live.includes("homebrews"), "the manifest directory");
  assert(live.includes("roms/homebrew") && live.includes("homebrew"),
    "and the pre-manifest default in both the rooted and roms-relative forms");
  eq(homebrewScanPrefixes(RENAMED).includes("hb-apps"), true, "a renamed role");
});

await check("SD: scanSdCardGames DELEGATES the classification, it does not re-derive it", async () => {
  // The rule being right is not enough: this bug WAS a correct rule with a call site that
  // never reached it. Comments are stripped first so the note explaining the delegation
  // cannot vouch for it (mutation-verification-failure-modes, #1).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(here, "../src/lib/device.svelte.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const body = src.slice(src.indexOf("async scanSdCardGames"));
  const loop = body.slice(0, body.indexOf("this.installedGames = games"));
  assert(/classifySdScanKey\(/.test(loop), "the scan loop calls classifySdScanKey");
  assert(!/parts\[0\]/.test(loop), "it does not take the key's top segment as the system itself");
  assert(!/"roms\/"\s*\+/.test(loop), "it does not build the path by prefixing roms/");
  for (const lit of ['"covers/"', '"cheats/"', '"bios/"']) {
    assert(!loop.includes(lit), `the asset skip ${lit} is the classifier's job now`);
  }
});

// --- A core's binaries (the owner's card: roms/cores/doom.bin, where nothing looks) --------
await check("SD sync writes a core's binary to the manifest's cores directory", () => {
  eq(sdDestPath("cores/doom.bin", "game", LIVE), "cores/doom.bin", "live manifest");
  assert(!sdDestPath("cores/doom.bin", "game", LIVE).startsWith("roms/"),
    "a core never lands under the roms directory -- the firmware looks in /cores");
  eq(sdDestPath("cores/doom.bin", "game", DEFAULT_INSTALL_PATHS), "cores/doom.bin", "pre-manifest default");
});

await check("a core's directory is the manifest's, not a literal", () => {
  const renamedCores = resolveInstallPaths({ ...LIVE_PATHS_RAW, cores: "/engines" });
  eq(sdDestPath("engines/doom.bin", "game", renamedCores), "engines/doom.bin", "a renamed cores role passes through");
  // …and the literal "cores" is then just a ROM system like any other, not a special case.
  eq(sdDestPath("cores/doom.bin", "game", renamedCores), "roms/cores/doom.bin",
    "with cores renamed, a `cores/` key is no longer the cores directory");
});

// The SD mapper above and the FLASH mapper must not drift: `devicePaths.ts` says three times
// that it mirrors `flashImage.ts`'s `userDest`, and the drift is exactly what shipped -- the SD
// half was fixed with a comment asserting flash was safe, while flash was prefixing a core the
// same way. `userDest` is not re-exported from the package index (see flashImage.mjs), so this
// reaches THIS checkout's dist by relative path rather than through `gnwImport`.
const { userDest } = await import(
  pathToFileURL(join(here, "../../../packages/fs-builders/dist/flashImage.js")).href
);

await check("the SD and FLASH mappers agree on a core", () => {
  for (const paths of [LIVE, DEFAULT_INSTALL_PATHS]) {
    eq(userDest("cores/doom.bin", paths), sdDestPath("cores/doom.bin", "game", paths),
      "both mappers place a core identically");
    assert(!userDest("cores/doom.bin", paths).startsWith("roms/"),
      "the flash mapper does not prefix a core with the roms directory either");
  }
  const renamed = resolveInstallPaths({ ...LIVE_PATHS_RAW, cores: "/engines" });
  eq(userDest("engines/doom.bin", renamed), sdDestPath("engines/doom.bin", "game", renamed),
    "both follow a renamed cores role");
});

await check("a ROM is still a ROM", () => {
  eq(sdDestPath("nes/smb.nes", "game", LIVE), "roms/nes/smb.nes", "the roms fallback is untouched");
  eq(sdDestPath("doom/The Ultimate Doom.whd", "game", LIVE), "roms/doom/The Ultimate Doom.whd",
    "a converted game is a ROM under its console");
});

// --- A dataDir title: ONE entry, N data files (the owner saw 21 "openlara/CUT1.PKD" titles) ---
//
// `owning()` is the real rule the Library filters `unknownHomebrew` by. A derived output is
// named after the user's input, so `deviceFiles` can never list it -- attribution has to come
// from the title's `dataDir`, or every level reads as an unowned file and is drawn as a title.
await check("a dataDir title owns its nested data: one entry, N data files", async () => {
  const PKD = ["CUT1.PKD", "GYM.PKD", "LEVEL1.PKD"];
  const tree = { homebrews: { "OpenLara.bin": "bin", openlara: {} }, roms: { nes: { "smb.nes": "r" } } };
  for (const f of PKD) tree.homebrews.openlara[f] = "pkd";
  const games = await readCard(tree, LIVE);
  const hb = games.filter((g) => g.system === "homebrew");
  eq(hb.length, 1 + PKD.length, "every file is still an installed homebrew file");

  // The real owning() rule, with OpenLara's shape: a binary declared, levels only derived.
  const titles = [{ key: "x/openlara#openlara", deviceFiles: ["OpenLara.bin"], derivedOutputs: 21, dataDir: "openlara" }];
  const owning = (name) => owningTitle(titles, name);

  const unowned = hb.filter((g) => !owning(g.name));
  eq(unowned.length, 0, "no level is drawn as a title of its own");
  eq(hb.filter((g) => owning(g.name)?.dataDir === "openlara" && g.name.includes("/")).length, PKD.length,
    "the levels are attributed to OpenLara as its data");
  // The bytes are still there: this must not be fixed by hiding them from the scan, or the
  // install flows stop PRESERVING them and the next install wipes the levels.
  assert(hb.every((g) => g.size > 0), "every data file keeps its size");
});

await check("owning() prefers a DECLARED name over the directory", async () => {
  const titles = [
    { key: "a", deviceFiles: ["shared/thing.bin"], dataDir: undefined },
    { key: "b", deviceFiles: [], dataDir: "shared" },
  ];
  const owning = (name) => owningTitle(titles, name);
  eq(owning("shared/thing.bin").key, "a", "a title that declares the nested path wins on its own name");
  eq(owning("shared/other.bin").key, "b", "anything else in that directory falls to its owner");
});

await check("SMW's two top-level files are unaffected", async () => {
  const games = await readCard({
    homebrews: { "Super Mario World.bin": "b", "smw_assets.dat": "a" },
    roms: { nes: { "smb.nes": "r" } },
  }, LIVE);
  const hb = games.filter((g) => g.system === "homebrew");
  eq(hb.map((g) => g.name).sort().join(), "Super Mario World.bin,smw_assets.dat", "both, unnested");
  assert(hb.every((g) => !g.name.includes("/")), "nothing became nested");
});

await check("homebrew.owning() DELEGATES to the shipped rule", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(here, "../src/lib/sources/homebrewTitles.svelte.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const fn = src.slice(src.indexOf("owning(deviceFile"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert(/owningTitle\(\s*this\.titles\s*,\s*deviceFile\s*\)/.test(body),
    "the store calls owningTitle -- a second copy of the rule here is how the two drift apart");
  assert(!/deviceFiles\.includes/.test(body), "and does not re-derive the declared match itself");
});

await check("owning() is CASE-FOLDED, or a deselected title can never be removed", async () => {
  // The card holds one file per name whatever its case (gwrg-dist-spec 930517c). A title whose
  // declared name differs only in capitalisation from what the device reports was UNOWNED, and
  // `runInstall`'s retain step keeps an unowned file unconditionally -- so deselecting the title
  // removed nothing, which is the shape the owner reported for Minesweeper.
  const titles = [{ key: "x/mine#hb", deviceFiles: ["Minesweeper.bin"], dataDir: undefined }];
  const owning = (name) => owningTitle(titles, name);
  eq(owning("Minesweeper.bin")?.key, "x/mine#hb", "the exact name, as before");
  eq(owning("MINESWEEPER.BIN")?.key, "x/mine#hb", "and the same file in another case");
  eq(owning("minesweeper.bin")?.key, "x/mine#hb", "either direction");
  // BOTH DIRECTIONS. Folding must not start owning files that are not the title's: an owned
  // file becomes removable when the title is deselected, and on Flash the FrogFS is rebuilt
  // from the selection, so a wrong match here DELETES someone's homebrew.
  eq(owning("Minesweeper2.bin"), undefined, "a different name is still not this title's");
  eq(owning("Mines.bin"), undefined, "nor a shorter one");
});

await check("owning() folds the data directory too", async () => {
  const titles = [
    { key: "a", deviceFiles: [], dataDir: "openlara" },
    { key: "b", deviceFiles: [], dataDir: undefined },
  ];
  const owning = (name) => owningTitle(titles, name);
  eq(owning("OPENLARA/CUT1.PKD")?.key, "a", "the card cannot tell the directory's case apart either");
  eq(owning("openlara/cut1.pkd")?.key, "a", "either direction, as with the declared name");
  // Both directions again: a directory nobody declared belongs to nobody, and a title with no
  // dataDir must not be dragged in by one.
  eq(owning("something/else.bin"), undefined, "an unrelated directory belongs to nobody");
  eq(owning("openlara.bin"), undefined, "and a file merely NAMED like the directory is not its data");
});

// --- One title, one row: a shadowed legacy homebrew copy is not listed --------------------
// The owner: "I agree present with diff bytes = don't touch it (but also DON'T show them in
// Library at all)". Implemented as a general rule -- the manifest's directory wins whenever both
// hold the same relative path -- so the conflict case and the interrupted-migration case are one
// behaviour rather than two.

await check("a legacy homebrew copy is dropped when the manifest's directory holds the name", async () => {
  forgetInstallPaths();
  rememberInstallPaths({ homebrew: "/homebrews", roms: "/roms" });
  // Scan-key space: romScan strips ONE leading `roms/`, so the legacy directory arrives as
  // `homebrew/...` and the manifest's as `homebrews/...`.
  const keys = ["homebrew/celeste.bin", "homebrews/celeste.bin", "homebrew/lonely.bin", "nes/mario.nes"];
  const shadowed = shadowedLegacyHomebrewKeys(keys);
  eq([...shadowed].sort().join(","), "homebrew/celeste.bin", "only the shadowed legacy copy");

  // The three facts together. Asserting only the first would pass on an implementation that
  // dropped the whole legacy directory, which would hide `lonely.bin` from the user entirely.
  eq(shadowed.has("homebrew/celeste.bin"), true, "the legacy copy of a name the modern dir holds is dropped");
  eq(shadowed.has("homebrews/celeste.bin"), false,
     "THE MODERN FILE IS KEPT: it is the one that wins");
  eq(shadowed.has("homebrew/lonely.bin"), false,
     "A LEGACY FILE WITH NO COUNTERPART IS STILL LISTED -- dropping it would hide a title that " +
     "exists nowhere else, which is the opposite of the bug being fixed");
  eq(shadowed.has("nes/mario.nes"), false,
     "and nothing outside the homebrew directories is touched");
  forgetInstallPaths();
});

await check("nothing is shadowed when the manifest declares the legacy directory", async () => {
  forgetInstallPaths();
  // Both directories resolve to the same place, so a key would shadow ITSELF and every homebrew
  // file on the card would vanish. The early return is what stops that.
  const keys = ["homebrew/celeste.bin", "homebrew/lonely.bin"];
  eq(shadowedLegacyHomebrewKeys(keys).size, 0, "one directory cannot shadow itself");
  forgetInstallPaths();
});

await check("a shadowed key never removes a NAME from the listing", async () => {
  forgetInstallPaths();
  rememberInstallPaths({ homebrew: "/homebrews", roms: "/roms" });
  const keys = ["homebrew/celeste.bin", "homebrews/celeste.bin"];
  const shadowed = shadowedLegacyHomebrewKeys(keys);
  const surviving = keys.filter((k) => !shadowed.has(k)).map((k) => classifySdScanKey(k)?.name);
  // This is what makes the change invisible to every downstream consumer: they all match on
  // `name`, and the name is still there. A consumer could only notice by counting duplicates.
  eq(surviving.includes("celeste.bin"), true, `the name survives: got ${JSON.stringify(surviving)}`);
  eq(surviving.length, 1, "exactly once, which is the whole point");
  forgetInstallPaths();
});

// --- Report -------------------------------------------------------------------------------
if (failures.length) {
  console.error(`devicepaths: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`devicepaths: ${passed} checks passed`);
