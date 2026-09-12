#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/artifacts.ts` AFTER the cutover onto the firmware
 * distribution format — the adapter that keeps `listVersions()` / `fetchBundle()` /
 * `FirmwareBundle` working for their four consumers while everything underneath moved to
 * `dist/versions.json` on GitHub Pages, four per-build bundle zips, and real published
 * sha256s.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/firmwarecutover.mjs'
 *
 * Plain node, no framework (repo convention). The network is a counting fake injected through
 * `BundleFetchDeps`, so "which URLs did this actually fetch?" is an assertion rather than a
 * hope — which is how the "no code path calls the CORS worker" check is a check and not a
 * comment.
 *
 * `test/fixtures/firmwaredist/versions.json` is a VERBATIM copy of the firmware repo's
 * published example (see SOURCE.md there) and is served unmodified by the discovery tests.
 * The bundle tests need zips that do not exist on disk, so they synthesize a manifest and its
 * four archives IN MEMORY — nothing in the fixture directory is ever written or edited.
 *
 * What is pinned:
 *   - the version list comes from `versions.json`, in the file's own newest-first order
 *   - all four bank/storage combinations resolve to their own build's image and content
 *   - `contentFor()` THROWS for a combination the release does not publish (never falls back)
 *   - a bundle whose bytes fail their published sha256 is refused, and never unzipped
 *   - the bundle cache is keyed by the PUBLISHED hash, so a warm fetch makes no network call
 *   - no request, and no line of `artifacts.ts`, reaches the CORS worker or the Releases API
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { LOCALES } from "./locales.mjs";

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
async function rejects(fn, msg) {
  try { await fn(); } catch (e) { return e; }
  throw new Error(`${msg}: expected a rejection, got a value`);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures/firmwaredist");
const out = mkdtempSync(join(tmpdir(), "gnw-fwcutover-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [
    join(here, "../src/lib/artifacts.ts"),
    join(here, "../src/lib/sources/blobCache.ts"),
    join(here, "../src/lib/firmwareDist/compare.ts"),
    // The shared discovery memo and the OTHER walker of the same two documents. Listed as
    // entry points of the SAME build so `splitting` gives them one shared module instance —
    // two separate bundles would each get their own memo and the sharing check below would
    // pass without proving anything.
    join(here, "../src/lib/firmwareDist/curated.ts"),
    join(here, "../src/lib/firmwareDist/memo.ts"),
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
const { listVersions, fetchBundle } = await load("artifacts.js");
const { BlobCache } = await load("sources/blobCache.js");
const { versionToken, sameVersion, versionRelation, isUpgrade, installTitleState } = await load("firmwareDist/compare.js");
const { curatedProjects, resetCuratedProjects } = await load("firmwareDist/curated.js");
const { resetFirmwareMemo } = await load("firmwareDist/memo.js");

const VERSIONS_URL = "https://example.invalid/dist/versions.json";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const filler = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const enc = new TextEncoder();

// --- An in-memory cache over the same fake backend `test/blobcache.mjs` uses ------------------

function makeCache() {
  const files = new Map();
  const backend = {
    available: true,
    async list() { return [...files.keys()]; },
    async stat(name) { return files.has(name) ? files.get(name).length : null; },
    async read(name) { return files.has(name) ? files.get(name) : null; },
    async write(name, b) { files.set(name, b.slice()); return true; },
    async remove(name) { files.delete(name); },
  };
  const quota = { estimate: async () => ({ usage: 0, quota: 100 }), persisted: async () => false, persist: async () => false };
  return { files, cache: new BlobCache({ backend, quota }) };
}

// --- A minimal STORED-mode zip, so the real `unzip.ts` runs without a compressor -------------

function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function zip(entries) {
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
  const buf = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}

// --- A synthetic four-build release, declared exactly as the format requires -----------------

const IMAGE_PATH = "gw_retro_go_intflash.bin";

/** Build one release: four bundle zips plus the manifest that declares them. */
function makeRelease(combos = ["flash-bank1", "flash-bank2", "sd-bank1", "sd-bank2"]) {
  const zips = new Map(); // url -> bytes
  const builds = [];
  for (const id of combos) {
    const [storage, bankTag] = id.split("-");
    const bank = Number(bankTag.slice(4));
    // Every build's bytes differ, so a test that reads the wrong build's tree fails loudly.
    const image = filler(96, id.length * 7 + bank * (storage === "sd" ? 3 : 5));
    const font = enc.encode(`font for ${id}`);
    const lang = enc.encode(`de_de blob for ${id}`);
    const entries = [
      [IMAGE_PATH, image],
      ["fonts/cp1252_serif.bin", font],
      ["lang/de_de.bin", lang],
    ];
    const bytes = zip(entries);
    const url = `https://example.invalid/dist/v9.9.9/retro-go-sd-${id}.zip`;
    zips.set(url, bytes);
    const content = [
      { path: "fonts/cp1252_serif.bin", install: "fonts/cp1252_serif.bin", bytes: font.length, sha256: sha256(font) },
      { path: "lang/de_de.bin", install: "lang/de_de.bin", bytes: lang.length, sha256: sha256(lang), language: "de_de" },
    ];
    const build = {
      id,
      storage,
      bank,
      capabilities: [storage === "sd" ? "sdCard" : "coverflow"],
      littlefsBlockSize: 4096,
      buildFlags: `make SD_CARD=${storage === "sd" ? 1 : 0} INTFLASH_BANK=${bank}`,
      bundle: { bytes: bytes.length, sha256: sha256(bytes), url: `retro-go-sd-${id}.zip` },
      debug: { bytes: 4, sha256: sha256(enc.encode("elf!")), url: `retro-go-sd-${id}-debug.zip` },
      image: { path: IMAGE_PATH, bytes: image.length, sha256: sha256(image) },
      content,
    };
    if (storage === "sd") {
      build.sdUpdate = { path: IMAGE_PATH, bytes: image.length, sha256: sha256(image), filename: `update_bank${bank}.bin` };
    }
    builds.push(build);
  }
  const manifest = {
    schemaVersion: 1,
    project: "retro-go-sd",
    title: "Retro-Go SD",
    source: { repo: "slash-proc/game-and-watch-retro-go-sd", commit: "1dfd6f95b478ac56c37e3ccb35d41dd365fa42cb", ref: "v9.9.9" },
    firmware: {
      gitTag: "Retro-Go SD v1.4.1-124-g1dfd6f95b+",
      providesAbi: { version: 2, size: 844 },
      abiOffset: "0x400",
      coreMetaVersion: 3,
      superblock: { magic: "GWLB", version: 2, structSize: 36 },
      installFile: { path: "data/INSTALL", magic: "RGIN", version: 1 },
    },
    paths: { cores: "/cores", data: "/data" },
    languages: ["de_de", "en_us"],
    builds,
    builtAt: "2026-09-08T19:33:37Z",
  };
  const versions = {
    schemaVersion: 1,
    project: "retro-go-sd",
    title: "Retro-Go SD",
    repo: "slash-proc/game-and-watch-retro-go-sd",
    releasesUrl: "https://github.com/slash-proc/game-and-watch-retro-go-sd/releases",
    retained: 5,
    versions: [
      {
        tag: "v9.9.9",
        manifest: "v9.9.9/manifest.json",
        publishedAt: "2026-09-08T19:33:37Z",
        prerelease: false,
        gitTag: "Retro-Go SD v1.4.1-124-g1dfd6f95b+",
        providesAbi: { version: 2, size: 844 },
        coreMetaVersion: 3,
      },
    ],
  };
  return { zips, manifest, versions };
}

/**
 * A fake network over a release. `urls` records EVERY request, in order — that record is what
 * the CORS-worker assertion reads.
 */
function makeNet(release, mutate = (url, bytes) => bytes) {
  const urls = [];
  const json = (doc) => ({
    ok: true, status: 200,
    headers: { get: () => null },
    body: null,
    async text() { return JSON.stringify(doc); },
    async arrayBuffer() { return enc.encode(JSON.stringify(doc)).buffer; },
  });
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url === VERSIONS_URL) return json(release.versions);
    if (url.endsWith("/manifest.json")) return json(release.manifest);
    return { ok: false, status: 404, headers: { get: () => null }, body: null, async text() { return ""; } };
  };
  const fetchZip = async (url) => {
    urls.push(url);
    const bytes = release.zips.get(url);
    if (!bytes) return { ok: false, status: 404, headers: { get: () => null }, body: null, async arrayBuffer() { return new ArrayBuffer(0); } };
    const served = mutate(url, bytes);
    return { ok: true, status: 200, headers: { get: () => null }, body: null, async arrayBuffer() { return served.slice().buffer; } };
  };
  return { urls, fetchImpl, fetchZip };
}

const deps = (net, cache) => ({ fetchImpl: net.fetchImpl, fetchZip: net.fetchZip, cache, versionsUrl: VERSIONS_URL });

// --- 1. Discovery -----------------------------------------------------------------------------

const rawVersions = JSON.parse(readFileSync(join(fixtures, "versions.json"), "utf8"));

await check("versions: the list comes from versions.json, not the Releases API", async () => {
  const urls = [];
  const net = { fetchImpl: async (u) => { urls.push(u); return { ok: true, status: 200, headers: { get: () => null }, async text() { return JSON.stringify(rawVersions); } }; } };
  const got = await listVersions({ fetchImpl: net.fetchImpl, versionsUrl: VERSIONS_URL });
  eq(urls.length, 1, "exactly one request");
  eq(urls[0], VERSIONS_URL, "and it was versions.json");
  eq(got.length, rawVersions.versions.length, "one entry per published release");
  eq(got[0].tag, rawVersions.versions[0].tag, "tag carried through");
  eq(got[0].prerelease, rawVersions.versions[0].prerelease, "prerelease carried through");
  eq(got[0].publishedAt, rawVersions.versions[0].publishedAt, "publishedAt carried through");
  eq(got[0].name, rawVersions.versions[0].gitTag, "name is the entry's gitTag");
  eq(got[0].sha, "1dfd6f95b", "sha is the describe suffix of that gitTag");
});

await check("versions: the order is the file's own, newest first, never re-sorted", async () => {
  // The index publishes newest-first and has no `latest`; every consumer reads versions[0].
  // Entries deliberately ordered so any re-sort by tag or date would move them.
  const doc = JSON.parse(JSON.stringify(rawVersions));
  const first = doc.versions[0];
  doc.versions = [
    { ...first, tag: "v2.1.0", publishedAt: "2026-09-09T00:00:00Z" },
    { ...first, tag: "v3.0.0-rc1", publishedAt: "2026-01-01T00:00:00Z", prerelease: true },
    { ...first, tag: "v2.0.0", publishedAt: "2026-09-08T19:33:37Z" },
  ];
  const got = await listVersions({
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, async text() { return JSON.stringify(doc); } }),
    versionsUrl: VERSIONS_URL,
  });
  eq(got.map((v) => v.tag).join(","), "v2.1.0,v3.0.0-rc1,v2.0.0", "published order preserved verbatim");
});

// --- 2. The four bank/storage combinations ----------------------------------------------------

await check("bundle: every bank/storage combination resolves to its OWN build", async () => {
  const rel = makeRelease();
  const net = makeNet(rel);
  const { cache } = makeCache();
  const b = await fetchBundle("v9.9.9", undefined, deps(net, cache));

  const imageOf = (id) => {
    const build = rel.manifest.builds.find((x) => x.id === id);
    return { bytes: build.image.bytes, sha: build.image.sha256 };
  };
  for (const [got, id] of [[b.blobs[1], "flash-bank1"], [b.blobs[2], "flash-bank2"], [b.blobs.sd_1, "sd-bank1"], [b.blobs.sd_2, "sd-bank2"]]) {
    const want = imageOf(id);
    eq(sha256(got), want.sha, `blob for ${id} is that build's own image`);
  }
  // Four distinct images — a wrong mapping that happened to compile would collapse these.
  eq(new Set([b.blobs[1], b.blobs[2], b.blobs.sd_1, b.blobs.sd_2].map(sha256)).size, 4, "four distinct blobs");

  for (const [bank, sd, id] of [[1, false, "flash-bank1"], [2, false, "flash-bank2"], [1, true, "sd-bank1"], [2, true, "sd-bank2"]]) {
    const tree = b.contentFor(bank, sd);
    eq(tree.size, 2, `content tree for ${id} has both entries`);
    // Keyed by `install` (the device path), not by the zip entry name.
    ok(tree.has("fonts/cp1252_serif.bin") && tree.has("lang/de_de.bin"), `content keys for ${id} are install paths`);
    eq(new TextDecoder().decode(tree.get("lang/de_de.bin")), `de_de blob for ${id}`, `the language blob is ${id}'s own`);
  }
  eq(b.manifest.sha, rel.manifest.source.commit, "manifest sha is the source commit");
  eq(b.manifest.ref, "v9.9.9", "manifest ref is the source ref");
  eq(b.manifest.capabilities.join(","), "coverflow,sdCard", "capabilities are the union across builds");
});

await check("bundle: contentFor() THROWS for a combination the release does not publish", async () => {
  const rel = makeRelease(["flash-bank1", "flash-bank2"]);
  const net = makeNet(rel);
  const { cache } = makeCache();
  const b = await fetchBundle("v9.9.9", undefined, deps(net, cache));
  eq(b.blobs.sd_1, undefined, "no sd_1 blob");
  eq(b.blobs.sd_2, undefined, "no sd_2 blob");
  ok(b.contentFor(1, false).size === 2, "the published combination still resolves");
  for (const bank of [1, 2]) {
    let threw = false;
    try { b.contentFor(bank, true); } catch { threw = true; }
    ok(threw, `contentFor(${bank}, true) refuses rather than falling back to a flash tree`);
  }
});

await check("bundle: a release without both flash banks is refused outright", async () => {
  const rel = makeRelease(["flash-bank2", "sd-bank2"]);
  const net = makeNet(rel);
  const { cache } = makeCache();
  await rejects(() => fetchBundle("v9.9.9", undefined, deps(net, cache)), "missing bank1");
});

await check("bundle: an unknown tag is refused, not silently served the newest", async () => {
  const rel = makeRelease();
  const net = makeNet(rel);
  const { cache } = makeCache();
  await rejects(() => fetchBundle("v0.0.0", undefined, deps(net, cache)), "unknown tag");
  ok(!net.urls.some((u) => u.endsWith(".zip")), "and nothing was downloaded");
});

// --- 3. Real hashes -----------------------------------------------------------------------

await check("bundle: bytes that fail the PUBLISHED sha256 are refused, never unzipped", async () => {
  const rel = makeRelease();
  // One flipped byte in one build's zip. The bundle hash is checked before the archive opens.
  const net = makeNet(rel, (url, bytes) => {
    if (!url.endsWith("flash-bank2.zip")) return bytes;
    const bad = bytes.slice();
    bad[bad.length - 30] ^= 0xff;
    return bad;
  });
  const { cache } = makeCache();
  const err = await rejects(() => fetchBundle("v9.9.9", undefined, deps(net, cache)), "corrupt bundle");
  ok(/bundle-hash/.test(err.message), `the refusal names the reason: ${err.message}`);
  ok(/flash-bank2/.test(err.message), "and the build it applies to");
});

await check("bundle: the cache is keyed by the published hash — a warm fetch touches no network", async () => {
  const rel = makeRelease();
  const { cache, files } = makeCache();
  const cold = makeNet(rel);
  await fetchBundle("v9.9.9", undefined, deps(cold, cache));
  const stored = [...files.keys()].sort();
  eq(stored.length, 4, "one cache entry per build bundle");
  for (const build of rel.manifest.builds) {
    ok(stored.includes(`firmware.${build.bundle.sha256}`), `${build.id} filed under its PUBLISHED sha256`);
  }
  const warm = makeNet(rel);
  const b = await fetchBundle("v9.9.9", undefined, deps(warm, cache));
  eq(warm.urls.filter((u) => u.endsWith(".zip")).length, 0, "no zip was downloaded a second time");
  eq(sha256(b.blobs[1]), rel.manifest.builds[0].image.sha256, "and the blobs still came out right");
});

await check("bundle: the progress counter runs to the manifest's total across all four bundles", async () => {
  const rel = makeRelease();
  const net = makeNet(rel);
  const { cache } = makeCache();
  const seen = [];
  await fetchBundle("v9.9.9", (d, t) => seen.push([d, t]), deps(net, cache));
  const total = rel.manifest.builds.reduce((s, b) => s + b.bundle.bytes, 0);
  ok(seen.length > 0, "the counter reported at all");
  ok(seen.every(([, t]) => t === total), "against the total the manifest publishes");
  eq(seen[seen.length - 1][0], total, "and it reaches 100%");
  ok(seen.every(([d], i) => i === 0 || d >= seen[i - 1][0]), "monotonic across bundles");
});

// --- 4. The CORS worker is gone from every path ------------------------------------------------

await check("no code path calls the CORS worker or the Releases API", async () => {
  const rel = makeRelease();
  const net = makeNet(rel);
  const { cache } = makeCache();
  await fetchBundle("v9.9.9", undefined, deps(net, cache));
  ok(net.urls.length >= 6, "the run actually made requests to inspect");
  for (const u of net.urls) {
    ok(!u.includes("workers.dev"), `request went through the CORS worker: ${u}`);
    ok(!u.includes("api.github.com"), `request went to the Releases API: ${u}`);
  }
  // And statically: the POC worker constant is GONE from the source, not merely unused.
  const src = readFileSync(join(here, "../src/lib/artifacts.ts"), "utf8");
  const uses = src
    .split("\n")
    .filter((l) => l.includes("ARTIFACT_WORKER") && !l.trimStart().startsWith("*"))
    .map((l) => l.trim());
  eq(uses.length, 0, `ARTIFACT_WORKER is deleted, not declared: ${uses.join(" | ")}`);
  ok(!/workers\.dev/.test(src), "no CORS-worker URL is left in the source");
  ok(!/api\.github\.com/.test(src), "no Releases API URL is left in the source");
});

// The same two deletions, repo-wide: no source file names the worker symbol, and no config
// (compose, Dockerfile, CI, vite, package.json, the frontend import map) points at the proxy dir.
await check("the POC worker symbol and infra/cors-proxy are gone repo-wide", async () => {
  const root = join(here, "../../..");
  ok(!existsSync(join(root, "infra/cors-proxy")), "infra/cors-proxy/ still exists");
  // ".claude" holds agent worktrees inside the main clone — copies of this very repo at
  // older commits. Scanning them reports the deleted symbol as surviving in the MAIN tree,
  // which is exactly backwards, and it only shows up here (an agent's own worktree has no
  // .claude/), so the guard passes in a worktree and fails on merge. Any nested checkout is
  // someone else's tree, never this one.
  const skip = new Set(["node_modules", ".git", ".claude", "dist", "docs", ".worktrees", "references"]);
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|mjs|cjs|svelte|json|ya?ml|html|toml)$/.test(e.name)) continue;
      if (full.endsWith("firmwarecutover.mjs")) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes("ARTIFACT_WORKER")) offenders.push(`${full}: ARTIFACT_WORKER`);
      if (text.includes("infra/cors-proxy")) offenders.push(`${full}: infra/cors-proxy`);
    }
  };
  walk(root);
  eq(offenders.length, 0, `dead POC references survive: ${offenders.join(" | ")}`);
});

// --- 5. Reinstall vs upgrade (firmwareDist/compare.ts) -----------------------------------------
//
// The regression this section exists for: the comparison used to pull a 7-hex sha off the end of
// both strings, so it worked only while every tag was a `git describe` suffix. `v2.0.0-rc1`
// parsed to nothing, `hasUpdate` went permanently false, and every device read "Reinstall".
// What the device reports (`device.banks[].retroGoVersion`) is the version TOKEN out of the
// image; what the index publishes is the whole baked `gitTag`. The only normalisation is the
// fork-name prefix that `engine/intflashscan.ts` already strips on the device side.

// The published index, newest first, exactly as `versions.json` orders it.
const INDEX = [
  "Retro-Go SD v2.0.0-rc1",
  "Retro-Go SD v1.4.1-44-g5dc98285",
  "Retro-Go SD v1.4.0",
];

await check("gitTag normalises to the token the device-side scanner reports", () => {
  eq(versionToken("Retro-Go SD v2.0.0-rc1"), "v2.0.0-rc1", "SD fork prefix stripped");
  eq(versionToken("Retro-Go v1.4.0"), "v1.4.0", "non-SD fork prefix stripped");
  eq(versionToken("v2.0.0-rc1"), "v2.0.0-rc1", "an already-bare token is left alone");
  eq(versionToken(undefined), "", "absent is empty");
  eq(versionToken(""), "", "empty is empty");
  // Nothing else is rewritten: this is not a version parser.
  eq(versionToken("Retro-Go SD v1.4.1-124-g1dfd6f95b+"), "v1.4.1-124-g1dfd6f95b+", "verbatim otherwise");
});

await check("the same gitTag installed and latest reads as a reinstall, not an upgrade", () => {
  eq(versionRelation("v2.0.0-rc1", INDEX[0], INDEX), "same", "relation");
  eq(isUpgrade("v2.0.0-rc1", INDEX[0], INDEX), false, "not an upgrade");
  ok(sameVersion("v2.0.0-rc1", INDEX[0]), "and sameVersion agrees across the prefix");
});

await check("a different, newer gitTag reads as an upgrade", () => {
  eq(versionRelation("v1.4.0", INDEX[0], INDEX), "newer", "relation");
  eq(isUpgrade("v1.4.0", INDEX[0], INDEX), true, "is an upgrade");
});

await check("THE REGRESSION: a tag with no -g<sha> suffix still compares", () => {
  // Both sides unparseable by the old regex; the old code returned null for each and so could
  // never report an upgrade. Installed is the describe-style build, latest is the rc tag.
  eq(isUpgrade("v1.4.1-44-g5dc98285", INDEX[0], INDEX), true, "describe build -> rc tag is an upgrade");
  // And the pure no-sha pair, which the old regex could not touch at either end.
  eq(isUpgrade("v1.4.0", "Retro-Go SD v2.0.0-rc1", INDEX), true, "v1.4.0 -> v2.0.0-rc1 is an upgrade");
  eq(versionRelation("v1.4.0", "Retro-Go SD v1.4.0", INDEX), "same", "and equal no-sha tags are the same");
});

await check("selecting an OLDER version does not read as an upgrade", () => {
  eq(versionRelation("v2.0.0-rc1", INDEX[2], INDEX), "older", "relation");
  eq(isUpgrade("v2.0.0-rc1", INDEX[2], INDEX), false, "downgrade is never an upgrade");
  eq(isUpgrade("v2.0.0-rc1", INDEX[1], INDEX), false, "nor the middle entry");
});

await check("a version the index cannot place, and the parser cannot read, is unknown", () => {
  // `-handbuilt` is neither an `-rc<N>` prerelease nor an `-<N>-g<sha>` describe suffix, so
  // tier 2 refuses it rather than ordering on the `v0.9.0` half it did recognise.
  eq(versionRelation("v0.9.0-handbuilt", INDEX[0], INDEX), "unknown", "relation");
  eq(isUpgrade("v0.9.0-handbuilt", INDEX[0], INDEX), false, "the UI must not promise an upgrade");
  eq(versionRelation("v1.4.0", "Retro-Go SD v3.0.0-handbuilt", INDEX), "unknown", "unreadable target");
  // Both sides unreadable is still unknown — two refusals do not make an ordering.
  eq(versionRelation("mystery", "Retro-Go SD also-mystery", INDEX), "unknown", "neither side readable");
});

await check("no installed version at all is unknown, never an upgrade", () => {
  for (const absent of [undefined, null, ""]) {
    eq(versionRelation(absent, INDEX[0], INDEX), "unknown", `relation for ${JSON.stringify(absent)}`);
    eq(isUpgrade(absent, INDEX[0], INDEX), false, `not an upgrade for ${JSON.stringify(absent)}`);
    eq(sameVersion(absent, INDEX[0]), false, `and not "same" for ${JSON.stringify(absent)}`);
  }
  // An empty index (discovery failed) removes tier 1, but tier 2 can still read two ordinary
  // tags. This is the aged-out case in its most extreme form and must NOT collapse to
  // "Reinstall"; only an unreadable tag does that.
  eq(versionRelation("v1.4.0", "Retro-Go SD v2.0.0-rc1", []), "newer", "empty index falls through to the parser");
  eq(versionRelation("v1.4.0", "Retro-Go SD nonsense", []), "unknown", "empty index and an unreadable tag");
});

// The index as retro-go actually publishes it today: three entries, newest first. The owner's
// installed build is OLDER than all of them and has aged out of the retained window, which is
// the case tier 1 alone answered "unknown" for — and so offered "Reinstall" to precisely the
// users with the most to gain from upgrading.
const LIVE_INDEX = [
  "Retro-Go SD v2.0.0-rc1",
  "Retro-Go SD v1.4.1-131-gba662eec",
  "Retro-Go SD v1.4.1-130-g3447670e",
];

await check("THE OWNER'S CASE: a build aged out of the index still reads as an upgrade", () => {
  const installed = versionToken("Retro-Go SD v1.4.1-44-g5dc98285");
  eq(LIVE_INDEX.map(versionToken).indexOf(installed), -1, "the premise: the index cannot place it");
  eq(versionRelation(installed, LIVE_INDEX[0], LIVE_INDEX), "newer", "v1.4.1-44 -> v2.0.0-rc1");
  eq(isUpgrade(installed, LIVE_INDEX[0], LIVE_INDEX), true, "and the UI offers an upgrade");
});

await check("a describe suffix counts commits AFTER the tag, not a prerelease of it", () => {
  // The trap: stock semver reads `-44-g5dc98285` as a prerelease and sorts it BELOW `v1.4.1`,
  // which would report a downgrade to every user on a describe build.
  eq(versionRelation("v1.4.1", "v1.4.1-1-gabc1234", []), "newer", "v1.4.1 < v1.4.1-1-gabc1234");
  eq(versionRelation("v1.4.1-1-gabc1234", "v1.4.1", []), "older", "and the reverse");
  eq(versionRelation("v1.4.1-44-g5dc98285", "v1.4.1-131-gba662eec", []), "newer", "more commits is newer");
  eq(versionRelation("v1.4.1-131-gba662eec", "v1.4.1-44-g5dc98285", []), "older", "fewer is older");
});

await check("an rc IS a prerelease: it sorts below the release it precedes", () => {
  eq(versionRelation("v2.0.0-rc1", "v2.0.0", []), "newer", "v2.0.0-rc1 < v2.0.0");
  eq(versionRelation("v2.0.0", "v2.0.0-rc1", []), "older", "and the reverse");
  eq(versionRelation("v2.0.0-rc1", "v2.0.0-rc2", []), "newer", "rc1 < rc2");
  eq(versionRelation("v2.0.0-rc2", "v2.0.0-rc1", []), "older", "and the reverse");
  // Across a major bump, the rc still wins: 1.4.1+44 commits is not 2.0.0.
  eq(versionRelation("v1.4.1-44-g5dc98285", "v2.0.0-rc1", []), "newer", "release number dominates");
});

await check("published position WINS over the parser when the index lists both", () => {
  // A deliberately mis-ordered index: parsing would say v1.0.0 -> v2.0.0 is an upgrade, but the
  // publisher's own newest-first order is the fact, and it puts v1.0.0 first.
  const MIS = ["Retro-Go SD v1.0.0", "Retro-Go SD v2.0.0"];
  eq(versionRelation("v2.0.0", MIS[0], MIS), "newer", "position decides, not the numbers");
  eq(versionRelation("v1.0.0", MIS[1], MIS), "older", "and in the other direction");
  // Sanity: the same pair with an EMPTY index falls through to the parser and disagrees, which
  // is what proves tier 1 was the one answering above.
  eq(versionRelation("v2.0.0", "Retro-Go SD v1.0.0", []), "older", "the parser would have said older");
});

await check("two spellings that parse alike are not an upgrade", () => {
  // `v1.4.1` and `1.4.1` are not byte-equal, so sameness (string equality, per FIRMWARE_DIST.md)
  // cannot call them "same"; neither is ahead, so nothing may be offered as an upgrade.
  eq(versionRelation("v1.4.1", "1.4.1", []), "unknown", "a parse tie is not an ordering");
  eq(isUpgrade("v1.4.1", "1.4.1", []), false, "and certainly not an upgrade");
  // A missing component is zero, so v2.0 and v2.0.0 tie the same way.
  eq(versionRelation("v2.0", "2.0.0", []), "unknown", "v2.0 vs v2.0.0");
});

await check("a dirty describe marker does not change the ordering", () => {
  eq(versionRelation("v1.4.1-124-g1dfd6f95b+", "v2.0.0-rc1", []), "newer", "a + marker still orders");
  eq(versionRelation("v1.4.1-124-g1dfd6f95b", "v1.4.1-124-g1dfd6f95b+", []), "unknown", "same distance ties");
});

await check("listVersions surfaces gitTag, and it is what the comparison consumes", async () => {
  const net = makeNet(makeRelease());
  const versions = await listVersions(deps(net, makeCache().cache));
  ok(versions.length > 0, "the fixture index lists versions");
  for (const v of versions) ok(typeof v.gitTag === "string" && v.gitTag.length > 0, "every entry carries a gitTag");
  // The end-to-end shape the UI uses: newest-first list -> ordered gitTags -> relation.
  const ordered = versions.map((v) => v.gitTag);
  eq(versionRelation(versionToken(ordered[0]), ordered[0], ordered), "same", "installed newest = reinstall");
  // And no consumer needs to parse a sha to get there.
  const src = readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8");
  ok(!src.includes("parseSha"), "Wizard.svelte no longer extracts a sha to compare versions");
  const rs = readFileSync(join(here, "../src/lib/advanced/RomSection.svelte"), "utf8");
  ok(!rs.includes("parseSha"), "RomSection.svelte no longer extracts a sha to compare versions");
});

// --- The shared discovery memo (firmwareDist/memo.ts) ------------------------------------------
//
// `curated.ts` and `artifacts.ts` both walk versions.json -> newest entry -> manifest. Before
// `memo.ts` each fetched both documents on its own, so a session that opened Sources and then
// flashed fetched them twice over. The memo covers the DEFAULT network path only, which is why
// these checks drive the real global `fetch` instead of an injected one — an injected
// `fetchImpl` must still go straight through (proved in "versions: the list comes from
// versions.json", which counts exactly one request per call, and again below).

const rawManifestDoc = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));
const rawProjectsDoc = JSON.parse(readFileSync(join(fixtures, "projects.json"), "utf8"));

/** Install a counting global `fetch` serving the three discovery documents. Returns the log. */
function withGlobalFetch(body, { fail = false } = {}) {
  const urls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (fail) throw new TypeError("Failed to fetch");
    const doc = String(url).endsWith("/manifest.json")
      ? rawManifestDoc
      : String(url).endsWith("/projects.json")
        ? rawProjectsDoc
        : rawVersions;
    return { ok: true, status: 200, headers: { get: () => null }, async text() { return JSON.stringify(doc); } };
  };
  return Promise.resolve(body(urls)).finally(() => {
    globalThis.fetch = real;
  });
}

const countOf = (urls, suffix) => urls.filter((u) => u.endsWith(suffix)).length;

await check("memo: two callers, one fetch of each discovery document", async () => {
  resetFirmwareMemo();
  resetCuratedProjects();
  await withGlobalFetch(async (urls) => {
    // Three independent readers of the same release: the picker, the picker again, and the
    // curated-source walk. Started concurrently, because that is what the app does.
    const [a, b, curated] = await Promise.all([listVersions(), listVersions(), curatedProjects()]);
    eq(a.length, rawVersions.versions.length, "the picker got its list");
    eq(b[0].tag, a[0].tag, "and so did the second caller");
    ok(Array.isArray(curated) && curated.length > 0, "the curated walk got its projects");
    eq(countOf(urls, "/versions.json"), 1, "versions.json fetched ONCE for all three callers");
    eq(countOf(urls, "/manifest.json"), 1, "and the manifest once");
  });
  resetFirmwareMemo();
  resetCuratedProjects();
});

await check("memo: a failure is NOT cached — a retry really retries", async () => {
  resetFirmwareMemo();
  resetCuratedProjects();
  const err = await withGlobalFetch(
    (urls) => rejects(() => listVersions(), "offline").then((e) => { eq(urls.length, 1, "it tried"); return e; }),
    { fail: true },
  );
  eq(err.name, "FirmwareDistError", "the raw TypeError does not escape — error behaviour is unchanged");
  eq(err.kind, "network", "and it is still `network`");
  // The memo must not be holding that rejection: the very next call, now online, works.
  await withGlobalFetch(async (urls) => {
    const got = await listVersions();
    eq(countOf(urls, "/versions.json"), 1, "the retry actually went to the network");
    eq(got[0].tag, rawVersions.versions[0].tag, "and succeeded");
  });
  resetFirmwareMemo();
});

await check("memo: an injected fetchImpl bypasses it entirely", async () => {
  // Two suites drive these entry points with per-check fixtures. If the memo served an
  // injected caller, one check's fixture would answer another's — so an injected fetch must
  // hit the wire every single time, memo or no memo.
  resetFirmwareMemo();
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    return { ok: true, status: 200, headers: { get: () => null }, async text() { return JSON.stringify(rawVersions); } };
  };
  await listVersions({ fetchImpl, versionsUrl: VERSIONS_URL });
  await listVersions({ fetchImpl, versionsUrl: VERSIONS_URL });
  eq(urls.length, 2, "two calls, two requests — nothing memoised");
  resetFirmwareMemo();
});

// --- 6. The install-pane TITLE, shared by the Advanced rail and the guided Wizard -------------
//
// `advanced/FirmwareRail.svelte` picked its title with `retroGoInstalledAnywhere ? reinstall :
// install` — a binary "is anything installed" with no version awareness — so the owner's device
// on `v1.4.1-44-g5dc98285` read "Reinstall Retro-Go" there while the Wizard, wired to
// `versionRelation`, correctly said "Upgrade". The rule is one function now; these checks pin
// the three states AND that neither surface grew a rule of its own.

await check("TITLE: the owner's case — an aged-out build offers UPGRADE on the Advanced rail", () => {
  const installed = versionToken("Retro-Go SD v1.4.1-44-g5dc98285");
  eq(LIVE_INDEX.map(versionToken).indexOf(installed), -1, "the premise: the index cannot place it");
  eq(installTitleState(installed, LIVE_INDEX[0], LIVE_INDEX), "upgrade", "the Advanced rail title");
  // The unstripped device string must answer identically — the rail passes it verbatim.
  eq(installTitleState("Retro-Go SD v1.4.1-44-g5dc98285", LIVE_INDEX[0], LIVE_INDEX), "upgrade",
    "and with the fork prefix still on it");
});

await check("TITLE: nothing installed is INSTALL, whatever the index says", () => {
  for (const absent of [undefined, null, ""]) {
    eq(installTitleState(absent, LIVE_INDEX[0], LIVE_INDEX), "install", `for ${JSON.stringify(absent)}`);
  }
  // Not merely "not upgrade": an empty index must not turn a fresh device into a reinstall.
  eq(installTitleState(undefined, undefined, []), "install", "and with no releases known either");
});

await check("TITLE: the same version, and an OLDER one, are both REINSTALL", () => {
  eq(installTitleState("v2.0.0-rc1", LIVE_INDEX[0], LIVE_INDEX), "reinstall", "same version");
  // Newest-first, so index[2] is older than what is installed.
  eq(installTitleState("v2.0.0-rc1", LIVE_INDEX[2], LIVE_INDEX), "reinstall", "an older target");
});

await check("TITLE: `unknown` reads REINSTALL — an upgrade we cannot show is not promised", () => {
  // Unreadable on either side is exactly the case that must not become "upgrade".
  eq(versionRelation("v0.9.0-handbuilt", LIVE_INDEX[0], LIVE_INDEX), "unknown", "the premise");
  eq(installTitleState("v0.9.0-handbuilt", LIVE_INDEX[0], LIVE_INDEX), "reinstall", "and the title");
  eq(installTitleState("v1.4.0", "Retro-Go SD nonsense", []), "reinstall", "unreadable target too");
  // Something IS installed, so it can never fall back to "install".
  ok(installTitleState("v0.9.0-handbuilt", LIVE_INDEX[0], LIVE_INDEX) !== "install",
    "and never `install`, because a version was read off the device");
});

await check("TITLE: the rail and the Wizard both derive from compare.ts, neither owns a rule", () => {
  // Comments are stripped first: this file's own history note QUOTES the binary test it
  // replaced, and a scan that counted that would fail against the very fix it is guarding.
  const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const railSrc = decomment(readFileSync(join(here, "../src/lib/advanced/FirmwareRail.svelte"), "utf8"));
  const wizSrc = decomment(readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8"));
  ok(/from "\.\.\/firmwareDist\/compare\.js"/.test(railSrc), "the rail imports the shared module");
  ok(/from "\.\.\/firmwareDist\/compare\.js"/.test(wizSrc), "and so does the Wizard");
  ok(/installTitleState\(/.test(railSrc), "the rail asks the shared rule for its title");
  // The binary test is what shipped the bug: a title chosen from "is anything installed" alone
  // cannot see a version at all.
  ok(!/retroGoInstalledAnywhere\s*\?/.test(railSrc),
    "and does NOT pick the title from a bare is-anything-installed test");
  ok(/upgradeRetroGoTitle/.test(railSrc), "the third title is reachable from the rail");
});

await check("TITLE: all seven locales carry the new title, none of them in English", () => {
  const dir = join(here, "../src/lib/i18n/strings");
  const en = readFileSync(join(dir, "firmwareSetup.ts"), "utf8");
  const enVal = /upgradeRetroGoTitle: "([^"]+)"/.exec(en);
  ok(enVal, "English has the key");
  for (const code of LOCALES) {
    const src = readFileSync(join(dir, `firmwareSetup.${code}.ts`), "utf8");
    const m = /upgradeRetroGoTitle: "([^"]+)"/.exec(src);
    ok(m, `${code} has the key`);
    ok(m[1] !== enVal[1], `${code} is translated, not the English string pasted through`);
  }
});

if (failures.length) {
  console.error(`firmwarecutover: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (passed === 0) {
  console.error("firmwarecutover: no assertions ran");
  process.exit(1);
}
console.log(`firmwarecutover: ${passed} checks passed`);
