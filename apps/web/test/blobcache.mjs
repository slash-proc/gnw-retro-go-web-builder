#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/sources/blobCache.ts` — the content-addressed OPFS blob cache.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/blobcache.mjs'
 *
 * Plain node, no framework (repo convention). Node has no OPFS at all, so the storage layer is
 * INJECTED (`BlobCacheDeps`), the same technique `test/localfolders.mjs` uses and for the same
 * reason: the cases that decide whether this module is correct — an evicted entry, a quota
 * refusal, content that no longer matches its key, a browser with no OPFS — cannot be staged in
 * a real browser on request.
 *
 * The contract under test:
 *   - round-trip: what went in comes back byte-identical.
 *   - a miss RETURNS NOTHING rather than throwing. It is the normal answer, not an error.
 *   - content that does not hash to its key reads as a MISS, and the entry is dropped.
 *   - sizes come from metadata, per category and overall, with no content read.
 *   - an unrecognised category lands in `other` and is COUNTED. Nothing held is invisible.
 *   - delete one entry; delete a whole category.
 *   - with no OPFS, every read misses and every write is dropped, silently.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg); }
function bytesEq(a, b, msg) {
  ok(a && b && a.length === b.length && a.every((v, i) => v === b[i]), msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-blobcache-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/blobCache.ts")],
  outfile: join(out, "blobCache.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const mod = await import(pathToFileURL(join(out, "blobCache.js")).href);
const { BlobCache, blobKey, asCategory, BLOB_CATEGORIES, nullBlobBackend, opfsBlobBackend } = mod;

// --- Fake backend: a Map of name -> bytes, plus switches for the failure cases ---------------
function makeBackend() {
  const files = new Map();
  return {
    files,
    /** Names whose write is refused, the way a quota refusal arrives. */
    refuse: new Set(),
    backend: {
      available: true,
      async list() { return [...files.keys()]; },
      async stat(name) { return files.has(name) ? files.get(name).length : null; },
      async read(name) { return files.has(name) ? files.get(name) : null; },
      async write(name, bytes) {
        if (this.refuse.has(name)) return false;
        files.set(name, bytes.slice());
        return true;
      },
      async remove(name) { files.delete(name); },
    },
  };
}
function makeQuota(over) {
  return {
    estimate: async () => (over && "estimate" in over ? over.estimate : { usage: 10, quota: 100 }),
    persisted: async () => (over && "persisted" in over ? over.persisted : false),
    persist: async () => (over && "persist" in over ? over.persist : true),
  };
}
function makeCache(over) {
  const b = makeBackend();
  b.backend.refuse = b.refuse;
  return { ...b, cache: new BlobCache({ backend: b.backend, quota: makeQuota(over) }) };
}
const bytes = (...v) => new Uint8Array(v);
const filler = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);

// 1. Round-trip.
await check("a stored blob comes back byte-identical under its own hash", async () => {
  const { cache } = makeCache();
  const data = filler(1000, 3);
  const key = await blobKey(data);
  eq(await cache.put(key, data, "firmware"), true, "put stuck");
  bytesEq(await cache.get(key), data, "round-tripped intact");
  eq(await cache.has(key), true, "has() sees it");
  eq((await cache.entry(key)).category, "firmware", "filed under the category given");
  eq((await cache.entry(key)).size, 1000, "size from metadata");
});

await check("put refuses a key the bytes do not actually have", async () => {
  const { cache, files } = makeCache();
  const wrong = "a".repeat(64);
  eq(await cache.put(wrong, bytes(1, 2, 3), "artifact"), false, "refused");
  eq(files.size, 0, "and nothing was written");
});

await check("a write the backend refuses reports false, not an exception", async () => {
  const { cache, refuse } = makeCache();
  const data = bytes(9, 9, 9);
  const key = await blobKey(data);
  refuse.add(`cover.${key}`);
  eq(await cache.put(key, data, "cover"), false, "refusal surfaced as false");
  eq(await cache.get(key), null, "and it reads as a miss");
});

// 2. A miss returns nothing rather than throwing.
await check("a miss returns null and does not throw", async () => {
  const { cache } = makeCache();
  const key = await blobKey(bytes(4, 5, 6));
  eq(await cache.get(key), null, "never-written key misses");
  eq(await cache.has(key), false, "has() is false");
  eq(await cache.entry(key), null, "no entry");
  eq(await cache.get("not-a-hash"), null, "a malformed key misses too, silently");
});

await check("an evicted entry reads as a miss, exactly like a never-written one", async () => {
  const { cache, files } = makeCache();
  const data = filler(64, 1);
  const key = await blobKey(data);
  await cache.put(key, data, "offline");
  files.clear(); // the browser reclaimed the origin's storage
  eq(await cache.get(key), null, "gone is a miss");
  eq(await cache.has(key), false, "and has() agrees");
});

// 3. Content that does not match its key.
await check("content that does not hash to its key reads as a miss and is dropped", async () => {
  const { cache, files } = makeCache();
  const data = filler(128, 2);
  const key = await blobKey(data);
  await cache.put(key, data, "artifact");
  files.set(`artifact.${key}`, bytes(0, 0, 0, 0)); // corrupted / truncated under us
  eq(await cache.get(key), null, "a mismatch is a miss, not an error");
  eq(files.has(`artifact.${key}`), false, "and the entry was dropped, not left to waste quota");
});

// 4. Sizes, per category and overall.
await check("usage() totals per category and overall", async () => {
  const { cache } = makeCache();
  const a = filler(100, 1), b = filler(250, 2), c = filler(30, 3);
  await cache.put(await blobKey(a), a, "firmware");
  await cache.put(await blobKey(b), b, "firmware");
  await cache.put(await blobKey(c), c, "cover");
  const u = await cache.usage();
  eq(u.total, 380, "overall total");
  eq(u.count, 3, "overall count");
  eq(u.byCategory.firmware, 350, "firmware bytes");
  eq(u.countByCategory.firmware, 2, "firmware count");
  eq(u.byCategory.cover, 30, "cover bytes");
  eq(u.byCategory.converter, 0, "an empty category reads zero, not undefined");
  for (const cat of BLOB_CATEGORIES) {
    ok(typeof u.byCategory[cat] === "number", `${cat} present in the breakdown`);
  }
});

await check("usage() reads no content — sizes come from stat alone", async () => {
  const { cache, backend } = makeCache();
  const data = filler(500, 9);
  await cache.put(await blobKey(data), data, "converted");
  let reads = 0;
  const realRead = backend.read.bind(backend);
  backend.read = async (n) => { reads++; return realRead(n); };
  const u = await cache.usage();
  eq(u.total, 500, "still totalled");
  eq(reads, 0, "no content was read to do it");
});

// 5. Unknown categories land in `other` and are counted.
await check("an unknown category is stored under other, listed and counted", async () => {
  const { cache } = makeCache();
  const data = filler(77, 5);
  const key = await blobKey(data);
  eq(await cache.put(key, data, "something-from-the-future"), true, "stored, not rejected");
  eq((await cache.entry(key)).category, "other", "filed under other");
  bytesEq(await cache.get(key), data, "and still readable by hash");
  const u = await cache.usage();
  eq(u.byCategory.other, 77, "counted in other");
  eq(u.countByCategory.other, 1, "one entry there");
  eq(u.total, 77, "and in the overall total");
  eq(asCategory("nonsense"), "other", "asCategory coerces");
  eq(asCategory(undefined), "other", "including non-strings");
  eq(asCategory("cover"), "cover", "and passes a known one through");
});

await check("a file whose NAME this version cannot parse is still listed and counted", async () => {
  const { cache, files } = makeCache();
  files.set("written-by-a-later-version", filler(42, 6)); // no category prefix at all
  const rows = await cache.list();
  eq(rows.length, 1, "the strange file is listed");
  eq(rows[0].category, "other", "under other");
  eq(rows[0].size, 42, "with its real size");
  const u = await cache.usage();
  eq(u.total, 42, "and it counts toward the total the user is shown");
});

await check("re-filing a blob under a new category does not leave the old copy behind", async () => {
  const { cache, files } = makeCache();
  const data = filler(64, 7);
  const key = await blobKey(data);
  await cache.put(key, data, "artifact");
  await cache.put(key, data, "converted");
  eq(files.size, 1, "exactly one copy on disk");
  eq((await cache.usage()).total, 64, "and counted once");
  eq((await cache.entry(key)).category, "converted", "under the new category");
});

// 6. Deleting.
await check("deleting one entry leaves the others alone", async () => {
  const { cache } = makeCache();
  const a = filler(10, 1), b = filler(20, 2);
  const ka = await blobKey(a), kb = await blobKey(b);
  await cache.put(ka, a, "firmware");
  await cache.put(kb, b, "firmware");
  await cache.delete(ka);
  eq(await cache.get(ka), null, "the deleted one is gone");
  bytesEq(await cache.get(kb), b, "the other one survives");
  eq((await cache.usage()).total, 20, "total reflects the deletion");
  await cache.delete(ka); // idempotent
  eq((await cache.usage()).count, 1, "deleting an absent entry is a no-op");
});

await check("clearing a category removes only that category", async () => {
  const { cache } = makeCache();
  const a = filler(10, 1), b = filler(20, 2), c = filler(30, 3);
  await cache.put(await blobKey(a), a, "cover");
  await cache.put(await blobKey(b), b, "cover");
  await cache.put(await blobKey(c), c, "firmware");
  eq(await cache.clearCategory("cover"), 2, "two removed");
  const u = await cache.usage();
  eq(u.byCategory.cover, 0, "covers gone");
  eq(u.byCategory.firmware, 30, "firmware untouched");
  eq(u.total, 30, "total updated");
  eq(await cache.clearCategory("cover"), 0, "clearing an empty category removes nothing");
});

await check("clearing the other category reaches unparseable names too", async () => {
  const { cache, files } = makeCache();
  files.set("mystery-file", filler(5, 1));
  const d = filler(15, 2);
  await cache.put(await blobKey(d), d, "not-a-real-category");
  eq(await cache.clearCategory("other"), 2, "both the unknown-category and unparseable entries");
  eq((await cache.usage()).total, 0, "nothing left");
});

await check("clear() empties everything", async () => {
  const { cache } = makeCache();
  for (const s of [1, 2, 3]) {
    const d = filler(10 * s, s);
    await cache.put(await blobKey(d), d, s === 1 ? "cover" : "firmware");
  }
  eq(await cache.clear(), 3, "three removed");
  eq((await cache.usage()).total, 0, "empty");
  eq((await cache.list()).length, 0, "nothing listed");
});

// 7. Quota passthrough.
await check("estimate / persisted / requestPersist pass through the injected surface", async () => {
  const { cache } = makeCache({ estimate: { usage: 5, quota: 50 }, persisted: true, persist: false });
  const e = await cache.estimate();
  eq(e.usage, 5, "usage");
  eq(e.quota, 50, "quota");
  eq(await cache.persisted(), true, "persisted");
  eq(await cache.requestPersist(), false, "a refused persist request is reported, not thrown");
});

await check("a browser that will not give an estimate yields null, not a throw", async () => {
  const { cache } = makeCache({ estimate: null });
  eq(await cache.estimate(), null, "null estimate");
});

// 8. The degraded no-op path.
await check("with no OPFS every read misses and every write is dropped, silently", async () => {
  const cache = new BlobCache({ backend: nullBlobBackend, quota: makeQuota() });
  eq(cache.available, false, "reports itself unavailable");
  const data = filler(100, 1);
  const key = await blobKey(data);
  eq(await cache.put(key, data, "firmware"), false, "the write is dropped");
  eq(await cache.get(key), null, "the read misses");
  eq(await cache.has(key), false, "has() is false");
  eq((await cache.list()).length, 0, "nothing listed");
  eq((await cache.usage()).total, 0, "zero total");
  await cache.delete(key); // must not throw
  eq(await cache.clear(), 0, "clear removes nothing");
});

await check("opfsBlobBackend degrades when navigator.storage.getDirectory is absent", async () => {
  const prev = globalThis.navigator;
  try {
    // No navigator at all (node's baseline for this module).
    eq(opfsBlobBackend().available, false, "no navigator -> unavailable");
    // A navigator with storage but no getDirectory (Firefox before 111).
    Object.defineProperty(globalThis, "navigator", {
      value: { storage: { estimate: async () => ({}) } },
      configurable: true,
    });
    const b = opfsBlobBackend();
    eq(b.available, false, "storage without getDirectory -> unavailable");
    eq(await b.read("x"), null, "and it still answers rather than throwing");
    eq(await b.write("x", bytes(1)), false, "writes dropped");
    eq((await b.list()).length, 0, "empty listing");
  } finally {
    if (prev === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prev, configurable: true });
  }
});

await check("constructing the module's real deps touches no storage at import time", async () => {
  // The module was imported at the top of this file with no navigator defined. If anything ran
  // `navigator.storage` at import time, that import would already have thrown.
  const deps = mod.defaultBlobCacheDeps();
  eq(deps.backend.available, false, "the real backend degrades cleanly under node");
  eq(await deps.quota.estimate(), null, "and the real quota surface answers null");
  eq(await deps.quota.persisted(), false, "persisted is false, not a throw");
  eq(await deps.quota.persist(), false, "persist was NOT auto-requested and returns false here");
});

console.log(`\nblobcache: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
