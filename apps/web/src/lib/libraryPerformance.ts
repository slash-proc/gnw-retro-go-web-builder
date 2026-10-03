const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const timeline = params?.get("libraryPerf") === "1";
const enabled = timeline || params?.has("libraryTrace");
let sequence = 0;
const phases = new Map<string, { calls: number; totalMs: number; maxMs: number; items: number | null; active: number }>();

if (enabled && typeof window !== "undefined") {
  Object.assign(window, {
    gnwLibraryPerformanceReport: () => [...phases].map(([name, stats]) => ({ name, ...stats })),
  });
}

function begin(name: string, itemCount: number | null): () => void {
  const stats = phases.get(name) ?? { calls: 0, totalMs: 0, maxMs: 0, items: null, active: 0 };
  phases.set(name, stats);
  stats.active++;
  const at = performance.now();
  const id = ++sequence;
  const start = `library:${id}:start`;
  const end = `library:${id}:end`;
  const label = `library:${name}${itemCount === null ? "" : ` (${itemCount})`}`;
  if (timeline) performance.mark(start);
  return () => {
    const elapsed = performance.now() - at;
    stats.active--;
    stats.calls++;
    stats.totalMs += elapsed;
    stats.maxMs = Math.max(stats.maxMs, elapsed);
    stats.items = itemCount;
    if (timeline) {
      performance.mark(end);
      performance.measure(label, start, end);
      performance.clearMarks(start);
      performance.clearMarks(end);
      // DevTools receives the timing event; the app need not retain every event indefinitely.
      performance.clearMeasures(label);
    }
  };
}

export function measureLibraryPhase<T>(name: string, itemCount: number | null, run: () => T): T {
  if (!enabled) return run();
  const finish = begin(name, itemCount);
  try {
    return run();
  } finally {
    finish();
  }
}

export async function measureLibraryPhaseAsync<T>(name: string, itemCount: number | null, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const finish = begin(name, itemCount);
  try {
    return await run();
  } finally {
    finish();
  }
}
