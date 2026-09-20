#!/usr/bin/env node
/** Offline regression coverage for the serializable LibraryRom metadata seam. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  indexLibraryRoms,
  libraryCoverForPath,
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
  const file = { file: libraryFileMeta("Game Boy Advance/Game.gba", 1) };
  eq(coverPathsForRom(file, "jpg"), [
    "Game Boy Advance/Game.jpg",
    "covers/Game Boy Advance/Game.jpg",
  ], "cover candidates");
  eq(libraryCoverForPath(file.file.relativePath), {
    originalPaths: [
      "Game Boy Advance/Game.png", "covers/Game Boy Advance/Game.png",
      "Game Boy Advance/Game.jpg", "covers/Game Boy Advance/Game.jpg",
      "Game Boy Advance/Game.jpeg", "covers/Game Boy Advance/Game.jpeg",
    ],
    carouselPath: "Game Boy Advance/Game.img",
    deviceImgPath: "covers/Game Boy Advance/Game.img",
  }, "cover relationship");
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

console.log(`\nlibrarymodel: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
