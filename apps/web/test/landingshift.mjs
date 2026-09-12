/**
 * WHAT THE LANDING WIZARD ACTUALLY RENDERS AT EACH STEP.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/landingshift.mjs'
 *
 * WHY THIS EXISTS, in the owner's words: "the 'Manage Device (advanced) ->' and '<- Back' make
 * the UI shift upwards. I want those two to be added below and not shift the buttons."
 *
 * `App.svelte`'s `.landing` centres this column vertically (`justify-content: safe center`), so a
 * column that grows taller has its top edge pushed UP. Step 2 rendered two links that step 1 did
 * not, plus their two 28px gaps, so arriving at step 2 moved the choice cards the user was
 * reading. The artboards had it right all along and the code had dropped half of it:
 * `Landing1.dc.html:41` draws the back row EMPTY on step 1, and `Landing2.dc.html:41` draws the
 * same `space-between` row with `<- Back` in it. The row is meant to persist.
 *
 * So both controls are now rendered on BOTH steps and held with `visibility: hidden` where they
 * do not apply. That reserves the real control's real box -- including a second line if a longer
 * translation wraps at narrow width, which a hardcoded height could not follow.
 *
 * Step 2 is reached by flipping the initial value of the component's own `step` state in a copy of
 * the real source: `step` is internal, SSR renders the initial state, and no DOM library is
 * available in this container to mount and click. The rewrite is asserted to have applied exactly
 * once, so it cannot silently no-op and leave both halves asserting step 1.
 *
 * What is pinned:
 *   - both controls render on step 1 and on step 2, so neither step can drop the row;
 *   - on step 1 both are held, so the reserved space is never DRAWN as a placeholder;
 *   - on step 2 neither is held;
 *   - on step 1 both are disabled, so a held control's handler cannot fire;
 *   - `.held` is emitted as `visibility: hidden`, which reserves a box (`display: none` would not).
 *
 * THE SECOND, SMALLER SHIFT, also in the owner's words: "there's still a tiny shift. It occurs
 * when a language does NOT wrap around to a new line on the first 'Flash Memory' button."
 *
 * The two steps' choice rows are separately sized boxes whose height follows their own copy.
 * Step 2's `manageDeviceDesc` is two sentences in every locale and takes a second line at the
 * card's ~269px of content width; step 1's one-sentence `flashMemoryDesc` fits on one line in
 * en/ko/pt/ru and wraps in de/es/fr/it/ja/no/pl/uk. So in the first group the two steps differed
 * by exactly one line and the vertically centred column moved, and in the second they matched and
 * it did not -- precisely the language dependence reported.
 *
 * Both rows now occupy the SAME grid cell, so the stage is as tall as the taller of the two REAL
 * rows, measured from the real text at the real width. It declares no length of its own, which is
 * the point: a `min-height` in px could not follow a longer translation, a larger font or the
 * user's zoom. It also absorbs a third difference the previous pass noted but did not fix -- the
 * extra `unsupportedBrowser` line on a browser without WebUSB now sits inside a box step 1
 * reserves too.
 *
 * Also pinned:
 *   - both choice rows are laid out at BOTH steps, which is what reserves the height;
 *   - each step draws its own row and holds the other;
 *   - the two rows share ONE grid cell, so they overlay rather than stack (stacking would make
 *     the stage the SUM of both, which is worse than the bug);
 *   - every card in a held row is disabled;
 *   - the stage declares no height of its own.
 */
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
// CI installs from the repo root, so `apps/web/node_modules` may not exist; node still
// resolves the bundle's imports by walking up to the root install.
mkdirSync(join(web, "node_modules"), { recursive: true });
const out = mkdtempSync(join(web, "node_modules/.landingshift-"));
const failures = [];
let passed = 0;

const ok = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};

const SRC = join(web, "src/lib/views/Landing.svelte");
const source = readFileSync(SRC, "utf8");

// Step 2 by initial state. Narrow on purpose: it rewrites the ONE initializer and nothing else,
// and a miss is a hard error rather than a silently step-1 second half.
const STEP1_INIT = `let step = $state<'media' | 'action'>('media');`;
const STEP2_INIT = `let step = $state<'media' | 'action'>('action');`;
if (source.split(STEP1_INIT).length - 1 !== 1) {
  console.error(`landing shift: could not find the step initializer exactly once; the rewrite that renders step 2 is broken, so this suite cannot test what it claims to`);
  process.exit(1);
}
const step2Source = source.replace(STEP1_INIT, STEP2_INIT);

/** Landing reads `device.targetMedia`; the real store pulls in the whole engine (WebUSB, the
 *  flasher blobs) and none of it bears on which boxes this column reserves. */
const DEVICE_STUB = `export const device = { targetMedia: "flash" };`;

function sveltePlugin(overrideSource) {
  return {
    name: "svelte-ssr",
    setup(b) {
      b.onResolve({ filter: /device\.svelte\.js$/ }, () => ({ path: "device", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: DEVICE_STUB, loader: "js" }));
      b.onLoad({ filter: /\.svelte$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = a.path === SRC && overrideSource ? overrideSource : await fs.readFile(a.path, "utf8");
        return { contents: compile(src, { generate: "server", filename: a.path, runes: true }).js.code, loader: "js" };
      });
      b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = await fs.readFile(a.path, "utf8");
        const js = (await esbuild.transform(src, { loader: "ts", target: "es2022" })).code;
        const { compileModule } = await import("svelte/compiler");
        return { contents: compileModule(js, { generate: "server", filename: a.path }).js.code, loader: "js" };
      });
    },
  };
}

const { gnwResolve } = await import("./gnwResolve.mjs");

async function renderStep(label, overrideSource) {
  const dir = join(out, label);
  await esbuild.build({
    entryPoints: [SRC],
    outdir: dir, bundle: true, format: "esm", platform: "node", target: "es2022",
    external: ["svelte", "svelte/*"],
    plugins: [gnwResolve(join(here, ".")), sveltePlugin(overrideSource)],
    logLevel: "error",
  });
  const C = (await import(pathToFileURL(join(dir, "Landing.js")).href)).default;
  return render(C, { props: { onNavigate: () => {} } }).body;
}

/* Node has no `navigator.usb`, so `webusb` is false and step 2's "Manage device" card renders
   `disabled` for that reason alone -- which silently masked whether the HELD state disables it.
   A mutant dropping the held term from that card SURVIVED until this stub was added. With a
   WebUSB-capable navigator, `disabled` on a held card means held and nothing else. */
Object.defineProperty(globalThis, "navigator", { value: { usb: {} }, configurable: true, writable: true });

const step1 = await renderStep("s1", null);
const step2 = await renderStep("s2", step2Source);

// ARMED: if the navigator stub stops taking, `webusb` goes false again and every "a held card is
// disabled" assertion below starts passing for the wrong reason.
if (/unsupportedBrowser|Needs Chromium/.test(step2)) {
  console.error("landing shift: the WebUSB navigator stub did not take, so a held card's `disabled` cannot be told apart from an unsupported-browser `disabled`");
  process.exit(1);
}

// ARMED: if the rewrite did not actually change what rendered, every step-2 check below is a
// second copy of the step-1 checks and the suite would pass while step 2 was broken.
if (step1 === step2) {
  console.error("landing shift: step 1 and step 2 rendered identical markup, so the step-2 rewrite did not take");
  process.exit(1);
}

/** The whole opening tag of the element carrying `cls`, so `class:` output can be read off it. */
function tag(html, cls) {
  const at = html.indexOf(cls);
  if (at < 0) return null;
  const open = html.lastIndexOf("<", at);
  const close = html.indexOf(">", at);
  return open < 0 || close < 0 ? null : html.slice(open, close + 1);
}
const held = (html, cls) => {
  const t = tag(html, cls);
  return t === null ? null : / held|held /.test(t) || /"held"/.test(t);
};

function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`  FAIL ${name}: ${e.message}`); }
}

check("THE REPORTED SHIFT: step 1 reserves both links, so the cards do not move when step 2 draws them", () => {
  ok(tag(step1, "advanced-link") !== null,
    "step 1 renders no advanced link, so arriving at step 2 adds a row and pushes the choice cards up");
  ok(tag(step1, "back-btn") !== null,
    "step 1 renders no back row, so arriving at step 2 adds a row and pushes the choice cards up");
});

check("step 2 still draws both links", () => {
  ok(tag(step2, "advanced-link") !== null, "step 2 lost the advanced link");
  ok(tag(step2, "back-btn") !== null, "step 2 lost the back button");
});

check("step 1 HOLDS the reserved links rather than drawing them", () => {
  eq(held(step1, "advanced-link"), true, "step 1 draws the advanced link, which belongs to step 2");
  eq(held(step1, "back-btn"), true, "step 1 draws a Back control on the first step, where there is nothing to go back to");
});

check("step 2 draws its links for real", () => {
  eq(held(step2, "advanced-link"), false, "the advanced link is held on the step that owns it");
  eq(held(step2, "back-btn"), false, "the back button is held on the step that owns it");
});

check("a held control cannot be operated", () => {
  ok(/disabled/.test(tag(step1, "advanced-link") ?? ""),
    "the held advanced link is not disabled, so its handler can still fire");
  ok(/disabled/.test(tag(step1, "back-btn") ?? ""),
    "the held back button is not disabled, so its handler can still fire");
  ok(!/disabled/.test(tag(step2, "back-btn") ?? ""), "step 2's back button is disabled");
});

check("`.held` reserves a box instead of removing one", () => {
  const css = compile(source, { generate: "server", filename: SRC, runes: true }).css.code;
  const rule = /\.held[^{]*\{([^}]*)\}/.exec(css);
  ok(rule !== null, "the emitted CSS defines no `.held` rule, so nothing hides the reserved controls");
  ok(/visibility:\s*hidden/.test(rule[1]),
    `\`.held\` does not set \`visibility: hidden\`, so it cannot hold a box without drawing it: got ${JSON.stringify(rule[1].trim())}`);
  ok(!/display:\s*none/.test(rule[1]),
    "`.held` sets `display: none`, which removes the box entirely and reinstates the shift it exists to stop");
});

check("the back row keeps the artboards' own shape", () => {
  const css = compile(source, { generate: "server", filename: SRC, runes: true }).css.code;
  const rule = /\.backrow[^{]*\{([^}]*)\}/.exec(css);
  ok(rule !== null, "the emitted CSS defines no `.backrow` rule");
  ok(/padding-top:\s*4px/.test(rule[1]),
    `Landing1.dc.html:41 and Landing2.dc.html:41 both draw this row with \`padding-top: 4px\`: got ${JSON.stringify(rule[1].trim())}`);
});

/** Every `.choices` opening tag, in document order: the media row then the action row. */
function choiceRows(html) {
  // `choices-stage` also begins with "choices": require a separator right after it.
  const re = /<div class="choices[ "][^>]*>/g;
  const tags = [];
  let m;
  while ((m = re.exec(html)) !== null) tags.push(m[0]);
  return tags;
}
const isHeld = (t) => /\bheld\b/.test(t);

/** The opening tags of every `<button class="choice">` inside the held row. */
function heldRowCards(html) {
  const rows = choiceRows(html);
  const heldIdx = rows.findIndex(isHeld);
  if (heldIdx < 0) return null;
  const start = html.indexOf(rows[heldIdx]) + rows[heldIdx].length;
  // Bounded by the NEXT row where there is one, otherwise to the end and filtered to cards: the
  // advanced-link and back buttons also sit after the last row and are not cards.
  const next = heldIdx + 1 < rows.length ? html.indexOf(rows[heldIdx + 1]) : -1;
  const slice = html.slice(start, next < 0 ? undefined : next);
  return [...slice.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((t) => /class="choice[ "]/.test(t));
}

check("THE TINY SHIFT: both choice rows are laid out at both steps, so the stage keeps the taller height", () => {
  eq(choiceRows(step1).length, 2,
    "step 1 lays out only its own choice row, so the stage shrinks to it and the cards move when step 2's taller row arrives");
  eq(choiceRows(step2).length, 2,
    "step 2 lays out only its own choice row, so the stage grows to it and the cards move on the way in");
});

check("each step draws its own row and holds the other", () => {
  eq(choiceRows(step1).map(isHeld), [false, true],
    "step 1 does not draw exactly its own row: the media row must be drawn and the action row held");
  eq(choiceRows(step2).map(isHeld), [true, false],
    "step 2 does not draw exactly its own row: the action row must be drawn and the media row held");
});

check("the two rows OVERLAY in one grid cell rather than stacking", () => {
  const css = compile(source, { generate: "server", filename: SRC, runes: true }).css.code;
  const stage = /\.choices-stage[^{>]*\{([^}]*)\}/.exec(css);
  ok(stage !== null, "the emitted CSS defines no `.choices-stage` rule, so the two rows are not staged at all");
  ok(/display:\s*grid/.test(stage[1]),
    `the stage is not a grid, so its two rows stack vertically and the held one adds its full height instead of overlapping: got ${JSON.stringify(stage[1].trim())}`);
  const cell = /\.choices-stage[^{]*>\s*\.choices[^{]*\{([^}]*)\}/.exec(css);
  ok(cell !== null, "no rule places the rows in a shared grid cell");
  ok(/grid-area:\s*1\s*\/\s*1/.test(cell[1]),
    `the rows are not placed in the same cell, so grid gives each its own row and the stage becomes the SUM of both instead of the taller: got ${JSON.stringify(cell[1].trim())}`);
});

check("every card in a held row is disabled, on both steps", () => {
  for (const [label, html] of [["step 1", step1], ["step 2", step2]]) {
    const cards = heldRowCards(html);
    ok(cards !== null && cards.length === 2,
      `${label}: expected two cards in the held row, got ${cards === null ? "no held row" : cards.length}`);
    for (const c of cards) {
      ok(/disabled/.test(c),
        `${label}: a card in the held row is not disabled, so a card the user cannot see is still focusable and clickable: ${c}`);
    }
  }
});

check("the reserved height follows the text, so the stage carries no length of its own", () => {
  const css = compile(source, { generate: "server", filename: SRC, runes: true }).css.code;
  const stage = /\.choices-stage[^{>]*\{([^}]*)\}/.exec(css);
  ok(!/height:/.test(stage[1]),
    `the stage declares a height, which cannot follow a longer translation, a larger font or the user's zoom -- the whole reason both real rows are laid out: got ${JSON.stringify(stage[1].trim())}`);
});

rmSync(out, { recursive: true, force: true });
if (failures.length) {
  console.error(`landing shift: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`landing shift: ${passed} checks passed`);
