#!/usr/bin/env node
/**
 * The product's word for a downloadable emulator or game engine is "core", not "emulator".
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/core-vocabulary.mjs'
 *
 * The owner renamed it across the UI in all seven locales. The rename is easy to undo by
 * accident, because "emulator" survives legitimately in three places and a careless sweep
 * either misses a value or eats an identifier:
 *
 *   1. THE WIRE VALUE. `kind: "emulator"` is what lagging publishers still send, and
 *      `isCoreKind()` (`sources/types.ts`) is the ONE place that accepts it, with a documented
 *      sunset. Its comments, and the fixtures that feed it that literal, must keep the old
 *      spelling -- rewriting them would delete the shim's only test coverage.
 *   2. THE DEFINITION. `coresSubtitle` says a core IS an emulator or a game engine. It is the
 *      only place the old word may appear in a VALUE, and it must, or the rename teaches a
 *      newcomer nothing -- "emulator" was guessable where "core" is libretro jargon.
 *   3. THE OWNER'S OWN WORDS. `sources/autoDownload.ts` quotes his instruction verbatim.
 *      A quote is not prose to be tidied.
 *
 * So the VALUE sweep exempts the definition BY KEY NAME rather than by a pattern that would
 * also wave through a real reversion.
 *
 * IDENTIFIERS ARE POLICED TOO, as of the rename that finished this move. Key names used to be
 * exempt here -- `colEmulators`, `regionEmulatorsSaves` and friends kept the old spelling
 * while their values already said "Cores", so the code contradicted itself and every reader
 * had to learn both words. They are renamed now, and the second half of this guard is what
 * stops them drifting back. It reads the whole of `src/`, not just the string tables.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strings = join(here, "../src/lib/i18n/strings");

/** Keys whose VALUE may legitimately still name an emulator. Exempt by name, never by shape. */
const DEFINES_THE_WORD = new Set(["coresSubtitle"]);

/** Word forms for the concept, per locale, as the seven tables actually spell it. */
const FORMS = [
  /[Ee]mulator[a-zé]*/,                 // en / de / pl
  /[Ee]mulador[a-z]*/,                  // es
  /[ÉéEe]mulateur[a-z]*/,               // fr
  /エミュレータ[ー]?/,                    // ja
  /에뮬레이터/,                           // ko
  /[\u0415\u0435\u042d\u044d]\u043c\u0443\u043b[\u044f\u044e]\u0442\u043e\u0440[\u0430-\u044f\u0456\u0457\u0454\u0491\u0451]*/,
  / uk /,
  /模擬器/,
  /[\u042d\u044d]\u043c\u0443\u043b\u044f\u0442\u043e\u0440[\u0430-\u044f]*/,
  /模拟器/,
  // ar -- "\u0645\u062d\u0627\u0643\u064a" plus its inflections ("\u0645\u062d\u0627\u0643\u064a\u0627\u062a", "\u0627\u0644\u0645\u062d\u0627\u0643\u064a"). Arabic attaches the
  // article and the plural to the stem rather than spacing them, so the tail is open.
  /\u0645\u062d\u0627\u0643\u064a[\u0621-\u064a]*/,
];

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message || e}`); } };

const files = readdirSync(strings).filter((f) => f.endsWith(".ts")).sort();
if (files.length < 40) {
  console.error(`core-vocabulary: only ${files.length} string tables found -- the layout changed, fix this guard`);
  process.exit(1);
}

/**
 * Every `key: "value"` / `key: \`value\`` on one line, plus the value halves of the multi-line
 * arrow-function entries (a line with no `key:` that still carries a quoted run). Comments are
 * stripped first so prose about emulators never trips this.
 */
function valuesOf(src) {
  const out = [];
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "");
    if (!line.trim() || line.trim().startsWith("*") || line.trim().startsWith("/*")) continue;
    const key = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    const name = key ? key[1] : null;
    if (name && DEFINES_THE_WORD.has(name)) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      out.push({ name, text: m[1] ?? m[2] ?? "" });
    }
  }
  return out;
}

const offenders = [];
for (const f of files) {
  const src = readFileSync(join(strings, f), "utf8");
  for (const { name, text } of valuesOf(src)) {
    for (const re of FORMS) {
      const hit = text.match(re);
      if (hit) { offenders.push(`${f}${name ? ":" + name : ""} -> ${JSON.stringify(hit[0])} in ${JSON.stringify(text)}`); break; }
    }
  }
}

check("no locale still calls a core an emulator", () => {
  if (offenders.length) {
    throw new Error(`the product word is "core"; these VALUES still say emulator:\n    ` + offenders.join("\n    "));
  }
});

// The definition is the whole reason the rename is safe for a newcomer. If it stops naming the
// familiar word, the rename has quietly become jargon-for-jargon and this guard is the only
// thing that would notice.
for (const f of files.filter((x) => x.startsWith("sources."))) {
  check(`${f} defines what a core is`, () => {
    const src = readFileSync(join(strings, f), "utf8");
    const m = src.match(/^\s*coresSubtitle:\s*"((?:[^"\\]|\\.)*)"/m);
    if (!m) throw new Error("no coresSubtitle -- the definition the rename depends on is gone");
    if (!FORMS.some((re) => re.test(m[1]))) {
      throw new Error(`defines "core" without naming an emulator, so it teaches nothing: ${JSON.stringify(m[1])}`);
    }
  });
}

// ---------------------------------------------------------------------------------------
// IDENTIFIERS. The half that used to be exempt.
//
// Walks every .ts/.svelte under src/ and fails on an identifier-shaped `emulator` token —
// `colEmulators`, `isEmulator`, `bundleEmulatorCount`. Comments are NOT stripped: prose that
// calls a core an emulator is the same regression wearing a different hat, and the three
// legitimate survivors are listed by file below rather than waved through by a pattern.
//
// Exempt by PATH, deliberately. A regex broad enough to spare the shim's explanation would
// also spare a real reversion sitting next to it.
const SHIM_AND_QUOTES = new Set([
  // The shim itself: declares `SourceKind`, accepts the pre-rename wire value, documents the
  // sunset. The old spelling here IS the feature.
  "lib/sources/types.ts",
  // Each cites the shim by name to explain why it does not compare against a literal.
  "lib/sources/inputGate.ts",
  "lib/sources/converterTypes.ts",
  "lib/sources/homebrewTitles.svelte.ts",
  "lib/sources/store.svelte.ts",
  // Quotes the owner's instruction verbatim.
  "lib/sources/autoDownload.ts",
  // Names the rename as an event ("until the Emulator/Core rename").
  "lib/views/Sources.svelte",
  // Fixtures feeding `isCoreKind` the pre-rename literal — the shim's only coverage.
  "lib/sources/test/validate.mjs",
]);

/**
 * The three survivors, exempt by the exact text that makes each legitimate rather than by
 * file — an exemption wide enough to spare a whole file would spare a reversion inside it.
 *
 *   1. The DEFINITION. `coresSubtitle` and the comment above it say a core IS an emulator or
 *      a game engine. It is the one place the old word must appear, or the rename teaches a
 *      newcomer nothing. The value sweep above already exempts it by key name.
 *   2. Retro-Go's own C API. `add_emulator()` in `rg_emulators.c` is a real symbol in a real
 *      file; renaming a citation would make it false.
 */
const LEGITIMATE = [
  /coresSubtitle:/,                       // the definition itself, every locale
  /the word is libretro jargon where/,    // its explanation, line 1
  /"emulator" was guessable/,             // its explanation, line 2
  /names both halves the term covers/,    // its explanation, line 3
  /or a game engine \(doom, openlara\)/,  // its explanation, line 4
  /add_emulator\(|rg_emulators\.c/,       // Retro-Go's C API
];

/** `spec/07-emulators.md` was renamed to `07-cores.md` upstream; a citation of it is stale. */
const STALE_SPEC = /07-emulators\.md/;

const srcRoot = join(here, "../src");
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|svelte|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

const srcFiles = walk(srcRoot);
if (srcFiles.length < 100) {
  console.error(`core-vocabulary: only ${srcFiles.length} source files found -- the layout changed, fix this guard`);
  process.exit(1);
}

const idOffenders = [];
const staleSpec = [];
for (const full of srcFiles) {
  const rel = full.slice(srcRoot.length + 1);
  const src = readFileSync(full, "utf8");
  if (STALE_SPEC.test(src)) staleSpec.push(rel);
  if (SHIM_AND_QUOTES.has(rel)) continue;
  // The i18n tables are covered by the VALUE sweep above; here we want their key names.
  src.split("\n").forEach((line, i) => {
    if (LEGITIMATE.some((re) => re.test(line))) return;
    const m = line.match(/[A-Za-z_$]*[eE]mulator[A-Za-z_$]*|Emulatoren|Emulatory/);
    if (m) idOffenders.push(`${rel}:${i + 1} -> ${JSON.stringify(m[0])}`);
  });
}

check("no identifier or comment in src/ still says emulator", () => {
  if (idOffenders.length) {
    throw new Error(
      `the code's word is "core" too, not just the copy; ${idOffenders.length} left:\n    ` +
        idOffenders.slice(0, 25).join("\n    "),
    );
  }
});

check("no stale citation of the spec's pre-rename filename", () => {
  if (staleSpec.length) {
    throw new Error(`spec/07-emulators.md is now 07-cores.md; still cited by:\n    ` + staleSpec.join("\n    "));
  }
});


// ---------------------------------------------------------------------------------------
// THE LIBRARY. The product's word for the tab where you assemble and install your games is
// "Library", not "ROMs". The owner renamed it across all seven locales.
//
// "ROM" is NOT always the tab. A ROM is still a file on disk, and the copy about picking a
// folder of them, counting them, compressing them or failing to find one is correct as it
// stands. So the sweep below allows the word BY KEY NAME, with the reason each is about a
// file rather than about the tab -- a pattern loose enough to spare "ROM file" would also
// spare "Manage ROMs".

/** Locale spellings of the tab's name. */
const LIBRARY_FORMS = [/[Ll]ibrar[a-z]*/, /[Bb]iblioth[eèé]k?[a-z]*/, /[Bb]ibliotek[a-z]*/, /[Bb]iblioteca/, /ライブラリ/, /라이브러리/, /[\u0411\u0431][\u0456\u0438]\u0431\u043b[\u0456\u0438]\u043e\u0442\u0435\u043a[\u0430-\u044f\u0456\u0457\u0454\u0491\u0451]*/, /遊戲庫/, /[\u0411\u0431]\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a[\u0430-\u044f]*/, /[Ll]ibreri[ao]/, / it -- "Libreria", the word Steam/, /游戏库/, /\u0645\u0643\u062a\u0628[\u0621-\u064a]*/];
/** Locale spellings of the file word, including the Polish declensions. */
const ROM_FORMS = [/ROM/, /\brom\b/];

/** Keys that NAME the tab. Each must say Library in its locale, and must not say ROM. */
const NAMES_THE_TAB = ["tabRoms", "continueButtonLabel", "addRoms", "manageLibraryDesc"];

/**
 * Keys whose value may keep the word, because it is about a FILE or a FOLDER of files, or
 * about a firmware image, and not about the tab.
 */
const ABOUT_FILES = new Map([
  ["romFolderTitle", "names the folder of files the user picks"],
  ["romFolderHint", "describes that folder's contents"],
  ["errFirmwareMismatch", "the stock firmware image, not the tab"],
  ["errDumpedFirmwareMismatch", "the stock firmware image, not the tab"],
  ["logSdCacheBoundarySet", "the SD round-robin cache of game files, in a log line"],
  ["railRoms", "the Sources rail's local-folder KIND, sibling of Homebrew and Cache"],
  ["romsMatched", "counts files matched in a folder"],
  ["oneRomMatched", "counts files matched in a folder"],
  ["noRoms", "counts files matched in a folder"],
  ["noRomFolder", "no folder of files picked"],
  ["addRomsTitle", "adds a FOLDER of files"],
  ["configureRomsTitle", "configures a FOLDER of files"],
  ["body", "Firefox cannot write covers next to the files on disk"],
  ["gateBody", "asks for the folder of files"],
  ["actionMissingRom", "this game's file is absent"],
  ["lzmaCheckboxLabel", "compresses the files, not the tab"],
  ["errRomNotFound", "a file was not found"],
  ["saveToRomsFolder", "writes covers into the folder of files"],
  ["saveToRomsFolderFirefoxNote", "same folder, Firefox caveat"],
  ["catRoms", "the SD card's contents BUCKET, a directory of files, sibling of Homebrew and BIOS"],
]);

const tabOffenders = [];
const strayRom = [];
for (const f of files) {
  const src = readFileSync(join(strings, f), "utf8");
  for (const { name, text } of valuesOf(src)) {
    if (name && NAMES_THE_TAB.includes(name)) {
      if (ROM_FORMS.some((re) => re.test(text)))
        tabOffenders.push(`${f}:${name} still says ROM: ${JSON.stringify(text)}`);
      else if (!LIBRARY_FORMS.some((re) => re.test(text)))
        tabOffenders.push(`${f}:${name} does not name the Library: ${JSON.stringify(text)}`);
      continue;
    }
    if (name && ABOUT_FILES.has(name)) continue;
    const hit = ROM_FORMS.map((re) => text.match(re)).find(Boolean);
    if (hit) strayRom.push(`${f}${name ? ":" + name : ""} -> ${JSON.stringify(hit[0])} in ${JSON.stringify(text)}`);
  }
}

check("the tab is called Library in every locale", () => {
  if (tabOffenders.length) throw new Error(`the tab's name is "Library":\n    ` + tabOffenders.join("\n    "));
});

check("no unlisted string says ROM", () => {
  if (strayRom.length) {
    throw new Error(
      `either this is about the Library tab and must be renamed, or it is about a file and ` +
        `belongs in ABOUT_FILES with a reason:\n    ` + strayRom.join("\n    "),
    );
  }
});

if (failures.length) {
  console.error(`core-vocabulary: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  x " + f);
  process.exit(1);
}
console.log(`core-vocabulary: ${passed} checks passed (${files.length} string tables)`);
