#!/usr/bin/env node
/**
 * The captured screen is drawn at the device's own resolution: EXACTLY 320x240.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/screenshotsize.mjs'
 *
 * `engine/screenshot.ts` reads a 320x240 framebuffer and even repairs a 319/239 readback, so
 * the image always has 76800 pixels. Drawing it at any other size is a resample:
 * `image-rendering: pixelated` keeps the edges hard but cannot put back what scaling removed,
 * which is why it looked sharp and was still wrong. The rule was `width: 100%`, so the shot
 * was whatever width the sidebar happened to be.
 *
 * CSS geometry is the one thing no gate in this repo can see rendered -- there is no headless
 * browser in the dev container. So this asserts the declarations, not the painted result: it
 * cannot prove the box measures 320x240 on screen, only that nothing has quietly replaced the
 * rule that makes it so. That is worth having anyway, because `width: 100%` is exactly the kind
 * of edit that looks harmless in a diff.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const SRC = join(here, "../src/lib/views/OverviewTab.svelte");
const src = readFileSync(SRC, "utf8");

/** One rule's body. Comments are stripped first: a `}` inside a comment truncates the match. */
function ruleBody(selector) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = clean.indexOf(`${selector} {`);
  ok(at >= 0, `no \`${selector}\` rule in OverviewTab.svelte`);
  const end = clean.indexOf("}", at);
  ok(end > at, `\`${selector}\` rule is unterminated`);
  return clean.slice(at + selector.length + 2, end);
}

const NATIVE = { width: 320, height: 240 };

check("the capture area is exactly the device's panel", () => {
  const body = ruleBody(".screenshot-area");
  ok(new RegExp(`width:\\s*${NATIVE.width}px`).test(body),
    `.screenshot-area must be exactly ${NATIVE.width}px wide: ${JSON.stringify(body.trim())}`);
  ok(new RegExp(`height:\\s*${NATIVE.height}px`).test(body),
    `.screenshot-area must be exactly ${NATIVE.height}px tall: ${JSON.stringify(body.trim())}`);
});

check("the border sits outside the panel, not inside it", () => {
  const body = ruleBody(".screenshot-area");
  // This app sets `box-sizing: border-box` globally (styles/global.css), so a declared 320px
  // with a 1px border paints 318 content pixels. The first version of this fix had exactly
  // that bug and looked right in the diff.
  ok(/box-sizing:\s*content-box/.test(body),
    "without `box-sizing: content-box` the 1px border eats into the 320x240 and the panel renders 318x238");
});

check("nothing stretches or caps the area", () => {
  const body = ruleBody(".screenshot-area");
  ok(!/(^|[^-])width:\s*100%/.test(body),
    "`width: 100%` is back on .screenshot-area, so the shot is the sidebar's width again");
  // A cap here cannot help and did real harm: the dock is display:none below 1200px, so it can
  // never rescue a narrow viewport, and at a 260px column it silently shrank the panel to 220.
  ok(!/max-width/.test(body),
    "a max-width on .screenshot-area can only shrink the panel below 320; fix the column instead");
});

check("the column is wide enough to hold the panel", () => {
  // THE REAL FAILURE. The rule said 320px and the panel rendered 220, because the grid column
  // was 260px and `.screendock` spends `--page-pad-x` of it on a right gutter. Nothing about
  // the .screenshot-area rule was wrong, so checking only that rule proved nothing.
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const col = clean.match(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*(\d+)px/);
  ok(col, "no fixed screendock column found in .overview");
  const pad = readFileSync(join(here, "../src/styles/tokens.css"), "utf8")
    .match(/--page-pad-x:\s*(\d+)px/);
  ok(pad, "no --page-pad-x in tokens.css");
  const content = Number(col[1]) - Number(pad[1]);
  ok(content === NATIVE.width,
    `the dock column leaves ${content}px for a ${NATIVE.width}px panel `
    + `(column ${col[1]}px minus --page-pad-x ${pad[1]}px); the capture will not be ${NATIVE.width} wide`);
});

check("the image fills the area without distorting", () => {
  const body = ruleBody(".screenshot-area img");
  ok(/object-fit:\s*contain/.test(body),
    "the image must letterbox rather than stretch when the area is capped by max-width");
  ok(/image-rendering:\s*pixelated/.test(body),
    "a 320x240 panel must not be smoothed");
  ok(!/height:\s*auto/.test(body),
    "`height: auto` lets the image set its own height, defeating the fixed area");
});

check("the pinned size is the size the engine actually produces", () => {
  // ARMED: if the engine's repair constants ever change, this file is wrong, not the CSS.
  const eng = readFileSync(join(here, "../src/lib/engine/screenshot.ts"), "utf8");
  ok(eng.includes(`width  = ${NATIVE.width}`) && eng.includes(`height = ${NATIVE.height}`),
    `engine/screenshot.ts no longer normalises to ${NATIVE.width}x${NATIVE.height}; the CSS pin is stale`);
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`screenshot size: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
