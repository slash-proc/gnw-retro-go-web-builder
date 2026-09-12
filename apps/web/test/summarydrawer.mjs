#!/usr/bin/env node
/**
 * The summary drawer holds what `LibraryComposedSummary.dc.html` draws.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/summarydrawer.mjs'
 *
 * Two halves. The rows are real logic and come from `sources/summaryRows.ts`, so they are driven
 * through the compiled composer. The arrangement is markup and CSS, which no gate in this repo
 * can render, so it is pinned at source level -- not because that is a good test, but because
 * the alternative is nothing at all and this drawer has now been rebuilt three times.
 *
 * The board draws two columns: the per-category table on the left under "Install summary", the
 * install-time settings on the right under "Install". Stacked, as it was built, the settings
 * read as a footnote to the table rather than as the other half of what a sync will do.
 *
 * What the board draws and the build deliberately does NOT: both settings at once. `syncCores`
 * is SD-only by construction (flash always writes cores with the install) and the LZMA box is
 * disabled until compression works. The board drew one generic state; each mode shows the
 * control that is real for it.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const esbuild = await import("esbuild");
const built = (await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/summaryRows.ts")],
  bundle: true, format: "esm", write: false, platform: "neutral",
})).outputFiles[0].text;
const out = join(mkdtempSync(join(tmpdir(), "gnw-summarydrawer-")), "s.mjs");
writeFileSync(out, built);
const { composeSummaryRows, summaryRowKeys } = await import(`file://${out}`);

const SRC = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
/** Comments stripped: a note describing a rule must never stand in for the rule. */
const CODE = SRC.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// --- the rows, through the real composer ------------------------------------------------
const named = (flags) => summaryRowKeys(flags);

check("the board's six categories and the total, in the board's order", () => {
  // LibraryComposedSummary draws: Games, Homebrew, Cores, BIOS, Cover art, Cheats, Total.
  eq(named({ media: "flash", syncCores: false, hasBios: true }),
    ["games", "homebrew", "cores", "bios", "covers", "cheats", "total"],
    "the drawer's rows must be the board's rows, in the board's order");
});

check("BIOS is the only row that can be absent", () => {
  const withBios = named({ media: "flash", syncCores: false, hasBios: true });
  const without = named({ media: "flash", syncCores: false, hasBios: false });
  eq(without, withBios.filter((k) => k !== "bios"),
    "no declared slot drops the BIOS row and nothing else");
});

check("both media compose the same rows, so the branches cannot drift", () => {
  const flash = named({ media: "flash", syncCores: false, hasBios: true });
  const sd = named({ media: "sd", syncCores: true, hasBios: true });
  eq(sd, flash, "SD and Flash must summarise the same categories");
});

check("the total is last, and is the aggregate rather than a peer", () => {
  const keys = named({ media: "flash", syncCores: false, hasBios: true });
  eq(keys[keys.length - 1], "total", "the total row closes the table");
  ok(/label: locale\.t\.roms\.summary\.totalProjectedSizeLabel[^}]*total: true/s.test(CODE)
    || /total: true[^}]*totalProjectedSizeLabel/s.test(CODE),
    "the total row must carry `total: true`, which is what renders it under a divider instead of as another category");
});

check("a row the caller omits is dropped, not emitted as a hole", () => {
  const rows = { games: "g", homebrew: "h", cores: "c", bios: undefined, covers: "v", cheats: "x", total: "t" };
  eq(composeSummaryRows({ media: "flash", syncCores: false, hasBios: true }, rows),
    ["g", "h", "c", "v", "x", "t"], "an undefined row leaves no gap");
});

// --- the arrangement ---------------------------------------------------------------------

check("the drawer body is two columns, not a stack", () => {
  ok(/\.drawer-cols\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(/s.test(CODE),
    "`.drawer-cols` must stay two tracks, or the settings stack under the table");
  ok(/<div class="drawer-cols">/.test(SRC), "the drawer body must render that grid");
});

check("the settings column is wider than the board's 300px", () => {
  // The board drew the column, not the string. `Compress ROMs with LZMA` beside its checkbox
  // and its caption measures about 314px at 14px/12px, so the board's 300px wrapped a short
  // label onto a second line. The floor is what a future edit must not drop back below.
  const m = CODE.match(/\.drawer-cols\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\((\d+)px/s);
  ok(m, "the settings track must carry an explicit minimum width");
  ok(Number(m[1]) >= 330,
    `the settings track floor is ${m[1]}px; the label needs about 314px and wraps below ~330`);
});

check("each column is headed, as the board heads them", () => {
  ok(/summaryDrawerTitle/.test(SRC), "the table column keeps its `Install summary` heading");
  ok(/summary\.installHeading/.test(SRC), "the settings column must be headed `Install`");
});

check("the settings live in the right column, not under the table", () => {
  const cols = SRC.slice(SRC.indexOf('<div class="drawer-cols">'), SRC.indexOf('<div class="bar">'));
  const settings = cols.indexOf("lzmaCheckboxLabel");
  const table = cols.indexOf("summaryGridRows");
  ok(table >= 0 && settings >= 0, "both halves must be inside the drawer");
  ok(settings > table, "the settings column follows the table column in the grid");
});

check("each mode shows the control that is real for it", () => {
  // The board draws both. `syncCores` is SD-only and the LZMA box is disabled; showing both in
  // both modes would draw a control that cannot act.
  const cols = SRC.slice(SRC.indexOf('<div class="drawer-cols">'), SRC.indexOf('<div class="bar">'));
  ok(/device\.targetMedia === "sd"[\s\S]*syncCores/.test(cols), "SD shows the Retro-Go upgrade");
  ok(/\{:else\}[\s\S]*lzmaCheckboxLabel/.test(cols), "Flash shows the compression box");
});

check("the drawer still overlays; it does not resize the body", () => {
  // The owner reversed the squeeze after seeing the carousel reduced to a sliver. `.drawer` is
  // absolutely positioned, so the body underneath keeps its height whether it is open or shut.
  ok(/\.drawer\s*\{[^}]*position:\s*absolute/s.test(CODE),
    "`.drawer` must rise out of the dock rather than taking space from the body");
});

check("the drawer meets the bar, with no band of page between them", () => {
  // It was `bottom: 100%` of `.dock`, whose top edge is the HANDLE's top -- so the panel
  // stopped a handle's height short of the bar. `.docktop` is the handle's box alone, so its
  // bottom edge IS the bar's top edge, and `bottom: 0` against it lands the panel on the bar.
  ok(/\.docktop\s*\{[^}]*position:\s*relative/s.test(CODE),
    "`.docktop` must be positioned, or the drawer anchors to `.dock` and the gap comes back");
  ok(/\.drawer\s*\{[^}]*bottom:\s*0\s*;/s.test(CODE),
    "`.drawer` must anchor to `.docktop`'s bottom edge, which is the bar's top edge");
  const top = SRC.indexOf('<div class="docktop">');
  const bar = SRC.indexOf('<div class="bar">');
  ok(top >= 0 && top < SRC.indexOf('<div class="tabrow">') && top < bar,
    "the handle and the drawer must both live inside `.docktop`, above the bar");
});

check("the handle overlaps the drawer's bottom rather than displacing it", () => {
  // The handle stays in flow (so the closed state reserves its space and it never covers the
  // pane above), and is raised, so it draws OVER the panel's bottom edge.
  ok(/\.summary-tab\s*\{[^}]*z-index:\s*var\(--z-raised\)/s.test(CODE),
    "the handle must be raised, or the drawer paints over it");
  const pad = CODE.match(/\.drawer\s*\{[^}]*padding:\s*\d+px\s+var\(--page-pad-x\)\s+(\d+)px/s);
  ok(pad, "the drawer must declare its bottom padding");
  ok(Number(pad[1]) >= 38,
    `the drawer's bottom padding is ${pad[1]}px; the handle is about 34px and would cover content`);
});

check("the dock's Additional options disclosure stays gone", () => {
  const bar = SRC.slice(SRC.indexOf('<div class="bar">'));
  ok(!/additionalOptions/i.test(bar),
    "the info pane's button is the only trigger; two controls opening one thing is the duplication this removed");
});

check("the caution note is not pinned into a column that no longer has room", () => {
  ok(!/\.summary-layout\s*>\s*\.bios-missing\s*\{[^}]*position:\s*absolute/s.test(CODE),
    "a 270px absolute note inside the table column lands on the After and Change cells");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`summary drawer: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
