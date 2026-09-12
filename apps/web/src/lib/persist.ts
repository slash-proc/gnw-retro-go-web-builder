// Client-side persistence of UI SELECTIONS + last-used FOLDER LOCATIONS.
//
// SAFETY CONTRACT: we persist only the user's own choices (modes / toggles) and opaque directory
// HANDLES — never file contents. We never read inside the chosen folders for persistence purposes;
// a stored handle is just a re-grantable pointer to a location the user already picked, and it
// still needs an explicit permission re-grant on a later visit before we touch anything.

import { scoped, isScopedBuild } from "./storageScope.js";

// Scoped so a non-production build (see `storageScope.ts`) cannot read or write production's
// keys. Production scopes to "", so this is exactly `gnw:` as it has always been.
const NS = scoped("gnw:");

/** Read a persisted selection (localStorage). Returns `fallback` on miss or any error. */
export function loadSel<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Persist a selection (localStorage). Swallows errors (private mode / storage disabled). */
export function saveSel(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

// --- Bare-string keys with a legacy, un-namespaced name -------------------------------------
// `theme` and `locale` predate the `gnw:` convention above. They store a bare string (not
// JSON), so they don't go through loadSel/saveSel. These two helpers move them onto the
// namespace WITHOUT resetting anyone: the first read after the upgrade adopts the old key's
// value and deletes it, so the legacy name is gone from that point on (a one-time migration,
// not a permanent double-read — once the old key is removed the fallback branch never runs
// again).

/** Read a namespaced raw string, adopting (and clearing) an un-namespaced legacy key once. */
export function loadRawMigrated(key: string, legacyKey: string): string | null {
  try {
    const current = localStorage.getItem(NS + key);
    // A scoped build must never touch the un-namespaced legacy key: this function ADOPTS it and
    // then DELETES it, so a wip visit would silently consume the production user's `theme` /
    // `locale`. Scoped builds simply start from the default instead.
    if (isScopedBuild()) return current;
    if (current !== null) {
      // Already migrated. Clear any legacy leftover so this branch stops being reachable.
      localStorage.removeItem(legacyKey);
      return current;
    }
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return null;
    localStorage.setItem(NS + key, legacy);
    localStorage.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

/** Persist a namespaced raw string (no JSON encoding). Swallows storage errors. */
export function saveRaw(key: string, value: string): void {
  try {
    localStorage.setItem(NS + key, value);
  } catch {
    /* non-fatal */
  }
}

// --- Directory handles (File System Access API) in IndexedDB --------------------------------
// FileSystemDirectoryHandle is structured-cloneable, so IndexedDB stores it verbatim. We keep
// handles in a tiny dedicated DB; on a later visit the handle still needs a permission re-grant.
//
// THIS STORE DOES NOT MOVE TO THE OPFS BLOB CACHE, and a later reader tidying up the last
// IndexedDB user should not try. Every other IndexedDB byte store in this app has been drained
// onto `sources/blobCache.ts` (see `sources/cacheMigrations.ts`), which is why `gnw-handles`
// now looks like an oversight. It is not. A directory handle is structured-cloneable but it is
// NOT BYTES: OPFS stores files, and there is no byte representation of a handle to store —
// serialising one would yield a dead object granting access to nothing. Structured clone into
// IndexedDB is the only mechanism in the browser that preserves it, so this stays here
// permanently. It is also tiny (a handful of entries) and holds no file contents at all.

const DB_NAME = scoped("gnw-handles");
const STORE = "dirs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist a directory handle under `key`. Swallows errors. */
export async function saveDir(key: string, handle: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* non-fatal */
  }
}

/** Load a previously persisted directory handle, or null. Swallows errors. */
export async function loadDir(key: string): Promise<unknown | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  } catch {
    return null;
  }
}

// --- Permission handling for a stored handle -----------------------------------------------
type PermissionState = "granted" | "denied" | "prompt";
interface PermissionHandle {
  queryPermission?(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

/** Whether `handle` currently grants `mode` access. With `interactive`, may prompt the user
 *  (must be called from a user gesture). Non-interactive never prompts — safe to call on mount. */
export async function handlePermission(
  handle: unknown,
  mode: "read" | "readwrite",
  interactive: boolean,
): Promise<boolean> {
  const h = handle as PermissionHandle;
  const opts = { mode };
  try {
    if ((await h.queryPermission?.(opts)) === "granted") return true;
    if (interactive && (await h.requestPermission?.(opts)) === "granted") return true;
  } catch {
    /* handle missing the API → not granted */
  }
  return false;
}

/** Forget a persisted directory handle. Swallows errors.
 *  Removing a stored folder MUST call this, or the handle store grows entries forever. */
export async function deleteDir(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* non-fatal */
  }
}
