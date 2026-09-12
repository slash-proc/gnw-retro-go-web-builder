#!/usr/bin/env node
/**
 * Offline coverage for the THREE call sites wired onto `src/lib/sources/blobCache.ts`:
 *
 *   - `sources/installArtifacts.ts`  — source artifacts, keyed by the manifest's own sha256.
 *   - `sources/converter.ts`         — the converter wasm module, keyed by `tool.binary.sha256`.
 *   - `artifacts.ts`                 — each firmware build's bundle zip, keyed by the sha256
 *                                      the distribution manifest publishes for it.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/cachewire.mjs'
 *
 * Plain node, no framework (repo convention). The storage layer is the REAL `BlobCache` over a
 * fake in-memory backend — the same injection `test/blobcache.mjs` uses — because the property
 * these call sites lean on is the cache's own re-hash-on-read, and a hand-written stub of it
 * would test the stub. The network is a counting fake, so "did this actually skip the download?"
 * is an assertion rather than a hope.
 *
 * The contract under test, for each site:
 *   - a COLD fetch downloads, and stores the bytes under the right category;
 *   - a WARM fetch serves from the cache and makes NO network call at all (calls are counted);
 *   - a MISS (eviction) falls back to the network rather than failing;
 *   - a cached entry whose content no longer matches its key is REFETCHED, never used;
 *   - a `put` the backend refuses does not fail the operation.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

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
const out = mkdtempSync(join(tmpdir(), "gnw-cachewire-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [
    join(here, "../src/lib/sources/blobCache.ts"),
    join(here, "../src/lib/sources/installArtifacts.ts"),
    join(here, "../src/lib/sources/converter.ts"),
    join(here, "../src/lib/artifacts.ts"),
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
const { fetchTargetArtifacts } = await load("sources/installArtifacts.js");
const { fetchConverterBinary } = await load("sources/converter.js");
const { fetchBundle } = await load("artifacts.js");

// --- Fakes -----------------------------------------------------------------------------------

/** The same in-memory backend shape `test/blobcache.mjs` uses, plus a write-refusal switch. */
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

const filler = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

/** Names held by the fake backend, so a test can assert the CATEGORY prefix a write used. */
const names = (files) => [...files.keys()];

// --- 1. Source artifacts -----------------------------------------------------------------

const ART = filler(512, 1);
const ART_HASH = await blobKey(ART);
function artTarget() {
  return { artifacts: [{ filename: "engine.bin", url: "https://x/engine.bin", bytes: ART.length, sha256: ART_HASH }] };
}
function countingArtifactFetch(bytes) {
  const state = { calls: 0 };
  state.fn = async () => { state.calls++; return (bytes ?? ART).slice(); };
  return state;
}

await check("artifacts: a cold fetch downloads and stores under the artifact category", async () => {
  const { cache, files } = makeCache();
  const net = countingArtifactFetch();
  const got = await fetchTargetArtifacts(artTarget(), { cache, fetch: net.fn });
  bytesEq(got.get("engine.bin"), ART, "returned the downloaded bytes");
  eq(net.calls, 1, "one network call");
  eq(names(files).length, 1, "one entry stored");
  eq(names(files)[0], `artifact.${ART_HASH}`, "filed under `artifact`, keyed by the manifest sha256");
});

await check("artifacts: a warm fetch serves from cache and makes NO network call", async () => {
  const { cache } = makeCache();
  await cache.put(ART_HASH, ART, "artifact");
  const net = countingArtifactFetch();
  const got = await fetchTargetArtifacts(artTarget(), { cache, fetch: net.fn });
  bytesEq(got.get("engine.bin"), ART, "served the cached bytes");
  eq(net.calls, 0, "the network was never touched");
});

await check("artifacts: an evicted entry falls back to the network", async () => {
  const { cache, files } = makeCache();
  await cache.put(ART_HASH, ART, "artifact");
  files.clear(); // eviction: the browser may do this at any time, without asking
  const net = countingArtifactFetch();
  const got = await fetchTargetArtifacts(artTarget(), { cache, fetch: net.fn });
  bytesEq(got.get("engine.bin"), ART, "still got the bytes");
  eq(net.calls, 1, "refetched");
});

await check("artifacts: a cached entry that fails verification is refetched, never used", async () => {
  const { cache, files } = makeCache();
  await cache.put(ART_HASH, ART, "artifact");
  // Content that no longer hashes to its key — bit rot, or bytes nobody wrote.
  files.set(`artifact.${ART_HASH}`, filler(512, 99));
  const net = countingArtifactFetch();
  const got = await fetchTargetArtifacts(artTarget(), { cache, fetch: net.fn });
  eq(net.calls, 1, "the corrupt entry did not satisfy the read");
  bytesEq(got.get("engine.bin"), ART, "and the good bytes came from the network");
});

await check("artifacts: a refused put does not fail the fetch", async () => {
  const { cache, refuse, files } = makeCache();
  refuse.all = true; // a full disk
  const net = countingArtifactFetch();
  const got = await fetchTargetArtifacts(artTarget(), { cache, fetch: net.fn });
  bytesEq(got.get("engine.bin"), ART, "the install proceeds regardless");
  eq(files.size, 0, "and nothing was stored");
});

await check("artifacts: a cache hit still faces the manifest's own length check", async () => {
  const { cache } = makeCache();
  await cache.put(ART_HASH, ART, "artifact");
  const target = artTarget();
  target.artifacts[0].bytes = ART.length + 1; // manifest and content disagree
  let code = null;
  try {
    await fetchTargetArtifacts(target, { cache, fetch: countingArtifactFetch().fn });
  } catch (e) { code = e.code; }
  eq(code, "artifact-size-mismatch", "cached bytes are verified exactly as downloaded ones are");
});

// --- 2. Converter modules ------------------------------------------------------------------

const WASM = filler(300, 5);
const WASM_HASH = await blobKey(WASM);
const tool = () => ({
  id: "t", title: {}, limits: {}, inputs: [], outputs: [],
  binary: { url: "https://x/t.wasm", bytes: WASM.length, sha256: WASM_HASH },
});

await check("converter: a cold fetch downloads and stores under the converter category", async () => {
  const { cache, files } = makeCache();
  const net = countingArtifactFetch(WASM);
  const got = await fetchConverterBinary(tool(), { cache, fetch: net.fn });
  bytesEq(got, WASM, "returned the module bytes");
  eq(net.calls, 1, "one network call");
  eq(names(files)[0], `converter.${WASM_HASH}`, "filed under `converter`, keyed by binary.sha256");
});

await check("converter: a warm fetch serves from cache and makes NO network call", async () => {
  const { cache } = makeCache();
  await cache.put(WASM_HASH, WASM, "converter");
  const net = countingArtifactFetch(WASM);
  bytesEq(await fetchConverterBinary(tool(), { cache, fetch: net.fn }), WASM, "served from cache");
  eq(net.calls, 0, "the network was never touched");
});

await check("converter: an evicted entry falls back to the network", async () => {
  const { cache, files } = makeCache();
  await cache.put(WASM_HASH, WASM, "converter");
  files.clear();
  const net = countingArtifactFetch(WASM);
  bytesEq(await fetchConverterBinary(tool(), { cache, fetch: net.fn }), WASM, "refetched intact");
  eq(net.calls, 1, "refetched");
});

await check("converter: a corrupted entry is refetched, never instantiated", async () => {
  const { cache, files } = makeCache();
  await cache.put(WASM_HASH, WASM, "converter");
  files.set(`converter.${WASM_HASH}`, filler(300, 77));
  const net = countingArtifactFetch(WASM);
  bytesEq(await fetchConverterBinary(tool(), { cache, fetch: net.fn }), WASM, "good bytes returned");
  eq(net.calls, 1, "the corrupt entry did not satisfy the read");
});

await check("converter: a refused put does not fail the fetch", async () => {
  const { cache, refuse } = makeCache();
  refuse.all = true;
  const net = countingArtifactFetch(WASM);
  bytesEq(await fetchConverterBinary(tool(), { cache, fetch: net.fn }), WASM, "run proceeds");
});

await check("converter: a cache hit still faces the manifest's own size check", async () => {
  const { cache } = makeCache();
  await cache.put(WASM_HASH, WASM, "converter");
  const t = tool();
  t.binary.bytes = WASM.length + 1;
  let code = null;
  try { await fetchConverterBinary(t, { cache, fetch: countingArtifactFetch(WASM).fn }); }
  catch (e) { code = e.code; }
  eq(code, "binary-hash", "cached bytes are verified exactly as downloaded ones are");
});

// --- 3. Firmware bundle -----------------------------------------------------------------

/** A minimal STORED-mode zip, so the real `unzip.ts` runs without a compressor. */
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function zip(entries) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, data] of entries) {
    const n = enc.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + n.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    lh.set(n, 30);
    const ch = new Uint8Array(46 + n.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true); cv.setUint32(42, off, true);
    ch.set(n, 46);
    locals.push(lh, data); centrals.push(ch);
    off += lh.length + data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}

const IMAGE = filler(64, 11);
const FONT = new TextEncoder().encode("font bytes");
const ZIP = zip([
  ["gw_retro_go_intflash.bin", IMAGE],
  ["fonts/cp1252_serif.bin", FONT],
]);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const ZIP_HASH = sha(ZIP);
const BUNDLE_URL = "https://example.invalid/dist/v9.9.9/retro-go-sd-flash-bank1.zip";
const VERSIONS_URL = "https://example.invalid/dist/versions.json";

/**
 * A one-build-per-combination release. Every build serves the SAME zip, so the four cache keys
 * collapse to one — the point here is the cache wiring, not the per-build mapping (that lives
 * in `test/firmwarecutover.mjs`).
 */
function release() {
  const builds = [];
  for (const id of ["flash-bank1", "flash-bank2", "sd-bank1", "sd-bank2"]) {
    const [storage, bankTag] = id.split("-");
    const bank = Number(bankTag.slice(4));
    const build = {
      id, storage, bank,
      capabilities: [],
      littlefsBlockSize: 4096,
      buildFlags: "make",
      bundle: { bytes: ZIP.length, sha256: ZIP_HASH, url: "retro-go-sd-flash-bank1.zip" },
      debug: { bytes: ZIP.length, sha256: ZIP_HASH, url: "retro-go-sd-flash-bank1-debug.zip" },
      image: { path: "gw_retro_go_intflash.bin", bytes: IMAGE.length, sha256: sha(IMAGE) },
      content: [{ path: "fonts/cp1252_serif.bin", install: "fonts/cp1252_serif.bin", bytes: FONT.length, sha256: sha(FONT) }],
    };
    if (storage === "sd") {
      build.sdUpdate = { path: "gw_retro_go_intflash.bin", bytes: IMAGE.length, sha256: sha(IMAGE), filename: `update_bank${bank}.bin` };
    }
    builds.push(build);
  }
  return {
    schemaVersion: 1, project: "retro-go-sd", title: "Retro-Go SD",
    source: { repo: "slash-proc/game-and-watch-retro-go-sd", commit: "1dfd6f95b478ac56c37e3ccb35d41dd365fa42cb", ref: "v9.9.9" },
    firmware: {
      gitTag: "Retro-Go SD v1.4.1-124-g1dfd6f95b+",
      providesAbi: { version: 2, size: 844 },
      abiOffset: "0x400", coreMetaVersion: 3,
      superblock: { magic: "GWLB", version: 2, structSize: 36 },
      installFile: { path: "data/INSTALL", magic: "RGIN", version: 1 },
    },
    paths: { data: "/data" }, languages: ["en_us"], builds, builtAt: "2026-09-08T19:33:37Z",
  };
}
const VERSIONS_DOC = {
  schemaVersion: 1, project: "retro-go-sd", title: "Retro-Go SD",
  repo: "slash-proc/game-and-watch-retro-go-sd",
  releasesUrl: "https://github.com/slash-proc/game-and-watch-retro-go-sd/releases",
  retained: 5,
  versions: [{
    tag: "v9.9.9", manifest: "v9.9.9/manifest.json", publishedAt: "2026-09-08T19:33:37Z",
    prerelease: false, gitTag: "Retro-Go SD v1.4.1-124-g1dfd6f95b+",
    providesAbi: { version: 2, size: 844 }, coreMetaVersion: 3,
  }],
};

/** JSON discovery is a fixed fake; only the ZIP fetch is counted. */
const jsonFetch = async (url) => ({
  ok: true, status: 200, headers: { get: () => null },
  async text() { return JSON.stringify(url === VERSIONS_URL ? VERSIONS_DOC : release()); },
});
function countingZipFetch(bytes) {
  const state = { calls: 0 };
  state.fn = async () => {
    state.calls++;
    return { ok: true, headers: { get: () => null }, body: null, arrayBuffer: async () => (bytes ?? ZIP).slice().buffer };
  };
  return state;
}
const bundleDeps = (cache, net) => ({ cache, fetchZip: net.fn, fetchImpl: jsonFetch, versionsUrl: VERSIONS_URL });

await check("bundle: a cold fetch downloads and caches under the PUBLISHED sha256", async () => {
  const { cache, files } = makeCache();
  const net = countingZipFetch();
  const b = await fetchBundle("v9.9.9", undefined, bundleDeps(cache, net));
  bytesEq(b.blobs[1], IMAGE, "unzipped the bank1 image");
  // All four builds declare the same sha256 here, so the first download satisfies the
  // other three straight out of the cache — content addressing, working as intended.
  eq(net.calls, 1, "the shared zip was downloaded exactly once");
  eq(names(files).length, 1, "the four builds share one zip here, so one entry");
  eq(names(files)[0], `firmware.${ZIP_HASH}`, "filed under `firmware`, keyed by the manifest's own sha256");
});

await check("bundle: a warm fetch serves from cache and makes NO network call", async () => {
  const { cache } = makeCache();
  await cache.put(ZIP_HASH, ZIP, "firmware");
  const net = countingZipFetch();
  const b = await fetchBundle("v9.9.9", undefined, bundleDeps(cache, net));
  bytesEq(b.blobs[2], IMAGE, "unzipped bank2 from the cached zip");
  eq(net.calls, 0, "the network was never touched");
});

await check("bundle: a warm fetch still finishes the progress counter", async () => {
  const { cache } = makeCache();
  await cache.put(ZIP_HASH, ZIP, "firmware");
  const seen = [];
  await fetchBundle("v9.9.9", (d, t) => seen.push([d, t]), bundleDeps(cache, countingZipFetch()));
  const total = ZIP.length * 4;
  eq(seen[0][0], 0, "the counter starts at a real 0%");
  eq(JSON.stringify(seen[seen.length - 1]), JSON.stringify([total, total]), "counter reaches 100%");
});

await check("bundle: an evicted entry falls back to the network", async () => {
  const { cache, files } = makeCache();
  await cache.put(ZIP_HASH, ZIP, "firmware");
  files.clear(); // eviction: the browser may do this at any time, without asking
  const net = countingZipFetch();
  const b = await fetchBundle("v9.9.9", undefined, bundleDeps(cache, net));
  bytesEq(b.blobs[1], IMAGE, "still got the bundle");
  ok(net.calls > 0, "refetched");
});

await check("bundle: a corrupted cached zip is refetched, never unzipped", async () => {
  const { cache, files } = makeCache();
  await cache.put(ZIP_HASH, ZIP, "firmware");
  files.set(`firmware.${ZIP_HASH}`, filler(ZIP.length, 66));
  const net = countingZipFetch();
  const b = await fetchBundle("v9.9.9", undefined, bundleDeps(cache, net));
  bytesEq(b.blobs[1], IMAGE, "good bundle returned");
  ok(net.calls > 0, "the corrupt entry did not satisfy the read");
});

await check("bundle: a refused put does not fail the download", async () => {
  const { cache, refuse, files } = makeCache();
  refuse.all = true;
  const b = await fetchBundle("v9.9.9", undefined, bundleDeps(cache, countingZipFetch()));
  bytesEq(b.blobs[1], IMAGE, "the download succeeded regardless");
  eq(files.size, 0, "nothing stored");
});

await check("bundle: downloaded bytes that fail the published sha256 are refused", async () => {
  const { cache } = makeCache();
  const net = countingZipFetch(filler(ZIP.length, 5));
  let err = null;
  try { await fetchBundle("v9.9.9", undefined, bundleDeps(cache, net)); } catch (e) { err = e; }
  ok(err && /bundle-hash/.test(err.message), "the hash gate rejected them before the unzip");
});

console.log(`\ncachewire: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
