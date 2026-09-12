#!/usr/bin/env node
/**
 * The Library's additional-options modal is a tabbed control.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/optionsmodal.mjs'
 *
 * This file used to pin the opposite arrangement: Cover art, Saves and Cheats SIDE BY SIDE as
 * three weighted columns, with Saves narrowest, Cheats widest and the spread bounded under 1.5.
 * That premise is gone. The approved boards (`docs/design/mockups/LibraryComposedOptions.dc.html`
 * and its `…Saves` / `…Cheats` siblings) draw one section at a time under a tab strip, and the
 * owner reported the shipped side-by-side grid as the defect. A column-weight guard cannot be
 * satisfied by a layout with one column, so the three weight checks were DELETED rather than
 * loosened -- there is nothing left for them to be about. What replaced them pins what the
 * tabbed arrangement means instead:
 *
 *   - three tabs exist, and exactly one panel is rendered at a time (not three with two hidden)
 *   - the strip is a real ARIA tablist, keyboard-operable, each panel tied to its tab
 *   - Cheats still holds presets AND manual entry AND the configured list. A tab is not
 *     permission to trim a section; cheats are a device feature like saves.
 *   - the modal keeps ONE width across all three tabs, so switching tab does not resize it
 *   - tabs are the `bare` (modal) arrangement only, never forced on the accordion default
 *
 * The two width checks at the end are carried over unchanged, because they were never about the
 * columns: the modal's own maxWidth bound, and ModalShell's shared default staying untouched.
 *
 * Nothing here has been rendered; this is arithmetic and structure over declared source.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const read = (p) => readFileSync(join(here, "../src/lib", p), "utf8");
/** Comments stripped first: a `}` inside one truncates every rule match after it. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
const panel = strip(read("views/GameDetailsPanel.svelte"));
const tab = strip(read("views/RomManagementTab.svelte"));
const shell = strip(read("ui/ModalShell.svelte"));

const TABS = ["cover", "saves", "cheats"];

check("the modal draws a tab strip, not three side-by-side panels", () => {
  ok(/role="tablist"/.test(panel), "no role=\"tablist\" in the options panel -- the sections are not tabs");
  eq((panel.match(/role="tab"/g) ?? []).length, 1,
    "expected exactly one role=\"tab\" button template (the strip is an {#each} over the tab ids), "
    + "not one hand-written button per section");
  const at = panel.indexOf('role="tablist"');
  ok(panel.slice(0, at).includes("{#if bare}"),
    "the tab strip is not gated on `bare`; the accordion default would grow a tablist too");
});

check("the tab ids are exactly the three sections", () => {
  const m = panel.match(/const TAB_IDS\s*:[^=]*=\s*\[([^\]]+)\]/);
  ok(m, "TAB_IDS is gone; re-derive this guard against whatever replaced it");
  const ids = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  eq(ids.join(","), TABS.join(","),
    "the modal's tabs are cover art, saves and cheats, in that order");
});

check("exactly one panel is rendered at a time", () => {
  // The point of the whole change. Three panels with two display:none'd is not a tab control,
  // it is three headings the user cannot see -- so the gate must be an {#if} around the markup.
  for (const id of TABS) {
    const guard = new RegExp(`\\{#if !bare \\|\\| activeTab === "${id}"\\}`);
    ok(guard.test(panel),
      `the ${id} panel is not gated on activeTab; either it always renders (all three at once) `
      + "or it is hidden with CSS, which leaves it in the accessibility tree and the tab order");
    ok(new RegExp(`id=\\{bare \\? "opt-panel-${id}"`).test(panel),
      `the ${id} panel has no tabpanel id, so its tab's aria-controls points at nothing`);
  }
  ok(!/display:\s*none/.test(panel.slice(panel.indexOf(".opt-tabs"), panel.indexOf(".opt-tabs") + 400)),
    "the tab strip hides something with display:none; tabs switch by not rendering, not by hiding");
});

check("each panel is a tabpanel named by its own tab", () => {
  eq((panel.match(/role=\{bare \? "tabpanel" : undefined\}/g) ?? []).length, 3,
    "expected three conditional role=\"tabpanel\" panels");
  eq((panel.match(/aria-labelledby=\{bare \? "opt-tab-/g) ?? []).length, 3,
    "a tabpanel with the heading hidden is unnamed unless it points back at its tab");
});

check("the strip is keyboard-operable", () => {
  ok(/tabindex=\{activeTab === id \? 0 : -1\}/.test(panel),
    "no roving tabindex: every tab would be a separate tab stop, which is not the tabs pattern");
  ok(/onkeydown=\{\(e\) => onTabKey\(e, id\)\}/.test(panel), "the tabs have no keydown handler");
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    ok(panel.includes(`"${key}"`), `onTabKey does not handle ${key}`);
  }
  ok(/aria-selected=\{activeTab === id\}/.test(panel), "no aria-selected on the tabs");
  ok(/\.focus\(\)/.test(panel), "arrow keys move selection without moving focus to the new tab");
});

check("the active tab is visibly active, not only announced", () => {
  const at = panel.indexOf(".opt-tab.active");
  ok(at >= 0, "no .opt-tab.active rule: the selected tab looks identical to the others");
  const body = panel.slice(at, panel.indexOf("}", at));
  ok(/box-shadow:\s*inset 0 -3px 0/.test(body),
    `the active tab has no inset underline (boards: box-shadow: inset 0 -3px 0): ${body.trim()}`);
  ok(/font-weight:\s*700/.test(body), "the active tab is not bolder than its peers");
});

check("Cheats keeps presets, manual entry and the configured list", () => {
  // The section was not trimmed to fit a tab. All three parts are the feature.
  const at = panel.indexOf('activeTab === "cheats"');
  ok(at >= 0, "the cheats panel gate is gone");
  const body = panel.slice(at);
  for (const [what, re] of [
    ["the preset list", /cheats\.presets|presetLabel|presets\b/],
    ["manual entry", /cheats\.manual|manualCode|addManual/i],
    ["the configured count", /configuredCheat/],
  ]) {
    ok(re.test(body), `the cheats tab no longer draws ${what}`);
  }
});

check("the modal keeps one width across all three tabs", () => {
  // The boards draw the same 980px frame on all three, so switching tab must not resize the
  // modal. A per-tab maxWidth would be the jump the owner asked not to have.
  const m = [...tab.matchAll(/<ModalShell[\s\S]{0,200}?maxWidth="([^"]+)"/g)].map((x) => x[1]);
  ok(m.length >= 1, "the options modal no longer passes maxWidth; re-derive this");
  eq(new Set(m).size, 1, `ModalShell is given ${new Set(m).size} different widths: ${m.join(", ")}`);
  ok(!/maxWidth=\{/.test(tab),
    "a modal width is computed rather than fixed, so the frame can change size between tabs");
});

check("tabs are the modal arrangement only", () => {
  // GameDetailsPanel's default is the accordion (bare = false). A caller outside the Library
  // modal must not silently acquire a tab strip.
  ok(/bare\s*=\s*false/.test(panel), "the `bare` prop lost its false default");
  const callers = [...tab.matchAll(/<GameDetailsPanel/g)].length;
  ok(callers >= 1, "RomManagementTab no longer renders GameDetailsPanel; re-derive this guard");
  eq((tab.match(/<GameDetailsPanel[\s\S]{0,400}?bare/g) ?? []).length, callers,
    "a GameDetailsPanel caller in the Library tab does not pass `bare`");
});

check("the panel grid is a single column", () => {
  const at = panel.indexOf(".game-details-accordion.bare .details-panels");
  ok(at >= 0, "the bare panel grid rule is gone; the modal was restructured, re-derive this");
  const body = panel.slice(at, panel.indexOf("}", at));
  const m = body.match(/grid-template-columns:([^;]+);/);
  ok(m, `no grid-template-columns in the bare panel grid: ${body}`);
  const tracks = m[1].trim();
  eq((tracks.match(/minmax\(|fr\b/g) ?? []).length, 2,
    `expected one minmax(0, 1fr) track now that one panel shows at a time, got ${tracks}`);
  ok(/minmax\(\s*0\s*,/.test(tracks),
    `the track needs a minmax(0, …) floor, got ${tracks}. An <input> carries an intrinsic `
    + "minimum width, and a bare fr track floors at it and blows the grid past the modal.");
});

check("the modal is narrower than it shipped", () => {
  const m = tab.match(/<ModalShell onDismiss=\{\(\) => \(optionsOpen = false\)\} maxWidth="([^"]+)"/);
  ok(m, "the options modal no longer passes maxWidth; re-derive this");
  const rem = Number(m[1].replace("rem", ""));
  ok(Number.isFinite(rem), `maxWidth is not a rem value: ${m[1]}`);
  ok(rem < 62, `the options modal is ${m[1]}, not narrower than the 62rem it shipped at`);
  // A floor too: the cheats manual-entry row is one code input, one description input and a
  // button on a line, and it is what the width is actually for.
  ok(rem >= 56, `${m[1]} is too narrow for the cheats manual entry row (code, description, Add)`);
});

check("the shared shell's own default is untouched", () => {
  // Every other modal in the app takes ModalShell's default. Changing it here would resize
  // all of them, which is why the options modal passes its own value instead.
  const m = shell.match(/maxWidth\s*=\s*"([^"]+)"/);
  ok(m, "ModalShell no longer declares a default maxWidth");
  eq(m[1], "26rem", "ModalShell's default width changed, which resizes every other modal");
});

/* --- The two-column bodies -------------------------------------------------------------------
   Cover art and Saves draw their controls in column 1 and a preview in column 2; Cheats has no
   preview and was the one tab the owner reported as looking right. Two defects lived in that
   difference, and both are invisible to svelte-check and to `vite build`:

     1. The preview was placed by `.game-details-accordion.bare .cover-preview-box`, four
        classes, while `... .panel-content.cover-options > *` pinned every child to column 1 at
        five. Svelte scopes a rule by appending its hash inside `:where()`, which carries no
        specificity, so the shorter rule simply lost and the preview never reached column 2.
     2. The preview spans 99 rows so that column 1's stack stays independent of the preview's
        height. A row gap is charged once per pair of adjacent ROWS, so `gap: 36px` bought 98
        gutters of nothing, about 3500px of empty scroll under a body a few hundred pixels tall.

   Nothing here is rendered, so these are checks over the declared CSS: the specificity
   arithmetic, and the pairing of a spanning child with a row gap. */
const css = panel.slice(panel.indexOf("<style"));
const mediaAt = css.indexOf("@media (max-width: 720px)");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), decls: m[2], at: m.index }));

/** Specificity of one selector, as (id, class+attr+pseudo-class, element). Our authored CSS has
 *  no `:where()`, no ids and no pseudo-elements, so the middle number is what ever decides. */
const spec = (sel) => (sel.match(/\.[\w-]+/g) ?? []).length
  + (sel.match(/\[[^\]]*\]/g) ?? []).length
  + (sel.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length;
/** The arm of a comma-separated selector list that governs Cover art. */
const coverArm = (sel) => sel.split(",").map((s) => s.trim()).find((s) => s.includes("cover-"));
const find = (pred, where) => rules.find((r) => (where === "media" ? r.at > mediaAt : r.at < mediaAt) && pred(r));

const bodySel = (r) => r.sel.includes(".panel-content.cover-options") && !r.sel.includes(">");
const starSel = (r) => /\.panel-content\.cover-options\s*>\s*\*\s*(,|$)/.test(r.sel);
const previewSel = (r) => r.sel.includes(".cover-preview-box");

check("the preview outranks the rule that would pin it to column 1", () => {
  const star = find(starSel, "wide");
  const preview = find((r) => previewSel(r) && /grid-column/.test(r.decls), "wide");
  ok(star, "the `> *` rule that assigns column 1 is gone; re-derive this guard");
  ok(preview, "no wide-layout rule places .cover-preview-box into a column");
  ok(/grid-column:\s*2/.test(preview.decls),
    "the preview is no longer placed in column 2; the two-column body has nothing on the right");
  const sPreview = spec(coverArm(preview.sel));
  const sStar = spec(coverArm(star.sel));
  ok(sPreview > sStar || (sPreview === sStar && preview.at > star.at),
    `the preview's placement (specificity ${sPreview}) loses to the \`> *\` rule `
    + `(specificity ${sStar}), so grid-column: 1 wins and the preview never reaches column 2`);
});

check("a body whose child spans rows declares no row gap", () => {
  const preview = find((r) => previewSel(r) && /grid-row/.test(r.decls), "wide");
  ok(preview, "no wide-layout rule sets the preview's grid-row");
  const span = preview.decls.match(/grid-row:\s*1\s*\/\s*span\s*(\d+)/);
  ok(span, "the preview no longer spans rows; column 1's stack is now hostage to its height");
  const body = find(bodySel, "wide");
  ok(body, "the two-column body rule is gone; re-derive this guard");
  ok(!/(^|;|\s)gap:/.test(body.decls),
    "the body uses a `gap` shorthand, which sets a ROW gap too -- with a child spanning "
    + `${span[1]} rows that is ${Number(span[1]) - 1} gutters of empty scroll`);
  const rowGap = body.decls.match(/row-gap:\s*([^;]+)/);
  ok(rowGap, "the body declares no row-gap; the shorthand-free spelling is what documents the rule");
  eq(rowGap[1].trim(), "0",
    `row-gap is not 0 while a child spans ${span[1]} rows, so every empty row is charged a gutter`);
});

check("the rhythm the row gap used to carry is still drawn", () => {
  const star = find(starSel, "wide");
  ok(star, "the `> *` rule is gone; re-derive this guard");
  const m = star.decls.match(/margin-block-end:\s*([^;]+)/);
  ok(m, "column 1's children carry no margin-block-end, so removing the row gap left them flush");
  ok(!/^0/.test(m[1].trim()), `the stand-in margin is ${m[1].trim()}, so the stack has no spacing at all`);
});

check("the phone layout un-spans the preview at a specificity that wins", () => {
  const wide = find((r) => previewSel(r) && /grid-row/.test(r.decls), "wide");
  const folded = find((r) => previewSel(r) && /grid-row/.test(r.decls), "media");
  ok(folded, "the folded layout no longer resets the preview's grid-row");
  ok(/grid-row:\s*auto/.test(folded.decls), "the preview still spans rows in one column");
  const sFolded = spec(coverArm(folded.sel));
  const sWide = spec(coverArm(wide.sel));
  // A media query adds no specificity of its own, so the folded rule has to win on its own terms.
  ok(sFolded > sWide || (sFolded === sWide && folded.at > wide.at),
    `the folded rule (specificity ${sFolded}) loses to the wide one (specificity ${sWide}), `
    + "so the span survives on a phone and brings its empty rows with it");
  const star = find(starSel, "media");
  ok(star && /margin-block-end:\s*0/.test(star.decls),
    "the folded layout keeps the wide layout's stand-in margin on top of its own row gap");
});

/* --- The shrink guards on form controls ----------------------------------------------------
   The owner reported an unnecessary HORIZONTAL scrollbar, and it was not the modal's width.
   `.opts-body` (`RomManagementTab.svelte`) declares only `overflow-y: auto`, and CSS computes
   the other axis to `auto` when one axis is not `visible` -- so that box scrolls sideways too,
   and it is where any sideways spill inside the modal surfaces.

   What spilled: a flex item's `min-width` defaults to `auto`, which for a form control is its
   INTRINSIC width, not zero. An `<input>` with no `size` attribute is 20 characters wide and
   will not go below it however narrow its container gets. The cheats manual-entry row is two
   such inputs plus a button on one line, so it had a floor no column could talk it out of.

   These checks pin the rule generally rather than naming that row: a form control given flex
   sizing must also be given a shrink guard. The narrow spelling would pass while the next
   `flex`-sized input reintroduced the same scrollbar. */
const controlClasses = () => {
  const out = new Map();
  for (const m of panel.matchAll(/<(input|select)\b[^>]*>/g)) {
    const cls = m[0].match(/class="([^"{]*)"/);
    if (!cls) continue;
    for (const c of cls[1].trim().split(/\s+/).filter(Boolean)) out.set(c, m[1]);
  }
  return out;
};

check("a form control given flex sizing also carries a shrink guard", () => {
  const controls = controlClasses();
  ok(controls.size > 0, "no classed <input>/<select> found in the panel -- re-derive this guard");
  const offenders = [];
  for (const [cls, tagName] of controls) {
    const own = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.sel));
    if (!own.length) continue;
    const decls = own.map((r) => r.decls).join(";");
    // `flex-shrink: 0` is a deliberate refusal to shrink, not an oversight; it is opting the
    // item out of flexing at all, and such an item is sized by its own width, not by a floor
    // it forgot to lift. Only a GROWING or BASIS-sized control needs the guard.
    if (!/(^|;|\s)(flex|flex-basis|flex-grow):/.test(decls)) continue;
    if (/(^|;|\s)min-width:/.test(decls)) continue;
    offenders.push(`${tagName}.${cls}`);
  }
  eq(offenders.join(", "), "",
    "these flex-sized form controls declare no min-width, so each floors at its intrinsic "
    + "width (an <input> is 20 characters) and spills sideways out of its column");
});

check("THE REPORTED ROW: the cheats manual entry can shrink with its column", () => {
  const row = rules.find((r) => /\.manual-entry-row(?![\w-])/.test(r.sel));
  ok(row, "the manual-entry row rule is gone; re-derive this guard");
  ok(/display:\s*flex/.test(row.decls),
    "the manual-entry row is no longer a flex container; the guards below may be about nothing");
  for (const cls of ["manual-input-code", "manual-input-desc"]) {
    const own = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.sel));
    ok(own.length, `.${cls} has no rule of its own; re-derive this guard`);
    const m = own.map((r) => r.decls).join(";").match(/min-width:\s*([^;]+)/);
    ok(m, `.${cls} carries no min-width, so it floors at the input's intrinsic 20-character `
      + "width and forces the row wider than its column");
    eq(m[1].trim(), "0", `.${cls}'s min-width is not 0, so it still cannot shrink to its column`);
  }
});

check("the sideways spill is fixed by fitting, never by clipping", () => {
  const body = [...tab.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim(), decls: m[2] }))
    .find((r) => /\.opts-body(?![\w-])/.test(r.sel));
  ok(body, "the .opts-body rule is gone; re-derive this guard");
  ok(/overflow-y:\s*auto/.test(body.decls),
    "the modal body no longer scrolls vertically; a tall panel would be clipped");
  // Clipping here would hide the symptom and cut a real row off at narrow widths. The fix
  // belongs on whatever would not shrink, which the two checks above pin.
  ok(!/overflow-x:\s*hidden/.test(body.decls),
    "the modal body clips horizontally, which hides a sideways spill instead of fitting it "
    + "and cuts real content off at narrow widths");
});

/* --- A full-bleed child may not out-reach the scrollport it sits in ------------------------
   The owner's horizontal scrollbar was NOT a content width and had nothing to do with DPI.
   `.opts-body` scrolls on both axes -- `overflow-y: auto` with `overflow-x` unset computes the
   other axis to `auto` -- and `GameDetailsPanel`'s tab strip is full-bleed by a negative inline
   margin, cancelling padding that `ModalShell` puts on `.opts-body`'s PARENT rather than on
   `.opts-body`. So the strip's margin box came out wider than the scrollport and hung past its
   inline-end, which is scrollable overflow: a horizontal scrollbar with exactly the strip's
   overhang of travel, at every width, whenever the modal was open.

   The rule this pins is the general one, not the repair: a scroll container must carry at
   least as much inline padding as the deepest negative inline margin any descendant uses to
   go full-bleed. Stated that way it also catches the next full-bleed band someone adds. */
const SIDE = { px: 1, rem: 16, em: 16 };
const toPx = (v) => {
  const m = String(v).trim().match(/^(-?[\d.]+)(px|rem|em)?$/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] ? SIDE[m[2]] : 1);
};
/** The inline (left/right) component of a `margin`/`padding` shorthand or its longhands.
 *  Returns the most negative inline value for margins, the smallest for paddings. */
const inlineOf = (decls, prop) => {
  const vals = [];
  const push = (v) => { const n = toPx(v); if (n !== null) vals.push(n); };
  const short = (decls.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`)) || [])[1];
  if (short) {
    const parts = short.trim().split(/\s+/);
    // 1 value: all sides. 2 or 3: [block, inline]. 4: [top, right, bottom, left].
    if (parts.length === 1) push(parts[0]);
    else if (parts.length === 2 || parts.length === 3) push(parts[1]);
    else { push(parts[1]); push(parts[3]); }
  }
  const inline = (decls.match(new RegExp(`(?:^|;)\\s*${prop}-inline\\s*:\\s*([^;]+)`)) || [])[1];
  if (inline) for (const v of inline.trim().split(/\s+/)) push(v);
  for (const side of ["left", "right", "inline-start", "inline-end"]) {
    const v = (decls.match(new RegExp(`(?:^|;)\\s*${prop}-${side}\\s*:\\s*([^;]+)`)) || [])[1];
    if (v) push(v);
  }
  return vals;
};

const tabRules = [...tab.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), decls: m[2] }));
const scroller = tabRules.find((r) => /\.opts-body(?![\w-])/.test(r.sel));

check("the modal body scrolls sideways at all, which is why the overhang shows", () => {
  ok(scroller, "the .opts-body rule is gone; re-derive this guard");
  const ox = (scroller.decls.match(/(?:^|;)\s*overflow-x\s*:\s*([^;]+)/) || [])[1];
  const oy = (scroller.decls.match(/(?:^|;)\s*overflow-y\s*:\s*([^;]+)/) || [])[1];
  ok(oy && /auto|scroll/.test(oy), "the modal body no longer scrolls vertically; a tall panel would be clipped");
  // With overflow-x unset, CSS computes it to `auto` -- the box scrolls on both axes whether or
  // not anyone wrote that down. That is what turns an overhang into a visible scrollbar.
  ok(!ox || /auto|scroll/.test(ox),
    `the modal body sets overflow-x: ${ox}; clipping hides an overhang instead of fitting it `
    + "and cuts real content off at narrow widths");
});

check("THE REPORTED SCROLLBAR: no full-bleed child out-reaches the scrollport", () => {
  ok(scroller, "the .opts-body rule is gone; re-derive this guard");
  const pads = inlineOf(scroller.decls, "padding");
  const pad = pads.length ? Math.min(...pads) : 0;
  const offenders = [];
  for (const r of rules) {
    const margins = inlineOf(r.decls, "margin").filter((n) => n < 0);
    if (!margins.length) continue;
    const reach = Math.abs(Math.min(...margins));
    if (reach > pad) offenders.push(`${r.sel.split(",")[0].trim()} reaches ${reach}px`);
  }
  eq(offenders.join("; "), "",
    `the modal body's scrollport carries ${pad}px of inline padding, and these full-bleed `
    + "children reach further, so each hangs past its inline-end and that overhang is "
    + "scrollable: a horizontal scrollbar with nothing in it");
});

check("the strip's full bleed still reaches the modal's edges", () => {
  const strip = rules.find((r) => /\.opt-tabs(?![\w-])/.test(r.sel) && /margin/.test(r.decls));
  ok(strip, "the tab strip's margin rule is gone; re-derive this guard");
  const reach = Math.abs(Math.min(...inlineOf(strip.decls, "margin")));
  ok(reach > 0,
    "the tab strip no longer bleeds outward, so its bottom rule stops short of the modal's "
    + "edges and reads as a line under the tabs rather than a divider");
  const pads = inlineOf(scroller.decls, "padding");
  eq(Math.min(...(pads.length ? pads : [0])), reach,
    "the scrollport's inline padding and the strip's outward reach have to be equal: less and "
    + "the strip overhangs, more and the strip stops short of the edge it is drawn to reach");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`options modal: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
