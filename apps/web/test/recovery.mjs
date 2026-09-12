#!/usr/bin/env node
/**
 * Offline coverage for the Recovery Mode ("Start Recovery Mode") stub-boot race in
 * src/lib/device.svelte.ts.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/recovery.mjs'
 *
 * The bug this pins (owner-reported, hit twice in one day):
 *   ensureStub() → bootStub() resets the target, the ST-Link RE-ENUMERATES, WebUSB fires
 *   `disconnect` → handleLost() → _teardownConnection() → probe.dispose(). bootStub captured
 *   the transport by value and is still mid-write, so its next writeMemory() hit a USBDevice
 *   *we had just closed ourselves*: "InvalidStateError: The device must be opened first".
 *   Then BOTH reconnectLoop() and the USB `connect` event's connectSilent() re-attached.
 *
 * The invariants asserted here:
 *   1. A teardown while a stub boot is in flight must NOT close the handle that boot owns.
 *   2. That deferred close must still happen, exactly once, when the boot settles.
 *   3. It must never close the handle that is live NOW (the reconnect may have won the race).
 *   4. A boot cut short by a link drop reports the CAUSE, not the transport's symptom.
 *   5. The user's own Cancel is a distinct error type, so callers can stay quiet about it
 *      while still surfacing real failures.
 *   6. A reconnect attaches ONCE, even when reconnectLoop and connectSilent overlap.
 *
 * NOTHING here touches a device. The real device.svelte.ts is bundled with esbuild (runes
 * defined away, same recipe as safety.mjs) and only its two hardware seams — engine/transport
 * and engine/flasher — plus the scan modules are replaced by fakes driven from this file.
 *
 * ANTI-VACUITY: the fake probe is a real open/closed state machine that THROWS the actual
 * Chrome message when written to after dispose(), so check 1 fails if the deferral is removed
 * rather than passing on a fake that could not have failed. Every count assertion is compared
 * against a counter the fake increments, never against a constant the fixture supplies.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
const tick = (n = 0) => new Promise((r) => setTimeout(r, n));

// --- Compile the module under test ------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-recovery-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

// Every module device.svelte.ts pulls in purely to talk to hardware or to scan it. They are
// replaced wholesale; the harness drives them through globalThis.__fake.
const STUBS = {
  "./engine/transport.js": `
    export const connectProbe = (opts) => globalThis.__fake.connectProbe(opts);
    export const getKnownProbes = () => globalThis.__fake.getKnownProbes();
    export const serialTransport = (t) => t;`,
  "./engine/flasher.js": `
    export const bootStub = (t, log) => globalThis.__fake.bootStub(t, log);
    export const readInfo = async () => ({ locked: false, externalFlashSizeMiB: 16 });
    export const dumpRegion = async () => new Uint8Array();
    export const attachFlasher = (t) => ({ __attached: t });
    export const isStubAlive = async () => globalThis.__fake.stubAlive;
    export const pingTarget = async () => true;`,
  "./engine/fsscan.js": `export const scanExtflashPartitions = async () => [];`,
  "./engine/intflashscan.js": `export const scanIntflashBanks = async () => [];`,
  "./engine/classify.js": `export const classifyDevice = () => null;`,
  "./engine/screenshot.js": `export const captureScreenshot = async () => null;`,
  "./engine/frogfsDevice.js": `export const readInstalledFrogfs = async () => null;`,
  "./engine/devicelog.js": `export const readLogFromTransport = async () => "";`,
  "./debug.js": `export const dbg = () => {}; export const dbgLog = () => () => {}; export const setDbgSink = () => {};`,
};

const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/device.svelte.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*", "jszip"], // pulled in transitively (sources/bundle.ts); never reached here
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      name: "hw-stubs",
      setup(b) {
        const filter = new RegExp(`^(${Object.keys(STUBS).map((k) => k.replace(/[.$/]/g, "\\$&")).join("|")})$`);
        b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "hw" }));
        b.onLoad({ filter: /.*/, namespace: "hw" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
      },
    },
  ],
});

if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
}

// --- The fake adapter -------------------------------------------------------------------
// A probe handle with a REAL open/closed state machine. Writing through a disposed one
// throws the exact string Chrome produced in the owner's console, so the check that says
// "the boot was still writing to an open handle" can genuinely fail.
let probeSeq = 0;
const SHARED_USB_DEVICE = { fake: true };
function makeProbe(ownDevice = false) {
  const p = {
    id: ++probeSeq,
    open: true,
    disposals: 0,
    probeName: `FAKE-PROBE-${probeSeq}`,
    // Chrome hands back the SAME USBDevice instance for one physical adapter across a
    // re-enumeration, so every fake probe shares one. That is what makes check 9 able to
    // fail: an identity-only "is this the live probe?" test cannot tell them apart.
    device: ownDevice ? { fake: true, other: true } : SHARED_USB_DEVICE,
    transport: null,
  };
  const guard = () => {
    if (!p.open) {
      throw new Error("InvalidStateError: Failed to execute 'transferOut' on 'USBDevice': The device must be opened first.");
    }
  };
  p.transport = {
    busy: () => false,
    connect: async () => guard(),
    readMemory: async (_a, l) => { guard(); return new Uint8Array(l ?? 0); },
    writeMemory: async () => guard(),
    readWord: async () => { guard(); return 0; },
    writeWord: async () => guard(),
    halt: async () => guard(),
    resume: async () => guard(),
    reset: async () => guard(),
    readRegister: async () => { guard(); return 0; },
    writeRegister: async () => guard(),
  };
  p.dispose = async () => { p.disposals++; p.open = false; };
  return p;
}

const fake = {
  stubAlive: false,
  probes: [],
  connectCalls: 0,
  knownGate: null, // when set, getKnownProbes awaits it
  bootImpl: null,
  async connectProbe() {
    this.connectCalls++;
    const p = makeProbe();
    this.probes.push(p);
    return p;
  },
  async getKnownProbes() {
    if (this.knownGate) await this.knownGate;
    return [{ fake: true }];
  },
  async bootStub(transport, log) {
    return this.bootImpl(transport, log);
  },
};
globalThis.__fake = fake;

// A minimal navigator.usb so device.svelte.ts's module-level listener wiring runs the same
// code path production does (it is guarded on navigator.usb existing).
const usbListeners = {};
globalThis.navigator = globalThis.navigator ?? {};
Object.defineProperty(globalThis.navigator, "usb", {
  configurable: true,
  value: {
    addEventListener: (t, f) => ((usbListeners[t] ??= new Set()).add(f)),
    removeEventListener: (t, f) => usbListeners[t]?.delete(f),
  },
});

const mod = await import(pathToFileURL(join(out, "device.svelte.js")).href);
const { device, StubLoadCancelled } = mod;

/** Fire the browser's `disconnect` event for the probe the store currently holds. */
function fireUsbDisconnect() {
  const ev = { device: device.probe.device };
  for (const f of usbListeners.disconnect ?? []) f(ev);
}

/** Attach cleanly (no stub) and settle the scan the connect kicks off. */
async function freshConnect() {
  device._suppressAutoRetry = false;
  await device.connect();
  await tick(5);
  eq(device.connection, "connected", "precondition: connected");
}

// ========================================================================================
// 1-3. The race: a teardown must not close a handle an in-flight bootStub still owns.
// ========================================================================================

await check("PRECONDITION: the fake probe really does break when written to after dispose()", async () => {
  const p = makeProbe();
  await p.transport.writeMemory(0, new Uint8Array(1)); // open: fine
  await p.dispose();
  let threw = null;
  try { await p.transport.writeMemory(0, new Uint8Array(1)); } catch (e) { threw = e; }
  assert(threw && /must be opened first/.test(threw.message), "a disposed fake must throw the real Chrome error");
});

await check("a USB disconnect mid-bootStub leaves the boot's handle OPEN (the reported crash)", async () => {
  await freshConnect();
  const probe = device.probe;
  let sawErrorAfterDisconnect = null;
  let sawDropDuringBoot = false;
  let wroteAfterDisconnect = false;
  fake.bootImpl = async (transport) => {
    await transport.writeMemory(0x20000000, new Uint8Array(4)); // first half of the load
    fireUsbDisconnect();                                        // the re-enumeration
    await tick(20);                                             // let handleLost run to completion
    sawDropDuringBoot = device._reconnectAfterBoot;              // arming: it took the boot branch
    try {
      await transport.writeMemory(0x20000004, new Uint8Array(4)); // second half — the crash site
      wroteAfterDisconnect = true;
    } catch (e) {
      sawErrorAfterDisconnect = e;
    }
    return { flasher: true };
  };
  let bootErr = null;
  try { await device.ensureStub(undefined, true); } catch (e) { bootErr = e; }
  assert(sawErrorAfterDisconnect === null,
    `bootStub's write after the disconnect failed: ${sawErrorAfterDisconnect && sawErrorAfterDisconnect.message}`);
  assert(wroteAfterDisconnect, "the boot never reached its post-disconnect write");
  // Arming: handleLost really did run and really did take its stub-boot branch — this is not
  // a fixture in which the disconnect event went nowhere.
  assert(sawDropDuringBoot, "handleLost must have recorded the drop while the boot ran");
  // ...and, because the boot's own writes kept landing, the drop was the expected
  // re-enumeration: the session survives rather than flapping to "lost" and back.
  eq(device.connection, "connected", "a boot that kept writing must stay connected");
  eq(device.probe, probe, "and must keep the very handle it booted through");
  eq(device._reconnectAfterBoot, false, "the deferred drop must be consumed, not left armed");
  assert(bootErr === null, `a boot that completed must report success, got: ${bootErr && bootErr.message}`);
});

await check("a MANUAL disconnect mid-boot still defers the close, then does it exactly once", async () => {
  // handleLost no longer tears down during a boot (that was the flapping bug), but an
  // explicit user disconnect still must — and it must still not close the handle out from
  // under the in-flight write.
  await freshConnect();
  const probe = device.probe;
  let wroteAfterDisconnect = false;
  let sawError = null;
  fake.bootImpl = async (transport) => {
    void device.disconnect();          // the user pulls the plug on the app, mid-boot
    await tick(20);
    try {
      await transport.writeMemory(0x20000004, new Uint8Array(4));
      wroteAfterDisconnect = true;
    } catch (e) { sawError = e; }
    return { flasher: true };
  };
  await device.ensureStub(undefined, true).catch(() => {});
  assert(sawError === null, `the in-flight write must not be cut off: ${sawError && sawError.message}`);
  assert(wroteAfterDisconnect, "the boot never reached its post-disconnect write");
  await tick(30);
  eq(probe.disposals, 1, "the handle must be closed exactly once, after the boot settles");
  eq(probe.open, false, "and actually closed");
  eq(device._deferredDispose.length, 0, "the deferred queue must be drained");
});

await check("the deferred dispose() never closes the handle that is live NOW", async () => {
  device._suppressAutoRetry = true; // stop the retry cadence from racing this fixture
  await freshConnect();
  const live = device.probe;
  device._stubBootDepth = 1;
  device._deferredDispose = [live];        // a teardown deferred it...
  device._stubBootDepth = 0;
  device._flushDeferredDispose();
  await tick(10);
  eq(live.disposals, 0, "the currently-attached probe must never be disposed by the flush");
  eq(live.open, true, "and must still be usable");
  // Arming: the very same flush DOES dispose a handle that is no longer live.
  const stale = makeProbe(true); // a different physical adapter — must still be disposed
  device._deferredDispose = [stale];
  device._flushDeferredDispose();
  await tick(10);
  eq(stale.disposals, 1, "a stale deferred handle must be disposed");
});

// ========================================================================================
// 4-5. What ensureStub() reports.
// ========================================================================================

await check("a boot cut short by a link drop reports the CAUSE, not the transport symptom", async () => {
  device._suppressAutoRetry = true;
  await freshConnect();
  fake.bootImpl = async (transport) => {
    fireUsbDisconnect();
    await tick(20);
    // Whatever the transport says here is a symptom of the drop, not the cause.
    throw new Error("InvalidStateError: Failed to execute 'transferOut' on 'USBDevice': The device must be opened first.");
  };
  let err = null;
  try { await device.ensureStub(undefined, true); } catch (e) { err = e; }
  assert(err, "expected a throw");
  assert(/link dropped/i.test(err.message), `expected the interrupted-boot message, got "${err.message}"`);
  assert(!/transferOut/.test(err.message), "the raw transport error must not be what the user sees");
});

await check("a boot that fails for its OWN reason still reports that reason verbatim", async () => {
  device._suppressAutoRetry = true;
  await freshConnect();
  fake.bootImpl = async () => { throw new Error("BAD_HASH_RAM"); };
  let err = null;
  try { await device.ensureStub(undefined, true); } catch (e) { err = e; }
  assert(err && /BAD_HASH_RAM/.test(err.message), `expected the real failure, got "${err && err.message}"`);
});

await check("the user's own Cancel is a distinct, silenceable error type", async () => {
  device._suppressAutoRetry = true;
  await freshConnect();
  device.flasher = null;
  fake.bootImpl = async () => ({ flasher: true });
  const p = device.ensureStub();          // no force → the StubLoadModal gate
  await tick(5);
  assert(device.stubPrompt, "precondition: the modal gate is open");
  device.cancelStubLoad();
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err instanceof StubLoadCancelled, "Cancel must be a StubLoadCancelled");
  // Arming: a non-cancel failure through the SAME path is NOT that type, so a caller that
  // silences StubLoadCancelled still surfaces real errors.
  fake.bootImpl = async () => { throw new Error("boom"); };
  let err2 = null;
  try { await device.ensureStub(undefined, true); } catch (e) { err2 = e; }
  assert(err2 && !(err2 instanceof StubLoadCancelled), "a real failure must not be typed as a cancel");
});

// ========================================================================================
// 6. The double reconnect.
// ========================================================================================

await check("connectSilent() attaches ONCE when it races a reconnect that already won", async () => {
  device._suppressAutoRetry = true;
  await freshConnect();
  await device.disconnect();
  eq(device.connection, "disconnected", "precondition: idle");
  device._suppressAutoRetry = false;
  device.connection = "lost";             // handleLost's state, retry cadence about to run

  let release;
  fake.knownGate = new Promise((r) => (release = r));
  const before = fake.connectCalls;
  const silent = device.connectSilent();  // passes its guard while still "lost", then awaits
  await tick(5);
  await device.connect();                 // the reconnect cadence wins the race
  await tick(5);
  eq(fake.connectCalls, before + 1, "precondition: exactly one attach so far");
  release();
  fake.knownGate = null;
  await silent;
  await tick(5);
  eq(fake.connectCalls, before + 1, "connectSilent must not attach a second time over a healthy link");
  eq(device.probe && device.probe.disposals, 0, "and must not have replaced the live handle");
});

await check("connectSilent() DOES attach when the link is genuinely still lost", async () => {
  // Arming for the check above: same code path, same gate, only the outcome of the re-check
  // differs — so the previous check is pinning the re-check, not an unreachable branch.
  device._suppressAutoRetry = false;
  await device.disconnect();
  device._suppressAutoRetry = false;
  device.connection = "lost";
  const before = fake.connectCalls;
  await device.connectSilent();
  await tick(5);
  eq(fake.connectCalls, before + 1, "a genuinely lost link must be re-attached");
  eq(device.connection, "connected", "and end up connected");
});

await check("a forcePicker connect is never answered by an in-flight pickerless attach", async () => {
  device._suppressAutoRetry = false;
  await device.disconnect();
  const before = fake.connectCalls;
  const a = device.connect();
  const b = device.connect();                              // deduped
  const c = device.connect(undefined, { forcePicker: true }); // must NOT be
  await Promise.allSettled([a, b, c]);
  await tick(5);
  eq(fake.connectCalls, before + 2, "one shared pickerless attach + one forced picker attach");
});

// ========================================================================================
// 7-9. The SECOND race, reported after the first fix: a competing ATTACH during the boot.
//
// Deferring the dispose (checks 1-3) kept the boot's handle open, but nothing stopped the
// automatic responses to the boot's own re-enumeration — handleLost's reconnectLoop, and
// connectSilent off the USB `connect` event — from attaching a SECOND WebStlink to the same
// physical adapter WHILE the first was still writing. Two handles, two independent
// serialTransport queues, one USBDevice. The owner saw the UI flap wildly between connected
// and disconnected, with:
//   "InvalidStateError: ... An operation that changes the device state is in progress."
// followed by "The device must be opened first" once either handle was disposed.
// ========================================================================================

await check("a USB disconnect mid-bootStub does NOT attach a competing handle", async () => {
  await freshConnect();
  let attachesDuringBoot = null;
  fake.bootImpl = async (transport) => {
    const before = fake.connectCalls;
    fireUsbDisconnect();
    await tick(60); // longer than reconnectLoop's first 200ms? no — deliberately shorter than
                    // the cadence's own delay would matter; we also assert after settling below
    await tick(300); // now well past reconnectLoop's first attempt (200ms)
    attachesDuringBoot = fake.connectCalls - before;
    await transport.writeMemory(0x20000000, new Uint8Array(4)); // must still be OUR open handle
    return { flasher: true };
  };
  await device.ensureStub(undefined, true);
  eq(attachesDuringBoot, 0, "nothing may attach to the adapter while a stub boot owns it");
});

await check("the suppressed reconnect still happens, exactly once, after the boot settles", async () => {
  await freshConnect();
  const before = fake.connectCalls;
  fake.bootImpl = async (transport) => {
    fireUsbDisconnect();
    await tick(20);
    // The boot itself fails, as it does when the link genuinely went away mid-write.
    throw new Error("InvalidStateError: The device must be opened first.");
  };
  await device.ensureStub(undefined, true).catch(() => {});
  await tick(600); // let the deferred cadence run
  eq(fake.connectCalls - before, 1, "exactly one re-attach, not zero and not a storm");
  eq(device.connection, "connected", "and the link is back");
});

await check("a deferred dispose never closes a handle sharing the live probe's USBDevice", async () => {
  await freshConnect();
  const doomed = device.probe;
  fake.bootImpl = async (transport) => {
    fireUsbDisconnect();   // teardown defers doomed's dispose (boot owns it)
    await tick(20);
    return { flasher: true };
  };
  await device.ensureStub(undefined, true);
  await tick(600);
  assert(device.probe, "a probe must be live afterwards");
  assert(device.probe.open, "the LIVE handle must still be open — its USBDevice was never closed");
  await device.probe.transport.writeMemory(0, new Uint8Array(1)); // throws if it was closed
});

// ========================================================================================
// 10-13. The THIRD race, reported after the two above: a cached flasher OUTLIVING the handle
// it captured.
//
// ensureStub() reuses `this.flasher` when two probes pass. Neither probe looked at the
// handle: stubAlive() pinged through the STORE's transport (isStubAlive(this.transport)),
// and contextsFree() only needs the stub to answer. So after a re-enumeration replaced the
// transport, both said "fine" about a flasher whose own USBDevice was closed, and every
// transfer through it threw "InvalidStateError: The device must be opened first" — forever,
// once per retry attempt, each attempt paying a device-resetting stub reboot.
//
// The invariant: a cached flasher is reusable only while the transport it captured IS the
// live one. Liveness means "this object can transfer", not "a stub answers somewhere".
// ========================================================================================

/** A boot that yields a flasher bound to the transport it was handed (as the real one does). */
function bootReturningFlasher() {
  return async (transport) => ({ flasher: true, transport, getContext: async () => 0 });
}

await check("PRECONDITION: a healthy cached flasher IS still reused (the gate is not a blanket reboot)", async () => {
  await freshConnect();
  fake.bootImpl = bootReturningFlasher();
  fake.stubAlive = true;
  const first = await device.ensureStub(undefined, true);
  let boots = 0;
  fake.bootImpl = async (t) => { boots++; return { flasher: true, transport: t, getContext: async () => 0 }; };
  const second = await device.ensureStub(undefined, false, true);
  eq(boots, 0, "a live cached flasher must not cost a stub boot");
  assert(second === first, "and the SAME flasher comes back");
});

await check("a cached flasher whose transport was superseded is NOT reused", async () => {
  await freshConnect();
  fake.bootImpl = bootReturningFlasher();
  fake.stubAlive = true;
  const stale = await device.ensureStub(undefined, true);
  // The re-enumeration the two races above are about: a new probe, a new transport, while
  // `this.flasher` still holds the one the boot captured.
  const fresh = makeProbe();
  fake.probes.push(fresh);
  device.probe = fresh;
  device.transport = fresh.transport;
  eq(device.flasher.transport === device.transport, false, "precondition: the cached flasher is stale");
  let boots = 0;
  fake.bootImpl = async (t) => { boots++; return { flasher: true, transport: t, getContext: async () => 0 }; };
  const got = await device.ensureStub(undefined, false, true);
  assert(got !== stale, "the stale flasher must not be handed back");
  eq(boots, 1, "a fresh stub must be booted instead");
  assert(got.transport === device.transport, "and the flasher returned is bound to the LIVE transport");
});

await check("ANTI-VACUITY: the superseded transport really is dead, so reusing it would throw", async () => {
  await freshConnect();
  fake.bootImpl = bootReturningFlasher();
  fake.stubAlive = true;
  const stale = await device.ensureStub(undefined, true);
  const old = device.probe;
  const fresh = makeProbe();
  fake.probes.push(fresh);
  device.probe = fresh;
  device.transport = fresh.transport;
  await old.dispose(); // the handle the cached flasher captured is now closed, as in the field
  let threw = null;
  try { await stale.transport.writeMemory(0x20000000, new Uint8Array(4)); } catch (e) { threw = e; }
  assert(threw && /must be opened first/.test(threw.message), "the stale transport must genuinely be dead");
  fake.bootImpl = bootReturningFlasher();
  const got = await device.ensureStub(undefined, false, true);
  await got.transport.writeMemory(0x20000000, new Uint8Array(4)); // throws if the gate handed back the corpse
});

// --- Report ------------------------------------------------------------------------------
device._suppressAutoRetry = true;
await device.disconnect();
if (failures.length) {
  console.error(`recovery.mjs: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`recovery.mjs: ${passed} checks passed`);
