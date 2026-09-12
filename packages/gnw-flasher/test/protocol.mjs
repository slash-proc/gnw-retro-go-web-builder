/**
 * gnw-flasher mailbox-protocol suite (no hardware, no device access).
 *
 * Drives the REAL GnwFlasher against a fake SwdTransport backed by a byte-level
 * memory map plus a small state machine that imitates the on-device RAM stub
 * (references/gnwmanager Core/Src/gnwmanager.c): it clears a context's `ready`
 * flag as soon as the buffer transfer is accepted, and only LATER runs
 * erase/program/hash-verify, dropping the global STATUS back to IDLE at the end.
 *
 * The three invariants this exists to pin (all are bugs that already happened —
 * see CLAUDE.md):
 *   1. program() must wait for the global STATUS to reach IDLE *after* the
 *      context's READY flag clears. READY-cleared alone is NOT "done".
 *   2. program()'s per-chunk context-buffer write must NOT read back/verify by
 *      default (gnwmanager's Python doesn't either) — but startStub()'s one-time
 *      firmware load MUST, because a corrupt stub hardfaults. Opposite defaults.
 *   3. tryChunkRetry()'s BAD_HASH_RAM_COMPRESSED handshake — the device-side
 *      safety net that (1)'s no-read-back decision relies on.
 */
import { readFileSync } from "node:fs";
import {
  GnwFlasher,
  MAILBOX_ADDR,
  FW_LOAD_ADDR,
  CONTEXT_BUFFER_SIZE,
  STATUS_IDLE,
  BANK_BASE,
  Action,
  statusName,
} from "../dist/index.js";

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mailbox layout, re-declared here on purpose (pin the numbers, don't import them).
const F = {
  STATUS: 0x00,
  STATUS_OVERRIDE: 0x04,
  UTC_TIMESTAMP: 0x08,
  PROGRESS: 0x0c,
  FLASH_SIZE: 0x10,
  MIN_ERASE_SIZE: 0x14,
  UPLOAD_IN_PROGRESS: 0x18,
  DOWNLOAD_IN_PROGRESS: 0x1c,
  EXPECTED_HASH: 0x20,
  ACTUAL_HASH: 0x40,
  FAILED_CONTEXT_IDX: 0x60,
  RETRY_REQUEST: 0x64,
  RETRY_ACK: 0x68,
};
const C = {
  SIZE: 0x04,
  OFFSET: 0x08,
  ERASE: 0x0c,
  ERASE_BYTES: 0x10,
  COMPRESSED_SIZE: 0x14,
  EXPECTED_SHA256: 0x18,
  BANK: 0x38,
  ACTION: 0x3c,
  COMPRESSED_SHA256: 0x14c,
  READY: 0x16c,
};
const CTX_HDR = (i, f) => MAILBOX_ADDR + (i + 1) * 1024 + f;
const CTX_BUF = (i) => MAILBOX_ADDR + 4096 + i * CONTEXT_BUFFER_SIZE;
const BAD_HASH_RAM_COMPRESSED = 0xbad0000e;
const ST = { BOOTING: 0, ERASE: 0xcafe0001, PROG: 0xcafe0002, HASH: 0xcafe0003 };

/**
 * Fake device + transport. `plan` describes how the stub behaves once the host
 * sets a context's READY.
 */
function makeFake(plan = {}) {
  const mem = new Map(); // byte address → byte
  const log = []; // ordered trace of host-side transport ops
  const dev = {
    status: STATUS_IDLE,
    resumed: false,
    busyAfterReadyCleared: false, // true while READY==0 but the flash op is unfinished
    failures: 0,
    flashFails: 0, // BAD_HASH_FLASH occurrences served so far
    // Starts at 1 like the stub's `static uint32_t context_counter = 1`. A test simulates a
    // stub restart by putting it back to 1 while the host keeps counting.
    contextCounter: 1,
    ctx: [null, null], // {ticks, phase}
  };
  const rd = (a) => mem.get(a) ?? 0;
  const readWordRaw = (a) => (rd(a) | (rd(a + 1) << 8) | (rd(a + 2) << 16) | (rd(a + 3) << 24)) >>> 0;
  const writeWordRaw = (a, v) => {
    mem.set(a, v & 0xff);
    mem.set(a + 1, (v >>> 8) & 0xff);
    mem.set(a + 2, (v >>> 16) & 0xff);
    mem.set(a + 3, (v >>> 24) & 0xff);
  };
  const setStatus = (v) => {
    dev.status = v >>> 0;
    writeWordRaw(MAILBOX_ADDR + F.STATUS, v >>> 0);
  };
  setStatus(STATUS_IDLE);
  writeWordRaw(MAILBOX_ADDR + F.FLASH_SIZE, plan.flashSize ?? 64 * 1024 * 1024);
  writeWordRaw(MAILBOX_ADDR + F.MIN_ERASE_SIZE, plan.minErase ?? 4096);

  const XFER_TICKS = 2; // stub accepts the buffer, clears READY
  const WORK_TICKS = 4; // …then erase/program/hash before STATUS goes IDLE

  // Called on every host read: advances the simulated stub one step.
  const tick = () => {
    for (let i = 0; i < 2; i++) {
      const s = dev.ctx[i];
      if (!s) continue;
      s.t += 1;
      if (s.phase === "xfer") {
        if (plan.errorDuringXfer) {
          // Device raises an error while it still owns the context (READY stays set).
          setStatus(plan.errorDuringXfer);
          s.phase = "stuck";
          continue;
        }
        if (dev.failures < (plan.badHashFails ?? 0)) {
          dev.failures += 1;
          // Report the transient compressed-buffer corruption; keep READY set.
          writeWordRaw(MAILBOX_ADDR + F.FAILED_CONTEXT_IDX, i);
          setStatus(BAD_HASH_RAM_COMPRESSED);
          s.phase = "awaitRetry";
          s.req = readWordRaw(MAILBOX_ADDR + F.RETRY_REQUEST);
          continue;
        }
        if (s.t >= XFER_TICKS) {
          writeWordRaw(CTX_HDR(i, C.READY), 0); // ready cleared — but NOT done
          dev.busyAfterReadyCleared = true;
          setStatus(ST.ERASE);
          s.phase = "work";
          s.t = 0;
        }
      } else if (s.phase === "stuck") {
        // The real firmware release_context()s at the END of GNWMANAGER_DECOMPRESSING, so
        // by the time ANY post-transfer error status is set the context is already free.
        // Without this the host could never re-issue the block (both contexts stay busy).
        writeWordRaw(CTX_HDR(i, C.READY), 0);
      } else if (s.phase === "awaitRetry") {
        const req = readWordRaw(MAILBOX_ADDR + F.RETRY_REQUEST);
        if (req !== s.req) {
          writeWordRaw(MAILBOX_ADDR + F.RETRY_ACK, req);
          setStatus(ST.PROG);
          s.phase = "xfer";
          s.t = 0;
        }
      } else if (s.phase === "work") {
        if (s.t === 2) setStatus(ST.HASH);
        if (s.t >= WORK_TICKS) {
          if (plan.flashError && dev.flashFails < (plan.flashErrorFails ?? Infinity)) {
            // Post-program FLASH hash mismatch (gnwmanager.c GNWMANAGER_CHECK_HASH_FLASH):
            // status goes BAD and the device parks in GNWMANAGER_ERROR until the host
            // re-issues a context. `flashErrorFails` bounds how many times it does this.
            dev.flashFails += 1;
            setStatus(plan.flashError);
          } else {
            setStatus(STATUS_IDLE);
            dev.busyAfterReadyCleared = false;
          }
          dev.ctx[i] = null;
        }
      }
    }
  };

  const onWrite = (addr, val) => {
    for (let i = 0; i < 2; i++) {
      if (addr !== CTX_HDR(i, C.READY) || val === 0) continue;
      // THE CONTEXT COUNTER, modelled as the stub does it. `get_context()` returns a context
      // only when its `ready` equals the stub's own counter, and `context_counter++` happens
      // immediately on pickup (gnwmanager.c: `if (comm.contexts[i].ready == context_counter)`
      // then `context_counter++`). A value that does not match is simply never picked up, and
      // the main loop's NULL branch parks the mailbox at IDLE -- which is why a desynced device
      // looks exactly like one with nothing to do.
      //
      // The fake used to accept ANY non-zero value, so the desync could not be expressed here
      // at all: every test stayed in lockstep by accident.
      if (val !== dev.contextCounter) {
        setStatus(STATUS_IDLE);
        continue;
      }
      dev.contextCounter += 1;
      dev.ctx[i] = { t: 0, phase: "xfer" };
    }
    if (addr === MAILBOX_ADDR + F.STATUS) dev.status = val >>> 0;
  };

  const transport = {
    async connect() {},
    async readWord(addr) {
      log.push(["rw", addr >>> 0]);
      tick();
      if (plan.readWordHook) plan.readWordHook(addr, dev, mem);
      if (addr === MAILBOX_ADDR + F.STATUS && plan.statusHook) return plan.statusHook(dev) >>> 0;
      return readWordRaw(addr) >>> 0;
    },
    async writeWord(addr, val) {
      log.push(["ww", addr >>> 0, val >>> 0]);
      writeWordRaw(addr, val >>> 0);
      onWrite(addr, val >>> 0);
    },
    async readMemory(addr, len) {
      log.push(["rm", addr >>> 0, len]);
      tick();
      const out = new Uint8Array(len);
      for (let k = 0; k < len; k++) out[k] = rd(addr + k);
      return out;
    },
    async writeMemory(addr, data, onProgress) {
      log.push(["wm", addr >>> 0, data.length]);
      const corrupt = plan.corruptWrite && plan.corruptWrite(addr, log);
      for (let k = 0; k < data.length; k++) mem.set(addr + k, corrupt && k === 3 ? data[k] ^ 0xff : data[k]);
      onProgress?.(data.length, data.length);
    },
    async halt() {
      log.push(["halt"]);
    },
    async resume() {
      log.push(["resume"]);
      dev.resumed = true;
      // The stub starts running here, so its `.data` is re-initialised and
      // `static uint32_t context_counter = 1` goes back to 1. The shared mailbox does NOT:
      // `.gnwmanager_comm` lives in the `.lcd` output section (STM32H7B0VBTx_FLASH.ld), outside
      // `.bss` and `.data`, so whatever `ready` the host last wrote survives the restart. That
      // asymmetry IS the deadlock being modelled.
      dev.contextCounter = 1;
      dev.ctx = [null, null];
      if (plan.idleOnResume !== false) setStatus(STATUS_IDLE);
    },
    async reset() {
      log.push(["reset"]);
      setStatus(ST.BOOTING);
    },
    async readRegister(name) {
      log.push(["rr", name]);
      return dev.regs?.[name] ?? 0;
    },
    async writeRegister(name, val) {
      log.push(["wr", name, val >>> 0]);
      (dev.regs ??= {})[name] = val >>> 0;
    },
  };
  return { transport, mem, log, dev, readWordRaw, writeWordRaw };
}

const count = (log, pred) => log.filter(pred).length;
const bufWrites = (log, i) => log.filter((e) => e[0] === "wm" && e[1] === CTX_BUF(i));
const bufReads = (log, i) => log.filter((e) => e[0] === "rm" && e[1] >= CTX_BUF(i) && e[1] < CTX_BUF(i) + CONTEXT_BUFFER_SIZE);

const payload = (n, seed = 1) => {
  const b = new Uint8Array(n);
  for (let k = 0; k < n; k++) b[k] = (k * 37 + seed) & 0xff;
  return b;
};

// ==========================================================================
// 1. program() must wait for STATUS==IDLE AFTER the context's READY clears.
// ==========================================================================
{
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  await fl.program(0, 0, payload(8192));
  check(!f.dev.busyAfterReadyCleared, "program(): does not return while the device is still erasing/programming (READY cleared != done)");
  check(f.readWordRaw(MAILBOX_ADDR + F.STATUS) === STATUS_IDLE, "program(): global STATUS is IDLE on return");

  // Ordering: the last STATUS read must come after the READY-cleared read.
  const readyReads = f.log.map((e, k) => [e, k]).filter(([e]) => e[0] === "rw" && e[1] === CTX_HDR(0, C.READY));
  const statusReads = f.log.map((e, k) => [e, k]).filter(([e]) => e[0] === "rw" && e[1] === MAILBOX_ADDR + F.STATUS);
  check(statusReads.length > 0 && statusReads[statusReads.length - 1][1] > readyReads[readyReads.length - 1][1],
    "program(): polls the global STATUS after the last READY poll");
}

// ==========================================================================
// 2. verify defaults: OFF per chunk, ON for the stub load.
// ==========================================================================
{
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  await fl.program(0, 0, payload(65536));
  check(bufWrites(f.log, 0).length === 1, "program(): writes the context buffer exactly once");
  check(bufReads(f.log, 0).length === 0, "program(): performs NO read-back of the context buffer by default (verify:false)");
  const barrier = f.log.filter((e) => e[0] === "rw" && e[1] === CTX_BUF(0));
  check(barrier.length === 1, "program(): the only buffer access after the write is the 1-word barrier read");
}
{
  // …and the opt-in still works, which proves the check above isn't vacuous.
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  await fl.program(0, 0, payload(65536), { verify: true });
  check(bufReads(f.log, 0).length === 4, `program({verify:true}): reads the 64KiB buffer back in 16KiB chunks (got ${bufReads(f.log, 0).length})`);
}
{
  // startStub keeps verify:true — a corrupted load must be detected and re-written.
  const fw = payload(4096, 9);
  new DataView(fw.buffer).setUint32(0, 0x24080000, true); // msp
  new DataView(fw.buffer).setUint32(4, 0x240e6801, true); // pc
  let firstWrite = true;
  const f = makeFake({
    corruptWrite: (addr) => {
      if (addr === FW_LOAD_ADDR && firstWrite) {
        firstWrite = false;
        return true;
      }
      return false;
    },
  });
  const fl = new GnwFlasher(f.transport);
  await fl.startStub(fw);
  const fwWrites = f.log.filter((e) => e[0] === "wm" && e[1] === FW_LOAD_ADDR);
  check(fwWrites.length === 2, `startStub(): read-back verify catches a corrupted firmware load and re-writes it (writes=${fwWrites.length})`);
  const fwReads = f.log.filter((e) => e[0] === "rm" && e[1] >= FW_LOAD_ADDR && e[1] < FW_LOAD_ADDR + 8192);
  check(fwReads.length >= 2, "startStub(): reads the firmware image back (verify is hardcoded on)");
  check(f.mem.get(FW_LOAD_ADDR + 3) === fw[3], "startStub(): the firmware finally in RAM matches the blob byte-for-byte");
}
{
  // Unrecoverable corruption must fail loudly after 3 attempts, not be ignored.
  const fw = payload(1024, 3);
  const f = makeFake({ corruptWrite: (addr) => addr === FW_LOAD_ADDR });
  let msg = "";
  try {
    await new GnwFlasher(f.transport).startStub(fw);
  } catch (e) {
    msg = String(e);
  }
  check(/write verify failed at byte 3 after 3 attempts/.test(msg), `startStub(): throws after 3 failed verify attempts (got: ${msg})`);
  check(f.log.filter((e) => e[0] === "wm" && e[1] === FW_LOAD_ADDR).length === 3, "startStub(): retries the load exactly 3 times");
}

// ==========================================================================
// 3. tryChunkRetry — the BAD_HASH_RAM_COMPRESSED handshake.
//
// These assertions describe the handshake gnwmanager's gnw.py and gnwmanager.c
// (GNWMANAGER_HASH_RETRY_WAIT) perform. They were PENDING until the signed-mask
// bug in the status classifier (now `isDeviceError()` in src/index.ts) was
// fixed: before that, waitForContextComplete never classified 0xbad0000e as an
// error and this entire handshake was unreachable dead code.
// ==========================================================================
const shrink = (data) => data.subarray(0, Math.floor(data.length / 4)); // "compresses" 4:1
const RETRY_REQ = MAILBOX_ADDR + F.RETRY_REQUEST;
{
  const f = makeFake({ badHashFails: 1 });
  const fl = new GnwFlasher(f.transport);
  // Abort after a moment: with the bug present program() would otherwise sit in
  // waitForContextComplete for its full 120 s no-progress budget.
  // The abort is a HANG GUARD only: if the classifier regresses, program() would
  // otherwise sit in waitForContextComplete for its full 120 s no-progress budget.
  // On correct behaviour the retry is served and program() resolves long before it.
  const ac = new AbortController();
  const guard = setTimeout(() => ac.abort(), 5000);
  const p = fl.program(0, 0, payload(8192), { compress: shrink, abortSignal: ac.signal }).then(
    () => "resolved",
    (e) => String(e),
  );
  const outcome = await p;
  clearTimeout(guard);
  const sawError = f.log.some((e) => e[0] === "rw" && e[1] === MAILBOX_ADDR + F.FAILED_CONTEXT_IDX);

  check(f.dev.failures === 1, `fixture: the fake device really did report BAD_HASH_RAM_COMPRESSED once (got ${f.dev.failures})`);
  check(bufWrites(f.log, 0).length >= 1, "fixture: the compressed payload was sent before the device complained");
  check(sawError, "tryChunkRetry(): reads FAILED_CONTEXT_IDX when the device reports BAD_HASH_RAM_COMPRESSED");
  check(bufWrites(f.log, 0).length === 2, "tryChunkRetry(): re-transmits the saved compressed buffer");
  check(f.log.some((e) => e[0] === "ww" && e[1] === RETRY_REQ && e[2] === 1), "tryChunkRetry(): bumps RETRY_REQUEST by exactly 1");
  check(f.log.some((e) => e[0] === "rw" && e[1] === MAILBOX_ADDR + F.RETRY_ACK), "tryChunkRetry(): waits for RETRY_ACK to match the request");
  check(outcome === "resolved", `program(): completes normally after a served chunk retry (got: ${outcome})`);
  check(f.readWordRaw(MAILBOX_ADDR + F.STATUS) === STATUS_IDLE, "program(): the device is back to IDLE after a served chunk retry");
}
{
  // A device error must be surfaced as a device error, not as a stall timeout.
  const f = makeFake({ errorDuringXfer: 0xbad00002 });
  f.writeWordRaw(MAILBOX_ADDR + F.EXPECTED_HASH, 0xaabbccdd);
  f.writeWordRaw(MAILBOX_ADDR + F.ACTUAL_HASH, 0x11223344);
  // Abort is a hang guard only (see above); the device error must end the wait first.
  const ac = new AbortController();
  const guard = setTimeout(() => ac.abort(), 30000);
  const outcome = await new GnwFlasher(f.transport)
    .program(0, 0, payload(4096), { abortSignal: ac.signal })
    .then(() => "resolved", (e) => String(e));
  clearTimeout(guard);
  check(f.readWordRaw(MAILBOX_ADDR + F.STATUS) === 0xbad00002, "fixture: the fake device really did report BAD_HASH_FLASH");
  check(/BAD_HASH_FLASH[\s\S]*expected ddccbbaa/.test(outcome), "program(): surfaces BAD_HASH_FLASH with the expected/actual hashes");
  check(f.log.some((e) => e[0] === "rm" && e[1] === MAILBOX_ADDR + F.EXPECTED_HASH), "program(): reads EXPECTED_HASH/ACTUAL_HASH to explain a hash failure");
  check(outcome !== "resolved" && !/Operation aborted/.test(outcome),
    `program(): rejects with the device error itself, not a stall/abort (got: ${outcome})`);
  check(f.log.filter((e) => e[0] === "ww" && e[1] === RETRY_REQ).length === 0, "program(): no chunk-retry handshake for a non-BAD_HASH_RAM_COMPRESSED error");
}

// ==========================================================================
// 3b. BAD_HASH_FLASH retry policy (owner ruling: sanity check, retry twice, then
//     a real error naming the affected blocks).
//
//     Unlike BAD_HASH_RAM_COMPRESSED there is no device-side retry handshake for
//     this status — gnwmanager.c:1067-1078 sets BAD_HASH_FLASH and drops straight
//     into GNWMANAGER_ERROR, which only leaves on a fresh context ready flag. So
//     the retry IS a re-issue of the same block, and RETRY_REQUEST must stay
//     untouched throughout.
// ==========================================================================
const BAD_HASH_FLASH = 0xbad00002;
const progWrites = (log) => log.filter((e) => e[0] === "ww" && (e[1] === CTX_HDR(0, C.READY) || e[1] === CTX_HDR(1, C.READY)) && e[2] !== 0);

{
  // Succeeds on the FIRST retry (2 attempts total).
  const f = makeFake({ flashError: BAD_HASH_FLASH, flashErrorFails: 1 });
  const fl = new GnwFlasher(f.transport);
  const outcome = await fl.program(0, 0, payload(8192)).then(() => "resolved", (e) => String(e));
  check(outcome === "resolved", `BAD_HASH_FLASH: recovers on retry 1 (got: ${outcome})`);
  check(f.dev.flashFails === 1, `fixture: the device really did report BAD_HASH_FLASH once (got ${f.dev.flashFails})`);
  check(progWrites(f.log).length === 2, `BAD_HASH_FLASH: re-issues the block exactly once (READY writes=${progWrites(f.log).length})`);
  check(f.readWordRaw(MAILBOX_ADDR + F.STATUS) === STATUS_IDLE, "BAD_HASH_FLASH: device is back to IDLE after a successful retry");
  check(f.log.filter((e) => e[0] === "ww" && e[1] === RETRY_REQ).length === 0,
    "BAD_HASH_FLASH: does NOT use the RETRY_REQUEST handshake (that is BAD_HASH_RAM_COMPRESSED's, not this status's)");
}
{
  // Succeeds on the SECOND retry (3 attempts total — the full budget, still no error).
  const f = makeFake({ flashError: BAD_HASH_FLASH, flashErrorFails: 2 });
  const outcome = await new GnwFlasher(f.transport).program(0, 0, payload(8192)).then(() => "resolved", (e) => String(e));
  check(outcome === "resolved", `BAD_HASH_FLASH: recovers on retry 2 (got: ${outcome})`);
  check(progWrites(f.log).length === 3, `BAD_HASH_FLASH: three attempts total, not more (READY writes=${progWrites(f.log).length})`);
}
{
  // Exhausts the budget: 3 attempts, then a FlashVerifyError naming the block.
  const off = 3 * CONTEXT_BUFFER_SIZE + 8192; // block index 3, 0x900c2000
  const f = makeFake({ flashError: BAD_HASH_FLASH });
  f.writeWordRaw(MAILBOX_ADDR + F.EXPECTED_HASH, 0xaabbccdd);
  f.writeWordRaw(MAILBOX_ADDR + F.ACTUAL_HASH, 0x11223344);
  let err = null;
  await new GnwFlasher(f.transport).program(0, off, payload(8192)).catch((e) => (err = e));
  check(err !== null && err.name === "FlashVerifyError", `BAD_HASH_FLASH: throws a FlashVerifyError once the budget is spent (got: ${err})`);
  check(err?.retryable === false, "BAD_HASH_FLASH: the error is marked non-retryable (flashImage's outer 3-attempt loop must not multiply it to 9)");
  check(err?.attempts === 3, `BAD_HASH_FLASH: reports 3 attempts (got ${err?.attempts})`);
  check(progWrites(f.log).length === 3, `BAD_HASH_FLASH: gives up after exactly 3 attempts (READY writes=${progWrites(f.log).length})`);
  const b = err?.blocks?.[0];
  check(err?.blocks?.length === 1, `BAD_HASH_FLASH: carries one affected block (got ${err?.blocks?.length})`);
  check(b?.bank === 0 && b?.offset === off, `BAD_HASH_FLASH: block carries bank/offset (got bank=${b?.bank} off=${b?.offset})`);
  check(b?.address === (BANK_BASE[0] + off) >>> 0, `BAD_HASH_FLASH: block carries the memory-mapped address (got 0x${(b?.address >>> 0).toString(16)})`);
  check(b?.blockIndex === 3, `BAD_HASH_FLASH: block index is the 256KiB block within the bank (got ${b?.blockIndex})`);
  check(b?.size === 8192, `BAD_HASH_FLASH: block carries its size (got ${b?.size})`);
  check(b?.expectedHash?.startsWith("ddccbbaa") && b?.actualHash?.startsWith("44332211"),
    `BAD_HASH_FLASH: block carries the device's own expected/actual hashes (got ${b?.expectedHash} / ${b?.actualHash})`);
  check(/block 3 @ 0x900c2000/.test(String(err)), `BAD_HASH_FLASH: the message names the block and its address (got: ${err})`);
}

// ==========================================================================
// 4. Context/mailbox bookkeeping.
// ==========================================================================
{
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  await fl.program(0, 0, payload(4096));
  const ready1 = f.log.find((e) => e[0] === "ww" && e[1] === CTX_HDR(0, C.READY));
  await fl.program(0, 4096, payload(4096));
  const readys = f.log.filter((e) => e[0] === "ww" && e[1] === CTX_HDR(0, C.READY) || (e[0] === "ww" && e[1] === CTX_HDR(1, C.READY)));
  check(ready1[2] === 1, "program(): first context_counter value is 1 (device resets it to 1 on boot)");
  check(readys.map((e) => e[2]).join() === "1,2", `program(): context_counter increments per context (got ${readys.map((e) => e[2]).join()})`);

  // startStub must resync the counter back to 1.
  const fw = payload(64, 5);
  await fl.startStub(fw);
  const before = f.log.length;
  await fl.program(0, 0, payload(4096));
  const after = f.log.slice(before).find((e) => e[0] === "ww" && (e[1] === CTX_HDR(0, C.READY) || e[1] === CTX_HDR(1, C.READY)));
  check(after[2] === 1, `startStub(): resets context_counter to 1 (got ${after[2]})`);
}
{
  const f = makeFake();
  await new GnwFlasher(f.transport).program(2, 8192, payload(8192), { erase: true });
  const w = (field) => f.log.filter((e) => e[0] === "ww" && e[1] === CTX_HDR(0, field)).map((e) => e[2]);
  check(w(C.ACTION).join() === String(Action.ERASE_AND_FLASH), "program(): writes ACTION=ERASE_AND_FLASH");
  check(w(C.BANK).join() === "2", "program(): writes the target bank");
  check(w(C.OFFSET).join() === "8192", "program(): writes the offset");
  check(w(C.SIZE).join() === "8192", "program(): writes the uncompressed size");
  check(w(C.ERASE).join() === "1" && w(C.ERASE_BYTES).join() === "8192", "program({erase:true}): sets ERASE + ERASE_BYTES");
  check(w(C.COMPRESSED_SIZE).join() === "0", "program(): COMPRESSED_SIZE=0 when sending raw");
  const upl = f.log.filter((e) => e[0] === "ww" && e[1] === MAILBOX_ADDR + F.UPLOAD_IN_PROGRESS).map((e) => e[2]);
  check(upl.join() === "1,0", "program(): brackets the transfer with UPLOAD_IN_PROGRESS 1→0");
  const iUplDown = f.log.findIndex((e) => e[0] === "ww" && e[1] === MAILBOX_ADDR + F.UPLOAD_IN_PROGRESS && e[2] === 0);
  const iReady = f.log.findIndex((e) => e[0] === "ww" && e[1] === CTX_HDR(0, C.READY));
  check(iReady < iUplDown, "program(): READY is raised before UPLOAD_IN_PROGRESS drops");
  const iBufWrite = f.log.findIndex((e) => e[0] === "wm" && e[1] === CTX_BUF(0));
  check(iBufWrite < iReady, "program(): the payload lands in the buffer before READY is raised");
}
{
  const f = makeFake();
  await new GnwFlasher(f.transport).program(0, 0, payload(4096), { erase: false });
  const w = (field) => f.log.filter((e) => e[0] === "ww" && e[1] === CTX_HDR(0, field)).map((e) => e[2]);
  check(w(C.ERASE).join() === "0", "program({erase:false}): ERASE=0");
  check(w(C.ERASE_BYTES).length === 0, "program({erase:false}): ERASE_BYTES not written");
}
{
  // Compression is only used when it actually helps (gnw.py: > 0.9x → send raw).
  const f = makeFake();
  await new GnwFlasher(f.transport).program(0, 0, payload(4096), { compress: (d) => d.subarray(0, d.length - 8) });
  const w = f.log.filter((e) => e[0] === "ww" && e[1] === CTX_HDR(0, C.COMPRESSED_SIZE)).map((e) => e[2]);
  check(w.join() === "0", `program(): falls back to raw when compression saves < 10% (COMPRESSED_SIZE=${w.join()})`);
  check(bufWrites(f.log, 0)[0][2] === 4096, "program(): raw fallback sends the full uncompressed payload");
}
{
  const f = makeFake();
  await new GnwFlasher(f.transport).program(0, 0, payload(4096), { compress: shrink });
  const w = f.log.filter((e) => e[0] === "ww" && e[1] === CTX_HDR(0, C.COMPRESSED_SIZE)).map((e) => e[2]);
  check(w.join() === "1024", `program(): sends COMPRESSED_SIZE when compression helps (got ${w.join()})`);
  check(bufWrites(f.log, 0)[0][2] === 1024, "program(): sends only the compressed bytes");
  check(f.log.some((e) => e[0] === "wm" && e[1] === CTX_HDR(0, C.COMPRESSED_SHA256) && e[2] === 32), "program(): writes the 32-byte COMPRESSED_SHA256");
  check(f.log.some((e) => e[0] === "wm" && e[1] === CTX_HDR(0, C.EXPECTED_SHA256) && e[2] === 32), "program(): writes the 32-byte EXPECTED_SHA256 (of the UNcompressed data)");
}

// ==========================================================================
// 5. Argument validation (alignment / bank / chunk size).
// ==========================================================================
{
  const fl = new GnwFlasher(makeFake().transport);
  const rejects = async (fn, re, label) => {
    let msg = "";
    try {
      await fn();
    } catch (e) {
      msg = String(e);
    }
    check(re.test(msg), `${label} (got: ${msg || "no throw"})`);
  };
  await rejects(() => fl.program(3, 0, payload(4)), /bank must be 0, 1, or 2/, "program(): rejects an unknown bank");
  await rejects(() => fl.program(0, 4095, payload(4)), /extflash offset must be a multiple of 4096/, "program(): ext offset must be 4096-aligned");
  await rejects(() => fl.program(1, 4096, payload(4)), /intflash offset must be a multiple of 8192/, "program(): int offset must be 8192-aligned");
  await rejects(() => fl.program(0, 0, new Uint8Array(0)), /chunk must be 1\.\./, "program(): rejects an empty chunk");
  await rejects(() => fl.program(0, 0, new Uint8Array(CONTEXT_BUFFER_SIZE + 4)), /chunk must be 1\.\./, "program(): rejects a chunk larger than the context buffer");
  await rejects(() => fl.flash(1, 0, new Uint8Array(CONTEXT_BUFFER_SIZE + 8192)), /internal flash data must be/, "flash(): rejects internal-flash data over one bank buffer");
  await rejects(() => fl.readFlash(7, 0, 4), /bank must be 0, 1, or 2/, "readFlash(): rejects an unknown bank");
}

// ==========================================================================
// 6. flash(): padding, chunking, device progress bar.
// ==========================================================================
{
  const f = makeFake({ minErase: 4096 });
  const fl = new GnwFlasher(f.transport);
  await fl.flash(0, 0, payload(5000)); // → padded to 8192 with 0xff
  const bw = bufWrites(f.log, 0);
  check(bw.length === 1 && bw[0][2] === 8192, `flash(): pads up to the erase block size (wrote ${bw[0][2]}, want 8192)`);
  check(f.mem.get(CTX_BUF(0) + 5000) === 0xff && f.mem.get(CTX_BUF(0) + 8191) === 0xff, "flash(): pads with 0xff (gnwmanager pad_bytes)");
  const prog = f.log.filter((e) => e[0] === "ww" && e[1] === MAILBOX_ADDR + F.PROGRESS).map((e) => e[2]);
  // ...and then clears it. gnwmanager leaves the bar where it stopped because its CLI almost
  // always ends with `-- start bank1`, which resets the device; nothing resets ours, so a
  // finished flash left the on-device bar sitting at 100%.
  check(prog.join() === "26,0", `flash(): drives the bar to 26 and clears it (got ${prog.join()})`);
}
{
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  const seen = [];
  const data = payload(CONTEXT_BUFFER_SIZE * 2 + 4096);
  await fl.flash(0, 0, data, { onProgress: (d, t) => seen.push([d, t]) });
  const bw0 = bufWrites(f.log, 0).length,
    bw1 = bufWrites(f.log, 1).length;
  check(bw0 + bw1 === 3, `flash(): splits ${data.length} bytes into 3 x 256KiB chunks (got ${bw0 + bw1})`);
  const offs = f.log.filter((e) => e[0] === "ww" && (e[1] === CTX_HDR(0, C.OFFSET) || e[1] === CTX_HDR(1, C.OFFSET))).map((e) => e[2]);
  check(offs.join() === [0, CONTEXT_BUFFER_SIZE, 2 * CONTEXT_BUFFER_SIZE].join(), `flash(): chunk offsets advance by 256KiB (got ${offs.join()})`);
  const prog = f.log.filter((e) => e[0] === "ww" && e[1] === MAILBOX_ADDR + F.PROGRESS).map((e) => e[2]);
  check(prog.join() === "8,17,26,0", `flash(): device progress advances across chunks then clears (got ${prog.join()})`);
  const last = seen[seen.length - 1];
  check(last[0] === last[1] && last[1] === data.length, `flash(): host progress ends at total (got ${last.join("/")})`);
  check(seen.every(([d, t], k) => d <= t && (k === 0 || d >= seen[k - 1][0])), "flash(): host progress is monotonic and never exceeds the total");
  // program() waits for each chunk to finish before returning, so getContext()
  // always hands back the first (free) context — the two buffers exist for
  // double-buffering the reference tool does, which this port does not pipeline.
  check(bw0 === 3 && bw1 === 0, `flash(): consecutive chunks reuse context 0 (ctx0=${bw0}, ctx1=${bw1})`);
}

// ==========================================================================
// 7. readFlash / info / region sizes.
// ==========================================================================
{
  const f = makeFake();
  for (let k = 0; k < 64; k++) f.mem.set(BANK_BASE[0] + 0x1000 + k, k);
  const fl = new GnwFlasher(f.transport);
  const got = await fl.readFlash(0, 0x1000, 10);
  check(got.length === 10 && got[9] === 9, "readFlash(): returns exactly `size` bytes from BANK_BASE+offset");
  const rm = f.log.find((e) => e[0] === "rm");
  check(rm[1] === BANK_BASE[0] + 0x1000 && rm[2] === 12, `readFlash(): reads a 4-byte-aligned length (got ${rm[2]}, want 12)`);
  const dip = f.log.filter((e) => e[0] === "ww" && e[1] === MAILBOX_ADDR + F.DOWNLOAD_IN_PROGRESS).map((e) => e[2]);
  check(dip.join() === "1,0", "readFlash(): brackets the read with DOWNLOAD_IN_PROGRESS 1→0");
  check((await fl.readFlash(1, 0, 4)).length === 4, "readFlash(): bank 1 reads from internal flash base");
  const rm1 = f.log.filter((e) => e[0] === "rm").pop();
  check(rm1[1] === BANK_BASE[1], "readFlash(): bank 1 base is 0x08000000");
}
{
  const f = makeFake({ flashSize: 8 * 1024 * 1024, minErase: 65536 });
  const fl = new GnwFlasher(f.transport);
  const info = await fl.info();
  check(info.externalFlashSizeBytes === 8 * 1024 * 1024, "info(): reports the stub's detected flash size");
  check(info.externalFlashSizeMiB === 8, "info(): converts to MiB");
  check(info.minEraseSizeBytes === 65536, "info(): reports MIN_ERASE_SIZE");
  check(info.status === "IDLE" && statusName(STATUS_IDLE) === "IDLE", "info(): decodes the status word");
  check(info.locked === false, "info(): a readable bank-1 word means unlocked");
  check(info.detectedStockFirmware === "UNKNOWN", "info(): unrecognised ITCM → UNKNOWN");
  check((await fl.regionSize(1)) === 256 * 1024, "regionSize(): internal banks are 256 KiB");
  check((await fl.regionSize(0)) === 8 * 1024 * 1024, "regionSize(): bank 0 is the detected external size");
}
{
  // A locked device: bank-1 reads throw at the transport.
  const f = makeFake();
  const inner = f.transport.readWord.bind(f.transport);
  f.transport.readWord = async (a) => {
    if (a === BANK_BASE[1]) throw new Error("AP fault");
    return inner(a);
  };
  const info = await new GnwFlasher(f.transport).info();
  check(info.locked === true, "info(): an unreadable bank-1 word means locked");
}
{
  // externalFlashSize polls: the stub writes flash_size shortly AFTER going IDLE.
  const f = makeFake({ flashSize: 0 });
  let reads = 0;
  const inner = f.transport.readWord.bind(f.transport);
  f.transport.readWord = async (a) => {
    if (a === MAILBOX_ADDR + F.FLASH_SIZE && ++reads === 3) f.writeWordRaw(a, 1 << 20);
    return inner(a);
  };
  const v = await new GnwFlasher(f.transport).externalFlashSize(1000);
  check(v === 1 << 20, `externalFlashSize(): polls until the stub populates it (got ${v})`);
}
{
  const f = makeFake({ flashSize: 0 });
  const t0 = Date.now();
  const v = await new GnwFlasher(f.transport).externalFlashSize(60);
  check(v === 0 && Date.now() - t0 >= 50, "externalFlashSize(): gives up and returns 0 after the timeout");
}

// ==========================================================================
// 8. startStub / startBank boot sequences.
// ==========================================================================
{
  const fw = payload(256, 2);
  const dv = new DataView(fw.buffer);
  dv.setUint32(0, 0x24080000, true);
  dv.setUint32(4, 0x240e6801, true);
  const f = makeFake();
  await new GnwFlasher(f.transport).startStub(fw);
  const kinds = f.log.filter((e) => ["reset", "resume", "wr"].includes(e[0]));
  check(kinds[0][0] === "reset", "startStub(): resets-and-halts first (loading over running firmware hardfaults)");
  const msp = f.log.find((e) => e[0] === "wr" && e[1] === "msp");
  const pc = f.log.find((e) => e[0] === "wr" && e[1] === "pc");
  check(msp[2] === 0x24080000, "startStub(): MSP comes from vector-table word 0");
  check(pc[2] === 0x240e6801, "startStub(): PC comes from vector-table word 1 (Thumb bit kept)");
  const iReset = f.log.findIndex((e) => e[0] === "reset");
  const iLoad = f.log.findIndex((e) => e[0] === "wm" && e[1] === FW_LOAD_ADDR);
  const iResume = f.log.findIndex((e) => e[0] === "resume");
  check(iReset < iLoad && iLoad < iResume, "startStub(): reset → load → resume, in that order");
  const zeroed = f.log.filter((e) => e[0] === "ww" && (e[1] === MAILBOX_ADDR + F.STATUS || e[1] === MAILBOX_ADDR + F.STATUS_OVERRIDE));
  check(zeroed.length === 2 && zeroed.every((e) => e[2] === 0), "startStub(): clears residual STATUS/STATUS_OVERRIDE before booting");
  check(zeroed[0][3] === undefined && f.log.findIndex((e) => e === zeroed[0]) < iResume, "startStub(): clears status before resuming");
  const ts = f.log.filter((e) => e[0] === "ww" && e[1] === MAILBOX_ADDR + F.UTC_TIMESTAMP);
  const expect = Math.round(Date.now() / 1000) - new Date().getTimezoneOffset() * 60;
  check(ts.length === 1 && Math.abs(ts[0][2] - expect) <= 2, "startStub(): sets the device clock to host local-wall-clock-as-UTC");
  check(f.log.findIndex((e) => e === ts[0]) > iResume, "startStub(): sets the clock only after the stub is IDLE");
}
{
  // An odd-length firmware blob must be padded to a word boundary before writing.
  const fw = payload(1023, 4);
  const f = makeFake();
  await new GnwFlasher(f.transport).startStub(fw);
  const wm = f.log.find((e) => e[0] === "wm" && e[1] === FW_LOAD_ADDR);
  check(wm[2] === 1024, `startStub(): pads the blob to a 4-byte boundary (wrote ${wm[2]})`);
}
{
  const f = makeFake();
  f.writeWordRaw(BANK_BASE[2], 0x24070000);
  f.writeWordRaw(BANK_BASE[2] + 4, 0x08100201);
  await new GnwFlasher(f.transport).startBank(2);
  check(f.log[0][0] === "reset", "startBank(): reset-and-halt first");
  check(f.log.find((e) => e[0] === "wr" && e[1] === "msp")[2] === 0x24070000, "startBank(): MSP from the bank's vector table");
  check(f.log.find((e) => e[0] === "wr" && e[1] === "pc")[2] === 0x08100201, "startBank(): PC from the bank's vector table");
  check(f.log[f.log.length - 1][0] === "resume", "startBank(): resumes last");
  let msg = "";
  try {
    await new GnwFlasher(f.transport).startBank(0);
  } catch (e) {
    msg = String(e);
  }
  check(/invalid bank 0/.test(msg), "startBank(): bank 0 (external flash) is not bootable");
}

// ==========================================================================
// 9. waitForIdle / getContext.
// ==========================================================================
{
  const f = makeFake();
  f.writeWordRaw(MAILBOX_ADDR + F.STATUS, 0xbad00006);
  let msg = "";
  try {
    await new GnwFlasher(f.transport).waitForIdle(80);
  } catch (e) {
    msg = String(e);
  }
  check(/stub reported BAD_FLASH_COMM/.test(msg), "waitForIdle(): throws `stub reported BAD_FLASH_COMM` on a BAD_* status");
  check(/BAD_FLASH_COMM/.test(msg), `waitForIdle(): a BAD_* status does at least stop the wait, naming the status (got: ${msg})`);
}
{
  const f = makeFake();
  f.writeWordRaw(MAILBOX_ADDR + F.STATUS, 0xcafe0001); // ERASE forever
  const t0 = Date.now();
  let msg = "";
  try {
    await new GnwFlasher(f.transport).waitForIdle(80);
  } catch (e) {
    msg = String(e);
  }
  // The budget is no-progress and two-stage: a warning at half, then give up and let the
  // caller's retry reboot the stub. The message names the status it died in, which is the only
  // part a reader can act on.
  check(/stalled for .*s with no progress \(status ERASE\); restarting the flash util/.test(msg),
        `waitForIdle(): gives up naming the last status (got: ${msg})`);
  check(Date.now() - t0 >= 70, "waitForIdle(): honours the no-progress budget before giving up");
}
{
  // The deadline must RESET on every status change (a slow-but-advancing op is fine).
  const f = makeFake();
  let n = 0;
  const inner = f.transport.readWord.bind(f.transport);
  f.transport.readWord = async (a) => {
    if (a === MAILBOX_ADDR + F.STATUS) {
      n++;
      if (n < 12) return [0xcafe0001, 0xcafe0002, 0xcafe0003][n % 3]; // keeps changing
      return STATUS_IDLE;
    }
    return inner(a);
  };
  let ok = true;
  try {
    await new GnwFlasher(f.transport).waitForIdle(60);
  } catch {
    ok = false;
  }
  check(ok, "waitForIdle(): a changing status resets the deadline (no spurious timeout)");
}
{
  const f = makeFake();
  f.writeWordRaw(CTX_HDR(0, C.READY), 5); // ctx0 busy
  const i = await new GnwFlasher(f.transport).getContext(500);
  check(i === 1, "getContext(): skips a busy context and returns the free one");
  f.writeWordRaw(CTX_HDR(1, C.READY), 7);
  let msg = "";
  try {
    await new GnwFlasher(f.transport).getContext(60);
  } catch (e) {
    msg = String(e);
  }
  // NO-PROGRESS wording: the budget resets on a status change, so the failure names the stall
  // rather than a wall clock. A device that is still working keeps its deadline alive.
  check(/no free context: no progress for/.test(msg), `getContext(): gives up when both contexts stay busy with no status change (got ${msg})`);
}
{
  const f = makeFake();
  const ac = new AbortController();
  ac.abort();
  let msg = "";
  try {
    await new GnwFlasher(f.transport).program(0, 0, payload(4096), { abortSignal: ac.signal });
  } catch (e) {
    msg = String(e);
  }
  check(/Operation aborted/.test(msg), "program(): honours an already-aborted signal");
  check(f.log.length === 0, "program(): an aborted call touches the transport not at all");
}

// ==========================================================================
// 10. statusName decoding.
// ==========================================================================
check(statusName(0xbad0000e) === "BAD_HASH_RAM_COMPRESSED", "statusName(): decodes BAD_HASH_RAM_COMPRESSED");
check(statusName(0xcafe0002) === "PROG", "statusName(): decodes PROG");
check(statusName(0x12345678) === "UNKNOWN(0x12345678)", "statusName(): reports unknown codes verbatim");

// --- a finished flash leaves nothing in flight ------------------------------------------------
// gnwmanager's `_flash_ext` ends with `wait_for_all_contexts_complete()`; ours waited only on
// the context each chunk used. With two contexts the other can still be mid erase/program when
// the loop ends, so `flash()` returned while the device was busy -- and the NEXT flash stalled
// on its first transfer, because `getContext` found no free slot and `ensureStub`'s
// `contextsFree` probe read that as a wedged stub and rebooted the device.
{
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  await fl.flash(0, 0, payload(3 * 262144));
  const stillBusy = [0, 1].filter((i) => (f.readWordRaw(CTX_HDR(i, C.READY)) >>> 0) !== 0);
  check(stillBusy.length === 0, `flash(): returns with every context drained (busy: ${stillBusy.join(",") || "none"})`);
  // ARMED: the fake must be capable of showing a busy context, or the check above is vacuous.
  f.writeWordRaw(CTX_HDR(0, C.READY), 9);
  check((f.readWordRaw(CTX_HDR(0, C.READY)) >>> 0) === 9, "the fake can represent a busy context");
}

// --- the stall warning fires before the give-up ------------------------------------------------
// 10 s of silence is worth saying out loud; 20 s means the stub is wedged. Both halves come from
// one rule (`stallWatch`) so the two waits cannot drift apart.
{
  const f = makeFake({ statusHook: () => ST.ERASE });
  const lines = [];
  let msg = "";
  try {
    await new GnwFlasher(f.transport).waitForIdle(200, (m) => lines.push(m));
  } catch (e) {
    msg = String(e);
  }
  const warned = lines.filter((l) => /warning: the device has not advanced for/.test(l));
  check(warned.length === 1, `waitForIdle(): warns once at half the budget (got ${warned.length}: ${lines.join(" | ")})`);
  check(/stalled for/.test(msg), "waitForIdle(): still gives up after the warning");
}

// --- a stalled context gives up in 20 s, not 120 --------------------------------------------
// From a real device log: a context was written, the mailbox went IDLE, and nothing happened for
// TWO MINUTES before the retry rebooted the stub and the identical chunk flashed instantly. The
// no-progress rule was already 20 s, but program() passed 120000 explicitly and silently
// defeated it at the one call site that matters.
//
// The cause of the stall itself is the context counter: the stub accepts a context only when
// `ready` equals its own `context_counter` (gnwmanager.c), which resets when the stub restarts
// while ours resets only in startStub. A device that restarted under a cached flasher waits for
// 1 while the host writes N. The error says so, because "stalled at IDLE" is otherwise
// indistinguishable from a dead device.
{
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const call = src.match(/await this\.waitForContextComplete\(i, log, ([^,]+),/);
  check(!!call, "program() no longer waits on its context");
  check(call && call[1].trim() === "undefined",
    `program() must use waitForContextComplete's own budget (passes ${call && call[1].trim()})`);
  const def = src.match(/waitForContextComplete\(i: number, log: LogFn = \(\) => \{\}, timeoutMs = (\d+)/);
  check(def && Number(def[1]) === 20000, `the per-context budget must be 20 s (is ${def && def[1]} ms)`);
  check(/the mailbox is idle, so the device is most likely waiting for a different/.test(src),
    "a stall at IDLE does not explain itself");
}

// --- an unsolicited stub restart must not deadlock the mailbox --------------------------------
// From a real device log: a context was written, the mailbox went IDLE, and nothing happened for
// TWO MINUTES until the retry rebooted the stub, after which the identical chunk flashed in three
// seconds.
//
// The stub accepts a context only when `ready` equals its own `context_counter`
// (gnwmanager.c's `get_context()`), a `.data` static that returns to 1 every time the stub
// starts running. The shared mailbox does NOT reset with it. So a stub that restarts underneath
// a cached flasher waits for 1 while the host writes N, forever, with the mailbox at IDLE the
// whole time -- which is why every liveness check passes: the stub IS alive and the contexts ARE
// free. gnwmanager never hits this because its host is the only thing that ever resets the
// device (`reset_context_counter` on every `reset`/`reset_and_halt`), an assumption a
// long-lived browser session cannot make.
{
  const f = makeFake();
  const fl = new GnwFlasher(f.transport);
  await fl.program(0, 0, payload(4096));            // in sync: both counters advance to 2

  // The stub restarts on its own. The host is not told and keeps its counter.
  f.dev.contextCounter = 1;

  const t0 = Date.now();
  let err = null;
  await fl.program(0, 4096, payload(4096)).catch((e) => (err = e));
  const ms = Date.now() - t0;

  check(err !== null, "a desynced context must fail rather than hang forever");
  check(/context counter/i.test(String(err && err.message)),
        `the failure must name the context counter (got: ${err && err.message})`);
  // The point of the fix: noticed within the pickup grace, not after the generic no-progress
  // budget. Bounded tightly on purpose -- "under 10 s" would still pass a 9 s regression.
  check(ms < 5000, `a desync must be caught within the pickup grace (took ${ms} ms)`);
  check(ms >= 1500, `...but not so eagerly it could fire on a merely slow device (took ${ms} ms)`);
}

console.log(`gnw-flasher: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
