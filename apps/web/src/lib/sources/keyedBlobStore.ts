/**
 * A NAME-keyed store on top of the content-addressed `blobCache`, plus the one-time drain that
 * moves an existing IndexedDB store onto it.
 *
 * WHY THIS EXISTS. `blobCache` is keyed by the sha256 of the CONTENT and nothing else, which is
 * what makes it self-invalidating. But two things this app caches are looked up by a NAME the
 * content hash cannot be derived from in advance: a cover image by its media URL, an imported
 * bundle by its `owner/repo`. `artifacts.ts` (`gnw.bundleHash.v1`) and `convertedCache.ts`
 * (`gnw.convertedHash.v1`) already solved that with a name -> hash pointer in localStorage.
 * This module is that same pattern, factored out, so the two remaining stores adopt it rather
 * than inventing a third shape.
 *
 * THE TRADE-OFF IS THE SAME ONE, stated again because it is the whole risk: the pointer is NOT
 * self-invalidating, so correctness rests on what it is keyed by. The bytes stay
 * content-addressed, so a pointer to bytes that have rotted still misses — `BlobCache.get()`
 * re-hashes on every read.
 *
 * ## Draining the old store
 *
 * Both callers have an IndexedDB store with real user data already in it. Losing a cover costs
 * a re-download (and a ScreenScraper quota hit); losing a bundle zip costs the user the file
 * they may no longer have. So the drain is deliberately timid:
 *
 *   - PER ENTRY, read-old -> write-new -> READ THE NEW ONE BACK through `BlobCache.get()`
 *     (which re-hashes) -> write the pointer -> only THEN delete the old copy. At no instant is
 *     the entry in neither place, and a verified new copy is the only thing that authorises the
 *     delete.
 *   - IDEMPOTENT, because the destination is content-addressed: the same bytes written twice
 *     land on the same file name, so a second pass cannot duplicate anything. A second run over
 *     an already-drained store enumerates nothing and stops.
 *   - RESUMABLE, because the OLD STORE IS THE WORK QUEUE. There is no cursor to lose: whatever
 *     is still in the legacy store is still to do, and an interrupt anywhere leaves a
 *     consistent prefix migrated and the rest untouched. A single entry that fails is counted
 *     and SKIPPED, never retried into a loop and never deleted.
 *   - NON-BLOCKING, because it runs from `cacheMigrations.ts` off the startup path and takes a
 *     per-pass `budget`, so a library of hundreds of covers is spread over visits rather than
 *     stalling one.
 *   - A NO-OP WITHOUT OPFS. When `BlobCache.available` is false nothing is read, nothing is
 *     deleted, and `get`/`put` fall through to the legacy store — i.e. exactly today's
 *     behaviour, with today's data still in today's place.
 *
 * The "done" flag is an OPTIMISATION ONLY: it stops the drain reopening IndexedDB on every
 * visit forever. It is set only after a pass that both moved everything and failed nothing, and
 * losing it costs one wasted empty pass, never data.
 */
import { blobCache, blobKey, type BlobCache } from "./blobCache.js";

/** What a pointer records: where the bytes are, and the MIME type they were stored with. */
export interface HashPointer {
  /** Lowercase hex sha256 — the `blobCache` key. */
  hash: string;
  /** The original MIME type, or "" when the caller has none. Not derivable from the bytes. */
  type: string;
}

/** The name -> pointer map. An interface so tests inject one, exactly as `BundleHashIndex` is. */
export interface HashPointerIndex {
  get(key: string): HashPointer | null;
  set(key: string, ptr: HashPointer): void;
  delete(key: string): void;
  keys(): string[];
}

function isPointer(v: unknown): v is HashPointer {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.hash === "string" && typeof p.type === "string";
}

/** The real index: one small JSON object in localStorage. Every method swallows its failures. */
export function localHashPointerIndex(storageKey: string): HashPointerIndex {
  const read = (): Record<string, HashPointer> => {
    try {
      const raw = globalThis.localStorage?.getItem(storageKey);
      const doc: unknown = raw ? JSON.parse(raw) : null;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
      const out: Record<string, HashPointer> = {};
      for (const [k, v] of Object.entries(doc as Record<string, unknown>)) if (isPointer(v)) out[k] = v;
      return out;
    } catch {
      return {};
    }
  };
  const write = (doc: Record<string, HashPointer>): void => {
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(doc));
    } catch {
      /* the pointer is an optimisation; losing it costs one re-fetch, never the bytes */
    }
  };
  return {
    get(key) {
      return read()[key] ?? null;
    },
    set(key, ptr) {
      const doc = read();
      doc[key] = ptr;
      write(doc);
    },
    delete(key) {
      const doc = read();
      delete doc[key];
      write(doc);
    },
    keys() {
      return Object.keys(read());
    },
  };
}

/** One legacy entry: the bytes and the MIME type they were kept under. */
export interface LegacyBlob {
  bytes: Uint8Array;
  type: string;
}

/**
 * The old IndexedDB store, as the drain needs to see it. An interface rather than a hardcoded
 * `indexedDB` call for the same reason `BundleBlobStore` is one: node has no IndexedDB, and the
 * cases that decide this code's correctness — a refused write, an entry that vanishes mid-pass,
 * a delete that fails — cannot be staged in a real browser on request.
 *
 * Implementations must NEVER throw. Every failure is a null / false / empty answer.
 */
export interface LegacyBlobStore {
  /** False when this browser has no IndexedDB. Every other method must still be safe to call. */
  readonly available: boolean;
  /** Every key held. Empty on any failure — which correctly reads as "nothing left to move". */
  keys(): Promise<string[]>;
  get(key: string): Promise<LegacyBlob | null>;
  /** The fallback write path when OPFS is unavailable. False when the store refused it. */
  put(key: string, bytes: Uint8Array, type: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** The legacy store that holds nothing, for environments with no IndexedDB. */
export const nullLegacyStore: LegacyBlobStore = {
  available: false,
  async keys() {
    return [];
  },
  async get() {
    return null;
  },
  async put() {
    return false;
  },
  async delete() {},
};

/** The "this store has been fully drained" marker. Injected so a test can watch it flip. */
export interface MigrationFlag {
  done(): boolean;
  markDone(): void;
}

/** The real flag: one localStorage key. A failure to read or write it is simply "not done". */
export function localMigrationFlag(storageKey: string): MigrationFlag {
  return {
    done() {
      try {
        return globalThis.localStorage?.getItem(storageKey) === "1";
      } catch {
        return false;
      }
    },
    markDone() {
      try {
        globalThis.localStorage?.setItem(storageKey, "1");
      } catch {
        /* costs one wasted empty pass next visit, nothing more */
      }
    },
  };
}

/** What one drain pass did. Purely informational — no caller changes behaviour on it. */
export interface MigrationReport {
  /** True when the pass did not run at all (already done, no OPFS, or no legacy store). */
  skipped: boolean;
  /** Entries verified in the new store and removed from the old one. */
  moved: number;
  /** Entries left ALONE because something went wrong. Their old copy is intact. */
  failed: number;
  /** Entries still in the legacy store when the pass stopped. */
  remaining: number;
  /** True when the legacy store is empty and the flag is now set. */
  done: boolean;
}

export interface KeyedBlobStoreDeps {
  cache: BlobCache;
  index: HashPointerIndex;
  /** A `BlobCategory` token; anything unrecognised files under `other` rather than failing. */
  category: string;
  legacy: LegacyBlobStore;
  flag: MigrationFlag;
}

/**
 * A name -> bytes store served from `blobCache`, with the legacy IndexedDB store behind it as
 * both a fallback and a work queue.
 *
 * Every method resolves; none reject. Null / false always means "not held", which is a
 * legitimate answer for a cache.
 */
export class KeyedBlobStore {
  private readonly cache: BlobCache;
  private readonly index: HashPointerIndex;
  private readonly category: string;
  private readonly legacy: LegacyBlobStore;
  private readonly flag: MigrationFlag;

  constructor(deps: KeyedBlobStoreDeps) {
    this.cache = deps.cache;
    this.index = deps.index;
    this.category = deps.category;
    this.legacy = deps.legacy;
    this.flag = deps.flag;
  }

  /**
   * The bytes held under `key`, or null.
   *
   * The pointer is consulted first. On a miss the LEGACY store is still asked — this is the
   * lazy half of the migration, and it is what makes an interrupted drain invisible: an entry
   * the background pass has not reached yet is served from where it still is, and PROMOTED on
   * the way past so the drain has one less to do.
   */
  async get(key: string): Promise<LegacyBlob | null> {
    try {
      const ptr = this.index.get(key);
      if (ptr) {
        const bytes = await this.cache.get(ptr.hash);
        if (bytes) return { bytes, type: ptr.type };
      }
    } catch {
      /* a broken pointer is a miss, like any other */
    }
    if (!this.legacy.available) return null;
    const old = await this.legacy.get(key).catch(() => null);
    if (!old) return null;
    // Best-effort; a promotion that does not stick still returns the bytes the caller asked for.
    await this.promote(key, old).catch(() => false);
    return old;
  }

  /**
   * Store `bytes` under `key`. Returns whether they stuck anywhere.
   *
   * OPFS first. When it is unavailable or refuses (quota), this falls back to the legacy store
   * — deliberately: a browser without OPFS must keep caching exactly as it does today rather
   * than silently stop caching at all.
   */
  async put(key: string, bytes: Uint8Array, type: string): Promise<boolean> {
    if (this.cache.available) {
      try {
        const hash = await blobKey(bytes);
        if (await this.cache.put(hash, bytes, this.category)) {
          const prev = this.index.get(key);
          this.index.set(key, { hash, type });
          // The bytes this key used to point at are now unreachable; leaving them would cost
          // the user quota forever. Only after the new pointer is written, never before.
          if (prev && prev.hash !== hash) await this.cache.delete(prev.hash).catch(() => {});
          // One copy, not two. Absent is success, so this is safe on a never-migrated key.
          await this.legacy.delete(key).catch(() => {});
          return true;
        }
      } catch {
        /* fall through to the legacy store */
      }
    }
    return this.legacy.put(key, bytes, type).catch(() => false);
  }

  /** Forget `key` everywhere. Absent is success. */
  async delete(key: string): Promise<void> {
    try {
      const ptr = this.index.get(key);
      if (ptr) await this.cache.delete(ptr.hash).catch(() => {});
      this.index.delete(key);
    } catch {
      /* nothing to do */
    }
    await this.legacy.delete(key).catch(() => {});
  }

  /**
   * Move ONE already-read legacy entry into the blob cache and drop the old copy. Returns
   * whether it stuck.
   *
   * This is the entire safety argument of the migration, in one place, used by BOTH the lazy
   * path (`get`) and the background pass (`migrate`) so the two cannot drift apart:
   *
   *   write new -> READ IT BACK through `get()`, which re-hashes -> write the pointer ->
   *   only then delete the old copy.
   *
   * Every early return leaves the legacy entry untouched, so a false here costs a retry, never
   * the bytes. Content addressing makes a repeat harmless: the same bytes land on the same
   * name, so promoting twice writes one copy.
   */
  async promote(key: string, held: LegacyBlob): Promise<boolean> {
    if (!this.cache.available) return false;
    const hash = await blobKey(held.bytes);
    if (!(await this.cache.put(hash, held.bytes, this.category))) return false;
    const back = await this.cache.get(hash);
    if (!back || back.length !== held.bytes.length) return false;
    this.index.set(key, { hash, type: held.type });
    await this.legacy.delete(key);
    return true;
  }

  /** How many entries the legacy store still holds. Zero on any failure. */
  async legacyCount(): Promise<number> {
    if (!this.legacy.available) return 0;
    return (await this.legacy.keys().catch(() => [])).length;
  }

  /** Drop every pointer and its bytes, and everything left in the legacy store. */
  async clear(): Promise<void> {
    let keys: string[] = [];
    try {
      keys = this.index.keys();
    } catch {
      keys = [];
    }
    for (const k of keys) await this.delete(k);
    for (const k of await this.legacy.keys().catch(() => [])) {
      await this.legacy.delete(k).catch(() => {});
    }
  }

  /**
   * Move up to `budget` entries out of the legacy store. See this module's header for why the
   * order of operations inside the loop is what it is — it is the whole safety argument.
   */
  async migrate(budget = Number.POSITIVE_INFINITY): Promise<MigrationReport> {
    const idle: MigrationReport = { skipped: true, moved: 0, failed: 0, remaining: 0, done: false };
    if (this.flag.done()) return { ...idle, done: true };
    // Without OPFS there is nowhere to move anything TO, and deleting the old copy would be
    // data loss. Without IndexedDB there is nothing to move. Either way: do not touch anything.
    if (!this.cache.available || !this.legacy.available) return idle;

    let keys: string[];
    try {
      keys = await this.legacy.keys();
    } catch {
      return idle;
    }

    let moved = 0;
    let failed = 0;
    for (const key of keys) {
      if (moved >= budget) break;
      try {
        const old = await this.legacy.get(key);
        // Gone since `keys()` — another tab drained it, or it was never readable. Not a failure.
        if (!old) continue;
        if (await this.promote(key, old)) moved++;
        else failed++;
      } catch {
        // The old entry was not deleted on any path that throws, so it is still there for the
        // next pass. One bad entry never aborts the drain.
        failed++;
      }
    }

    const remaining = (await this.legacy.keys().catch(() => keys)).length;
    const done = remaining === 0 && failed === 0;
    if (done) this.flag.markDone();
    return { skipped: false, moved, failed, remaining, done };
  }
}

/** Build a store with the app-wide `blobCache` and localStorage-backed pointer + flag. */
export function keyedBlobStore(opts: {
  category: string;
  indexKey: string;
  flagKey: string;
  legacy: LegacyBlobStore;
}): KeyedBlobStore {
  return new KeyedBlobStore({
    cache: blobCache(),
    index: localHashPointerIndex(opts.indexKey),
    category: opts.category,
    legacy: opts.legacy,
    flag: localMigrationFlag(opts.flagKey),
  });
}
