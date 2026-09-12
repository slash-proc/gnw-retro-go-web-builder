// Install-progress LOG ENTRIES as data, not as rendered text.
//
// Why: the audit log used to be `string[]`, rendered at LOG time from `locale.t.…`. Once that
// string existed the locale was baked in and the English was gone — so the log could be shown
// in the user's language OR copied as English, never both. An entry here keeps the KEY (as a
// pick function into the string table) plus its PARAMS, and is rendered at DISPLAY time against
// whichever `Strings` table the caller hands in. Same entry -> the user's locale on screen, and
// English for a bug report, with no second call site.
//
// Type-safety without stringly-typed key paths: the "key" is a `(t: Strings) => …` accessor, so
// the compiler checks both that the key EXISTS and (via the overloads on `msg`) that the params
// match that entry's arity and types. There is no `t["roms"]["sdSync"][…]` lookup anywhere.
//
// This module holds no state and imports no store — it is pure data + a renderer, so it is safe
// to import from installProgress.svelte.ts without touching that file's one-directional
// import rule.
import type { Strings } from "./i18n/en.js";

/** A parameter to a keyed entry. `LogEntry` is allowed so a translated fragment can be nested
 *  inside another translated string (e.g. wizard's `logMigrateSummary(logMigrateKindUpgrade,…)`)
 *  and still be resolved in the DISPLAY locale rather than baked at log time. */
export type LogParam = string | number | boolean | LogEntry;

/** A log entry, rendered on demand.
 *
 *  - `literal`: a plain runtime string that never came from the string table — a filename, a
 *    path, a device-derived line from the flasher's debug callback. It is locale-independent by
 *    construction, so it round-trips unchanged in every locale. Call sites may pass a bare
 *    `string` to `report.log()`; it is wrapped into this shape.
 *  - `keyed`: `pick` selects the entry from a `Strings` table (a plain string value, or a
 *    function taking `params`). */
export type LogEntry =
  | { kind: "literal"; text: string }
  | { kind: "keyed"; pick: (t: Strings) => unknown; params: LogParam[] };

/** Build a keyed entry. `pick` names the key by ACCESSING it (`(t) => t.roms.sdSync.logX`),
 *  never by string path, so a renamed or removed key is a compile error at the call site.
 *
 *  Two overloads: a value key takes no params; a function key takes exactly its own params
 *  (each of which may instead be a nested `LogEntry`). */
export function msg(pick: (t: Strings) => string): LogEntry;
export function msg<A extends unknown[]>(
  pick: (t: Strings) => (...args: A) => string,
  ...params: { [K in keyof A]: A[K] | LogEntry }
): LogEntry;
export function msg(pick: (t: Strings) => unknown, ...params: unknown[]): LogEntry {
  return { kind: "keyed", pick, params: params as LogParam[] };
}

/** Wrap a plain runtime string (path, filename, device output) as a locale-independent entry. */
export function literal(text: string): LogEntry {
  return { kind: "literal", text };
}

/** Accept either shape at a call site without every one of them having to wrap. */
export function toEntry(v: string | LogEntry): LogEntry {
  return typeof v === "string" ? literal(v) : v;
}

function resolveParam(p: LogParam, t: Strings): string | number | boolean {
  return typeof p === "object" && p !== null ? renderEntry(p, t) : p;
}

/** Render one entry against a string table. */
export function renderEntry(e: LogEntry, t: Strings): string {
  if (e.kind === "literal") return e.text;
  const v = e.pick(t);
  if (typeof v === "function") return String((v as (...a: unknown[]) => string)(...e.params.map((p) => resolveParam(p, t))));
  return String(v);
}

/** One line of the audit log: the timestamp captured when it was logged, the already-resolved
 *  `[Phase — Substep]` tag (phase/substep LABELS are runtime strings supplied by the call site's
 *  `PhaseDef`, so there is nothing to defer there), and the entry itself. */
export type LogLine = { time: string; tag: string | null; entry: LogEntry };

/** Render one line exactly as the old `string[]` audit log read: `HH:MM:SS [Tag] text`, or
 *  `HH:MM:SS text` for an untagged line (the error footer). */
export function renderLine(l: LogLine, t: Strings): string {
  const text = renderEntry(l.entry, t);
  return l.tag === null ? `${l.time} ${text}` : `${l.time} [${l.tag}] ${text}`;
}

/** Render a whole log. */
export function renderLog(lines: LogLine[], t: Strings): string[] {
  return lines.map((l) => renderLine(l, t));
}

/** The real exception text for a log line: an Error's `name: message` (the name carries the
 *  code for the transport errors this app throws — e.g. `StlinkUsbError`), or `String(v)` for
 *  a non-Error throw. Kept as the TAIL of a log line, never interpolated into anything
 *  structural, because the text is untrusted device/browser output. */
export function errText(v: unknown): string {
  if (v instanceof Error) return v.name && v.name !== "Error" ? `${v.name}: ${v.message}` : v.message;
  return String(v);
}

/** Total payload size of a path→bytes map, for the raw `B` counts log lines carry. */
export function sumBytes(m: Map<string, Uint8Array>): number {
  let n = 0;
  for (const v of m.values()) n += v.length;
  return n;
}
