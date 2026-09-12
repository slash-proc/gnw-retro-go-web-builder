#!/usr/bin/env node
// Guard: every body region inside Sources.svelte's `.pagecol` sits in a scroll region.
//
//   docker compose exec dev sh -c 'cd /app/apps/web && node test/panescroll.mjs'
//
// WHY THIS EXISTS. The owner reported the page's footer bar painting over an open "Used by"
// menu. The menu was not at fault and neither was its height cap. The pane's column is:
//
//   .tabpane.docked   flex: 1; min-height: 0; overflow-y: auto      <- the page's one scroller
//     section.split   display: grid; flex: 1; min-height: 0
//       .sources      display: flex; column; flex: 1; min-height: 0
//         .pagecol    flex: 1 1 auto; min-height: 0                 <- CANNOT GROW, DOES NOT CLIP
//         footer.bar  flex: 0 0 auto; margin-top: auto; background  <- opaque, painted later
//
// `min-height: 0` is what lets `.pagecol` shrink below its own content, and with `overflow`
// left visible that content spills downward instead of scrolling. `.bar` is a LATER sibling
// with an opaque background, and CSS paints in-flow siblings in document order, so the spill
// went under the bar and was unreachable. Two of the four pane bodies (`.dbody`, `.listregion`)
// already claimed the slack height and scrolled internally, so they never showed it; the three
// that rendered straight into `.pagecol` -- the folder list, the add/edit folder form and the
// cache pane -- had no scroll region at all. A long folder list did this on its own, with no
// menu open.
//
// No other gate in this repo can see it: svelte-check, `vite build` and every suite pass on a
// page whose content is hidden behind the footer. Pixel geometry needs a browser and there is
// none in the dev container, so what is checked here is the STRUCTURAL invariant that the
// geometry follows from -- a body region rendered into a non-growing, non-clipping flex column
// above an opaque pinned bar must be able to scroll itself.
//
// Cost: one read of one file. ~5 ms.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(HERE, "../src/lib/views/Sources.svelte");

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const src = fs.readFileSync(SOURCES, "utf8");
assert(src.length > 0, "Sources.svelte is empty");

// --- the style block, as a map of class -> declarations -----------------------------------
const styleAt = src.indexOf("<style>");
assert(styleAt > 0, "Sources.svelte has no <style> block");
// COMMENTS ARE STRIPPED FIRST, not after. A `}` inside a CSS comment (this file's own
// `.bar` rule quotes "`.tabpane.docked { padding-bottom: 0 }`") ends a `[^}]*` match early
// and silently truncates the declarations, which read here as ".bar is no longer opaque".
// Same class of parser trap that conformance-counts.mjs documents for markdown tables.
const css = src.slice(styleAt).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of a single-class rule. */
function ruleBody(cls) {
  const re = new RegExp(`(^|[,}\\n])\\s*\\.${cls}\\s*\\{([^}]*)\\}`, "m");
  const m = re.exec(css);
  return m ? m[2] : null;
}
const scrolls = (cls) => {
  const body = ruleBody(cls);
  return body !== null && /overflow-y:\s*auto/.test(body);
};

// --- the precondition: why a scroll region is REQUIRED rather than merely tidy -------------
check("`.pagecol` cannot grow past the viewport and does not clip", () => {
  const body = ruleBody("pagecol");
  assert(body !== null, ".pagecol rule not found -- the pane was restructured, re-derive this");
  assert(/flex:\s*1\s+1\s+auto/.test(body), ".pagecol is no longer `flex: 1 1 auto`");
  assert(/min-height:\s*0/.test(body), ".pagecol is no longer `min-height: 0`");
  // If .pagecol ever clips or scrolls itself, the per-branch regions below stop being the
  // mechanism and this guard's reasoning has to be rewritten rather than silently kept.
  assert(!/overflow/.test(body), ".pagecol now sets overflow -- re-derive this guard");
});

check("the footer bar is an in-flow later sibling with an opaque background", () => {
  const body = ruleBody("bar");
  assert(body !== null, ".bar rule not found");
  assert(/margin-top:\s*auto/.test(body), ".bar no longer pins itself with margin-top: auto");
  assert(/background:\s*var\(--surface\)/.test(body), ".bar is no longer opaque");
  assert(
    src.indexOf('<footer class="bar">') > src.indexOf('<div class="pagecol">'),
    ".bar must come after .pagecol in document order for this to be the paint bug it was",
  );
});

// --- the invariant ------------------------------------------------------------------------
// Walk the `.pagecol` region tracking the stack of open <div class="...">, and record which
// classes enclose each pane body. Only <div> is tracked: the markers are component tags and
// one <div class="list">, and Svelte markup is textually balanced.
const pagecolAt = src.indexOf('<div class="pagecol">');
assert(pagecolAt > 0, "`.pagecol` wrapper not found");
const markup = src.slice(pagecolAt, styleAt);

/**
 * Class names enclosing the first occurrence of `marker`, outermost first, INCLUDING the
 * marker's own class when it is itself a classed div. `.dbody` is its own scroll region
 * rather than a child of one, so a strictly-ancestor walk would report it as unprotected.
 */
function enclosing(marker) {
  const target = markup.indexOf(marker);
  if (target < 0) return null;
  const own = /^<div class="([^"]*)"/.exec(marker);
  const stack = [];
  const tag = /<div\b([^>]*)>|<\/div\s*>/g;
  let m;
  while ((m = tag.exec(markup)) !== null) {
    if (m.index >= target) break;
    if (m[0].startsWith("</")) stack.pop();
    else {
      const cls = /class="([^"]*)"/.exec(m[1] ?? "");
      stack.push(cls ? cls[1].trim() : "");
    }
  }
  if (own) stack.push(own[1].trim());
  return stack;
}

// Every pane body rendered inside `.pagecol`. If a branch is added to the pane and not listed
// here, `panebodies covers every branch` below fails rather than the new branch going unchecked.
const BODIES = [
  ["the add/edit folder form", "<AddLocalFolder"],
  ["the SD card pane", "<SdCardPane"],
  ["the cache pane", "<CachePane"],
  ["the local folder list", "<LocalFolders"],
  ["the add-source page", "<AddSource"],
  ["the remote source list", '<div class="list">'],
  ["the source detail body", '<div class="dbody">'],
];

for (const [name, marker] of BODIES) {
  check(`${name} is inside a scroll region`, () => {
    const stack = enclosing(marker);
    assert(stack !== null, `${marker} not found in the pane markup`);
    const scroller = stack.find((cls) => cls.split(/\s+/).some(scrolls));
    assert(
      scroller !== undefined,
      `nothing enclosing it scrolls; enclosing classes were [${stack.join(" > ")}] ` +
        `-- its content will spill out of .pagecol and the footer bar will paint over it`,
    );
  });
}

check("panebodies covers every branch the pane renders", () => {
  // ARMED: the enclosure check above can only police branches this file knows about, so a new
  // component dropped into the pane would be invisible to it. Every capitalised component tag
  // and every region div inside `.pagecol` must appear in BODIES.
  const known = new Set(BODIES.map(([, marker]) => marker));
  const found = new Set();
  for (const m of markup.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) found.add(`<${m[1]}`);
  // Components that are not pane bodies: they sit inside one, or draw chrome in the bar.
  // `AdditionalFiles` and `SourceFolders` are drawn INSIDE `.dbody`, which is itself the
  // scroll region for the detail branch, so they are not pane bodies in their own right.
  const NOT_A_BODY = new Set([
    "<Button", "<StatPanel", "<Badge", "<InfoTip", "<Card", "<UsedBySelect",
    "<AdditionalFiles", "<SourceFolders",
  ]);
  const missing = [...found].filter((t) => !known.has(t) && !NOT_A_BODY.has(t));
  assert(
    missing.length === 0,
    `component(s) rendered in the pane but not covered: ${missing.join(", ")} ` +
      `-- add to BODIES (a pane body) or NOT_A_BODY (chrome/nested), do not ignore`,
  );
});

console.log(`\npanescroll: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
