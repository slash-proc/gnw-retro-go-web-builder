#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/util.ts`'s `formatSize()` — the human byte-size formatter
 * whose unit suffixes now come from the LOCALE (`shared.units`) instead of hardcoded
 * `B`/`KB`/`MB`.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/formatsize.mjs'
 *
 * Plain node, no framework (repo convention). Same injection style as
 * `test/localfolders.mjs`: esbuild bundles the real modules with the `$state` rune defined
 * away, and the browser globals `formatSize`'s dependency chain needs (localStorage via
 * persist.ts, navigator.language via locale.svelte.ts's browser-locale match) are staged
 * here rather than mocked per-call.
 *
 * The contract under test:
 *   - every tier boundary: 1023 B stays bytes, 1024 B becomes 1 KB, 1 MB - 1 byte stays KB,
 *     exactly 1 GB becomes 1 GB (the tier that did not exist and rendered a 2.1 GB quota
 *     as "2148 MB").
 *   - whole numbers never carry dead decimals (`2 MB`, never `2.00 MB`); at most 2 dp.
 *   - a non-finite input is an em dash, not "NaN B".
 *   - switching the locale switches the suffix — French uses OCTETS (o/Ko/Mo/Go), and
 *     Japanese sets no space between the number and the unit.
 */
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-formatsize-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

// One entry module so `formatSize` and the `locale` store it reads come from the SAME bundle
// instance — two separate esbuild outputs would each get their own copy of the store and the
// locale-switch assertions would silently test nothing.
const entry = join(out, "entry.ts");
writeFileSync(entry, [
  `export { formatSize, formatSizePair } from ${JSON.stringify(join(here, "../src/lib/util.ts"))};`,
  `export { locale } from ${JSON.stringify(join(here, "../src/lib/i18n/locale.svelte.ts"))};`,
  `import ${JSON.stringify(join(here, "../src/lib/i18n/registerLocales.ts"))};`,
].join("\n"));

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [entry],
  outfile: join(out, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});

// persist.ts reads localStorage at import time (the locale store's initializer); locale.svelte.ts
// falls back to navigator.language when nothing is stored.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.navigator = { language: "en-US" };

const { formatSize, formatSizePair, locale } = await import(pathToFileURL(join(out, "bundle.js")).href);

// --- tier boundaries -----------------------------------------------------------------------
check("0 bytes", () => eq(formatSize(0), "0 B", "zero"));
check("below the KB tier", () => eq(formatSize(1023), "1023 B", "1023 B stays bytes"));
check("exactly 1 KB", () => eq(formatSize(1024), "1 KB", "1024 B is the KB boundary"));
check("1 MB minus a byte", () => eq(formatSize(1048575), "1024 KB", "just under 1 MB stays KB"));
check("exactly 1 MB", () => eq(formatSize(1048576), "1 MB", "MB boundary"));
check("1 GB minus a byte", () => eq(formatSize(1073741823), "1024 MB", "just under 1 GB stays MB"));
check("exactly 1 GB", () => eq(formatSize(1073741824), "1 GB", "GB boundary"));
check("a real storage quota", () => eq(formatSize(2252341248), "2.1 GB", "2.1 GB, not 2148 MB"));

// --- numeric formatting (must NOT have changed) --------------------------------------------
check("no dead decimals", () => eq(formatSize(2 * 1048576), "2 MB", "whole numbers are bare"));
check("trailing zero trimmed", () => eq(formatSize(1536), "1.5 KB", "1.50 KB is wrong"));
check("two decimals max", () => eq(formatSize(5368709), "5.12 MB", "at most 2 dp"));
check("rounds bytes", () => eq(formatSize(900.4), "900 B", "sub-KB is a whole number"));
check("non-finite is an em dash", () => {
  eq(formatSize(NaN), "—", "NaN");
  eq(formatSize(Infinity), "—", "Infinity");
});

// --- the locale actually drives the suffix -------------------------------------------------
check("French uses octets", () => {
  locale.set("fr");
  eq(formatSize(0), "0 o", "byte");
  eq(formatSize(1024), "1 Ko", "kilo-octet");
  eq(formatSize(1048576), "1 Mo", "méga-octet");
  eq(formatSize(1073741824), "1 Go", "giga-octet");
});
check("Japanese sets no space", () => {
  locale.set("ja");
  eq(formatSize(1048576), "1MB", "no separator between number and unit");
});
check("a per-locale separator is not hardcoded away", () => {
  locale.set("ko");
  eq(formatSize(1048576), "1 MB", "Korean keeps the space");
});
check("back to English", () => {
  locale.set("en");
  eq(formatSize(1048576), "1 MB", "English suffix restored");
});
check("the numeric part is locale-independent", () => {
  for (const l of ["en", "fr", "ja", "ko", "de", "es", "pl"]) {
    locale.set(l);
    const s = formatSize(1536);
    if (!s.startsWith("1.5")) throw new Error(`${l}: expected the number "1.5", got ${JSON.stringify(s)}`);
  }
  locale.set("en");
});

// --- formatSizePair: the `value/max` counter, unit named ONCE on the total ------------------
// `GuidedFlashing.dc.html` draws `[1.6/3.4 MB]` (the brackets are the caller's). The pair is
// deliberately fixed-precision and scaled off `max`, so both halves share one unit and a
// moving counter doesn't rescale mid-flash. Its units come from the locale like formatSize's;
// the ConfirmModal / InstallProgressModal counters used to hardcode "KB"/"MB" in English.
check("the artboard's byte counter", () => {
  locale.set("en");
  eq(formatSizePair(1677722, 3565158), "1.6/3.4 MB", "GuidedFlashing.dc.html's [1.6/3.4 MB]");
});
check("the pair is scaled off the total, not each half", () => {
  locale.set("en");
  eq(formatSizePair(0, 3565158), "0/3.4 MB", "a zero value stays in the total's unit");
  eq(formatSizePair(512, 1048576), "0/1 MB", "a tiny value does not drop to KB on its own");
});
check("tiers", () => {
  locale.set("en");
  eq(formatSizePair(900, 1023), "900/1023 B", "sub-KB is whole bytes");
  eq(formatSizePair(1024, 2048), "1/2 KB", "KB tier");
  eq(formatSizePair(536870912, 1073741824), "0.5/1 GB", "GB tier");
});
check("one decimal, trailing zeros trimmed", () => {
  locale.set("en");
  eq(formatSizePair(2097152, 4194304), "2/4 MB", "whole numbers stay bare");
  eq(formatSizePair(1572864, 3145728), "1.5/3 MB", "one decimal");
});
check("the separator is the caller's", () => {
  locale.set("en");
  eq(formatSizePair(1024, 2048, " / "), "1 / 2 KB", "ConfirmModal spaces its slash");
});
check("French counters are in octets", () => {
  locale.set("fr");
  eq(formatSizePair(1677722, 3565158), "1.6/3.4 Mo", "Mo, not MB");
  eq(formatSizePair(1024, 2048), "1/2 Ko", "Ko, not KB");
  eq(formatSizePair(1024, 2048, " / "), "1 / 2 Ko", "ConfirmModal's counter too");
  eq(formatSizePair(100, 900), "100/900 o", "o, not B");
  locale.set("en");
});
check("Japanese drops the space in counters too", () => {
  locale.set("ja");
  eq(formatSizePair(1024, 2048), "1/2KB", "no separator before the unit");
  locale.set("en");
});

/* ---------------------------------------------------------------------------------------
 * Source guard: no hardcoded byte-unit suffixes in the size-rendering call sites.
 *
 * These sites live inside a `.svelte` template / a tooltip-string builder and are not
 * reachable from this suite at runtime, so this is a deliberate STATIC assertion rather
 * than a contrived render harness: it catches the exact regression it is written for — a
 * value formatted as `${n} MB` instead of through `formatSize()`, which prints English
 * units in all seven locales. Prose backticks in comments (`1 MB`, `50 MB of ...`) do not
 * match: the patterns require a value expression or a quote immediately before the unit.
 * ------------------------------------------------------------------------------------ */
const GUARDED = ["src/lib/views/RomManagementTab.svelte", "src/lib/engine/classify.ts"];
const UNIT_PATTERNS = [
  [/\}\s?(?:B|KB|MB|GB)\b/g, "a template literal appending a unit after ${...}"],
  [/["'`]\s?(?:KB|MB|GB)\s?["'`]/g, "a bare quoted unit string"],
];
for (const rel of GUARDED) {
  check(`no hardcoded byte units in ${rel}`, () => {
    // Comments are stripped first: both files document the WRONG shapes they replaced
    // (`(n/1048576).toFixed(2) + " MB"`), and a guard that trips on its own cautionary
    // note would be un-writable.
    const src = readFileSync(join(here, "..", rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const [re, what] of UNIT_PATTERNS) {
      const hits = src.match(re);
      if (hits) throw new Error(`${what}: ${JSON.stringify(hits.slice(0, 3))} — use formatSize()`);
    }
  });
}

if (failures.length) {
  console.error(`formatsize: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`formatsize: ${passed} checks passed`);
