/**
 * WHAT THE ACTIVITY PANE ACTUALLY RENDERS.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/activitypane.mjs'
 *
 * WHY THIS EXISTS, in the owner's words: "The Activity log is still showing more than the
 * currently selected session." Twenty-eight checks in `auditlogpersist.mjs` covered the session
 * filter and every one of them passed while he was looking at that. They tested `auditLog.filtered`
 * -- the predicate -- and the predicate was right. What was wrong was the COUNT LINE, which stated
 * `Showing 4 of 312` beside Copy and Save while a single sitting was selected, because its total
 * read `entries.length`, the whole record. The pane said, in words, that it was showing more than
 * the selected session.
 *
 * So this suite renders the REAL COMPONENT and asserts over its markup. A store-level check cannot
 * see a template that reads the wrong getter, and that is exactly the gap that shipped.
 *
 * The component is compiled with the REAL Svelte compiler in server mode, and `auditLog.svelte.ts`
 * through `compileModule`, so the runes are genuine rather than stubbed to identity functions the
 * way the node suites stub them. What is asserted is the rendered HTML.
 *
 * What is pinned:
 *   - selecting a session renders that session's lines and NO others, the pre-stamp block included;
 *   - the count line's total is the selected session's, not the whole record;
 *   - the error count in the segment is scoped the same way;
 *   - a session row is never drawn for a sitting whose lines the list cannot show;
 *   - with nothing selected the whole record renders, with a boundary rule between sittings.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
// Inside the workspace, not /tmp: the emitted bundle imports `svelte` and has to resolve it.
const out = mkdtempSync(join(web, "node_modules/.activitypane-"));
const failures = [];
let passed = 0;

const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};
const ok = (c, msg) => { if (!c) throw new Error(msg); };

const sveltePlugin = {
  name: "svelte-ssr",
  setup(b) {
    b.onLoad({ filter: /\.svelte$/ }, async (a) => {
      const fs = await import("node:fs/promises");
      const src = await fs.readFile(a.path, "utf8");
      return { contents: compile(src, { generate: "server", filename: a.path, runes: true }).js.code, loader: "js" };
    });
    // Real runes, via compileModule. The other suites define `$state` as an identity function,
    // which is fine for logic and useless for a question about what a component renders.
    b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
      const fs = await import("node:fs/promises");
      const src = await fs.readFile(a.path, "utf8");
      const js = (await esbuild.transform(src, { loader: "ts", target: "es2022" })).code;
      return { contents: compileModule(js, { generate: "server", filename: a.path }).js.code, loader: "js" };
    });
  },
};

const { gnwResolve } = await import("./gnwResolve.mjs");

// ONE BUILD PER PAGE LOAD, and a `?nonce=` query would NOT do instead. The pane and the store are
// separate entry points sharing a chunk, so importing the store under a query string makes a
// second store instance while the pane keeps the un-queried one -- the suite then drives a store
// nothing renders, and every assertion describes a component that was never asked. Separate
// outdirs make each load a genuinely separate module graph, pane and store together.
const LOADS = 16;
const dirs = [...Array(LOADS)].map((_, i) => join(out, `d${i}`));
await Promise.all(dirs.map((d) => esbuild.build({
  entryPoints: [
    join(web, "src/lib/ui/ActivityPane.svelte"),
    join(web, "src/lib/auditLog.svelte.ts"),
    join(web, "src/lib/logEntry.ts"),
  ],
  outdir: d, bundle: true, splitting: true, format: "esm", platform: "node", target: "es2022",
  external: ["svelte", "svelte/*"],
  plugins: [gnwResolve(join(here, ".")), sveltePlugin],
  logLevel: "error",
})));

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, v); }
  removeItem(k) { this.map.delete(k); }
}
let storage = new FakeStorage();
globalThis.sessionStorage = storage;
// The store registers a `pagehide` listener when `window` exists; these loads drive saves directly.
delete globalThis.window;

let nonce = 0;
/** Every store built in the current check, so its pending debounced write can be cancelled before
 *  the next one starts. A save left in flight fires a second later, into the NEXT check's storage,
 *  and that check then loads a record that is not its fixture. */
let live = [];

/** One page load: a fresh module graph reading whatever is in storage, and the pane bound to it. */
async function load() {
  const d = dirs[nonce++];
  if (d === undefined) throw new Error("the suite ran out of prebuilt loads; raise LOADS");
  const m = await import(pathToFileURL(join(d, "auditLog.svelte.js")).href);
  const le = await import(pathToFileURL(join(d, "logEntry.js")).href);
  const Pane = (await import(pathToFileURL(join(d, "ui/ActivityPane.js")).href)).default;
  live.push(m.auditLog);
  // ARMED: the pane must render the very store this returns, or every check below is vacuous.
  const probe = `PROBE-${nonce}`;
  m.auditLog.add("debug", "device", le.literal(probe));
  m.auditLog.showDebug = true;
  if (!render(Pane, {}).body.includes(probe)) {
    throw new Error("the pane is not bound to the store this suite drives");
  }
  m.auditLog.showDebug = false;
  m.auditLog.entries = m.auditLog.entries.filter((e) => e.message.text !== probe);
  return { auditLog: m.auditLog, literal: le.literal, html: () => render(Pane, {}).body };
}

const queue = [];
function check(name, fn) {
  queue.push(async () => {
    for (const a of live) a.flush();   // cancels the debounce; the storage below replaces the bytes
    live = [];
    storage = new FakeStorage();
    globalThis.sessionStorage = storage;
    try { await fn(); passed++; }
    catch (e) { failures.push(`  FAIL ${name}: ${e.message}`); }
  });
}

/** A record spanning a pre-stamp block and one earlier stamped load, as an upgrade really leaves
 *  it: the previous build wrote no `g` at all. */
function seed() {
  storage.map.set("gnw.activityLog.v1", JSON.stringify({
    f: 1,
    g: [{ i: 4, a: "2026-09-12 09:00:00" }],
    e: [
      { t: "2026-09-12 08:00:00", v: "info", s: "device", m: { x: "PRESTAMP-ONE" } },
      { t: "2026-09-12 08:00:01", v: "error", s: "device", m: { x: "PRESTAMP-TWO" } },
      { t: "2026-09-12 09:01:00", v: "info", s: "device", g: 4, m: { x: "EARLIER-LOAD" } },
    ],
  }));
}
const MARKS = ["PRESTAMP-ONE", "PRESTAMP-TWO", "EARLIER-LOAD", "THIS-LOAD"];
const shownIn = (html) => MARKS.filter((x) => html.includes(x));

// --- 1. The reported defect ----------------------------------------------------------------------

check("selecting a session RENDERS that session's lines and no others", async () => {
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));

  const list = auditLog.sessions;
  eq(list.length, 3, "the fixture did not produce three sittings to choose between");
  for (const s of list) {
    auditLog.sessionFilter = s.id;
    const want = auditLog.entries.filter((e) => e.session === s.id).map((e) => e.message.text);
    eq(shownIn(html()), want, `selecting session ${s.id} rendered the wrong lines`);
  }
});

check("the pre-stamp block does not leak into another session's selection", async () => {
  // Its entries carry no stored id, so any predicate shaped "not equal to the selected one" would
  // admit them everywhere. This asserts against the RENDERED list, not the predicate.
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  auditLog.sessionFilter = auditLog.currentSession;
  const shown = html();
  ok(shown.includes("THIS-LOAD"), "the live session's own line is missing");
  ok(!shown.includes("PRESTAMP-ONE") && !shown.includes("PRESTAMP-TWO"),
    "the pre-stamp block rendered inside another session's selection");
});

check("THE COUNT LINE states the selected session's total, not the whole record", async () => {
  // THE ACTUAL DEFECT. The list was right; this line said `of 4` while one sitting was selected.
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  eq(auditLog.entries.length, 4, "the fixture does not hold four lines, so the totals cannot differ");

  auditLog.sessionFilter = null;   // every session, which is no longer the default
  ok(html().includes("Showing 4 of 4"), `asking for every session, the count line is wrong: ${countLine(html())}`);

  auditLog.sessionFilter = auditLog.currentSession;
  ok(html().includes("Showing 1 of 1"),
    `with one sitting selected the pane still advertises the whole record: ${countLine(html())}`);

  // The pre-stamp block is the row with no recorded load time; the live row is drawn first now.
  const preStamp = auditLog.sessions.find((s) => s.startedAt === undefined);
  auditLog.sessionFilter = preStamp.id;
  ok(html().includes("Showing 2 of 2"),
    `the pre-stamp block's total is not its own: ${countLine(html())}`);
});

function countLine(html) {
  return (html.match(/Showing \d+ of \d+/) ?? ["no count line rendered"])[0];
}

check("the error count in the segment is scoped to the selection too", async () => {
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  // One error in the whole record, and it is in the pre-stamp block.
  eq(auditLog.entries.filter((e) => e.severity === "error").length, 1, "the fixture needs exactly one error");
  const segCount = (h) => (h.match(/segcount[^>]*>(\d+)</) ?? [null, "0"])[1];
  auditLog.sessionFilter = null;
  eq(segCount(html()), "1", "across every session the segment does not count the record's one error");

  auditLog.sessionFilter = auditLog.currentSession;
  eq(segCount(html()), "0",
    "the Error segment still advertises an error from a sitting that is not on screen");
});

// --- 2. The rows and what they stand for ---------------------------------------------------------

check("no session row is drawn for a sitting whose lines the list cannot show", async () => {
  // A load that logged only `dbg()` lines, which is what a library scan looks like. Debug is off by
  // default, so such a row would be selectable and would render "Nothing to report yet."
  storage.map.set("gnw.activityLog.v1", JSON.stringify({
    f: 1,
    g: [{ i: 5, a: "2026-09-12 07:00:00" }],
    e: [{ t: "2026-09-12 07:00:01", v: "debug", s: "device", g: 5, m: { x: "DEBUG-ONLY" } }],
  }));
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));

  eq(auditLog.sessions.map((s) => s.live), [true],
    "a sitting with nothing the list can show is still offered as a row");
  // And it comes back the moment debug is asked for, because then the list can show it.
  auditLog.showDebug = true;
  eq(auditLog.sessions.length, 2, "turning debug on did not reveal the sitting that holds it");
  auditLog.sessionFilter = null;
  ok(html().includes("DEBUG-ONLY"), "the debug line is not rendered with its chip on");
});

check("with nothing selected the whole record renders, with a rule between sittings", async () => {
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  auditLog.sessionFilter = null;
  const shown = html();
  eq(shownIn(shown), MARKS, "asking for every session does not render every line");
  // Three sittings means two boundaries.
  eq((shown.match(/class="reload[ "]/g) ?? []).length, 2,
    "the reload boundary is not drawn once between each pair of sittings");
});

check("a single sitting draws no session list and no boundary rule", async () => {
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  const shown = html();
  // The token, not the exact attribute: Svelte appends its scope class, so `class="sessions"` on
  // its own never appears and both of these would pass whatever the pane drew.
  ok(!/class="sessions[ "]/.test(shown), "a list of one sitting was drawn");
  ok(!/class="reload[ "]/.test(shown), "a boundary was drawn inside a single sitting");
});

// --- 3. Order ---------------------------------------------------------------------------------

check("the sessions list reads NEWEST first, while the ids stay oldest-first", async () => {
  // "The activity sessions list should be ordered top-bottom newest-oldest." Only the drawing
  // reverses: an entry's `session` stamp must keep meaning the same sitting.
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));

  const list = auditLog.sessions;
  eq(list.length, 3, "the fixture did not produce three sittings");
  eq(list[0].live, true, "the newest sitting is not at the top");
  ok(list[0].id > list[1].id && list[1].id > list[2].id,
    `the ids do not run oldest-first underneath the reversed drawing: ${list.map((s) => s.id)}`);

  // And the DRAWN order matches, not just the array: the rows carry their start times, so the
  // clock times must appear down the markup newest to oldest.
  const shown = html();
  const at = (t) => shown.indexOf(t);
  ok(at("09:01:00") > 0 && at("08:00:00") > 0, "the session rows do not carry their start times");
  ok(at("09:01:00") < at("08:00:00"),
    "the older sitting is drawn above the newer one");
});

check("the ENTRY list inside a sitting still reads oldest first", async () => {
  // Index newest-first, record oldest-first: deliberate, and stated so nobody "fixes" one to match
  // the other. The boundary rules read downward against this order.
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  auditLog.sessionFilter = null;
  const shown = html();
  ok(shown.indexOf("PRESTAMP-ONE") < shown.indexOf("PRESTAMP-TWO"),
    "the entries within a sitting are no longer oldest-first");
  ok(shown.indexOf("PRESTAMP-TWO") < shown.indexOf("EARLIER-LOAD"),
    "the sittings within the entry list are no longer oldest-first");
});

// --- 4. What the pane opens on -------------------------------------------------------------------
// The owner: "When the app loads, it loads all activity sessions and doesn't start a new session
// until the device has finished loading. Selecting an older session and then selecting the current
// session hides the previous sessions. Just opening up the activity after letting it load has the
// whole thing loaded still."

check("a fresh load opens on the live sitting, BEFORE anything has been logged into it", async () => {
  // THE HARD CASE. At this point the live sitting holds no entry at all. The row must already be
  // there and already chosen, or the pane opens on the whole record and snaps later.
  seed();
  const { auditLog, html } = await load();
  eq(auditLog.entries.filter((e) => e.session === auditLog.currentSession).length, 0,
    "the fixture has already logged into the live sitting, so this proves nothing");

  eq(auditLog.activeSession, auditLog.currentSession,
    "the pane did not open on the sitting this load just started");
  const shown = html();
  eq(shownIn(shown), [], "the pane opened showing sittings from before this load");
  ok(shown.includes("Showing 0 of 0"), `the count line is wrong on a fresh load: ${countLine(shown)}`);
  // The row exists even with nothing in it, which is what stops the later jump.
  ok(/class="session[ "]/.test(shown), "the live sitting has no row before its first line");
  ok(shown.includes('aria-pressed="true"'), "no row is drawn as chosen on a fresh load");
});

check("the first line into the live sitting lands in a row that is already chosen, with no jump", async () => {
  seed();
  const { auditLog, literal, html } = await load();
  const before = auditLog.activeSession;
  const rowsBefore = auditLog.sessions.length;

  auditLog.add("info", "device", literal("THIS-LOAD"));

  eq(auditLog.activeSession, before, "the selection moved when the first line arrived");
  eq(auditLog.sessions.length, rowsBefore, "a row appeared when the first line arrived");
  eq(shownIn(html()), ["THIS-LOAD"], "the first line did not land in the chosen sitting alone");
});

check("a sitting the user picked by hand survives the first line landing elsewhere", async () => {
  seed();
  const { auditLog, literal, html } = await load();
  const older = auditLog.sessions.find((s) => !s.live && s.startedAt !== undefined);
  auditLog.selectSession(older.id);
  eq(shownIn(html()), ["EARLIER-LOAD"], "the fixture did not start on the hand-picked sitting");

  // The device scan starts writing into the live sitting. His choice must not be taken away.
  auditLog.add("info", "device", literal("THIS-LOAD"));
  eq(auditLog.activeSession, older.id, "logging into the live sitting stole the user's selection");
  eq(shownIn(html()), ["EARLIER-LOAD"], "the pane left the sitting the user had picked");
});

check("clicking the chosen row still reaches every session", async () => {
  // The default moved off "everything", so the state has to stay reachable: it is what the
  // boundary rules between sittings are drawn for.
  seed();
  const { auditLog, literal, html } = await load();
  auditLog.add("info", "device", literal("THIS-LOAD"));
  auditLog.selectSession(auditLog.currentSession);   // toggles the default off
  eq(auditLog.activeSession, null, "turning the chosen row off did not reach every session");
  eq(shownIn(html()), MARKS, "every session is selected but not every line is drawn");
});

// --- Run -----------------------------------------------------------------------------------------
for (const fn of queue) await fn();
rmSync(out, { recursive: true, force: true });
for (const f of failures) console.log(f);
console.log(`activitypane: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
