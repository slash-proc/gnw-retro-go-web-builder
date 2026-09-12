/**
 * THE ACTIVITY LOG SURVIVES A RELOAD.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/auditlogpersist.mjs'
 *
 * The owner hit a hang with no way out but a refresh, and the refresh destroyed the log recording
 * the bug: "the UI is stuck which sucks because I can[not] pull up the activity log now. I have
 * to refresh the page to get out of here."
 *
 * A RELOAD IS SIMULATED PROPERLY. Every check that claims something survives builds the store
 * TWICE against ONE shared fake `sessionStorage` -- a second esbuild output, imported fresh, so
 * the second store is a genuinely new module instance with no memory of the first beyond what it
 * reads back out of storage. Asserting against the same instance would pass whether or not a
 * single byte was ever written, which is the obvious trap here and the one this file is shaped
 * to avoid.
 *
 * What is pinned:
 *   - entries come back after a reload, in order, with their severity, source and subject;
 *   - a KEYED entry comes back keyed, so a restored line is still rendered in the user's own
 *     language and still copies as English -- the property `logEntry.ts` exists for;
 *   - a keyed entry whose key no longer exists in this build degrades to its stored English
 *     instead of to `undefined`;
 *   - the two budgets stay INDEPENDENT across a reload: a debug flood cannot evict errors;
 *   - the bell does not ring for restored errors;
 *   - `clear()` is honoured across a reload;
 *   - a throwing, full, or absent storage leaves a working app with no log;
 *   - SESSIONS: an entry is stamped with the page load that wrote it, that stamp survives the
 *     reload which ends the session, the load time is recorded separately from the entries so
 *     eviction cannot move a listed start, a record written before the stamp existed is neither
 *     lost nor folded into the live load, and a session whose entries are all evicted stops
 *     existing rather than listing a range it no longer holds. The LIVE sitting is the exception
 *     and always has a row: it has a real start, no end, and claims nothing about vanished lines.
 *     The pane opens on it, so a selection it cannot honour falls back there, never to "every
 *     session" -- which would silently show more than the row that looks chosen.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "gwrg-logpersist-"));
const failures = [];
let passed = 0;

const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};
const ok = (c, msg) => { if (!c) throw new Error(msg); };

// --- Build -------------------------------------------------------------------------------------
// `en.js` and `locale.svelte.js` are faked: they are the two runes/table modules, and a key path
// is only meaningful against a table, so this suite supplies one it can reason about. The path
// recorder, the serializer and the store are all REAL.
const fake = {
  "locale.svelte.js":
    "export const locale = { t: { demo: { plain: 'DE|plain', withArg: (n) => `DE|arg ${n}`," +
    " nested: (inner) => `DE|nest(${inner})` } } };",
  "en.js":
    "export const en = { demo: { plain: 'EN|plain', withArg: (n) => `EN|arg ${n}`," +
    " nested: (inner) => `EN|nest(${inner})` } };",
};

const { gnwResolve } = await import("./gnwResolve.mjs");
const lib = join(here, "../src/lib");

async function compile(dir) {
  await esbuild.build({
    entryPoints: [join(lib, "auditLog.svelte.ts"), join(lib, "logEntry.ts"), join(lib, "auditLogPersist.ts")],
    outdir: join(out, dir),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    define: { $state: "__rune" },
    banner: { js: "const __rune = (v) => v;" },
    logLevel: "warning",
    plugins: [
      gnwResolve(join(here, ".")),
      {
        name: "lp-fakes",
        setup(build) {
          build.onResolve({ filter: /(locale\.svelte|i18n\/en)\.js$/ }, (a) => ({
            path: a.path.endsWith("en.js") ? "en.js" : "locale.svelte.js",
            namespace: "lp-fake",
          }));
          build.onLoad({ filter: /.*/, namespace: "lp-fake" }, (a) => ({ contents: fake[a.path], loader: "js" }));
        },
      },
    ],
  });
}
// Two outputs, so two imports are genuinely two module instances rather than one cached copy.
await compile("a");
await compile("b");

// --- The fake session storage -------------------------------------------------------------------
// Deliberately a real string map with real `getItem`/`setItem`, not a spy: the checks below are
// about what survives a round trip through serialization, and a spy would let a broken serializer
// pass by handing the object straight back.
class FakeStorage {
  constructor() { this.map = new Map(); this.limit = Infinity; this.throwOnSet = false; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (this.throwOnSet) throw new Error("QuotaExceededError");
    if (v.length > this.limit) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k) { this.map.delete(k); }
}

let storage = new FakeStorage();
globalThis.sessionStorage = storage;
// `auditLog.svelte.ts` registers a `pagehide` listener when `window` exists. It must not here:
// this suite drives `flush()` explicitly, and a stray global would make the two loads share state
// through something other than storage.
delete globalThis.window;

/** Load a fresh store instance, as a page load does. `dir` picks one of the two builds. */
async function load(dir, nonce) {
  const url = pathToFileURL(join(out, dir, "auditLog.svelte.js")).href + `?n=${nonce}`;
  return await import(url);
}
const logEntry = await import(pathToFileURL(join(out, "a/logEntry.js")).href);
const { msg, literal } = logEntry;

let nonce = 0;
const queue = [];
function check(name, fn) {
  queue.push(async () => {
    storage = new FakeStorage();
    globalThis.sessionStorage = storage;
    try { await fn(); passed++; }
    catch (e) { failures.push(`  FAIL ${name}: ${e.message}`); }
  });
}

// --- 1. The requirement -------------------------------------------------------------------------

check("entries come back after a reload, in order", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("one"));
  first.auditLog.add("error", "converter", literal("two"), "pokemon.gba");
  first.auditLog.flush();
  ok(storage.map.size === 1, "nothing was written to storage at all");

  const second = await load("b", nonce++);
  eq(second.auditLog.entries.map((e) => e.message.text), ["one", "two"], "the log did not come back");
  eq(second.auditLog.entries.map((e) => e.severity), ["info", "error"], "severities did not survive");
  eq(second.auditLog.entries.map((e) => e.source), ["device", "converter"], "sources did not survive");
  eq(second.auditLog.entries[1].subject, "pokemon.gba", "the subject did not survive");
  ok(second.auditLog.entries.every((e) => e.restored), "restored entries are not marked as restored");
});

check("a restored entry is still KEYED, so it renders in the display locale", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "converter", msg((t) => t.demo.withArg, 11));
  first.auditLog.flush();

  const second = await load("b", nonce++);
  // The pane opens on the sitting this load just started; these checks are about the RECORD, so
  // they ask for every session explicitly.
  second.auditLog.sessionFilter = null;
  const e = second.auditLog.entries[0];
  eq(e.message.kind, "keyed", "the entry was frozen into a literal");
  // The DISPLAY locale, through the real renderer and the store's own line().
  ok(second.auditLog.line(e).includes("DE|arg 11"), `restored line is not localised: ${second.auditLog.line(e)}`);
  // And English for the bug report, which is the copy path's whole contract.
  eq(second.auditLog.copyText(), `${e.time} EN|arg 11`, "copyText is not English");
});

check("a nested keyed param survives too", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "converter", msg((t) => t.demo.nested, msg((t) => t.demo.plain)));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  second.auditLog.sessionFilter = null;
  const copied = second.auditLog.copyText();
  ok(copied.endsWith("EN|nest(EN|plain)"), `the nested entry was lost: ${copied}`);
  eq(second.auditLog.entries[0].message.params.length, 1, "the nested param did not survive as a param");
});

check("a key this build no longer has degrades to the stored English, never to undefined", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("error", "converter", msg((t) => t.demo.withArg, 7));
  first.auditLog.flush();

  // Rewrite the stored path to one that does not exist, which is what a deploy between the two
  // loads does. The stored English must carry the line instead.
  const key = "gnw.activityLog.v1";
  const doc = JSON.parse(storage.getItem(key));
  doc.e[0].m.k = ["demo", "keyThatWentAway"];
  storage.setItem(key, JSON.stringify(doc));

  const second = await load("b", nonce++);
  second.auditLog.sessionFilter = null;
  const line = second.auditLog.copyText();
  ok(!line.includes("undefined"), `a stale key rendered as undefined: ${line}`);
  ok(line.includes("EN|arg 7"), `the stored English was not used: ${line}`);
});

// --- 2. The budgets -----------------------------------------------------------------------------

check("the two budgets stay independent across a reload: a debug flood cannot evict an error", async () => {
  const first = await load("a", nonce++);
  const { MAX_DEBUG_ENTRIES } = first;
  first.auditLog.add("error", "converter", literal("the error that matters"));
  // A library sync's worth of debug, several times the debug budget.
  for (let i = 0; i < MAX_DEBUG_ENTRIES * 3; i++) first.auditLog.add("debug", "device", literal(`d${i}`));
  first.auditLog.flush();

  const second = await load("b", nonce++);
  const kept = second.auditLog.entries.filter((e) => e.severity !== "debug");
  const debug = second.auditLog.entries.filter((e) => e.severity === "debug");
  eq(kept.map((e) => e.message.text), ["the error that matters"], "the error was evicted by the debug flood");
  eq(debug.length, MAX_DEBUG_ENTRIES, "the debug budget was not applied on restore");
  // ARMED: if the flood were smaller than the budget this would prove nothing.
  ok(MAX_DEBUG_ENTRIES * 3 > MAX_DEBUG_ENTRIES, "the fixture must overflow the debug budget");
});

check("the write side trims, so a long session cannot grow the stored record without limit", async () => {
  const first = await load("a", nonce++);
  const { MAX_ENTRIES } = first;
  for (let i = 0; i < MAX_ENTRIES + 50; i++) first.auditLog.add("info", "device", literal(`n${i}`));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  eq(second.auditLog.entries.length, MAX_ENTRIES, "the kept budget was not enforced on restore");
  // OLDEST dropped, newest survive: the reason someone opens this is what just happened.
  eq(second.auditLog.entries[0].message.text, `n${50}`, "the wrong end was dropped");
});

check("a stored record OVER this build's budgets is trimmed on the way IN", async () => {
  // NOT through `save()`. Everything `save()` writes is already within budget, so a check that
  // round-trips through it proves only that the write side trims -- removing the restore-side
  // trim entirely leaves such a check green. This is the case that needs the guard: a record
  // written by a build with larger budgets, or storage edited by anything else on the origin.
  const first = await load("a", nonce++);
  const { MAX_ENTRIES, MAX_DEBUG_ENTRIES } = first;
  const e = [];
  for (let i = 0; i < MAX_ENTRIES + 60; i++) e.push({ t: "00:00:00", v: "info", s: "device", m: { x: `n${i}` } });
  for (let i = 0; i < MAX_DEBUG_ENTRIES + 60; i++) e.push({ t: "00:00:00", v: "debug", s: "device", m: { x: `d${i}` } });
  storage.map.set("gnw.activityLog.v1", JSON.stringify({ f: 1, e }));

  const second = await load("b", nonce++);
  const kept = second.auditLog.entries.filter((x) => x.severity !== "debug");
  const debug = second.auditLog.entries.filter((x) => x.severity === "debug");
  eq(kept.length, MAX_ENTRIES, "the kept budget was not enforced on a record read from storage");
  eq(debug.length, MAX_DEBUG_ENTRIES, "the debug budget was not enforced on a record read from storage");
  // Oldest-first, per class, exactly as the live budgets drop.
  eq(kept[0].message.text, "n60", "the wrong end of the kept class was dropped");
  eq(debug[0].message.text, "d60", "the wrong end of the debug class was dropped");
});

// --- 3. The bell --------------------------------------------------------------------------------

check("the bell does not ring for a restored error", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("error", "converter", literal("boom"));
  eq(first.auditLog.unattended, 1, "the live error should ring");
  first.auditLog.flush();

  const second = await load("b", nonce++);
  eq(second.auditLog.entries.length, 1, "the error did not survive at all, so this proves nothing");
  eq(second.auditLog.unattended, 0, "a page load rang the bell for an error from before it");
  eq(second.auditLog.notifications.length, 0, "the restored error is listed as a notification");
});

check("a live error still rings after a restore", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("error", "converter", literal("old"));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  second.auditLog.add("error", "converter", literal("new"));
  eq(second.auditLog.unattended, 1, "restoring broke the bell for genuinely new errors");
  eq(second.auditLog.notifications[0].message.text, "new", "the wrong entry rang");
});

// --- 4. Clearing --------------------------------------------------------------------------------

check("clear() is honoured across a reload", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("gone"));
  first.auditLog.flush();
  first.auditLog.clear();
  const second = await load("b", nonce++);
  eq(second.auditLog.entries.length, 0, "a cleared log came back after a reload");
});

// --- 5. Storage that is absent, full, or hostile -------------------------------------------------

check("no storage at all leaves a working log", async () => {
  delete globalThis.sessionStorage;
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("still works"));
  first.auditLog.flush();
  eq(first.auditLog.entries.length, 1, "the live log broke when storage was missing");
  globalThis.sessionStorage = storage;
});

check("a storage that throws on every write leaves a working log", async () => {
  storage.throwOnSet = true;
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("still works"));
  first.auditLog.flush();
  eq(first.auditLog.entries.length, 1, "the live log broke when storage refused");
  eq(storage.map.size, 0, "something was written to a storage that always throws");
});

check("a quota that fits only part of the log sheds DEBUG first", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("error", "converter", literal("keep me"));
  for (let i = 0; i < 100; i++) first.auditLog.add("debug", "device", literal(`debug line number ${i}`));
  // Big enough for the error and a little more, far too small for a hundred debug lines.
  storage.limit = 400;
  first.auditLog.flush();
  ok(storage.map.size === 1, "the quota path gave up entirely instead of shedding");

  storage.limit = Infinity;
  const second = await load("b", nonce++);
  const kept = second.auditLog.entries.filter((e) => e.severity !== "debug");
  eq(kept.map((e) => e.message.text), ["keep me"], "the error was shed before the debug lines");
});

check("unreadable stored data is dropped, not half-parsed", async () => {
  storage.map.set("gnw.activityLog.v1", "{not json at all");
  const first = await load("a", nonce++);
  eq(first.auditLog.entries.length, 0, "garbage in storage produced entries");
  first.auditLog.add("info", "device", literal("fine"));
  eq(first.auditLog.entries.length, 1, "the log broke after reading garbage");
});

check("a record from a future format version is dropped", async () => {
  storage.map.set("gnw.activityLog.v1", JSON.stringify({ f: 99, e: [{ t: "00:00:00", v: "info", s: "device", m: { x: "hi" } }] }));
  const first = await load("a", nonce++);
  eq(first.auditLog.entries.length, 0, "a record this build cannot read was adopted anyway");
});

// --- 6. The size measurement ---------------------------------------------------------------------

check("a full worst-case log fits a sessionStorage quota", async () => {
  const first = await load("a", nonce++);
  const { MAX_ENTRIES, MAX_DEBUG_ENTRIES } = first;
  const persist = await import(pathToFileURL(join(out, "a/auditLogPersist.js")).href);
  // Realistic worst case: every slot full, keyed entries with params for the readable levels and
  // the long `dbg()` lines the SD sync emits for the debug tier.
  const entries = [];
  for (let i = 0; i < MAX_ENTRIES; i++) {
    entries.push({
      time: "12:34:56",
      severity: i % 3 === 0 ? "error" : i % 3 === 1 ? "warning" : "info",
      source: "converter",
      subject: `Some Game Title (USA) (Rev 1).gba`,
      message: msg((t) => t.demo.withArg, `malformed (input ${i} could not be identified)`),
    });
  }
  for (let i = 0; i < MAX_DEBUG_ENTRIES; i++) {
    entries.push({
      time: "12:34:56",
      severity: "debug",
      source: "device",
      message: literal(`[sd-sync] wrote roms/gba/Some Game Title (USA) (Rev 1).gba 16777216 B (${i})`),
    });
  }
  const bytes = persist.serialize(entries).length;
  globalThis.__measuredBytes = bytes;
  // sessionStorage is ~5 MB per origin in every browser this app supports. A worst case well
  // under that is the claim; the shedding path covers the rest.
  ok(bytes < 1_000_000, `a full log serializes to ${bytes} B, which is too close to the quota`);
});

// --- 7. Sessions ---------------------------------------------------------------------------------
// A session is ONE PAGE LOAD. Each check below drives two or three real loads against one shared
// storage, because a stamp that survives only within a single module instance is exactly the
// thing that would make all of this look correct and be worthless.

check("entries carry the load that wrote them, and a reload starts a new one", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("in the first load"));
  first.auditLog.flush();

  const second = await load("b", nonce++);
  second.auditLog.add("info", "device", literal("in the second load"));
  const [older, newer] = second.auditLog.entries;
  ok(older.session !== newer.session,
    `both loads wrote into one session (${older.session} and ${newer.session})`);
  eq(newer.session, second.auditLog.currentSession, "the live entry is not in the live session");
  // Oldest-first numbering, so the restored block sits before this load.
  ok(older.session < newer.session, "the restored session did not sort before the live one");
});

check("the sessions list has one row per load, NEWEST first, and the live one has no end", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("one"));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  second.auditLog.add("info", "device", literal("two"));

  const list = second.auditLog.sessions;
  eq(list.length, 2, "the two loads did not produce two session rows");
  // Newest at the top, which is the order the owner asked the list to read in.
  eq(list.map((s) => s.live), [true, false], "the live session is not the FIRST row");
  eq(list[0].id, second.auditLog.currentSession, "the live row is not this load");
  ok(list[0].id > list[1].id, "the ids stopped running oldest-first under the reversed drawing");
  // Every row states a real range built from entries it actually holds.
  ok(list.every((s) => s.firstAt && s.lastAt), "a session row has no time range");
});

check("a session's listed START is the recorded load time, not its oldest surviving entry", async () => {
  // THE REASON THE START IS RECORDED SEPARATELY FROM THE ENTRIES. Eviction drops the OLDEST lines,
  // so a start read off the entries drifts later and later and ends up claiming the sitting began
  // after it did. The fixture makes the two answers DIFFERENT: a load time an hour before any
  // entry that is still held.
  storage.map.set("gnw.activityLog.v1", JSON.stringify({
    f: 1,
    g: [{ i: 7, a: "2026-09-11 20:00:00" }],
    e: [
      { t: "2026-09-11 21:00:00", v: "info", s: "device", g: 7, m: { x: "first held" } },
      { t: "2026-09-11 21:30:00", v: "info", s: "device", g: 7, m: { x: "last held" } },
    ],
  }));

  const now = await load("a", nonce++);
  // The live row is drawn first now, so the restored sitting is the one that is not live.
  const row = now.auditLog.sessions.find((s) => !s.live);
  eq(row.firstAt, "2026-09-11 21:00:00", "the fixture's oldest held entry is not where it was put");
  eq(row.startedAt, "2026-09-11 20:00:00",
    "the listed start came from the entries, so eviction would drag it later than the truth");
  // The END is allowed to come from the entries, and must: eviction never eats a session's tail.
  eq(row.lastAt, "2026-09-11 21:30:00", "the session does not end at its last entry");
});

check("a session with a load time but no entries left is not listed at all", async () => {
  // The other half of the same rule: a recorded start is not itself a reason to draw a row.
  storage.map.set("gnw.activityLog.v1", JSON.stringify({
    f: 1,
    g: [{ i: 3, a: "2026-09-11 19:00:00" }, { i: 7, a: "2026-09-11 20:00:00" }],
    e: [{ t: "2026-09-11 21:00:00", v: "info", s: "device", g: 7, m: { x: "the only line" } }],
  }));
  const now = await load("a", nonce++);
  // The live sitting always has a row, so what is pinned here is that no PAST sitting without
  // entries does: session 3 had a recorded start and nothing else, and must not be offered.
  const past = now.auditLog.sessions.filter((s) => !s.live);
  eq(past.length, 1, "a past session with a start and no entries was listed");
  eq(past[0].startedAt, "2026-09-11 20:00:00", "the wrong session survived");
});

check("the load time survives the reload, and is not re-stamped as the new load's", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("old work"));
  const wasStarted = first.auditLog.sessions[0].startedAt;
  ok(wasStarted !== undefined, "the first load recorded no start, so this proves nothing");
  first.auditLog.flush();

  const second = await load("b", nonce++);
  second.auditLog.add("info", "device", literal("new work"));
  const list = second.auditLog.sessions;
  eq(list.length, 2, "the reload did not produce two rows");
  eq(list[0].startedAt, wasStarted, "the restored session lost or re-stamped its load time");
});

check("a record written BEFORE the stamp existed is kept, and is not this load's work", async () => {
  // Exactly what the previous build wrote: entries with no `g` on any of them, and no `g` table.
  storage.map.set("gnw.activityLog.v1", JSON.stringify({
    f: 1,
    e: [
      { t: "2026-09-11 22:01:00", v: "info", s: "device", m: { x: "from the old build" } },
      { t: "2026-09-11 22:02:00", v: "error", s: "converter", m: { x: "and its failure" } },
    ],
  }));

  const now = await load("a", nonce++);
  eq(now.auditLog.entries.length, 2, "the pre-stamp record was thrown away");
  now.auditLog.add("info", "device", literal("this load"));

  const old = now.auditLog.entries.filter((e) => e.message.text !== "this load");
  ok(old.every((e) => e.session !== now.auditLog.currentSession),
    "the pre-stamp entries were folded into the live load, which did not write them");
  eq(new Set(old.map((e) => e.session)).size, 1, "the pre-stamp block was split across sessions");

  const list = now.auditLog.sessions;
  eq(list.length, 2, "the pre-stamp block is not listed as its own session");
  const block = list.find((s) => !s.live);
  eq(block.startedAt, undefined, "a load time was invented for a record that carries none");
  // It still lists a real range, taken from entries it genuinely holds.
  eq(block.firstAt, "2026-09-11 22:01:00", "the pre-stamp row does not start at its first entry");
  eq(block.lastAt, "2026-09-11 22:02:00", "the pre-stamp row does not end at its last entry");
});

check("a session whose entries are ALL evicted stops being listed", async () => {
  // A ROW THAT OUTLIVED ITS ENTRIES WOULD BE A LIE: it would state a range for lines the log no
  // longer has. The sessions are derived from the entries, so this cannot drift apart.
  const first = await load("a", nonce++);
  const { MAX_ENTRIES } = first;
  first.auditLog.add("info", "device", literal("the only line of load one"));
  first.auditLog.flush();

  const second = await load("b", nonce++);
  // The live session earns its row by writing, not by existing: a load that has logged nothing is
  // correctly not listed, so the fixture has to give it a line before it can be counted.
  second.auditLog.add("info", "device", literal("the first line of load two"));
  eq(second.auditLog.sessions.length, 2, "the fixture did not start with two sessions");
  // Flood the kept class past its budget: load one's single line is the oldest and goes first.
  for (let i = 0; i < MAX_ENTRIES + 5; i++) second.auditLog.add("info", "device", literal(`n${i}`));
  ok(!second.auditLog.entries.some((e) => e.message.text === "the only line of load one"),
    "the fixture did not actually evict load one's entry");
  eq(second.auditLog.sessions.length, 1, "an emptied session is still listed");
  eq(second.auditLog.sessions[0].live, true, "the surviving row is not this load");
});

check("the start table does not grow across reloads as sessions are evicted", async () => {
  // The starts ride inside the one stored record. A start left behind for a session with nothing
  // left would be read back and written out again on every load, forever.
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("load one"));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  const { MAX_ENTRIES } = second;
  for (let i = 0; i < MAX_ENTRIES + 5; i++) second.auditLog.add("info", "device", literal(`n${i}`));
  second.auditLog.flush();

  const doc = JSON.parse(storage.getItem("gnw.activityLog.v1"));
  const ids = new Set((doc.e ?? []).map((e) => e.g));
  for (const g of doc.g ?? []) {
    ok(ids.has(g.i), `a start was written for session ${g.i}, which has no entries in the record`);
  }
});

check("a session SHED to fit the quota does not leave its start in the record", async () => {
  // A DIFFERENT PATH FROM EVICTION, and the reason `serialize` prunes as well as the store.
  // `shed()` drops entries at WRITE time to fit a quota; the store still holds them, so its own
  // pruning cannot see the loss. Writing a start for a session whose lines were just shed spends
  // bytes at exactly the moment there are none to spare.
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("load one, which will be shed"));
  first.auditLog.flush();

  const second = await load("b", nonce++);
  for (let i = 0; i < 100; i++) second.auditLog.add("info", "device", literal(`a reasonably long line number ${i}`));
  eq(second.auditLog.sessions.length, 2, "the fixture did not produce two sessions to choose between");
  // Too small for everything, big enough that shedding keeps the newest half.
  storage.limit = 3000;
  second.auditLog.flush();
  storage.limit = Infinity;

  const doc = JSON.parse(storage.getItem("gnw.activityLog.v1"));
  const held = new Set((doc.e ?? []).map((e) => e.g));
  ok(!(doc.e ?? []).some((e) => e.m.x === "load one, which will be shed"),
    "the fixture did not actually shed load one");
  for (const g of doc.g ?? []) {
    ok(held.has(g.i), `a start was written for session ${g.i}, whose entries were all shed`);
  }
});

// --- 8. The session filter -----------------------------------------------------------------------

check("picking a session narrows the list, and composes with the other filters", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("old info"));
  first.auditLog.add("error", "device", literal("old error"));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  second.auditLog.add("info", "device", literal("new info"));
  second.auditLog.add("error", "device", literal("new error"));

  const older = second.auditLog.sessions.find((s) => !s.live);
  second.auditLog.sessionFilter = null;
  eq(second.auditLog.filtered.length, 4, "asking for every session does not show every line");

  second.auditLog.selectSession(older.id);
  eq(second.auditLog.filtered.map((e) => e.message.text), ["old info", "old error"],
    "picking a session did not narrow the list to it");

  // COMPOSES: the severity segment still applies inside the chosen session.
  second.auditLog.severityFilter = "error";
  eq(second.auditLog.filtered.map((e) => e.message.text), ["old error"],
    "the severity segment stopped applying once a session was picked");
  second.auditLog.severityFilter = "all";

  // Toggling the same row off returns the whole record.
  second.auditLog.selectSession(older.id);
  eq(second.auditLog.filtered.length, 4, "unpicking a session did not restore the whole record");
});

check("copyText follows the session filter, because the count line says it does", async () => {
  const first = await load("a", nonce++);
  first.auditLog.add("info", "device", literal("old"));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  second.auditLog.add("info", "device", literal("new"));
  second.auditLog.sessionFilter = second.auditLog.currentSession;
  const copied = second.auditLog.copyText();
  ok(copied.includes("new"), "the chosen session is missing from the copy");
  ok(!copied.includes("old"), "copy ignored the session filter, so the count line beside it lies");
});

check("a selection whose session is evicted falls back to the live sitting", async () => {
  const first = await load("a", nonce++);
  const { MAX_ENTRIES } = first;
  first.auditLog.add("info", "device", literal("load one"));
  first.auditLog.flush();
  const second = await load("b", nonce++);
  const older = second.auditLog.sessions.find((s) => !s.live);
  second.auditLog.sessionFilter = older.id;
  eq(second.auditLog.filtered.length, 1, "the fixture did not start with the old session selected");

  for (let i = 0; i < MAX_ENTRIES + 5; i++) second.auditLog.add("info", "device", literal(`n${i}`));
  // It falls back to the LIVE sitting, which is the default, and never to "every session" --
  // that would silently put the pane back to showing more than the row that looks chosen.
  eq(second.auditLog.activeSession, second.auditLog.currentSession,
    "an evicted selection did not fall back to the live sitting");
  ok(second.auditLog.filtered.every((e) => e.session === second.auditLog.currentSession),
    "the fallback showed sittings other than the live one");
  ok(second.auditLog.filtered.length > 0, "the fallback showed nothing at all");
});

// --- Run -----------------------------------------------------------------------------------------
for (const fn of queue) await fn();
rmSync(out, { recursive: true, force: true });
for (const f of failures) console.log(f);
if (globalThis.__measuredBytes) {
  console.log(`  worst-case full log serializes to ${globalThis.__measuredBytes} B`);
}
console.log(`auditlogpersist: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
