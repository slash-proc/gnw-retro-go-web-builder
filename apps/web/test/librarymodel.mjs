#!/usr/bin/env node
/** Offline regression coverage for the serializable LibraryRom metadata seam. */
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-librarymodel-"));
mkdirSync(join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/libraryModel.ts")],
  outfile: join(out, "libraryModel.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const {
  coverPathsForRom,
  createLibraryRom,
  libraryFileFingerprint,
  sameLibraryFileMeta,
  indexLibraryRoms,
  libraryCoverForPath,
  inlineCoverPathsForRom,
  sourceCoverPathForRom,
  libraryCoverCacheKey,
  libraryFileMeta,
  libraryRomId,
} = await import(pathToFileURL(join(out, "libraryModel.js")).href);

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; }
  catch (error) { failed++; console.log(`  FAIL ${name}: ${error.message}`); }
}
function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function ok(value, message) { if (!value) throw new Error(message); }

check("file metadata stays source-relative and normalizes the extension", () => {
  eq(libraryFileMeta("Game Boy Advance/Game.gba", 1234, 99), {
    relativePath: "Game Boy Advance/Game.gba",
    filename: "Game.gba",
    extension: ".gba",
    size: 1234,
    lastModified: 99,
  }, "metadata");
});

check("ROM identity includes the DirectorySource", () => {
  const path = "Game Boy Advance/Game.gba";
  ok(libraryRomId("source-a", path) !== libraryRomId("source-b", path), "source collision");
  eq(libraryRomId("source-a", path), libraryRomId("source-a", path.toLowerCase()), "case-folded id");
});

check("derived cover identity includes source and file metadata", () => {
  const key = libraryCoverCacheKey("source-a", "Game Boy Advance/Game.png", 123, 99);
  eq(key, "library-img:source-a:Game Boy Advance/Game.png:123:99", "cache key");
  ok(key !== libraryCoverCacheKey("source-b", "Game Boy Advance/Game.png", 123, 99), "source collision");
  ok(key !== libraryCoverCacheKey("source-a", "Game Boy Advance/Game.png", 124, 99), "size invalidation");
});

check("cover paths remain beside the ROM with the legacy mirror fallback", () => {
  const file = {
    file: libraryFileMeta("Game Boy Advance/Game.gba", 1),
    system: { extensions: [".gba"] },
  };
  eq(coverPathsForRom(file, "jpg"), [
    "Game Boy Advance/Game.jpg",
    "covers/Game Boy Advance/Game.jpg",
  ], "cover candidates");
  eq(libraryCoverForPath(file.file.relativePath), {
    originalPaths: [
      "Game Boy Advance/Game.png", "covers/Game Boy Advance/Game.png",
      "Game Boy Advance/Game.jpg", "covers/Game Boy Advance/Game.jpg",
      "Game Boy Advance/Game.jpeg", "covers/Game Boy Advance/Game.jpeg",
      "Game Boy Advance/Game.webp", "covers/Game Boy Advance/Game.webp",
      "Game Boy Advance/Game.bmp", "covers/Game Boy Advance/Game.bmp",
    ],
    carouselPath: "Game Boy Advance/Game.img",
    deviceImgPath: "covers/Game Boy Advance/Game.img",
  }, "cover relationship");
});

check("compound ROM extensions keep PICO-8 ROMs out of cover paths", () => {
  const path = "pico8/celeste.p8.png";
  const system = { extensions: [".p8", ".p8.png"] };
  const rom = { file: libraryFileMeta(path, 1), system };
  eq(coverPathsForRom(rom, "png"), ["pico8/celeste.png", "covers/pico8/celeste.png"], "cover candidates");
  eq(inlineCoverPathsForRom(path, system.extensions), [
    "pico8/celeste.p8.img", "pico8/celeste.png", "pico8/celeste.jpg",
  ], "inline candidates");
  eq(libraryCoverForPath(path, system.extensions), {
    originalPaths: [
      "pico8/celeste.png", "covers/pico8/celeste.png",
      "pico8/celeste.jpg", "covers/pico8/celeste.jpg",
      "pico8/celeste.jpeg", "covers/pico8/celeste.jpeg",
      "pico8/celeste.webp", "covers/pico8/celeste.webp",
      "pico8/celeste.bmp", "covers/pico8/celeste.bmp",
      "pico8/celeste.p8.png",
    ],
    carouselPath: "pico8/celeste.p8.img",
    deviceImgPath: "covers/pico8/celeste.p8.img",
  }, "cover relationship");
  const singleSuffixRom = { file: libraryFileMeta("pico8/celeste.p8", 1), system };
  eq(coverPathsForRom(singleSuffixRom, "png"), coverPathsForRom(rom, "png"), "both ROM formats share one PNG");
  const singleSuffixCover = libraryCoverForPath(singleSuffixRom.file.relativePath, system.extensions);
  eq(singleSuffixCover.deviceImgPath, "covers/pico8/celeste.img", "single suffix follows firmware cover path");
  ok(singleSuffixCover.deviceImgPath !== libraryCoverForPath(path, system.extensions).deviceImgPath,
    "device paths retain firmware's final-extension distinction");
  ok(!singleSuffixCover.originalPaths.includes(singleSuffixRom.file.relativePath), ".p8 alone is not treated as image art");
  eq(sourceCoverPathForRom(path, ".png", system.extensions), "pico8/celeste.png", "optional source PNG sits beside the ROM");
  eq(sourceCoverPathForRom(singleSuffixRom.file.relativePath, ".png", system.extensions), "pico8/celeste.png",
    "single and compound suffixes share the beside-ROM PNG");
});

check("indexes expose identity, path and system views", () => {
  const system = {
    id: "gba", folder: "Game Boy Advance", shortName: "GBA", longName: "Game Boy Advance",
    coreSourceIds: ["core-gba"],
  };
  const a = {
    id: libraryRomId("source-a", "Game Boy Advance/A.gba"),
    file: libraryFileMeta("Game Boy Advance/A.gba", 1),
    directorySource: { id: "source-a", name: "A", folderName: "A" },
    system, role: "installable", device: { installed: false },
  };
  const b = {
    id: libraryRomId("source-b", "Game Boy Advance/B.gba"),
    file: libraryFileMeta("Game Boy Advance/B.gba", 2),
    directorySource: { id: "source-b", name: "B", folderName: "B" },
    system, role: "installable", device: { installed: false },
  };
  const indexes = indexLibraryRoms([a, b]);
  eq(indexes.byId.get(a.id), a, "id index");
  eq(indexes.bySourcePath.get("source-a:game boy advance/a.gba"), a, "source path index");
  eq(indexes.bySourcePath.get("source-b:game boy advance/b.gba"), b, "second source path index");
  eq(indexes.byPath.get("game boy advance/a.gba"), a, "path index");
  eq(indexes.bySystem.get("Game Boy Advance"), [a, b], "system index");
});

check("core source references preserve repository, bundle and raw-binary provenance", () => {
  const sourceKinds = ["repository", "bundle", "raw-binary"];
  const roms = sourceKinds.map((kind, index) => ({
    id: libraryRomId("source-a", `Game Boy Advance/${kind}.gba`),
    file: libraryFileMeta(`Game Boy Advance/${kind}.gba`, index + 1),
    system: {
      id: "gba", folder: "Game Boy Advance", shortName: "gba", longName: "Game Boy Advance",
      coreSourceIds: [`core-${kind}`], primaryCoreSourceId: `core-${kind}`,
      source: { id: `core-${kind}`, kind, targetId: "gba" },
    },
    role: "installable",
    device: { installed: false },
  }));
  for (const [index, rom] of roms.entries()) {
    eq(rom.system.source.kind, sourceKinds[index], "source kind");
    eq(JSON.parse(JSON.stringify(rom)), rom, "serializable ROM metadata");
  }
});

check("the construction seam creates metadata without materializing bytes", () => {
  const rom = createLibraryRom({
    sourceId: "source-a",
    source: { id: "source-a", name: "Roms", folderName: "Roms" },
    path: "Game Boy Advance/Game.gba",
    size: 4096,
    lastModified: 123,
    system: {
      id: "gba", folder: "Game Boy Advance", shortName: "gba", longName: "Game Boy Advance",
      coreSourceIds: ["core-gba"], primaryCoreSourceId: "core-gba",
    },
    role: "installable",
    installed: false,
  });
  eq(rom.file.filename, "Game.gba", "filename metadata");
  eq(rom.cover.originalPaths[0], "Game Boy Advance/Game.png", "source-relative cover");
  ok(!Object.prototype.hasOwnProperty.call(rom, "bytes"), "no ROM bytes field");
  eq(JSON.parse(JSON.stringify(rom)), rom, "round-trip metadata");
});

check("metadata fingerprints are source-qualified and conservative", () => {
  const a = libraryFileMeta("Game Boy Advance/Game.gba", 10, 20);
  const b = libraryFileMeta("game boy advance/GAME.GBA", 10, 20);
  const changed = libraryFileMeta(a.relativePath, 11, 20);
  eq(libraryFileFingerprint("source-a", a), libraryFileFingerprint("source-a", b), "case-folded identity");
  ok(libraryFileFingerprint("source-a", a) !== libraryFileFingerprint("source-b", a), "source identity");
  ok(sameLibraryFileMeta("source-a", a, b), "unchanged metadata");
  ok(!sameLibraryFileMeta("source-a", a, changed), "size invalidation");
  ok(!sameLibraryFileMeta("source-a", libraryFileMeta(a.relativePath, 10), b), "missing mtime is conservative");
});

// Execute the actual post-merge reconciliation block: hydration uses placed keys, while
// dedicated-folder scans begin with loose keys. Metadata equality must retain the old reader.
const librarySource = readFileSync(join(here, "../src/lib/library.svelte.ts"), "utf8");
const reconciliation = librarySource.slice(librarySource.indexOf("      const userRoms = merged.files;"), librarySource.indexOf('      if (this.progress) this.progress = { ...this.progress, stage: "Organizing library"'));
function exerciseReconciliation(block) {
  const context = { sameLibraryFileMeta, libraryFileMetaFromScan: (key, file) => libraryFileMeta(key, file.length, file.lastModified), isLazy: (v) => !!v && typeof v.bytes === "function", JSON };
  const code = esbuild.transformSync(`function reconcile(merged: any) { ${block} return userRoms; } globalThis.reconcile = reconcile;`, { loader: "ts", target: "es2022" }).code;
  runInNewContext(code, context);
  const lazy = (archive, length = 10, lastModified = 20, zipEntry = undefined) => ({ archive, length, lastModified, zipEntry, releases: 0, bytes() { throw Error("snapshot comparison read payload"); }, release() { this.releases++; } });
  const old = lazy("bios.gg");
  const next = lazy("bios.gg");
  const previous = new Map([["bios/bios.gg", old]]);
  const origin = new Map([["bios/bios.gg", "bios-source"]]);
  const state = { scan: { userRoms: previous }, fileOrigin: origin };
  const merge = (file, source = "bios-source") => ({ files: new Map([["bios/bios.gg", file]]), origin: new Map([["bios/bios.gg", source]]) });
  const result = context.reconcile.call(state, merge(next));
  ok(result.get("bios/bios.gg") === old, "unchanged placed BIOS reader was replaced");
  eq(next.releases, 1, "unused new reader released");
  for (const changed of [lazy("bios.gg", 11), lazy("bios.gg", 10, 21), lazy("renamed.gg"), { ...lazy("bios.gg"), lastModified: undefined }, lazy("bios.gg", 10, 20, { name: "different.rom" })]) {
    ok(context.reconcile.call(state, merge(changed)).get("bios/bios.gg") === changed, "changed file was incorrectly reused");
  }
  const otherSource = lazy("bios.gg");
  ok(context.reconcile.call(state, merge(otherSource, "another-source")).get("bios/bios.gg") === otherSource, "source ownership was ignored");
  const removed = context.reconcile.call(state, { files: new Map(), origin: new Map() });
  eq(removed.size, 0, "removed files are not resurrected");
}
check("post-merge hydration retains unchanged placed readers without reading payloads", () => exerciseReconciliation(reconciliation));
check("ANTI-VACUITY: removing reader retention fails the behavioral check", () => {
  const mutation = reconciliation.replace("userRoms.set(key, old);", "");
  ok(mutation !== reconciliation, "retention mutation must change the implementation");
  let failure;
  try { exerciseReconciliation(mutation); } catch (error) { failure = error; }
  ok(failure?.message.includes("unchanged placed BIOS reader was replaced"), "removing retention did not trigger its regression");
});

console.log(`\nlibrarymodel: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
