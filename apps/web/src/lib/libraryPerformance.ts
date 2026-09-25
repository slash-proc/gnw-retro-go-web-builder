const enabled = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("libraryPerf") === "1";
let sequence = 0;

export function measureLibraryPhase<T>(name: string, itemCount: number | null, run: () => T): T {
  if (!enabled) return run();
  const start = `library:${++sequence}:start`;
  const end = `library:${sequence}:end`;
  const label = `library:${name}${itemCount === null ? "" : ` (${itemCount})`}`;
  performance.mark(start);
  try {
    return run();
  } finally {
    performance.mark(end);
    performance.measure(label, start, end);
    performance.clearMarks(start);
    performance.clearMarks(end);
  }
}

export async function measureLibraryPhaseAsync<T>(name: string, itemCount: number | null, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const start = `library:${++sequence}:start`;
  const end = `library:${sequence}:end`;
  const label = `library:${name}${itemCount === null ? "" : ` (${itemCount})`}`;
  performance.mark(start);
  try {
    return await run();
  } finally {
    performance.mark(end);
    performance.measure(label, start, end);
    performance.clearMarks(start);
    performance.clearMarks(end);
  }
}
