#!/usr/bin/env node
/**
 * Offline coverage for the LAST TWO IndexedDB byte stores moving onto the OPFS blob cache:
 *
 *   - `src/lib/sources/keyedBlobStore.ts`   — the shared name -> hash pointer + drain.
 *   - `src/lib/screenscraper/coverStore.ts` — cover art (`media`), category `cover`.
 *   - `src/lib/sources/bundleStore.ts`      — imported zips, category `offline`.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/cachemigration.mjs'
 *
 * Plain node, no framework (repo convention). The storage layer is the REAL `BlobCache` over
 * the same in-memory backend `test/blobcache.mjs`, `test/cachewire.mjs` and
 * `test/convertedcache.mjs` inject — the property the whole migration rests on is the cache's
 * re-hash-on-read, and a hand-written stub of it would test the stub. The legacy IndexedDB
 * store is a fake with FAILURE SWITCHES, because the cases that decide whether this code loses
 * a user's covers (a refused write, an entry that vanishes mid-pass, a delete that throws)
 * cannot be staged in a real browser on request.
 *
 * The contract under test:
 *   - an entry migrates and is readable through the NEW path, with its MIME type;
 *   - migrating twice leaves ONE copy (content addressing makes the repeat a no-op);
 *   - an interrupted drain RESUMES, losing and duplicating nothing;
 *   - a failed write — and a write that silently does not stick — leaves the OLD entry intact;
 *   - with OPFS unavailable nothing is deleted, reads still work and writes still persist;
 *   - a read of a not-yet-drained entry serves it AND promotes it (the lazy half);
 *   - `gnw-handles` is never touched, by call count and by source inspection.
 */
import { mkdtempSync, symlinkSync, readFileSync } from "node:fs";
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
const out = mkdtempSync(join(tmpdir(), "gnw-cachemig-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [
    join(here, "../src/lib/sources/blobCache.ts"),
    join(here, "../src/lib/sources/keyedBlobStore.ts"),
    join(here, "../src/lib/sources/bundleStore.ts"),
    join(here, "../src/lib/screenscraper/coverStore.ts"),
  ],
  outdir: out,
  outbase: join(here, "../src/lib"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // `bundleStore.ts` reaches `bundle.ts`, whose one runtime dependency is jszip — a CJS package
  // that needs node's own `buffer`/`stream`, so it cannot go into a `platform: neutral` build.
  // Node resolves it at import time through the `node_modules` link above, exactly as
  // `src/lib/sources/test/validate.mjs` does.
  external: ["jszip"],
  logLevel: "warning",
});
const load = async (n) => import(pathToFileURL(join(out, n)).href);
const { BlobCache, blobKey } = await load("sources/blobCache.js");
const {
  KeyedBlobStore,
  localHashPointerIndex,
  localMigrationFlag,
  nullLegacyStore,
} = await load("sources/keyedBlobStore.js");
const { makeBlobBundleStore } = await load("sources/bundleStore.js");
const { mediaBackendFor } = await load("screenscraper/coverStore.js");

// --- Fakes ------------------------------------------------------------------------------

/** The real `BlobCache` over an in-memory backend, with the switches the drain reacts to. */
function makeCache(opts = {}) {
  const files = new Map();
  const flags = { refuseWrite: false, swallowWrite: false, unavailable: !!opts.unavailable };
  const backend = {
    get available() { return !flags.unavailable; },
    async list() { return [...files.keys()]; },
    async stat(name) { return files.has(name) ? files.get(name).length : null; },
    async read(name) { return files.has(name) ? files.get(name) : null; },
    async write(name, b) {
      if (flags.refuseWrite) return false;
      // "Succeeds" and stores nothing — a quota that reports late, an evicted-on-arrival entry.
      if (flags.swallowWrite) return true;
      files.set(name, b.slice());
      return true;
    },
    async remove(name) { files.delete(name); },
  };
  const quota = {
    async estimate() { return null; },
    async persisted() { return false; },
    async persist() { return false; },
  };
  return { cache: new BlobCache({ backend, quota }), files, flags };
}

/** An in-memory `HashPointerIndex`. */
function makeIndex() {
  const m = new Map();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, p) => { m.set(k, p); },
    delete: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
    _map: m,
  };
}

function makeFlag() {
  const s = { v: false };
  return { done: () => s.v, markDone: () => { s.v = true; }, _s: s };
}

/**
 * The legacy IndexedDB store. `calls` counts every touch so a test can assert a store was NOT
 * consulted; the switches stage the failures a browser will not produce on request.
 */
function makeLegacy(entries = [], opts = {}) {
  const m = new Map(entries.map(([k, bytes, type]) => [k, { bytes: Uint8Array.from(bytes), type: type ?? "" }]));
  const calls = { keys: 0, get: 0, put: 0, delete: 0 };
  const flags = { unavailable: !!opts.unavailable, throwOnDelete: false, refusePut: false };
  return {
    get available() { return !flags.unavailable; },
    async keys() { calls.keys++; return [...m.keys()]; },
    async get(k) {
      calls.get++;
      const v = m.get(k);
      return v ? { bytes: v.bytes.slice(), type: v.type } : null;
    },
    async put(k, bytes, type) {
      calls.put++;
      if (flags.refusePut) return false;
      m.set(k, { bytes: bytes.slice(), type: type ?? "" });
      return true;
    },
    async delete(k) {
      calls.delete++;
      // The interrupt that matters: the new copy is written and verified, the old delete does
      // not land. The next pass must cope without duplicating anything.
      if (flags.throwOnDelete) throw new Error("interrupted");
      m.delete(k);
    },
    _map: m,
    calls,
    flags,
  };
}

function store(over = {}) {
  const { cache, files, flags } = over.cacheParts ?? makeCache();
  const index = over.index ?? makeIndex();
  const legacy = over.legacy ?? makeLegacy();
  const flag = over.flag ?? makeFlag();
  return {
    s: new KeyedBlobStore({ cache, index, category: over.category ?? "cover", legacy, flag }),
    cache, files, cacheFlags: flags, index, legacy, flag,
  };
}

const IMG = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];
const IMG2 = [255, 216, 255, 224, 9, 9, 9];

// --- The new path -------------------------------------------------------------------------

await check("an entry migrates and is readable through the new path", async () => {
  const t = store({ legacy: makeLegacy([["http://ss/img1.png", IMG, "image/png"]]) });
  const rep = await t.s.migrate();
  eq(rep.moved, 1, "moved");
  eq(rep.failed, 0, "failed");
  eq(rep.done, true, "the store is drained");
  eq(t.legacy._map.size, 0, "the old copy is gone");
  const hash = await blobKey(Uint8Array.from(IMG));
  ok(t.files.has(`cover.${hash}`), "and it is filed under the cover category");
  const held = await t.s.get("http://ss/img1.png");
  bytesEq(held.bytes, Uint8Array.from(IMG), "the bytes come back");
  eq(held.type, "image/png", "and so does the MIME type the bytes do not carry");
});

await check("a drained store serves reads without touching IndexedDB again", async () => {
  const t = store({ legacy: makeLegacy([["u", IMG, "image/png"]]) });
  await t.s.migrate();
  const before = { ...t.legacy.calls };
  await t.s.get("u");
  eq(t.legacy.calls.get, before.get, "the pointer hit, so the legacy store was not asked");
});

await check("put stores in the blob cache and drops any legacy copy", async () => {
  const t = store({ legacy: makeLegacy([["u", IMG, "image/png"]]) });
  eq(await t.s.put("u", Uint8Array.from(IMG2), "image/jpeg"), true, "stored");
  eq(t.legacy._map.size, 0, "one copy, not two");
  const held = await t.s.get("u");
  bytesEq(held.bytes, Uint8Array.from(IMG2), "the new bytes");
  eq(held.type, "image/jpeg", "with the new type");
});

await check("re-putting a key drops the bytes it used to point at", async () => {
  const t = store();
  await t.s.put("u", Uint8Array.from(IMG), "image/png");
  const oldHash = await blobKey(Uint8Array.from(IMG));
  await t.s.put("u", Uint8Array.from(IMG2), "image/jpeg");
  ok(!t.files.has(`cover.${oldHash}`), "the orphaned blob is not left costing the user quota");
  eq(t.files.size, 1, "exactly one blob is held");
});

await check("delete removes the pointer, the bytes and any legacy row", async () => {
  const t = store({ legacy: makeLegacy([["u", IMG, "image/png"]]) });
  await t.s.migrate();
  await t.s.delete("u");
  eq(t.files.size, 0, "no bytes");
  eq(t.index.keys().length, 0, "no pointer");
  eq(t.legacy._map.size, 0, "nothing left behind");
  eq(await t.s.get("u"), null, "and it does not come back");
});

// --- Idempotence --------------------------------------------------------------------------

await check("migrating twice leaves ONE copy", async () => {
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"], ["b", IMG2, "image/jpeg"]]) });
  const first = await t.s.migrate();
  eq(first.moved, 2, "first pass moved both");
  const second = await t.s.migrate();
  eq(second.skipped, true, "the second pass does not even run");
  eq(t.files.size, 2, "still two blobs, not four");
  eq(t.index.keys().length, 2, "and two pointers");
});

await check("migrating twice with the done-flag lost still leaves ONE copy", async () => {
  // The flag is an optimisation; correctness may not depend on it. Clear it and go again.
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"]]) });
  await t.s.migrate();
  t.flag._s.v = false;
  const rep = await t.s.migrate();
  eq(rep.moved, 0, "nothing left to move");
  eq(t.files.size, 1, "one blob");
  eq(t.index.keys().length, 1, "one pointer");
});

await check("the same bytes under two keys are stored once (content addressing)", async () => {
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"], ["b", IMG, "image/png"]]) });
  await t.s.migrate();
  eq(t.files.size, 1, "one blob for two keys");
  eq(t.index.keys().length, 2, "both keys still resolve");
  bytesEq((await t.s.get("b")).bytes, Uint8Array.from(IMG), "and both read back");
});

// --- Resumability -------------------------------------------------------------------------

await check("a budgeted drain resumes across passes and finishes", async () => {
  const entries = [["a", IMG, "image/png"], ["b", IMG2, "image/jpeg"], ["c", [7, 7, 7], ""]];
  const t = store({ legacy: makeLegacy(entries) });
  // One entry per pass, three passes — each one picking up exactly where the last stopped,
  // with no cursor anywhere: the legacy store IS the queue.
  const p1 = await t.s.migrate(1);
  eq(p1.moved, 1, "one per pass");
  eq(p1.done, false, "not finished");
  eq(t.legacy._map.size, 2, "the rest is still safely in the old store");
  const p2 = await t.s.migrate(1);
  eq(p2.moved, 1, "the second pass moves the next one");
  eq(t.legacy._map.size, 1, "one to go");
  const p3 = await t.s.migrate(1);
  eq(p3.moved, 1, "and the third finishes");
  eq(p3.done, true, "now the store is drained");
  eq(t.legacy._map.size, 0, "the old store is empty");
  eq(t.files.size, 3, "three blobs, no duplicates");
  for (const [k, bytes] of entries) bytesEq((await t.s.get(k)).bytes, Uint8Array.from(bytes), `${k} survived`);
});

await check("everything stays readable in the middle of a drain", async () => {
  // The reason a half-finished migration is invisible: `get` falls back to wherever the entry
  // still is. Nothing the user can see distinguishes a drained entry from a pending one.
  const entries = [["a", IMG, "image/png"], ["b", IMG2, "image/jpeg"], ["c", [7, 7, 7], ""]];
  const t = store({ legacy: makeLegacy(entries) });
  await t.s.migrate(1);
  for (const [k, bytes, type] of entries) {
    const held = await t.s.get(k);
    bytesEq(held.bytes, Uint8Array.from(bytes), `${k} readable mid-drain`);
    eq(held.type, type ?? "", `${k} keeps its type mid-drain`);
  }
});

await check("an interrupted delete leaves the entry in BOTH places, and the next pass tidies it", async () => {
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"]]) });
  t.legacy.flags.throwOnDelete = true;
  const p1 = await t.s.migrate();
  eq(p1.failed, 1, "counted as failed, because the old copy is still there");
  eq(p1.done, false, "so the flag is NOT set");
  eq(t.legacy._map.size, 1, "the old copy is intact — never a moment with no copy");
  t.legacy.flags.throwOnDelete = false;
  const p2 = await t.s.migrate();
  eq(p2.moved, 1, "the retry completes");
  eq(t.files.size, 1, "and did not duplicate the blob");
  eq(t.legacy._map.size, 0, "old store drained");
});

await check("one bad entry does not abort the pass", async () => {
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"], ["b", IMG2, "image/jpeg"]]) });
  const realGet = t.legacy.get.bind(t.legacy);
  t.legacy.get = async (k) => (k === "a" ? Promise.reject(new Error("corrupt row")) : realGet(k));
  const rep = await t.s.migrate();
  eq(rep.failed, 1, "one failed");
  eq(rep.moved, 1, "the other still moved");
  eq(t.legacy._map.has("a"), true, "the failing row was NOT deleted");
});

// --- Failed writes ------------------------------------------------------------------------

await check("a refused write leaves the old entry intact", async () => {
  const parts = makeCache();
  const t = store({ cacheParts: parts, legacy: makeLegacy([["a", IMG, "image/png"]]) });
  parts.flags.refuseWrite = true;
  const rep = await t.s.migrate();
  eq(rep.moved, 0, "nothing moved");
  eq(rep.failed, 1, "it is reported as failed");
  eq(rep.done, false, "and the store is not marked drained");
  eq(t.flag._s.v, false, "so a later visit tries again");
  eq(t.legacy._map.size, 1, "the only copy is still in IndexedDB");
  bytesEq((await t.s.get("a")).bytes, Uint8Array.from(IMG), "and still readable");
});

await check("a write that silently does not stick leaves the old entry intact", async () => {
  const parts = makeCache();
  const t = store({ cacheParts: parts, legacy: makeLegacy([["a", IMG, "image/png"]]) });
  // `write` reports success but stores nothing. Only the verifying read-back catches this.
  parts.flags.swallowWrite = true;
  const rep = await t.s.migrate();
  eq(rep.failed, 1, "the read-back caught it");
  eq(t.legacy._map.size, 1, "the old copy was not deleted on a lie");
});

await check("a put refused everywhere reports false and loses nothing", async () => {
  const parts = makeCache();
  const t = store({ cacheParts: parts, legacy: makeLegacy() });
  parts.flags.refuseWrite = true;
  t.legacy.flags.refusePut = true;
  eq(await t.s.put("a", Uint8Array.from(IMG), "image/png"), false, "honestly false");
});

// --- No OPFS ------------------------------------------------------------------------------

await check("with OPFS unavailable, nothing is migrated and nothing is lost", async () => {
  const parts = makeCache({ unavailable: true });
  const t = store({ cacheParts: parts, legacy: makeLegacy([["a", IMG, "image/png"]]) });
  const rep = await t.s.migrate();
  eq(rep.skipped, true, "the drain does not run");
  eq(t.legacy.calls.keys, 0, "the old store is not even enumerated");
  eq(t.legacy._map.size, 1, "and certainly not deleted from");
  eq(t.flag._s.v, false, "no false 'done' marker");
  const held = await t.s.get("a");
  bytesEq(held.bytes, Uint8Array.from(IMG), "reads still work, exactly as today");
  eq(held.type, "image/png", "type preserved");
});

await check("with OPFS unavailable, writes still persist — to IndexedDB, as today", async () => {
  const parts = makeCache({ unavailable: true });
  const t = store({ cacheParts: parts, legacy: makeLegacy() });
  eq(await t.s.put("a", Uint8Array.from(IMG2), "image/jpeg"), true, "stored");
  eq(t.legacy._map.size, 1, "in the legacy store");
  bytesEq((await t.s.get("a")).bytes, Uint8Array.from(IMG2), "and read back");
});

await check("with no legacy store at all, the drain is a no-op and the cache still works", async () => {
  const t = store({ legacy: nullLegacyStore });
  eq((await t.s.migrate()).skipped, true, "nothing to drain");
  eq(await t.s.put("a", Uint8Array.from(IMG), "image/png"), true, "and the blob cache still takes writes");
  bytesEq((await t.s.get("a")).bytes, Uint8Array.from(IMG), "read back");
});

// --- The lazy half --------------------------------------------------------------------------

await check("reading a not-yet-drained entry serves it AND promotes it", async () => {
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"]]) });
  const held = await t.s.get("a");
  bytesEq(held.bytes, Uint8Array.from(IMG), "served from the old store");
  eq(t.legacy._map.size, 0, "and moved out of it on the way past");
  eq(t.index.keys().length, 1, "with a pointer written");
  const hash = await blobKey(Uint8Array.from(IMG));
  ok(t.files.has(`cover.${hash}`), "and the bytes in the blob cache");
});

await check("an evicted blob falls back to the legacy copy rather than reporting nothing", async () => {
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"]]) });
  // Stage the one state a real browser produces on its own: pointer kept, bytes evicted, and
  // (because a previous delete did not land) the old row still present.
  await t.s.migrate();
  t.legacy._map.set("a", { bytes: Uint8Array.from(IMG), type: "image/png" });
  t.files.clear();
  bytesEq((await t.s.get("a")).bytes, Uint8Array.from(IMG), "recovered");
});

await check("a miss everywhere is null, not an error", async () => {
  const t = store();
  eq(await t.s.get("nope"), null, "null");
});

// --- The real localStorage-backed pointer + flag ---------------------------------------------

await check("the real pointer index and flag round-trip through localStorage", async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  const index = localHashPointerIndex("gnw.coverHash.v1");
  const flag = localMigrationFlag("gnw.coverMigrated.v1");
  const t = store({ index, flag, legacy: makeLegacy([["a", IMG, "image/png"]]) });
  await t.s.migrate();
  eq(flag.done(), true, "flag persisted");
  const raw = JSON.parse(mem.get("gnw.coverHash.v1"));
  eq(Object.keys(raw).length, 1, "one pointer stored");
  eq(raw.a.type, "image/png", "with its type");
  // A fresh reader over the same localStorage sees the same pointer — this is the reload case.
  eq(localHashPointerIndex("gnw.coverHash.v1").get("a").hash, raw.a.hash, "survives a reload");
  eq(localMigrationFlag("gnw.coverMigrated.v1").done(), true, "so does the flag");
  index.delete("a");
  eq(localHashPointerIndex("gnw.coverHash.v1").get("a"), null, "and delete sticks");
  delete globalThis.localStorage;
});

await check("a corrupt pointer document reads as empty rather than throwing", async () => {
  const mem = new Map([["gnw.coverHash.v1", "{not json"]]);
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  eq(localHashPointerIndex("gnw.coverHash.v1").get("a"), null, "no pointer, no throw");
  delete globalThis.localStorage;
});

// --- The bundle-zip half ----------------------------------------------------------------------

await check("bundle zips migrate and read back through BundleBlobStore", async () => {
  const ZIP = [80, 75, 3, 4, 1, 2, 3, 4, 5];
  const t = store({ category: "offline", legacy: makeLegacy([["someone/minesweeper", ZIP, ""]]) });
  const bs = makeBlobBundleStore(t.s);
  const rep = await t.s.migrate();
  eq(rep.moved, 1, "moved");
  const hash = await blobKey(Uint8Array.from(ZIP));
  ok(t.files.has(`offline.${hash}`), "filed under offline, so the storage view can count it");
  bytesEq(await bs.get("someone/minesweeper"), Uint8Array.from(ZIP), "and the adapter reads it");
  eq(await bs.get("someone/other"), null, "an unknown repo is null");
  await bs.delete("someone/minesweeper");
  eq(await bs.get("someone/minesweeper"), null, "forgetting a row drops the bytes too");
});

await check("a bundle put copies out of a larger buffer", async () => {
  const t = store({ category: "offline" });
  const bs = makeBlobBundleStore(t.s);
  const big = Uint8Array.from([9, 9, 80, 75, 3, 4, 9, 9]);
  eq(await bs.put("a/b", big.subarray(2, 6)), true, "stored");
  bytesEq(await bs.get("a/b"), Uint8Array.from([80, 75, 3, 4]), "just the view, not its neighbours");
});

// --- The Blob-shaped adapter `run.js` actually calls --------------------------------------------

await check("the media backend round-trips a Blob through the byte store", async () => {
  const t = store({ legacy: makeLegacy([["http://ss/old.png", IMG, "image/png"]]) });
  const media = mediaBackendFor(t.s);
  // A cover written today.
  await media.setMedia("http://ss/new.jpg", new Blob([Uint8Array.from(IMG2)], { type: "image/jpeg" }));
  const fresh = await media.getMedia("http://ss/new.jpg");
  eq(fresh.type, "image/jpeg", "type survives the round trip");
  bytesEq(new Uint8Array(await fresh.arrayBuffer()), Uint8Array.from(IMG2), "and so do the bytes");
  // A cover scraped by a PREVIOUS version, still in IndexedDB, read through the new path.
  const old = await media.getMedia("http://ss/old.png");
  eq(old.type, "image/png", "a legacy cover keeps its type");
  bytesEq(new Uint8Array(await old.arrayBuffer()), Uint8Array.from(IMG), "and its bytes");
  eq(await media.getMedia("http://ss/never.png"), null, "an unknown URL is null, not an error");
});

await check("a media write that cannot stick anywhere does not throw at the scrape", async () => {
  const parts = makeCache();
  const t = store({ cacheParts: parts, legacy: makeLegacy() });
  parts.flags.refuseWrite = true;
  t.legacy.flags.refusePut = true;
  // `run.js` already treats a failed cache write as nothing; this must not become an exception.
  await mediaBackendFor(t.s).setMedia("u", new Blob([Uint8Array.from(IMG)], { type: "image/png" }));
});

// --- gnw-handles is not part of any of this ----------------------------------------------------

await check("a second legacy store is never touched by another store's drain", async () => {
  // Stands in for `persist.ts`'s `gnw-handles`: a store this code has no business opening.
  const handles = makeLegacy([["sd-root", [1, 2, 3], ""]]);
  const t = store({ legacy: makeLegacy([["a", IMG, "image/png"]]) });
  await t.s.migrate();
  await t.s.get("a");
  await t.s.put("b", Uint8Array.from(IMG2), "image/jpeg");
  await t.s.delete("b");
  eq(handles.calls.keys + handles.calls.get + handles.calls.put + handles.calls.delete, 0, "untouched");
  eq(handles._map.size, 1, "and still holding its entry");
});

await check("no migration module names the handle store or persist.ts", async () => {
  // A source-level guard, because the failure mode this prevents is a LATER reader "finishing
  // the job" by draining `gnw-handles` too — which cannot work (a directory handle has no byte
  // representation) and would destroy the user's saved folder locations.
  const files = [
    "../src/lib/sources/keyedBlobStore.ts",
    "../src/lib/sources/cacheMigrations.ts",
    "../src/lib/screenscraper/coverStore.ts",
    "../src/lib/sources/bundleStore.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(here, f), "utf8");
    ok(!/from ["'].*persist\.js["']/.test(src), `${f} does not import persist.ts`);
    // `cacheMigrations.ts` names `gnw-handles` only in the comment explaining why it is excluded.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!code.includes("gnw-handles"), `${f} does not reference the gnw-handles database`);
  }
  // And the exclusion is actually documented where someone would look.
  const persist = readFileSync(join(here, "../src/lib/persist.ts"), "utf8");
  ok(/DOES NOT MOVE/.test(persist), "persist.ts says why its store stays on IndexedDB");
});

console.log(`\ncachemigration: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
