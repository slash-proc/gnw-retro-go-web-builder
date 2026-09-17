#!/usr/bin/env node
/**
 * The first ten minutes: no dead ends, and no unexplained decisions.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/firstrun.mjs'
 *
 * Three findings from docs/design/proposals/beginner-audit.md, all of which stop a beginner
 * outright rather than merely annoying them:
 *
 *   F1  The "Manage Device" card was greyed by CSS alone on a browser without WebUSB. It kept
 *       its click handler AND its place in the tab order, so it dropped the user on a device
 *       screen that can never connect. `class:disabled` is a LOOK; `disabled` is the promise.
 *   F3  WITHDRAWN by the owner, after two inversions. A locked device was offered all three
 *       paths and each died inside the backup; the fix was a wall. Automatic unlocking makes
 *       the premise false, so the wall is gone and the guards moved to unlockGate/locked-copy/
 *       chooserstates. The block below says where each one went.
 *   F4  WITHDRAWN by the owner. The audit called the chooser three bare labels and got three
 *       descriptions; he struck all three as narration ("unnecessary strings"). The checks
 *       below are inverted so the copy cannot return. Only the Retro-Go rubric survives, and
 *       it survives because it is a rubric and not a button caption.
 *
 * These live in .svelte components, so a node suite cannot press the button. What it CAN do is
 * hold the guarantees that make the behaviour true: the attribute exists, the branch exists,
 * the strings exist in all seven locales and are actually translated. Where a check reads
 * source shape rather than behaviour it says so, because a restructure must re-read it rather
 * than trust it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src/lib");
const strings = join(src, "i18n/strings");
const read = (p) => readFileSync(join(src, p), "utf8");

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message || e}`); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (got, want, msg) => { if (got !== want) throw new Error(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// Derived once for every suite -- see test/locales.mjs.
import { LOCALE_SUFFIXES as LOCALES, isLocaleFile, latinEquivalentLength } from "./locales.mjs";
/** The value of `key` in one string table, or null. Multi-line arrow entries are not values. */
function valueOf(file, key) {
  const src = readFileSync(join(strings, file), "utf8");
  const m = src.match(new RegExp(`^\\s*${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"));
  return m ? m[1] : null;
}

// ── F1 ────────────────────────────────────────────────────────────────────────────────
const landing = read("views/Landing.svelte");

// SOURCE SHAPE. The attribute is the only thing that stops a keyboard activation; CSS cannot.
check("F1: the device card carries the `disabled` ATTRIBUTE, not just the class", () => {
  const card = landing.slice(landing.indexOf('onNavigate(\'device\', device.targetMedia)') - 400,
                             landing.indexOf('onNavigate(\'device\', device.targetMedia)'));
  // `class:disabled={!webusb}` CONTAINS "disabled={!webusb}", so a naive match passes against
  // the very bug this guards. The lookbehind is what makes the check bite.
  // The condition is matched as "mentions `!webusb`" rather than as an exact literal: the card is
  // now ALSO disabled while its step is held (`!webusb || step !== 'action'`), and pinning the
  // exact spelling would fail that without anything being wrong. What is guarded is unchanged --
  // a real `disabled` attribute, not a `class:` one, driven by `!webusb`.
  ok(/(?<!class:)\bdisabled=\{[^}]*!webusb/.test(card),
     "class:disabled only greys it -- without the attribute the card is still clickable and still focusable");
});

// A DIFFERENT guarantee: the attribute blocks activation, pointer-events blocks the hover
// affordance that would still say "this is a button". Both, or the card lies about itself.
check("F1: and `pointer-events: none`, so it does not behave like a button either", () => {
  const rule = landing.match(/\.choice\.disabled \{[^}]*\}/);
  ok(rule, "no .choice.disabled rule at all");
  ok(/pointer-events:\s*none/.test(rule[0]), "the disabled card still takes pointer events");
});

check("F1: the unsupported line names a browser that works, in every locale", () => {
  for (const l of LOCALES) {
    const v = valueOf(`landing${l}.ts`, "unsupportedBrowser");
    ok(v, `landing${l}.ts has no unsupportedBrowser`);
    ok(/Chrom/.test(v) && /Edge/.test(v),
       `landing${l}.ts names no way forward: ${JSON.stringify(v)}`);
  }
});

// ── F3 ────────────────────────────────────────────────────────────────────────────────
const wizard = read("views/Wizard.svelte");

/**
 * F3 IS WITHDRAWN, and the three checks that stood here are gone with it.
 *
 * The finding was real: a locked device was offered all three setup paths and each died inside
 * the backup, because bank 1 cannot be read under RDP. The fix was a wall -- the chooser
 * replaced its cards with a notice. That wall was then inverted once (the escape to Advanced
 * became a real route rather than a second dead end) and is now removed entirely, by the owner:
 *
 *   "LockedDevice is entirely wrong - WE DON'T CARE! We unlock the device if it is locked!
 *    The user is not explicitly prompted. Unlocking is an inherent part of the Backup phase.
 *    The Backup phase succeeding is incredibly important for that reason."
 *
 * WHAT MAKES THAT SAFE NOW AND NOT THEN. F3's premise was that every path fails on a locked
 * device. It no longer holds: `packages/gnw-flasher`'s `unlock()` is implemented (it was a stub
 * when F3 landed, and the old chooser comment still cited it as one -- confusing it with
 * `lock()`, which is the deliberate stub), and every write flow calls `device.ensureUnlocked()`
 * before it writes. So the paths do not die; they unlock and continue.
 *
 * WHERE THE PROTECTION WENT, because it did not evaporate:
 *   - `engine/unlockGate.ts` owns the ordering -- a backup of this unit is asked about BEFORE
 *     `unlock()` is reachable, and `test/unlockgate.mjs` fails if that order is ever swapped;
 *   - the one surviving prompt (no backup exists, so unlocking destroys the original firmware)
 *     is pinned by `test/locked-copy.mjs` section 3b, which requires it to state the loss;
 *   - that same file's sections 4 and 4b now require Guided Setup to carry NO locked copy and
 *     the chooser to make NO `locked` test, so the wall cannot be rebuilt quietly;
 *   - `test/chooserstates.mjs` renders a locked device and asserts it draws the same three
 *     cards as any other.
 *
 * Four guards replace three, and they pin the behaviour rather than the copy.
 */

// ── F4, WITHDRAWN ──────────────────────────────────────────────────────────
// The audit asked for a description under each chooser label and got three. The owner then
// struck all three by quoting them back: "Pick which one runs at power-on", "and leaves more
// space for games", "Erases Retro-Go" -- "unnecessary strings ... this weird narration style
// instead of focusing on good UI design". A chooser button is a name.
//
// So these checks are INVERTED, not deleted: the finding is withdrawn and the keys must not
// come back. `whatIsRetroGo` is NOT part of the withdrawal -- it is a rubric under the title,
// not a button caption, and it defines the one word the screen assumes. The owner quoted the
// three captions and not the rubric.
check("F4 withdrawn: no chooser option carries a description, in any locale", () => {
  for (const l of LOCALES) {
    for (const k of ["dualBootDesc", "onlyRetroGoDesc", "returnToStockDesc"]) {
      ok(valueOf(`wizard${l}.ts`, k) == null,
         `wizard${l}.ts still declares chooser.${k}; the owner struck it`);
    }
  }
});

check("F4 withdrawn: the chooser renders a label and nothing under it", () => {
  for (const k of ["dualBootDesc", "onlyRetroGoDesc", "returnToStockDesc"]) {
    ok(!wizard.includes(`w.chooser.${k}`), `the chooser renders ${k}, which the owner struck`);
  }
  ok(!/class="choice-desc"/.test(wizard), "a choice-desc element is back under a chooser label");
});

// The marks row is not allowed to wrap, and nothing at runtime would report it if it did.
// Doubling the icons took the widest row (badge + plus + wordmark) from 119.8px to 219.6px,
// which is why the card no longer holds the marks BESIDE the label. Derive both sides rather
// than trusting the comment that says so: the assets carry their own aspect ratios.
check("the widest marks row still fits inside a chooser card", () => {
  const px = (re) => { const m = wizard.match(re); ok(m, `no match for ${re}`); return parseFloat(m[1]); };
  const svg = readFileSync(join(src, "../assets/logo-gnw-badge.svg"), "utf8");
  const gnwAspect = parseFloat(svg.match(/\swidth="([\d.]+)"/)[1]) / parseFloat(svg.match(/\sheight="([\d.]+)"/)[1]);
  const png = readFileSync(join(src, "../assets/logo-rgo.png"));
  const rgoAspect = png.readUInt32BE(16) / png.readUInt32BE(20);

  const gnwW = px(/\.mark-gnw \{[^}]*height: ([\d.]+)px/) * gnwAspect;
  const rgoW = px(/\.mark-rgo \{[^}]*height: ([\d.]+)px/) * rgoAspect;
  const plusW = parseFloat(wizard.match(/class="plus" width="([\d.]+)"/)[1]);
  const gap = px(/\.marks \{[^}]*gap: ([\d.]+)px/);
  // badge + gap + plus + gap + wordmark: the dual-boot card, the only one with all three.
  const widest = gnwW + gap + plusW + gap + rgoW;

  const cardW = px(/\.choice \{[^}]*width: ([\d.]+)px/);
  const padX = px(/\.choice \{[^}]*padding: [\d.]+px ([\d.]+)px/);
  const room = cardW - 2 * padX;
  ok(room >= widest,
     `the dual-boot marks row needs ${widest.toFixed(1)}px and the card offers ${room}px, so it wraps`);

  // And the column itself has to hold the card.
  const colW = px(/\.wizard-container \{[^}]*width: ([\d.]+)px/);
  ok(colW >= cardW + 20,
     `a ${cardW}px card in a ${colW}px column leaves no margin`);
});

// The icons were doubled on the owner's instruction. Pin the ratio between them, not the
// absolute px: the two marks are a matched pair and one growing alone would look wrong.
check("the two marks keep their relative sizes", () => {
  const h = (re) => parseFloat(wizard.match(re)[1]);
  const gnw = h(/\.mark-gnw \{[^}]*height: ([\d.]+)px/);
  const rgo = h(/\.mark-rgo \{[^}]*height: ([\d.]+)px/);
  ok(Math.abs(gnw / rgo - 24 / 11) < 0.02, `badge:wordmark is ${(gnw / rgo).toFixed(2)}, was ${(24 / 11).toFixed(2)}`);
  ok(gnw >= 40, `the badge is ${gnw}px; the owner asked for roughly double the original 24px`);
});

check("the Retro-Go rubric survives the withdrawal, in every locale", () => {
  ok(wizard.includes("w.chooser.whatIsRetroGo"), "Retro-Go is defined in the strings but never shown");
  for (const l of LOCALES) {
    const v = valueOf(`wizard${l}.ts`, "whatIsRetroGo");
    ok(v, `wizard${l}.ts has no chooser.whatIsRetroGo`);
    ok(/Retro-Go/.test(v), `wizard${l}.ts defines it without naming it: ${JSON.stringify(v)}`);
  }
});

// ── the translation bar ───────────────────────────────────────────────────────────────
// English pasted into a sibling is the failure mode this codebase has hit before, and it
// compiles cleanly -- only a check like this notices.
check("no new string is left in English in a non-English table", () => {
  const NEW = {
    "landing": ["unsupportedBrowser"],
    // The locked trio was removed with F3's wall: Guided Setup no longer refuses a
    // locked device, so there is no locked copy to leave untranslated.
    "wizard": ["whatIsRetroGo"],
  };
  for (const [area, keys] of Object.entries(NEW)) {
    for (const k of keys) {
      const en = valueOf(`${area}.ts`, k);
      for (const l of LOCALES.filter((x) => x !== "")) {
        const v = valueOf(`${area}${l}.ts`, k);
        ok(v !== en, `${area}${l}.ts:${k} is the English string verbatim`);
      }
    }
  }
});

// The switcher's trigger shows the CODE, so the menu is ordered by it -- see SUPPORTED_LOCALES.
// A new locale appended to the end is the way this drifts back, and nothing else would notice.
check("the language switcher is ordered by locale code", () => {
  const file = readFileSync(join(src, "i18n/locale.svelte.ts"), "utf8");
  const list = file.slice(file.indexOf("SUPPORTED_LOCALES"));
  const codes = [...list.slice(0, list.indexOf("];")).matchAll(/code: "([^"]+)"/g)].map((m) => m[1]);
  ok(codes.length > 1, "no locales parsed out of SUPPORTED_LOCALES");
  eq(codes.join(","), codes.slice().sort().join(","), "SUPPORTED_LOCALES must be ordered by code");
});

// The owner has asked repeatedly, across the whole project. New copy must not reintroduce them.
check("no new string carries a middle dot or an em-dash", () => {
  const NEW = {
    "landing": ["unsupportedBrowser"],
    // The locked trio was removed with F3's wall: Guided Setup no longer refuses a
    // locked device, so there is no locked copy to leave untranslated.
    "wizard": ["whatIsRetroGo"],
  };
  for (const [area, keys] of Object.entries(NEW)) {
    for (const k of keys) {
      for (const l of LOCALES) {
        const v = valueOf(`${area}${l}.ts`, k) ?? "";
        ok(!/[·—]/.test(v), `${area}${l}.ts:${k} contains a banned separator: ${JSON.stringify(v)}`);
      }
    }
  }
});

// ── the boards ────────────────────────────────────────────────────────────────────────
const boards = join(here, "../../../docs/design/mockups");
check("both new states are drawn", () => {
  const files = readdirSync(boards);
  for (const f of ["GuidedLocked.dc.html", "Landing2Unsupported.dc.html"]) {
    ok(files.includes(f), `${f} is missing -- the state is implemented but undrawn`);
  }
});

// GuidedLayout.dc.html and GuidedLayoutStock.dc.html still DRAW the three descriptions, so
// they are now behind the code rather than ahead of it. Redrawing an approved mockup is the
// owner's call, so this records the divergence instead of asserting either way, and fails if
// someone re-adds the copy to the code to make the boards right again.
check("the chooser boards are the stale half, and the code is not dragged back to them", () => {
  const drawn = ["GuidedLayout.dc.html", "GuidedLayoutStock.dc.html"]
    .filter((f) => /Pick which one runs at power-on/.test(readFileSync(join(boards, f), "utf8")));
  ok(drawn.length === 0 || !/choice-desc/.test(wizard),
     `${drawn.join(", ")} still draw the struck descriptions and the code has grown them back`);
});

// ── dead copy ──────────────────────────────────────────────────────────────
// A control can be deleted in one commit while the seven translations of its label live on,
// and nothing complains: `tsc` only checks that the siblings MATCH English, so a key that is
// dead in all seven is perfectly well-typed. Three keys feeding a dropdown removed from the
// Flash Retro-Go button outlived it by a day. Dead copy is not harmless: it is what a
// translator spends real effort on, and what the next reader takes as evidence that a feature
// still exists.
//
// The corpus is `src/` ONLY, and that is load-bearing in two ways. A key referenced solely by
// a test is still dead PRODUCT copy, so tests must not vouch for it; and the first version of
// this check scanned test/ too, which meant the comment above -- naming the very keys it
// guards -- vouched for them itself and the check passed against its own mutation.
//
// Covers every area file, not just firmwareSetup (that was the original scope, now at zero).
// A key can be reached in a way this regex scan cannot see -- a computed lookup, a key built
// from a template literal -- so a genuinely-live false positive goes in ALLOWLIST below with a
// one-line reason, never silently excluded from the scan.
//
// `overviewRail` is the ninth area (Overview's rail, its Details pane and its Device log pane).
// It is listed here because an area this scan does not know about is an area where a dead string
// can sit forever: four keys in it were already orphaned on the day it landed.
const AREAS = ["deviceHeader", "firmwareSetup", "landing", "overview", "overviewRail", "roms", "shared", "sources", "wizard"];

// AREAS is hand-maintained, and that is exactly how `overviewRail`'s four dead keys hid on the
// day it landed: the scan above only looks where this list points, so a tenth area would be
// invisible to it in the same way. Both sides are derivable, so hold them level: the English
// -- Guided "Add Software Sources": green means the curated list was pulled ------------
// SOURCE SHAPE (a node suite cannot mount the component). Comments are STRIPPED first: this
// block's own prose names every identifier it matches on, and an unstripped corpus would feed
// the checks their own explanation.
const wizardBare = wizard
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

check("sources step: a successful curated pull is what marks it done", () => {
  const m = wizardBare.match(/\{@const stepDone =([\s\S]*?)\}\n/);
  ok(m, "the spine's stepDone @const is gone -- re-read this check against the new shape");
  ok(/id === "sources" && curatedReady/.test(m[1]),
    'stepDone must include `id === "sources" && curatedReady`');
  const arms = wizardBare.match(/curatedProjects\(\)\.then\(\s*([^\n]*)\n\s*([^\n]*)\n/);
  ok(arms, "the flag must come from curatedProjects() -- the session memo the sources store already drives");
  ok(/curatedReady = !!list && list\.length > 0/.test(arms[1]),
    "the FIRST .then arm (fulfilment) must set curatedReady from the resolved curated list, not from a literal");
});

check("Return to Stock backup step: a validated backup marks it done", () => {
  const m = wizardBare.match(/\{@const stepDone =([\s\S]*?)\}\n/);
  ok(m, "the spine's stepDone @const is present");
  ok(/id === "select-backup" && restoreValid/.test(m[1]),
    'stepDone must include `id === "select-backup" && restoreValid`');
});

check("sources step: an in-flight or unattempted pull is NOT done", () => {
  ok(/let curatedReady = \$state\(false\)/.test(wizardBare),
    "curatedReady must start false, or the step is green before the walk answers");
});

check("sources step: a failed curated pull is NOT done", () => {
  const arms = wizardBare.match(/curatedProjects\(\)\.then\(\s*([^\n]*)\n\s*([^\n]*)\n/);
  ok(arms, "curatedProjects().then(...) is gone -- re-read this check");
  ok(/curatedReady = false/.test(arms[2]),
    "the SECOND .then arm (rejection) must leave curatedReady false");
});

check("sources step: the Add Sources button is unconditional", () => {
  const i = wizardBare.indexOf('{:else if id === "sources"}');
  ok(i > 0, 'the sources spine branch is gone -- re-read this check');
  const branch = wizardBare.slice(i, wizardBare.indexOf("{:else if", i + 10));
  ok(/sourcesButtonLabel/.test(branch), "the sources branch must still render the button");
  ok(!/\{#if/.test(branch),
    "the button is the custom-addition route and must not be gated on the curated pull");
});

check("supplementary guided actions share the Reinstall quiet style", () => {
  ok(/<Button variant="quiet" onclick=\{path === "dual" \? openStep1 : openBackupOnly\}>\s*\{w\.spine\.runAgain\}/.test(wizardBare),
    "Run again must use the same quiet Button variant as Reinstall");
  ok(/<Button variant="quiet" onclick=\{\(\) => \(sourcesModalOpen = true\)\}>\s*\{w\.spine\.sourcesButtonLabel\}/.test(wizardBare),
    "Add Sources must use the same quiet Button variant as Reinstall");
  ok(!/class="run-again"/.test(wizardBare), "the old bespoke Run again styling must be gone");
});

// area files ARE the areas.
check("every i18n area is in the orphan scan's AREAS list", () => {
  const dir = join(src, "i18n/strings");
  const onDisk = readdirSync(dir)
    .filter((f) => /\.ts$/.test(f) && !isLocaleFile(f))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
  eq(AREAS.slice().sort().join(","), onDisk.join(","),
    "AREAS must name exactly the English area files; a new area is invisible to the orphan scan until it is listed");
});
// Empty, and worth keeping that way: every key proven dead so far was simply deleted. An entry
// here is a claim that a scan cannot see a real use, not a way past a failing check.
const ALLOWLIST = {};
check("no area string is declared and never used", () => {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!p.includes("i18n/strings")) walk(p); }
      else if (/\.(svelte|ts)$/.test(e.name)) files.push(p);
    }
  };
  // App.svelte lives one level above src/lib -- scan the whole app source tree, not just lib/,
  // or a key reached only from App.svelte (deviceHeader.unsafeAria) reads as a false-positive
  // orphan.
  walk(join(here, "../src"));
  const body = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const dead = [];
  for (const area of AREAS) {
    const table = readFileSync(join(strings, `${area}.ts`), "utf8");
    for (const m of table.matchAll(/^\s{2,}([a-zA-Z][A-Za-z0-9_]*)\s*:/gm)) {
      const full = `${area}.${m[1]}`;
      if (ALLOWLIST[full]) continue;
      if (!new RegExp(`\\b${m[1]}\\b`).test(body)) dead.push(full);
    }
  }
  eq(dead.join(", "), "", "these keys are never referenced from src/ (delete them in all seven locales, or allow-list with a reason)");
});

if (failures.length) {
  console.error(`first run: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  x " + f);
  process.exit(1);
}
console.log(`first run: ${passed} checks passed`);
