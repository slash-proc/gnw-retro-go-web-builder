/**
 * THE ACTIVITY LOG, ACROSS A RELOAD.
 *
 * WHY THIS EXISTS. The install modal hung with no cancel control, and the only way out of a
 * wedged UI is a refresh -- which destroyed the log recording the very bug being reported. The
 * owner: "the UI is stuck which sucks because I can[not] pull up the activity log now. I have to
 * refresh the page to get out of here." A diagnostic whose whole value is being readable after
 * the thing it recorded went wrong must survive the normal way out of that situation.
 *
 * `sessionStorage`, NOT `localStorage`. `Activity.dc.html` heads the surface "this session's
 * record", and a tab is what a session is: `sessionStorage` survives a reload, dies with the
 * tab, and is never shared with another tab or another day. `localStorage` would make yesterday's
 * run reappear beside today's, which is a different feature nobody asked for and which would make
 * the board's own heading false.
 *
 * ENTRIES ARE STILL DATA. `auditLog.svelte.ts` keeps a `LogEntry` rather than a rendered string
 * so the user reads it in their language and `copyText()` renders the same record in English. A
 * keyed entry's "key" is an ACCESSOR FUNCTION (`(t) => t.roms.selectGames.convertFailed`), which
 * JSON cannot hold, so this module records the PATH that accessor walks and rebuilds an
 * equivalent accessor on the way back in. That keeps the property across a reload instead of
 * freezing every restored line into one language.
 *
 * IT ALSO CARRIES THE SESSIONS. Each entry stores the page load that wrote it (`g`), and the doc
 * carries that load's start time (`g` at the top level) so the pane can list the sittings the
 * record spans. A record from before those fields existed still parses entry for entry -- see
 * `UNSTAMPED`, which is why `FORMAT` was not bumped for them.
 *
 * AND IT ALWAYS STORES THE ENGLISH TOO. A reload fetches whatever build is deployed now, so a
 * path recorded by the previous build may name a key this one no longer has. Rendering English at
 * WRITE time costs a short string per entry and makes that case degrade to a readable line
 * instead of to `undefined`. The bug report is the thing that must not break.
 */
import { en, type Strings } from "./i18n/en.js";
import { literal, renderEntry, type LogEntry, type LogParam } from "./logEntry.js";
import { scoped } from "./storageScope.js";

/** One serialized message. `x` is the English rendering and is always present; `k`/`p` are the
 *  key path and its params, present only when the accessor's path was recoverable. */
interface StoredMsg {
  x: string;
  k?: string[];
  p?: StoredParam[];
}
type StoredParam = string | number | boolean | StoredMsg;

/** One serialized entry. Short field names: this is written on every log line and the quota is
 *  a real constraint, not a theoretical one. `g` is the session (page load) that wrote it. */
interface StoredEntry {
  t: string;
  v: string;
  s: string;
  j?: string;
  g?: number;
  m: StoredMsg;
}

/** One serialized session start: `i` the id its entries carry, `a` the load time. */
interface StoredSession {
  i: number;
  a: string;
}

/**
 * THE SESSION AN ENTRY GETS WHEN THE RECORD PREDATES THE STAMP.
 *
 * `g` was added after entries were already being persisted, so a record written by the previous
 * build has entries and no session on any of them. They are real record and must not vanish; they
 * are also NOT this page load's work and must not be folded into it. Giving all of them one id of
 * their own says exactly what is known: one earlier block, before the loads that recorded a start.
 * It sorts before every real id because it is smaller than all of them, and it has no
 * `StoredSession`, so nothing invents a time for it.
 *
 * THE FORMAT IS NOT BUMPED FOR THIS. `FORMAT` is bumped when a record becomes UNREADABLE to this
 * build, and `g` is an added optional field: every old record still parses, entry for entry. A
 * bump here would throw away a log for the sake of a field whose absence is already meaningful.
 */
export const UNSTAMPED = 0;

/** The shape this module needs from an `AuditEntry`, stated structurally so `auditLog` can import
 *  this module without this module importing it back. */
export interface PersistableEntry {
  time: string;
  severity: string;
  source: string;
  subject?: string;
  message: LogEntry;
  /** The page load that wrote it. See `UNSTAMPED` for what a record without one reads as. */
  session: number;
}

/** What `restore()` hands back. The store adds the fields it owns: `id`, `seen` and `restored`. */
export type RestoredEntry = PersistableEntry;

/** A whole record read back: the entries, and the load time of each session they name. A session
 *  with no start recorded is simply absent from the map -- see `UNSTAMPED`. */
export interface RestoredLog {
  entries: RestoredEntry[];
  starts: Map<number, string>;
}

export const STORAGE_KEY = scoped("gnw.activityLog.v1");

/** Bumped when `StoredEntry` changes shape. A record written by an older build is DROPPED rather
 *  than guessed at: the log is a diagnostic, and a half-parsed diagnostic is worse than none. */
const FORMAT = 1;

/**
 * The property path an accessor walks, by walking it with a recording proxy.
 *
 * Every `msg()` call site in this app is a plain chain (`(t) => t.a.b.c`) -- the type-safety of
 * `logEntry.ts` depends on that shape, because the compiler checks the access. So the path is
 * recoverable. Anything cleverer (a conditional, a computed key) records a path that will not
 * resolve against the real table, which `toStoredMsg` checks for before trusting it. There is no
 * guessing: an unrecoverable accessor falls back to the stored English.
 *
 * The proxy target is a function so that an accessor which CALLS something still walks rather
 * than throwing, and symbol keys are ignored because a path is made of string properties.
 */
function keyPath(pick: (t: Strings) => unknown): string[] | undefined {
  const path: string[] = [];
  const probe: unknown = new Proxy(function probeTarget() {} as object, {
    get(_target, prop) {
      if (typeof prop === "string") path.push(prop);
      return probe;
    },
    apply() {
      return probe;
    },
  });
  try {
    pick(probe as Strings);
  } catch {
    return undefined;
  }
  return path.length > 0 ? path : undefined;
}

/** Resolve a recorded path against a real string table, or `undefined` if it is not there. */
function atPath(table: Strings, path: readonly string[]): unknown {
  let v: unknown = table;
  for (const k of path) {
    if (typeof v !== "object" || v === null) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** A path is usable only if it lands on something `renderEntry` can render: a string, or the
 *  function a parameterised key is. */
function resolves(path: readonly string[]): boolean {
  const v = atPath(en, path);
  return typeof v === "string" || typeof v === "function";
}

function toStoredParam(p: LogParam): StoredParam {
  return typeof p === "object" && p !== null ? toStoredMsg(p) : p;
}

function toStoredMsg(e: LogEntry): StoredMsg {
  const x = renderEntry(e, en);
  if (e.kind !== "keyed") return { x };
  const k = keyPath(e.pick);
  if (k === undefined || !resolves(k)) return { x };
  return { x, k, p: e.params.map(toStoredParam) };
}

function fromStoredParam(p: StoredParam): LogParam {
  return typeof p === "object" && p !== null ? fromStoredMsg(p) : p;
}

function fromStoredMsg(m: StoredMsg): LogEntry {
  const text = typeof m.x === "string" ? m.x : "";
  if (!Array.isArray(m.k) || !m.k.every((s) => typeof s === "string") || !resolves(m.k)) {
    return literal(text);
  }
  const path = [...m.k];
  const params = Array.isArray(m.p) ? m.p.map(fromStoredParam) : [];
  return { kind: "keyed", pick: (t: Strings) => atPath(t, path), params };
}

/** `sessionStorage`, or `null` wherever it is unavailable or refuses to be touched -- a node
 *  suite, a private window, a browser with site data blocked. Every caller treats that as "no
 *  persistence" and carries on: a log that breaks the app when storage is gone is worse than a
 *  log that forgets. */
function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Drop the oldest of one class, to get under a quota the browser has just refused.
 *
 * DEBUG GOES FIRST, and this is the same judgement `MAX_DEBUG_ENTRIES` encodes: those lines are
 * "the tail of a bug report, not the record". Only once no debug is left does this touch the
 * levels a person reads. Halving rather than trimming one at a time, because each attempt costs
 * a full serialize of a log that is by definition already too big.
 */
function shed(entries: readonly PersistableEntry[]): PersistableEntry[] {
  const debug = entries.filter((e) => e.severity === "debug");
  if (debug.length > 0) {
    const drop = new Set(debug.slice(0, Math.max(1, Math.ceil(debug.length / 2))));
    return entries.filter((e) => !drop.has(e));
  }
  return entries.slice(Math.max(1, Math.ceil(entries.length / 2)));
}

/**
 * Serialize, for the size measurement as much as for the write.
 *
 * THE START TABLE IS PRUNED TO THE ENTRIES BEING WRITTEN. `shed()` can drop a whole session on the
 * way to fitting a quota, and a start left behind for a session with nothing left would be read
 * back, kept, and written out again on every load for the rest of the tab's life. Pruning here
 * rather than at the call site means every path that writes -- the debounce, the flush, and each
 * shedding retry -- gets it without having to remember.
 *
 * `UNSTAMPED` never has a start, so it is simply never in the map.
 */
export function serialize(
  entries: readonly PersistableEntry[],
  starts: ReadonlyMap<number, string> = new Map(),
): string {
  const stored: StoredEntry[] = entries.map((e) => ({
    t: e.time,
    v: e.severity,
    s: e.source,
    ...(e.subject === undefined ? {} : { j: e.subject }),
    ...(e.session === UNSTAMPED ? {} : { g: e.session }),
    m: toStoredMsg(e.message),
  }));
  const present = new Set(entries.map((e) => e.session));
  const g: StoredSession[] = [];
  for (const [i, a] of starts) {
    if (present.has(i)) g.push({ i, a });
  }
  return JSON.stringify(g.length > 0 ? { f: FORMAT, e: stored, g } : { f: FORMAT, e: stored });
}

/**
 * Write the log, shedding oldest-first until it fits or there is nothing left to give up.
 *
 * An empty log REMOVES the key rather than storing `[]`, so `clear()` is honoured across a
 * reload -- storing the empty array would work too, but leaving a dead key behind to be parsed
 * on every load is the kind of thing that outlives the reason for it.
 */
export function save(
  entries: readonly PersistableEntry[],
  starts: ReadonlyMap<number, string> = new Map(),
): void {
  const store = session();
  if (!store) return;
  let keep: readonly PersistableEntry[] = entries;
  for (;;) {
    if (keep.length === 0) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do; the log is a diagnostic, not state the app depends on */
      }
      return;
    }
    try {
      store.setItem(STORAGE_KEY, serialize(keep, starts));
      return;
    } catch {
      const next = shed(keep);
      // `shed` always drops at least one, so this terminates; the guard is against a future
      // edit to `shed` turning this into a spin.
      if (next.length >= keep.length) {
        try {
          store.removeItem(STORAGE_KEY);
        } catch {
          /* see above */
        }
        return;
      }
      keep = next;
    }
  }
}

/**
 * Read back what the previous load wrote. Empty for a first load, unreadable data, or no storage.
 *
 * Order is preserved, which matters twice: the budgets are enforced oldest-first, and the pane
 * heads the restored block rather than interleaving it.
 */
export function restore(): RestoredLog {
  const empty: RestoredLog = { entries: [], starts: new Map() };
  const store = session();
  if (!store) return empty;
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const doc = parsed as { f?: unknown; e?: unknown; g?: unknown };
  if (doc.f !== FORMAT || !Array.isArray(doc.e)) return empty;
  const out: RestoredEntry[] = [];
  for (const item of doc.e) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Partial<StoredEntry>;
    if (typeof s.t !== "string" || typeof s.v !== "string" || typeof s.s !== "string") continue;
    if (typeof s.m !== "object" || s.m === null) continue;
    out.push({
      time: s.t,
      severity: s.v,
      source: s.s,
      ...(typeof s.j === "string" ? { subject: s.j } : {}),
      // A `g` that is not a number is an entry this build cannot place, which is `UNSTAMPED`'s
      // case exactly: it joins the block that predates the stamp rather than being discarded.
      session: typeof s.g === "number" && Number.isFinite(s.g) ? s.g : UNSTAMPED,
      message: fromStoredMsg(s.m),
    });
  }
  // The start table is optional and independently validated: a record whose entries parse and
  // whose starts do not still yields every line, with the sessions falling back to their first
  // surviving entry. Losing a start costs a listed time; dropping the log costs the bug report.
  const starts = new Map<number, string>();
  if (Array.isArray(doc.g)) {
    for (const item of doc.g) {
      if (typeof item !== "object" || item === null) continue;
      const g = item as Partial<StoredSession>;
      if (typeof g.i !== "number" || !Number.isFinite(g.i) || typeof g.a !== "string") continue;
      starts.set(g.i, g.a);
    }
  }
  return { entries: out, starts };
}
