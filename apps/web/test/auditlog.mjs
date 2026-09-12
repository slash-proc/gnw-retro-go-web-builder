/**
 * THE ACTIVITY LOG — the channel conversion never had.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/auditlog.mjs'
 *
 * The owner, after meeting converter output inline in a Library row from three directions in
 * one day:
 *
 *   "bro, that belongs in the debug console or we need some kind of notification system
 *    and/or a global audit log system."
 *
 * He is right, and the three defects were one missing thing. A module's `warnings[]` are, per
 * gwrg-dist-spec, "the only voice a module has", and the UI gave that voice exactly one
 * destination: a line under a Library row, inline, at full length. So an eleven-item lump
 * inventory landed in body copy under his game — and, before the verdicts were split per run,
 * under every homebrew app.
 *
 * What is pinned here:
 *   - a failure and a warning both reach the log, with the right severity and the right subject;
 *   - the ROW carries NOTHING — no module text, no short verdict, no link. The first fix put a
 *     short status there instead of the full text; the owner rejected that too ("get rid of ANY
 *     messages there"), so the rule is absence, not brevity. A source assertion —
 *     `getActionState`'s siblings live in a `.svelte` template no node suite can call, the same
 *     limitation `coreregistry.mjs` documents for the install affordance;
 *   - the Activity MODAL is gone: Activity is a pane in the Overview rail and the bell opens the
 *     panel `Notifications.dc.html` draws. Neither is built yet, and a modal is not a stand-in;
 *   - an unrecognised file used under `strict: false` still reaches the user, because moving
 *     detail off the row must not mean dropping it (spec/03 requires that one);
 *   - two games' entries stay distinct;
 *   - the log is bounded, oldest-first;
 *   - the bell LISTS and COUNTS the same thing, errors only, from one rule. A converter's crop
 *     warning is a note: it is recorded, and it never rings.
 *
 * `auditLog` and `prepareState` are built TOGETHER in one splitting build: they are singletons
 * and the point of most of this file is that the store `prepareState` writes to is the one the
 * UI reads. Two builds would give each a private copy and every check would pass vacuously.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "gwrg-auditlog-"));
const failures = [];
let passed = 0;

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// --- Build -------------------------------------------------------------------------------------

const { gnwResolve } = await import("./gnwResolve.mjs");

// Only what leaves the process is faked: the converter (worker + WASM), the artifact fetch
// (network), and the two string tables (runes modules). `convertFailed`/`convertUnrecognised`
// are tagged distinctly per table so a check can tell the DISPLAY locale from the English the
// copy path is required to produce.
const fake = {
  "homebrewConvert.js":
    "export async function convertHomebrewTitle(t, f) { return globalThis.__alFakes.convert(t, f); }",
  "installArtifacts.js":
    "export async function fetchTargetArtifacts(t) { return globalThis.__alFakes.artifacts(t); }",
  // `sources.errPrepare*` is the copy the ROW reads (`prepareText`); it is deliberately NOT
  // what the log records, and this suite is about the log, so the two are tagged apart.
  "locale.svelte.js":
    "export const locale = { t: { roms: { selectGames: {" +
    " convertFailed: (c) => `DE|${c}`, convertUnrecognised: (f) => `DE|${f} unbekannt` } }, sources: {" +
    " errPrepareUnreadable: 'DE|unlesbar', errPrepareInput: 'DE|eingabe'," +
    " errPrepareCollision: 'DE|kollision', errPrepareInterrupted: 'DE|abgebrochen' } } };",
  "en.js":
    "export const en = { roms: { selectGames: {" +
    " convertFailed: (c) => `EN|${c}`, convertUnrecognised: (f) => `EN|${f} not recognised` } } };",
};

const lib = join(here, "../src/lib");
await esbuild.build({
  entryPoints: [
    join(lib, "auditLog.svelte.ts"),
    join(lib, "sources/prepareState.svelte.ts"),
    join(lib, "sources/converter.ts"),
    join(lib, "sources/types.ts"),
    // `debug.ts` is an entry point so this suite can call the REAL `dbg()`. Splitting makes it
    // the same module instance `auditLog` registered its sink with -- importing it any other way
    // would give a private copy whose sink is null, and every dbg check would pass vacuously.
    join(lib, "debug.ts"),
  ],
  outdir: join(out, "b"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    // `prepareState` -> `placement.ts` -> `engine/devicePaths.ts` -> `@gnw/fs-builders`.
    gnwResolve(join(here, ".")),
    {
      name: "audit-fakes",
      setup(build) {
        build.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte|i18n\/en)\.js$/ }, (a) => ({
          path: a.path.endsWith("en.js") ? "en.js" : a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "al-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "al-fake" }, (a) => ({
          contents: fake[a.path],
          loader: "js",
        }));
      },
    },
  ],
});

const { auditLog, MAX_ENTRIES, MAX_DEBUG_ENTRIES, SEVERITY_RANK, atLeast } = await import(
  pathToFileURL(join(out, "b/auditLog.svelte.js")).href,
);
const { dbg } = await import(pathToFileURL(join(out, "b/debug.js")).href);
// `dbg()` mirrors every line to the console, and the budget checks below emit hundreds on
// purpose. Left alone they bury this suite's own output, which is the one thing a run has to be
// able to read.
console.debug = () => {};
const { prepareState } = await import(pathToFileURL(join(out, "b/sources/prepareState.svelte.js")).href);
const { ConverterError } = await import(pathToFileURL(join(out, "b/sources/converter.js")).href);

// --- Fixtures ----------------------------------------------------------------------------------

const inputSpec = (id, required) => ({
  id, required, allowMultiple: false, extensions: [".bin"], maxBytes: 1024, variants: [], strict: true,
});
const prepTitle = ({ inputs = [inputSpec("base", true)], artifacts = [], repo = "o/r", displayName = "T" } = {}) => ({
  key: `${repo}#t`,
  repo,
  targetId: "t",
  label: displayName,
  displayName,
  deviceFiles: [],
  sourceExtensions: [],
  selfContained: false,
  promptsForInput: true,
  tool: { id: "conv", inputs, outputs: [], limits: {}, processor: {} },
  target: { id: "t", artifacts },
});
const offer = (filename, inputId = "base") => ({ inputId, filename, bytes: new Uint8Array([9]) });
const conversion = (files = [], unrecognised = [], warnings = []) => ({
  files: new Map(files), unrecognised, warnings,
});

// `prepareState` and `auditLog` are singletons and every body below is async, so the checks are
// run in sequence against a freshly-cleared pair rather than concurrently on one shared store.
const queue = [];
function check(name, fn) {
  queue.push(async () => {
    auditLog.clear();
    auditLog.hide();
    // The filter is store state, so it survives `clear()` — reset it here or one check's
    // narrowing silently becomes the next one's starting condition.
    auditLog.severityFilter = "all";
    auditLog.sourceFilter = [];
    auditLog.query = "";
    auditLog.showDebug = false;
    prepareState.assets = new Map();
    prepareState.failures = new Map();
    prepareState.notices = new Map();
    prepareState.produced = new Map();
    globalThis.__alFakes = {
      convert: async () => { throw new Error("convert not stubbed"); },
      artifacts: async () => new Map(),
    };
    try {
      await fn();
      passed++;
    } catch (e) {
      failures.push(`${name}: ${e && e.message ? e.message : e}`);
    }
  });
}

// --- The two verdicts reach the log ------------------------------------------------------------

check("a module's warning reaches the log as INFO, under the file it is about", async () => {
  const t = prepTitle();
  globalThis.__alFakes.convert = async () =>
    conversion([["one.whd", new Uint8Array([1])]], [], ["cropped 11 widescreen lumps to 320w: HELP1(560x200)"]);

  eq(await prepareState.run(t, [offer("doom.wad")]), true, "the run SUCCEEDED — a warning is not a failure");
  eq(auditLog.entries.length, 1, "one entry");
  const e = auditLog.entries[0];
  // The owner, of this exact line: "This is essentially an info message from the doom wad
  // converter." A transformation performed, not a doubt about the outcome.
  eq(e.severity, "info", "a module reporting what it DID is info, never an error");
  eq(e.source, "converter", "and it says who spoke");
  eq(e.subject, "doom.wad", "filed under the file the row shows, not the title");
  ok(auditLog.line(e).includes("cropped 11 widescreen lumps"), "with the module's own text intact");
});

check("a failure reaches the log as an ERROR, with the reason the row no longer shows", async () => {
  const t = prepTitle();
  globalThis.__alFakes.convert = async () => { throw new ConverterError("unknown-output", "smw_assets.dat"); };

  eq(await prepareState.run(t, [offer("smw.sfc")]), false, "the run failed");
  eq(auditLog.entries.length, 1, "one entry");
  const e = auditLog.entries[0];
  eq(e.severity, "error", "work that did not happen is an error");
  eq(e.subject, "smw.sfc", "under the file that failed");
  const text = auditLog.line(e);
  ok(text.includes("unknown-output"), "the REASON is in the log");
  ok(text.includes("smw_assets.dat"), "…and so is the detail the thrower attached");
});

check("an unrecognised file used under strict:false still reaches the user", async () => {
  // spec/03 requires this one to be reported. Shortening the row must not drop it — the whole
  // risk of moving detail off the row is that something quietly stops being said.
  const t = prepTitle();
  globalThis.__alFakes.convert = async () =>
    conversion([["out.whd", new Uint8Array([1])]], ["freedoom2.wad"], []);

  eq(await prepareState.run(t, [offer("freedoom2.wad")]), true, "accepted anyway");
  ok(
    auditLog.entries.some((e) => auditLog.line(e).includes("freedoom2.wad")),
    "and the log names the file that was used without being recognised",
  );
});

check("two games' entries stay distinct — the owner's original symptom", async () => {
  const t = prepTitle();
  globalThis.__alFakes.convert = async () =>
    conversion([["one.whd", new Uint8Array([1])]], [], ["cropped 11 widescreen lumps"]);
  eq(await prepareState.run(t, [offer("doom.wad")]), true, "first game");
  globalThis.__alFakes.convert = async () =>
    conversion([["two.whd", new Uint8Array([2])]], [], ["cropped 6 widescreen lumps"]);
  eq(await prepareState.run(t, [offer("doom2.wad")]), true, "second game");

  eq(auditLog.entries.length, 2, "one entry each");
  const subjects = auditLog.entries.map((e) => e.subject);
  ok(subjects.includes("doom.wad") && subjects.includes("doom2.wad"), "each under its own file");
  const forDoom = auditLog.entries.filter((e) => e.subject === "doom.wad");
  eq(forDoom.length, 1, "and the second run did not re-file the first");
  ok(auditLog.line(forDoom[0]).includes("11 widescreen"), "doom.wad keeps ITS OWN warning, not doom2's");
});

check("a whole-title run files under the title, which has no one file to blame", async () => {
  // NOT a converter run with an empty offer: `run()` fills an empty offer from discovery, so
  // the keys go straight back to per-file. The reachable title-level case is an ARTIFACTS-ONLY
  // title — no tool, so nothing to offer — whose fetch fails. `verdictSubject` must fall back
  // to the title's own name there, or the entry would be about nothing.
  const t = prepTitle({ inputs: [], displayName: "Celeste" });
  delete t.tool;
  t.target.artifacts = [{ filename: "celeste.bin" }];
  globalThis.__alFakes.artifacts = async () => { throw new ConverterError("fetch-failed"); };

  eq(await prepareState.run(t, []), false, "the artifact fetch failed");
  eq(auditLog.entries.length, 1, "one entry");
  eq(auditLog.entries[0].severity, "error", "a fetch that did not happen is an error");
  eq(auditLog.entries[0].subject, "Celeste", "and the TITLE names it — there is no one file to blame");
});

// --- The store's own rules ---------------------------------------------------------------------

check("the log is bounded, and drops the OLDEST", () => {
  for (let i = 0; i < MAX_ENTRIES + 25; i++) {
    auditLog.add("info", "converter", { kind: "literal", text: `line ${i}` });
  }
  eq(auditLog.entries.length, MAX_ENTRIES, "capped");
  ok(auditLog.line(auditLog.entries[0]).includes(`line ${25}`), "the oldest went, not the newest");
  ok(
    auditLog.line(auditLog.entries[auditLog.entries.length - 1]).includes(`line ${MAX_ENTRIES + 24}`),
    "…and what just happened survived the flood",
  );
});

check("the indicator counts unattended ERRORS only", () => {
  auditLog.add("info", "converter", { kind: "literal", text: "a note" });
  eq(auditLog.unattended, 0, "a successful conversion does not light the badge — that is how a badge gets ignored");
  auditLog.add("error", "converter", { kind: "literal", text: "a failure" });
  eq(auditLog.unattended, 1, "a failure does");
  eq(auditLog.unseen.length, 2, "though both are unseen");
});

check("opening the log is acknowledging it", () => {
  auditLog.add("error", "converter", { kind: "literal", text: "boom" });
  eq(auditLog.unattended, 1, "unattended before");
  auditLog.show();
  eq(auditLog.open, true, "the surface is up");
  eq(auditLog.unattended, 0, "and nothing is clamouring any more");
  auditLog.hide();
  eq(auditLog.open, false, "dismissed");
  eq(auditLog.unattended, 0, "and it stays acknowledged");
});

check("copy renders ENGLISH whatever the display locale", async () => {
  const t = prepTitle();
  globalThis.__alFakes.convert = async () => { throw new ConverterError("unknown-output"); };
  eq(await prepareState.run(t, [offer("smw.sfc")]), false, "it failed");

  const shown = auditLog.line(auditLog.entries[0]);
  ok(shown.startsWith(shown) && shown.includes("DE|"), "on screen it is the display locale");
  const copied = auditLog.copyText();
  ok(copied.includes("EN|"), "copied, it is English — so a pasted bug report reads the same for everyone");
  ok(!copied.includes("DE|"), "…with none of the display locale left in it");
});

check("a module's warning is runtime text and is never translated", async () => {
  const t = prepTitle();
  globalThis.__alFakes.convert = async () =>
    conversion([["one.whd", new Uint8Array([1])]], [], ["cropped 11 widescreen lumps"]);
  eq(await prepareState.run(t, [offer("doom.wad")]), true, "prepared");
  ok(auditLog.copyText().includes("cropped 11 widescreen lumps"), "the module's own words, verbatim");
});

// --- The row keeps a short status ---------------------------------------------------------------

// `getActionState`'s neighbours are a `.svelte` template no node suite can call — the same
// limitation `coreregistry.mjs` records for the install affordance. Pinned by shape instead, and
// a restructure of this block needs the guard rewritten with it.
const rowSrc = readFileSync(join(lib, "views/RomManagementTab.svelte"), "utf8");

// A row is a game, a size and a state. Nothing else. The verdict lived here twice — first as
// the module's full text, then as a short "Prepared with notes" link — and the owner rejected
// both, the second time in the same breath as the modal: "get rid of ANY messages there".
// Quieter is not the fix; absent is. These guards exist so it cannot come back a third time.
check("a Library row carries NO verdict text at all", () => {
  for (const needle of ["verdictFailed", "verdictNoted", "row-verdict", "rowFailure(", "rowNotices("]) {
    ok(!rowSrc.includes(needle), `no \`${needle}\` in the Library row`);
  }
});

check("the Library does not reach the activity log at all", () => {
  // The strongest form of the rule: not a quieter message, not an icon, not a link. If the row
  // cannot see the log it cannot report from it.
  ok(!rowSrc.includes("auditLog"), "RomManagementTab.svelte does not import or call `auditLog`");
});

check("the Activity MODAL is gone, with no stand-in", () => {
  ok(!existsSync(join(lib, "ui/AuditLogModal.svelte")), "the component is deleted");
  const appSrc = readFileSync(join(here, "../src/App.svelte"), "utf8");
  ok(!appSrc.includes("AuditLogModal"), "and App.svelte neither imports nor renders it");
  // Activity belongs in the Overview rail (`overview-v2/Activity.dc.html`) and the bell opens
  // the panel `Notifications.dc.html` draws. Neither is built; a modal is not a substitute.
});

check("the bell lists and counts the SAME thing: errors only", () => {
  // These were two rules before — the count filtered to errors, the surface listed everything —
  // so the badge stayed dark while the panel showed a DOOM crop warning. One rule now.
  auditLog.clear();
  auditLog.add("error", "converter", { kind: "literal", text: "boom" }, "doom.wad");
  auditLog.add("info", "converter", { kind: "literal", text: "cropped 11 widescreen lumps" }, "doom.wad");
  eq(auditLog.entries.length, 2, "both are recorded — a note is not discarded, it is not a notification");
  eq(auditLog.notifications.length, 1, "only the error is a notification");
  eq(auditLog.notifications[0].severity, "error", "and it is the error, not the note");
  eq(auditLog.unattended, auditLog.notifications.length, "the badge counts exactly that list");
});

// --- The four levels ---------------------------------------------------------------------------

check("every level round-trips through the store", () => {
  auditLog.clear();
  for (const sev of ["debug", "info", "warning", "error"]) {
    auditLog.add(sev, "converter", { kind: "literal", text: sev });
  }
  eq(auditLog.entries.length, 4, "all four recorded");
  eq(
    auditLog.entries.map((e) => e.severity).join(","),
    "debug,info,warning,error",
    "each kept the level it was given",
  );
});

check("rank orders the levels, so `warning and above` is one comparison", () => {
  ok(SEVERITY_RANK.debug < SEVERITY_RANK.info, "debug is quietest");
  ok(SEVERITY_RANK.info < SEVERITY_RANK.warning, "info below warning");
  ok(SEVERITY_RANK.warning < SEVERITY_RANK.error, "error is loudest");
  ok(atLeast("error", "warning"), "an error passes a warning threshold");
  ok(atLeast("warning", "warning"), "…and so does a warning itself");
  ok(!atLeast("info", "warning"), "info does not");
  ok(!atLeast("debug", "info"), "and debug is below info");
});

check("a WARNING is recorded and still does not ring", () => {
  // The distinction that carries judgement: a warning is worth reading, not worth interrupting
  // for. If the bell ever derives from `atLeast(..., "warning")` this is what catches it.
  auditLog.clear();
  auditLog.add("warning", "converter", { kind: "literal", text: "freedoom2.wad not recognised" }, "freedoom2.wad");
  eq(auditLog.entries.length, 1, "recorded");
  eq(auditLog.notifications.length, 0, "and it does not reach the bell");
  eq(auditLog.unattended, 0, "so the badge stays dark");
});

check("debug never rings either, so wiring it later cannot start the bell", () => {
  // `debug` is reserved and unemitted today (see `AuditSeverity`). Its intended feed is
  // `debug.ts`'s `dbg()`, which cannot be connected until the pane that hides it exists. This
  // pins the safety property NOW so that connecting it later is not a behaviour change.
  auditLog.clear();
  auditLog.add("debug", "device", { kind: "literal", text: "chunk 3/57 verified" });
  eq(auditLog.entries.length, 1, "recorded");
  eq(auditLog.notifications.length, 0, "and silent");
});

check("only ERROR reaches the bell, across all four levels at once", () => {
  auditLog.clear();
  auditLog.add("debug", "device", { kind: "literal", text: "d" });
  auditLog.add("info", "converter", { kind: "literal", text: "i" });
  auditLog.add("warning", "converter", { kind: "literal", text: "w" });
  auditLog.add("error", "converter", { kind: "literal", text: "e" });
  eq(auditLog.entries.length, 4, "all four kept — nothing is discarded by not notifying");
  eq(auditLog.notifications.length, 1, "exactly one notification");
  eq(auditLog.notifications[0].severity, "error", "and it is the error");
  eq(auditLog.unattended, auditLog.notifications.length, "the badge counts that list");
});

check("THE DOOM CROP lands on info, and the unrecognised file on warning", async () => {
  // The owner's two live cases, through the real `prepareState` rather than a hand-made entry:
  // one run that reports what it did, one that casts doubt on its own output.
  auditLog.clear();
  const t = prepTitle();
  globalThis.__alFakes.convert = async () =>
    conversion(
      [["out.whd", new Uint8Array([1])]],
      ["freedoom2.wad"],
      ["cropped 11 widescreen lumps to 320w: HELP1(560x200)"],
    );

  eq(await prepareState.run(t, [offer("doom.wad")]), true, "the run succeeded");
  const crop = auditLog.entries.find((e) => auditLog.line(e).includes("cropped 11 widescreen"));
  const unrec = auditLog.entries.find((e) => auditLog.line(e).includes("freedoom2.wad"));
  ok(crop, "the module's own warning is in the log");
  ok(unrec, "and so is the file used without being recognised");
  eq(crop.severity, "info", "the module reporting what it did is INFO");
  eq(unrec.severity, "warning", "a file used unrecognised casts doubt on the output: WARNING");
  eq(auditLog.notifications.length, 0, "and neither rings — the run worked");
});

check("copyText is English whatever the display language, at every level", () => {
  // A pasted bug report has to read the same for everyone, so this must survive the widening.
  auditLog.clear();
  auditLog.add("warning", "converter", { kind: "keyed", pick: (t) => t.roms.selectGames.convertUnrecognised, params: ["freedoom2.wad"] });
  const text = auditLog.copyText();
  ok(text.includes("freedoom2.wad"), "the runtime value is there");
  ok(text.includes("not recognised"), "rendered against the English table");
});

// --- The Activity pane's filter, and what Copy acts on -------------------------------------------

// The pane and the panel are `.svelte` components no node suite can render, so what is pinned
// here is the RULE each reads: `filtered` is the pane's list and the thing `copyText()` renders,
// `notifications` is the panel's list and the badge's count, and `dismiss` is the per-row
// control. A component that stopped calling these would be a different defect; these are the
// answers the surfaces are built on.

const seed = () => {
  auditLog.clear();
  auditLog.severityFilter = "all";
  auditLog.sourceFilter = [];
  auditLog.query = "";
  auditLog.showDebug = false;
  auditLog.add("debug", "device", { kind: "literal", text: "swd read 0x90000000" }, "probe");
  auditLog.add("info", "converter", { kind: "literal", text: "cropped 11 widescreen lumps" }, "doom.wad");
  auditLog.add("warning", "converter", { kind: "literal", text: "used anyway" }, "freedoom2.wad");
  auditLog.add("error", "sources", { kind: "literal", text: "could not be read" }, "zelda3");
};

check("debug is hidden until its own chip asks for it", () => {
  seed();
  // "All" is every level the user has ASKED to see, and they have not asked for debug. This is
  // the precondition the store's severity comment names for ever routing `dbg()` in here: the
  // pane has to be the thing that hides it before anything can be hidden.
  eq(auditLog.severityFilter, "all", "the segment defaults to all");
  eq(auditLog.showDebug, false, "and debug is off");
  eq(auditLog.filtered.length, 3, "all-except-debug");
  ok(!auditLog.filtered.some((e) => e.severity === "debug"), "no debug row while the chip is off");
  auditLog.showDebug = true;
  eq(auditLog.filtered.length, 4, "the chip reveals it");
  ok(auditLog.filtered.some((e) => e.severity === "debug"), "and it is the debug row");
});

check("the severity segment is a floor, and never re-admits debug", () => {
  seed();
  auditLog.severityFilter = "warning";
  eq(auditLog.filtered.map((e) => e.severity).join(","), "warning,error", "warning and above");
  auditLog.severityFilter = "error";
  eq(auditLog.filtered.map((e) => e.severity).join(","), "error", "error alone");
  // A floor of `debug` is not expressible from the segment, which is the point of the split.
  auditLog.severityFilter = "info";
  ok(!auditLog.filtered.some((e) => e.severity === "debug"), "lowering the floor does not reveal debug");
});

check("source chips combine, and an empty set means every source", () => {
  seed();
  eq(auditLog.filtered.length, 3, "no chip on means no source filter");
  auditLog.toggleSource("converter");
  eq(auditLog.filtered.length, 2, "converter alone");
  auditLog.toggleSource("sources");
  eq(auditLog.filtered.length, 3, "chips COMBINE, they do not replace");
  auditLog.toggleSource("converter");
  auditLog.toggleSource("sources");
  eq(auditLog.sourceFilter.length, 0, "toggling both off empties the set");
  eq(auditLog.filtered.length, 3, "and empty is every source again");
});

check("the filter text matches the rendered line, subject included", () => {
  seed();
  auditLog.query = "freedoom";
  eq(auditLog.filtered.length, 1, "by subject, which the rendered line carries");
  auditLog.add("info", "device", { kind: "literal", text: "READ THE MANIFEST" }, "SD_CARD");
  auditLog.query = "read the manifest";
  eq(auditLog.filtered.length, 1, "by message, case-insensitively in BOTH directions");
  auditLog.query = "sd_card";
  eq(auditLog.filtered.length, 1, "an upper-case subject matches a lower-case query");
  auditLog.query = "nothing here";
  eq(auditLog.filtered.length, 0, "and narrows to nothing when it matches nothing");
});

check("Copy and Save act on the FILTERED set, not the whole record", () => {
  // The count line beside them states the filtered set. Copying the whole record from a screen
  // showing eight rows would make that line a lie, which is why the board puts them there.
  seed();
  auditLog.severityFilter = "error";
  const text = auditLog.copyText();
  eq(text.split("\n").length, 1, "one line, matching what the pane shows");
  ok(text.includes("could not be read"), "the error is in it");
  ok(!text.includes("cropped 11"), "and the info entry, which is filtered out, is not");
});

check("copied text is English even when the filter is on and the locale is not", () => {
  auditLog.clear();
  auditLog.severityFilter = "all";
  auditLog.sourceFilter = [];
  auditLog.query = "";
  auditLog.add("warning", "converter", { kind: "keyed", pick: (t) => t.roms.selectGames.convertUnrecognised, params: ["freedoom2.wad"] });
  const text = auditLog.copyText();
  ok(text.includes("not recognised"), "rendered against the English table");
  ok(!text.includes("unbekannt"), "not the display locale");
});

// --- The bell's panel ----------------------------------------------------------------------------

check("dismissing one takes it off the bell and leaves it in the record", () => {
  seed();
  auditLog.add("error", "converter", { kind: "literal", text: "second failure" }, "smw.sfc");
  eq(auditLog.notifications.length, 2, "two errors waiting");
  const first = auditLog.notifications[0];
  auditLog.dismiss(first.id);
  eq(auditLog.notifications.length, 1, "one left on the bell");
  eq(auditLog.unattended, 1, "and the badge agrees, because it IS that list");
  // The whole point of dismissal being `seen` and not deletion.
  eq(auditLog.entries.length, 5, "nothing was destroyed");
  ok(auditLog.entries.some((e) => e.id === first.id), "the dismissed entry is still in the record");
  auditLog.severityFilter = "all";
  ok(auditLog.filtered.some((e) => e.id === first.id), "and Activity still lists it");
});

check("Clear empties the bell without emptying Activity", () => {
  seed();
  ok(auditLog.notifications.length > 0, "something is waiting");
  auditLog.markSeen();
  eq(auditLog.notifications.length, 0, "the bell is empty");
  eq(auditLog.unattended, 0, "and dark");
  eq(auditLog.entries.length, 4, "while the record is untouched — Clear is not clear()");
});

check("a dismissed entry cannot be dismissed twice, and an unknown id is a no-op", () => {
  seed();
  const e = auditLog.notifications[0];
  auditLog.dismiss(e.id);
  const after = auditLog.entries.slice();
  auditLog.dismiss(e.id);
  auditLog.dismiss(999999);
  eq(auditLog.entries.length, after.length, "no entry appeared or vanished");
  eq(auditLog.notifications.length, 0, "and the bell stays empty");
});

check("only errors ever reach the panel, whatever the pane's filter is set to", () => {
  // The pane's filter is a VIEW; the bell is not a view of it. Setting the segment to `info`
  // must not put info entries on the bell.
  seed();
  auditLog.severityFilter = "info";
  auditLog.showDebug = true;
  eq(auditLog.filtered.length, 4, "the pane shows everything");
  eq(auditLog.notifications.length, 1, "the bell still shows one error");
  eq(auditLog.notifications[0].severity, "error", "and it is an error");
});

// --- `dbg()` is the debug tier's feed ------------------------------------------------------------

check("a dbg() line lands in the log as DEBUG, from the device, verbatim", () => {
  // The gap this closes: `dbg()` POSTs to `/api/debug`, which only the Express dev server
  // answers, so in the built Pages app every one of these lines was discarded -- in exactly the
  // build where someone might be asked for a bug report.
  dbg("[sd-sync] game", "GAMES/zelda.gb");
  eq(auditLog.entries.length, 1, "the line reached the log");
  const e = auditLog.entries[0];
  eq(e.severity, "debug", "filed under debug");
  eq(e.source, "device", "and attributed to the device");
  eq(e.message.kind, "literal", "runtime text, never a translated key");
  ok(e.message.text.includes("[sd-sync]"), "the scope tag survives, so search still finds it");
  ok(e.message.text.includes("GAMES/zelda.gb"), "…and so does the line itself");
});

check("a dbg() line is hidden until the Debug chip asks for it", () => {
  dbg("[install] frogfs built");
  eq(auditLog.filtered.length, 0, "not in the default view");
  auditLog.showDebug = true;
  eq(auditLog.filtered.length, 1, "and revealed by its own chip");
});

check("a dbg() flood NEVER rings the bell", () => {
  for (let i = 0; i < 50; i++) dbg("[sd-sync] cover", `COVERS/g${i}.png`);
  eq(auditLog.notifications.length, 0, "silent");
  eq(auditLog.unattended, 0, "and the badge stays dark");
});

// --- The two budgets ------------------------------------------------------------------------

check("a debug flood cannot evict an ERROR — the reason the budgets are split", () => {
  // THE POINT OF THE SEPARATE BUDGET. `dbg()` is called once per game, cover, cheat and core in
  // the SD-sync loops, so one sync of a real library emits thousands of lines. Against a single
  // shared ring dropping oldest, that flood would flush every error recorded before it, and the
  // log would be emptiest exactly when someone went looking for why the sync misbehaved.
  //
  // The flood must exceed MAX_ENTRIES, not MAX_DEBUG_ENTRIES: a shared ring only evicts once it
  // is full, so a smaller flood leaves the error standing for the wrong reason and this check
  // passes against the very bug it exists to catch. It did, until this line was corrected.
  auditLog.add("error", "converter", { kind: "literal", text: "the error that must survive" });
  for (let i = 0; i < MAX_ENTRIES + 200; i++) dbg("[sd-sync] game", `GAMES/g${i}.gb`);
  const errors = auditLog.entries.filter((e) => e.severity === "error");
  eq(errors.length, 1, "the error is still in the record");
  ok(errors[0].message.text.includes("must survive"), "…and it is the same one");
  eq(auditLog.notifications.length, 1, "so the bell still has it");
});

check("debug is bounded by its OWN budget, and drops the oldest debug", () => {
  for (let i = 0; i < MAX_DEBUG_ENTRIES + 40; i++) dbg(`d${i}`);
  const debugs = auditLog.entries.filter((e) => e.severity === "debug");
  eq(debugs.length, MAX_DEBUG_ENTRIES, "capped at the debug budget");
  ok(debugs[0].message.text.includes(`d${40}`), "the oldest debug went");
  ok(
    debugs[debugs.length - 1].message.text.includes(`d${MAX_DEBUG_ENTRIES + 39}`),
    "…and the newest survived",
  );
});

check("debug does not consume the budget the readable levels are capped by", () => {
  // Two budgets, not one shared ring. ORDER IS THE WHOLE CHECK: the readable entries go in
  // FIRST and the flood after, so under a shared ring the flood would push them out. Filling
  // debug first would leave them newest and surviving either way, proving nothing.
  for (let i = 0; i < MAX_ENTRIES; i++) {
    auditLog.add("info", "converter", { kind: "literal", text: `kept ${i}` });
  }
  for (let i = 0; i < MAX_ENTRIES + 100; i++) dbg(`noise ${i}`);
  const kept = auditLog.entries.filter((e) => e.severity !== "debug");
  eq(kept.length, MAX_ENTRIES, "every readable entry is still there");
  ok(kept[0].message.text.includes("kept 0"), "including the very first, un-evicted by the flood");
});

check("the readable levels still evict each other, oldest first", () => {
  // The original rule has not been loosened -- only debug was taken out of this count.
  for (let i = 0; i < MAX_ENTRIES + 10; i++) {
    auditLog.add("info", "converter", { kind: "literal", text: `line ${i}` });
  }
  const kept = auditLog.entries.filter((e) => e.severity !== "debug");
  eq(kept.length, MAX_ENTRIES, "capped");
  ok(kept[0].message.text.includes("line 10"), "the oldest went, not the newest");
});

// --- Every emit site names its level ---------------------------------------------------------

check("`add` has no default severity, so no call site can omit one", () => {
  // The one mechanically-checkable part of "chosen, not defaulted": a default value here would
  // make every future call site silently info, and nothing else in this file would notice.
  const src = readFileSync(join(here, "../src/lib/auditLog.svelte.ts"), "utf8");
  const sig = src.slice(src.indexOf("  add("));
  const firstParam = sig.slice(sig.indexOf("(") + 1, sig.indexOf(",")).trim();
  eq(firstParam, "severity: AuditSeverity", "severity is required and first");
  ok(!firstParam.includes("="), "and carries no default");
});

check("the device's unlock lines carry the levels the rules give them", () => {
  // Unlocking mass-erases both flashes: the line saying so is about a consequence, so warning.
  // Finishing and declining both report what happened and ask nothing, so info. Pinned as
  // source, because these fire behind a device operation no node suite can drive.
  const src = readFileSync(join(here, "../src/lib/device.svelte.ts"), "utf8");
  const at = (key) => {
    const i = src.indexOf(key);
    ok(i > 0, `${key} is still emitted`);
    const line = src.slice(src.lastIndexOf("auditLog.add(", i), i);
    return line.slice(line.indexOf('"') + 1, line.indexOf('",'));
  };
  eq(at("unlockErasing"), "warning", "the mass-erase line is a warning");
  eq(at("unlockDone"), "info", "finishing is info");
  eq(at("unlockDeclined"), "info", "declining is info");
});

// --- Run ---------------------------------------------------------------------------------------

for (const run of queue) await run();

rmSync(out, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`activity log: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`activity log: ${passed} checks passed`);
