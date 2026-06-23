// Client-side persistence of UI SELECTIONS + last-used FOLDER LOCATIONS.
//
// SAFETY CONTRACT: we persist only the user's own choices (modes / toggles) and opaque directory
// HANDLES — never file contents. We never read inside the chosen folders for persistence purposes;
// a stored handle is just a re-grantable pointer to a location the user already picked, and it
// still needs an explicit permission re-grant on a later visit before we touch anything.

const NS = "gnw:";

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

// --- Directory handles (File System Access API) in IndexedDB --------------------------------
// FileSystemDirectoryHandle is structured-cloneable, so IndexedDB stores it verbatim. We keep
// handles in a tiny dedicated DB; on a later visit the handle still needs a permission re-grant.

const DB_NAME = "gnw-handles";
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
