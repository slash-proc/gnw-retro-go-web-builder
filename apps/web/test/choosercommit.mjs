/**
 * CHOOSING COMMITS, IT DOES NOT NAVIGATE.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/choosercommit.mjs'
 *
 * ChooseAndSee draws the choices and the plan they produce side by side. Clicking a card must
 * COMMIT that choice inside the layout the user is already reading: the cards stay, the picked
 * one reads as picked, and the right-hand column stops being an inert preview and becomes the
 * live spine. Nothing slides, swaps or replaces.
 *
 * THE BUG THIS EXISTS FOR. The first implementation kept the two-page model underneath: a
 * `{#if path === null}` / `{:else}` exchanged the whole chooser for a second layout of the same
 * information, with a Back button to return. The owner: "if you click on a button it still moves
 * to a new page". Every gate was green while that was true, including the 16 checks in
 * `chooserstates.mjs` -- because those all render the page with nothing chosen, which is the one
 * state the bug did not touch.
 *
 * AND THE LAYOUT ITSELF. `.wizard-container` was pinned at 470px while the two-column stage needs
 * the cards (360) plus two gutters (48) plus the divider (1) plus the spine's measure (470). The
 * columns were crushed into 55% of their width: "the guided setup page is all messed up". So this
 * suite reads the EMITTED stylesheet for the widths rather than reasoning about the source, the
 * way `optionsmodal.mjs` does -- Svelte's `:where()` scoping carries zero specificity and reading
 * source has produced wrong answers about this file before.
 *
 * HOW A CHOSEN PATH IS RENDERED. `path` is component-internal, SSR renders initial state, and no
 * DOM library is available here to mount and click. So the one `path` initializer is rewritten in
 * a copy of the real source, exactly as `landingshift.mjs` reaches its step 2. Two armed guards
 * keep that honest: the rewrite must match exactly once, and the two renders must differ.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
const out = mkdtempSync(join(web, "node_modules/.choosercommit-"));
const failures = [];
let passed = 0;

const ok = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};

const SRC = join(web, "src/lib/views/Wizard.svelte");
const source = readFileSync(SRC, "utf8");

// ── The chosen-path rewrite ──────────────────────────────────────────────────────────────
// Narrow on purpose: the ONE initializer and nothing else.
const PATH_INIT = 'let path = $state<WizardPath | null>(null);';
const PATH_CHOSEN = 'let path = $state<WizardPath | null>("rgo");';
if (source.split(PATH_INIT).length - 1 !== 1) {
  console.error(
    "chooser commit: could not find the path initializer exactly once; the rewrite that renders a " +
    "chosen path is broken, so this suite cannot test what it claims to",
  );
  process.exit(1);
}
const chosenSource = source.replace(PATH_INIT, PATH_CHOSEN);

// `rgoNeedsBackup` is latched by `choose()`, which the rewrite never runs. The spine's shape is
// `chooserstates.mjs`'s business; this suite is about the page not being replaced, so the default
// latch value is fine and is not asserted on here.

const DEVICE_STUB = `
const d = () => globalThis.__CHOOSER_DEVICE__ ?? {};
export const device = {
  get deviceClass() { return d().deviceClass ?? null; },
  get extSizeMB() { return d().extSizeMB ?? null; },
  get backupTaken() { return d().backupTaken ?? false; },
  get partitions() { return d().partitions ?? []; },
  get banks() { return d().banks ?? []; },
  get isConnected() { return true; },
  get info() { return null; },
  get model() { return "zelda"; },
  get targetMedia() { return "flash"; },
  get installedGames() { return []; },
  get sdHandle() { return null; },
  get transport() { return null; },
  get extFlashBytes() { return 0; },
  ensureStub: async () => { throw new Error("not in this suite"); },
  ensureUnlocked: async () => {},
  markBackupTaken: () => {},
  runScan: async () => {},
  suspendPoll: () => {},
  resumePoll: () => {},
};
export const modelLabel = (m) => String(m ?? "");
`;

function sveltePlugin(overrideFor) {
  return {
    name: "svelte-ssr",
    setup(b) {
      b.onResolve({ filter: /device\.svelte\.js$/ }, () => ({ path: "device", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: DEVICE_STUB, loader: "js" }));
      b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "urlstub" }));
      b.onLoad({ filter: /.*/, namespace: "urlstub" }, () => ({ contents: 'export default "stub:";', loader: "js" }));
      b.onResolve({ filter: /^@webstlink\// }, (a) => ({ path: a.path, namespace: "wsl" }));
      b.onLoad({ filter: /.*/, namespace: "wsl" }, () => ({ contents: "export default {}; export const Logger = class {};", loader: "js" }));
      b.onLoad({ filter: /\.svelte$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = a.path === SRC && overrideFor ? overrideFor : await fs.readFile(a.path, "utf8");
        return { contents: compile(src, { generate: "server", filename: a.path, runes: true }).js.code, loader: "js" };
      });
      b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const js = (await esbuild.transform(await fs.readFile(a.path, "utf8"), { loader: "ts", target: "es2022" })).code;
        return { contents: compileModule(js, { generate: "server", filename: a.path }).js.code, loader: "js" };
      });
    },
  };
}

const { gnwResolve } = await import("./gnwResolve.mjs");

async function buildWith(overrideSource, tag) {
  const dir = join(out, tag);
  await esbuild.build({
    entryPoints: [SRC],
    outdir: dir, bundle: true, format: "esm", platform: "node", target: "es2022",
    external: ["svelte", "svelte/*"],
    loader: { ".png": "dataurl", ".svg": "dataurl" },
    plugins: [gnwResolve(join(here, ".")), sveltePlugin(overrideSource)],
    logLevel: "error",
  });
  return (await import(pathToFileURL(join(dir, "Wizard.js")).href)).default;
}

const RETROGO = { kind: "retrogo-sd", ofw: { patched: true } };
const STATE = { deviceClass: RETROGO, extSizeMB: 32 };

const Unchosen = await buildWith(null, "unchosen");
const Chosen = await buildWith(chosenSource, "chosen");

function draw(Component) {
  globalThis.__CHOOSER_DEVICE__ = STATE;
  return render(Component, { props: {} }).body;
}

const before = draw(Unchosen);
const after = draw(Chosen);

// ARMED: if the rewrite did not change what rendered, every "after" check below is vacuous.
if (before === after) {
  console.error("chooser commit: the unchosen and chosen renders are identical, so the rewrite did not take");
  process.exit(1);
}

// ── The emitted stylesheet, for the width facts ──────────────────────────────────────────
const rawCss = compile(source, { generate: "client", filename: SRC, runes: true }).css.code;
/**
 * The stylesheet with Svelte's scoping removed, so a selector can be written the way it appears
 * in the component.
 *
 * WHY NORMALISE RATHER THAN MATCH THE SCOPED FORM. The suffix lands in three different places:
 * after a single class (`.choice.svelte-x`), after a whole COMPOUND
 * (`.wizard-container.two-col.svelte-x`, not after the first class), and as `:where(.svelte-x)`
 * on the descendant half of a combinator. A first version of this suite guessed the first shape
 * and reported two live rules as missing; the `:where()` form carries zero specificity and has
 * misled work on this file before. Stripping both spellings once removes the whole class of
 * mistake instead of encoding one of its cases.
 */
const css = rawCss
  .replace(/\/\*[\s\S]*?\*\//g, "")            // comments first: they sit between rules
  .replace(/:where\(\.svelte-[a-z0-9]+\)/g, "")
  .replace(/\.svelte-[a-z0-9]+/g, "");
/**
 * ANCHORED at the start of a rule, which is not a nicety. Unanchored, `.plan-col` matches the
 * DESCENDANT rule `.chooser-stage.has-preview .plan-col` that happens to be written first, and
 * this suite then reads one rule's declarations while believing it read another's -- it reported
 * the plan column as having no width when the width was there. A selector must be the whole
 * selector, so it has to begin where a rule begins.
 */
function rule(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const m = css.match(new RegExp("(?:^|})\\s*" + esc + "\\s*\\{([^}]*)\\}"));
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e.message}`); }
}

// ─────────────────────────────────────────────────────────────────────────────────────────

check("THE REPORTED BUG: choosing does not replace the page", () => {
  // The cards are the layout. If they are gone after a choice, the page was swapped for another
  // one -- which is exactly what the user saw and reported.
  const cardsBefore = (before.match(/class="choice[ "]/g) ?? []).length;
  const cardsAfter = (after.match(/class="choice[ "]/g) ?? []).length;
  ok(cardsBefore > 0, "the unchosen page draws no cards at all, so this check is testing nothing");
  eq(cardsAfter, cardsBefore,
    "the cards do not survive a choice, so choosing replaced the page instead of committing inside it");
  for (const cls of ["chooser-stage", "chooser-col", "plan-col", "chooser-title"]) {
    ok(before.includes(cls), `the unchosen page has no .${cls}, so this check is testing nothing`);
    ok(after.includes(cls), `.${cls} is gone after a choice, so the layout was replaced rather than filled`);
  }
});

check("the plan column gains controls rather than the page gaining a new one", () => {
  const planBefore = subtree(before, 'class="plan-col');
  const planAfter = subtree(after, 'class="plan-col');
  ok(planBefore !== null && planAfter !== null, "the plan column is missing from one of the two renders");
  ok(!/<button/.test(planBefore), "the preview draws a button, which would act on a path not chosen");
  ok(/<button/.test(planAfter),
    "the plan column has no controls after a choice, so the spine did not become live in place");
});

check("the preview is inert only while nothing is chosen", () => {
  ok(/is-preview/.test(before), "the plan column is not marked as a preview while nothing is chosen");
  ok(!/is-preview/.test(after), "the plan column is still marked as a preview after a choice");
  const head = (h) => h.slice(Math.max(0, h.indexOf('class="plan-col') - 200), h.indexOf('class="plan-col') + 220);
  ok(/aria-hidden/.test(head(before)), "the preview is not aria-hidden, so a reader walks inert step titles");
  ok(!/aria-hidden="true"/.test(head(after)),
    "the live spine is still aria-hidden, so its real controls are hidden from a screen reader");
});

check("the picked card reads as picked, and only after a choice", () => {
  ok(!/class="choice[^"]*picked/.test(before), "a card reads as picked before anything was chosen");
  ok(/class="choice[^"]*picked/.test(after), "no card reads as picked after a choice");
  eq((after.match(/class="choice[^"]*picked/g) ?? []).length, 1, "more than one card reads as picked");
  ok(/aria-pressed="true"/.test(after), "the picked card does not carry aria-pressed, so a reader cannot tell");
});

check("no Back button survives: there is no second page to go back to", () => {
  ok(!/class="back"/.test(before) && !/class="back"/.test(after),
    "a Back control is still drawn, which is the two-page model this redesign removed");
});

check("no pips: two pips describing two pages are a lie once there is one page", () => {
  ok(!/class="pips?[ "]/.test(before) && !/class="pips?[ "]/.test(after),
    "the step pips are still drawn, and they claim a two-step flow the page no longer has");
});

check("THE CRUSHED LAYOUT: the two-column stage gets the width it needs", () => {
  const one = rule(".wizard-container");
  const two = rule(".wizard-container.two-col");
  ok(one !== null, "no .wizard-container rule in the emitted stylesheet");
  ok(two !== null,
    "the container has no two-column width, so the stage is pinned at the single-column measure and the columns are crushed");
  ok(/width:\s*470px/.test(one), `the single-column container is not 470px: ${one}`);
  // Every term of the sum, so a change to one cannot silently leave the rest behind.
  for (const term of ["360px", "48px", "470px"]) {
    ok(two.includes(term), `the two-column width does not include ${term}: ${two}`);
  }
});

check("the stage's parts add up to the container it sits in", () => {
  const card = rule(".choice");
  const stage = rule(".chooser-stage");
  const plan = rule(".plan-col");
  const divider = rule(".chooser-stage.has-preview .plan-col");
  const px = (decls, prop) => {
    const m = decls && decls.match(new RegExp(`(?:^|[;{ ])${prop}:\\s*(\\d+)px`));
    return m ? Number(m[1]) : null;
  };
  const cardW = px(card, "width"), gap = px(stage, "gap");
  const planW = px(plan, "inline-size"), pad = px(divider, "padding-inline-start");
  ok(cardW && gap && planW && pad,
    `could not read the stage's widths: card=${cardW} gap=${gap} plan=${planW} pad=${pad}`);
  eq(gap, pad, "the stage's gap and the divider's padding differ, so the two gutters are uneven");
  const need = cardW + gap + pad + 1 + planW;
  const two = rule(".wizard-container.two-col");
  // Named, not left to crash on null: without this the missing-width mutant reports a TypeError
  // from `matchAll` instead of the fact that the two-column width is gone.
  ok(two !== null,
    `the container has no two-column width, so nothing can add up to it (the stage needs ${need}px)`);
  const sum = [...two.matchAll(/(\d+)px(?:\s*\*\s*(\d+))?/g)]
    .reduce((n, m) => n + Number(m[1]) * (m[2] ? Number(m[2]) : 1), 0);
  eq(sum, need,
    `the container's two-column width does not match what the stage needs (card ${cardW} + gutters ${gap}+${pad} + divider 1 + plan ${planW})`);
});

/** The inner HTML of the element carrying `cls`, found by walking tag depth. */
function subtree(html, cls) {
  const at = html.indexOf(cls);
  if (at === -1) return null;
  const open = html.indexOf(">", at);
  if (open === -1) return null;
  let depth = 1, i = open + 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div", i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
    else { depth--; if (depth === 0) return html.slice(open + 1, nextClose); i = nextClose + 5; }
  }
  return null;
}

if (failures.length) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(`chooser commit: ${failures.length} FAILED, ${passed} passed`);
  process.exit(1);
}
console.log(`chooser commit: ${passed} checks passed`);
