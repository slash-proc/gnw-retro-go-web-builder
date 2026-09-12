/**
 * A content-addressed blob cache over the Origin Private File System.
 *
 * WHY THIS EXISTS. Several things this app downloads are large, immutable, and fetched again on
 * every visit: firmware bundles, source artifacts, the converter's wasm modules, the files it
 * converts, cover art, offline bundles. None of them belong in `localStorage` (text only, a few
 * megabytes) and IndexedDB is already carrying the two things that genuinely need it —
 * `bundleStore.ts`'s imported zips and `persist.ts`'s directory handles. OPFS is the store
 * sized for bulk bytes, so bulk bytes go here.
 *
 * KEYED BY THE SHA-256 OF THE CONTENT, nothing else. Every caller already has that hash in
 * hand: `client.ts`'s `fetchVerified` checks it before returning bytes, artifacts carry
 * `sha256` in the manifest, `converter.ts` verifies the tool binary against one. A
 * content-addressed key is self-invalidating — a new release has different bytes, therefore a
 * different key, therefore a miss. There is no version field to forget to bump and no
 * invalidation pass to get wrong.
 *
 * A CACHE, NEVER A SOURCE OF TRUTH. The browser may evict any entry at any time without asking,
 * and an origin's OPFS can be wiped wholesale by a "clear site data". So every read may miss,
 * and a miss is the normal answer, not an error: the caller refetches exactly as it would have
 * without this module. Reads also RE-VERIFY the bytes against the key's own hash and treat a
 * mismatch as a miss (dropping the entry) — a local store is not a trust boundary, and bytes
 * that no longer hash to their name are indistinguishable from bytes nobody wrote.
 *
 * ASYNC OPFS ONLY. `createSyncAccessHandle()` is faster but exists only inside a worker; this
 * module is called from the main thread AND from workers (the converter runs in one), so it
 * uses the universally available async API — `getFileHandle()`, `createWritable()`, `file()`.
 * Do not "optimise" it to the sync handle without splitting the module in two.
 *
 * NEVER STORE A `FileSystemDirectoryHandle` HERE. The user's picked content folders are handles,
 * not bytes; they are structured-cloneable and live in IndexedDB via `persist.ts`. OPFS holds
 * files inside the origin's own private tree and cannot hold a handle to a directory outside it.
 * The two stores are not interchangeable in either direction.
 *
 * DEGRADES TO NOTHING. OPFS is Chrome/Edge 86+, Safari 15.2+, Firefox 111+. Where
 * `navigator.storage.getDirectory` is missing (or throws, as it does in some private-browsing
 * modes) the backend reports itself unavailable and every operation becomes a no-op: reads
 * miss, writes are dropped, sizes are zero. The app keeps working, uncached.
 *
 * NOTHING RUNS AT IMPORT TIME. No `navigator.storage` touch, no directory creation, and in
 * particular no `persist()` request — asking the user for durable storage is a decision for the
 * UI layer, made at a moment the user can understand. It is exposed, not taken.
 */

/**
 * What a stored blob is for. Purely descriptive — the cache does not treat any of them
 * differently — but a later "what is this app holding?" view breaks its total down by these.
 *
 * `other` IS NOT A DISCARD PILE. An entry whose category is unknown, unrecognised, or written by
 * a future version of this app still gets stored, listed and counted under `other`. A byte held
 * on the user's disk that the UI cannot see is a byte the user cannot reclaim.
 */
import { scoped } from "../storageScope.js";

export type BlobCategory =
  | "firmware"
  | "artifact"
  | "converter"
  | "converted"
  | "cover"
  | "offline"
  | "other";

export const BLOB_CATEGORIES: readonly BlobCategory[] = [
  "firmware",
  "artifact",
  "converter",
  "converted",
  "cover",
  "offline",
  "other",
];

const KNOWN = new Set<string>(BLOB_CATEGORIES);

/** Coerce anything at all to a category. Unrecognised input becomes `other`, never an error. */
export function asCategory(value: unknown): BlobCategory {
  return typeof value === "string" && KNOWN.has(value) ? (value as BlobCategory) : "other";
}

/** One held blob, as `list()` reports it. `size` comes from file metadata, not from a read. */
export interface BlobEntry {
  /** Lowercase hex sha256 of the content — the key. */
  hash: string;
  category: BlobCategory;
  /** Byte length on disk. */
  size: number;
}

/** Per-category and overall totals, cheap enough to render on every keystroke. */
export interface BlobUsage {
  total: number;
  count: number;
  byCategory: Record<BlobCategory, number>;
  countByCategory: Record<BlobCategory, number>;
}

/**
 * The flat name-to-bytes backend, injected rather than hardcoded — the same shape and the same
 * reason as `bundleStore.ts`'s `BundleBlobStore`: node has no OPFS, and the cases that matter
 * (an evicted entry, a quota refusal, corrupted content) cannot be staged in a real browser on
 * request. Names are opaque to the backend; `BlobCache` owns their meaning.
 */
export interface BlobCacheBackend {
  /** False when this browser has no OPFS. Every other method must still be safe to call. */
  readonly available: boolean;
  /** Every file name held. Empty on any failure. */
  list(): Promise<string[]>;
  /** Byte length without reading content, or null when absent. */
  stat(name: string): Promise<number | null>;
  read(name: string): Promise<Uint8Array | null>;
  /** False when the write did not stick (quota, unavailable, revoked). Never throws. */
  write(name: string, bytes: Uint8Array): Promise<boolean>;
  remove(name: string): Promise<void>;
}

/** The `navigator.storage` surface, injected for the same reason as the backend. */
export interface StorageQuota {
  /** Bytes used and available to this origin, or null when the browser will not say. */
  estimate(): Promise<{ usage: number; quota: number } | null>;
  /** Whether stored data is exempt from eviction under storage pressure. */
  persisted(): Promise<boolean>;
  /** Ask for that exemption. May prompt. Call it from a UI decision, never on load. */
  persist(): Promise<boolean>;
}

const DIR = scoped("blob-cache");
const HEX = /^[0-9a-f]{64}$/;

/** Lowercase hex sha256 — the key any caller must present. */
export async function blobKey(bytes: Uint8Array): Promise<string> {
  // `.slice()` copies out of any larger buffer the caller is viewing, so the digest covers this
  // blob and not its neighbours.
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `<category>.<hash>`. The category is always one of the known tokens, so the name is safe. */
function fileName(hash: string, category: BlobCategory): string {
  return `${category}.${hash}`;
}

/**
 * The inverse. A name this version does not understand still yields an entry — under `other`,
 * with whatever tail it has as the hash — so it can be listed, counted and deleted.
 */
function parseName(name: string): { hash: string; category: BlobCategory } | null {
  const dot = name.indexOf(".");
  if (dot <= 0) return null;
  const category = asCategory(name.slice(0, dot));
  const hash = name.slice(dot + 1);
  if (!hash) return null;
  return { hash, category };
}

function emptyRecord(): Record<BlobCategory, number> {
  const r = {} as Record<BlobCategory, number>;
  for (const c of BLOB_CATEGORIES) r[c] = 0;
  return r;
}

/** The backend that does nothing, for browsers without OPFS. */
export const nullBlobBackend: BlobCacheBackend = {
  available: false,
  async list() {
    return [];
  },
  async stat() {
    return null;
  },
  async read() {
    return null;
  },
  async write() {
    return false;
  },
  async remove() {},
};

/**
 * The real backend. Nothing is touched until the first call — construction is free and safe on
 * any browser, which is what lets a module-level default exist at all.
 */
export function opfsBlobBackend(): BlobCacheBackend {
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function";
  if (!supported) return nullBlobBackend;

  let dir: Promise<FileSystemDirectoryHandle> | null = null;
  const root = async (): Promise<FileSystemDirectoryHandle> => {
    if (!dir) {
      dir = navigator.storage
        .getDirectory()
        .then((r) => r.getDirectoryHandle(DIR, { create: true }))
        .catch((e) => {
          // Do not cache a failed lookup: a later call may succeed (a transient quota or
          // permission state), and a poisoned promise would make that permanent.
          dir = null;
          throw e;
        });
    }
    return dir;
  };

  const fileOf = async (name: string): Promise<File | null> => {
    try {
      const d = await root();
      return await (await d.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  };

  return {
    available: true,
    async list() {
      try {
        const d = await root();
        const names: string[] = [];
        // `keys()` is the async iterator every OPFS implementation exposes on a directory.
        for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) {
          names.push(name);
        }
        return names;
      } catch {
        return [];
      }
    },
    async stat(name) {
      const f = await fileOf(name);
      return f ? f.size : null;
    },
    async read(name) {
      const f = await fileOf(name);
      if (!f) return null;
      try {
        return new Uint8Array(await f.arrayBuffer());
      } catch {
        return null;
      }
    },
    async write(name, bytes) {
      try {
        const d = await root();
        const h = await d.getFileHandle(name, { create: true });
        const w = await h.createWritable();
        try {
          await w.write(bytes.slice());
        } finally {
          // `close()` is what commits; a quota refusal surfaces here, not from `write()`.
          await w.close();
        }
        return true;
      } catch {
        // A half-written file would read back as a hash mismatch — a miss — but it would also
        // sit there occupying quota, so drop it.
        try {
          const d = await root();
          await d.removeEntry(name);
        } catch {
          /* nothing more to do */
        }
        return false;
      }
    },
    async remove(name) {
      try {
        const d = await root();
        await d.removeEntry(name);
      } catch {
        /* absent is the desired end state either way */
      }
    },
  };
}

/** The real quota surface. Every method answers rather than throwing. */
export function navigatorStorageQuota(): StorageQuota {
  const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
  return {
    async estimate() {
      try {
        if (!s || typeof s.estimate !== "function") return null;
        const e = await s.estimate();
        // Both fields are optional in the spec; a partial answer is not an answer.
        if (typeof e.usage !== "number" || typeof e.quota !== "number") return null;
        return { usage: e.usage, quota: e.quota };
      } catch {
        return null;
      }
    },
    async persisted() {
      try {
        if (!s || typeof s.persisted !== "function") return false;
        return await s.persisted();
      } catch {
        return false;
      }
    },
    async persist() {
      try {
        if (!s || typeof s.persist !== "function") return false;
        return await s.persist();
      } catch {
        return false;
      }
    },
  };
}

/**
 * What a clear took: one category, or the whole store.
 */
export type BlobClearScope = BlobCategory | "all";

/**
 * WHO ELSE HOLDS THESE BYTES.
 *
 * The cache is not the only copy. `prepareState.assets` keeps a prepared title's files in
 * memory so a tab switch cannot lose them, and that copy stays perfectly usable after the
 * bytes behind it are deleted from disk — so a cleared cache used to leave a Library row
 * reading "prepared" against a store holding nothing, right until the next reload flipped it
 * back with no explanation.
 *
 * Rather than have the cache pane reach into the Library to tidy up after itself, the store
 * that owns the bytes says when they are gone and anyone holding a copy decides what that
 * means for them. The pane keeps knowing nothing but its own totals.
 *
 * The registry is MODULE level, not per instance, for the reason stated at the top of this
 * file: nothing here may run at import time, and a subscriber that had to construct a
 * `BlobCache` to hear about one would touch OPFS just by listening.
 *
 * A listener that throws is dropped on the floor. Clearing is the user's action and it has
 * already happened; a bookkeeping failure elsewhere must not make it look as if it failed.
 */
type BlobClearListener = (scope: BlobClearScope) => void;

const clearListeners = new Set<BlobClearListener>();

/** Subscribe to clears. Returns the unsubscribe. */
export function onBlobCacheCleared(listener: BlobClearListener): () => void {
  clearListeners.add(listener);
  return () => clearListeners.delete(listener);
}

function announceCleared(scope: BlobClearScope): void {
  for (const listener of [...clearListeners]) {
    try {
      listener(scope);
    } catch {
      /* see above: the bytes are already gone either way */
    }
  }
}

export interface BlobCacheDeps {
  backend: BlobCacheBackend;
  quota: StorageQuota;
}

/**
 * The cache itself. Construct one with the real deps (`defaultBlobCacheDeps()`) or with fakes.
 *
 * Every method resolves; none reject on a storage failure. The vocabulary is: null / false /
 * zero means "not held", and that is always a legitimate answer.
 */
export class BlobCache {
  private readonly backend: BlobCacheBackend;
  private readonly quota: StorageQuota;

  constructor(deps: BlobCacheDeps) {
    this.backend = deps.backend;
    this.quota = deps.quota;
  }

  /** Whether anything can be cached at all. False on a browser without OPFS. */
  get available(): boolean {
    return this.backend.available;
  }

  /**
   * The bytes stored under `hash`, or null.
   *
   * Null covers every reason at once — never written, evicted, unavailable backend, and content
   * that no longer hashes to its key. That last case also DELETES the entry: it can never
   * become valid again, and leaving it would cost the user quota forever.
   */
  async get(hash: string): Promise<Uint8Array | null> {
    const found = await this.entry(hash);
    if (!found) return null;
    const name = fileName(found.hash, found.category);
    const bytes = await this.backend.read(name);
    if (!bytes) return null;
    if ((await blobKey(bytes)) === found.hash) return bytes;
    await this.backend.remove(name);
    return null;
  }

  /**
   * Whether an entry exists, WITHOUT reading or verifying its content — the cheap question a
   * list view asks about a hundred rows. A true here is not a promise that `get()` will
   * succeed; only `get()` verifies.
   */
  async has(hash: string): Promise<boolean> {
    return (await this.entry(hash)) !== null;
  }

  /** The metadata for one entry (category and size), or null. No content read. */
  async entry(hash: string): Promise<BlobEntry | null> {
    const key = normalise(hash);
    if (!key) return null;
    for (const category of BLOB_CATEGORIES) {
      const size = await this.backend.stat(fileName(key, category));
      if (size !== null) return { hash: key, category, size };
    }
    return null;
  }

  /**
   * Store `bytes` under their own hash. Returns whether it stuck.
   *
   * The key is CHECKED against the content before anything is written: a caller that passes a
   * hash the bytes do not have has a bug, and storing it would produce an entry that every
   * future `get()` throws away — a silent, permanent cache miss. False is also the answer when
   * the backend refused (quota, no OPFS), which is not a bug and not the user's problem.
   *
   * `category` is deliberately `string`: an unrecognised one files under `other` rather than
   * being rejected, so a caller can pass a value through from data.
   */
  async put(hash: string, bytes: Uint8Array, category: string): Promise<boolean> {
    const key = normalise(hash);
    if (!key) return false;
    if ((await blobKey(bytes)) !== key) return false;
    const cat = asCategory(category);
    // Re-filing under a new category must not leave the old copy behind, doubling the bytes.
    for (const other of BLOB_CATEGORIES) {
      if (other !== cat && (await this.backend.stat(fileName(key, other))) !== null) {
        await this.backend.remove(fileName(key, other));
      }
    }
    return this.backend.write(fileName(key, cat), bytes);
  }

  /** Drop one entry, whatever category it is filed under. Absent is success. */
  async delete(hash: string): Promise<void> {
    const key = normalise(hash);
    if (!key) return;
    for (const category of BLOB_CATEGORIES) {
      await this.backend.remove(fileName(key, category));
    }
  }

  /**
   * Everything held, including entries whose names this version does not understand (they
   * appear under `other`). Sizes come from file metadata; no content is read.
   */
  async list(): Promise<BlobEntry[]> {
    const out: BlobEntry[] = [];
    for (const name of await this.backend.list()) {
      const parsed = parseName(name);
      // A name with no category prefix at all is still bytes on the user's disk.
      const hash = parsed ? parsed.hash : name;
      const category = parsed ? parsed.category : "other";
      const size = await this.backend.stat(name);
      out.push({ hash, category, size: size ?? 0 });
    }
    return out;
  }

  /** Totals per category and overall, from metadata only. Zeroes when nothing is held. */
  async usage(): Promise<BlobUsage> {
    const byCategory = emptyRecord();
    const countByCategory = emptyRecord();
    let total = 0;
    let count = 0;
    for (const e of await this.list()) {
      byCategory[e.category] += e.size;
      countByCategory[e.category] += 1;
      total += e.size;
      count += 1;
    }
    return { total, count, byCategory, countByCategory };
  }

  /** Drop every entry in one category. Returns how many went. */
  async clearCategory(category: string): Promise<number> {
    const cat = asCategory(category);
    let removed = 0;
    for (const name of await this.backend.list()) {
      const parsed = parseName(name);
      const c = parsed ? parsed.category : "other";
      if (c !== cat) continue;
      await this.backend.remove(name);
      removed++;
    }
    // Announced whatever the count: a category the user emptied twice still has to leave the
    // rows that depended on it unprepared, and a zero here only means this pass found nothing.
    announceCleared(cat);
    return removed;
  }

  /** Drop everything. Returns how many entries went. */
  async clear(): Promise<number> {
    let removed = 0;
    for (const name of await this.backend.list()) {
      await this.backend.remove(name);
      removed++;
    }
    announceCleared("all");
    return removed;
  }

  /** Origin-wide used-vs-available, or null when the browser will not say. */
  estimate(): Promise<{ usage: number; quota: number } | null> {
    return this.quota.estimate();
  }

  /** Whether this origin's storage is exempt from eviction. */
  persisted(): Promise<boolean> {
    return this.quota.persisted();
  }

  /**
   * Ask the browser for that exemption. May show a prompt, so call it from an explicit user
   * action — never on load. Nothing in this module calls it.
   */
  requestPersist(): Promise<boolean> {
    return this.quota.persist();
  }
}

/** Reject anything that is not a lowercase-able 64-hex-digit sha256. */
function normalise(hash: string): string | null {
  if (typeof hash !== "string") return null;
  const h = hash.toLowerCase();
  return HEX.test(h) ? h : null;
}

/** The real deps. Evaluated on call, never at import. */
export function defaultBlobCacheDeps(): BlobCacheDeps {
  return { backend: opfsBlobBackend(), quota: navigatorStorageQuota() };
}

let shared: BlobCache | null = null;

/** The app-wide instance, created on first use. Tests construct their own with fakes instead. */
export function blobCache(): BlobCache {
  if (!shared) shared = new BlobCache(defaultBlobCacheDeps());
  return shared;
}
