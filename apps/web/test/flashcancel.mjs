#!/usr/bin/env node
/**
 * STOPPING A RUNNING WRITE — the Cancel control and its confirmation.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/flashcancel.mjs'
 *
 * Drawn by docs/design/mockups/FlashingCancel.dc.html (the footer link plus its
 * `Stops after the current block` caption) and FlashingCancelConfirm.dc.html (the
 * `Keep writing` / `Stop` dialog over it).
 *
 * WHAT THIS HAS TO PROVE, AND WHY A LOOSER TEST WOULD BE WORTHLESS. The engine has taken an
 * `abortSignal` all along; what never existed was a user-reachable controller and the wiring
 * from it down to the writers. So asserting that "Stop sets a flag" would pass on a button that
 * does nothing. The engine half of this file therefore asserts at the far end: a stubbed
 * `flashImage` records the `opts` it was handed and how often it was called, and the claims are
 * about writes that did NOT happen.
 *
 * TWO SEAMS.
 *   - The STORE is compiled for node with the runes defined away, exactly as `safety.mjs` does
 *     it. Reactivity is Svelte's business; the state machine is what this asserts.
 *   - The ENGINE (`engine/flashInstall.ts`) is compiled with `./flasher.js` replaced by a
 *     recording stub, the same seam `simflash.mjs` uses. Nothing here touches a device.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwResolveFor } from "./gnwResolve.mjs";

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
/** Let pending microtasks (and the exec's first await) run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const esbuild = await import("esbuild");

// --- Seam 1: the store ----------------------------------------------------------------------
const outStore = mkdtempSync(join(tmpdir(), "gnw-flashcancel-store-"));
symlinkSync(join(repoRoot, "node_modules"), join(outStore, "node_modules"));
await esbuild.build({
  entryPoints: [join(here, "../src/lib/installProgress.svelte.ts"), join(here, "../src/lib/i18n/en.ts")],
  outdir: outStore,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
}
const { installProgress } = await import(pathToFileURL(join(outStore, "installProgress.svelte.js")).href);
const { en } = await import(pathToFileURL(join(outStore, "i18n/en.js")).href);

/**
 * Put a run into the "running" state with its exec parked, and hand back the handles.
 *
 * `confirm()` is deliberately NOT awaited: it resolves only when exec returns, and every check
 * here is about the interval while it is still going.
 */
async function running({ failWith = null } = {}) {
  const state = { signal: null, release: null };
  const parked = new Promise((r) => { state.release = r; });
  const runPromise = installProgress.run({
    title: "Install",
    phases: [{ id: "flash", label: "Flash" }],
    exec: async (r) => {
      state.signal = r.signal;
      r.start("flash");
      await parked;
      if (failWith) throw new Error(failWith);
      // How a real writer unwinds: whichever abort check saw the flag first throws.
      if (r.signal.aborted) throw new Error("Operation aborted");
    },
  });
  const confirmed = installProgress.confirm();
  await settle();
  return { ...state, runPromise, confirmed };
}

console.log("\n-- the store --");

await check("exec is handed a signal, and it is not aborted", async () => {
  const h = await running();
  assert(h.signal instanceof AbortSignal, "reporter.signal is an AbortSignal");
  eq(h.signal.aborted, false, "a fresh run starts un-aborted");
  h.release();
  await h.confirmed;
  installProgress.close();
  await h.runPromise;
});

await check("asking does not abort: requestCancel only opens the question", async () => {
  const h = await running();
  eq(installProgress.cancelPrompt, false, "no question before it is asked");
  installProgress.requestCancel();
  eq(installProgress.cancelPrompt, true, "the question is up");
  // THE POINT OF THE PAIR. A Cancel that aborted on the first press would make the confirmation
  // decorative, and this is the assertion that would catch that.
  eq(h.signal.aborted, false, "merely asking has not aborted the run");
  eq(installProgress.cancelling, false, "nor marked it as stopping");
  installProgress.dismissCancel();
  h.release();
  await h.confirmed;
  installProgress.close();
  await h.runPromise;
});

await check("Keep writing does not abort, and the run finishes normally", async () => {
  const h = await running();
  installProgress.requestCancel();
  installProgress.dismissCancel();
  eq(installProgress.cancelPrompt, false, "the question is gone");
  eq(h.signal.aborted, false, "dismissing left the run alone");
  h.release();
  await h.confirmed;
  eq(installProgress.modalPhase, "done", "a dismissed question changes nothing about the outcome");
  installProgress.close();
  await h.runPromise;
});

await check("Stop aborts the signal exec is holding", async () => {
  const h = await running();
  installProgress.requestCancel();
  installProgress.confirmCancel();
  eq(h.signal.aborted, true, "the signal exec holds is the one Stop aborts");
  eq(installProgress.cancelPrompt, false, "the question closes");
  eq(installProgress.cancelling, true, "and the footer has something to say meanwhile");
  h.release();
  await h.confirmed;
  installProgress.close();
  await h.runPromise;
});

await check("a stopped run lands in `cancelled`, not `error`", async () => {
  const h = await running();
  installProgress.requestCancel();
  installProgress.confirmCancel();
  h.release();
  await h.confirmed;
  eq(installProgress.modalPhase, "cancelled", "a stop is neither success nor failure");
  eq(installProgress.error, null, "and sets no error message");
  installProgress.close();
  await h.runPromise;
});

await check("a REAL failure still lands in `error` when nothing was aborted", async () => {
  // ANTI-VACUITY for the check above: if the catch treated every throw as a cancel, the
  // previous check would pass on a store that had lost error reporting entirely.
  const h = await running({ failWith: "the programmer fell off" });
  h.release();
  await h.confirmed;
  eq(installProgress.modalPhase, "error", "an ordinary failure is still a failure");
  eq(installProgress.error, "the programmer fell off", "with its own message");
  installProgress.close();
  await h.runPromise;
});

await check("the NEXT run gets a fresh signal, not the stopped one", async () => {
  // The store holds one long-lived `reporter`. A signal captured into it once would leave every
  // run after the first pre-aborted, and nothing would ever write again.
  const first = await running();
  installProgress.requestCancel();
  installProgress.confirmCancel();
  first.release();
  await first.confirmed;
  installProgress.close();
  await first.runPromise;

  const second = await running();
  eq(second.signal.aborted, false, "the second run is not born aborted");
  assert(second.signal !== first.signal, "and it is a different signal object");
  eq(installProgress.cancelling, false, "the stopping flag was reset");
  second.release();
  await second.confirmed;
  eq(installProgress.modalPhase, "done", "so it can actually complete");
  installProgress.close();
  await second.runPromise;
});

await check("requestCancel is inert outside a running operation", async () => {
  installProgress.cancelPrompt = false;
  installProgress.requestCancel();
  eq(installProgress.cancelPrompt, false, "nothing to stop, nothing to ask");
});

await check("the copy the boards draw exists in the table", () => {
  const t = en.shared.installProgressModal;
  eq(t.cancelCaption, "Stops after the current block", "FlashingCancel.dc.html:85's caption, verbatim");
  eq(t.cancelKeep, "Keep writing", "FlashingCancelConfirm.dc.html's quiet action");
  eq(t.cancelStop, "Stop", "and its destructive one");
  for (const k of ["cancelTitle", "cancelBody", "cancelPending", "cancelledNote", "logStopping", "logStopped"]) {
    assert(typeof t[k] === "string" && t[k].length > 0, `${k} is present`);
  }
  // The board's body names bank 2 and asserts bank 1 is untouched. That is true of a Retro-Go
  // install and false of an OFW patch flash, which writes bank 1 — so the shipped copy must NOT
  // have copied it. See the key's own comment, and docs/BLOCKED-AUDIT.md Q20.
  assert(!/bank/i.test(t.cancelBody), "the generic body must not claim anything about a bank");
});

// --- Seam 2: the engine ---------------------------------------------------------------------
console.log("\n-- the abort reaches the writer --");

const outEng = mkdtempSync(join(tmpdir(), "gnw-flashcancel-eng-"));
symlinkSync(join(repoRoot, "node_modules"), join(outEng, "node_modules"));

// The recording stub, bundled in (simflash.mjs's pattern). It records onto a global rather than
// exporting an array, because the stub lives inside the bundle and the suite outside it.
globalThis.__flashCalls = [];
const FLASH_STUB = `
export async function flashImage(_f, bank, offset, data, _p, _l, opts) {
  globalThis.__flashCalls.push({ bank, offset, len: data.length, opts });
  if (opts?.abortSignal?.aborted) throw new Error("Operation aborted");
}
`;
const resetCalls = () => { globalThis.__flashCalls.length = 0; };
const calls = () => globalThis.__flashCalls;

await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/flashInstall.ts")],
  outdir: outEng,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      // `?url` asset imports have no meaning outside Vite. Nothing here builds an image, so the
      // value is never read -- only its absence would break the import.
      name: "url-assets",
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "url-asset" }));
        b.onLoad({ filter: /.*/, namespace: "url-asset" }, () => ({
          contents: `export default "asset:unused-by-this-suite";`,
          loader: "js",
        }));
      },
    },
    {
      name: "stub-patch",
      setup(b) {
        b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "st" }));
        b.onLoad({ filter: /^patch-stub$/, namespace: "st" }, () => ({
          contents: `export async function loadLiblzma(){ return () => { throw new Error("nothing here compresses"); }; }`,
          loader: "js",
        }));
      },
    },
    {
      name: "stub-flasher",
      setup(b) {
        b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "flash", namespace: "st" }));
        b.onLoad({ filter: /^flash$/, namespace: "st" }, () => ({ contents: FLASH_STUB, loader: "js" }));
      },
    },
  ],
});
const { flashInstallToDevice, flashFrogfsRegion } = await import(pathToFileURL(join(outEng, "flashInstall.js")).href);

/** A minimal FlashInstall: three regions, each one small buffer. */
const install = () => ({
  bank: 2,
  sdCard: false,
  intflash: new Uint8Array(16),
  frogfs: new Uint8Array(16),
  littlefs: new Uint8Array(16),
  layout: { frogfsOffset: 0x1000, littlefsOffset: 0x2000 },
});

await check("a pre-aborted signal writes nothing at all", async () => {
  resetCalls();
  const ac = new AbortController();
  ac.abort();
  let threw = null;
  try {
    await flashInstallToDevice(null, install(), undefined, undefined, undefined, undefined, ac.signal);
  } catch (e) { threw = e; }
  assert(threw, "an aborted install rejects rather than returning quietly");
  eq(calls().length, 0, "and not one byte was handed to the writer");
});

await check("with no signal, all three regions are written", async () => {
  // ANTI-VACUITY: without this, the check above would pass on a `flashInstallToDevice` that
  // never wrote anything under any circumstances.
  resetCalls();
  await flashInstallToDevice(null, install());
  eq(calls().length, 3, "intflash, frogfs, littlefs");
});

await check("aborting after the first region stops the rest", async () => {
  resetCalls();
  const ac = new AbortController();
  const onRegion = (region, event) => {
    // Stop the way a user does: mid-run, between one region finishing and the next starting.
    if (region === "intflash" && event === "done") ac.abort();
  };
  let threw = null;
  try {
    await flashInstallToDevice(null, install(), undefined, undefined, undefined, onRegion, ac.signal);
  } catch (e) { threw = e; }
  assert(threw, "the run rejects");
  eq(calls().length, 1, "only the region that was already writing");
});

await check("the signal reaches flashImage's opts, not just the region loop", async () => {
  // The loop's own `aborted` check would pass this file while the signal was never forwarded
  // INTO the writer — and the writer is the only thing that can stop mid-region, at a 256 KiB
  // block boundary. This asserts the forwarding, which is the half a region-level check misses.
  resetCalls();
  const ac = new AbortController();
  await flashInstallToDevice(null, install(), undefined, undefined, undefined, undefined, ac.signal);
  eq(calls().length, 3, "everything was written");
  for (const c of calls()) {
    assert(c.opts?.abortSignal === ac.signal, `region at 0x${c.offset.toString(16)} got the signal`);
  }
});

await check("flashFrogfsRegion forwards the signal too", async () => {
  resetCalls();
  const ac = new AbortController();
  await flashFrogfsRegion(null, new Uint8Array(16), { frogfsOffset: 0x1000, ceilingOffset: 0x9000 },
    undefined, undefined, ac.signal);
  eq(calls().length, 1, "one write");
  assert(calls()[0].opts?.abortSignal === ac.signal, "carrying the caller's signal");
});

console.log(`\nflashcancel: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
