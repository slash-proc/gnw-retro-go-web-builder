/**
 * WHAT THE GUIDED CHOOSER ACTUALLY RENDERS, FOR EVERY DEVICE STATE IT CAN REACH.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/chooserstates.mjs'
 *
 * The specification is `docs/design/proposals/guided-v2/chooseandsee/LOGIC.md`, a state matrix
 * that cites a file and line for every gate. This suite walks it: each row names a device, the
 * cards it must draw, and the floor note it must or must not carry. A row moving is a failure.
 *
 * WHY THIS RENDERS THE COMPONENT rather than asserting on the source. Earlier in this project a
 * component shipped whose tabs did not work while `svelte-check`, `vite build` and 22 targeted
 * checks were all green: the defect was in the reactive graph, which only running it can see.
 * So `Wizard.svelte` is compiled by the real Svelte compiler and rendered through `svelte/server`,
 * and the assertions read the markup that comes out.
 *
 * ONE BUILD, MANY STATES. The device store is replaced with a stub whose properties are getters
 * onto `globalThis.__CHOOSER_DEVICE__`, so a row is driven by assigning that object and rendering
 * again. Rebuilding per row would be correct too and about ten times slower; the armed guard
 * below is what makes the shortcut honest, by failing if two different states ever render the
 * same markup.
 *
 * WHAT IS PINNED
 *   - every row of the matrix: the exact cards, in draw order, and the floor note;
 *   - `extMB === null` is PERMISSIVE and draws NO note -- unknown size is a third state, not a
 *     small one, and treating it as small would hide choices on "we have not looked yet";
 *   - the degenerate page: an unmodified device (stock Zelda, 4 MB) draws NO cards and the note
 *     stands alone. This is not an edge case, it is what a brand-new device does;
 *   - a LOCKED device draws the same chooser as any other. The owner: "WE DON'T CARE! We unlock
 *     the device if it is locked!" Unlocking belongs to `engine/unlockGate.ts`, which runs inside
 *     the Backup phase; the chooser has no opinion about it;
 *   - the preview column exists beside a card and collapses when there is none;
 *   - the preview follows the hovered card, and shows FOUR steps for Only Retro-Go on pristine
 *     stock with no backup recorded, THREE otherwise -- the one thing the right-hand column can
 *     say that the old chooser could not;
 *   - the preview is inert: it carries no controls, because every control in the real spine acts
 *     on a path that has not been chosen yet.
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
const out = mkdtempSync(join(web, "node_modules/.chooserstates-"));
const failures = [];
let passed = 0;

const ok = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};

const SRC = join(web, "src/lib/views/Wizard.svelte");

/**
 * The device store, as far as the chooser is concerned. Getters onto a global so one bundle can
 * render every row. Everything past the four facts the chooser gates on is inert: the chooser
 * draws before any of it is reachable, and a real store would drag WebUSB and the flasher blobs
 * into a node process for no gain.
 */
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

function sveltePlugin() {
  return {
    name: "svelte-ssr",
    setup(b) {
      b.onResolve({ filter: /device\.svelte\.js$/ }, () => ({ path: "device", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: DEVICE_STUB, loader: "js" }));
      // Vite's `?url` imports (wasm and firmware blobs) and the webstlink shim: neither is
      // reachable from the chooser, and both are unresolvable outside Vite.
      b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "urlstub" }));
      b.onLoad({ filter: /.*/, namespace: "urlstub" }, () => ({ contents: 'export default "stub:";', loader: "js" }));
      b.onResolve({ filter: /^@webstlink\// }, (a) => ({ path: a.path, namespace: "wsl" }));
      b.onLoad({ filter: /.*/, namespace: "wsl" }, () => ({ contents: "export default {}; export const Logger = class {};", loader: "js" }));
      b.onLoad({ filter: /\.svelte$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = await fs.readFile(a.path, "utf8");
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

// The floors themselves, from the module the component gates on. Read rather than restated: a
// suite that hardcodes 8 and 16 keeps passing when the real floors move.
const { RETRO_GO_FLOOR_MB, DUAL_BOOT_FLOOR_MB } = await (async () => {
  const src = readFileSync(join(web, "src/lib/views/chooserPlan.ts"), "utf8");
  const pick = (k) => {
    const m = src.match(new RegExp(`${k}\\s*=\\s*(\\d+)`));
    if (!m) {
      console.error(`chooser states: could not read ${k} from chooserPlan.ts`);
      process.exit(1);
    }
    return Number(m[1]);
  };
  return { RETRO_GO_FLOOR_MB: pick("RETRO_GO_FLOOR_MB"), DUAL_BOOT_FLOOR_MB: pick("DUAL_BOOT_FLOOR_MB") };
})();

await esbuild.build({
  entryPoints: [SRC],
  outdir: out, bundle: true, format: "esm", platform: "node", target: "es2022",
  external: ["svelte", "svelte/*"],
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  plugins: [gnwResolve(join(here, ".")), sveltePlugin()],
  logLevel: "error",
});
const Wizard = (await import(pathToFileURL(join(out, "Wizard.js")).href)).default;

/** `classify.ts`'s shapes, as far as the chooser reads them. */
const STOCK = { kind: "stock", model: "zelda", ofw: { patched: false } };
const RETROGO = { kind: "retrogo-sd", ofw: { patched: true } };
const PATCHED_NO_APP = { kind: "unknown", ofw: { patched: true } };
const LOCKED = { kind: "locked" };

function draw(state) {
  globalThis.__CHOOSER_DEVICE__ = state;
  return render(Wizard, { props: {} }).body;
}

// The three card labels, read from the real table so a rename cannot leave this suite asserting
// a string the app stopped using.
const wizardTable = readFileSync(join(web, "src/lib/i18n/strings/wizard.ts"), "utf8");
const label = (key) => {
  const m = wizardTable.match(new RegExp(`^\\s{2,}${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"));
  if (!m) {
    console.error(`chooser states: could not read '${key}' from the wizard string table; this suite cannot assert on labels it cannot find`);
    process.exit(1);
  }
  return m[1];
};
const L_DUAL = label("dualBoot");
const L_RGO = label("onlyRetroGo");
const L_STOCK = label("returnToStock");

/** Which cards the rendered page draws, in the order it drew them. */
function cardsIn(html) {
  const found = [];
  for (const m of html.matchAll(/class="choice-label[^"]*"[^>]*>([\s\S]*?)<\/span>/g)) {
    const text = m[1].replace(/<!--[\s\S]*?-->/g, "").trim();
    if (text.includes(L_DUAL)) found.push("dual");
    else if (text.includes(L_RGO)) found.push("rgo");
    else if (text.includes(L_STOCK)) found.push("stock");
  }
  return found;
}

/** Which floor note the page carries: "retrogo", "dualboot" or null. */
function noteIn(html) {
  const m = html.match(/class="floor-note[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  if (!m) return null;
  const text = m[1].replace(/<!--[\s\S]*?-->/g, "").trim();
  // Both notes name a FLOOR and then the device's own size ("Dual boot needs 16 MB. This device
  // has 8 MB."), so the device size is not a discriminator: at exactly 8 MB it appears in both.
  // The floor is, and `RETRO_GO_FLOOR_MB`/`DUAL_BOOT_FLOOR_MB` are imported rather than spelled
  // here so a change to either is a failure rather than a silently re-bucketed note.
  const floor = text.match(/(\d+)\s*MB/);
  if (!floor) return "unknown-note";
  if (Number(floor[1]) === RETRO_GO_FLOOR_MB) return "retrogo";
  if (Number(floor[1]) === DUAL_BOOT_FLOOR_MB) return "dualboot";
  return "unknown-note";
}

/**
 * The inner HTML of the element carrying `cls`, found by walking tag depth.
 *
 * A regex cannot do this: `.plan-col` contains nested `div`s, and any "up to the closing
 * tag" pattern stops at the first one. Written as a walk it is right for any nesting.
 */
function subtree(html, cls) {
  const at = html.indexOf(cls);
  if (at < 0) return null;
  const start = html.indexOf(">", at);
  if (start < 0) return null;
  let depth = 1;
  const tag = /<(\/?)div\b[^>]*?(\/?)>/g;
  tag.lastIndex = start + 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (m[2] === "/") continue;          // self-closing, no depth change
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start + 1, m.index);
  }
  return null;
}

const previewTitles = (html) =>
  [...html.matchAll(/class="preview-title[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => m[1].replace(/<!--[\s\S]*?-->/g, "").trim());

function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`  FAIL ${name}: ${e.message}`); }
}

// ARMED: the whole suite rests on the stub's getters being read at render time. If the component
// ever captures the store once at module scope, every row below renders the first row's markup
// and all of them pass together for the wrong reason.
// The two probe states differ by SIZE, not by bank 1, and deliberately: a mutant that drops the
// `!isStock` gate makes a stock and a Retro-Go device render the same page, which would fire this
// guard and report the wrong cause. No gate collapses 32 MB onto 4 MB.
{
  const a = draw({ deviceClass: RETROGO, extSizeMB: 32 });
  const b = draw({ deviceClass: RETROGO, extSizeMB: 4 });
  if (a === b) {
    console.error("chooser states: two device states a size gate must separate rendered identical markup, so the device stub is not being read per render and no row below tests what it claims to");
    process.exit(1);
  }
}

// ── The matrix. Rows are LOGIC.md section 4. ────────────────────────────────────────────────
const ROWS = [
  // #   bank 1            ext     cards                      note
  [1, "stock Zelda/Mario", STOCK, 32, ["dual", "rgo"], null],
  [2, "stock Zelda/Mario", STOCK, 8, ["rgo"], "dualboot"],
  [3, "stock Zelda/Mario", STOCK, 4, [], "retrogo"],
  [4, "stock Zelda/Mario", STOCK, null, ["dual", "rgo"], null],
  [5, "Retro-Go", RETROGO, 32, ["dual", "rgo", "stock"], null],
  [6, "Retro-Go", RETROGO, 8, ["rgo", "stock"], "dualboot"],
  [7, "Retro-Go", RETROGO, 4, ["stock"], "retrogo"],
  [8, "Retro-Go", RETROGO, null, ["dual", "rgo", "stock"], null],
  [9, "patched OFW, no app", PATCHED_NO_APP, 32, ["dual", "rgo", "stock"], null],
];

for (const [n, who, deviceClass, extSizeMB, cards, note] of ROWS) {
  check(`row ${n}: ${who}, ext ${extSizeMB === null ? "unknown" : extSizeMB + " MB"}`, () => {
    const html = draw({ deviceClass, extSizeMB });
    eq(cardsIn(html), cards, `row ${n} drew the wrong cards`);
    eq(noteIn(html), note, `row ${n} drew the wrong floor note`);
  });
}

check("UNKNOWN SIZE IS NOT A SMALL SIZE: both gates pass it and no note is drawn", () => {
  const html = draw({ deviceClass: RETROGO, extSizeMB: null });
  eq(cardsIn(html), ["dual", "rgo", "stock"],
    "an unmeasured device hid a choice, which is hiding it on `we have not looked yet`");
  eq(noteIn(html), null,
    "an unmeasured device drew a floor note, so it is being treated as a small one");
});

check("THE DEGENERATE PAGE: an unmodified device draws no cards and the note stands alone", () => {
  // Stock Zelda ships with 4 MB (engine/ofw.ts:147) and stock Mario with 1 MB (:458), both under
  // the 8 MB floor, and pristine stock gates Return to Stock away too.
  for (const mb of [4, 1]) {
    const html = draw({ deviceClass: STOCK, extSizeMB: mb });
    eq(cardsIn(html), [], `an unmodified device at ${mb} MB drew a card it cannot honour`);
    eq(noteIn(html), "retrogo", `an unmodified device at ${mb} MB drew no floor note, so the page says nothing at all`);
    eq(previewTitles(html), [], `an unmodified device drew a plan beside no choice`);
  }
});

check("A LOCKED DEVICE GETS THE SAME CHOOSER AS ANY OTHER", () => {
  const locked = draw({ deviceClass: LOCKED, extSizeMB: 32 });
  const unknown = draw({ deviceClass: PATCHED_NO_APP, extSizeMB: 32 });
  eq(cardsIn(locked), ["dual", "rgo", "stock"],
    "a locked device draws its own page again; the owner's rule is that we unlock it inside Backup and the chooser has no opinion");
  eq(cardsIn(locked), cardsIn(unknown),
    "a locked device and an ordinary unrecognised one drew different cards, so `locked` is still special-cased in the chooser");
  ok(previewTitles(locked).length > 0, "a locked device drew no plan, so it is still being walled off");
});

check("the preview column stands beside a card and collapses when there is none", () => {
  const withCards = draw({ deviceClass: RETROGO, extSizeMB: 32 });
  ok(/class="chooser-stage[^"]*has-preview/.test(withCards),
    "the stage is not marked as having a preview, so the divider between choice and consequence is not drawn");
  const none = draw({ deviceClass: STOCK, extSizeMB: 4 });
  ok(!/has-preview/.test(none),
    "the stage still claims a preview with no card to preview, so the note is drawn against an empty column");
});

check("THE PLAN THE OLD CHOOSER COULD NOT SHOW: Only Retro-Go is four steps on pristine stock with no backup, three otherwise", () => {
  // Row 2: pristine stock at 8 MB, so `rgo` is the only card and the preview follows it.
  const needsBackup = previewTitles(draw({ deviceClass: STOCK, extSizeMB: 8, backupTaken: false }));
  eq(needsBackup.length, 4,
    "Only Retro-Go on pristine stock with no recorded backup previewed a plan with no backup step");
  const recorded = previewTitles(draw({ deviceClass: STOCK, extSizeMB: 8, backupTaken: true }));
  eq(recorded.length, 3,
    "Only Retro-Go previewed a backup step for a unit whose backup is already recorded");
  ok(needsBackup[0] !== recorded[0],
    "the two plans start with the same step, so the backup step is not what differs between them");
});

check("the preview is inert: it carries no controls", () => {
  const html = draw({ deviceClass: RETROGO, extSizeMB: 32 });
  // `plan-col` in BOTH lives now; `is-preview` is what says which one is on screen.
  const inner = subtree(html, 'class="plan-col');
  ok(inner !== null, "could not find the plan column in the rendered page");
  ok(/is-preview/.test(html), "the plan column is not marked as a preview while nothing is chosen");
  ok(!/<button/.test(inner),
    "the preview draws a button, which would act on a path the user has not chosen");
  ok(/aria-hidden/.test(html.slice(html.indexOf('class="plan-col') - 200, html.indexOf('class="plan-col') + 200)),
    "the preview is not aria-hidden, so a screen reader walks a list of inert step titles between the cards");
});

check("no card is preselected: the plan is shown for a hover, not a choice", () => {
  const html = draw({ deviceClass: RETROGO, extSizeMB: 32 });
  // `previewing` marks which plan is on screen. Exactly one, and it must not be a commitment:
  // `picked` is the class that appears once a path IS chosen, and it must not be here.
  const marks = (html.match(/choice previewing|previewing/g) ?? []).length;
  ok(marks >= 1, "nothing marks which card the plan belongs to");
  ok(!/class="back"/.test(html),
    "the page rendered the spine's Back control, so a path was chosen without a click");
});

rmSync(out, { recursive: true, force: true });

if (failures.length) {
  console.error(`chooser states: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`chooser states: ${passed} checks passed`);
