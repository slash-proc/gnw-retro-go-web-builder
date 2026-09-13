#!/usr/bin/env node
/**
 * Offline coverage for AUTO-DOWNLOAD (`src/lib/sources/autoDownload.ts` + its wiring in
 * `src/lib/sources/store.svelte.ts`).
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/autodownload.mjs'
 *
 * Plain node, no framework (repo convention). `$state` is defined away exactly as
 * `test/curatedsources.mjs` does it, and BOTH seams — the verified artifact fetch and the
 * blob cache's `has()` — are injected, so nothing here touches a network or OPFS.
 *
 * The contract under test, i.e. the decisions being pinned:
 *   - a source under the 5 MB declared-size threshold downloads; one at or over it does not,
 *     and the size compared is the manifest's own summed `artifacts[].bytes`
 *   - a full cache hit issues NO fetch at all (not a fetch served warm)
 *   - a failed auto-download is silent: same row, same status, no error, nothing thrown
 *   - SCALE: an inactive row never downloads; activating it is the signal. Curated rows now
 *     start active and therefore may warm their artifacts.
 *   - concurrency is bounded, and a download is cancellable (deactivate / remove / remove)
 */
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
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

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-autodl-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
// One bundle for both modules, so the store and the downloader class come from the SAME
// module instance — two separate builds would give two unrelated copies.
writeFileSync(
  join(out, "entry.ts"),
  `export * from ${JSON.stringify(join(here, "../src/lib/sources/store.svelte.ts"))};\n` +
    `export * from ${JSON.stringify(join(here, "../src/lib/sources/autoDownload.ts"))};\n`,
);
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(out, "entry.ts")],
  outfile: join(out, "entry.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  // See curatedsources.mjs: jszip is CJS and cannot go into a `platform: neutral` build.
  external: ["jszip"],
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const {
  SourcesStore,
  AutoDownloader,
  AUTO_DOWNLOAD_MAX_BYTES,
  AUTO_DOWNLOAD_CONCURRENCY,
  isAutoDownloadable,
  shouldAutoDownload,
} = await import(pathToFileURL(join(out, "entry.js")).href);

const hex = (n) => String(n).padStart(64, "a");

/** A `ResolvedSource` whose game-and-watch target declares `total` bytes across two files. */
function resolved(repo, total, tag = "v1.0.0") {
  const half = Math.floor(total / 2);
  return {
    repo,
    entry: { kind: "homebrew", tag, publishedAt: "2026-01-01T00:00:00Z", prerelease: false, needsUserFiles: false },
    index: { releasesUrl: `https://github.com/${repo}/releases`, versions: [{ tag, manifest: "m", publishedAt: "2026-01-01T00:00:00Z", prerelease: false }] },
    manifest: {
      title: repo,
      targets: [{
        platform: "game-and-watch",
        requiresAbi: { version: 1, minSize: 4 },
        systems: [],
        artifacts: [
          { filename: "a.bin", bytes: half, sha256: hex(1), url: "https://x.test/a.bin" },
          { filename: "b.bin", bytes: total - half, sha256: hex(2), url: "https://x.test/b.bin" },
        ],
      }],
    },
  };
}

/** A downloader whose fetch and cache are both recorded fakes. */
function rig(opts = {}) {
  const calls = [];
  const signals = [];
  let release;
  const gate = opts.block ? new Promise((r) => { release = r; }) : null;
  const deps = {
    has: async () => opts.cached === true,
    fetchArtifacts: async (target, o) => {
      calls.push(target);
      signals.push(o.signal);
      if (gate) await gate;
      if (o.signal.aborted) throw new Error("aborted");
      if (opts.fail) throw new Error("network down");
      return new Map();
    },
  };
  const dl = new AutoDownloader(deps);
  return { dl, calls, signals, open: () => release && release() };
}

function freshStore(dl) {
  mem.clear();
  const s = new SourcesStore();
  s.load(false);
  s.downloader = dl;
  return s;
}

const REPO = "slash-proc/snake-retro-go-sd";

await check("the threshold is 5 MB and is read off the manifest's declared bytes", async () => {
  eq(AUTO_DOWNLOAD_MAX_BYTES, 5 * 1024 * 1024, "threshold");
  ok(isAutoDownloadable(resolved(REPO, 1024).manifest), "1 KB qualifies");
  ok(isAutoDownloadable(resolved(REPO, AUTO_DOWNLOAD_MAX_BYTES - 2).manifest), "just under qualifies");
  ok(!isAutoDownloadable(resolved(REPO, AUTO_DOWNLOAD_MAX_BYTES).manifest), "exactly at the threshold does not");
  ok(!isAutoDownloadable(resolved(REPO, 6 * 1024 * 1024).manifest), "6 MB does not");
  // An unknown size is not a small size.
  const m = resolved(REPO, 1024).manifest;
  m.targets[0].artifacts[0].bytes = Number.NaN;
  ok(!isAutoDownloadable(m), "a non-numeric declared size does not qualify");
  m.targets[0].artifacts = [];
  ok(!isAutoDownloadable(m), "no artifacts at all does not qualify");
});

await check("a source under the threshold downloads when the user adds it", async () => {
  const r = rig();
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 2 * 1024 * 1024)), "added");
  await r.dl.idle();
  eq(r.calls.length, 1, "one artifact fetch was issued");
  eq(r.dl.stats.fetched, 1, "counted as fetched");
  eq(s.get(REPO).status, "ok", "the row is untouched by the download");
});

await check("a source over the threshold does not download", async () => {
  const r = rig();
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 6 * 1024 * 1024)), "added");
  await r.dl.idle();
  eq(r.calls.length, 0, "no fetch was issued");
  eq(r.dl.stats.queued, 0, "and nothing was even queued");
});

await check("a full cache hit issues no fetch at all", async () => {
  const r = rig({ cached: true });
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 1024)), "added");
  await r.dl.idle();
  eq(r.calls.length, 0, "the fetch seam was never entered");
  eq(r.dl.stats.cached, 1, "counted as a cache hit");
  eq(r.dl.stats.fetched, 0, "and not as a fetch");
});

await check("a failed auto-download is silent and leaves the row exactly as it was", async () => {
  const r = rig({ fail: true });
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 1024)), "added");
  const row = s.get(REPO);
  const before = JSON.stringify({ status: row.status, active: row.active, code: row.errorCode ?? null, detail: row.errorDetail ?? null });
  await r.dl.idle();
  eq(r.calls.length, 1, "it really did try (otherwise this test proves nothing)");
  eq(r.dl.stats.failed, 1, "the failure was counted internally");
  const after = s.get(REPO);
  eq(JSON.stringify({ status: after.status, active: after.active, code: after.errorCode ?? null, detail: after.errorDetail ?? null }), before, "row unchanged");
  eq(after.status, "ok", "no error state");
  eq(after.errorCode, undefined, "no error code for the user to dismiss");
  eq(s.addError, null, "and no add-form error either");
});

await check("SCALE: curated rows are active by default and warm their artifacts", async () => {
  const r = rig();
  const s = freshStore(r.dl);
  const CORE = "slash-proc/fceumm-retro-go-sd";
  const url = (repo) => `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/dist/versions.json`;
  await s.importCurated({
    load: async () => [CORE, REPO].map((repo) => ({ project: repo.split("/")[1], title: repo, kind: "homebrew", versionsUrl: url(repo) })),
    // Tiny payloads: only the ACTIVE flag can be what holds these back.
    resolve: async (repo) => resolved(repo, 1024),
  });
  eq(s.rows.length, 2, "two curated rows landed");
  ok(s.rows.every((row) => row.active === true), "and they are active");
  await r.dl.idle();
  eq(r.calls.length, 2, "both curated rows downloaded their artifacts");
  eq(r.dl.stats.queued, 2, "both were queued");
  s.setActive(REPO, false);
  s.setActive(REPO, true);
  await r.dl.idle();
  eq(r.calls.length, 3, "reactivating one may refresh that row");
});

await check("SCALE: the row gate admits only active, network-resolved, resolved rows", async () => {
  const m = resolved(REPO, 1024).manifest;
  ok(shouldAutoDownload({ active: true, origin: "url", manifest: m }), "an active url row qualifies");
  ok(!shouldAutoDownload({ active: false, origin: "url", manifest: m }), "an INACTIVE row never does — this is the curated-list rule");
  ok(!shouldAutoDownload({ active: true, origin: "bundle", manifest: m }), "a bundle row has nothing to pre-fetch");
  ok(!shouldAutoDownload({ active: true, origin: "url" }), "a row with no resolved manifest has no declared size");
});

await check("concurrency is bounded across many activated rows", async () => {
  const r = rig({ block: true });
  const s = freshStore(r.dl);
  for (let i = 0; i < 6; i++) ok(s.addResolved(resolved(`owner/p${i}`, 1024)), `added p${i}`);
  // Let the queue pump as far as it can with every fetch parked.
  await new Promise((res) => setTimeout(res, 0));
  ok(r.calls.length <= AUTO_DOWNLOAD_CONCURRENCY, `at most ${AUTO_DOWNLOAD_CONCURRENCY} in flight, saw ${r.calls.length}`);
  eq(r.dl.inFlight, AUTO_DOWNLOAD_CONCURRENCY, "the bound is actually reached, not just respected by accident");
  eq(r.dl.stats.queued, 6, "all six were accepted");
  r.open();
  await r.dl.idle();
  eq(r.calls.length, 6, "and all six eventually ran");
  eq(r.dl.stats.peakConcurrency, AUTO_DOWNLOAD_CONCURRENCY, "peak never exceeded the bound");
});

await check("a download is cancellable: deactivating aborts the in-flight fetch", async () => {
  const r = rig({ block: true });
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 1024)), "added");
  await new Promise((res) => setTimeout(res, 0));
  eq(r.dl.inFlight, 1, "downloading");
  s.setActive(REPO, false);
  ok(r.signals[0].aborted, "the fetch's signal was aborted");
  r.open();
  await r.dl.idle();
  eq(r.dl.inFlight, 0, "and the queue drained");
  eq(r.dl.stats.fetched, 0, "a cancelled download is not counted as fetched");
});

await check("removing a source cancels its download too", async () => {
  const r = rig({ block: true });
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 1024)), "added");
  await new Promise((res) => setTimeout(res, 0));
  eq(r.dl.inFlight, 1, "downloading");
  s.remove(REPO);
  ok(r.signals[0].aborted, "the fetch's signal was aborted");
  r.open();
  await r.dl.idle();
  eq(r.dl.inFlight, 0, "queue drained");
});

await check("a repeat request for the same row does not start a second download", async () => {
  const r = rig({ block: true });
  const s = freshStore(r.dl);
  ok(s.addResolved(resolved(REPO, 1024)), "added");
  await new Promise((res) => setTimeout(res, 0));
  s.setActive(REPO, true);
  s.setActive(REPO, true);
  eq(r.calls.length, 1, "still one fetch");
  r.open();
  await r.dl.idle();
});

if (failures.length) {
  console.error(`autodownload: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (passed === 0) {
  console.error("autodownload: no assertions ran");
  process.exit(1);
}
console.log(`autodownload: ${passed} checks passed`);
