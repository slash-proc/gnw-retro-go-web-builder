#!/usr/bin/env node
/**
 * The net-change decomposition — `src/lib/frogfsDiff.ts`.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/netchange.mjs'
 *
 * WHAT IS BEING PINNED. The Library dock shows one number, `newFrogfsLen - currentFrogfsLen`,
 * and it has twice been wrong with nothing behind it to look at: `-0.18 MB` on a fresh install
 * with nothing selected, then `+19.23 MB` after selecting one 48.61 KB ROM. The decomposition
 * exists so a single log line names which files moved. These checks are about the two
 * properties that make such a line trustworthy:
 *
 *   1. THE INVARIANT the owner reported against: two sides holding the same files at the same
 *      sizes must net to zero, and every category must be zero too. A diff that quietly
 *      attributed a phantom delta to a category would make the instrumentation worse than
 *      nothing, because it would point at an innocent one.
 *   2. THE IDENTITY `net = fileDelta + overheadDelta`, which must hold for ANY pair of inputs.
 *      Overhead is the FrogFS index and alignment padding: real, and not always zero. If it
 *      were folded into the per-file numbers, the small-unexplained-delta case (the `-0.18 MB`
 *      shape) would be indistinguishable from a file actually changing size.
 *
 * Plain node, no framework (repo convention); esbuild transpiles the one pure module.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-netchange-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/frogfsDiff.ts")],
  outfile: join(out, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const { diffFrogfs, movedCategories, categoryOf } = await import(pathToFileURL(join(out, "bundle.js")).href);

/** A side, written the way each real source spells one. */
const side = (total, files) => ({ total, files: files.map(([path, size]) => ({ path, size })) });

const LIBRARY = [
  ["roms/gb/zelda.gb", 1048576],
  ["roms/gb/tetris.gb", 32768],
  ["roms/nes/mario.nes", 40960],
  ["bios/gba/gba_bios.bin", 16384],
  ["covers/gb/zelda.jpg", 8192],
];
// Header + index + padding: a real image is bigger than the sum of its files, and both sides
// carry that, which is why a no-change rebuild still nets zero.
const OVERHEAD = 4096;
const sum = (files) => files.reduce((n, [, s]) => n + s, 0);

// 1. The invariant the owner reported against. Nothing selected, nothing changed, net zero --
//    and, just as important, no category invented out of the overhead.
check("identical sides net to zero", () => {
  const total = sum(LIBRARY) + OVERHEAD;
  const d = diffFrogfs(side(total, LIBRARY), side(total, LIBRARY));
  eq(d.net, 0, "net");
  eq(d.fileDelta, 0, "fileDelta");
  eq(d.overheadDelta, 0, "overheadDelta");
  eq(movedCategories(d).length, 0, "categories that moved");
  eq(d.onlyBefore.length + d.onlyAfter.length + d.resized.length, 0, "named differences");
});

// 2. The reproduction's shape. One 48.61 KB ROM is selected and the image grows by ~19.4 MB.
//    The point of the decomposition is that the ROM and the 19.36 MB that is NOT the ROM land
//    in different categories, so the log line says which one the user is paying for.
check("a small selection alongside a large arrival is separated by category", () => {
  const before = LIBRARY;
  const TAMA = 49775;      // TamagotchiP1.bin, the file the owner selected
  const UNEXPLAINED = 20300000;
  const after = [...before, ["roms/tamagotchi/TamagotchiP1.bin", TAMA], ["covers/all/pack.bin", UNEXPLAINED]];
  const d = diffFrogfs(side(sum(before) + OVERHEAD, before), side(sum(after) + OVERHEAD, after));
  eq(d.net, TAMA + UNEXPLAINED, "net");
  eq(d.overheadDelta, 0, "overheadDelta");
  const moved = movedCategories(d);
  eq(moved.length, 2, "categories that moved");
  // Sorted by magnitude, so the line leads with the term that actually costs the space.
  eq(moved[0].category, "covers", "largest mover");
  eq(moved[0].deltaBytes, UNEXPLAINED, "largest mover bytes");
  eq(moved[1].category, "roms/tamagotchi", "second mover");
  eq(moved[1].deltaBytes, TAMA, "second mover bytes");
  eq(d.onlyAfter.length, 2, "new paths named");
});

// 3. The identity, on inputs that stress it: the files are byte-identical and ONLY the image
//    length differs. This is the `-0.18 MB` shape -- a delta no file explains -- and it must
//    be reported as overhead rather than smeared across the categories.
check("a delta no file explains is reported as overhead", () => {
  const base = sum(LIBRARY);
  const d = diffFrogfs(side(base + OVERHEAD, LIBRARY), side(base + OVERHEAD - 188743, LIBRARY));
  eq(d.fileDelta, 0, "fileDelta");
  eq(d.net, -188743, "net");
  eq(d.overheadDelta, -188743, "overheadDelta");
  eq(movedCategories(d).length, 0, "categories that moved");
});

check("net = fileDelta + overheadDelta for mixed changes", () => {
  const before = LIBRARY;
  const after = [["roms/gb/zelda.gb", 2097152], ["roms/nes/mario.nes", 40960], ["roms/snes/dkc.sfc", 524288]];
  const d = diffFrogfs(side(sum(before) + OVERHEAD, before), side(sum(after) + 6000, after));
  eq(d.fileDelta + d.overheadDelta, d.net, "identity");
  eq(d.overheadDelta, 6000 - OVERHEAD, "overheadDelta");
});

// 4. Removals and resizes are distinct events and must not be conflated: a file leaving is a
//    different problem from a file changing size, and only one of them means a game was dropped.
check("removed, added and resized are told apart", () => {
  const before = [["roms/gb/zelda.gb", 1048576], ["roms/gb/tetris.gb", 32768]];
  const after = [["roms/gb/zelda.gb", 2097152], ["roms/nes/mario.nes", 40960]];
  const d = diffFrogfs(side(sum(before), before), side(sum(after), after));
  eq(d.onlyBefore.join(), "roms/gb/tetris.gb", "removed");
  eq(d.onlyAfter.join(), "roms/nes/mario.nes", "added");
  eq(d.resized.length, 1, "resized count");
  eq(d.resized[0].path, "roms/gb/zelda.gb", "resized path");
  eq(d.resized[0].before, 1048576, "resized before");
  eq(d.resized[0].after, 2097152, "resized after");
});

// 5. Categories. `roms` as one bucket would say nothing about WHICH console arrived, which is
//    the whole question when one selection pulls in a system.
check("a rom path is categorised by its system", () => {
  eq(categoryOf("roms/gb/zelda.gb"), "roms/gb", "rom");
  eq(categoryOf("roms/tamagotchi/TamagotchiP1.bin"), "roms/tamagotchi", "rom, new system");
  eq(categoryOf("bios/gba/gba_bios.bin"), "bios", "bios");
  eq(categoryOf("homebrews/celeste.bin"), "homebrews", "homebrew");
  eq(categoryOf("boot.bin"), "(root)", "a stray root file is reported, not dropped");
});

// 6. A side that lists one path twice must not double-count it; a per-file total that disagreed
//    with the image length would break the identity and send the reader after a phantom.
check("a duplicate path is counted once", () => {
  const dup = [["roms/gb/zelda.gb", 100], ["roms/gb/zelda.gb", 100]];
  const d = diffFrogfs(side(0, []), side(100, dup));
  eq(d.fileDelta, 100, "fileDelta");
  eq(d.categories.find((c) => c.category === "roms/gb").afterFiles, 1, "file count");
});

// 7. The name lists are capped so one line stays readable, but the COUNTS must stay exact --
//    a truncated list that also truncated the arithmetic would understate the change.
check("capping the name lists does not affect the byte totals", () => {
  const many = Array.from({ length: 40 }, (_, i) => [`roms/gb/g${i}.gb`, 1000]);
  const d = diffFrogfs(side(0, []), side(40000, many), 5);
  eq(d.onlyAfter.length, 5, "capped list");
  eq(d.fileDelta, 40000, "fileDelta");
  eq(d.net, 40000, "net");
  eq(d.categories.find((c) => c.category === "roms/gb").afterFiles, 40, "exact file count");
});

// 8. THE READING TRAP, pinned with the owner's own numbers (2026-09-12 log).
//    `beforeTotal` and the before FILE LIST come from two different device reads:
//    `currentFrogfsLen` is the partition's size, available straight from the connect scan,
//    while the per-file list needs `device.installedFrogfs`, a later parse. Between the two
//    the baseline is REAL but unenumerated, and the diff behaves like this: every before byte
//    lands in `overheadDelta`, no category carries a before side, and `onlyBefore` is empty.
//    A file genuinely missing from the build is then invisible AS A FILE and survives only in
//    the totals. That is exactly what happened: the device image is the built image plus
//    `cores/gba.xip`, 852548 + 192592 = 1045140, and the log still printed `onlyBefore: []`
//    with no `cores` row. Reading that line as "nothing is being removed" is wrong, and it
//    cost one wrong diagnosis. The arithmetic below is correct and must stay this way -- the
//    identity is what carries the truth when the names cannot.
check("an unenumerated baseline puts every before byte in overhead, and names nothing", () => {
  const d = diffFrogfs(side(1045140, []), side(852548, [["fonts/cp1252_serif.bin", 847872], ["bios/logo.bin", 576]]));
  eq(d.net, -192592, "net");
  eq(d.fileDelta, 848448, "fileDelta counts only the after side");
  eq(d.overheadDelta, -1041040, "the whole unenumerated baseline lands in overhead");
  eq(d.fileDelta + d.overheadDelta, d.net, "identity still holds");
  eq(d.onlyBefore.length, 0, "nothing can be named as removed");
  eq(d.categories.every((c) => c.beforeFiles === 0), true, "no category carries a before side");
});

if (failures.length) {
  console.error(`netchange: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`netchange: ${passed} checks passed`);
