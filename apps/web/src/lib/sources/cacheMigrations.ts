/**
 * The background drain that moves the two remaining IndexedDB byte stores onto the OPFS blob
 * cache. Started once from `App.svelte`; nothing else calls it.
 *
 * WHAT MOVES:
 *   - cover art     (`screenscraper/cache.js`'s `media` store  -> category `cover`)
 *   - imported zips (`sources/bundleStore.ts`'s `zips` store   -> category `offline`)
 *
 * WHAT DOES NOT, and must not be "finished off" by a later reader:
 *   - `persist.ts`'s `gnw-handles`. It holds `FileSystemDirectoryHandle` objects. They are
 *     structured-cloneable, which is exactly why IndexedDB can hold them and OPFS cannot: OPFS
 *     stores BYTES, and a directory handle has no byte representation at all — serialising one
 *     would produce a dead object that no longer grants access to anything. That store stays
 *     where it is, permanently. See the comment at the store itself.
 *   - the `screenscraper` `games` store. Small structured JSON, argued at that file's header.
 *   - the `gnw:` localStorage keys. Registrations and pointers, not cached bytes.
 *
 * IT MUST NOT BLOCK STARTUP. A scraped library is hundreds of covers and each one is a read, a
 * hash, a write, a verifying re-read and a delete. So this yields to the event loop first, runs
 * the two drains in sequence (never in parallel — they share one OPFS directory and one storage
 * quota, and a quota refusal should stop one of them, not both), and takes a BUDGET per visit.
 * A user with more covers than the budget finishes over a few visits; every read in the
 * meantime is served by `KeyedBlobStore.get`'s legacy fallback, so nothing is ever missing.
 *
 * NOTHING HERE IS REPORTED. A failed pass leaves the old copy in place and the app behaves as
 * it did before this module existed, which is not a condition the user can act on.
 */
import { installCoverStore, migrateCovers } from "../screenscraper/coverStore.js";
import { migrateBundles } from "./bundleStore.js";

/**
 * How many entries one visit will move, per store. Big enough that a normal library finishes on
 * the first visit; small enough that a pathological one does not monopolise the disk for a
 * minute. Zips are large and few, covers small and many, hence the different numbers.
 */
const COVER_BUDGET = 400;
const BUNDLE_BUDGET = 50;

let started = false;

/**
 * Install the cover store and kick off both drains. Returns immediately; the work happens
 * later. Idempotent — a second call does nothing, so it is safe under HMR and re-mounts.
 */
export function runCacheMigrations(): void {
  if (started) return;
  started = true;

  // Installing the backend is synchronous and must happen before anything scrapes, so it is
  // NOT deferred. Only the drain is.
  const covers = installCoverStore();

  const later = (fn: () => void): void => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof ric === "function") ric(fn);
    else setTimeout(fn, 2000);
  };

  later(() => {
    void (async () => {
      try {
        await migrateCovers(covers, COVER_BUDGET);
      } catch {
        /* the old copies are still there; next visit tries again */
      }
      try {
        await migrateBundles(BUNDLE_BUDGET);
      } catch {
        /* likewise */
      }
    })();
  });
}
