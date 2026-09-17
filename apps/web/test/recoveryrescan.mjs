#!/usr/bin/env node
/**
 * Entering Recovery Mode always re-reads the device.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/recoveryrescan.mjs'
 *
 * When the app opens, Retro-Go is usually running, so the scan taken on connect describes the
 * device as it could be read THEN. Booting the RAM stub resets the target and changes what is
 * readable. `ensureStub` drops the bank scan's freshness, but dropping freshness only means the
 * NEXT scan will be real -- it does not cause one, and the menu item did not ask for one, so the
 * UI went on describing the pre-reset device until something else happened to trigger a scan.
 *
 * The store is a Svelte runes module and the real one needs a browser, a transport and a device.
 * So this drives the METHOD against a stub `this`, which is enough to pin the three things that
 * can rot: that a boot happens, that a scan follows it EVERY time (no freshness gate), and that
 * the scan is not allowed to coalesce onto one that started before the boot.
 */
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../src/lib/device.svelte.ts");

/**
 * The real method body, lifted out of the store and compiled on its own.
 *
 * Restating the sequence here instead would test the restatement: the failure being guarded is
 * someone editing the store, so the store's own text has to be what runs.
 */
function realStartRecoveryMode() {
  const src = readFileSync(SRC, "utf8");
  const at = src.indexOf("async startRecoveryMode(): Promise<void> {");
  ok(at >= 0, "no startRecoveryMode() in device.svelte.ts");
  const end = src.indexOf("\n  }", at);
  ok(end > at, "startRecoveryMode() is unterminated");
  const body = src.slice(src.indexOf("{", at) + 1, end);
  ok(/ensureStub/.test(body) && /runScan/.test(body), "the lifted body is not the method");
  // The body now also calls dbg() and tests `instanceof StubLoadCancelled`, so both have to be
  // in the generated function's scope. Injected rather than stubbed inside the string, so a
  // test can watch what the real code actually logs.
  ok(/\[recovery\]/.test(body), "the lifted body no longer emits the [recovery] diagnostic");
  return new Function(
    "dbg",
    "StubLoadCancelled",
    "isDeadHandleError",
    `return async function () {${body.replace(/: Promise<void>/g, "")}}`,
  )((m) => logged.push(m), StubLoadCancelled, () => false);
}
/** Every dbg() line the real method emitted, newest last. Reset per check. */
const logged = [];
class StubLoadCancelled extends Error {}
let startRecoveryMode;
try {
  startRecoveryMode = realStartRecoveryMode();
} catch (e) {
  // REFUSE TO RUN RATHER THAN PASS EMPTY. If the method cannot be lifted -- renamed, removed,
  // or no longer calling what it must -- every check below would either not run or test a stub
  // of this file's own making. Say so in one line and exit non-zero, the way the doc guards do.
  console.log(`  x cannot drive the real startRecoveryMode(): ${e.message}`);
  console.log("recovery rescan: 1 FAILED, 0 checks passed");
  process.exit(1);
}

/** A device just far enough along to answer the three questions. */
function fakeDevice({ scanInFlight = null, bootThrows = null } = {}) {
  const events = [];
  logged.length = 0;
  return {
    events,
    _scanPromise: scanInFlight,
    // Read by the [recovery] diagnostic. Real names, so a rename in the store shows up here.
    _reconnectAfterBoot: false,
    pollSuspendDepth: 0,
    connection: "connected",
    utilLoaded: false,
    async ensureStub(_log, force) {
      events.push(`boot:${force === true ? "forced" : "reused"}`);
      if (bootThrows) throw bootThrows;
    },
    async runScan(reason) {
      events.push(`scan:${reason}`);
    },
  };
}

await check("a boot is forced, then the device is rescanned", async () => {
  const d = fakeDevice();
  await startRecoveryMode.call(d);
  eq(d.events, ["boot:forced", "scan:recovery mode"], "boot then scan, in that order");
});

await check("the rescan happens EVERY time, with no freshness gate", async () => {
  const d = fakeDevice();
  await startRecoveryMode.call(d);
  await startRecoveryMode.call(d);
  await startRecoveryMode.call(d);
  eq(d.events.filter((e) => e.startsWith("scan:")).length, 3,
    "three entries into recovery mode must produce three scans");
});

await check("the scan is DELIBERATE, never auto-gated", async () => {
  // An `auto` scan waits for the link to go idle and gives up if it does not. Recovery mode is
  // the user's own action on an idle device; gating it would let it silently not happen.
  let opts;
  const d = fakeDevice();
  d.runScan = async (reason, o) => { opts = o; d.events.push(`scan:${reason}`); };
  await startRecoveryMode.call(d);
  ok(opts === undefined || opts.auto !== true, `the recovery rescan must not pass auto: ${JSON.stringify(opts)}`);
});

await check("a scan started before the boot is awaited and discarded, not joined", async () => {
  // `runScan` coalesces onto an in-flight promise. That promise was started BEFORE the reset,
  // so joining it hands back exactly the stale answer this exists to replace.
  const order = [];
  let settle;
  const inFlight = new Promise((r) => { settle = () => { order.push("old scan ended"); r(); }; });
  const d = fakeDevice({ scanInFlight: inFlight });
  d.runScan = async (reason) => { order.push(`new scan: ${reason}`); };
  const done = startRecoveryMode.call(d);
  await Promise.resolve();
  settle();
  await done;
  eq(order, ["old scan ended", "new scan: recovery mode"],
    "the pre-boot scan must finish before the fresh one starts");
});

await check("a rejected in-flight scan does not stop the fresh one", async () => {
  const d = fakeDevice({ scanInFlight: Promise.reject(new Error("link went away")) });
  await startRecoveryMode.call(d);
  ok(d.events.includes("scan:recovery mode"), "a failed previous scan must not swallow the rescan");
});

await check("a declined boot skips the rescan", async () => {
  // StubLoadModal's Cancel rejects. Nothing was reset, so there is nothing to re-read.
  const d = fakeDevice({ bootThrows: new Error("declined") });
  await startRecoveryMode.call(d).then(
    () => { throw new Error("a declined boot must reject"); },
    () => {},
  );
  eq(d.events, ["boot:forced"], "no scan after a boot that did not happen");
});

await check("the menu item calls it, rather than booting the stub itself", async () => {
  const ui = readFileSync(join(here, "../src/lib/ui/DeviceControls.svelte"), "utf8");
  ok(/device\.startRecoveryMode\(\)/.test(ui), "DeviceControls must call device.startRecoveryMode()");
  ok(!/device\.ensureStub\(undefined,\s*true\)/.test(ui),
    "DeviceControls still boots the stub directly, so entering recovery mode will not rescan");
});

for (const f of failures) console.log(`  x ${f}`);
// --- The poll must be silenced for the whole stub boot -------------------------------------
//
// THE BUG THIS EXISTS FOR. The owner: "sometimes when I try to start recovery mode from a
// running retro-go, the screen goes black and I have to press the button several times for it
// to take effect and actually start the flash stub."
//
// startStub() is nine separate awaited transport operations. Between them the serial queue
// drains and `transport.busy()` is false, so pollTick()'s busy() guard passes and it fires a
// ping into the middle of the boot. That ping is time-boxed at 300 ms and NOT cancelled, so
// landing behind one of the firmware load's chunks blows the box, reports the link lost and
// calls handleLost() -- from which any throw out of bootStub tears the connection down. The
// device is left reset (black screen) with no stub.
//
// Seven other stub-booting flows wrap themselves in suspendPoll()/resumePoll(). The header's
// Recovery Mode did not. The cure is at the chokepoint, so every boot is covered.
function realEnsureStubWrapper() {
  const src = readFileSync(SRC, "utf8");
  const at = src.indexOf("async ensureStub(log?: (m: string) => void");
  ok(at >= 0, "no ensureStub() in device.svelte.ts");
  const end = src.indexOf("\n  }", at);
  ok(end > at, "ensureStub() is unterminated");
  let body = src.slice(src.indexOf("{", at) + 1, end);
  ok(/suspendPoll\(\)/.test(body), "ensureStub no longer suspends the poll");
  ok(/_ensureStubInner/.test(body), "ensureStub no longer delegates to _ensureStubInner");
  body = body
    .replace(/: Promise<GnwFlasher>/g, "")
    .replace(/log\?: \(m: string\) => void/g, "log")
    .replace(/forceReboot = false/g, "forceReboot")
    .replace(/silent = false/g, "silent")
    .replace(/allowReboot = true/g, "allowReboot");
  return new Function(`return async function (log, forceReboot, silent, allowReboot = true) {${body}}`)();
}
let ensureStubWrapper;
try {
  ensureStubWrapper = realEnsureStubWrapper();
} catch (e) {
  console.log(`  x cannot drive the real ensureStub() wrapper: ${e.message}`);
  console.log("recovery rescan: 1 FAILED, 0 checks passed");
  process.exit(1);
}

/** A device that records the order of poll suspension against the boot itself. */
function pollDevice({ innerThrows = null } = {}) {
  const order = [];
  return {
    order,
    probe: {}, transport: {},
    suspendPoll() { order.push("suspend"); },
    resumePoll() { order.push("resume"); },
    async _ensureStubInner() {
      order.push("boot");
      if (innerThrows) throw innerThrows;
      return "flasher";
    },
  };
}

await check("THE REPORTED BUG: the stub boot runs with the poll silenced", async () => {
  const d = pollDevice();
  await ensureStubWrapper.call(d, undefined, true, false);
  eq(d.order, ["suspend", "boot", "resume"],
    "the boot must sit strictly between suspendPoll() and resumePoll()");
});

await check("the poll is resumed even when the boot throws", async () => {
  // Otherwise one failed recovery attempt leaves the poll dead for the rest of the session,
  // and the liveness detection the poll exists for is silently gone.
  const d = pollDevice({ innerThrows: new Error("boom") });
  let threw = null;
  try { await ensureStubWrapper.call(d, undefined, true, false); } catch (e) { threw = e; }
  ok(threw && threw.message === "boom", `the failure must still propagate: ${threw && threw.message}`);
  eq(d.order, ["suspend", "boot", "resume"], "resumePoll() must run in a finally");
});

// --- The attempt says what happened ---------------------------------------------------------
//
// A failed recovery boot was COMPLETELY SILENT: DeviceControls catches the throw into
// `device.error`, which has no renderer anywhere in the app (its own comment records this).
// From the outside, "the boot failed" and "the click did nothing" were indistinguishable --
// which is exactly why the reported workaround was pressing the button again.
const recoveryLine = () => {
  const hit = logged.find((m) => m.startsWith("[recovery] "));
  return hit ? JSON.parse(hit.slice("[recovery] ".length)) : null;
};

await check("a successful attempt is logged", async () => {
  const d = fakeDevice();
  await startRecoveryMode.call(d);
  const line = recoveryLine();
  ok(line, `no [recovery] line was emitted: ${JSON.stringify(logged)}`);
  eq(line.outcome, "ok", "a completed boot must report ok");
});

await check("A FAILED ATTEMPT IS LOGGED, not swallowed", async () => {
  const d = fakeDevice({ bootThrows: new Error("core did not re-halt after reset") });
  let threw = null;
  try { await startRecoveryMode.call(d); } catch (e) { threw = e; }
  ok(threw, "the failure must still reach the caller");
  const line = recoveryLine();
  ok(line, "a failed recovery boot emitted no [recovery] line, so it is invisible again");
  eq(line.outcome, "failed", "a thrown boot must report failed");
  eq(line.err, "core did not re-halt after reset", "the line must carry the real error");
});

await check("the user's own cancel is not reported as a failure", async () => {
  const d = fakeDevice({ bootThrows: new StubLoadCancelled("cancelled") });
  try { await startRecoveryMode.call(d); } catch { /* expected */ }
  eq(recoveryLine().outcome, "cancelled", "a dismissed modal is not a boot failure");
});

await check("the line carries the race's own evidence", async () => {
  // `drop` is handleLost() having fired during the boot. That is the difference between the
  // poll race and any other failure, and it is the one fact no other line reports.
  const d = fakeDevice();
  d._reconnectAfterBoot = true;
  await startRecoveryMode.call(d);
  const line = recoveryLine();
  eq(line.drop, true, "a drop seen during the boot must be named");
  ok("pollDepth" in line, "the line must say whether the poll was actually silenced");
  ok(typeof line.bootMs === "number", "the line must say how long the boot took");
});

// Say WHAT failed, not just how many. Without this the suite reported a bare count, which is
// enough to fail a gate but not enough to verify a mutation or to act on a red run.
for (const f of failures) console.log(`  x ${f}`);
console.log(`recovery rescan: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
