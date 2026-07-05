/**
 * Shared time-boxing helper for simple "ping with a fallback" patterns.
 *
 * Races `action()` against a timeout that resolves to `fallback` (never rejects).
 * This is ONLY for the "single race, no retry" shape — used by device.svelte.ts's
 * `stubAlive` (2500ms) and `pollTick` (300ms) liveness pings, which were previously
 * two near-identical inline `Promise.race` blocks.
 *
 * Deliberately NOT used to unify the other timeout/retry implementations in the
 * codebase (see docs/AUDIT_NOTES.md item #1) — those have materially different
 * semantics (retry loops, AbortController, stall-watchdog polling) that would risk
 * behavior changes on hardware-timing-sensitive code.
 */
export async function raceWithFallback<T>(
  action: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    action,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}
