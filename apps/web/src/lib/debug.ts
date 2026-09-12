/**
 * Dev debug sink — fire-and-forget POSTs log lines to the backend (/api/debug), which appends
 * them to /tmp/gnw-debug.log so a developer can `tail` the file and watch the UI live without
 * the user copy-pasting. Throwaway dev aid; no-ops if the endpoint is unreachable. Lines are
 * batched on a microtask to avoid a request per call.
 *
 * THE POST IS DEV-ONLY, WHICH IS WHY THERE IS ALSO A SINK. `/api/debug` is the Express dev
 * server; in the built Pages app nothing serves it, so every one of these lines was discarded in
 * exactly the build where a user might have been asked for a bug report. `setDbgSink` lets the
 * app take a copy in-process — `auditLog` registers itself and files them under `debug`, which
 * is hidden until its chip is asked for. This module stays store-free and dependency-free: it
 * calls a function it was handed, the same injection rule the packages follow, so nothing here
 * knows the audit log exists.
 */
type DbgSink = (line: string) => void;

let queue: string[] = [];
let scheduled = false;
let sink: DbgSink | null = null;
/** Guards against a sink that itself logs — one re-entrant call would recurse without end. */
let inSink = false;

/** Register (or clear, with `null`) an in-process destination for every `dbg()` line.
 *
 *  ONE SLOT, not a list: there is exactly one consumer (`auditLog`), and a second call REPLACES
 *  the first rather than adding to it. If a second destination is ever wanted, make this a list
 *  then -- silently dropping the audit log because something else registered later would be a
 *  hard bug to see, since nothing would fail, the log would just be quietly emptier. */
export function setDbgSink(fn: DbgSink | null): void {
  sink = fn;
}

function flush(): void {
  scheduled = false;
  if (queue.length === 0) return;
  const lines = queue;
  queue = [];
  // `fetch` can throw SYNCHRONOUSLY on a relative URL with no document base (a node test
  // importing this module), which `.catch()` would not see — so the try/catch is the outer one.
  try {
    void fetch("/api/debug", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines }),
    }).catch(() => {});
  } catch {
    /* no endpoint here; the sink above is the surface that matters in a built app */
  }
}

/** Log a debug line (also mirrored to the browser console). */
export function dbg(...parts: unknown[]): void {
  const line = parts
    .map((p) => (typeof p === "string" ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })()))
    .join(" ");
  // eslint-disable-next-line no-console
  console.debug("[dbg]", line);
  if (sink && !inSink) {
    inSink = true;
    try {
      sink(line);
    } finally {
      inSink = false;
    }
  }
  queue.push(line);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

/** Wrap a LogFn so its lines also go to the debug sink, tagged with a scope. */
export function dbgLog(scope: string, inner?: (m: string) => void): (m: string) => void {
  return (m: string) => {
    dbg(`[${scope}]`, m);
    inner?.(m);
  };
}
