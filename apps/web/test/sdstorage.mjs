#!/usr/bin/env node
/**
 * What the SD card holds, and what this app refuses to claim about it.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/sdstorage.mjs'
 *
 * WHY THIS EXISTS. `Details.dc.html` draws Storage with a capacity and a free-space legend.
 * There is no browser API that reports a picked directory's volume size, so those two figures
 * cannot be measured, only invented -- and `navigator.storage.estimate()` is the specific wrong
 * turn available here, because it returns a real number about the wrong thing (this origin's
 * quota) and would therefore pass any check that only asked "is a number present".
 *
 * So the load-bearing assertions in this file are NEGATIVE: nothing fabricates a capacity, and
 * the one total that exists is used bytes. The positive half drives the real walker against a
 * fake handle -- no browser, no device, no card -- because bucketing is a decision and deserves
 * to be exercised rather than described.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const src = read("../src/lib/sdStorage.svelte.ts");
/** Comments describe the traps; matching them would let a file vouch for itself. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let checks = 0;
const failures = [];
const ok = (cond, label) => {
  checks++;
  if (!cond) failures.push(label);
};
const eq = (got, want, label) =>
  ok(got === want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
process.on("uncaughtException", report);
process.on("unhandledRejection", report);

// --- Build the store so the walker runs for real ----------------------------------------------
const out = mkdtempSync(join(tmpdir(), "sdstorage-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sdStorage.svelte.ts")],
  outfile: join(out, "sdStorage.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  // The house stub: runes become the identity function, which is why nothing here can observe
  // reactivity and why section 3 asserts the effect hazard as source shape rather than running it.
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  plugins: [gnwResolveFor(import.meta.url)],
});
const {
  walkSdUsage,
  SD_CATEGORIES,
  SD_CATCH_ALL,
  sortedCategories,
  cardDisplayName,
  UNNAMED_CARD,
  MAX_ENTRIES,
  MAX_DEPTH,
} = await import(pathToFileURL(join(out, "sdStorage.js")).href);

/** The roles `deviceInstallPaths()` resolves to before any manifest is seen. */
const PATHS = {
  cores: "cores",
  homebrew: "roms/homebrew",
  bios: "bios",
  roms: "roms",
  covers: "covers",
  cheats: "cheats",
  data: "data",
  extra: {},
};

/** A directory handle over a plain `{ "path/to/file": bytes }` object. */
function fakeCard(files, name = "GNW-SD") {
  const build = (prefix) => {
    const dirs = new Map();
    const here = [];
    for (const [path, size] of Object.entries(files)) {
      if (prefix !== "" && !path.startsWith(prefix + "/")) continue;
      const rest = prefix === "" ? path : path.slice(prefix.length + 1);
      const slash = rest.indexOf("/");
      if (slash < 0) here.push([rest, size]);
      else dirs.set(rest.slice(0, slash), true);
    }
    return {
      kind: "directory",
      name: prefix === "" ? name : prefix.slice(prefix.lastIndexOf("/") + 1),
      async *entries() {
        for (const [fname, size] of here) {
          yield [
            fname,
            {
              kind: "file",
              name: fname,
              getFile: async () =>
                size === "throw" ? Promise.reject(new Error("unreadable")) : { size },
            },
          ];
        }
        for (const d of dirs.keys()) yield [d, build(prefix === "" ? d : prefix + "/" + d)];
      },
    };
  };
  return build("");
}

// --- 1. Nothing fabricates a capacity ---------------------------------------------------------
// The whole point of the module. `estimate()` is checked by name because it is the plausible
// wrong answer: it returns a real number, so a check that only looked for "a capacity field"
// would pass while the pane printed the browser profile's quota beside "SD card".
ok(!/storage\s*\.\s*estimate/.test(code), "no navigator.storage.estimate(): that is the origin's quota, not the card");
ok(!/\bquota\b/.test(code), "no quota is read");
ok(!/\bcapacity\b/i.test(code), "no capacity field is produced");
ok(!/\bfree\b/i.test(code), "no free-space figure is produced");
// `total` must be reachable only as a sum of the buckets. A total that came from anywhere else
// would be a denominator, which is the thing that cannot exist here.
ok(
  /const total = SD_CATEGORIES\.reduce\(\(n, c\) => n \+ bytes\[c\], 0\)/.test(code),
  "the only total is the sum of the measured buckets",
);

// --- 2. Metadata only ------------------------------------------------------------------------
// `romScan.ts`'s walk reads every file's bytes. Doing that here would load a 32 GB card into RAM.
ok(!/arrayBuffer|\.text\(\)|\.stream\(\)|slice\(/.test(code), "the walk never reads file contents");
ok(/getFile\(\)\)\.size/.test(code), "sizes come from File metadata");

// --- 3. The reactivity hazard, which no rune-stubbing suite can catch at runtime --------------
// `refresh()` sets `busy` before its first await; a `$state` flag there makes a tracked effect
// that calls it depend on what it sets, and re-run forever.
ok(/private busy = false;/.test(code), "the in-flight flag is a plain field");
ok(!/busy\s*=\s*\$state/.test(code), "the in-flight flag is not reactive");

// --- 4. Bucketing, exercised ------------------------------------------------------------------
const card = fakeCard({
  "roms/nes/mario.nes": 100,
  "roms/gb/zelda.gb": 200,
  "roms/homebrew/celeste.bin": 50,
  "covers/nes/mario.img": 10,
  "covers/homebrew/celeste.img": 5,
  "data/nes/mario.sav": 1000,
  "cores/nes.bin": 7,
  "bios/msx.rom": 3,
  "cheats/nes/mario.ggcodes": 1,
  "stray.txt": 9,
});
const u = await walkSdUsage(card, PATHS);
eq(u.bytes.roms, 300, "roms is the roms role without the legacy homebrew directory inside it");
eq(u.bytes.homebrew, 50, "homebrew is its own bucket, no longer merged into games");
eq(u.bytes.covers, 15, "covers is the covers role");
eq(u.bytes.saves, 1000, "saves is the data role, which is what the firmware calls ODROID_BASE_PATH_SAVES");
eq(u.bytes.bios, 3, "bios has its own bucket now; the role existed all along and was never tested");
eq(u.bytes.other, 17, "cores, cheats and loose files are other; bios has left it");
eq(u.total, 1385, "the total is every byte walked");
eq(u.files.roms, 2, "files are counted per bucket");
eq(u.files.homebrew, 1, "homebrew counts its own files");
eq(u.folderName, "GNW-SD", "the card label is the picked folder's own name");
eq(u.truncated, false, "a card inside the limits is not truncated");
eq(u.truncatedBy, null, "a complete walk names no cause");

// Every walked byte lands somewhere: a bucket that silently dropped bytes would make the bar
// lie about proportions even though no single figure was invented.
eq(SD_CATEGORIES.reduce((n, c) => n + u.bytes[c], 0), u.total, "the buckets account for the total");

// HOMEBREW IS A PEER OF ROMS. The live manifest says `"homebrew": "/homebrews"`, a sibling of
// `/roms`; what is nested is `DEFAULT_INSTALL_PATHS.homebrew`, `roms/homebrew`, the literal used
// before the manifest existed and still present on a card written by an older firmware. An
// earlier version of this block asserted the nested layout as the general rule, using a fixture
// that only ever set the legacy paths -- so the live layout was never walked and the bug below
// was invisible to every check in this file.
//
// `homebrewDirs()` is the repo's existing answer: the manifest's directory plus the pre-manifest
// default whenever they differ, because "a read must recognise both or that content goes
// invisible". Both layouts are therefore walked here, under the LIVE paths.
const LIVE_PATHS = { ...PATHS, homebrew: "homebrews" };
const hb = await walkSdUsage(
  fakeCard({ "homebrews/celeste.bin": 42, "roms/homebrew/oldgame.bin": 8, "roms/nes/m.nes": 5 }),
  LIVE_PATHS,
);
eq(hb.bytes.homebrew, 50, "both homebrew directories count as homebrew, the manifest's and the legacy one");
eq(hb.bytes.roms, 5, "the legacy homebrew directory is NOT counted as roms, which is what reading only paths.homebrew did");
eq(hb.bytes.other, 0, "neither homebrew directory is stray");

// The nested legacy directory still has to beat `roms` on prefix order, which is the ordering
// the longest-prefix rule actually protects now that the manifest's own directory is a peer.
const hbLegacy = await walkSdUsage(fakeCard({ "roms/homebrew/celeste.bin": 42 }), PATHS);
eq(hbLegacy.bytes.homebrew, 42, "the legacy directory is nested under roms and must be tested first");
eq(hbLegacy.bytes.roms, 0, "the nested directory does not ALSO count as roms");
eq(hbLegacy.bytes.other, 0, "a nested directory is not stray");

// --- 4b. The five buckets that did not exist -------------------------------------------------
// Each lands somewhere real rather than in `other`, which is where every one of them went
// before. A file per bucket, so a branch that never fires cannot pass by being unexercised.
const nine = await walkSdUsage(
  fakeCard({
    "bios/msx.rom": 1,
    "covers/nes/a.img": 2,
    "fonts/big.bin": 4,
    "font/small.bin": 8,
    "roms/homebrew/c.bin": 16,
    "lang/de_de.bin": 32,
    "roms/nes/a.nes": 64,
    "data/a.sav": 128,
    "screenshots/2026-01-01-a.bmp": 256,
    "cores/nes.bin": 512,
  }),
  PATHS,
);
eq(nine.bytes.bios, 1, "bios/ is its own bucket");
eq(nine.bytes.covers, 2, "covers/ is its own bucket");
// The firmware routes BOTH spellings (`is_frogfs_path` lists "fonts" and "font" separately),
// so a bucket matching only the plural drops whatever the singular holds into `other`.
eq(nine.bytes.fonts, 12, "fonts/ AND font/ both count as Fonts");
eq(nine.bytes.homebrew, 16, "roms/homebrew is Homebrew");
eq(nine.bytes.language, 32, "lang/ is Language, reusing flashImage.ts's documented literal");
eq(nine.bytes.roms, 64, "roms/ is ROMs");
eq(nine.bytes.saves, 128, "data/ is Saves");
eq(nine.bytes.screenshots, 256, "screenshots/ is Screenshots, which only the firmware writes");
eq(nine.bytes.other, 512, "cores/ is a declared role that is deliberately not among the nine");

// --- 4c. The display order is a RULE, not a list ----------------------------------------------
// Alphabetical by LABEL with the catch-all pinned last. Sorting the ids would put `language`
// under L by accident and `roms` under R by accident; sorting the labels is what makes `lang/`
// display as Language and sort under L on purpose.
const EN = {
  bios: "BIOS", covers: "Covers", fonts: "Fonts", homebrew: "Homebrew", language: "Language",
  roms: "ROMs", saves: "Saves", screenshots: "Screenshots", other: "Other",
};
eq(
  sortedCategories(EN, "en").join(","),
  "bios,covers,fonts,homebrew,language,roms,saves,screenshots,other",
  "English sorts alphabetically with Other last",
);
eq(sortedCategories(EN, "en").at(-1), SD_CATCH_ALL, "the catch-all is pinned last, not sorted into O");
// The real point: a different locale's words sort differently, and a hardcoded English array
// would ship a list that looks arbitrary in fourteen languages.
const DE = { ...EN, saves: "Spielstaende", screenshots: "Bildschirmfotos", covers: "Titelbilder" };
eq(
  sortedCategories(DE, "de").join(","),
  "screenshots,bios,fonts,homebrew,language,roms,saves,covers,other",
  // Bildschirmfotos before BIOS: the third letter decides (l < o), which is precisely the kind
  // of answer a hardcoded English array cannot produce and a human writing the list gets wrong.
  // This expectation was wrong on the first pass and the check caught it.
  "German sorts ITS OWN words: Bildschirmfotos early, Titelbilder late",
);
// An accented label must not sort after every ASCII one, which is what `<` on UTF-16 code units
// would do and what makes `localeCompare` load-bearing rather than decorative.
const ACC = { ...EN, bios: "Zulu", covers: "Ärger" };
eq(sortedCategories(ACC, "de")[0], "covers", "an accented label sorts by the locale, not by code unit");

// A manifest may move a role. What counts as Covers must follow the manifest, not a literal.
const moved = await walkSdUsage(fakeCard({ "art/mario.img": 11, "covers/mario.img": 22 }), {
  ...PATHS,
  covers: "art",
});
eq(moved.bytes.covers, 11, "the covers bucket follows the manifest's role, not the word 'covers'");
eq(moved.bytes.other, 22, "the old location is no longer privileged once the role moves");

// --- 5. An empty card is a real answer, and is not the same as no card ------------------------
const empty = await walkSdUsage(fakeCard({}), PATHS);
eq(empty.total, 0, "an empty card totals zero");
eq(empty.truncated, false, "an empty card is a complete answer");

// --- 6. A partial walk says it is partial -----------------------------------------------------
// A floor presented as a total is the same class of error as an invented capacity.
const many = {};
for (let i = 0; i < MAX_ENTRIES + 10; i++) many[`roms/nes/g${i}.nes`] = 1;
const big = await walkSdUsage(fakeCard(many), PATHS);
eq(big.truncated, true, "hitting the entry limit sets truncated");
eq(big.truncatedBy, "entries", "the entry limit names itself");
ok(big.bytes.roms <= MAX_ENTRIES, "a truncated walk reports a floor, not a guess at the rest");

let deep = "a";
for (let i = 0; i < MAX_DEPTH + 3; i++) deep += "/a";
const deepCard = await walkSdUsage(fakeCard({ [deep + "/f.bin"]: 5 }), PATHS);
eq(deepCard.truncated, true, "hitting the depth limit sets truncated");
eq(deepCard.truncatedBy, "depth", "the depth limit names itself, and is NOT reported as too many files");

// One unreadable file must not lose the rest, and must not silently shrink the total.
const partial = await walkSdUsage(
  fakeCard({ "roms/nes/a.nes": 100, "roms/nes/b.nes": "throw" }),
  PATHS,
);
eq(partial.bytes.roms, 100, "an unreadable file does not abort the walk");
eq(partial.truncated, true, "an unreadable file makes the total a floor, and says so");
eq(partial.truncatedBy, "file", "an unreadable file names itself, and is NOT reported as too many files");

// WHY THE CAUSE MATTERS. The owner's string is "Too many files on SD card. Unable to calculate
// more than 40,000 files". Two of the three causes are not that, and a pane that tells a user to
// delete files over a deep tree or one unreadable file is sending them after the wrong thing.
ok(
  new Set([big.truncatedBy, deepCard.truncatedBy, partial.truncatedBy]).size === 3,
  "the three causes are distinguishable, so a pane need not guess which happened",
);

// FIRST cause wins. Once a walk is bounded, the later stops are consequences of the first one
// rather than independent findings, so the cause reported has to be the one that actually
// ended it. `fakeCard` yields a directory's files before its subdirectories, so the unreadable
// file at the root is reached before the deep tree below it.
let deeper = "d";
for (let i = 0; i < MAX_DEPTH + 3; i++) deeper += "/d";
const both = await walkSdUsage(
  fakeCard({ "bad.bin": "throw", [deeper + "/f.bin"]: 5 }),
  PATHS,
);
eq(both.truncatedBy, "file", "the FIRST cause is reported, not whichever happened last");

// --- 6b. A card whose name a reader cannot use -----------------------------------------------
// Windows commonly returns nothing usable for a removable volume.
eq(cardDisplayName("GNW-SD"), "GNW-SD", "a card with a name keeps it");
eq(cardDisplayName(""), UNNAMED_CARD, "an empty name falls back");
eq(cardDisplayName("-"), UNNAMED_CARD, "punctuation is not a name: the rule is alphanumerics, not emptiness");
eq(cardDisplayName("___"), UNNAMED_CARD, "underscores are not a name either");
eq(cardDisplayName(null), UNNAMED_CARD, "an absent name falls back");
// THE ONE THAT WOULD PASS REVIEW WHILE BEING WRONG. A naive /[a-z0-9]/i renames every card named
// in a non-Latin script to "SD", and the English cases above would all still look right.
eq(cardDisplayName("カード"), "カード", "a Japanese name survives: the test is Unicode-aware");
eq(cardDisplayName("Карта"), "Карта", "a Russian name survives");
eq(cardDisplayName("بطاقة"), "بطاقة", "an Arabic name survives");
eq(cardDisplayName("卡"), "卡", "a single CJK glyph is a name");
// Stated divergence: the owner's own example keeps its name, because E is a letter.
eq(cardDisplayName("(E:)"), "(E:)", "a drive letter counts as a name under the rule as stated");

// --- 7. The states distinguish 'nothing to report' from 'nothing on the card' -----------------
for (const k of ["unknown", "unavailable", "unreadable", "ready"]) {
  ok(new RegExp(`kind: "${k}"`).test(code), `the ${k} state exists`);
}
// The dangerous collapse: a card we failed to read reported as a card with nothing on it.
const unreadableArm = code.slice(code.indexOf("} catch {", code.indexOf("async refresh")));
ok(
  /kind: "unreadable"/.test(unreadableArm.slice(0, 400)),
  "a failed read is 'unreadable', never a ready state of zeroes",
);

report();

/**
 * Printed from an `uncaughtException`/`unhandledRejection` hook too, not just at the end.
 * A mutation that makes the module throw would otherwise take the accumulated failures down
 * with it and print only a stack, which reads as "the suite is broken" rather than "the suite
 * caught it". That exact shape wasted a pass on this branch already.
 */
function report(err) {
  if (err) failures.push(`the suite could not finish: ${err && err.message ? err.message : err}`);
  console.log(
    failures.length
      ? `sd storage: ${failures.length} FAILED of ${checks}\n  ${failures.join("\n  ")}`
      : `sd storage: ${checks} checks passed`,
  );
  process.exit(failures.length ? 1 : 0);
}
