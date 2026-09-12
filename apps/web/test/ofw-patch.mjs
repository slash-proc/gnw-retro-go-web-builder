#!/usr/bin/env node
/**
 * Offline coverage for `patchAndFlash()` (src/lib/engine/ofw.ts) — the dual-boot write
 * path, and the sibling of `restoreStock()` (see ofw-restore.mjs, whose harness this
 * mirrors deliberately).
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/ofw-patch.mjs'
 *
 * Plain node, no framework (repo convention). NOTHING here touches a device.
 *
 * What is faked, and why exactly there:
 *  - `GnwFlasher` is faked and INJECTED as patchAndFlash's first argument, so the real
 *    engine/flasher.ts `flashImage` (retry loop, stall watchdog, compression policy,
 *    abort forwarding) still runs. Same boundary ofw-restore.mjs uses.
 *  - `engine/patch.ts`'s `patchModel` is stubbed at the module boundary. That is the
 *    byte-exact patcher, which has its own oracle tests in packages/gnw-patch; what is
 *    under test here is patchAndFlash's ORCHESTRATION of the result — what it refuses,
 *    what it writes, in what order, and that it does not mutate its inputs. Stubbing it
 *    also lets a test hand back an oversized image to exercise the guards, which a real
 *    patch run can never produce on demand.
 *  - The bootloader blob is a Vite `?url` import, so the stubbed URL is served by a
 *    fetch shim. Its BYTES are arbitrary; their PLACEMENT is what is asserted.
 * Everything between those points is the shipping code path.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

// --- Tiny harness ----------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => void passed++,
      (e) => void failures.push(`${name}: ${e && e.message ? e.message : e}`),
    );
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function bytesEq(a, b, msg) {
  assert(a.length === b.length, `${msg}: length ${a.length} != ${b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${msg}: byte ${i} differs (${a[i]} != ${b[i]})`);
}

// --- Browser shims the engine module graph needs -----------------------------------------
globalThis.window = { LZMA: { compress: (d) => [...new Uint8Array(13), ...Uint8Array.from(d)] } };
globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };
if (!globalThis.crypto) globalThis.crypto = webcrypto;

/** Bytes the fetch shim hands back for the bootloader `?url` asset. */
let bootloaderBlob = null;
let fetches = [];
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  if (/gnw_bootloader/.test(String(url))) {
    assert(bootloaderBlob, "a test fetched the bootloader without providing blob bytes");
    return { arrayBuffer: async () => bootloaderBlob.buffer.slice(bootloaderBlob.byteOffset, bootloaderBlob.byteOffset + bootloaderBlob.byteLength) };
  }
  throw new Error(`unexpected offline fetch: ${url}`);
};

// --- Compile the TypeScript under test ---------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-ofw-patch-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/ofw.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      name: "url-assets",
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "url-asset" }));
        b.onLoad({ filter: /.*/, namespace: "url-asset" }, (a) => ({
          contents: `export default ${JSON.stringify("asset:" + a.path)};`,
          loader: "js",
        }));
      },
    },
    {
      // The real patcher (packages/gnw-patch, WASM liblzma) is byte-exact-tested there.
      // Here it is a controllable seam: the test decides what image comes back.
      name: "stub-patch",
      setup(b) {
        b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: `export async function patchModel(m, i, e, o){ return globalThis.__patchModel(m, i, e, o); }`,
          loader: "js",
        }));
      },
    },
  ],
});
const { patchAndFlash } = await import(pathToFileURL(join(out, "ofw.js")).href);

// --- Fixtures & fakes ---------------------------------------------------------------------
const fixture = (len, seed) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) & 0xff);

const INTERNAL_STOCK_LEN = 0x20000;   // 128 KiB stock internal dump (patcher input)
const BOOTLOADER_OFFSET = 200 << 10;  // 0x32000 — where the SD bootloader is linked
const MARIO_EXT = 1 * 1024 * 1024;
const ZELDA_EXT = 4 * 1024 * 1024;

/**
 * Stands in for GnwFlasher; records every write verbatim and reports 256 KiB-chunk progress.
 * `honourAbort` mirrors the real flasher's own precondition (packages/gnw-flasher's flash()
 * refuses an aborted operation before touching the bus). Passing false removes it so that a
 * test can prove patchAndFlash's OWN abort check is what stopped the write — with the
 * precondition in place a missing check in ofw.ts is invisible, because the fake refuses
 * anyway. (A dropped between-writes check survived the mutation test until this was split.)
 */
function fakeFlasher(honourAbort = true) {
  const writes = [];
  return {
    writes,
    async flash(bank, offset, data, opts = {}) {
      if (honourAbort && opts.abortSignal?.aborted) throw new Error("Operation aborted");
      const rec = { bank, offset, bytes: Uint8Array.from(data), progress: [] };
      writes.push(rec);
      const CHUNK = 256 * 1024;
      for (let done = 0; done < data.length; ) {
        done = Math.min(done + CHUNK, data.length);
        rec.progress.push(done);
        opts.onProgress?.(done, data.length);
      }
    },
  };
}

/** Install a patchModel stub returning fixed images; records the arguments it was given. */
function stubPatch(result) {
  const calls = [];
  globalThis.__patchModel = async (model, internal, external, options) => {
    calls.push({ model, internal, external, options });
    return { internal: result.internal, external: result.external };
  };
  return calls;
}

async function run({ internal, external, options = {}, patched, extFlashBytes = 0, signal, flasher } = {}) {
  const f = flasher || fakeFlasher();
  const reports = [];
  const err = await patchAndFlash(
    f,
    "mario",
    internal,
    external,
    options,
    (done, total, sub) => reports.push({ done, total, sub: sub && { ...sub } }),
    signal,
    extFlashBytes,
  ).then(() => null, (e) => e);
  return { f, reports, err, patched };
}

// =========================================================================================
// 1. Capacity guard — patchAndFlash DOES have one (external image vs the device chip).
//    A failure here on hardware: the patched internal image lands (device now boots the
//    dual-boot firmware) and the external write then dies partway through, leaving a device
//    whose firmware is present but whose ROM/asset region is half-written garbage.
// =========================================================================================
await check("capacity guard refuses an oversized patched external image BEFORE any write", async () => {
  stubPatch({ internal: fixture(0x1c000, 1), external: fixture(ZELDA_EXT, 2) });
  const { f, err, reports } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: MARIO_EXT,
  });
  assert(err, "expected a refusal, got success");
  assert(/won't fit/.test(err.message), `unexpected error: ${err.message}`);
  eq(f.writes.length, 0, "the guard must refuse BEFORE any write is issued");
  eq(reports.length, 0, "no progress should be reported for a refused patch+flash");
});

await check("capacity guard allows an exact fit and is disabled when the device size is unknown", async () => {
  stubPatch({ internal: fixture(0x1c000, 1), external: fixture(MARIO_EXT, 2) });
  const exact = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: MARIO_EXT,
  });
  assert(!exact.err, `exact fit must be allowed: ${exact.err && exact.err.message}`);
  eq(exact.f.writes.length, 2, "exact fit should write both images");

  // extFlashBytes = 0 means "device size unknown"; the guard is skipped by design, exactly
  // as in restoreStock.
  stubPatch({ internal: fixture(0x1c000, 1), external: fixture(ZELDA_EXT, 2) });
  const unknown = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: 0,
  });
  assert(!unknown.err, "extFlashBytes=0 must skip the guard");
  eq(unknown.f.writes.length, 2, "unknown-size patch+flash should still write both images");
});

// =========================================================================================
// 2. The bootloader-overlap guard — the guard unique to this path. In bootloader mode the
//    SD bootloader is spliced into bank 1 at 0x32000; if the patched image were longer than
//    that it would be silently truncated by the splice and the device would boot neither
//    firmware. The guard must refuse instead of writing.
// =========================================================================================
await check("an internal image overlapping the bootloader region is refused before any write", async () => {
  bootloaderBlob = fixture(4096, 9);
  stubPatch({ internal: fixture(BOOTLOADER_OFFSET + 1, 1), external: new Uint8Array(0) });
  const { f, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    options: { bootloader: true },
  });
  assert(err, "expected a refusal, got success");
  assert(/overlaps the bootloader region/.test(err.message), `unexpected error: ${err.message}`);
  assert(/0x8032000/.test(err.message), `refusal must name the bootloader address: ${err.message}`);
  eq(f.writes.length, 0, "the overlap guard must refuse BEFORE any write is issued");
});

await check("without bootloader mode no blob is fetched and bank 1 is the patched image verbatim", async () => {
  bootloaderBlob = null;
  fetches = [];
  const patched = fixture(0x1c000, 3);
  stubPatch({ internal: patched, external: new Uint8Array(0) });
  const { f, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    options: {},
  });
  assert(!err, `unexpected error: ${err && err.message}`);
  eq(fetches.length, 0, "no bootloader must be fetched when bootloader mode is off");
  eq(f.writes.length, 1, "an empty external image must not produce a bank 0 write");
  bytesEq(f.writes[0].bytes, patched, "bank 1 must be the patched image verbatim");
});

await check("bootloader mode splices patch@0 + bootloader@0x32000 with 0xFF fill, in ONE bank-1 write", async () => {
  // One erase, one write: the whole reason the two images are spliced here rather than
  // flashed as gnwmanager's two separate CLI passes.
  const patched = fixture(0x1c000, 3);
  const boot = fixture(4096, 9);
  bootloaderBlob = boot;
  stubPatch({ internal: patched, external: new Uint8Array(0) });
  const { f, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    options: { bootloader: true },
  });
  assert(!err, `unexpected error: ${err && err.message}`);
  eq(f.writes.length, 1, "the spliced bank-1 image must be ONE write, not two passes");
  const b = f.writes[0].bytes;
  eq(f.writes[0].bank, 1, "the spliced image goes to bank 1");
  eq(f.writes[0].offset, 0, "the spliced image starts at offset 0");
  eq(b.length, BOOTLOADER_OFFSET + boot.length, "bank-1 length must be 0x32000 + bootloader length");
  bytesEq(b.subarray(0, patched.length), patched, "patched image must sit at offset 0");
  bytesEq(b.subarray(BOOTLOADER_OFFSET), boot, "bootloader must sit at 0x32000");
  for (let i = patched.length; i < BOOTLOADER_OFFSET; i++) {
    if (b[i] !== 0xff) throw new Error(`gap byte ${i} is 0x${b[i].toString(16)}, want 0xff (erased state)`);
  }
});

// =========================================================================================
// 3. Write order and targets. Internal first is what makes a partial failure survivable.
// =========================================================================================
await check("writes internal -> bank 1 @ 0, then external -> bank 0 @ 0", async () => {
  bootloaderBlob = null;
  const patched = fixture(0x1c000, 3);
  const ext = fixture(MARIO_EXT, 4);
  stubPatch({ internal: patched, external: ext });
  const { f, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: MARIO_EXT,
  });
  assert(!err, `unexpected error: ${err && err.message}`);
  eq(f.writes.length, 2, "expected exactly two writes");
  eq(f.writes[0].bank, 1, "first write must target bank 1 (internal)");
  eq(f.writes[0].offset, 0, "first write must be at offset 0");
  bytesEq(f.writes[0].bytes, patched, "first write must be the patched internal image");
  eq(f.writes[1].bank, 0, "second write must target bank 0 (external)");
  eq(f.writes[1].offset, 0, "second write must be at offset 0");
  bytesEq(f.writes[1].bytes, ext, "second write must be the patched external image");
});

await check("the model and options reach the patcher unchanged", async () => {
  bootloaderBlob = null;
  const calls = stubPatch({ internal: fixture(0x1000, 3), external: new Uint8Array(0) });
  const options = { bootloader: false, foo: 42 };
  const internal = fixture(INTERNAL_STOCK_LEN, 5);
  const external = fixture(MARIO_EXT, 6);
  const { err } = await run({ internal, external, options });
  assert(!err, `unexpected error: ${err && err.message}`);
  eq(calls.length, 1, "the patcher must be invoked exactly once");
  eq(calls[0].model, "mario", "the model must be forwarded verbatim");
  assert(calls[0].internal === internal, "the caller's internal dump must be passed through, not copied/sliced");
  assert(calls[0].external === external, "the caller's external dump must be passed through, not copied/sliced");
  assert(calls[0].options === options, "the caller's options object must be forwarded verbatim");
});

// =========================================================================================
// 4. Progress accounting. A wrong offset makes the bar jump backwards mid-destructive-write,
//    on the one screen where a user watching a stalled-looking bar might unplug the device.
// =========================================================================================
await check("overall progress is monotonic, totals both images, and offsets the second write", async () => {
  bootloaderBlob = null;
  const patched = fixture(0x1c000, 3);
  const ext = fixture(MARIO_EXT, 4);
  stubPatch({ internal: patched, external: ext });
  const { reports, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: MARIO_EXT,
  });
  assert(!err, `unexpected error: ${err && err.message}`);
  // NOTE the total is over the PATCHED images, not the caller's dumps — the patched
  // internal is smaller than the 128 KiB stock dump, so using the input length would
  // overstate the total and the bar would never reach 100%.
  const total = patched.length + ext.length;
  for (const r of reports) eq(r.total, total, "every report's total must be patched internal + patched external");

  const intReports = reports.filter((r) => r.sub.label === "internal → bank 1");
  const extReports = reports.filter((r) => r.sub.label === "external → bank 0");
  eq(intReports.length + extReports.length, reports.length, "unexpected sub-bar label");
  assert(intReports.length > 0 && extReports.length > 0, "both phases must report progress");

  for (const r of intReports) {
    eq(r.sub.max, patched.length, "internal sub-bar max");
    eq(r.done, r.sub.value, "internal phase overall progress must equal its sub progress");
  }
  for (const r of extReports) {
    eq(r.sub.max, ext.length, "external sub-bar max");
    eq(r.done, patched.length + r.sub.value, "external phase must be offset by the internal image length");
  }
  eq(intReports[intReports.length - 1].done, patched.length, "internal phase must finish at the internal length");
  eq(extReports[extReports.length - 1].done, total, "external phase must finish at the grand total");

  let prev = -1;
  for (const r of reports) {
    assert(r.done >= prev, `progress went backwards: ${prev} -> ${r.done}`);
    assert(r.done <= r.total, `progress exceeded the total: ${r.done} > ${r.total}`);
    prev = r.done;
  }
});

await check("in bootloader mode the total covers the SPLICED bank-1 image, not just the patch", async () => {
  const patched = fixture(0x1c000, 3);
  const boot = fixture(4096, 9);
  const ext = fixture(MARIO_EXT, 4);
  bootloaderBlob = boot;
  stubPatch({ internal: patched, external: ext });
  const { reports, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    options: { bootloader: true },
    extFlashBytes: MARIO_EXT,
  });
  assert(!err, `unexpected error: ${err && err.message}`);
  const bank1Len = BOOTLOADER_OFFSET + boot.length;
  const total = bank1Len + ext.length;
  for (const r of reports) eq(r.total, total, "total must use the spliced bank-1 length");
  const extReports = reports.filter((r) => r.sub.label === "external → bank 0");
  for (const r of extReports) eq(r.done, bank1Len + r.sub.value, "external phase offset must be the SPLICED length");
  eq(reports[reports.length - 1].done, total, "the last report must reach the grand total");
});

// =========================================================================================
// 5. Abort. Two points: before the first write, and between the two writes.
// =========================================================================================
await check("an already-aborted signal produces no writes and does not run the patcher", async () => {
  bootloaderBlob = null;
  const calls = stubPatch({ internal: fixture(0x1c000, 3), external: fixture(MARIO_EXT, 4) });
  const ac = new AbortController();
  ac.abort();
  // Permissive fake for the same reason as the between-writes check below: this must prove
  // patchAndFlash's own guard, not the flasher's precondition.
  const { f, err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: MARIO_EXT,
    signal: ac.signal,
    flasher: fakeFlasher(false),
  });
  assert(err, "expected a refusal, got success");
  eq(err.message, "Operation aborted", "must reuse the flasher's existing abort message");
  eq(f.writes.length, 0, "an aborted patch+flash must not write anything");
  eq(calls.length, 0, "an already-aborted call must not even start patching");
});

await check("an abort raised between the two writes leaves exactly one write issued", async () => {
  // patchAndFlash's OWN between-writes check: the fake completes the internal write and only
  // then aborts, so nothing downstream gets a chance to refuse.
  bootloaderBlob = null;
  stubPatch({ internal: fixture(0x1c000, 3), external: fixture(MARIO_EXT, 4) });
  const ac = new AbortController();
  // Permissive fake: it would happily perform the external write. Only ofw.ts's own
  // between-writes check can prevent it, so this check cannot be satisfied by the
  // downstream precondition.
  const f = fakeFlasher(false);
  const inner = f.flash.bind(f);
  f.flash = async (...args) => {
    await inner(...args);
    ac.abort();
  };
  const { err } = await run({
    internal: fixture(INTERNAL_STOCK_LEN, 5),
    external: fixture(MARIO_EXT, 6),
    extFlashBytes: MARIO_EXT,
    signal: ac.signal,
    flasher: f,
  });
  assert(err, "expected a refusal, got success");
  eq(err.message, "Operation aborted", "must reuse the flasher's existing abort message");
  eq(f.writes.length, 1, "the external write must not start after an abort");
  eq(f.writes[0].bank, 1, "the one write that happened must be the internal image");
});

// =========================================================================================
// 6. Input immutability. This matters more here than in restore: this path DERIVES an image
//    from the dumps, and the caller keeps holding those same buffers — the wizard still has
//    to be able to write them out as the backup, or restore from them, after a failed flash.
// =========================================================================================
await check("the caller's stock dumps come back unmutated", async () => {
  bootloaderBlob = fixture(4096, 9);
  const internal = fixture(INTERNAL_STOCK_LEN, 77);
  const external = fixture(MARIO_EXT, 88);
  const intCopy = Uint8Array.from(internal);
  const extCopy = Uint8Array.from(external);
  // The patcher stub returns VIEWS ONTO the caller's own buffers — the harshest case: if
  // patchAndFlash's splice wrote through a view (rather than into a fresh bank-1 buffer) the
  // caller's dump would be corrupted in place.
  stubPatch({ internal: internal.subarray(0, 0x1c000), external: external.subarray(0, MARIO_EXT) });
  const { err } = await run({ internal, external, options: { bootloader: true }, extFlashBytes: MARIO_EXT });
  assert(!err, `unexpected error: ${err && err.message}`);
  bytesEq(internal, intCopy, "patchAndFlash mutated the caller's internal dump");
  bytesEq(external, extCopy, "patchAndFlash mutated the caller's external dump");
});

// --- Report -------------------------------------------------------------------------------
console.log(`\nofw-patch: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
