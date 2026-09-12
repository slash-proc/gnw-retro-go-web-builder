/**
 * Where an imported bundle's bytes live between visits.
 *
 * THE PROBLEM. `bundle.ts` publishes each verified payload as a `blob:` URL and substitutes it
 * for the artifact's `url`, so `installArtifacts.ts` fetches and re-hashes it with no idea it
 * never touched the network. That indirection is right and stays. But a blob URL dies with the
 * tab, and `store.svelte.ts` persists only the small `SourceCard` — so on the next visit a
 * bundle row came back with no payloads behind it and the UI had to ask for the zip again.
 *
 * WHAT IS STORED. The ORIGINAL ZIP, verbatim, one per source, keyed by the row's normalised
 * `owner/repo` — the same key the row itself is filed under, so there is no second identity to
 * keep in step. Not the extracted payloads: the zip is already the archival form, it is what
 * the user was handed, and keeping it means restoring is not a second, weaker code path but
 * literally `importBundle()` again.
 *
 * WHY THAT MATTERS FOR TRUST. Restoring re-runs the whole import: entry-name guards, schema
 * gating, length and sha256 of every file the manifest names, then a fresh set of blob URLs
 * which `installArtifacts.ts` hashes AGAIN on the way out. There is deliberately no "we
 * already checked this once" fast path. A local store is not a trust boundary — the bytes in
 * IndexedDB are exactly as untrusted as the bytes in the file the user picked, and something
 * that could rewrite them could rewrite a "verified" flag beside them just as easily.
 *
 * localStorage cannot hold binary and its quota is a few megabytes; a homebrew bundle is not a
 * few megabytes. That is why this module exists at all rather than a line in `persist.ts`.
 *
 * WHERE THE BYTES LIVE NOW. Originally IndexedDB, because it was the only store in the browser
 * that fit. It is no longer: `blobCache.ts` holds every other bulk category this app keeps, and
 * a zip parked outside it was a zip the storage view could not count and the user could not
 * reclaim. `blobBundleStore` is therefore the default, and it is `keyedBlobStore.ts` — the blob
 * cache behind a repo -> hash pointer, with `idbBundleStore` still underneath as the legacy
 * store, drained in the background by `cacheMigrations.ts`. `BundleBlobStore` was already the
 * seam between this module's logic and its bytes, so nothing above it changed: `restoreBundle`
 * still re-runs the whole import, hashes and all.
 *
 * `idbBundleStore` is kept, exported and working, because a browser without OPFS still needs
 * somewhere to put a zip — `KeyedBlobStore.put` falls back to it — and because it is the only
 * thing that can read what previous versions wrote.
 *
 * FAILURE IS NORMAL. Private browsing, a disabled store, a quota refusal, a zip that no longer
 * verifies: every one of them degrades to exactly the behaviour that existed before this
 * module — the row loads from its card and asks for the zip again. Nothing here ever leaves a
 * row claiming to be installable when its bytes are gone.
 */
import { scoped } from "../storageScope.js";
import { importBundle, type BundleImport, type PublishFn } from "./bundle.js";
import {
  KeyedBlobStore,
  keyedBlobStore,
  type LegacyBlobStore,
  type MigrationReport,
} from "./keyedBlobStore.js";

const DB_NAME = scoped("gnw-bundles");
const STORE = "zips";

/**
 * The bytes-per-repo backend. An interface, not a hardcoded `indexedDB` call, so the validation
 * script can run the real restore logic against an in-memory store — and against one that
 * FAILS, which is the case that matters and which a browser will not stage on request.
 */
export interface BundleBlobStore {
  /** The stored zip for `repo`, or null when there is none (and on any error). */
  get(repo: string): Promise<Uint8Array | null>;
  /** Keep `zip` under `repo`. Resolves false when the store refused it (quota, private mode). */
  put(repo: string, zip: Uint8Array): Promise<boolean>;
  /** Drop whatever is stored for `repo`. Never throws. */
  delete(repo: string): Promise<void>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // An open that never resolves would hang the Sources list forever; a version-change
    // deadlock with another tab is the one way that happens.
    req.onblocked = () => reject(new Error("blocked"));
  });
}

async function withDb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const value = await new Promise<T>((resolve, reject) => {
      const tx = db!.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      // `tx.oncomplete`, not `r.onsuccess`, for writes: a put "succeeds" long before the
      // transaction commits, and a quota refusal arrives as an abort at commit time.
      tx.oncomplete = () => resolve(r.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return value;
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

/** The legacy store. Every operation swallows its errors into the "not available" answer. */
export const idbBundleStore: BundleBlobStore = {
  async get(repo) {
    const v = await withDb<unknown>("readonly", (s) => s.get(repo), null);
    // A structured clone comes back as whatever went in; anything else is a store we did not
    // write and will not guess at.
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return null;
  },
  async put(repo, zip) {
    // `.slice()` detaches nothing and copies out of any larger buffer the caller is viewing,
    // so what is stored is this zip and not its neighbours.
    const ok = await withDb<true | null>("readwrite", (s) => s.put(zip.slice(), repo), null);
    return ok !== null;
  },
  async delete(repo) {
    await withDb<null>("readwrite", (s) => s.delete(repo), null);
  },
};

/**
 * `idbBundleStore` seen as a drainable legacy store. Zips carry no MIME type worth recording,
 * so the pointer's `type` is always "" here.
 */
export const legacyBundleStore: LegacyBlobStore = {
  get available() {
    return typeof indexedDB !== "undefined";
  },
  async keys() {
    return withDb<string[]>("readonly", (s) => s.getAllKeys(), []).then((ks) =>
      (ks || []).filter((k): k is string => typeof k === "string"),
    );
  },
  async get(repo) {
    const bytes = await idbBundleStore.get(repo);
    return bytes ? { bytes, type: "" } : null;
  },
  put(repo, bytes) {
    return idbBundleStore.put(repo, bytes);
  },
  delete(repo) {
    return idbBundleStore.delete(repo);
  },
};

/** Repo -> pointer, and the "old store drained" marker. Same shape as every other `gnw.*` key. */
export const BUNDLE_ZIP_INDEX_KEY = scoped("gnw.bundleZipHash.v1");
export const BUNDLE_ZIP_MIGRATED_KEY = scoped("gnw.bundleZipMigrated.v1");

let blobStore: KeyedBlobStore | null = null;

/** The blob-cache-backed store, created on first use. Tests build their own with fakes. */
export function bundleKeyedStore(): KeyedBlobStore {
  if (!blobStore) {
    blobStore = keyedBlobStore({
      category: "offline",
      indexKey: BUNDLE_ZIP_INDEX_KEY,
      flagKey: BUNDLE_ZIP_MIGRATED_KEY,
      legacy: legacyBundleStore,
    });
  }
  return blobStore;
}

/**
 * Adapt a `KeyedBlobStore` to the `BundleBlobStore` vocabulary this module already speaks.
 * A factory rather than an object literal so the validation script can drive the real adapter
 * over fakes instead of the app-wide singleton.
 */
export function makeBlobBundleStore(store: KeyedBlobStore): BundleBlobStore {
  return {
    async get(repo) {
      const held = await store.get(repo);
      return held ? held.bytes : null;
    },
    put(repo, zip) {
      // `.slice()` for the same reason `idbBundleStore.put` does it: copy out of any larger
      // buffer the caller is viewing, so what is stored is this zip and not its neighbours.
      return store.put(repo, zip.slice(), "");
    },
    delete(repo) {
      return store.delete(repo);
    },
  };
}

/** The default `BundleBlobStore`: the blob cache, with IndexedDB behind it. */
export const blobBundleStore: BundleBlobStore = {
  get: (repo) => makeBlobBundleStore(bundleKeyedStore()).get(repo),
  put: (repo, zip) => makeBlobBundleStore(bundleKeyedStore()).put(repo, zip),
  delete: (repo) => makeBlobBundleStore(bundleKeyedStore()).delete(repo),
};

/** Move one budget's worth of zips out of IndexedDB. Never throws. */
export function migrateBundles(budget: number): Promise<MigrationReport> {
  return bundleKeyedStore().migrate(budget);
}

/**
 * Keep an imported zip so the next visit can restore it. Returns whether it stuck.
 *
 * A false is not an error the user needs to see: the import they just did is live in this tab
 * either way, and the only consequence is that a reload will ask for the file again — which is
 * what the `bundleReimport` line already says.
 */
export function keepBundle(repo: string, zip: Uint8Array, store: BundleBlobStore = blobBundleStore): Promise<boolean> {
  return store.put(repo, zip);
}

/** Forget a source's stored zip. Called when the row is removed. */
export function forgetBundle(repo: string, store: BundleBlobStore = blobBundleStore): Promise<void> {
  return store.delete(repo);
}

export interface RestoreOptions {
  store?: BundleBlobStore;
  /** Passed straight through to `importBundle`; tests stub it, the app does not. */
  publish?: PublishFn;
}

/**
 * Re-import a previously kept zip, producing exactly what the original import produced —
 * fresh payload URLs and a `release()` for them.
 *
 * Returns null when there is nothing stored, when the store is unavailable, OR when the stored
 * bytes no longer import cleanly. That last case also DROPS them: a zip that fails verification
 * will fail it again on every future visit, and keeping it would cost the user quota forever
 * to no purpose. Null is the honest answer in all three cases and the caller treats them
 * identically — the row falls back to its card and asks for the zip.
 */
export async function restoreBundle(repo: string, opts?: RestoreOptions): Promise<BundleImport | null> {
  const store = opts?.store ?? blobBundleStore;
  const zip = await store.get(repo);
  if (!zip) return null;
  try {
    // The full import, every guard and every hash. Not a shortcut past them.
    return await importBundle(zip, opts?.publish ? { publish: opts.publish } : undefined);
  } catch {
    await store.delete(repo);
    return null;
  }
}
