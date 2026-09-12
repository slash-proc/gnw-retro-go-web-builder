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

  if (!problems.length) {
    console.log(`artboard-index: OK — ${files.length} artboard(s), all present in the README index and canvas.json, neither naming a board that does not exist`);
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
