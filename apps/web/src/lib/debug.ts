/**
 * Dev debug sink — fire-and-forget POSTs log lines to the backend (/api/debug), which appends
 * them to /tmp/gnw-debug.log so a developer can `tail` the file and watch the UI live without
 * the user copy-pasting. Throwaway dev aid; no-ops if the endpoint is unreachable. Lines are
 * batched on a microtask to avoid a request per call.
 */
let queue: string[] = [];
let scheduled = false;

function flush(): void {
  scheduled = false;
  if (queue.length === 0) return;
  const lines = queue;
  queue = [];
  void fetch("/api/debug", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines }),
  }).catch(() => {});
}

/** Log a debug line (also mirrored to the browser console). */
export function dbg(...parts: unknown[]): void {
  const line = parts
    .map((p) => (typeof p === "string" ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })()))
    .join(" ");
  // eslint-disable-next-line no-console
  console.debug("[dbg]", line);
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
