#!/usr/bin/env node
/**
 * Arabic is the app's first right-to-left locale, and the direction is a variable now.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/direction.mjs'
 *
 * `index.html` shipped `<html lang="en">` and nothing ever changed it, so the page was
 * permanently English and permanently left-to-right. Three things decide whether Arabic reads
 * at all, and each fails in a different way:
 *
 *   1. The RTL set. A `code === "ar"` comparison works today and is the line nobody finds when
 *      Hebrew, Persian or Urdu lands. It has to be DATA someone can add a code to.
 *   2. The application point. If `dir` were written inside `locale.set()`, the locale store
 *      would import `document` and every node suite that pulls in `util.ts` (formatSize reads
 *      the locale) would break -- the same hazard its `matchBrowserLocale()` already guards.
 *   3. The islands. A hex offset reversing is not a layout preference, it is wrong data:
 *      `0x08100000` must read as itself in an Arabic page.
 *
 * CSS geometry cannot be seen from here (there is no headless browser in this container), so
 * the last group asserts the declarations that produce the behaviour, not the painted result.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const src = (p) => readFileSync(join(here, "../src", p), "utf8");
const direction = src("lib/direction.svelte.ts");
/**
 * The module with its comments stripped.
 *
 * `direction.svelte.ts` EXPLAINS why `code === "ar"` is the wrong shape, so a naive scan for
 * that literal finds the explanation and fails on prose. Comments are stripped before any rule
 * is matched -- the same trap `conformance-counts.mjs` documents for markdown tables and
 * `panescroll.mjs` hit with a `}` inside a CSS comment.
 */
const directionCode = direction.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const app = src("App.svelte");
const global = src("styles/global.css");
const geometry = src("lib/ui/GeometryBar.svelte");
const locale = src("lib/i18n/locale.svelte.ts");

/**
 * The real module, compiled out of `direction.svelte.ts` rather than restated here.
 *
 * It is plain TypeScript with one type-only import, so stripping the import and the type
 * annotations is enough to run it. Restating the rule would test the restatement, and the rule
 * is the thing under test.
 */
function realModule() {
  let js = direction
    .replace(/^import type .*$/m, "")
    .replace(/:\s*ReadonlySet<Locale>/g, "")
    .replace(/new Set<Locale>/g, "new Set")
    .replace(/\(code:\s*Locale\)/g, "(code)")
    .replace(/:\s*"rtl"\s*\|\s*"ltr"/g, "")
    .replace(/:\s*boolean/g, "")
    .replace(/:\s*void/g, "")
    .replace(/export /g, "");
  ok(/RTL_LOCALES/.test(js) && /applyDirection/.test(js), "the lifted module is not direction.svelte.ts");
  return new Function(`${js}; return { RTL_LOCALES, isRtl, directionFor, applyDirection };`)();
}

const mod = realModule();

check("Arabic reads right to left", () => {
  eq(mod.directionFor("ar"), "rtl", "ar must be an RTL locale");
  eq(mod.isRtl("ar"), true, "isRtl(ar)");
});

check("every other locale is unchanged", () => {
  for (const code of ["en", "de", "fr", "ja", "ko", "zh-Hans", "ru", "uk", "no", "pt", "it", "pl", "es"]) {
    eq(mod.directionFor(code), "ltr", `${code} must stay left to right`);
  }
});

check("the RTL set is data, not a comparison", () => {
  // ARMED: a `code === "ar"` implementation passes both checks above and fails this one, which
  // is the whole point -- the next RTL locale is added by editing a set, not by finding a
  // conditional somebody wrote once.
  ok(mod.RTL_LOCALES instanceof Set, "RTL_LOCALES must be a Set someone can add a code to");
  ok(mod.RTL_LOCALES.has("ar"), "ar must be IN the set, not special-cased around it");
  ok(!/===\s*["']ar["']/.test(directionCode), `direction.svelte.ts compares against "ar" literally`);
});

check("a locale added to the set needs no other edit", () => {
  // Hebrew is not a locale of this app; the point is that the function answers from the set.
  const widened = new Set([...mod.RTL_LOCALES, "he"]);
  eq(widened.has("he"), true, "the set is extensible");
  ok(/RTL_LOCALES\.has\(/.test(directionCode), "isRtl must answer from the set rather than a literal");
});

check("the document gets the language as well as the direction", () => {
  // index.html hardcodes lang="en" and nothing updated it, so every locale claimed to be
  // English to a screen reader. They change together, so they are set together.
  ok(/setAttribute\("dir"/.test(directionCode), "dir is never written to the document");
  ok(/setAttribute\("lang"/.test(directionCode), "lang is never written, so assistive tech still hears English");
});

check("the module is safe to import with no DOM", () => {
  // `locale.svelte.ts` is pulled into offline node suites through util.ts's formatSize. If the
  // direction write lived there, or this module touched `document` at import time, those
  // suites would break.
  ok(/typeof document === "undefined"/.test(directionCode), "applyDirection must no-op without a document");
  ok(!/document/.test(locale), "locale.svelte.ts must not reach for the DOM; that is why this module exists");
  // Proves it rather than trusting the guard: the lifted module ran above with no `document`
  // in scope, and calling it must not throw.
  mod.applyDirection("ar");
});

check("the direction follows the locale with no reload", () => {
  ok(/\$effect\(\(\) => \{\s*applyDirection\(locale\.current\)/.test(app),
    "App.svelte must apply the direction in an effect on locale.current, or switching language needs a reload");
});

check("Arabic is registered and in the switcher", () => {
  ok(/\|\s*"ar"/.test(locale), "ar is missing from the Locale union");
  ok(/\{ code: "ar", label: "العربية" \}/.test(locale), "ar is missing from SUPPORTED_LOCALES, or is not labelled in its own script");
  const barrel = src("lib/i18n/registerLocales.ts");
  ok(/import "\.\/ar\.js";/.test(barrel), "ar.js is not in the side-effect barrel, so the locale falls back to English");
});

check("the switcher stays sorted by code", () => {
  // firstrun.mjs owns this rule; repeated here because inserting `ar` is exactly when it breaks.
  const list = locale.slice(locale.indexOf("SUPPORTED_LOCALES"));
  const codes = [...list.slice(0, list.indexOf("];")).matchAll(/code: "([^"]+)"/g)].map((m) => m[1]);
  ok(codes.length > 1, "no locales parsed out of SUPPORTED_LOCALES");
  eq(codes.join(","), codes.slice().sort().join(","), "SUPPORTED_LOCALES must stay ordered by code");
  eq(codes[0], "ar", "ar sorts first by code");
});

// --- what must NOT mirror -----------------------------------------------------------------

check("a hex offset and a path do not reverse", () => {
  const at = global.indexOf(".mono {");
  ok(at >= 0, "the app's monospace hook is gone; this check is looking in the wrong place");
  const body = global.slice(at, global.indexOf("}", at));
  ok(/direction:\s*ltr/.test(body),
    "`code, .mono` must pin LTR, or 0x08100000 and roms/nes/mario.nes reverse in an Arabic page");
  ok(/unicode-bidi:\s*isolate/.test(body),
    "without `isolate` the run and the Arabic around it disturb each other's bidi resolution");
});

check("the flash map keeps its real-world orientation", () => {
  // A memory map is a picture of an address space: low address at the left because that is how
  // it is drawn, not because the page reads that way. A flex row under dir=rtl would reverse
  // every partition silently.
  ok(/:global\(\[dir="rtl"\]\) \.gbar\s*\{[^}]*flex-direction:\s*row-reverse/s.test(geometry),
    "GeometryBar's .gbar must be restored to left-to-right order under RTL, or the address space reverses");
  ok(!/\.gbar\s*\{[^}]*direction:\s*ltr/s.test(geometry),
    "pinning .gbar with `direction: ltr` fixes the order but renders the segments' Arabic labels as an LTR paragraph; row-reverse is the one that does not");
});

check("centring transforms are left alone", () => {
  // `left: 50%` with `translateX(-50%)` is the same point from either side. Converting it to a
  // logical inset is a no-op at best and an off-centre popover at worst.
  const infotip = src("lib/ui/InfoTip.svelte");
  ok(/left:\s*50%/.test(infotip) && /translateX\(-50%\)/.test(infotip),
    "InfoTip's centring pair was rewritten; 50% from either edge is the same point and did not need converting");
});


// --- the general rule: inline sides are LOGICAL --------------------------------------------
//
// The checks above pin the direction machinery and the handful of things that must NOT mirror.
// This one is the opposite shape, and it is the one that scales: it fails when a NEW physical
// inline property appears anywhere in `src/`, the way `zlayers.mjs` fails on a raw z-index.
//
// Why it earns its place: the reported bug was `padding: 32px var(--page-pad-x) 40px 0` on
// `.screendock`. In LTR the dock is the trailing grid column, so a physical right padding IS
// the page gutter and looks correct. Under `dir=rtl` the grid mirrors, the dock moves to the
// left of the page, and `padding-right` does not follow it -- the 40px lands on the dock's
// inner edge and the capture panel sits flush against the viewport. Nine more sites had the
// same shape, including all three rails, where `border-inline-end` was ALREADY logical right
// beside a physical padding. A check that asserted only `.screendock`'s padding would have
// left the other nine and caught none of the next one.
//
// Physical insets are the one category with real exceptions, so they are narrowed rather than
// dropped: a `left`/`right` pair with equal values is symmetric and mirrors identically, and
// `left: 50%` with a translate is the same point from either edge (the check above already
// says so for InfoTip). What remains is listed by name.

/** Physical insets that are deliberate, each because the value is not a reading-order edge. */
const INSET_EXCEPTIONS = [
  {
    file: "lib/ui/Carousel.svelte",
    selector: ".coverflow-item",
    why: "the origin every slide's 3D transform is measured from, not an edge of the page; "
       + "mirroring it would flip the coverflow's maths, which is transform-driven and has no "
       + "direction of its own (same class as GeometryBar's address space above)",
  },
];

/** Every `.svelte` <style> block and `.css` file under src/, comments stripped. */
function styleSheets() {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(svelte|css)$/.test(e)) {
        let css = readFileSync(full, "utf8");
        if (full.endsWith(".svelte")) {
          const m = css.match(/<style[^>]*>([\s\S]*?)<\/style>/);
          if (!m) continue;
          css = m[1];
        }
        out.push({ file: relative(join(here, "../src"), full), css: css.replace(/\/\*[\s\S]*?\*\//g, "") });
      }
    }
  })(join(here, "../src"));
  return out;
}

/** Innermost declaration blocks, so `@media` wrappers are stepped through rather than parsed. */
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim().split("\n").pop().trim(), body: m[2] });
  }
  return out;
}

const PHYSICAL = [
  [/(?<![-\w])(padding|margin)-(left|right)\s*:/, "$& must be `-inline-start`/`-inline-end`"],
  [/(?<![-\w])border-(left|right)(?:-\w+)?\s*:/, "$& must be `border-inline-start`/`-end`"],
  [/text-align\s*:\s*(left|right)\b/, "`text-align` must be `start`/`end`"],
  [/(?<![-\w])float\s*:\s*(left|right)\b/, "`float` must be `inline-start`/`inline-end`"],
];

check("no physical inline property where a logical one mirrors", () => {
  const hits = [];
  for (const { file, css } of styleSheets()) {
    for (const { selector, body } of rules(css)) {
      for (const [re, why] of PHYSICAL) {
        const m = body.match(re);
        if (m) hits.push(`${file} ${selector} -- ${m[0].trim()} (${why.replace("$&", m[0].trim())})`);
      }
      // A 4-value shorthand is only a mirroring bug when the two inline sides DIFFER; an equal
      // pair paints the same either way, which is why 1-, 2- and 3-value forms are all fine.
      const sh = body.match(/(?<![-\w])(padding|margin)\s*:\s*([^;]+);/);
      if (sh) {
        const parts = sh[2].trim().split(/\s+(?![^(]*\))/);
        if (parts.length === 4 && parts[1] !== parts[3]) {
          hits.push(`${file} ${selector} -- \`${sh[0].trim()}\` sets different inline sides, so it cannot mirror`);
        }
      }
    }
  }
  ok(hits.length === 0, `physical inline properties found (${hits.length}):\n    ${hits.join("\n    ")}`);
});

check("a physical inset is symmetric, a centring pair, or listed by name", () => {
  const hits = [];
  for (const { file, css } of styleSheets()) {
    for (const { selector, body } of rules(css)) {
      const L = body.match(/(?<![-\w])left\s*:\s*([^;]+);/);
      const R = body.match(/(?<![-\w])right\s*:\s*([^;]+);/);
      if (!L && !R) continue;
      // `left: 0; right: 0` and friends: the same box from either direction.
      if (L && R && L[1].trim() === R[1].trim()) continue;
      // 50% from either edge is the same point; the translate does the centring.
      if (L && !R && L[1].trim() === "50%") continue;
      if (R && !L && R[1].trim() === "50%") continue;
      if (INSET_EXCEPTIONS.some((x) => x.file === file && x.selector === selector)) continue;
      hits.push(`${file} ${selector} -- ${(L || R)[0].trim()}`);
    }
  }
  ok(hits.length === 0, `unexplained physical insets (${hits.length}):\n    ${hits.join("\n    ")}`);
});

check("every named inset exception still exists and still needs naming", () => {
  // ARMED, the way zlayers.mjs arms its exception list: a stale entry silently widens the guard.
  for (const x of INSET_EXCEPTIONS) {
    const sheet = styleSheets().find((s) => s.file === x.file);
    ok(sheet, `${x.file} is gone; drop its inset exception`);
    const hit = rules(sheet.css).find((r) => r.selector === x.selector && /(?<![-\w])(left|right)\s*:/.test(r.body));
    ok(hit, `${x.file} ${x.selector} no longer sets a physical inset; drop the exception rather than leaving it to excuse the next one`);
    ok(x.why.length > 40, `${x.file} ${x.selector} needs a reason the next reader can act on`);
  }
});

check("the reported pane keeps its gutter on the edge that mirrors", () => {
  // THE REPORTED BUG, by name, so the general checks above cannot be satisfied by deleting it.
  // `.screendock` appears TWICE -- the layout rule, and a `display: none` inside the
  // `max-width: 1200px` media query that comes first in the file. Pick by what it declares,
  // not by position: an indexOf here silently checked the media-query copy.
  const dock = src("lib/views/OverviewTab.svelte").replace(/\/\*[\s\S]*?\*\//g, "");
  const decls = rules(dock).filter((r) => r.selector === ".screendock");
  ok(decls.length >= 1, "no `.screendock` rule in OverviewTab.svelte");
  const laid = decls.find((r) => /padding/.test(r.body));
  ok(laid, "`.screendock` declares no padding at all; the page gutter is gone entirely");
  const body = laid.body;
  ok(/padding-inline:\s*0\s+var\(--page-pad-x\)/.test(body),
    "the dock's page gutter must be its INLINE-END padding; as a physical right padding it "
    + "stayed on the right when the grid mirrored, leaving the Arabic layout with no gutter");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`direction: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
