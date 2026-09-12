#!/usr/bin/env node
/**
 * Overview's rail, its Details pane and its Device log pane.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/overviewrail.mjs'
 *
 * WHY THIS EXISTS. `docs/design/proposals/overview-v2/README.md` is mostly rules a compiler
 * cannot hold: which panes exist and in which group, that log actions sit with the log rather
 * than in the page footer, that a status row is a colour and not a score, that the output panel
 * is not terminal black. Every one of those was argued for out of an owner annotation, and every
 * one of them is a single line of markup away from being quietly undone by someone who did not
 * read the README. This file is that README's teeth.
 *
 * These are source-shape assertions. The behaviour lives in `.svelte` components and every suite
 * in this repo stubs runes as identity functions, so a rendered DOM is not reachable here; if the
 * markup is restructured these must be re-read rather than trusted. That is not a hypothetical:
 * three assertions in `statuspane.mjs` pointed at `OverviewTab.svelte` and had to be repointed
 * when the rail moved their subjects into other files.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

/**
 * Source with its COMMENTS REMOVED.
 *
 * Every file here documents what it deliberately does NOT draw, by name -- the chip part number,
 * the accordion prop it dropped. A guard grepping raw source therefore finds those names in the
 * very prose explaining their absence and vouches for them, which is exactly how the first run of
 * this suite passed a mutation that reintroduced one. Ask the CODE, never the commentary.
 */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * `code()` with the import block dropped as well.
 *
 * The same trap one level down: an import SPECIFIER carries the name of the thing it imports, so
 * `import { APP_VERSION } from "../appVersion.js"` satisfies a grep for either spelling whether or
 * not a single row uses them. That is not hypothetical -- it is why the first version of the app
 * version check below passed a mutation that deleted the row outright. Ask the BODY.
 */
const body = (src) => code(src).replace(/^\s*import\s[\s\S]*?;\s*$/gm, "");

const rail = read("../src/lib/views/OverviewRail.svelte");
const tab = read("../src/lib/views/OverviewTab.svelte");
const details = read("../src/lib/ui/DetailsPane.svelte");
const devlog = read("../src/lib/ui/DeviceLogPane.svelte");
const advanced = read("../src/lib/views/Advanced.svelte");
const enRail = read("../src/lib/i18n/strings/overviewRail.ts");

// Every locale on disk, derived once for every suite -- see test/locales.mjs.
import { LOCALES } from "./locales.mjs";

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message || e}`);
  }
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (got, want, msg) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg}: got ${g}, want ${w}`);
};

// ---------------------------------------------------------------------------------------
// 1. The structure the README draws.
//
//     CONSOLE          LOGS
//       Status           Activity
//       Details          Device log
// ---------------------------------------------------------------------------------------

check("the rail has exactly the four panes, in the README's order", () => {
  const m = rail.match(/export const OVERVIEW_RAIL_IDS[^=]*=\s*(\[[^\]]*\])/);
  ok(m, "OVERVIEW_RAIL_IDS is gone -- the rail's item set is no longer declared in one place");
  eq(JSON.parse(m[1].replace(/'/g, '"')), ["status", "details", "activity", "log"], "the rail's ids");
});

check("they are in TWO groups, console then logs", () => {
  const groups = [...rail.matchAll(/items:\s*(\[[^\]]*\])/g)].map(([, a]) =>
    JSON.parse(a.replace(/'/g, '"')),
  );
  eq(groups, [["status", "details"], ["activity", "log"]], "the two rail groups");
  ok(/t\.groupConsole/.test(rail) && /t\.groupLogs/.test(rail), "the groups are unheaded");
});

check("each of the four ids actually mounts its own pane", () => {
  for (const [id, comp] of [
    ["status", "StatusPane"],
    ["details", "DetailsPane"],
    ["activity", "ActivityPane"],
    ["log", "DeviceLogPane"],
  ]) {
    ok(new RegExp(`<${comp}\\b`).test(rail), `${id} mounts no ${comp}`);
  }
});

check("the accordions it replaced are gone", () => {
  // The whole point of a single-select rail is that nothing on this tab opens or closes any
  // more. A leftover accordion would mean two navigation models on one page.
  ok(!/log-accordion/.test(code(tab)), "OverviewTab still renders the accordion stack");
  ok(!/openSet/.test(code(tab)), "OverviewTab still takes the multi-open accordion prop");
});

check("Advanced routes #info/<pane> into the rail", () => {
  ok(/OVERVIEW_RAIL_IDS/.test(advanced), "Advanced does not consult the rail's id list");
  ok(
    /tab === "info"\s*\n?\s*\?\s*overviewRail/.test(advanced) || /\?\s*overviewRail/.test(advanced),
    "the Overview pane is not written into the hash, so it cannot be deep-linked or Back'd",
  );
});

// ---------------------------------------------------------------------------------------
// 2. Colour instead of counting.
// ---------------------------------------------------------------------------------------

check("the rail's Activity marker is a dot, never a number", () => {
  // "`8/8` is a score for a checklist that is not a checklist... the rail shows a red dot beside
  // Activity only when an error is waiting." `unattended` IS the badge count, so reading it here
  // is how a number gets back onto the rail.
  ok(/auditLog\.notifications\.length > 0/.test(rail), "the dot is not driven by the error list");
  ok(
    !/auditLog\.unattended/.test(rail),
    "the rail reads the badge COUNT -- that is the score the README removed",
  );
  ok(!/act-badge/.test(rail), "the numeric badge came back onto the rail");
});

// ---------------------------------------------------------------------------------------
// 3. Log actions sit with the log, not in the page footer.
// ---------------------------------------------------------------------------------------

check("Device log puts Copy and Save on the output, and only Read in the footer", () => {
  const footer = devlog.slice(devlog.indexOf("<PaneFooter"));
  ok(footer.length > 0, "the Device log pane declares no footer at all");
  ok(/log\.readLog/.test(footer), "`Read device log` is not the footer's action");
  ok(
    !/t\.copy/.test(footer) && !/t\.save/.test(footer),
    "Copy or Save is back in the footer band, away from the thing it acts on",
  );
  const body = devlog.slice(0, devlog.indexOf("<PaneFooter"));
  ok(/t\.copy/.test(body) && /t\.save/.test(body), "Copy and Save are not on the output itself");
});

check("output comes before the actions that operate on it", () => {
  // "Output first" is the board's own ordering: reading is why anyone opened this pane.
  ok(devlog.indexOf("t.output") < devlog.indexOf("t.copy"), "the actions precede the output heading");
});

// ---------------------------------------------------------------------------------------
// 4. No terminal black.
// ---------------------------------------------------------------------------------------

check("the device-log output is the page's own sunk surface, not a dark slab", () => {
  ok(/background:\s*var\(--surface-sunk\)/.test(devlog), "the output panel lost its themed ground");
  // A hardcoded near-black is the specific regression: it is the one place this design broke its
  // own language, and it also breaks light mode, which no other gate would notice.
  const hex = [...devlog.matchAll(/#([0-9a-fA-F]{3,8})\b/g)].map(([, h]) => h.toLowerCase());
  const dark = hex.filter((h) => /^0{3,6}$/.test(h) || /^1[0-9a-f]1/.test(h));
  eq(dark, [], "a hardcoded dark background is back in the device log");
});

// ---------------------------------------------------------------------------------------
// 5. The invariants a human would otherwise re-check by eye.
// ---------------------------------------------------------------------------------------

check("no pane clips the page", () => {
  // `.tabpane` is the only general scroll container and NO other gate in this repo detects an
  // overflow:hidden clip -- svelte-check, vite build and every suite pass on a clipped page. A
  // rail with a pane column is exactly the shape that invites one.
  for (const [name, src] of [["rail", rail], ["tab", tab], ["details", details], ["devlog", devlog]]) {
    ok(!/overflow:\s*hidden/.test(src.replace(/\.screenshot-area\s*\{[^}]*\}/g, "")), `${name} clips`);
  }
});

check("no pane introduces a raw z-index or touches the page cap", () => {
  for (const [name, src] of [["rail", rail], ["tab", tab], ["details", details], ["devlog", devlog]]) {
    ok(!/z-index/.test(src), `${name} introduces a z-index outside the scale`);
    ok(!/--maxw:/.test(src), `${name} redefines the global page width cap`);
  }
});

check("the copy rules hold in the new strings", () => {
  ok(!/·/.test(enRail), "an interpunct separator is back in the copy");
  ok(!/—/.test(enRail), "an em-dash is back in the copy");
});

check("an empty or unpatched bank still offers its next step", () => {
  // THE REGRESSION THIS EXISTS FOR. The bank cards moved from OverviewTab into Details and the
  // prompts did not come with them, so a device with an empty bank silently lost its route to
  // guided setup. Nothing caught it except an orphaned-string scan noticing the copy was now
  // unreferenced, which is a very indirect way to learn that a feature is gone.
  const c = code(details);
  ok(/const bankPrompt =/.test(c), "the per-bank next step is gone -- an empty bank offers nothing");
  ok(/goPrompt/.test(c), "nothing routes the prompt anywhere, so the offer is inert");
  // Each of the four offers is a distinct artboard's answer; a collapsed set means one state
  // started borrowing another's copy.
  for (const k of ["guidedSetup", "installStock", "patchStock", "installRetroGo"]) {
    ok(new RegExp(`bankEmpty\\.${k}`).test(c), `the ${k} offer is gone`);
  }
  // Stock firmware only ever boots from bank 1 (0x08000000), so the install-stock offer belongs
  // to bank 1 alone -- NoStockBank1.dc.html deliberately offers nothing on an empty bank 2.
  ok(
    /n === 1 \? \{ label: ov\.bankEmpty\.installStock/.test(c),
    "install-stock is no longer restricted to bank 1, where stock actually boots from",
  );
  // And a free bank on a fully-populated device is a free slot, not a missing step.
  ok(
    /\/\/ Stock firmware AND an app already installed/.test(details),
    "the no-prompt-when-everything-is-installed case lost its reasoning",
  );
  // The footer only appears when there IS something to show; gating it on bootability alone is
  // exactly how the prompts got dropped, since an empty bank is never bootable.
  ok(
    /bank1Bootable \|\| bank1Prompt/.test(c),
    "the bank footer is gated on bootability alone, so an empty bank draws no prompt",
  );
});

check("Details draws no invented value where the app has no data", () => {
  // The board's Storage section and its chip part number are absent BECAUSE the data does not
  // exist -- see the file's header for why the JEDEC id cannot be read from the host at all. A
  // future edit that fills either in from nothing is the failure this catches.
  ok(!/MX25U/.test(code(details)), "a chip part number is hardcoded -- nothing reads the JEDEC id");
  // Naming the part from the capacity is the tempting wrong answer, because `flash.size` IS
  // derived from the matched JEDEC row. It is not reversible: eight rows in gnwmanager's table
  // are 64 MB across six distinct part names.
  ok(
    !/externalFlashSizeMiB[\s\S]{0,200}(MX|W25Q|S25FS|IS25)/.test(code(details)),
    "a part name is being inferred from the flash size, which does not identify a part",
  );
});

// This check's other half used to assert the OPPOSITE -- that no app version was drawn -- because
// every package.json in the repo was 0.0.0 and the row would have printed a placeholder as though
// it were a fact. That premise is gone: the packages carry a real version and `vite.config.ts`
// bakes it into the bundle, so the row is now the honest thing and its ABSENCE would be the bug.
check("Details draws the app's own version, from the build rather than a literal", () => {
  ok(
    /label:\s*t\.appVersion/.test(body(details)),
    "the App version row is gone from the Details pane",
  );
  ok(
    /label:\s*t\.appVersion,\s*value:\s*APP_VERSION\b/.test(body(details)),
    "the version is not read from the build constant, so it is a literal that will go stale",
  );
  ok(
    !/["'`]\d+\.\d+\.\d+/.test(code(details)),
    "a version literal is hardcoded in the pane instead of coming from package.json",
  );
});

// ---------------------------------------------------------------------------------------
// 6. Seven locales, none of them English-by-copy-paste.
// ---------------------------------------------------------------------------------------

/** `key: "value",` pairs at one indent level, which is the whole shape of this area file. */
const pairsOf = (src) => new Map([...src.matchAll(/^\s{2}(\w+): "([^"]*)",$/gm)].map(([, k, v]) => [k, v]));

check("the English area file has its keys", () => {
  ok(pairsOf(enRail).size >= 12, "the overviewRail English table lost its keys");
});

// Words that are legitimately identical across languages. `Adapter` is the same in German and
// Polish; `Details` is the same in German; `Sources`/`Console` coincide in French. Anything else
// matching English means the file was filled with English to silence the compiler.
const SAME_OK = {
  de: new Set(["details", "adapter"]),
  es: new Set([]),
  fr: new Set(["groupConsole", "sources"]),
  // `Console` and `Output` are the words Italian tech writing actually uses.
  it: new Set(["groupConsole", "output"]),
  ja: new Set([]),
  ko: new Set([]),
  pl: new Set(["adapter"]),
  // Nothing in this area coincides with English in Russian: every value is Cyrillic.
  ru: new Set([]),
  // Nothing in the Portuguese rail coincides with English, including `Adapter`
  // ("Adaptador") and `Details` ("Detalhes").
  pt: new Set([]),
  no: new Set(["adapter"]),
  // Nothing in this pane legitimately stays English in either Chinese script.
  "zh-Hans": new Set([]),
  "zh-Hant": new Set([]),
  // Every Ukrainian value here is Cyrillic.
  uk: new Set([]),
};
/**
 * An unlisted locale gets the EMPTY allowlist, never a crash.
 *
 * `SAME_OK` is a per-locale table like the ones `locales.mjs` replaced, and it cannot be derived:
 * which words legitimately coincide with English is editorial, per language. But indexing it
 * directly meant the first locale added without an entry died with `Cannot read properties of
 * undefined (reading 'has')`, which says nothing about what is wrong -- and seven locales landed
 * at once. Defaulting cannot weaken the rule: the empty set is the strictest case, so an unlisted
 * locale is held to "no value may equal the English", which is what a new translation should
 * satisfy anyway. A locale that genuinely shares a word adds its entry above and says why.
 */
const sameOkFor = (code) => SAME_OK[code] ?? new Set();

for (const code of LOCALES) {
  check(`${code} is a real translation`, () => {
    const src = read(`../src/lib/i18n/strings/overviewRail.${code}.ts`);
    const mine = pairsOf(src);
    const en = pairsOf(enRail);
    ok(mine.size > 0, `${code}: the file has no string values`);
    for (const [k, v] of en) {
      ok(mine.has(k), `${code}: missing key ${k}`);
      if (!sameOkFor(code).has(k)) {
        ok(mine.get(k) !== v, `${code}: ${k} is still the English string ("${v}")`);
      }
    }
    ok(!/·/.test(src) || code === "ja" || code === "ko", `${code}: interpunct in copy`);
    ok(!/—/.test(src), `${code}: em-dash in copy`);
  });
}

check("the area is wired into all seven assemblers", () => {
  for (const code of ["en", ...LOCALES]) {
    const src = read(`../src/lib/i18n/${code}.ts`);
    ok(/overviewRail:/.test(src), `${code}.ts does not register overviewRail`);
  }
});

// ---------------------------------------------------------------------------------------

if (failures.length) {
  console.log(`overview rail: ${failures.length} FAILED of ${passed + failures.length}`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`overview rail: ${passed} checks passed`);
