#!/usr/bin/env node
// The em-dash is not part of this project's UI voice. Every user-visible sentence
// says what it means with the words in it: a second clause, a second sentence, or a
// conjunction -- never a dash standing in for the connective the writer skipped.
//
// Several suites already police this inside their own area (locked-copy, nodevice,
// firstrun, statuspane). This one is the whole-table guard: it holds EVERY locale
// file in src/lib/i18n/strings/ to the rule at once, so a new area or a new locale
// cannot land a dash in a place no area suite happens to watch.
//
// Precision: this does NOT grep. It parses each file with the real TypeScript parser
// and inspects only string and template literals -- the values a user can read.
// Comments and identifiers are untouched, so a note ABOUT an em-dash (roms.ts has
// two) is not a violation, and neither is a `--flag` or a code sample.
//
// Two things are deliberately not violations:
//   1. A value that IS the dash. `"—"` alone is this project's established "no value
//      here" placeholder (deviceHeader.dash, shared.bankUnknown, overview.unknownValue,
//      and formatsize's non-finite result). It is a typographic symbol, not a skipped
//      connective.
//   2. A file listed in KNOWN_OPEN below, pinned to the exact number of dashes its
//      prose still carries. That table is now EMPTY -- every area has been rewritten --
//      and its second arm fails once a pin is stale, so a pin can never outlive the
//      prose it covers. Clearing an area means deleting its line, not editing a number
//      down; adding one is a debt to pay down, not a way past this guard.
//
// Run:  docker compose exec dev sh -c 'cd /app/apps/web && node test/copy-dashes.mjs'
// Exits non-zero on any hit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

const here = dirname(fileURLToPath(import.meta.url));
const stringsDir = join(here, "..", "src", "lib", "i18n", "strings");

const files = readdirSync(stringsDir)
  .filter((n) => n.endsWith(".ts"))
  .sort();

if (files.length === 0) {
  console.error("copy-dashes: no string tables found at " + stringsDir);
  process.exit(1);
}

// area file -> em-dashes its prose still carries. This table is EMPTY, and that is the
// finished state: every string table now says what it means without a dash. It stays
// here because it is the only sanctioned way to land a file that still has one, and
// because its stale arm is what stops a future pin from outliving the prose it covers.
// Adding an entry is a debt, not a fix -- rewrite the sentence instead.
const KNOWN_OPEN = {};

const hits = [];
const perFile = new Map();
let literals = 0;

for (const name of files) {
  const full = join(stringsDir, name);
  const src = readFileSync(full, "utf8");
  const sf = ts.createSourceFile(full, src, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals += 1;
      if (node.text.includes("—") && node.text.trim() !== "—") {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        perFile.set(name, (perFile.get(name) || 0) + 1);
        hits.push(`${name}:${line + 1}  ${node.text.trim().slice(0, 90)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const unexpected = hits.filter((h) => {
  const name = h.slice(0, h.indexOf(":"));
  return (perFile.get(name) || 0) > (KNOWN_OPEN[name] || 0);
});
const stale = Object.keys(KNOWN_OPEN).filter((name) => (perFile.get(name) || 0) < KNOWN_OPEN[name]);

let failed = false;

if (unexpected.length > 0) {
  console.error("copy-dashes: user-visible string(s) contain an em-dash:");
  for (const h of unexpected) console.error("  " + h);
  console.error("Rewrite the sentence so it works without the dash; a comma in its place is not a rewrite.");
  failed = true;
}

if (stale.length > 0) {
  console.error("copy-dashes: KNOWN_OPEN is stale -- these files now carry fewer dashes than pinned:");
  for (const name of stale) {
    console.error(`  ${name}: pinned ${KNOWN_OPEN[name]}, found ${perFile.get(name) || 0}`);
  }
  console.error("Delete the line (or lower the count) in test/copy-dashes.mjs.");
  failed = true;
}

if (failed) process.exit(1);


// --- the interpunct, in components ----------------------------------------------------------
// The middle dot (U+00B7) is the same skipped connective in another costume: "int 128 KB · ext
// 1 MB" is two labelled values wearing a separator instead of being two rows. It reached a
// component because the check above reads string tables only, and that row is an inline
// literal in markup. So this arm reads every .svelte under src/ as well.
//
// Comments are stripped first, exactly as overviewrail.mjs and titlesize.mjs do: AddSource.svelte
// carries two notes ABOUT this ban, and a guard whose own explanatory text feeds its corpus is a
// documented failure mode here.
//
// U+30FB (・) is NOT this character. It is Japanese/Korean punctuation and is correct where it
// appears (roms.ko.ts, firmwareSetup.ja.ts). Only U+00B7 is matched.

const INTERPUNCT = "\u00b7";

// Line numbers must survive the strip, or a hit points at the wrong row: a comment is replaced
// by the newlines it spanned, not deleted.
const blank = (m) => m.replace(/[^\n]/g, "");
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    // `^\s*` would swallow the blank lines ABOVE a line comment (\s matches \n), shifting every
    // number below it; `[ \t]*` keeps the strip on one line.
    .replace(/^[ \t]*\/\/.*$/gm, "");

const svelteFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full);
    else if (e.endsWith(".svelte")) svelteFiles.push(full);
  }
};
walk(join(here, "..", "src"));

if (svelteFiles.length === 0) {
  console.error("copy-dashes: no .svelte components found under src/");
  process.exit(1);
}

// Components that still carry one, pinned to their exact count. Same contract as KNOWN_OPEN
// above: a debt, not a fix. DumpSection/FlashSection join two runtime-derived figures with it;
// DetailsPane SPLITS on one it did not write. Clearing an entry means deleting its line.
const KNOWN_OPEN_DOTS = {
  "src/lib/advanced/DumpSection.svelte": 1,
  "src/lib/advanced/FlashSection.svelte": 1,
};

// PRODUCING a `\u00b7` is copy; SPLITTING on one is parsing. DetailsPane splits a device-derived
// string (`s.detail[1].split("\u00b7")`) -- that is reading what the device said, not writing what
// the user reads, and pinning it as debt would have kept a false positive alive forever in a table
// whose stale arm exists to force pins to be cleared. Being inside `<script>` is NOT the test:
// FlashSection builds rendered copy with `uniq.join(" \u00b7 ")` there.
const parsingOnly = (line) => {
  const stripped = line.replace(/\.split\(\s*(["'`])\s*\u00b7\s*\1\s*\)/g, ".split()");
  return !stripped.includes(INTERPUNCT);
};

const dotHits = [];
const perComponent = new Map();
for (const full of svelteFiles.sort()) {
  const rel = relative(join(here, ".."), full);
  const lines = stripComments(readFileSync(full, "utf8")).split("\n");
  lines.forEach((line, i) => {
    if (line.includes(INTERPUNCT) && !parsingOnly(line)) {
      perComponent.set(rel, (perComponent.get(rel) || 0) + 1);
      dotHits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  });
}

const unexpectedDots = dotHits.filter((h) => {
  const rel = h.slice(0, h.lastIndexOf(":"));
  return (perComponent.get(rel) || 0) > (KNOWN_OPEN_DOTS[rel] || 0);
});
const staleDots = Object.keys(KNOWN_OPEN_DOTS).filter(
  (rel) => (perComponent.get(rel) || 0) < KNOWN_OPEN_DOTS[rel],
);

if (unexpectedDots.length > 0) {
  console.error("copy-dashes: component markup contains an interpunct (U+00B7):");
  for (const h of unexpectedDots) console.error("  " + h);
  console.error("Two labelled values are two rows, not one row with a separator between them.");
  process.exit(1);
}

if (staleDots.length > 0) {
  console.error("copy-dashes: KNOWN_OPEN_DOTS is stale -- these components now carry fewer:");
  for (const rel of staleDots) {
    console.error(`  ${rel}: pinned ${KNOWN_OPEN_DOTS[rel]}, found ${perComponent.get(rel) || 0}`);
  }
  console.error("Delete the line (or lower the count) in test/copy-dashes.mjs.");
  process.exit(1);
}

const open = Object.values(KNOWN_OPEN).reduce((a, b) => a + b, 0);
const pinned = open === 0
  ? "nothing pinned as known-open"
  : `${open} dash(es) still pinned as known-open in ${Object.keys(KNOWN_OPEN).length} file(s)`;
console.log(
  `copy-dashes: OK - ${files.length} string table(s), ${literals} literal(s), ` +
    `${svelteFiles.length} component(s) scanned for U+00B7 (${dotHits.length} pinned); ${pinned}`,
);
