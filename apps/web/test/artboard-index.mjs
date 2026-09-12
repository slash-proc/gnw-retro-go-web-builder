#!/usr/bin/env node
// Guard: every artboard in `docs/design/mockups/` must appear BOTH in the README index table
// and in `canvas.json`, and neither may name a board that does not exist.
//
// Why this exists: an audit found 23 of 57 boards missing from the README index, after the
// index had been declared complete on the strength of spot-checking nine names. A spot check
// cannot fail the way "is the index complete?" implies. This can.
//
// What it checks, in both directions:
//   file  -> README index  (a board nobody indexed is invisible to the next conformance pass)
//   file  -> canvas.json   (a board not on the canvas is never published or reviewed)
//   README index -> file   (a stale index entry sends someone hunting a deleted board)
//   canvas.json -> file    (a stale canvas entry breaks the re-seed)
//
// How the README index is read: the `| File | Screen |` table. Column 0 holds backticked board
// names without the `.dc.html` suffix, one or more per row separated by `/` — e.g.
// `` `Landing1` / `Landing2` ``. Only column 0 is read, so backticked prose in the Screen
// column (`Skip anyway`, `Custom range…`) can never be mistaken for a board name. Cells are
// split on `|` outside backtick spans, and the empty leading cell a `|`-prefixed row produces
// is dropped — the same two parser traps documented in docs/CONFORMANCE.md and implemented in
// conformance-counts.mjs.
//
// Cost: one readdir plus two small file reads. ~15 ms.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const DIR = "docs/design/mockups";

// The two conformance surveys. A board that appears in neither has never been walked, and
// because the scoreboard counts ROWS, an unwalked board contributes nothing to it and cannot
// lower it -- it is invisible rather than pending. That is how the denominator sat at 57 while
// the canvas grew to 85 and 28 screens went unsurveyed without any guard noticing.
const SURVEYS = [
  "docs/audit-artboard-conformance-a.md",
  "docs/audit-artboard-conformance-b.md",
];

// Boards that legitimately have no implementation to walk, so "unsurveyed" is the right and
// permanent answer for them. Keep this SHORT and give every entry a reason: it is the one way
// to make this check pass without doing the work, so an entry added to silence a failure is
// the failure. Adding a screen here is a lie; adding a type specimen is not.
const NOT_A_SCREEN = new Map([
  ["Specimen", "a type specimen, not a screen: no implementation exists to walk it against"],
]);

// THE UNWALKED BACKLOG, as it stood on 2026-09-12 when this check was written.
//
// These 28 boards were drawn after both conformance surveys and have never been walked. They
// are a real gap, not an exemption: each one still needs a survey pass. They are listed so the
// check can fail on the NEXT board to arrive unwalked instead of drowning in this backlog --
// the same shape as i18n-locale-drift's BASELINE, and for the same reason.
//
// THIS LIST ONLY EVER SHRINKS. Walking a board means deleting its line here. Adding a line is
// how this check stops meaning anything, so a new board belongs in a survey, never here. The
// check below fails if a name here is already walked, so a stale entry cannot linger either.
const UNWALKED_BACKLOG = new Set([
  "FirmwareUpgrade", "GuidedLocked", "Landing2Unsupported",
  "LibraryComposed", "LibraryComposedOptions", "LibraryComposedOptionsCheats",
  "LibraryComposedOptionsSaves", "LibraryComposedSummary",
  "ModalFilesFolder", "ModalFolderSdUnreadable", "ModalNameCollision",
  "RomsActivityLog", "RomsLoading", "RomsNotice", "RomsPrepare",
  "SourcesAddHomebrewDir", "SourcesAddRoms", "SourcesCache",
  "SourcesConfigureHomebrewDir", "SourcesConfigureRoms", "SourcesCuratedUnreadable",
  "SourcesEmulatorConfig", "SourcesFilesSupplied", "SourcesHomebrewConfig",
  "SourcesLocalHomebrew", "SourcesRail", "SourcesRomFolders", "SourcesUpdateAll",
]);

function splitCells(line) {
  const out = [];
  let cur = "";
  let inTicks = false;
  for (const ch of line) {
    if (ch === "`") {
      inTicks = !inTicks;
      cur += ch;
      continue;
    }
    if (ch === "|" && !inTicks) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  if (out.length && out[0].trim() === "") out.shift(); // trap: empty leading cell
  if (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.map((c) => c.trim());
}

function readIndex(text) {
  const lines = text.split("\n");
  const names = new Set();
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    const cells = splitCells(line);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!inTable) {
      inTable = /^File$/i.test(cells[0] ?? "") && /^Screen$/i.test(cells[1] ?? "");
      continue;
    }
    for (const part of (cells[0] ?? "").split("/")) {
      const m = part.trim().match(/^`([^`]+)`$/);
      if (m) names.add(m[1].replace(/\.dc\.html$/, "").trim());
    }
  }
  return names;
}

function main() {
  const dir = path.join(REPO, DIR);
  const readme = path.join(dir, "README.md");
  const canvasPath = path.join(dir, "canvas.json");

  // Never pass vacuously: if any input is absent, nothing was checked.
  for (const p of [dir, readme, canvasPath]) {
    if (!fs.existsSync(p)) {
      console.error(`artboard-index: FAIL — cannot run, missing ${path.relative(REPO, p)}`);
      return 1;
    }
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".dc.html"))
    .map((f) => f.replace(/\.dc\.html$/, ""))
    .sort();
  if (files.length === 0) {
    console.error(`artboard-index: FAIL — no *.dc.html artboards found in ${DIR}; nothing could be checked.`);
    return 1;
  }

  const indexed = readIndex(fs.readFileSync(readme, "utf8"));
  if (indexed.size === 0) {
    console.error(`artboard-index: FAIL — the README's \`| File | Screen |\` index table was not found or is empty; nothing could be checked.`);
    return 1;
  }

  let canvas;
  try {
    canvas = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  } catch (e) {
    console.error(`artboard-index: FAIL — canvas.json is not valid JSON: ${e.message}`);
    return 1;
  }
  const boards = Array.isArray(canvas?.artboards) ? canvas.artboards : null;
  if (!boards || boards.length === 0) {
    console.error("artboard-index: FAIL — canvas.json has no non-empty `artboards` array; nothing could be checked.");
    return 1;
  }
  const onCanvas = new Set(boards.map((b) => String(b?.file ?? "").replace(/\.dc\.html$/, "")));

  const have = new Set(files);
  const problems = [];
  const list = (label, xs, hint) => {
    if (xs.length) problems.push({ label, xs: [...xs].sort(), hint });
  };
  list("in docs/design/mockups but NOT in the README index", files.filter((f) => !indexed.has(f)), "add a `| `Name` | Screen |` row");
  list("in docs/design/mockups but NOT in canvas.json", files.filter((f) => !onCanvas.has(f)), "add an artboards[] entry with x/y/w/h/title");
  list("named by the README index but NO such .dc.html file", [...indexed].filter((n) => !have.has(n)), "stale index row — remove or rename it");
  list("named by canvas.json but NO such .dc.html file", [...onCanvas].filter((n) => !have.has(n)), "stale canvas entry — remove or rename it");

  // Coverage: every board must be walked by at least one survey, or declared not-a-screen.
  // Read the surveys as plain text and look for the bare board name on a word boundary: the
  // surveys cite boards both as `Name.dc.html` and as bare `Name`, and a suffix-only match
  // would report a walked board as unwalked.
  let surveyText = "";
  for (const rel of SURVEYS) {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) {
      console.error(`artboard-index: FAIL — survey ${rel} is missing; coverage could not be checked.`);
      return 1;
    }
    surveyText += fs.readFileSync(p, "utf8");
  }
  if (surveyText.trim().length === 0) {
    console.error("artboard-index: FAIL — the conformance surveys are empty; coverage could not be checked.");
    return 1;
  }
  const walked = (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(surveyText);
  const unwalked = files.filter((f) => !NOT_A_SCREEN.has(f) && !walked(f));
  list(
    "drawn but walked by NEITHER conformance survey",
    unwalked.filter((f) => !UNWALKED_BACKLOG.has(f)),
    "walk it into survey A or B, or add it to NOT_A_SCREEN with a reason if it has no implementation",
  );
  // The backlog only shrinks. A name that is now walked must leave it, or the list stops
  // describing anything and quietly grants a future board the same pass.
  list(
    "listed in UNWALKED_BACKLOG but now walked by a survey",
    [...UNWALKED_BACKLOG].filter((n) => have.has(n) && walked(n)),
    "walked — delete its line from UNWALKED_BACKLOG",
  );
  list(
    "listed in UNWALKED_BACKLOG but NO such .dc.html file",
    [...UNWALKED_BACKLOG].filter((n) => !have.has(n)),
    "stale backlog entry — remove it",
  );
  // A stale exemption is its own drift: it makes a board look deliberately skipped when it is
  // simply gone, and it would quietly excuse a future board that reused the name.
  list(
    "named by NOT_A_SCREEN but NO such .dc.html file",
    [...NOT_A_SCREEN.keys()].filter((n) => !have.has(n)),
    "stale exemption — remove it",
  );

  if (!problems.length) {
    const walkedCount = files.length - NOT_A_SCREEN.size - UNWALKED_BACKLOG.size;
    console.log(
      `artboard-index: OK — ${files.length} artboard(s), all present in the README index and canvas.json, ` +
      `neither naming a board that does not exist; ${walkedCount} walked by a survey, ` +
      `${UNWALKED_BACKLOG.size} in the unwalked backlog, ${NOT_A_SCREEN.size} not a screen`,
    );
    return 0;
  }

  console.error(`\nartboard-index: FAIL — the artboard bookkeeping in ${DIR} is out of sync\n`);
  for (const p of problems) {
    console.error(`  ${p.xs.length} ${p.label}:`);
    for (const x of p.xs) console.error(`    ${x}.dc.html`);
    console.error(`    -> ${p.hint}\n`);
  }
  return 1;
}

process.exit(main());
