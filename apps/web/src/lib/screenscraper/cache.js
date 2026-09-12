// cache.js — IndexedDB cache, persistent across sessions.
//   store "games": jeuInfos results, keyed by "<systemeid>:<md5>"
//   store "media": image Blobs, keyed by media URL
// Goal: never re-query / re-download something already fetched.
//
// WHICH HALF LIVES WHERE, AND WHY.
//
// The "media" half is bulk image bytes, so it belongs in the OPFS blob cache with every other
// bulk-bytes category this app holds. It does NOT move by rewriting the functions below: this
// file stays pure IndexedDB and exposes two seams instead — `legacyMediaStore` (the drainable
// view of the old store) and `setMediaBackend` (which `coverStore.ts` uses to take over
// getMedia/setMedia). Keeping the IndexedDB code and the OPFS code in separate modules is the
// point; a single function talking to both stores is how a half-written migration loses data.
//
// The "games" half STAYS HERE, deliberately. A `jeuInfos` record is a few kB of JSON, not bulk
// bytes, and three things make the blob cache the wrong home for it:
//   - it is content-ADDRESSED, so every read would encode the JSON and run a sha256 over it
//     just to find a record already keyed by an md5 the caller has in hand;
//   - each entry needs a name -> hash POINTER in localStorage, and a scraped library is
//     thousands of games — thousands of pointers in a store with a few-megabyte quota, to
//     avoid keeping a few megabytes of JSON in a store with no such limit. That is backwards;
//   - the value is a structured record the code reads fields off, not an opaque payload; the
//     blob cache deliberately knows nothing but bytes.
// IndexedDB is the right store for small structured records and is already here, so the JSON
// half is left exactly as it is. This is a decision, not an oversight.

const DB_NAME = "cover-scraper-cache";
const DB_VERSION = 1;
const STORES = ["games", "media"];

let dbPromise = null;

// Installed once, at app start, by `coverStore.ts`. Until then — and forever, in any context
// that never imports that module (the /dev harness, a test) — media reads and writes go
// straight to IndexedDB exactly as they always did. There is no third behaviour.
let mediaBackend = null;


function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db() {
  return (dbPromise ||= open());
}

async function get(store, key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function del(store, key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function allKeys(store) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).getAllKeys();
    req.onsuccess = () => resolve((req.result || []).filter((k) => typeof k === "string"));
    req.onerror = () => reject(req.error);
  });
}

async function set(store, key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearCache() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORES, "readwrite");
    for (const s of STORES) tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function count(store) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// { games, media, bytes } — counts from IndexedDB, bytes from the storage
// estimate (origin usage; here essentially the cache).
export async function cacheStats() {
  const [games, media] = await Promise.all([
    count("games"),
    // Once `coverStore.ts` has taken over, the covers are no longer in this store; asking it
    // would report 0 and the line would read as "the cache is empty" to a user whose covers
    // are all still there.
    mediaBackend ? mediaBackend.mediaCount() : count("media"),
  ]);
  let bytes = 0;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      bytes = e.usage || 0;
    }
  } catch (e) { /* ignore */ }
  return { games, media, bytes };
}

// --- The "media" seam ------------------------------------------------------------------------

// The drainable view of the OLD media store, in the shape `sources/keyedBlobStore.ts` expects.
// Nothing here throws: every failure is a null / false / empty answer, because a migration that
// throws mid-pass is a migration that has to decide what it already did.
export const legacyMediaStore = {
  get available() {
    return typeof indexedDB !== "undefined";
  },
  async keys() {
    try {
      return await allKeys("media");
    } catch (e) {
      return [];
    }
  },
  async get(key) {
    try {
      const blob = await get("media", key);
      if (!blob || typeof blob.arrayBuffer !== "function") return null;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "" };
    } catch (e) {
      return null;
    }
  },
  async put(key, bytes, type) {
    try {
      await set("media", key, new Blob([bytes], type ? { type } : undefined));
      return true;
    } catch (e) {
      return false;
    }
  },
  async delete(key) {
    try {
      await del("media", key);
    } catch (e) { /* absent is success */ }
  },
};

/** Hand media caching to another store. Pass null to go back to plain IndexedDB. */
export function setMediaBackend(backend) {
  mediaBackend = backend;
}

export const cache = {
  getGame: (key) => get("games", key),
  setGame: (key, jeu) => set("games", key, jeu),
  getMedia: (url) => (mediaBackend ? mediaBackend.getMedia(url) : get("media", url)),
  setMedia: (url, blob) => (mediaBackend ? mediaBackend.setMedia(url, blob) : set("media", url, blob)),
};
