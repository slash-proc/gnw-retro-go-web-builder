#!/usr/bin/env node
/**
 * Offline coverage for `restoreStock()` (src/lib/engine/ofw.ts) — the most destructive
 * operation in the app, and the only thing Guided Setup offers on a sub-8 MB chip.
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/ofw-restore.mjs'
 *
 * Plain node, no framework (repo convention — see src/lib/sources/test/validate.mjs).
 * NOTHING here touches a device: the only fake is a stand-in for `GnwFlasher`, injected
 * where the real one would be passed in. Everything above it is the real shipping code
 * path — restoreStock -> engine/flasher.ts's flashImage -> flasher.flash(...) — so the
 * write plan under test is the one that would run on hardware.
 *
 * Why a fake at the GnwFlasher boundary and not at flashImage: flashImage is where the
 * retry/watchdog/compression policy lives and where the abort signal is re-checked, so
 * stubbing it out would have hidden exactly the layer these guards depend on.
 *
 * The abort case goes one layer deeper still and uses the REAL GnwFlasher from
 * @gnw/gnw-flasher over a transport that throws on any access, because the abort
 * precondition genuinely lives there (packages/gnw-flasher/src/index.ts: `flash()` and
 * `program()` both throw "Operation aborted" before touching the bus).
 */
import { mkdtempSync, symlinkSync, readFileSync } from "node:fs";
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
async function throwsWith(re, fn) {
  let threw;
  try {
    await fn();
  } catch (e) {
    threw = e;
  }
  assert(threw, `expected a refusal matching ${re}, got success`);
  assert(re.test(threw.message), `wrong refusal: ${threw.message}`);
  return threw;
}

// --- Browser shims the engine module graph needs at import/run time ----------------------
// engine/lzma.ts's preloadLzma() injects a <script> and waits for window.LZMA; pre-seeding
// window.LZMA makes it resolve immediately without loading anything. debug.ts POSTs log
// lines fire-and-forget. Neither is under test; both must simply not explode in node.
globalThis.window = { LZMA: { compress: (d) => [...new Uint8Array(13), ...Uint8Array.from(d)] } };
globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };
globalThis.fetch = async () => {
  throw new Error("fetch() is not available offline — nothing under test should call it");
};
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// --- Compile the TypeScript under test --------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-ofw-restore-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
import { gnwImport, gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/ofw.ts"), join(here, "../src/lib/engine/restoreGuards.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // @gnw/* stays external and is resolved by node through the link above, so the code
  // under test runs against the real built packages rather than a re-bundled copy.
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      // Vite's `?url` asset imports (firmware.bin, the bootloader blob, the LZMA worker)
      // become plain strings. restoreStock never fetches any of them.
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
      // engine/patch.ts drags in the WASM patcher. restoreStock patches nothing (that is
      // the whole point of it), so the module is stubbed rather than instantiated.
      name: "stub-patch",
      setup(b) {
        b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: `export async function patchModel(){ throw new Error("patchModel must not be reached"); }`,
          loader: "js",
        }));
      },
    },
  ],
});
const { restoreStock } = await import(pathToFileURL(join(out, "ofw.js")).href);
const { evaluateRestore } = await import(pathToFileURL(join(out, "restoreGuards.js")).href);

// --- The fake flasher -------------------------------------------------------------------
/**
 * Stands in for GnwFlasher. Records every write it is asked to perform, keeps a verbatim
 * copy of the bytes handed to it, and reports progress the way the real one does (per
 * 256 KiB chunk, then a final exact total).
 */
/* `honourAbort` mirrors the real flasher's own precondition. Passing false removes it so a
 * test can prove restoreStock's OWN abort check is what stopped the write — with the
 * precondition in place, dropping the check in ofw.ts leaves this suite green (verified by
 * mutation). */
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

/** Deterministic non-uniform fixture bytes — a memcpy bug or an off-by-one shows up. */
const fixture = (len, seed) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) & 0xff);

const INTERNAL_LEN = 0x20000; // 128 KiB stock internal image
const ZELDA_EXT = 4 * 1024 * 1024;
const MARIO_EXT = 1 * 1024 * 1024;

/** Run restoreStock and collect both the writes and every progress report. */
async function run(internal, external, extFlashBytes, signal, flasher) {
  const f = flasher || fakeFlasher();
  const reports = [];
  const err = await restoreStock(
    f,
    internal,
    external,
    (done, total, sub) => reports.push({ done, total, sub: sub && { ...sub } }),
    signal,
    extFlashBytes,
  ).then(
    () => null,
    (e) => e,
  );
  return { f, reports, err };
}

// --- 1. Capacity guard ------------------------------------------------------------------
// On hardware a failure here means a 4 MB Zelda backup starts writing onto a 1 MB Mario
// chip: the internal image lands first, then the external write dies partway, leaving a
// device with neither firmware intact.
await check("capacity guard refuses a 4 MB external backup on a 1 MB chip", async () => {
  const { f, err, reports } = await run(fixture(INTERNAL_LEN, 1), fixture(ZELDA_EXT, 2), MARIO_EXT);
  assert(err, "expected a refusal, got success");
  assert(/won't fit/.test(err.message), `unexpected error: ${err.message}`);
  eq(f.writes.length, 0, "the guard must refuse BEFORE any write is issued");
  eq(reports.length, 0, "no progress should be reported for a refused restore");
});

await check("capacity guard allows an exact fit and is disabled when the size is unknown", async () => {
  const ext = fixture(MARIO_EXT, 3);
  const exact = await run(fixture(INTERNAL_LEN, 1), ext, MARIO_EXT);
  assert(!exact.err, `exact fit must be allowed: ${exact.err && exact.err.message}`);
  eq(exact.f.writes.length, 2, "exact fit should write both images");
  // extFlashBytes = 0 means "device size unknown" and the guard is skipped by design.
  const unknown = await run(fixture(INTERNAL_LEN, 1), fixture(ZELDA_EXT, 2), 0);
  assert(!unknown.err, "extFlashBytes=0 must skip the guard");
  eq(unknown.f.writes.length, 2, "unknown-size restore should still write both images");
});

// --- 2. Write order and targets ---------------------------------------------------------
// Order is what makes a partial failure survivable: internal (the stock reset vector) first,
// so a device that dies during the long external write still boots stock firmware.
await check("writes internal -> bank 1 @ 0, then external -> bank 0 @ 0", async () => {
  const { f, err } = await run(fixture(INTERNAL_LEN, 1), fixture(MARIO_EXT, 3), MARIO_EXT);
  assert(!err, `unexpected error: ${err && err.message}`);
  eq(f.writes.length, 2, "expected exactly two writes");
  eq(f.writes[0].bank, 1, "first write must target bank 1 (internal)");
  eq(f.writes[0].offset, 0, "first write must be at offset 0");
  eq(f.writes[0].bytes.length, INTERNAL_LEN, "first write must be the internal image");
  eq(f.writes[1].bank, 0, "second write must target bank 0 (external)");
  eq(f.writes[1].offset, 0, "second write must be at offset 0");
  eq(f.writes[1].bytes.length, MARIO_EXT, "second write must be the external image");
});

await check("an empty external image is skipped entirely", async () => {
  const { f, err } = await run(fixture(INTERNAL_LEN, 1), new Uint8Array(0), MARIO_EXT);
  assert(!err, `unexpected error: ${err && err.message}`);
  eq(f.writes.length, 1, "an empty external image must not produce a bank 0 write");
  eq(f.writes[0].bank, 1, "the one write must be the internal image");
});

// --- 3. Progress accounting -------------------------------------------------------------
// A wrong offset here makes the progress bar jump backwards mid-restore, on the one
// operation where a user watching a stalled-looking bar might unplug the device.
await check("overall progress is monotonic, totals both images, and offsets the second write", async () => {
  const internal = fixture(INTERNAL_LEN, 1);
  const external = fixture(MARIO_EXT, 3);
  const { reports, err } = await run(internal, external, MARIO_EXT);
  assert(!err, `unexpected error: ${err && err.message}`);
  const total = internal.length + external.length;
  for (const r of reports) eq(r.total, total, "every report's total must be internal.length + external.length");

  const intReports = reports.filter((r) => r.sub.label === "internal → bank 1");
  const extReports = reports.filter((r) => r.sub.label === "external → bank 0");
  eq(intReports.length + extReports.length, reports.length, "unexpected sub-bar label");
  assert(intReports.length > 0 && extReports.length > 0, "both phases must report progress");

  // Phase 1: overall done == sub-bar value; sub-bar max is that image's own length.
  for (const r of intReports) {
    eq(r.sub.max, internal.length, "internal sub-bar max");
    eq(r.done, r.sub.value, "internal phase overall progress must equal its sub progress");
  }
  // Phase 2: overall done == internal.length + sub-bar value.
  for (const r of extReports) {
    eq(r.sub.max, external.length, "external sub-bar max");
    eq(r.done, internal.length + r.sub.value, "external phase must be offset by internal.length");
  }
  eq(intReports[intReports.length - 1].done, internal.length, "internal phase must finish at internal.length");
  eq(extReports[extReports.length - 1].done, total, "external phase must finish at the grand total");

  let prev = -1;
  for (const r of reports) {
    assert(r.done >= prev, `progress went backwards: ${prev} -> ${r.done}`);
    assert(r.done <= r.total, `progress exceeded the total: ${r.done} > ${r.total}`);
    prev = r.done;
  }
});

// --- 4. Nothing is patched or recomputed ------------------------------------------------
// This is the property that makes restoreStock the inverse of dumpBackup. If anything here
// rewrote a byte, a hash-validated genuine stock backup would go back onto the device as
// something that is no longer stock.
await check("the bytes handed in are the bytes written, for both images", async () => {
  const internal = fixture(INTERNAL_LEN, 11);
  const external = fixture(MARIO_EXT, 22);
  const intCopy = Uint8Array.from(internal);
  const extCopy = Uint8Array.from(external);
  const { f, err } = await run(internal, external, MARIO_EXT);
  assert(!err, `unexpected error: ${err && err.message}`);
  bytesEq(f.writes[0].bytes, intCopy, "internal image was modified on the way to the device");
  bytesEq(f.writes[1].bytes, extCopy, "external image was modified on the way to the device");
  // ...and the caller's own buffers must come back untouched too.
  bytesEq(internal, intCopy, "restoreStock mutated the caller's internal buffer");
  bytesEq(external, extCopy, "restoreStock mutated the caller's external buffer");
});

// --- 5. Abort ---------------------------------------------------------------------------
// Two halves, because the refusal is a collaboration: restoreStock/flashImage forward the
// signal, and GnwFlasher is what actually refuses.
await check("an already-aborted signal produces no writes", async () => {
  const ac = new AbortController();
  ac.abort();
  // Permissive fake: only restoreStock's own guard can stop this write.
  const { f, err } = await run(
    fixture(INTERNAL_LEN, 1), fixture(MARIO_EXT, 3), MARIO_EXT, ac.signal, fakeFlasher(false),
  );
  assert(err, "expected a refusal, got success");
  eq(f.writes.length, 0, "an aborted restore must not write anything");
});

await check("the real GnwFlasher refuses an aborted flash before touching the transport", async () => {
  const { GnwFlasher } = await gnwImport(import.meta.url, "gnw-flasher");
  let touched = 0;
  const transport = new Proxy(
    {},
    {
      get() {
        touched++;
        return () => {
          throw new Error("transport must not be touched for an aborted operation");
        };
      },
    },
  );
  const ac = new AbortController();
  ac.abort();
  await throwsWith(/aborted/i, () =>
    new GnwFlasher(transport).flash(1, 0, fixture(1024, 5), { abortSignal: ac.signal }),
  );
  eq(touched, 0, "an aborted flash must not reach the SWD transport at all");
});


await check("an abort raised between the two writes leaves exactly one write issued", async () => {
  // restoreStock's OWN between-writes check, not the flasher's: the fake completes the
  // internal write and only then aborts, so nothing downstream has a chance to refuse.
  const ac = new AbortController();
  const f = fakeFlasher(false); // permissive: it would happily do the external write
  const inner = f.flash.bind(f);
  f.flash = async (...args) => {
    await inner(...args);
    ac.abort();
  };
  const err = await restoreStock(
    f,
    fixture(INTERNAL_LEN, 1),
    fixture(MARIO_EXT, 3),
    () => {},
    ac.signal,
    MARIO_EXT,
  ).then(() => null, (e) => e);
  assert(err, "expected a refusal, got success");
  eq(err.message, "Operation aborted", "must reuse the flasher's existing abort message");
  eq(f.writes.length, 1, "the external write must not start after an abort");
  eq(f.writes[0].bank, 1, "the one write that happened must be the internal image");
});

// --- 6. Restore guards (engine/restoreGuards.ts) ----------------------------------------
// Extracted out of Wizard.svelte so the decision the UI makes before offering this write is
// reachable by a test at all. Facts in, verdict out.
const backupFacts = (over = {}) => ({
  model: "mario",
  internalOk: true,
  externalOk: true,
  externalLength: MARIO_EXT,
  ...over,
});

await check("both dumps must validate: half-valid pairs and a missing pair are refused", () => {
  const dev = { model: "mario", extFlashBytes: MARIO_EXT };
  const ok = evaluateRestore(backupFacts(), dev);
  eq(ok.valid, true, "a fully valid pair must be valid");
  eq(ok.refusal, null, "a fully valid pair on matching hardware must not be refused");
  eq(ok.allowed, true, "a fully valid pair must be allowed");
  for (const half of [{ internalOk: false }, { externalOk: false }, { internalOk: false, externalOk: false }]) {
    const v = evaluateRestore(backupFacts(half), dev);
    eq(v.valid, false, `half-valid pair ${JSON.stringify(half)} must not be valid`);
    eq(v.refusal, "no-backup", "a half-valid pair reports as no usable backup");
    eq(v.allowed, false, "a half-valid pair must not be allowed");
  }
  const none = evaluateRestore(null, dev);
  eq(none.valid, false, "no selection is not valid");
  eq(none.refusal, "no-backup", "no selection reports as no usable backup");
  eq(none.allowed, false, "no selection must not be allowed");
});

await check("a Zelda backup onto Mario hardware is refused as wrong-hardware", () => {
  // Mario physically lacks two of the buttons Zelda's firmware needs. In Guided Setup this
  // is final; the Advanced path is where an expert may acknowledge and override it.
  const v = evaluateRestore(
    backupFacts({ model: "zelda", externalLength: ZELDA_EXT }),
    { model: "mario", extFlashBytes: ZELDA_EXT },
  );
  eq(v.valid, true, "the backup itself is still a genuine stock pair");
  eq(v.refusal, "wrong-hardware", "the model mismatch must be the reported refusal");
  eq(v.allowed, false, "wrong hardware must not be allowed");
  // Wrong-hardware outranks the capacity guard when a Zelda image also overflows the chip —
  // the same precedence the Wizard's else-if chain has always rendered.
  const both = evaluateRestore(
    backupFacts({ model: "zelda", externalLength: ZELDA_EXT }),
    { model: "mario", extFlashBytes: MARIO_EXT },
  );
  eq(both.refusal, "wrong-hardware", "wrong-hardware takes precedence over too-big");
});

await check("matching backups are allowed, and Mario-on-Zelda is not a hardware refusal", () => {
  const mario = evaluateRestore(backupFacts(), { model: "mario", extFlashBytes: MARIO_EXT });
  eq(mario.refusal, null, "Mario backup on Mario hardware must be allowed");
  eq(mario.allowed, true, "Mario backup on Mario hardware must be allowed");
  const zelda = evaluateRestore(
    backupFacts({ model: "zelda", externalLength: ZELDA_EXT }),
    { model: "zelda", extFlashBytes: ZELDA_EXT },
  );
  eq(zelda.refusal, null, "Zelda backup on Zelda hardware must be allowed");
  eq(zelda.allowed, true, "Zelda backup on Zelda hardware must be allowed");
  // Only mario-hardware/zelda-backup is guarded; the reverse direction is not refused here.
  const reverse = evaluateRestore(backupFacts(), { model: "zelda", extFlashBytes: ZELDA_EXT });
  eq(reverse.refusal, null, "a Mario backup on Zelda hardware is not a wrong-hardware refusal");
});

await check("capacity: overflow refused, exact fit allowed, unknown size skips the guard", () => {
  const big = backupFacts({ externalLength: ZELDA_EXT });
  const over = evaluateRestore(big, { model: "zelda", extFlashBytes: MARIO_EXT });
  eq(over.refusal, "too-big", "an oversized external image must be refused");
  eq(over.allowed, false, "an oversized external image must not be allowed");
  const exact = evaluateRestore(big, { model: "zelda", extFlashBytes: ZELDA_EXT });
  eq(exact.refusal, null, "an exact fit must be allowed");
  // extFlashBytes = 0 means the device size is unknown; the guard is skipped by design, the
  // same way restoreStock's own capacity guard is.
  const unknown = evaluateRestore(big, { model: "unknown", extFlashBytes: 0 });
  eq(unknown.refusal, null, "unknown external-flash size must skip the capacity guard");
  eq(unknown.allowed, true, "unknown external-flash size must still allow the restore");
  // ...but an unknown DEVICE model with a known size still gets the capacity guard.
  const unknownModel = evaluateRestore(big, { model: "unknown", extFlashBytes: MARIO_EXT });
  eq(unknownModel.refusal, "too-big", "an unknown model does not disable the capacity guard");
});

// --- 7. Return to Stock reads the REMEMBERED folder ---------------------------------------
// The owner: "The 'Return to Stock' path's 'Select Backup of Original Firmware' isn't reading
// the backup folder like the rest of the UI does." It went straight to `pickBackupFolder()`, so
// it was the one surface that ignored the folder the Firmware tab stores and the Status row
// reports out of, and made the user go find it again.
//
// Source-shape assertions: `Wizard.svelte` is a component and every suite here stubs runes as
// identity functions, so the effect cannot be driven. If this markup is restructured these must
// be re-read rather than trusted.
const wizSrc = readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8");
const wizCode = wizSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const bpSrc = readFileSync(join(here, "../src/lib/backupPresence.svelte.ts"), "utf8");

await check("Return to Stock adopts the remembered backup folder", async () => {
  assert(/backupPresence/.test(wizCode), "the wizard consults the shared backup-folder store");
  assert(/backupPresence\.adopted\(\)/.test(wizCode),
    "it adopts the remembered folder rather than only offering a picker");
  assert(/pickBackupFolder\(\)/.test(wizCode),
    "the folder picker survives -- adopting a folder is not being stuck with it");
});

await check("the adopted folder is hash-validated, not probed", async () => {
  assert(/readRestoreDir/.test(wizCode), "adopted and picked folders go through one reader");
  const reader = (wizCode.match(/async function readRestoreDir\([^)]*\)\s*\{([\s\S]*?)\n  \}/) || [])[1] || "";
  assert(reader.length > 0, "precondition: readRestoreDir was found");
  assert(/scanBackupFolder/.test(reader),
    "the restore step hash-validates: it is about to write these bytes to a device");
  assert(/defaultBackup/.test(reader), "and picks the pair matching the connected hardware");
});

await check("adoption is silent and reads the one remembered-folder key", async () => {
  const adopted = (bpSrc.match(/async adopted\(\)[\s\S]*?\n  \}/) || [""])[0];
  assert(adopted.length > 0, "precondition: adopted() was found");
  assert(/handlePermission\(handle, "readwrite", false\)/.test(adopted),
    "adoption never raises a permission prompt");
  assert(/HANDLE_KEY/.test(adopted), "it reads the one remembered-folder key, not a second one");
});

// --- Report -----------------------------------------------------------------------------
console.log(`\nofw-restore: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
