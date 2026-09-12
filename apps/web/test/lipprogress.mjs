/**
 * The face-plate lip as an SWD progress bar (no hardware, no device access).
 *
 * Drives the REAL DapjsTransport against a fake injected CortexM, so the events under test are
 * produced by the same code path a device drives. The store is exercised directly, because
 * runes are stubbed as identity functions in this repo's suites and no node test can prove a
 * `$state` write reaches the DOM.
 *
 * The invariants, in the order they matter:
 *  1. The heartbeat never moves the bar. The liveness poll pings with `readWord`
 *     (`engine/flasher.ts`'s pingTarget/isStubAlive); only bulk transfers report.
 *  2. A real read and a real write both move it, and it reaches 100%.
 *  3. It clears once the link goes quiet.
 *  4. NO EXTRA DEVICE TRANSACTION per chunk. This repo has already paid for that regression
 *     once (a per-chunk read-back verify that roughly tripled transactions and caused a
 *     months-long "flashing got slower and jankier" report), so it is guarded explicitly by
 *     counting the fake's trace with and without an observer installed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gnwImport } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { DapjsTransport, setTransferObserver } = await gnwImport(import.meta.url, "@gnw/swd-transport");

// The store itself, for the operation checks below. Runes stubbed as identity functions, the
// same way every other suite here does it; `lipProgress` holds plain values, so that is enough.
const { mkdtempSync, symlinkSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { pathToFileURL } = await import("node:url");
const esbuild = await import("esbuild");
const lipOut = mkdtempSync(join(tmpdir(), "gnw-lip-"));
symlinkSync(join(here, "../../../node_modules"), join(lipOut, "node_modules"));
await esbuild.build({
  entryPoints: [join(here, "../src/lib/lipProgress.svelte.ts")],
  outfile: join(lipOut, "lipProgress.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});
const { lipProgress } = await import(pathToFileURL(join(lipOut, "lipProgress.js")).href);

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error("  FAIL", msg);
  }
};
const eq = (a, b, msg) => check(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const DHCSR = 0xe000edf0;

/** Fake dapjs CortexM: counts every access so a per-chunk regression is visible. */
function makeCortexM() {
  const trace = [];
  return {
    trace,
    async connect() {},
    async readMem32(addr) {
      trace.push(["rw", addr]);
      return addr === DHCSR ? 1 << 17 : 0;
    },
    async writeMem32(addr) {
      trace.push(["ww", addr]);
    },
    async readBlock(addr, len) {
      trace.push(["rb", addr, len]);
      return new Uint8Array(len);
    },
    async writeBlock(addr, data) {
      trace.push(["wb", addr, data.length]);
    },
    async readCoreRegister() {
      return 0;
    },
    async writeCoreRegister() {},
  };
}

const events = [];
const record = (ev) => events.push(ev);

// --- 1. Only BULK transfers report -----------------------------------------------------------
{
  setTransferObserver(record);
  events.length = 0;
  const core = makeCortexM();
  const t = new DapjsTransport(core);

  // The heartbeat's two calls, verbatim in shape: pingTarget and isStubAlive both readWord.
  await t.readWord(0xe000ed00);
  await t.readWord(0x24000000);
  eq(events.length, 0, "the heartbeat's readWord pings emit nothing");

  await t.writeWord(0x24000000, 1);
  eq(events.length, 0, "a single-word write emits nothing either");

  await t.readMemory(0x24000000, 4096);
  check(events.length > 0, "a bulk read emits");
  eq(events[0].kind, "read", "the first bulk-read event is a read");
  eq(events[0].done, 0, "a transfer announces at 0 so the bar appears when it starts");
  eq(events[0].total, 4096, "the total is the transfer's length");
  eq(events[events.length - 1].done, 4096, "the last event is complete");

  events.length = 0;
  await t.writeMemory(0x24000000, new Uint8Array(2048));
  check(events.length > 0, "a bulk write emits");
  eq(events[0].kind, "write", "a bulk write reports as a write");
  eq(events[events.length - 1].done, 2048, "the bulk write completes");
  setTransferObserver(null);
}

// --- 2. The observer costs NO device traffic -------------------------------------------------
// The regression this repo already paid for. Same transfer, once with an observer and once
// without: the fake's trace must be identical, not merely similar.
{
  const bare = makeCortexM();
  setTransferObserver(null);
  await new DapjsTransport(bare).readMemory(0x24000000, 8192);

  const watched = makeCortexM();
  setTransferObserver(record);
  events.length = 0;
  await new DapjsTransport(watched).readMemory(0x24000000, 8192);
  setTransferObserver(null);

  eq(watched.trace.length, bare.trace.length, "observing adds no device transaction");
  eq(
    JSON.stringify(watched.trace),
    JSON.stringify(bare.trace),
    "the transaction trace is byte-identical with an observer installed",
  );
  check(events.length > 1, "and the observer did in fact see the transfer it cost nothing to watch");

  // The comparison above only proves the OBSERVER is free -- a per-chunk read-back added to the
  // transfer itself would appear in both traces and pass it. So pin the ABSOLUTE shape: a
  // 8192-byte read at the 1024-byte CHUNK is exactly 8 block reads and nothing else. This is
  // the regression CLAUDE.md documents (a per-chunk read-back verify roughly tripled the
  // transaction count and caused a months-long "flashing got slower and jankier" report).
  eq(watched.trace.length, 8, "a 8192-byte read is exactly 8 device transactions, one per chunk");
  eq(
    watched.trace.filter(([op]) => op === "rb").length,
    8,
    "all 8 are block reads: no per-chunk word read has crept in beside them",
  );
  eq(
    watched.trace.filter(([op]) => op !== "rb").length,
    0,
    "and nothing else touches the device during a plain bulk read",
  );
}

// --- 3. An observer that throws must not fail the transfer -----------------------------------
{
  setTransferObserver(() => {
    throw new Error("a UI mirror blew up");
  });
  const core = makeCortexM();
  let threw = null;
  try {
    await new DapjsTransport(core).readMemory(0x24000000, 2048);
  } catch (e) {
    threw = e;
  }
  setTransferObserver(null);
  eq(threw, null, "a throwing observer never breaks a device transfer");
}

// --- 4. The store's own arithmetic -----------------------------------------------------------
// Exercised through the real module, with the runes stub these suites use.
{
  const src = readFileSync(join(here, "../src/lib/lipProgress.svelte.ts"), "utf8");
  // Comments FIRST. This module's docblock names pingTarget/isStubAlive to explain why the
  // heartbeat is excluded, and an unstripped corpus would let that explanation satisfy the very
  // check that exists to catch the code doing it -- the documented failure mode in
  // .claude/.../memory/mutation-verification-failure-modes.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^[ \t]*\/\//.test(l))
    .join("\n");

  check(
    !/pingTarget|isStubAlive|isPoll|fromPoll|isHeartbeat/.test(code),
    "the heartbeat is excluded structurally, not by recognising the poll by name",
  );
  check(
    /setTransferObserver/.test(code),
    "the store is fed by the transport's observer rather than by a per-flow reporter",
  );

  // The fill is per transfer, and the module must say so rather than summing a burst.
  check(
    /per\s+transfer/i.test(src),
    "the per-transfer limit is stated in the module, not left for a reader to discover",
  );
}

// --- 5. The lip stays one 3px row -------------------------------------------------------------
// GF3 records the lip as "3px constant height, fill-swap only". A progress bar that grew the row
// would shift the whole page every time a transfer started.
{
  const app = readFileSync(join(here, "../src/App.svelte"), "utf8");
  const stripped = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

  const lipRule = stripped.slice(stripped.indexOf("\n  .lip {"), stripped.indexOf("\n  .lip-fill"));
  check(/height:\s*3px/.test(lipRule), "the lip row is 3px");
  check(!/height:\s*[^3]/.test(lipRule.replace(/height:\s*3px/, "")), "the lip row has one height");

  const fillRule = stripped.slice(stripped.indexOf("\n  .lip-fill {"));
  check(/height:\s*100%/.test(fillRule.slice(0, 200)), "the fill fills the row rather than setting its own height");
  check(/width:\s*100%/.test(fillRule.slice(0, 200)), "at rest the fill is the whole row, so the lip looks as the boards draw it");

  // The fill's width is the only thing the progress state drives.
  check(
    /lipProgress\.active\s*\?/.test(stripped) && /width:\s*\$\{lipProgress\.percent\}%/.test(stripped),
    "the progress state drives the fill's width and nothing else",
  );
  check(
    /class:hazard=\{deviceSafety\.unsafe\}/.test(stripped),
    "the unsafe stripe still paints, on the fill",
  );
}

// --- an operation owns the lip, and its transfers do not fight it -----------------------------
// The per-transfer fill is right for ONE long transfer and wrong for an operation built from
// hundreds of small ones: a device scan issues ~1400 reads, so the lip swept ~1400 times for a
// single 6.5 s scan and the owner read that as the app scanning over and over. The reads ARE the
// sweeps, which is why this cannot be fixed by smoothing or debouncing.
{
  lipProgress.reset();
  lipProgress.operationProgress("scan", 0.25);
  eq(lipProgress.percent, 25, "an operation drives the lip");

  // The transfers the operation itself issues must be ignored, or they overwrite it instantly.
  lipProgress.observe({ kind: "read", done: 32, total: 32 });
  eq(lipProgress.percent, 25, "a transfer during an operation does not move the lip");

  lipProgress.operationProgress("scan", 0.8);
  eq(lipProgress.percent, 80, "the operation keeps driving it");

  // Nested: an install that rescans at the end is still one thing from where the user stands,
  // so the inner operation must not steal the lip, nor release it when IT finishes.
  lipProgress.operationProgress("install", 0.1);
  eq(lipProgress.percent, 80, "a nested operation does not steal the lip");
  lipProgress.operationProgress("install", null);
  eq(lipProgress.percent, 80, "an inner operation ending does not hand the lip back");

  lipProgress.operationProgress("scan", null);
  lipProgress.observe({ kind: "read", done: 1, total: 4 });
  eq(lipProgress.percent, 25, "after the operation ends, transfers drive it again");
  lipProgress.reset();
}

// --- work nobody asked for does not light the lip ----------------------------------------------
// The background FS-stat and core-version reads run after every scan: they walk the LittleFS
// tree and read each core in full, hundreds of block reads for numbers that appear quietly in a
// panel. Drawing each as its own sweep is strobing, not feedback, and it is why the lip kept
// flashing even once the scan itself owned it.
{
  lipProgress.reset();
  lipProgress.setQuiet(true);
  lipProgress.observe({ kind: "read", done: 4096, total: 4096 });
  eq(lipProgress.active, false, "a quiet read does not light the lip");

  // Counted, not boolean: several readers start together and the first to finish must not
  // un-quiet the lip while the others are still reading.
  lipProgress.setQuiet(true);
  lipProgress.setQuiet(false);
  lipProgress.observe({ kind: "read", done: 4096, total: 4096 });
  eq(lipProgress.active, false, "the lip stays quiet while another reader is outstanding");

  lipProgress.setQuiet(false);
  lipProgress.observe({ kind: "read", done: 1, total: 2 });
  eq(lipProgress.percent, 50, "once the last reader is done, transfers light it again");
  lipProgress.reset();
}

console.log(`lip progress: ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
