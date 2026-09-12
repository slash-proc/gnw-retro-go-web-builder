#!/usr/bin/env node
/**
 * A BIOS is brought in by a core that needs it, and by nothing else.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/biosscope.mjs'
 *
 * THE REPORT. The owner's `[summary] net change` breakdown, with nothing selected:
 *
 *     {category:"bios", beforeBytes:576, afterBytes:19521849, beforeFiles:1, afterFiles:42}
 *     inputs: { installAllCores:true, combinedRoms:196, selectedRoms:0 }
 *
 * 42 files, 19,521,849 bytes. His `bios/` folder is a general RetroArch-style collection --
 * PlayStation, PS2, Saturn, DS, Lynx, PC-FX, a `.7z` archive, a `README.md` -- and `Used for:
 * BIOS` placed all of it under `bios/`, from where all of it installed. In his words: "it
 * shouldn't just pull in all BIOS, that's silly. BIOS should only be brought in by a Core
 * needed one."
 *
 * TWO DEFECTS, BOTH AT THE INSTALL STAGE, both exercised here through the real store:
 *
 *   1. `biosOmittedFilenames` asked which systems have games using `romSelection.games` -- the
 *      whole library, folder UNION device. 196 ROMs made every console look present, so every
 *      declared slot looked wanted even with nothing selected. It now reads `installingGames`,
 *      the games this install actually writes.
 *   2. The policy was an omission set, so a file matching no declared slot was never dropped at
 *      all. `biosAllowedFilenames` is the outer bound: nothing an active source has not
 *      declared reaches the device, whatever else is true.
 *
 * DISCOVERY IS DELIBERATELY UNTOUCHED. `biosState.all` still resolves every slot against every
 * file the folder holds, and `games` (the whole library) still drives it -- knowing you have
 * `syscard2.pce` and that nothing wants it is useful; shipping it is not. This suite asserts
 * that separation directly, so narrowing discovery to match the install would fail it.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
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

const root = mkdtempSync(join(tmpdir(), "gnw-biosscope-"));
symlinkSync(join(here, "../node_modules"), join(root, "node_modules"));
const esbuild = await import("esbuild");
const { gnwResolveFor } = await import("./gnwResolve.mjs");
const gnwResolve = gnwResolveFor(import.meta.url);

/** The owner's folder, as the net-change log named it. `MSX.rom` and `disksys.rom` are the only
 *  two files in it any core on this device declares. */
const RETROARCH_BIOS = [
  "bios/111_Bios_System.txt", "bios/BS-X.bin", "bios/PSXONPSP660.bin", "bios/STBIOS.bin",
  "bios/Sony - PlayStation 2 (PCSX2).7z", "bios/areplay.bin", "bios/bios.gg", "bios/bios.sms",
  "bios/bios7.bin", "bios/bios9.bin", "bios/bios_CD_E.bin", "bios/bios_CD_J.bin",
  "bios/dsi_firmware.bin", "bios/lynxboot.img", "bios/msxromdb.xml", "bios/pcfx.rom",
  "bios/README.md", "bios/saturn_bios.bin", "bios/scph101.bin", "bios/scph5501.bin",
  "bios/syscard1.pce", "bios/syscard2.pce",
  "bios/MSX.rom", "bios/nes/disksys.rom",
];
const DECLARED = ["bios/MSX.rom", "bios/nes/disksys.rom"];

let seq = 0;
/**
 * Build and import `biosState` for one case. `games` is the whole library (drives discovery),
 * `selected` the subset this install writes (drives policy) -- separate inputs on purpose, so a
 * test can hold one still and move the other.
 */
async function stateWith({ games = [], selected = [], medium = "flash" }) {
  const dir = join(root, `b${seq++}`);
  const folder = `new Map([${RETROARCH_BIOS.map((k) => `[${JSON.stringify(k)}, new Uint8Array(4)]`).join(",")}])`;
  const fakes = {
    "device.svelte.js": `export const device = { targetMedia: ${JSON.stringify(medium)}, sdHandle: null, installedFrogfs: null, installedGames: [] };`,
    "library.svelte.js": `export const library = { scan: { userRoms: ${folder} }, markDirty(){} };`,
    "romSelection.svelte.js":
      `const games = ${JSON.stringify(games)};\n`
      + `export const romSelection = { games, selectedKeys: new Set(${JSON.stringify(selected)}) };`,
    "store.svelte.js": "export const sources = { rows: [] };",
    "sdBios.js": "export async function scanSdBios(){ return []; }",
    "debug.js": "export function dbg(){}",
  };
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/biosState.svelte.ts")],
    outdir: dir,
    bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
    define: { $state: "__rune", $derived: "__derived" },
    // `candidates` is declared above `userAdded` and eager stubs evaluate fields in order, so
    // that one throws here. It is not what this suite is about -- `test/biosfolder.mjs` walks
    // the discovery chain -- and swallowing it keeps the fields that ARE the subject real.
    banner: { js: "const __rune=(v)=>v; const __derived=(v)=>v; __derived.by=(f)=>{try{return f();}catch{return [];}};" },
    plugins: [
      gnwResolve,
      {
        name: "biosscope-fakes",
        setup(build) {
          build.onResolve(
            { filter: /(device\.svelte|library\.svelte|romSelection\.svelte|store\.svelte|sdBios|debug)\.js$/ },
            (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "bs" }),
          );
          build.onLoad({ filter: /.*/, namespace: "bs" }, (a) => ({ contents: fakes[a.path], loader: "js" }));
        },
      },
    ],
  });
  return import(pathToFileURL(join(dir, "biosState.svelte.js")).href);
}

const bios = await (async () => {
  const dir = join(root, "bios");
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/bios.ts")],
    outdir: dir, bundle: true, format: "esm", platform: "neutral", target: "es2022",
    logLevel: "warning", plugins: [gnwResolve],
  });
  return import(pathToFileURL(join(dir, "bios.js")).href);
})();

/** The two slots the fleet's cores declare, in `BiosStatus` shape (only the policy fields are
 *  read). `conditional-idle` vs `-hit` is `disksys.rom`'s own rule: cartridges do not want it. */
const slots = (disksys) => [
  { repo: "o/msx", systemId: "msx", biosDir: "msx", id: "msx-bios", filenames: ["MSX.rom"], need: "required" },
  { repo: "o/nes", systemId: "nes", biosDir: "nes", id: "disksys", filenames: ["disksys.rom"], need: disksys },
];

/**
 * What an install writes out of the owner's folder.
 *
 * The store supplies `installingGames` and `medium` -- the two things this change moved -- and
 * the policy functions are then called exactly as `filterInstall` calls them. The runes are
 * stubbed as identity functions, so a `$derived` recomputing after `all` lands is not
 * observable in node; the wiring check at the bottom holds that last hop.
 */
const installed = async (opts, disksys = "conditional-hit") => {
  const { biosState } = await stateWith(opts);
  const all = slots(disksys);
  const omit = bios.biosOmittedFilenames(all, biosState.installingGames, biosState.medium);
  const allow = bios.biosAllowedFilenames(all);
  const folder = new Map(RETROARCH_BIOS.map((k) => [k, new Uint8Array(4)]));
  return [...bios.applyBiosPolicy(folder, omit, allow).keys()];
};

// --- The owner's case -------------------------------------------------------------------------

await check("a whole library, nothing selected: no core is installing, so no BIOS is", async () => {
  const keys = await installed({
    games: [{ key: "msx/aleste.rom", system: "msx", name: "aleste.rom" },
            { key: "nes/zelda.fds", system: "nes", name: "zelda.fds" }],
    selected: [],
  });
  eq(keys, [], "42 files and 19.5 MB for an install writing no games");
});

await check("a core that is installing brings its own BIOS, and only its own", async () => {
  const keys = await installed({
    games: [{ key: "msx/aleste.rom", system: "msx", name: "aleste.rom" },
            { key: "nes/zelda.fds", system: "nes", name: "zelda.fds" }],
    selected: ["msx/aleste.rom"],
  });
  eq(keys, ["bios/MSX.rom"], "the MSX core's file, nothing else");
});

await check("a file no source declares is never installed, whatever is selected", async () => {
  const keys = await installed({
    games: [{ key: "msx/aleste.rom", system: "msx", name: "aleste.rom" }],
    selected: ["msx/aleste.rom"],
  });
  for (const k of RETROARCH_BIOS) {
    if (DECLARED.includes(k)) continue;
    ok(!keys.includes(k), `${k} matches no declared slot and must not reach the device`);
  }
});

await check("SD still writes every declared slot, and still refuses the undeclared ones", async () => {
  const keys = await installed({ games: [], selected: [], medium: "sd" });
  eq(keys.slice().sort(), DECLARED.slice().sort(), "a card is open, so every declared slot ships");
  ok(!keys.includes("bios/scph5501.bin"), "a PlayStation BIOS is no more usable on a card");
});

await check("a conditional-idle slot stays out even when its console is installing", async () => {
  const keys = await installed({
    games: [{ key: "nes/mario.nes", system: "nes", name: "mario.nes" }],
    selected: ["nes/mario.nes"],
  }, "conditional-idle");
  eq(keys, [], "disksys.rom is dead weight for a folder of cartridges");
});

// --- Discovery and policy read DIFFERENT sets, and that is the whole fix -----------------------

await check("`games` is the library; `installingGames` is what the install writes", async () => {
  const { biosState } = await stateWith({
    games: [{ key: "msx/aleste.rom", system: "msx", name: "aleste.rom" },
            { key: "nes/zelda.fds", system: "nes", name: "zelda.fds" }],
    selected: ["nes/zelda.fds"],
  });
  eq(biosState.games.map((g) => g.system).sort(), ["msx", "nes"], "discovery still sees both");
  eq(biosState.installingGames.map((g) => g.system), ["nes"], "policy sees only the selection");
});

await check("a game preserved on the device keeps its BIOS", async () => {
  // `romSelection.selectedKeys` counts an installed game as selected unless the user turns it
  // off, so this is an ordinary "open the Library, change nothing, install".
  const keys = await installed({
    games: [{ key: "msx/aleste.rom", system: "msx", name: "aleste.rom" }],
    selected: ["msx/aleste.rom"],
  });
  ok(keys.includes("bios/MSX.rom"), "still installed for a console being preserved");
});

// --- The firmware's own files ------------------------------------------------------------------
//
// `bios/logo.bin` is Retro-Go's boot logo. The firmware ships it in the bundle and opens it by
// that exact name (`rg_logos.c:49`); `planFlashImage` seeds the tree from `defaultContent` and
// merges `userRoms` afterwards, so a same-named file in a user's `bios/` collection lands on the
// same destination key and overwrites it. The owner: "bios/logo.bin isn't changeable for now.
// That's provided by the firmware and we don't mess with it and we certainly don't override it
// with something from a bios dir."
//
// The allow-list already refuses it, but only because no manifest happens to declare a `logo.bin`
// slot. That is an accident, not a rule, and the second check below is the one that matters: it
// declares the slot and asserts the file is STILL refused.

await check("the firmware's own logo.bin is never installed from a user's folder", async () => {
  const folder = new Map([
    ["bios/logo.bin", new Uint8Array(4)],
    ["bios/MSX.rom", new Uint8Array(4)],
  ]);
  const all = slots("conditional-hit");
  const omit = new Set();
  const allow = bios.biosAllowedFilenames(all);
  const keys = [...bios.applyBiosPolicy(folder, omit, allow).keys()];
  ok(!keys.includes("bios/logo.bin"), "a folder logo.bin reached the device and overwrote the firmware's");
});

await check("a source declaring logo.bin cannot reopen the override", async () => {
  // The hostile case the allow-list alone does not cover: a publisher names `logo.bin` as a BIOS
  // slot, so it is declared, wanted by an installing core, and in `allow`. It must still be
  // refused -- the firmware owns that name whatever anybody publishes.
  const declaring = [
    { repo: "o/rg", systemId: "msx", biosDir: "", id: "logo", filenames: ["logo.bin"], need: "required" },
  ];
  const omit = bios.biosOmittedFilenames(declaring, [{ key: "msx/a.rom", system: "msx", name: "a.rom" }], "flash");
  const allow = bios.biosAllowedFilenames(declaring);
  ok(allow.has("logo.bin"), "the fixture must actually declare it, or this proves nothing");
  ok(!omit.has("logo.bin"), "the fixture must actually want it, or this proves nothing");
  const folder = new Map([["bios/logo.bin", new Uint8Array(4)]]);
  const keys = [...bios.applyBiosPolicy(folder, omit, allow).keys()];
  eq(keys, [], "a declared logo.bin reopened the override the owner ruled out");
});

await check("the refusal survives the omission-only two-argument shape", async () => {
  // `applyBiosPolicy` early-returns when there is nothing to omit and no allow-list. The
  // firmware-owned refusal must not be skipped by that shortcut.
  const folder = new Map([["bios/logo.bin", new Uint8Array(4)]]);
  const keys = [...bios.applyBiosPolicy(folder, new Set()).keys()];
  eq(keys, [], "the early return let a folder logo.bin through");
});

await check("logo.bin is still discovered and listed, because visible is not installed", async () => {
  // Discovery is untouched everywhere else in this module and is untouched here. The device's own
  // file stays in the candidate pool: it can never fill a slot (`matchCandidates` matches declared
  // filenames only), so listing it misleads nobody, and seeing it is how the owner confirmed the
  // firmware furniture was present at all.
  const all = slots("conditional-hit");
  const pool = [{ where: "device", path: "bios/logo.bin", size: 576 }];
  for (const need of all) {
    eq(bios.matchCandidates(need, pool), [], `logo.bin filled the ${need.id} slot`);
  }
});

// --- The one hop node cannot execute ----------------------------------------------------------

await check("filterInstall is wired to both halves, and to the selection", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(here, "../src/lib/sources/biosState.svelte.ts"), "utf8");
  ok(/applyBiosPolicy\(userRoms, this\.omittedFilenames, this\.allowedFilenames\)/.test(src),
    "filterInstall passes the omission set AND the allow-list");
  ok(/biosOmittedFilenames\(this\.all, this\.installingGames, this\.medium\)/.test(src),
    "the omission set is computed from the games being installed, not the whole library");
  ok(/biosAllowedFilenames\(this\.all\)/.test(src), "the allow-list is every declared slot");
  ok(/installingGames[\s\S]{0,400}romSelection\.selectedKeys\.has/.test(src),
    "installingGames is the selection");
});

if (failures.length) {
  for (const f of failures) console.error("FAIL " + f);
  process.exit(1);
}
if (passed === 0) { console.error("FAIL no checks ran"); process.exit(1); }
console.log(`a BIOS rides in behind its core: ${passed} checks passed`);
