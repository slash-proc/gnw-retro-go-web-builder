#!/usr/bin/env node
/**
 * Offline coverage for `readBodyWithProgress()` (src/lib/artifacts.ts) — the streamed
 * body read that gives the firmware-bundle download a REAL percent instead of an opaque
 * `res.arrayBuffer()` wait.
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/downloadprogress.mjs'
 *
 * Plain node, no framework (repo convention). Nothing here touches a device or the network —
 * every Response is a hand-built fake.
 *
 * WHAT MUST HOLD, AND WHY
 * -----------------------
 * `fetchBundle` is called from five places and only two of them pass a callback, so the
 * no-callback path must stay bit-identical to the old `arrayBuffer()` behaviour. And the
 * bytes are a firmware image: a streamed read that reassembles chunks incorrectly would
 * flash corrupt data, which no progress bar is worth. Hence:
 *  1. streamed bytes === arrayBuffer bytes, for the same body;
 *  2. progress is monotonic, starts at 0, never exceeds the total, ends exactly at it;
 *  3. no Content-Length (or 0, or garbage, or no body/getReader) falls back to
 *     arrayBuffer() rather than reporting a percent against an unknown denominator;
 *  4. no callback => arrayBuffer() path, untouched.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src/lib/artifacts.ts");

// --- Tiny harness ----------------------------------------------------------------------
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}
function bytesEq(a, b, msg) {
  if (a.length !== b.length) throw new Error(`${msg}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${msg}: byte ${i} differs`);
}

// --- Build just artifacts.ts (its only import, ./unzip.js, is marked external and stubbed) ---
const esbuild = await import("esbuild");
const out = mkdtempSync(join(tmpdir(), "dlprog-"));
await esbuild.build({
  entryPoints: [src],
  outfile: join(out, "artifacts.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["./unzip.js"],
  plugins: [
    {
      name: "stub-unzip",
      setup(b) {
        b.onResolve({ filter: /^\.\/unzip\.js$/ }, () => ({ path: "unzip-stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export function unzip(){ throw new Error('unzip must not run in this test'); }",
        }));
      },
    },
  ],
});
const { readBodyWithProgress } = await import(pathToFileURL(join(out, "artifacts.js")).href);

// --- Fake Response ---------------------------------------------------------------------
/** chunks: Uint8Array[]; contentLength: string|null (the header value, verbatim). */
function fakeRes(chunks, contentLength, opts = {}) {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  let arrayBufferCalls = 0;
  const res = {
    headers: { get: (k) => (k.toLowerCase() === "content-length" ? contentLength : null) },
    body: opts.noBody
      ? null
      : {
          getReader: opts.noReader
            ? undefined
            : () => {
                let i = 0;
                return { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) };
              },
        },
    async arrayBuffer() {
      arrayBufferCalls++;
      return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
    },
    get arrayBufferCalls() { return arrayBufferCalls; },
  };
  res.expected = all;
  return res;
}

const CHUNKS = [
  Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff),
  Uint8Array.from({ length: 7 }, (_, i) => 0xa0 + i),
  Uint8Array.from({ length: 4096 }, (_, i) => (i * 7) & 0xff),
];
const TOTAL = CHUNKS.reduce((n, c) => n + c.length, 0);

function recorder() {
  const calls = [];
  const fn = (d, t) => calls.push([d, t]);
  fn.calls = calls;
  return fn;
}
function assertMonotonic(calls, total, msg) {
  if (calls.length === 0) throw new Error(`${msg}: no progress calls`);
  eq(calls[0][0], 0, `${msg}: first call must be 0`);
  let prev = -1;
  for (const [d, t] of calls) {
    eq(t, total, `${msg}: total`);
    if (d < prev) throw new Error(`${msg}: went backwards ${prev} -> ${d}`);
    if (d > t) throw new Error(`${msg}: ${d} exceeds total ${t}`);
    prev = d;
  }
  eq(calls[calls.length - 1][0], total, `${msg}: must end at total`);
}

// --- 1. Streamed bytes are identical to the arrayBuffer() bytes -------------------------
await check("streamed bytes === arrayBuffer bytes", async () => {
  const a = fakeRes(CHUNKS, String(TOTAL));
  const b = fakeRes(CHUNKS, String(TOTAL));
  const streamed = await readBodyWithProgress(a, recorder());
  const plain = await readBodyWithProgress(b, undefined);
  eq(streamed.length, TOTAL, "streamed length");
  bytesEq(streamed, a.expected, "streamed vs source");
  bytesEq(streamed, plain, "streamed vs arrayBuffer");
});

await check("streamed path does not call arrayBuffer()", async () => {
  const r = fakeRes(CHUNKS, String(TOTAL));
  await readBodyWithProgress(r, recorder());
  eq(r.arrayBufferCalls, 0, "arrayBuffer calls");
});

// --- 2. Progress is monotonic, bounded, and ends at the total ---------------------------
await check("progress monotonic, starts at 0, ends at total", async () => {
  const rec = recorder();
  await readBodyWithProgress(fakeRes(CHUNKS, String(TOTAL)), rec);
  assertMonotonic(rec.calls, TOTAL, "progress");
});

await check("progress reports every chunk boundary", async () => {
  const rec = recorder();
  await readBodyWithProgress(fakeRes(CHUNKS, String(TOTAL)), rec);
  // 1 seed + 3 chunks + 1 final pin
  eq(rec.calls.length, CHUNKS.length + 2, "call count");
  eq(rec.calls[1][0], 1000, "after chunk 1");
  eq(rec.calls[2][0], 1007, "after chunk 2");
});

await check("body longer than Content-Length stays clamped and bytes are unclamped", async () => {
  // Content-Encoding can make the body longer than the advertised length.
  const short = String(TOTAL - 500);
  const rec = recorder();
  const r = fakeRes(CHUNKS, short);
  const outBytes = await readBodyWithProgress(r, rec);
  assertMonotonic(rec.calls, TOTAL - 500, "clamped progress");
  eq(outBytes.length, TOTAL, "returned bytes must NOT be clamped");
  bytesEq(outBytes, r.expected, "clamped-progress bytes");
});

// --- 3. Fallbacks ----------------------------------------------------------------------
for (const [name, header] of [
  ["absent Content-Length", null],
  ["zero Content-Length", "0"],
  ["unparseable Content-Length", "banana"],
  ["negative Content-Length", "-5"],
]) {
  await check(`${name} falls back to arrayBuffer with no progress`, async () => {
    const rec = recorder();
    const r = fakeRes(CHUNKS, header);
    const bytes = await readBodyWithProgress(r, rec);
    eq(rec.calls.length, 0, "must report nothing rather than a bogus percent");
    eq(r.arrayBufferCalls, 1, "arrayBuffer calls");
    bytesEq(bytes, r.expected, "fallback bytes");
  });
}

await check("null body falls back to arrayBuffer", async () => {
  const rec = recorder();
  const r = fakeRes(CHUNKS, String(TOTAL), { noBody: true });
  const bytes = await readBodyWithProgress(r, rec);
  eq(rec.calls.length, 0, "no progress");
  eq(r.arrayBufferCalls, 1, "arrayBuffer calls");
  bytesEq(bytes, r.expected, "fallback bytes");
});

await check("body without getReader falls back to arrayBuffer", async () => {
  const rec = recorder();
  const r = fakeRes(CHUNKS, String(TOTAL), { noReader: true });
  const bytes = await readBodyWithProgress(r, rec);
  eq(rec.calls.length, 0, "no progress");
  eq(r.arrayBufferCalls, 1, "arrayBuffer calls");
  bytesEq(bytes, r.expected, "fallback bytes");
});

// --- 4. The four callers that pass no callback are unaffected ---------------------------
await check("no callback => arrayBuffer path, identical bytes", async () => {
  const r = fakeRes(CHUNKS, String(TOTAL));
  const bytes = await readBodyWithProgress(r, undefined);
  eq(r.arrayBufferCalls, 1, "arrayBuffer calls");
  bytesEq(bytes, r.expected, "no-callback bytes");
});

await check("empty body streams to a zero-length result", async () => {
  const r = fakeRes([], "0");
  const bytes = await readBodyWithProgress(r, recorder());
  eq(bytes.length, 0, "empty length");
});

// --- Report ----------------------------------------------------------------------------
if (failures.length) {
  console.error(`\ndownloadprogress: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`\ndownloadprogress: ${passed} checks passed, 0 failed`);
