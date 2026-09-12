#!/usr/bin/env node
// Guard: the per-status counts stated in `docs/CONFORMANCE.md`'s scoreboard table must equal
// the counts actually derivable from the status cells of the two artboard-conformance surveys.
//
// Why this exists: five separate passes produced five conflicting answers to "how many rows
// are FIXED?", and every wrong answer was found by a human re-count, never by anything
// automatic. `CONFORMANCE.md` now states the derivation rule in prose ("How these numbers are
// derived … so this does not have to be re-litigated a fourth time"). This file is that rule
// as code, so the claim can actually fail.
//
// THE RULE (implemented exactly as stated in CONFORMANCE.md):
//   * every line beginning `|` in a survey is a table line;
//   * a table is a ROW table only if it carries a `Status …` column that is NOT column 0 —
//     that excludes the summary tables, whose first column is `Status` / `Artboard` /
//     `the row said`;
//   * cells are split on `|` OUTSIDE backtick spans, so an inline `a|b` cannot shift columns;
//   * a row's status is the LEADING token of its status cell alone — never a status word
//     appearing later in that cell's prose;
//   * a split verdict (`FIXED in part`, `SETTLED — CONFIRMED`) resolves to its leading family.
//
// THE TWO DOCUMENTED PARSER TRAPS, handled explicitly below so nobody re-derives them:
//   TRAP 1 — a markdown row line begins with `|`, so a naive split yields an EMPTY LEADING
//     CELL. Left in place it shifts every column index by one, the summary tables whose first
//     column is `Status` then pass the "not at index 0" test, and seven phantom rows are added
//     to survey A. See dropOuterEmpties().
//   TRAP 2 — three status cells read `**BLOCKED**.` / `**CONFIRMED**.` A leading-token split
//     that does not treat a TRAILING FULL STOP as a delimiter reads them as no status at all.
//     See leadingFamily(), whose terminator class includes `.`.
//
// SCOPE, stated rather than silently narrowed. This guard covers the LIVE scoreboard: the
// per-survey and totals rows of the `| survey | artboards | rows walked | FIXED | … |` table in
// CONFORMANCE.md, plus that table's own internal arithmetic (each row's statuses sum to its
// row count; the totals row is the column sums). It deliberately does NOT police the many
// numbers stated in PROSE in CONFORMANCE.md and in the surveys' own headers ("survey A goes
// 305 → 310", "FIXED 102, OPEN 8, …"): those are a historical narrative of past passes, dated
// and superseded by construction, and asserting them against today's cells would fail on
// documents that are correct. The `artboards` column is also not derivable from status cells
// and is not checked here — Guard 2 (`artboard-index.mjs`) covers artboard bookkeeping.
//
// Cost: reads three markdown files, no git, no network. ~20 ms.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const CONFORMANCE = "docs/CONFORMANCE.md";
const SURVEYS = {
  A: "docs/audit-artboard-conformance-a.md",
  B: "docs/audit-artboard-conformance-b.md",
};

// Status families, longest-first so `COULD NOT DETERMINE` is tested before any prefix of it.
const FAMILIES = [
  "COULD NOT DETERMINE",
  "CONFIRMED",
  "CANCELLED",
  "BLOCKED",
  "CLOSED",
  "FIXED",
  "OPEN",
];
const NO_STATUS = "no status";

// The scoreboard's column headings, mapped to the family each one counts.
const COLUMN_FAMILY = [
  ["FIXED", "FIXED"],
  ["CLOSED", "CLOSED"],
  ["OPEN", "OPEN"],
  ["BLOCKED", "BLOCKED"],
  ["CONFIRMED", "CONFIRMED"],
  ["CANCELLED", "CANCELLED"],
  ["undetermined", "COULD NOT DETERMINE"],
  ["no status", NO_STATUS],
];

/** Split a markdown table line on `|` outside backtick spans. */
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
  return dropOuterEmpties(out).map((c) => c.trim());
}

/** TRAP 1: a row line starts (and usually ends) with `|`, producing empty outer cells. */
function dropOuterEmpties(cells) {
  const c = cells.slice();
  if (c.length && c[0].trim() === "") c.shift();
  if (c.length && c[c.length - 1].trim() === "") c.pop();
  return c;
}

const stripEmphasis = (s) => s.replace(/\*\*/g, "").replace(/[*_`]/g, "").trim();

/**
 * The leading status family of a status cell, or null.
 * TRAP 2: the terminator class includes `.` so `**BLOCKED**.` reads as BLOCKED.
 */
function leadingFamily(cell) {
  let s = stripEmphasis(cell);
  // A split verdict resolves to its leading family; `SETTLED` is a decoration, not a family.
  s = s.replace(/^SETTLED\s*[—–-]+\s*/, "");
  for (const fam of FAMILIES) {
    if (!s.startsWith(fam)) continue;
    const rest = s.slice(fam.length);
    if (rest === "" || /^[\s.,;:—–\-/()]/.test(rest)) return fam;
  }
  return null;
}

const isDivider = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/** Derive the per-status counts of one survey by the stated rule. */
function deriveSurvey(text) {
  const counts = Object.fromEntries([...FAMILIES, NO_STATUS].map((f) => [f, 0]));
  let rows = 0;
  let statusIdx = null; // null = expecting a header; -1 = table excluded (not a row table)
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) {
      statusIdx = null; // a blank/prose line ends the table
      continue;
    }
    const cells = splitCells(line);
    if (isDivider(cells)) continue;
    if (statusIdx === null) {
      const idx = cells.findIndex((c) => /^Status\b/.test(stripEmphasis(c)));
      statusIdx = idx > 0 ? idx : -1; // "not column 0" — excludes the summary tables
      continue;
    }
    if (statusIdx === -1) continue;
    if (cells.length <= statusIdx) continue;
    rows++;
    counts[leadingFamily(cells[statusIdx]) ?? NO_STATUS]++;
  }
  return { rows, counts };
}

const num = (cell) => {
  const m = stripEmphasis(cell).replace(/,/g, "").match(/^-?\d+$/);
  return m ? Number(m[0]) : null;
};

/** Parse CONFORMANCE.md's scoreboard: the two survey rows and the totals row. */
function parseScoreboard(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const head = splitCells(line);
    if (!/^survey$/i.test(stripEmphasis(head[0] ?? ""))) continue;
    if (!head.some((c) => /rows walked/i.test(c))) continue;
    const col = {};
    for (const [heading, fam] of COLUMN_FAMILY) {
      const idx = head.findIndex((c) => stripEmphasis(c).toLowerCase().startsWith(heading.toLowerCase()));
      if (idx === -1) return { error: `scoreboard has no "${heading}" column` };
      col[fam] = idx;
    }
    const rowsIdx = head.findIndex((c) => /rows walked/i.test(c));
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l.startsWith("|")) break;
      const cells = splitCells(l);
      if (isDivider(cells)) continue;
      if (cells.length < head.length) break;
      const label = stripEmphasis(cells[0]);
      const key = label === "" ? "TOTAL" : /conformance-a\.md/.test(cells[0]) ? "A" : /conformance-b\.md/.test(cells[0]) ? "B" : null;
      if (!key) return { error: `unrecognised scoreboard row: ${l.slice(0, 60)}…` };
      const counts = {};
      for (const [, fam] of COLUMN_FAMILY) counts[fam] = num(cells[col[fam]]);
      body.push({ key, rows: num(cells[rowsIdx]), counts });
    }
    return { rows: body };
  }
  return { error: "scoreboard table not found (no `| survey | … | rows walked | …` header)" };
}

function main() {
  const problems = [];
  const fail = (m) => problems.push(m);

  const read = (rel) => {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
  };

  const conf = read(CONFORMANCE);
  const surveyText = Object.fromEntries(Object.entries(SURVEYS).map(([k, v]) => [k, read(v)]));
  const missing = [
    ...(conf === null ? [CONFORMANCE] : []),
    ...Object.entries(surveyText).filter(([, t]) => t === null).map(([k]) => SURVEYS[k]),
  ];
  if (missing.length) {
    // Never pass vacuously: if the inputs are not here, the check did not happen.
    console.error(`conformance-counts: FAIL — cannot run, missing input file(s): ${missing.join(", ")}`);
    return 1;
  }

  const derived = Object.fromEntries(
    Object.entries(surveyText).map(([k, t]) => [k, deriveSurvey(t)]),
  );
  for (const [k, d] of Object.entries(derived)) {
    if (d.rows === 0) {
      console.error(`conformance-counts: FAIL — parsed 0 rows out of ${SURVEYS[k]}; the rule matched nothing, so nothing was checked.`);
      return 1;
    }
  }

  const board = parseScoreboard(conf);
  if (board.error) {
    console.error(`conformance-counts: FAIL — ${board.error} in ${CONFORMANCE}; nothing could be checked.`);
    return 1;
  }
  const byKey = Object.fromEntries(board.rows.map((r) => [r.key, r]));
  for (const key of ["A", "B", "TOTAL"]) {
    if (!byKey[key]) {
      console.error(`conformance-counts: FAIL — scoreboard has no "${key}" row; nothing could be checked.`);
      return 1;
    }
  }

  // 1. Stated per-survey cells vs the cells actually in the survey.
  for (const key of ["A", "B"]) {
    const d = derived[key];
    const s = byKey[key];
    if (s.rows !== d.rows) {
      fail(`survey ${key} (${SURVEYS[key]}): stated "rows walked" ${s.rows}, derived ${d.rows}`);
    }
    for (const [, fam] of COLUMN_FAMILY) {
      if (s.counts[fam] !== d.counts[fam]) {
        fail(`survey ${key} ${fam}: stated ${s.counts[fam]}, derived ${d.counts[fam]}`);
      }
    }
  }

  // 2. The totals row must be the column sums.
  const tot = byKey.TOTAL;
  const sumRows = derived.A.rows + derived.B.rows;
  if (tot.rows !== sumRows) fail(`totals row "rows walked": stated ${tot.rows}, derived ${sumRows}`);
  for (const [, fam] of COLUMN_FAMILY) {
    const sum = derived.A.counts[fam] + derived.B.counts[fam];
    if (tot.counts[fam] !== sum) fail(`totals row ${fam}: stated ${tot.counts[fam]}, derived ${sum}`);
  }

  // 3. The table's own arithmetic: each stated row's statuses must sum to its row count.
  for (const r of board.rows) {
    const sum = COLUMN_FAMILY.reduce((a, [, fam]) => a + (r.counts[fam] ?? 0), 0);
    if (sum !== r.rows) fail(`scoreboard row "${r.key}" does not sum: statuses total ${sum}, "rows walked" says ${r.rows}`);
  }

  if (!problems.length) {
    const fmt = (k) =>
      `${k}=${derived[k].rows} (` +
      COLUMN_FAMILY.map(([, f]) => `${f} ${derived[k].counts[f]}`).join(", ") +
      ")";
    console.log(`conformance-counts: OK — ${fmt("A")}; ${fmt("B")}; total ${sumRows}`);
    return 0;
  }

  console.error(`\nconformance-counts: FAIL — ${problems.length} stated count(s) disagree with the survey cells\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nThe scoreboard table in ${CONFORMANCE} claims numbers the surveys' status cells do not\n` +
      `support. Re-derive by the rule stated in that file (implemented in this guard) and correct\n` +
      `the table — do not adjust a status cell to make the header true.\n`,
  );
  return 1;
}

process.exit(main());
