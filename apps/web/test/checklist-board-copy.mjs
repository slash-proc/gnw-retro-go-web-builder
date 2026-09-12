#!/usr/bin/env node
/**
 * The install phase-checklist copy is the ARTBOARD's, not the code's.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/checklist-board-copy.mjs'
 *
 * `docs/design/mockups/GuidedFlashing.dc.html` (and its two siblings `FlashingCancel` /
 * `FlashingCancelConfirm`, which draw the SAME modal) are the approved source for every row
 * label in the install progress modal. The code once carried longer invented variants —
 * "Read existing device state" for the board's "Read existing state", "Build games, BIOS,
 * languages image" for its "Games, BIOS, languages" — and, because each English key has six
 * translated siblings, the reword had propagated into all seven locales before it was caught.
 * This guard pins the English strings to the board so a future reword fails loudly here
 * instead of quietly diverging again.
 *
 * Scope, deliberately: ENGLISH ONLY, and only the keys the board actually draws. Steps the
 * code runs that no board lists (wizard's "Prepare install image", "Set SD cache
 * reserved-offset boundary", roms' "Re-read retained on-device games") are NOT checked and
 * NOT to be deleted — HANDOVER §4 records the owner's ruling that nothing is cut for absence
 * from a mockup. Locale drift is `test/i18n-locale-drift.mjs`'s job, not this file's.
 *
 * Plain node, no framework, no bundler: the board is parsed as text and the string tables are
 * read as text too (a `KEY: "value"` line match), so this runs with zero imports from src/.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mockups = join(here, "../../../docs/design/mockups");
const strings = join(here, "../src/lib/i18n/strings");

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message || e}`); } };
const die = (m) => { console.error("checklist-board-copy: " + m); process.exit(1); };

// --- the board -------------------------------------------------------------------------
// Every checklist row (phase and sub-step alike) is a `<span … flex-grow: 1;">Label</span>`
// inside the modal. The trailing `[137/137]` / `46%` counters are separate spans WITHOUT
// flex-grow, so they don't come through; nor does the "Log (23)" footer.
function boardLabels(file) {
  const p = join(mockups, file);
  if (!existsSync(p)) die(`missing artboard ${file} — this guard cannot run`);
  const html = readFileSync(p, "utf8");
  const out = [];
  for (const m of html.matchAll(/flex-grow:\s*1;">([^<]+)<\/span>/g)) {
    out.push(m[1].replace(/&amp;/g, "&").trim());
  }
  return out;
}

const GUIDED = "GuidedFlashing.dc.html";
const labels = boardLabels(GUIDED);
if (labels.length < 10) die(`parsed only ${labels.length} checklist rows from ${GUIDED} — the markup changed, fix this parser`);

// The three boards draw one and the same modal; if they ever disagree, the reference is
// ambiguous and every assertion below is worthless, so say so rather than pick one.
for (const sibling of ["FlashingCancel.dc.html", "FlashingCancelConfirm.dc.html"]) {
  check(`${sibling} draws the same checklist as ${GUIDED}`, () => {
    const other = boardLabels(sibling);
    const a = JSON.stringify(labels), b = JSON.stringify(other);
    if (a !== b) throw new Error(`boards disagree:\n  ${GUIDED}: ${a}\n  ${sibling}: ${b}`);
  });
}

const has = (s) => {
  if (!labels.includes(s)) throw new Error(`${JSON.stringify(s)} is not a row on ${GUIDED}. Board rows: ${JSON.stringify(labels)}`);
};

// --- the string tables -----------------------------------------------------------------
// A key can legitimately be declared more than once in one area file — the tables are nested
// objects (`wizard.step1` / `wizard.step2`, `firmwareSetup`'s several sections) and a phase
// like `phaseRescan` recurs in each. Every occurrence in the files listed below is the same
// checklist row, so ALL of them are asserted; a file where that stops being true (roms.ts
// declares both "Rescan device" and the SD path's "Rescan SD card") simply isn't pinned here.
const srcCache = new Map();
function values(file, key) {
  if (!srcCache.has(file)) {
    const p = join(strings, file);
    if (!existsSync(p)) die(`missing string table ${file}`);
    srcCache.set(file, readFileSync(p, "utf8"));
  }
  const re = new RegExp(`^[ \\t]*${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "gm");
  const out = [...srcCache.get(file).matchAll(re)].map((m) => m[1]);
  if (out.length === 0) die(`${file}: no declaration of ${key} — the key was renamed or removed`);
  return out;
}

/** key => the board row it must equal. */
const PINNED = [
  // Guided wizard (views/Wizard.svelte -> installProgress phases)
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
  // the per-region rows under "Flashing Retro-Go" (Wizard.svelte:466-467)
  ["wizard.ts", "regionGamesBiosLanguages", "Games, BIOS, languages"],
  ["wizard.ts", "regionCoresSaves", "Cores, saves"],
  // Advanced path (advanced/RomSection.svelte) — same modal, same rows
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
  // Library install path (views/RomManagementTab.svelte) — only builds the one image
  ["roms.ts", "phaseBuild", "Build install image"],
];

for (const [file, key, board] of PINNED) {
  check(`${file}:${key}`, () => {
    has(board);
    for (const v of values(file, key)) {
      if (v !== board) throw new Error(`expected the board's ${JSON.stringify(board)}, got ${JSON.stringify(v)}`);
    }
  });
}

// --- MK9: the running note's emphasis weight, and why the two dialogs differ ---------------
// The same `workingNotePre`/`Bold`/`Post` fragment is composed by TWO modals, and their boards
// disagree on purpose. `ModalConfirmRunning`/`ModalConfirmProgress` (ConfirmModal.svelte) draw
// `<strong style="font-weight: 600;">`; `GuidedFlashing`/`FlashingCancel`/`FlashingCancelConfirm`
// (InstallProgressModal.svelte) draw a bare `<strong>`, which is the UA's 700. There is no global
// `strong` rule, so ConfirmModal needs its own and InstallProgressModal must NOT get one. A
// future "tidy" that hoists a single `strong { font-weight: 600 }` into global.css would silently
// restyle the second dialog against its own boards; this pins both halves so that fails here.
const boardStrongWeight = (file) => {
  const p = join(mockups, file);
  if (!existsSync(p)) die(`missing artboard ${file} - this guard cannot run`);
  const m = readFileSync(p, "utf8").match(/<strong([^>]*)>do not unplug your device/i);
  if (!m) die(`${file} no longer draws the "do not unplug your device" emphasis - fix this parser`);
  const w = m[1].match(/font-weight:\s*(\d+)/);
  return w ? w[1] : "unset";
};
const src = (rel) => {
  const p = join(here, "../src", rel);
  if (!existsSync(p)) die(`missing ${rel} - this guard cannot run`);
  return readFileSync(p, "utf8");
};
// Comments carry the words this guard matches on, so strip them before looking for a rule.
const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");

check("the two running-note boards disagree on the emphasis weight, deliberately", () => {
  const confirm = boardStrongWeight("ModalConfirmRunning.dc.html");
  const guided = boardStrongWeight("GuidedFlashing.dc.html");
  if (confirm !== "600") throw new Error(`ModalConfirmRunning draws font-weight ${confirm}, expected 600`);
  if (guided !== "unset") throw new Error(`GuidedFlashing now pins font-weight ${guided}; it drew a bare <strong>, so the split below may be wrong`);
});

check("ConfirmModal gives its emphasis the 600 its board draws", () => {
  if (!/\.muted\s+strong\s*\{[^}]*font-weight:\s*600/.test(noComments(src("lib/ui/ConfirmModal.svelte")))) {
    throw new Error("ConfirmModal has no rule setting the running note's <strong> to 600, so it renders at the UA's 700 against ModalConfirmRunning");
  }
});

check("InstallProgressModal does NOT override it, because its own boards do not", () => {
  if (/\bstrong\s*\{[^}]*font-weight/.test(noComments(src("lib/ui/InstallProgressModal.svelte")))) {
    throw new Error("InstallProgressModal now pins a <strong> weight; GuidedFlashing draws a bare <strong> (700), so this diverges from its board");
  }
});

check("no global strong rule quietly restyles both dialogs at once", () => {
  for (const sheet of ["styles/global.css", "styles/tokens.css"]) {
    if (/(^|[\s,>])strong\s*(,[^{]*)?\{[^}]*font-weight/m.test(noComments(src(sheet)))) {
      throw new Error(`${sheet} now sets a global strong weight; that reaches InstallProgressModal too, whose boards draw a bare <strong>`);
    }
  }
});

if (failures.length) {
  console.error(`checklist-board-copy: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`checklist-board-copy: ${passed} checks passed`);
