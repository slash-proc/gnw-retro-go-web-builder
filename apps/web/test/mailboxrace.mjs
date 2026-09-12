#!/usr/bin/env node
/**
 * TWO LOGICAL OPERATIONS ON ONE FLASHER MUST NOT WEDGE THE MAILBOX.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/mailboxrace.mjs'
 *
 * THE BUG THIS EXISTS FOR. The owner clicked Sync Library and got an install parked at 0% with
 * a device scan frozen part-way through the extflash walk. Nothing in the app stops an
 * automatic rescan (a USB re-enumeration fires `connect()`, which fires `runScan`) from running
 * while an install holds the link, and once two logical operations share one `GnwFlasher` the
 * mailbox protocol has no defence at all:
 *
 *   1. `getContext()` RESERVES NOTHING. It returns the first slot whose `ready` word reads 0,
 *      so two callers both get slot 0.
 *   2. Filling a slot is five or six separate transport calls, so the two fills interleave and
 *      clobber each other's ACTION/OFFSET/SIZE.
 *   3. Both post the SAME `ready` word, with consecutive counter values. The second write
 *      DESTROYS the first before the device's main loop ever reads it.
 *
 * The device picks a context up only when `ready` equals its own `context_counter`
 * (`gnwmanager.c`'s `get_context()`), and bumps that counter only on pickup. So after (3) it is
 * waiting for a value that exists nowhere while the host has moved two ahead: nothing is ever
 * picked up again. That is not one corrupted transfer, it is a permanently wedged mailbox, and
 * it is exactly "stuck at 0%".
 *
 * WHY THE TRANSPORT QUEUE DOES NOT SAVE US. `serialTransport` (engine/transport.ts) is a FIFO
 * that stops individual TRANSFERS interleaving at the USB level. The unit that must be atomic
 * here is a multi-call SEQUENCE, which a per-call queue cannot express. The queue is reproduced
 * faithfully below precisely so this suite cannot pass by pretending it helps.
 *
 * THE FAKE DEVICE picks contexts up in its MAIN LOOP, not synchronously on the host's write --
 * which is what `gnwmanager.c` actually does, and the only way the desync can be expressed at
 * all. (`packages/gnw-flasher/test/protocol.mjs`'s fake accepts on write; that is a fine
 * simplification for the invariants it pins, and it is why this race is invisible there.)
 * `loopDivider` models the firmware loop running slower than SWD transfers, which is the real
 * ratio: the loop also refreshes the watchdog and redraws the GUI.
 */
import { gnwImport } from "./gnwResolve.mjs";

const { GnwFlasher, MAILBOX_ADDR, CONTEXT_BUFFER_SIZE, STATUS_IDLE } = await gnwImport(
  import.meta.url,
  "gnw-flasher",
);

let pass = 0,
  fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// Mailbox layout, re-declared rather than imported -- pin the numbers (protocol.mjs does the
// same, for the same reason).
const F = { STATUS: 0x00, FLASH_SIZE: 0x10, MIN_ERASE_SIZE: 0x14 };
const C = { READY: 0x16c, RESPONSE_READY: 0x170 };
const CTX_HDR = (i, f) => MAILBOX_ADDR + (i + 1) * 1024 + f;
const ST = { ERASE: 0xcafe0001, HASH: 0xcafe0003 };

function makeFake(loopDivider = 0) {
  const mem = new Map();
  const dev = {
    contextCounter: 1,
    ctx: [null, null],
    /** Every `ready` the host wrote: [slot, value]. */
    posts: [],
    /** Every context the device's main loop actually accepted: [slot, value]. */
    pickedUp: [],
    ticks: 0,
    loopDivider,
  };
  const rd = (a) => mem.get(a) ?? 0;
  const rw = (a) => (rd(a) | (rd(a + 1) << 8) | (rd(a + 2) << 16) | (rd(a + 3) << 24)) >>> 0;
  const ww = (a, v) => {
    mem.set(a, v & 0xff);
    mem.set(a + 1, (v >>> 8) & 0xff);
    mem.set(a + 2, (v >>> 16) & 0xff);
    mem.set(a + 3, (v >>> 24) & 0xff);
  };
  const setStatus = (v) => ww(MAILBOX_ADDR + F.STATUS, v >>> 0);
  setStatus(STATUS_IDLE);
  ww(MAILBOX_ADDR + F.FLASH_SIZE, 64 * 1024 * 1024);
  ww(MAILBOX_ADDR + F.MIN_ERASE_SIZE, 4096);

  const tick = () => {
    dev.ticks += 1;
    // gnwmanager.c's main loop: get_context() accepts a slot only on an EXACT counter match,
    // and context_counter++ happens on pickup. A value that never matches is never picked up
    // and the loop simply parks at IDLE -- a desynced device looks like one with nothing to do.
    if (!dev.loopDivider || dev.ticks % dev.loopDivider === 0) {
      for (let i = 0; i < 2; i++) {
        if (dev.ctx[i]) continue;
        const ready = rw(CTX_HDR(i, C.READY)) >>> 0;
        if (ready !== 0 && ready === dev.contextCounter) {
          dev.contextCounter += 1;
          dev.ctx[i] = { t: 0, phase: "xfer" };
          dev.pickedUp.push([i, ready]);
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const s = dev.ctx[i];
      if (!s) continue;
      s.t += 1;
      if (s.phase === "xfer") {
        if (s.t >= 2) {
          ww(CTX_HDR(i, C.READY), 0); // ready cleared -- but the work is NOT done
          setStatus(ST.ERASE);
          s.phase = "work";
          s.t = 0;
        }
      } else if (s.phase === "work") {
        if (s.t === 2) setStatus(ST.HASH);
        if (s.t >= 4) {
          setStatus(STATUS_IDLE);
          ww(CTX_HDR(i, C.RESPONSE_READY), 1);
          dev.ctx[i] = null;
        }
      }
    }
  };

  const transport = {
    async connect() {},
    async readWord(a) {
      tick();
      return rw(a) >>> 0;
    },
    async writeWord(a, v) {
      ww(a, v >>> 0);
      for (let i = 0; i < 2; i++) if (a === CTX_HDR(i, C.READY) && v !== 0) dev.posts.push([i, v >>> 0]);
    },
    async readMemory(a, len) {
      tick();
      const o = new Uint8Array(len);
      for (let k = 0; k < len; k++) o[k] = rd(a + k);
      return o;
    },
    async writeMemory(a, d, p) {
      for (let k = 0; k < d.length; k++) mem.set(a + k, d[k]);
      p?.(d.length, d.length);
    },
    async halt() {},
    async resume() {},
    async reset() {},
    async readRegister() {
      return 0;
    },
    async writeRegister() {},
  };
  return { transport, dev };
}

/** The real `serialTransport` FIFO (apps/web/src/lib/engine/transport.ts), pinned here rather
 *  than imported: importing it would drag dapjs and webstlink into a node suite. It is present
 *  so the suite proves the race survives the queue, which is the whole point. */
function serial(t) {
  let tail = Promise.resolve();
  let pending = 0;
  const q = (fn) => {
    pending++;
    const run = tail.then(fn);
    tail = run.catch(() => {});
    void run.then(
      () => void pending--,
      () => void pending--,
    );
    return run;
  };
  return {
    busy: () => pending > 0,
    connect: () => q(() => t.connect()),
    readMemory: (a, l, p) => q(() => t.readMemory(a, l, p)),
    writeMemory: (a, d, p) => q(() => t.writeMemory(a, d, p)),
    readWord: (a) => q(() => t.readWord(a)),
    writeWord: (a, v) => q(() => t.writeWord(a, v)),
    halt: () => q(() => t.halt()),
    resume: () => q(() => t.resume()),
    reset: () => q(() => t.reset()),
    readRegister: (n) => q(() => t.readRegister(n)),
    writeRegister: (n, v) => q(() => t.writeRegister(n, v)),
  };
}

const data = new Uint8Array(4096).fill(7);
const lost = (dev) => dev.posts.length - dev.pickedUp.length;

// --- The control: one operation at a time is unaffected -------------------------------------
const seqFake = makeFake(8);
const seqFlasher = new GnwFlasher(serial(seqFake.transport));
await seqFlasher.program(0, 0, data, { erase: true });

check("a lone program posts one context and the device picks it up", () => {
  eq(seqFake.dev.posts, [[0, 1]], "one post");
  eq(seqFake.dev.pickedUp, [[0, 1]], "picked up");
  eq(lost(seqFake.dev), 0, "nothing lost");
});

// --- The race ------------------------------------------------------------------------------
// A flash and a scan-shaped hash request, started together on ONE flasher. `loopDivider: 8` is
// the case that wedges: both posts land before the device's loop reads the word even once.
const raceFake = makeFake(8);
const raceFlasher = new GnwFlasher(serial(raceFake.transport));
const settled = await Promise.allSettled([
  raceFlasher.program(0, 0, data, { erase: true }),
  raceFlasher.readHashes(0, 256 * 1024, 1500),
]);

check("EVERY context the host posts is picked up by the device", () => {
  // THE assertion. Before the fix this was 2: both posts went to slot 0, the second `ready`
  // write destroyed the first, and the device sat waiting for a counter value that no longer
  // existed anywhere -- the mailbox wedged for good.
  eq(lost(raceFake.dev), 0, `posts ${JSON.stringify(raceFake.dev.posts)} vs picked up ${JSON.stringify(raceFake.dev.pickedUp)}`);
});

check("the device's context counter keeps advancing, so the mailbox is not desynced", () => {
  assert(
    raceFake.dev.contextCounter === raceFake.dev.pickedUp.length + 1,
    `counter ${raceFake.dev.contextCounter} does not match ${raceFake.dev.pickedUp.length} pickup(s)`,
  );
  assert(raceFake.dev.contextCounter > 1, "the device never picked up anything at all");
});

check("two concurrent operations never hold the same context slot", () => {
  // Reuse AFTER a slot is released is normal and expected; what must never happen is two live
  // posts to the same slot, which is what the counter check above would also catch. Stated
  // separately because it is the mechanism, and a future change could break one without the
  // other.
  const liveSlots = raceFake.dev.posts.map(([slot]) => slot);
  eq(liveSlots.length, new Set(liveSlots).size || liveSlots.length, "slots");
  assert(
    raceFake.dev.pickedUp.every(([slot], n) => raceFake.dev.posts[n][0] === slot),
    `pickup order diverged from post order: ${JSON.stringify(raceFake.dev.posts)} vs ${JSON.stringify(raceFake.dev.pickedUp)}`,
  );
});

// --- The pairing that collides without the lock ---------------------------------------------
// TWO HASH REQUESTS, which is what a scan's chunk-verification issues. Stated separately
// because it is the only pairing whose collision the lock alone prevents: `program()` hashes
// and compresses its chunk BEFORE claiming, and that CPU preamble happens to offset the two
// claims enough that they miss each other even with the lock defeated. "Happens to" is not a
// guarantee -- real LZMA and real SWD latency reorder it -- so the lock is what makes it true
// for every pairing, and this is the pairing that can PROVE the lock is doing the work.
const hashFake = makeFake(8);
const hashFlasher = new GnwFlasher(serial(hashFake.transport));
await Promise.allSettled([
  hashFlasher.readHashes(0, 256 * 1024, 1500),
  hashFlasher.readHashes(256 * 1024, 256 * 1024, 1500),
]);

check("two concurrent hash requests post distinct, consecutive contexts", () => {
  eq(lost(hashFake.dev), 0, `posts ${JSON.stringify(hashFake.dev.posts)} vs picked up ${JSON.stringify(hashFake.dev.pickedUp)}`);
  const values = hashFake.dev.posts.map(([, v]) => v);
  eq(values, [1, 2], "consecutive counter values, one per operation");
});

check("the FLASH completes rather than parking at 0%", () => {
  const flash = settled[0];
  assert(
    flash.status === "fulfilled",
    `the flash was rejected, which is the reported hang: ${flash.status === "rejected" ? flash.reason.message : ""}`,
  );
});

// ARMED. If the fake ever stops modelling the exact-match pickup rule, every check above passes
// vacuously -- a device that accepts any value can never desync. Prove the rule bites.
check("the fake really does refuse a mismatched counter", () => {
  const f = makeFake();
  f.transport.writeWord(CTX_HDR(0, C.READY), 99);
  f.transport.readWord(MAILBOX_ADDR + F.STATUS); // drives one main-loop tick
  eq(f.dev.pickedUp, [], "a counter the device is not waiting for must never be picked up");
  eq(f.dev.contextCounter, 1, "and must not advance its counter");
});

console.log(`\nmailboxrace: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
