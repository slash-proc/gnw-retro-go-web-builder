#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");
const app = readFileSync(join(here, "../src/App.svelte"), "utf8");
const state = readFileSync(join(here, "../src/lib/massCoverImport.svelte.ts"), "utf8");
const overlay = readFileSync(join(here, "../src/lib/ui/MassCoverImportOverlay.svelte"), "utf8");
const romManagement = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");

assert.match(state, /active:\s*false[\s\S]*minimized:\s*false[\s\S]*cancelRequested:\s*false/,
  "the running job, minimize state, and cancellation request must survive panel remounts");
assert.match(panel, /async function startImport\(\)[\s\S]*?if \(massCoverImport\.active\) return;[\s\S]*?massCoverImport\.active = true/,
  "the import start path must acquire a shared single-run lock before doing work");
assert.match(panel, /async function openImportModal\(\)[\s\S]*?if \(massCoverImport\.active\)[\s\S]*?massCoverImport\.minimized = false;[\s\S]*?return;[\s\S]*?massCoverImport\.modalOpen = true;/,
  "opening import while a run is active must reveal that run without preparing a second selection");
assert.match(panel, /shouldCancel:\s*\(\) => massCoverImport\.cancelRequested/,
  "Stop must be connected to the scraper cancellation hook");
assert.match(overlay, /#if massCoverImport\.active && !massCoverImport\.minimized[\s\S]*?onDismiss=\{null\}[\s\S]*?importModal\.minimize[\s\S]*?importModal\.stop/,
  "the app-level running modal has Minimize and Stop controls and cannot be dismissed with X/backdrop");
assert.match(overlay, /massCoverImport\.previewBlob[\s\S]*?createObjectURL[\s\S]*?massCoverImport\.previewMessage/,
  "the running modal preview lives with the shared job state and survives panel remounts");
assert.match(romManagement, /patchImportedAtlasCover\(cover: \{ key\?: string[\s\S]*?romSelection\.rows\.find\(\(row\) => row\.key === gameKey\)[\s\S]*?patchCarouselAtlasCover\(atlas, owner, cover\.bytes\)/,
  "a first cover can be assigned to its game and patched into an existing atlas page or appended page");
assert.match(romManagement, /overrides\.set\(owner, override\.path\)[\s\S]*?owners\.set\(`\$\{sourceId\}\\u0000\$\{path\}`, owner\)/,
  "newly imported cover paths are included in the selected atlas entries and cache signature");
assert.match(romManagement, /if \(!incrementalAtlasPatchFailed && \(!cover \|\| !\(await patchImportedAtlasCover\(cover\)\)\)\)/,
  "after the first incremental patch failure, the batch stops retrying the same doomed fast path");
assert.match(panel, /class="mass-import-btn"[\s\S]*?openImportModal\(\)/,
  "the mass import action uses its own class and reopens the active run");
assert.match(app, /massCoverImport\.active && massCoverImport\.minimized[\s\S]*?progressLabel\(massCoverImport\.current, massCoverImport\.total\)[\s\S]*?massCoverImport\.current \/ massCoverImport\.total/,
  "the minimized import appears in the shared bottom-left progress display");
assert.match(app, /<MassCoverImportOverlay \/>/,
  "the running modal is mounted globally rather than inside a game panel");
assert.match(app, /onclick=\{backgroundStatus\.resumeCoverImport \? \(\) => \{ massCoverImport\.minimized = false; \} : undefined\}/,
  "activating the minimized progress display restores the active overlay");

console.log("mass cover import: single active job, minimize/restore, and stop wiring passed");
