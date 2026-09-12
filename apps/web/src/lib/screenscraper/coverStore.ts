/**
 * Cover art on the OPFS blob cache — the fifth `blobCache()` call site.
 *
 * `cache.js` holds two unrelated things in one IndexedDB database: `games` (small `jeuInfos`
 * JSON records) and `media` (downloaded cover images). Only the second is bulk bytes, and only
 * the second moves; that file's header states the reasoning for the JSON half staying put.
 *
 * WHY IT IS WORTH MOVING. A scraped library is hundreds of images, fetched under a rate limiter
 * against a third-party API with a per-account quota. Re-downloading them is not just slow, it
 * spends something the user has a finite amount of. They are also the single largest thing this
 * app keeps between visits, and until now they were the one bulk category NOT visible to the
 * blob cache's `usage()` — bytes on the user's disk that the UI could not see and the user
 * could not reclaim.
 *
 * KEYED BY MEDIA URL, so this needs the name -> hash pointer of `keyedBlobStore.ts` (which
 * carries the same trade-off `artifacts.ts` and `convertedCache.ts` already state). The URL is
 * a sound key: ScreenScraper media URLs identify one image, and a pointer to bytes that no
 * longer hash to their name misses anyway, because `BlobCache.get()` re-hashes.
 *
 * THE MIME TYPE RIDES ON THE POINTER, not on the bytes. `blobCache` stores bytes and nothing
 * else, and a `Blob` handed back with the wrong type is a real (if small) regression for
 * anything that inspects it. Sniffing it from magic numbers would be a guess; the pointer knows.
 *
 * INSTALLATION. `run.js` is plain JS and keeps importing `cache.js` — a `.js` module cannot
 * portably import a `.ts` sibling through the bundler's resolver, and threading a store through
 * `runCovers`'s signature would put this decision in the UI. Instead `installCoverStore()`
 * hands `cache.js` a media backend once, from `App.svelte`. Before that call (and in any
 * context that never makes it) cover caching is exactly what it is today.
 */
import { scoped } from "../storageScope.js";
import { setMediaBackend, legacyMediaStore } from "./cache.js";
import { blobCache } from "../sources/blobCache.js";
import {
  KeyedBlobStore,
  localHashPointerIndex,
  localMigrationFlag,
  type LegacyBlobStore,
  type MigrationReport,
} from "../sources/keyedBlobStore.js";

/** URL -> pointer. Versioned like every other `gnw.*` pointer, so a shape change is a new key. */
export const COVER_INDEX_KEY = scoped("gnw.coverHash.v1");
/** "the old `media` object store has been fully drained". An optimisation, never a source of truth. */
export const COVER_MIGRATED_KEY = scoped("gnw.coverMigrated.v1");

/** What `cache.js` calls once `installCoverStore()` has handed it this backend. */
export interface MediaBackend {
  getMedia(url: string): Promise<Blob | null>;
  setMedia(url: string, blob: Blob): Promise<void>;
  mediaCount(): Promise<number>;
}

/**
 * The store for cover images. `legacy` is injectable so the validation script can drive the
 * whole migration without an IndexedDB; the app passes nothing and gets the real one.
 */
export function coverBlobStore(legacy: LegacyBlobStore = legacyMediaStore as unknown as LegacyBlobStore): KeyedBlobStore {
  return new KeyedBlobStore({
    cache: blobCache(),
    index: localHashPointerIndex(COVER_INDEX_KEY),
    category: "cover",
    legacy,
    flag: localMigrationFlag(COVER_MIGRATED_KEY),
  });
}

/** Adapt the byte-level store to the `Blob` vocabulary `run.js` already speaks. */
export function mediaBackendFor(store: KeyedBlobStore): MediaBackend {
  return {
    async getMedia(url) {
      const held = await store.get(url);
      // A blob with no recorded type is `application/octet-stream`, which is what an untyped
      // `new Blob([...])` gives anyway — so an entry migrated from a typeless legacy row
      // behaves exactly as it did before.
      return held ? new Blob([held.bytes as BlobPart], held.type ? { type: held.type } : undefined) : null;
    },
    async setMedia(url, blob) {
      // A write that does not stick is not an error the scrape needs to hear about: the image
      // is in hand either way, and the only cost is re-downloading it on a later visit. This
      // matches `run.js`, which already swallows the old `setMedia`'s rejections.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await store.put(url, bytes, blob.type || "");
    },
    async mediaCount() {
      let n = 0;
      try {
        n = (await blobCache().usage()).countByCategory.cover;
      } catch {
        n = 0;
      }
      // An interrupted drain has covers in both places; the honest count is the sum.
      return n + (await store.legacyCount());
    },
  };
}

let installed: KeyedBlobStore | null = null;

/**
 * Point `cache.js`'s media half at the blob cache. Idempotent, and safe to call before anything
 * has been scraped. Returns the store so the migration pass can use the same instance.
 */
export function installCoverStore(legacy?: LegacyBlobStore): KeyedBlobStore {
  if (!installed) {
    installed = coverBlobStore(legacy ?? (legacyMediaStore as unknown as LegacyBlobStore));
    setMediaBackend(mediaBackendFor(installed));
  }
  return installed;
}

/** Move one budget's worth of covers out of IndexedDB. Never throws; see `keyedBlobStore.ts`. */
export function migrateCovers(store: KeyedBlobStore, budget: number): Promise<MigrationReport> {
  return store.migrate(budget);
}
