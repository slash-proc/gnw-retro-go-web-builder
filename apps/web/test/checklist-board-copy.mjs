#!/usr/bin/env node
/** Guards the established install phase checklist labels in English string tables. */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strings = join(here, "../src/lib/i18n/strings");
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message || e}`); } };
const valuesCache = new Map();
function values(file, key) {
  if (!valuesCache.has(file)) {
    const path = join(strings, file);
    if (!existsSync(path)) throw new Error(`missing string table ${file}`);
    valuesCache.set(file, readFileSync(path, "utf8"));
  }
  const re = new RegExp(`^[ \\t]*${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "gm");
  const found = [...valuesCache.get(file).matchAll(re)].map((m) => m[1]);
  if (found.length === 0) throw new Error(`${file}: no declaration of ${key}`);
  return found;
}

// These labels are already part of the product's English copy. Keep the same wording wherever
// the shared install phases are presented; adding or changing a phase remains a product decision.
const PINNED = [
  ["wizard.ts", "phaseReadExistingState", "Read existing state"],
  ["wizard.ts", "subReadPreviousGameState", "Read previous game state"],
  ["wizard.ts", "subExtractCoresSaves", "Extract cores, saves"],
  ["wizard.ts", "subMigrateInstalledGames", "Migrate installed games"],
  ["wizard.ts", "phaseDownloadFirmware", "Download firmware"],
  ["wizard.ts", "phaseBuildInstallImage", "Build install image"],
  ["wizard.ts", "subBuildGamesBiosLanguages", "Games, BIOS, languages"],
  ["wizard.ts", "subBuildCoresSaves", "Cores, saves"],
  ["wizard.ts", "subPatchSuperblock", "Patch superblock"],
  ["wizard.ts", "phaseFlashingRetroGo", "Flashing Retro-Go"],
  ["wizard.ts", "phaseRescan", "Rescan device"],
  ["wizard.ts", "regionGamesBiosLanguages", "Games, BIOS, languages"],
  ["wizard.ts", "regionCoresSaves", "Cores, saves"],
  ["firmwareSetup.ts", "phaseMigrateScan", "Read existing state"],
  ["firmwareSetup.ts", "subFrogfsState", "Read previous game state"],
  ["firmwareSetup.ts", "subLfsExtract", "Extract cores, saves"],
  ["firmwareSetup.ts", "subGamesMigrate", "Migrate installed games"],
  ["firmwareSetup.ts", "phaseDownload", "Download firmware"],
  ["firmwareSetup.ts", "phaseBuildInstallImage", "Build install image"],
  ["firmwareSetup.ts", "subBuildFrogfs", "Games, BIOS, languages"],
  ["firmwareSetup.ts", "subBuildLittlefs", "Cores, saves"],
  ["firmwareSetup.ts", "subPatchSuperblock", "Patch superblock"],
  ["firmwareSetup.ts", "phaseRescan", "Rescan device"],
  ["firmwareSetup.ts", "regionFrogfs", "Games, BIOS, languages"],
  ["firmwareSetup.ts", "regionLittlefs", "Cores, saves"],
  ["roms.ts", "phaseBuild", "Build install image"],
];

for (const [file, key, expected] of PINNED) {
  check(`${file}:${key}`, () => {
    for (const value of values(file, key)) {
      if (value !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    }
  });
}

if (failures.length) {
  console.error(`checklist copy: ${failures.length} FAILED, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`checklist copy: ${passed} checks passed`);
