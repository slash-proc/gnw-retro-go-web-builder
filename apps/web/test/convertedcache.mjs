#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/sources/convertedCache.ts` — persistence of CONVERTED OUTPUT,
 * the one cached category that cannot be re-fetched from anywhere (it is derived from the
 * user's own ROM).
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/convertedcache.mjs'
 *
 * Plain node, no framework (repo convention). The storage layer is the REAL `BlobCache` over
 * the same in-memory backend `test/blobcache.mjs` and `test/cachewire.mjs` inject, and the
 * CONVERTER is a counting fake — so "did this actually skip the run?" is an assertion about a
 * call count, not a hope.
 *
 * `prepareState.svelte.ts` itself is not exercised here: it is a runes module and cannot be
 * bundled by esbuild alone. That is precisely why the cache logic lives in a plain `.ts`
 * sibling — the store's only job is to call `convertCached` / `restoreConverted`.
 *
 * The contract under test:
 *   - a conversion's outputs land in the cache under `converted`, behind a pointer;
 *   - the same conversion again serves from disk and NEVER calls the converter;
 *   - a NEW TOOL VERSION does not serve the old output;
 *   - DIFFERENT INPUT FILES do not serve the old output (including the same file moved to a
 *     different input slot);
 *   - an EVICTED entry falls back to re-running, cleanly and invisibly;
 *   - a FAILING `put` does not fail the conversion, and leaves no pointer;
 *   - `restoreConverted` puts a title back after a reload, and refuses to half-restore one.
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
const out = mkdtempSync(join(tmpdir(), "gnw-convcache-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [
    join(here, "../src/lib/sources/blobCache.ts"),
    join(here, "../src/lib/sources/convertedCache.ts"),
  ],
  outdir: out,
  outbase: join(here, "../src/lib"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const load = async (n) => import(pathToFileURL(join(out, n)).href);
const { BlobCache, blobKey } = await load("sources/blobCache.js");
const { convertCached, restoreConverted, conversionSignature } = await load("sources/convertedCache.js");

// --- Fakes ------------------------------------------------------------------------------

function makeCache() {
  const files = new Map();
  const refuse = { all: false };
  const backend = {
    available: true,
    async list() { return [...files.keys()]; },
    async stat(name) { return files.has(name) ? files.get(name).length : null; },
    async read(name) { return files.has(name) ? files.get(name) : null; },
    async write(name, b) { if (refuse.all) return false; files.set(name, b.slice()); return true; },
    async remove(name) { files.delete(name); },
  };
  const quota = {
    estimate: async () => ({ usage: 0, quota: 100 }),
    persisted: async () => false,
    persist: async () => false,
  };
  return { files, refuse, cache: new BlobCache({ backend, quota }) };
}

/** The localStorage-backed pointer, faked as a plain Map (same shape `artifacts.ts` injects). */
function makeIndex() {
  const map = new Map();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, e) => { map.set(k, e); },
    entries: () => [...map.entries()],
  };
}

const filler = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const names = (files) => [...files.keys()];

const ART = filler(128, 1);
const ART_HASH = await blobKey(ART);
const OUT = filler(256, 7);
const OUT_HASH = await blobKey(OUT);
const ROM = filler(512, 3);
const ROM2 = filler(512, 4);

const TOOL_HASH = "a".repeat(64);

function title(opts = {}) {
  return {
    key: "own/repo#zelda3",
    repo: "own/repo",
    targetId: "zelda3",
    tool: { binary: { url: "https://x/t.wasm", bytes: 10, sha256: opts.tool ?? TOOL_HASH } },
    target: {
      artifacts: opts.noArtifacts
        ? []
        : [{ filename: "zelda3.bin", url: "https://x/z.bin", bytes: ART.length, sha256: opts.artHash ?? ART_HASH }],
    },
  };
}

const offered = (bytes = ROM, inputId = "base") => [{ inputId, filename: "z.sfc", bytes }];

/** A converter that counts its calls, so "did it re-run?" is an assertion. */
function counting(files) {
  const state = { calls: 0 };
  state.fn = async () => {
    state.calls++;
    return {
      files: new Map(files ?? [["zelda3.bin", OUT]]),
      warnings: ["a warning"],
      unrecognised: ["odd.sfc"],
    };
  };
  return state;
}

// --- 1. Cold run -------------------------------------------------------------------------

await check("cold: the conversion runs, and its output is stored under `converted`", async () => {
  const { cache, files } = makeCache();
  const index = makeIndex();
  const conv = counting();
  const res = await convertCached(title(), offered(), conv.fn, { cache, index });
  eq(conv.calls, 1, "the converter ran");
  bytesEq(res.files.get("zelda3.bin"), OUT, "the run's own bytes came back");
  eq(names(files).length, 1, "one blob stored");
  eq(names(files)[0], `converted.${OUT_HASH}`, "filed under `converted`, keyed by its own hash");
  const entry = index.map.get("own/repo#zelda3");
  ok(entry, "a pointer was recorded");
  eq(entry.files["zelda3.bin"], OUT_HASH, "the pointer names the output's hash");
  eq(entry.tool, TOOL_HASH, "and the tool version it was produced by");
});

// --- 2. Warm run: a reload does NOT re-run the converter ---------------------------------

await check("warm: the same conversion serves from disk and the converter is NEVER called", async () => {
  const { cache, index } = { ...makeCache(), index: makeIndex() };
  const store = makeCache();
  const idx = makeIndex();
  const first = counting();
  await convertCached(title(), offered(), first.fn, { cache: store.cache, index: idx });
  eq(first.calls, 1, "first run converted");

  // A reload: the store's in-memory Map is gone, the cache and the pointer survive.
  const second = counting();
  const res = await convertCached(title(), offered(), second.fn, { cache: store.cache, index: idx });
  eq(second.calls, 0, "the converter was NOT called");
  bytesEq(res.files.get("zelda3.bin"), OUT, "the cached output came back intact");
  eq(res.warnings[0], "a warning", "and the run's notices with it");
  eq(res.unrecognised[0], "odd.sfc", "including the unrecognised-file list");
  ok(cache && index, "fakes constructed");
});

// --- 3. Staleness ------------------------------------------------------------------------

await check("stale: a NEW TOOL VERSION does not serve the old output", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  const first = counting();
  await convertCached(title(), offered(), first.fn, { cache, index });
  const NEWOUT = filler(256, 9);
  const second = counting([["zelda3.bin", NEWOUT]]);
  const res = await convertCached(title({ tool: "b".repeat(64) }), offered(), second.fn, { cache, index });
  eq(second.calls, 1, "the converter re-ran for the new tool");
  bytesEq(res.files.get("zelda3.bin"), NEWOUT, "and the NEW output was returned");
});

await check("stale: DIFFERENT INPUT FILES do not serve the old output", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  await convertCached(title(), offered(ROM), counting().fn, { cache, index });
  const NEWOUT = filler(256, 12);
  const second = counting([["zelda3.bin", NEWOUT]]);
  const res = await convertCached(title(), offered(ROM2), second.fn, { cache, index });
  eq(second.calls, 1, "a different ROM re-ran the converter");
  bytesEq(res.files.get("zelda3.bin"), NEWOUT, "and returned its own output");
});

await check("stale: the SAME file in a different input slot is a different conversion", async () => {
  const a = await conversionSignature(title(), offered(ROM, "base"));
  const b = await conversionSignature(title(), offered(ROM, "language"));
  ok(a && b && a !== b, "the input id is bound into the signature");
});

await check("stale: a title with no tool is never cached at all", async () => {
  const { cache, files } = makeCache();
  const index = makeIndex();
  const t = title();
  delete t.tool;
  const conv = counting();
  await convertCached(t, offered(), conv.fn, { cache, index });
  eq(conv.calls, 1, "it ran");
  eq(files.size, 0, "nothing stored");
  eq(index.map.size, 0, "and no pointer");
});

// --- 4. Misses are invisible --------------------------------------------------------------

await check("miss: an evicted entry falls back to re-running, cleanly", async () => {
  const { cache, files } = makeCache();
  const index = makeIndex();
  await convertCached(title(), offered(), counting().fn, { cache, index });
  files.clear(); // eviction: the browser may do this at any time, without asking
  const again = counting();
  const res = await convertCached(title(), offered(), again.fn, { cache, index });
  eq(again.calls, 1, "re-ran rather than failing");
  bytesEq(res.files.get("zelda3.bin"), OUT, "and produced the output");
});

await check("miss: a cached output whose content no longer matches its key is re-run", async () => {
  const { cache, files } = makeCache();
  const index = makeIndex();
  await convertCached(title(), offered(), counting().fn, { cache, index });
  files.set(`converted.${OUT_HASH}`, filler(256, 99)); // bit rot
  const again = counting();
  await convertCached(title(), offered(), again.fn, { cache, index });
  eq(again.calls, 1, "the corrupt entry did not satisfy the read");
});

await check("miss: a partially-evicted output set is not half-served", async () => {
  const { cache, files } = makeCache();
  const index = makeIndex();
  const two = [["a.bin", filler(16, 1)], ["b.bin", filler(16, 2)]];
  await convertCached(title(), offered(), counting(two).fn, { cache, index });
  eq(files.size, 2, "both outputs stored");
  files.delete(names(files)[1]); // one of them goes
  const again = counting(two);
  await convertCached(title(), offered(), again.fn, { cache, index });
  eq(again.calls, 1, "the whole set was re-run rather than serving half of it");
});

await check("miss: a refused put does not fail the conversion, and leaves no pointer", async () => {
  const { cache, refuse, files } = makeCache();
  const index = makeIndex();
  refuse.all = true; // a full disk
  const conv = counting();
  const res = await convertCached(title(), offered(), conv.fn, { cache, index });
  bytesEq(res.files.get("zelda3.bin"), OUT, "the conversion succeeded regardless");
  eq(files.size, 0, "nothing stored");
  eq(index.map.size, 0, "and NO pointer to an entry that was never written");
});

await check("miss: an index that throws is just a miss", async () => {
  const { cache } = makeCache();
  const index = { get() { throw new Error("boom"); }, set() { throw new Error("boom"); }, entries() { throw new Error("boom"); } };
  const conv = counting();
  const res = await convertCached(title(), offered(), conv.fn, { cache, index });
  eq(conv.calls, 1, "it converted");
  bytesEq(res.files.get("zelda3.bin"), OUT, "and returned the output");
  eq((await restoreConverted([title()], { cache, index })).length, 0, "restore reports nothing rather than throwing");
});

// --- 5. Restore on load --------------------------------------------------------------------

await check("restore: a reload puts back artifacts AND converted output", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  await cache.put(ART_HASH, ART, "artifact"); // the artifact half, cached by installArtifacts
  await convertCached(title(), offered(), counting().fn, { cache, index });

  const got = await restoreConverted([title()], { cache, index });
  eq(got.length, 1, "the title was restored");
  eq(got[0].key, "own/repo#zelda3", "under its own key");
  eq(got[0].repo, "own/repo", "with its repo, for `supplied`");
  eq(JSON.stringify(got[0].inputs), JSON.stringify(["base"]), "and the input ids it was given");
  bytesEq(got[0].files.get("zelda3.bin"), OUT, "converted output wins over the artifact of the same name");
});

await check("restore: a new tool version restores nothing", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  await cache.put(ART_HASH, ART, "artifact");
  await convertCached(title(), offered(), counting().fn, { cache, index });
  const got = await restoreConverted([title({ tool: "c".repeat(64) })], { cache, index });
  eq(got.length, 0, "the entry was refused, so the title looks unprepared");
});

await check("restore: a republished artifact restores nothing (no half-prepared title)", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  await cache.put(ART_HASH, ART, "artifact");
  await convertCached(title(), offered(), counting().fn, { cache, index });
  // The manifest now names a different engine build, whose bytes were never cached.
  const got = await restoreConverted([title({ artHash: "d".repeat(64) })], { cache, index });
  eq(got.length, 0, "artifacts come from the LIVE manifest, so a republish misses");
});

await check("restore: an evicted converted output restores nothing", async () => {
  const { cache, files } = makeCache();
  const index = makeIndex();
  await cache.put(ART_HASH, ART, "artifact");
  await convertCached(title(), offered(), counting().fn, { cache, index });
  files.delete(`converted.${OUT_HASH}`);
  eq((await restoreConverted([title()], { cache, index })).length, 0, "no partial restore");
});

await check("restore: a title with no entry is simply absent", async () => {
  const { cache } = makeCache();
  eq((await restoreConverted([title()], { cache, index: makeIndex() })).length, 0, "nothing cached, nothing restored");
});

// --- 6. runPerFile: one entry per title, FILES ACCUMULATED --------------------------------
//
// The Library prepares ONE game per press. A replacing write meant preparing the second game
// dropped the pointer to the first — invisible in memory (`assets` merges) and only surfacing
// after a reload, as the first game quietly needing Prepare again.

await check("perFile: preparing a second game keeps the first game's pointer", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  const A = filler(64, 21);
  const B = filler(64, 22);

  await convertCached(title(), offered(ROM), counting([["The Ultimate Doom.whd", A]]).fn, { cache, index });
  await convertCached(title(), offered(ROM2), counting([["Doom II.whd", B]]).fn, { cache, index });

  const entry = index.get("own/repo#zelda3");
  eq(Object.keys(entry.files).length, 2, "BOTH games are pointed at, not just the last one");
  eq(entry.files["The Ultimate Doom.whd"], await blobKey(A), "the first game survived the second press");
  eq(entry.files["Doom II.whd"], await blobKey(B), "and the second is there too");
});

await check("perFile: a reload restores every game prepared, not just the newest", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  const A = filler(64, 31);
  const B = filler(64, 32);
  // The artifact the title also ships — `restoreConverted` is all-or-nothing and reads it live.
  await cache.put(ART_HASH, ART, "artifact");

  await convertCached(title(), offered(ROM), counting([["one.whd", A]]).fn, { cache, index });
  await convertCached(title(), offered(ROM2), counting([["two.whd", B]]).fn, { cache, index });

  const restored = await restoreConverted([title()], { cache, index });
  eq(restored.length, 1, "the title came back");
  ok(restored[0].files.has("one.whd"), "THE RELOAD BUG: the first game is still prepared");
  ok(restored[0].files.has("two.whd"), "and so is the second");
});

await check("perFile: a NEW TOOL BUILD starts fresh instead of mixing with the old output", async () => {
  const { cache } = makeCache();
  const index = makeIndex();
  await convertCached(title(), offered(ROM), counting([["old.whd", filler(64, 41)]]).fn, { cache, index });
  await convertCached(
    title({ tool: "b".repeat(64) }),
    offered(ROM2),
    counting([["new.whd", filler(64, 42)]]).fn,
    { cache, index },
  );

  const entry = index.get("own/repo#zelda3");
  eq(Object.keys(entry.files).length, 1, "the old build's output is not carried forward");
  ok(entry.files["new.whd"], "only the new build's");
  eq(entry.tool, "b".repeat(64), "and the entry names the build that produced it");
});

console.log(`\nconvertedcache: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
