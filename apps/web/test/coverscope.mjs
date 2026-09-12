#!/usr/bin/env node
/**
 * A cover follows its title. It is not a BIOS.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/coverscope.mjs'
 *
 * THE REPORT. On a fresh install the owner's Library projected a net change with nothing
 * selected. The `[summary] net change` breakdown he asked for named two contributors, and this
 * is the second of them:
 *
 *     {category:"covers", beforeBytes:0, afterBytes:774265, beforeFiles:0, afterFiles:154}
 *     inputs: { installAllCores:true, combinedRoms:196, selectedRoms:0 }
 *
 * 154 cover images, 774,265 bytes, for an image containing no games. `plannedInstallNames`
 * admitted `cat === "cover"` unconditionally, beside `bios` and `cheat`, and the comment above
 * it only ever justified the BIOS half. Art for a game that is not in the image has nothing to
 * be the art of.
 *
 * WHY `selectedKeys` IS THE RIGHT SET, and not "games being added". A game already on the
 * device counts as selected unless the user turns it off, so a console whose games are being
 * PRESERVED keeps its covers. The owner's case reported `selectedRoms: 0` on a device with
 * nothing installed, which is why the honest answer there is zero covers and not 154.
 *
 * The store is executed, not grepped: runes are stubbed as identity functions and the fake
 * modules below are populated BEFORE the class is constructed, so `games`, `selectedKeys` and
 * `plannedInstallNames` are the shipped code running on a real fixture.
 */
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
};
const ok = (v, m) => { if (!v) throw new Error(m); };
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const root = mkdtempSync(join(tmpdir(), "gnw-coverscope-"));
symlinkSync(join(here, "../node_modules"), join(root, "node_modules"));
const esbuild = await import("esbuild");
const { gnwResolveFor } = await import("./gnwResolve.mjs");
const gnwResolve = gnwResolveFor(import.meta.url);

/** The folder the fixture pretends the user picked. */
const FOLDER = [
  "nes/Mario.nes",
  "nes/Zelda.nes",
  // Not a real thing a user's folder holds -- it is here precisely to prove that if one DID,
  // it would not ride in unselected. See the fonts check at the bottom.
  "fonts/bigfont.bin",
  "covers/nes/Mario.png",
  "covers/nes/Zelda.png",
  "covers/homebrew/Celeste.img",
  "bios/nes/disksys.rom",
  "bios/scph5501.bin",
];

const HOMEBREW = [{ key: "o/celeste", displayName: "Celeste", deviceFiles: ["Celeste.bin"] }];

let seq = 0;
/** Build and import `romSelection` with the device and homebrew selection this case needs. */
async function selectionWith({ installedGames = [], homebrewSelected = false }) {
  const dir = join(root, `b${seq++}`);
  const folder = `new Map([${FOLDER.map((k) => `[${JSON.stringify(k)}, new Uint8Array(4)]`).join(",")}])`;
  const fakes = {
    "library.svelte.js": `export const library = { scan: { userRoms: ${folder} }, markDirty(){} };`,
    "device.svelte.js": `export const device = { installedGames: ${JSON.stringify(installedGames)}, targetMedia: 'flash', installedFrogfs: null };`,
    "romScan.js": "export function nativeFolderPickerSupported(){return true;}\nexport function shouldSkipRomsFile(){return false;}",
    "consoles.js": "export function consoleLabel(s){return s;}",
    "homebrewTitles.svelte.js":
      `export const homebrew = { titles: ${JSON.stringify(HOMEBREW)}, find(k){return this.titles.find(t=>t.key===k);},` +
      ` isComplete(){return ${homebrewSelected ? "true" : "false"};}, owning(){return undefined;} };`,
    "libraryScan.js": "export function basePath(p){return p;}",
    "coreRegistry.svelte.js":
      "export const coreRegistry = { current: { systems: [], hasCoreSources: false, folders: new Map(), byFolder: new Map() },"
      + " get authoritative(){return false;}, groups: [], declaredFolders: new Set() };",
    "prepareState.svelte.js":
      "export const prepareState = { assets: new Map(), preparedBytesFor(){return undefined;},"
      + " producedKeys(){return [];}, assetSourceOf(){return undefined;}, preparedSize(){return undefined;} };",
    "discoveryWire.svelte.js": "export const variantHints = { get(){return undefined;} };",
  };
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/romSelection.svelte.ts")],
    outdir: dir,
    bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
    define: { $state: "__rune", $derived: "__derived" },
    banner: { js: "const __rune=(v)=>v; const __derived=(v)=>v; __derived.by=(f)=>f();" },
    plugins: [
      gnwResolve,
      {
        name: "coverscope-fakes",
        setup(build) {
          build.onResolve(
            { filter: /(library\.svelte|device\.svelte|romScan|consoles|homebrewTitles\.svelte|libraryScan|coreRegistry\.svelte|prepareState\.svelte|discoveryWire\.svelte)\.js$/ },
            (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "cs" }),
          );
          build.onLoad({ filter: /.*/, namespace: "cs" }, (a) => ({ contents: fakes[a.path], loader: "js" }));
        },
      },
    ],
  });
  return import(pathToFileURL(join(dir, "romSelection.svelte.js")).href);
}

// --- The owner's case ---------------------------------------------------------------------

await check("no game in the image means no cover in the image", async () => {
  const { romSelection } = await selectionWith({});
  const keys = [...romSelection.selectedFolderRoms().keys()].sort();
  eq(keys.filter((k) => k.startsWith("covers/")), [], "154 covers for nothing is the bug");
  ok(keys.includes("bios/scph5501.bin"), "BIOS assets still pass through here (policy is downstream)");
});

await check("a cover rides in with the game it depicts, and only that game", async () => {
  const { romSelection } = await selectionWith({
    installedGames: [{ system: "nes", name: "Mario.nes", size: 4 }],
  });
  const keys = [...romSelection.selectedFolderRoms().keys()].sort();
  ok(keys.includes("nes/Mario.nes"), "the preserved game");
  ok(keys.includes("covers/nes/Mario.png"), "its cover");
  ok(!keys.includes("covers/nes/Zelda.png"), "the unselected game's cover stays behind");
});

await check("a homebrew cover follows its title's selection", async () => {
  const off = await selectionWith({});
  ok(![...off.romSelection.selectedFolderRoms().keys()].includes("covers/homebrew/Celeste.img"),
    "not selected, not shipped");
  const on = await selectionWith({
    installedGames: [{ system: "homebrew", name: "Celeste.bin", size: 4 }],
    homebrewSelected: true,
  });
  ok([...on.romSelection.selectedFolderRoms().keys()].includes("covers/homebrew/Celeste.img"),
    "selected, shipped");
});

// --- The pairing rule itself ----------------------------------------------------------------

await check("coverOwnerOf pairs art with its game across extensions and case", async () => {
  const { coverOwnerOf } = await selectionWith({});
  eq(coverOwnerOf("covers/nes/Mario.png"), "nes/mario", "cover");
  eq(coverOwnerOf("nes/MARIO.nes"), "nes/mario", "game, same owner");
  eq(coverOwnerOf("covers/nes/Mario.img"), "nes/mario", "device-ready .img, same owner");
  eq(coverOwnerOf("covers/homebrew/Celeste.img"), "homebrew/celeste", "homebrew");
  ok(coverOwnerOf("covers/nes/Mario.png") !== coverOwnerOf("covers/gb/Mario.png"),
    "the console is part of the identity");
});

// --- Fonts are the firmware's, not the folder's ---------------------------------------------
//
// The same net-change breakdown that caught the covers named a THIRD category arriving with
// nothing selected:
//
//     {category:"fonts", beforeBytes:0, afterBytes:847872, beforeFiles:0, afterFiles:25}
//
// That one is NOT the same bug, and gating it would be wrong. Fonts reach the image only from
// `defaultContent`, the firmware bundle: `planFlashImage` seeds the tree from it unconditionally
// (upstream's gen_frogfs_image.py DEFAULT_DIRS = bios/covers/fonts/roms), and every install
// carries the firmware's fonts because the firmware cannot draw without them. 847 KB against an
// empty device is the honest projection of installing a firmware that has fonts.
//
// The folder side cannot contribute one at all: `ContentCategory` has no "font" member, so a
// `fonts/` key classifies as "game" and needs `selectedKeys` like any other game. Both halves of
// that are pinned here, so a future "fonts/" case added to classifyContentPath cannot quietly
// open the unconditional door that bios, cheat and cover sit behind.

await check("a folder cannot ship a font unselected, because fonts are the firmware's", async () => {
  const { romSelection } = await selectionWith({});
  const keys = [...romSelection.selectedFolderRoms().keys()];
  ok(!keys.includes("fonts/bigfont.bin"),
    "a fonts/ key rode in unselected, which is the unconditional path bios and cheat sit on");
});

await check("a fonts/ key is not its own admission category", async () => {
  const { classifyContentPath } = await selectionWith({});
  eq(classifyContentPath("fonts/bigfont.bin").category, "game",
    "fonts/ grew its own category, so it no longer follows the selection");
});

// --- A cover is a SIBLING of the ROW'S PATH, and a doubled ROM has an id on its key ----------
//
// THE REPORT. "the first doom entry keeps removing the cover. I've added a PNG manually and I've
// used the cover art screenscraper thing. They work for the session and then disappear after."
//
// `sources/libraryScan.ts` states the rule this broke, and states it as an absolute: `basePath()`
// is "the ONLY thing that may be shown to the user or used to derive a sibling path (a cover, a
// cheat file) or a destination on the card". A second folder holding a different file under the
// same name keeps it under `<path>\0<id>` (DUP_MARK is NUL, the one byte no filename can hold),
// and the Library row carries that RAW key.
//
// `getCoverUrl()` in RomManagementTab strips it -- the comment there says why, and both variants
// correctly show the one cover that path has. `GameDetailsPanel.svelte` did not: it derived the
// cover's path, the scraper's filename and the local-cover probe straight off the raw key. So a
// cover for a doubled ROM was written to a key with a NUL in it, which the reader can never
// look up. It displayed for the session, because the map it went into was the one being read,
// and it was gone on reload.
//
// Held as a SOURCE-LEVEL wiring check, the same shape shippedgames.mjs uses for its own reactive
// half: the derivations live inline in a .svelte component that node cannot evaluate. The rule
// itself is executed below against the real `basePath`.

/** The REAL libraryScan, not this suite's fake: these checks are about `basePath` itself. */
let realLibraryScanMod = null;
async function realLibraryScan() {
  if (realLibraryScanMod) return realLibraryScanMod;
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/libraryScan.ts")],
    outfile: join(root, "libraryScan.real.js"),
    bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
    plugins: [gnwResolve],
  });
  realLibraryScanMod = await import(pathToFileURL(join(root, "libraryScan.real.js")).href);
  return realLibraryScanMod;
}

const panelSrc = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");

await check("the panel derives a cover path from the ROW PATH, never the raw key", async () => {
  ok(/import \{ basePath \}/.test(panelSrc),
    "GameDetailsPanel does not import basePath, so every sibling path it derives keeps the duplicate id");
  ok(!/const parts = gameKey\.split\("\/"\)/.test(panelSrc),
    "a sibling path is still split off the raw gameKey, which carries a duplicate id for a doubled ROM");
  ok(!/homebrew\.find\(gameKey\)/.test(panelSrc),
    "a title lookup still uses the raw key rather than the row path");
});

await check("basePath is total, so stripping is safe on every key", async () => {
  const { basePath } = await realLibraryScan();
  eq(basePath("doom/doom.wad"), "doom/doom.wad", "an ordinary key is returned unchanged");
  eq(basePath("doom/doom.wad\u0000abc123"), "doom/doom.wad", "a duplicate key loses only its id");
  // The read side and the write side must land on the same cover for both variants of a path.
  const stem = (k) => basePath(k).replace(/\.[^/.]+$/, "");
  eq(stem("doom/doom.wad\u0000abc123"), stem("doom/doom.wad"),
    "the two variants of one path derive different covers, so one of them can never be read back");
});

if (failures.length) {
  for (const f of failures) console.error("FAIL " + f);
  process.exit(1);
}
if (passed === 0) {
  console.error("FAIL no checks ran");
  process.exit(1);
}
console.log(`covers follow their titles: ${passed} checks passed`);
