#!/usr/bin/env node
/**
 * WHICH CORES AN INSTALL WRITES — `src/lib/sources/coreGate.ts`, and the packer split it feeds.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/coregate.mjs'
 *
 * The owner's rule, verbatim:
 *
 *   "On flash: when a ROM is selected, its core must be installed too. If all ROMs of a core
 *    have been selected for removal, remove the core as well."
 *   "On SD, we assume the user might install a ROM by hand at a given moment. On Flash that
 *    just isn't the case."
 *
 * Plain node, no framework (repo convention). Nothing here touches a device.
 *
 * TWO HALVES, TWO SEAMS. The gate itself is pure and is driven directly with plain objects.
 * The FrogFS/LittleFS split it feeds is NOT re-implemented here: the real `planFlashImage`
 * from the built `@gnw/fs-builders` runs over the gate's output, so "gba.bin goes to LittleFS
 * and gba.xip to FrogFS" is asserted against the code that actually places them rather than
 * against a second copy of the rule. Asserting my own restatement of the split is the shape
 * this repo has been bitten by repeatedly.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

let failed = 0;
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sorted = (xs) => [...xs].sort();
const deepEq = (a, b, msg) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}:\n  got  ${x}\n  want ${y}`);
};

// --- Compile the module under test ---------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const out = mkdtempSync(join(tmpdir(), "gnw-coregate-"));
symlinkSync(join(repoRoot, "node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/coreGate.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const { unusedCores, unusedCoreKeys, applyCorePolicy, strandedCoreKeys } = await import(
  pathToFileURL(join(out, "coreGate.js")).href
);

// The REAL packer, for the split assertion. `gnwImport` and not a bare `import("@gnw/...")`:
// a worktree must test its OWN packages, not the main clone's dist (CLAUDE.md).
import { gnwImport } from "./gnwResolve.mjs";
const { planFlashImage } = await gnwImport(import.meta.url, "@gnw/fs-builders");

// --- The fixture: two cores, one of them split, one of them shared across four systems ------
//
// Shapes taken from real manifests. gpSP ships `gba.bin` (RAM) and `gba.xip` (executed in
// place); SMSPlusGX declares four systems that all resolve to one binary, which is upstream's
// `sd_cores_pack.py` mapping (`gg`, `sms`, `sg`, `col` -> sms.bin). tgb-dual is the same shape
// with two systems, and is the one the owner named.
const GBA = "slash-proc/gba-retro-go-sd#gba";
const TGB = "slash-proc/tgb-dual-retro-go-sd#tgb";
const SMS = "slash-proc/SMSPlusGX-retro-go-sd#sms";
const DOOM = "slash-proc/doom-retro-go-sd#doom";

const SYSTEMS = {
  [GBA]: ["gba"],
  [TGB]: ["gb", "gbc"],
  [SMS]: ["gg", "sms", "sg", "col"],
  [DOOM]: ["doom"],
};
const PRODUCED = {
  [GBA]: ["cores/gba.bin", "cores/gba.xip"],
  [TGB]: ["cores/tgb.bin"],
  [SMS]: ["cores/sms.bin"],
  // A core WITH a converter: its own binary plus the game bytes its tool produced. The game
  // bytes are `converted` and are governed by the row selection in selectedAssets.ts, so this
  // gate must leave them alone.
  [DOOM]: ["cores/doom.bin", "doom/doom1.whd"],
};
const SOURCE = {
  "cores/gba.bin": "artifact",
  "cores/gba.xip": "artifact",
  "cores/tgb.bin": "artifact",
  "cores/sms.bin": "artifact",
  "cores/doom.bin": "artifact",
  "doom/doom1.whd": "converted",
};
const TITLES = [
  { key: GBA, isCore: true },
  { key: TGB, isCore: true },
  { key: SMS, isCore: true },
  { key: DOOM, isCore: true },
  // Homebrew is never gated here: it is content in its own right.
  { key: "slash-proc/zelda3-retro-go-sd#zelda3", isCore: false },
];

function gate(selectedSystems, medium = "flash") {
  return {
    titles: TITLES,
    systemsOf: (k) => SYSTEMS[k] ?? [],
    selectedSystems: new Set(selectedSystems),
    producedBy: (k) => PRODUCED[k] ?? [],
    sourceOf: (k) => SOURCE[k],
    medium,
  };
}

// --- 1. A selected ROM keeps its core; everything else is dropped ---------------------------
await check("a selected GBA ROM keeps the GBA core, and only that core", () => {
  const unused = unusedCores(gate(["gba"]));
  deepEq(
    sorted(unused.map((c) => c.targetKey)),
    sorted([TGB, SMS, DOOM]),
    "cores with no selected ROM",
  );
  const dropped = unusedCoreKeys(gate(["gba"]));
  assert(!dropped.has("cores/gba.bin"), "gba.bin was dropped while a GBA ROM is selected");
  assert(!dropped.has("cores/gba.xip"), "gba.xip was dropped while a GBA ROM is selected");
});

// --- 2. A companion travels with its core ---------------------------------------------------
await check("a split core's two halves are kept and dropped together", () => {
  const kept = unusedCoreKeys(gate(["gba"]));
  const dropped = unusedCoreKeys(gate(["nes"]));
  for (const half of ["cores/gba.bin", "cores/gba.xip"]) {
    assert(!kept.has(half), `${half} was dropped while its core is wanted`);
    assert(dropped.has(half), `${half} survived while its core is unwanted: a half-core ships`);
  }
});

// --- 3. Deselecting the last ROM of a system marks its core for removal ----------------------
await check("deselecting the last ROM of a system marks that core for removal", () => {
  const before = unusedCores(gate(["gba", "nes"])).map((c) => c.targetKey);
  assert(!before.includes(GBA), "the GBA core was unwanted while a GBA ROM was still selected");
  const after = unusedCores(gate(["nes"])).map((c) => c.targetKey);
  assert(after.includes(GBA), "deselecting the last GBA ROM did not mark the GBA core unused");
});

// --- 3b. An UNTOUCHED selection is not a deselection ----------------------------------------
/**
 * The state that made an idle Library project `-0.18 MB net change`: a device holding
 * `cores/gba.xip` and no GBA ROM, opened and not touched. An empty `selectedSystems` read as
 * "every core was deselected", so the gate marked all four cores for removal.
 *
 * The pair below is the whole point. The SAME empty selection gates or does not gate purely on
 * whether the user acted, which is why `selectionUntouched` had to be a separate fact and not
 * something inferred from the set. Check 3 above still pins the deselection case.
 */
await check("an untouched empty selection gates nothing; an emptied one still gates", () => {
  const untouched = unusedCores({ ...gate([]), selectionUntouched: true });
  deepEq(sorted(untouched.map((c) => c.targetKey)), [], "an untouched Library marked cores unused");
  const dropped = unusedCoreKeys({ ...gate([]), selectionUntouched: true });
  for (const half of ["cores/gba.bin", "cores/gba.xip"]) {
    assert(!dropped.has(half), `${half} was dropped from an untouched Library`);
  }
  // The user emptied it himself: same empty set, and the owner's rule applies in full.
  const emptied = unusedCores({ ...gate([]), selectionUntouched: false });
  deepEq(
    sorted(emptied.map((c) => c.targetKey)),
    sorted([GBA, TGB, SMS, DOOM]),
    "deselecting every ROM no longer removes the cores",
  );
  assert(
    unusedCoreKeys({ ...gate([]), selectionUntouched: false }).has("cores/gba.xip"),
    "gba.xip survived a selection the user emptied himself",
  );
});

/**
 * The flag is OPTIONAL and absent means "touched", so a component that stops passing it loses
 * the protection above in silence and the idle Library starts projecting a net change again.
 * Pinned here rather than left to a reviewer, because the failure is invisible at every gate.
 */
await check("the component still tells the gate whether the selection was touched", () => {
  const src = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  const at = src.indexOf("unusedCores({");
  assert(at > 0, "RomManagementTab no longer calls unusedCores; this gate may be unwired");
  const body = src.slice(at, src.indexOf("}),", at));
  assert(
    body.includes("selectionUntouched: !romSelection.selectionTouched"),
    "the gate is no longer told whether the user touched the selection",
  );
});

// --- 4. A shared core survives while ANY of its systems has a ROM ----------------------------
await check("a shared core survives while any one of its systems still has a ROM", () => {
  for (const [name, sel] of [
    ["gb only", ["gb"]],
    ["gbc only", ["gbc"]],
    ["both", ["gb", "gbc"]],
  ]) {
    const unused = unusedCores(gate(sel)).map((c) => c.targetKey);
    assert(!unused.includes(TGB), `tgb-dual was dropped with ${name} selected`);
  }
  // Four systems, one binary: the same rule, one step wider.
  for (const sys of ["gg", "sms", "sg", "col"]) {
    const unused = unusedCores(gate([sys])).map((c) => c.targetKey);
    assert(!unused.includes(SMS), `the SMS core was dropped with ${sys} selected`);
  }
  const none = unusedCores(gate(["gba"])).map((c) => c.targetKey);
  assert(none.includes(TGB), "tgb-dual survived with neither gb nor gbc selected");
  assert(none.includes(SMS), "the SMS core survived with none of its four systems selected");
});

// --- 5. Converted game bytes are not this gate's business -----------------------------------
await check("a core's CONVERTED output is never dropped by this gate", () => {
  const dropped = unusedCoreKeys(gate(["gba"]));
  assert(dropped.has("cores/doom.bin"), "the unused Doom core's own binary was kept");
  assert(
    !dropped.has("doom/doom1.whd"),
    "a converted game was dropped here; the row selection owns that decision (selectedAssets.ts)",
  );
});

// --- 6. SD installs every core, unconditionally ---------------------------------------------
await check("SD drops nothing, whatever is selected", () => {
  deepEq(unusedCores(gate([], "sd")), [], "SD with nothing selected");
  deepEq(unusedCores(gate(["gba"], "sd")), [], "SD with one system selected");
  assert(unusedCoreKeys(gate([], "sd")).size === 0, "SD omitted a core key");
  // ANTI-VACUITY: the very same input on Flash must drop plenty, or "SD drops nothing" is a
  // statement about the fixture rather than about the medium.
  assert(
    unusedCoreKeys(gate([], "flash")).size > 0,
    "Flash dropped nothing either, so this check proves nothing about the medium",
  );
});

// --- 7. applyCorePolicy removes exactly those keys ------------------------------------------
await check("applyCorePolicy strips the omitted keys and nothing else", () => {
  const assets = new Map([
    ["cores/gba.bin", new Uint8Array([1])],
    ["cores/gba.xip", new Uint8Array([2])],
    ["cores/doom.bin", new Uint8Array([3])],
    ["doom/doom1.whd", new Uint8Array([4])],
  ]);
  const kept = applyCorePolicy(assets, unusedCoreKeys(gate(["gba"])));
  deepEq(sorted(kept.keys()), sorted(["cores/gba.bin", "cores/gba.xip", "doom/doom1.whd"]), "kept keys");
  assert(assets.size === 4, "applyCorePolicy mutated its input");
});

// --- 8. What a removal can and cannot actually take off the device ---------------------------
await check("only the mapped half of an unused core can leave the device", () => {
  const unused = unusedCores(gate(["nes"]));
  const mapped = new Set(["cores/gba.xip"]);
  const stranded = strandedCoreKeys(unused, mapped);
  assert(
    stranded.includes("cores/gba.bin"),
    "gba.bin was not reported as stranded: the LittleFS partition has no delete path",
  );
  assert(
    !stranded.includes("cores/gba.xip"),
    "gba.xip was reported as stranded, but FrogFS is rebuilt and it leaves by omission",
  );
});

// --- 9. The split itself, through the REAL packer -------------------------------------------
await check("the packer puts gba.bin in LittleFS and gba.xip in FrogFS", async () => {
  const bytes = (n) => new Uint8Array(n).fill(7);
  const userRoms = applyCorePolicy(
    new Map([
      ["cores/gba.bin", bytes(64)],
      ["cores/gba.xip", bytes(128)],
      ["gba/pokemon.gba", bytes(256)],
    ]),
    unusedCoreKeys(gate(["gba"])),
  );
  const plan = planFlashImage({
    defaultContent: new Map(),
    userRoms,
    lzmaRaw: () => {
      throw new Error("lzmaRaw was invoked; compress:false was not honoured");
    },
    compress: false,
    // `gba.xip` is mapped, so it belongs in FrogFS whatever its role directory says.
    mappedKeys: new Set(["cores/gba.xip"]),
  });
  const cores = plan.coreFiles.map((f) => f.path);
  const frog = plan.frogfsFiles.map((f) => f.path);
  assert(cores.includes("cores/gba.bin"), `gba.bin is not in LittleFS (cores: ${cores.join(", ")})`);
  assert(!frog.includes("cores/gba.bin"), "gba.bin is in FrogFS, where the firmware never opens it");
  assert(frog.includes("cores/gba.xip"), `gba.xip is not in FrogFS (frogfs: ${frog.join(", ")})`);
  assert(!cores.includes("cores/gba.xip"), "gba.xip is in LittleFS, which cannot give it an address");
  assert(
    plan.pendingLfsFiles.some((f) => f.path === "cores/gba.bin"),
    "gba.bin is not reported as a pending LittleFS write, so the install would drop it silently",
  );
});

// --- 10. A deselected core reaches the packer as nothing at all ------------------------------
await check("a core with no selected ROM never reaches the packer", async () => {
  const bytes = (n) => new Uint8Array(n).fill(7);
  const userRoms = applyCorePolicy(
    new Map([
      ["cores/gba.bin", bytes(64)],
      ["cores/gba.xip", bytes(128)],
      ["nes/mario.nes", bytes(256)],
    ]),
    unusedCoreKeys(gate(["nes"])),
  );
  const plan = planFlashImage({
    defaultContent: new Map(),
    userRoms,
    lzmaRaw: () => {
      throw new Error("lzmaRaw was invoked");
    },
    compress: false,
    mappedKeys: new Set(["cores/gba.xip"]),
  });
  const all = [...plan.coreFiles, ...plan.frogfsFiles].map((f) => f.path);
  for (const half of ["cores/gba.bin", "cores/gba.xip"]) {
    assert(!all.includes(half), `${half} was packed for an install with no GBA ROM`);
  }
  assert(all.some((p) => p.includes("mario")), "the NES ROM did not survive; the fixture is wrong");
});

// --- 11. WHY the removal half is only half -------------------------------------------------
/**
 * The owner asked for "remove the core as well", and this is the line that cannot be crossed
 * today: the vendored littlefs WASM exports no remove/unlink at all, so nothing in this repo
 * can take a file out of the device's LittleFS. `writeFilesToDeviceLfs` only writes, and it is
 * disabled on top of that.
 *
 * Pinned rather than described, so that the day someone rebuilds the WASM with `lfs_remove`
 * this check fails and points at the removal work instead of leaving it silently undone.
 */
await check("PINNED: the littlefs WASM exports no remove, so a core cannot be deleted", async () => {
  const { readFileSync } = await import("node:fs");
  const glue = readFileSync(
    join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.mjs"),
    "utf8",
  );
  const exported = [...new Set(glue.match(/_lfs_w_[a-z_]+/g) ?? [])].sort();
  assert(exported.length > 0, "found no _lfs_w_* exports at all; this check has stopped working");
  const removers = exported.filter((n) => /remove|unlink|delete/.test(n));
  assert(
    removers.length === 0,
    `the WASM now exports ${removers.join(", ")}: the core-removal half of the owner's rule ` +
      `is newly implementable, and coreGate's strandedCoreKeys comment is now wrong`,
  );
});

// --- 10. A CORE ALREADY ON THE DEVICE ---------------------------------------------------------
//
// The owner's standing `-0.18 MB` on an idle Library, and the last of the three bugs behind it.
// `planFlashImage` builds the FrogFS tree from `defaultContent` plus `userRoms` and NOTHING
// carries an on-device file forward, so a mapped core survives a rebuild only if its bytes are
// in hand. `prepareCoreArtifacts` has one caller, inside `runInstall`/`doSdSync`, so on a fresh
// page load nothing had fetched them and every preview silently dropped the core.
//
// `selectionUntouched` could not reach this: that rule stops the GATE removing a prepared core.
// Here there was nothing to remove. Measured against the real packer, not restated.

await check("a mapped core the device holds is dropped from a rebuild unless its bytes are held", async () => {
  const bytes = (n) => new Uint8Array(n).fill(3);
  const mappedKeys = new Set(["cores/gba.xip"]);
  const pack = (userRoms) =>
    planFlashImage({
      defaultContent: new Map([["fonts/cp1252_serif.bin", bytes(16)]]),
      userRoms,
      lzmaRaw: () => { throw new Error("compress:false was not honoured"); },
      compress: false,
      mappedKeys,
    });

  // The fresh-load state: nothing prepared, so the core is in no map at all.
  const without = pack(new Map());
  assert(
    !without.frogfsFiles.map((f) => f.path).includes("cores/gba.xip"),
    "the packer invented a core nobody supplied; this check no longer measures anything",
  );

  // The state the preview must reach before it builds.
  const with_ = pack(new Map([["cores/gba.xip", bytes(192592)]]));
  assert(
    with_.frogfsFiles.map((f) => f.path).includes("cores/gba.xip"),
    "a prepared mapped core did not reach the image, so fetching it would not help",
  );

  const size = (plan) => plan.frogfsFiles.reduce((a, f) => a + f.data.length, 0);
  assert(
    size(with_) - size(without) === 192592,
    `the bytes a rebuild drops are not the core's own: got ${size(with_) - size(without)}, want 192592`,
  );
});

// The reactive half cannot run in node (these suites stub the runes), so the wiring is held at
// source level -- the same shape the shipped-game fix needed. Each assertion is scoped to the
// function that must carry it: `prepareCoreArtifacts` existed in this file throughout the bug,
// in the wrong function, so "the call appears somewhere" would have passed the whole time.
const tabSrc = () =>
  readFileSync(join(repoRoot, "apps/web/src/lib/views/RomManagementTab.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const fnBody = (src, decl) => {
  const start = src.indexOf(decl);
  assert(start > 0, `${decl} is gone or renamed; this check no longer guards anything`);
  const next = src.indexOf("\n  async function", start + 10);
  const next2 = src.indexOf("\n  function", start + 10);
  const ends = [next, next2].filter((n) => n > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : src.length);
};

await check("THE REPORTED CASE: the preview restores the device's own cores before it builds", () => {
  const body = fnBody(tabSrc(), "async function buildPreview");
  assert(
    /prepareDeviceCores\(\)/.test(body),
    "buildPreview does not restore the device's cores, so a rebuild drops them and an idle " +
      "Library reports their size as a removal",
  );
  assert(
    body.indexOf("prepareDeviceCores()") < body.indexOf("buildFrogfsImage("),
    "the fetch must precede the build, or the image is packed from bytes that arrived too late",
  );
});

await check("the preview rebuilds when the device's file parse lands", () => {
  const src = tabSrc();
  const start = src.indexOf("const selSig = $derived([");
  assert(start > 0, "selSig is gone or renamed; this check no longer guards anything");
  const body = src.slice(start, src.indexOf("].sort().join", start));
  assert(
    /deviceCoreFiles\(\)/.test(body),
    "selSig carries nothing device-derived, so the preview built before the FrogFS parse is a " +
      "cache hit forever and the stale number never settles",
  );
});

await check("only the device's own cores are fetched, and only once", () => {
  const body = fnBody(tabSrc(), "function deviceCoreFetches");
  assert(
    /preparedBytesFor\(key\) !== undefined/.test(body),
    "a core already held would be refetched on every preview rebuild",
  );
  assert(
    /row\.active/.test(body),
    "an inactive source's target can be fetched, so a disabled core comes back from the dead",
  );
});

await check("a LittleFS core is not this path's business", () => {
  const body = fnBody(tabSrc(), "function deviceCoreFiles");
  assert(
    /installedFrogfs/.test(body),
    "the device's cores are read from somewhere other than the FrogFS parse",
  );
  assert(
    /startsWith\("cores\//.test(body),
    "every device file is treated as a core, so the preview refetches unrelated targets",
  );
});

console.log(`\ncoregate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
