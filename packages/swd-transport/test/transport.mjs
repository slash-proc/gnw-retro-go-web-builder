/**
 * swd-transport unit suite (no hardware, no device access).
 *
 * Drives the REAL DapjsTransport / WebStlinkTransport against fake injected
 * CortexM / Stlinkv2 handles that model a tiny memory map and record an ordered
 * trace of every register access. That makes the register *sequences* — which is
 * all this package really is — directly assertable.
 *
 * Highest-value invariant here (CLAUDE.md): halt() must freeze BOTH hardware
 * watchdogs (DBG_WWDG1 in DBGMCU.APB3FZ1, DBG_IWDG1 in DBGMCU.APB4FZ1) BEFORE
 * halting the core, and resume() must unfreeze both. Not doing so was the actual
 * cause of the device resetting mid-screenshot.
 */
import { DapjsTransport, WebStlinkTransport } from "../dist/index.js";

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
};

// --- register addresses under test (duplicated on purpose: the test must pin the
// literal numbers, not import whatever the module currently believes them to be) --
const DHCSR = 0xe000edf0;
const DEMCR = 0xe000edfc;
const AIRCR = 0xe000ed0c;
const S_HALT = 1 << 17;
const APB3FZ1 = 0x5c001034;
const WWDG1 = 1 << 6;
const APB4FZ1 = 0x5c001054;
const IWDG1 = 1 << 18;

/** Fake dapjs CortexM: word memory + an ordered trace of every access. */
function makeCortexM(opts = {}) {
  const mem = new Map();
  const trace = [];
  const regs = new Map();
  let halted = false;
  const self = {
    mem,
    trace,
    regs,
    async connect() {
      trace.push(["connect"]);
    },
    async readMem32(addr) {
      // DHCSR reflects the halt state the fake core is actually in.
      if (addr === DHCSR) {
        trace.push(["rw", addr]);
        return halted ? S_HALT : 0;
      }
      trace.push(["rw", addr]);
      return (mem.get(addr) ?? 0) >>> 0;
    },
    async writeMem32(addr, val) {
      trace.push(["ww", addr, val >>> 0]);
      if (addr === DHCSR) halted = (val & 2) !== 0; // C_HALT
      if (addr === AIRCR && opts.resetRehalts === false) halted = false;
      mem.set(addr, val >>> 0);
    },
    async readCoreRegister(n) {
      trace.push(["rr", n]);
      return regs.get(n) ?? 0;
    },
    async writeCoreRegister(n, v) {
      trace.push(["wr", n, v >>> 0]);
      regs.set(n, v >>> 0);
    },
  };
  if (opts.block !== false) {
    self.readBlock = async (addr, words) => {
      trace.push(["rb", addr, words]);
      const out = new Uint32Array(words);
      for (let i = 0; i < words; i++) out[i] = (mem.get(addr + i * 4) ?? 0) >>> 0;
      return out;
    };
    self.writeBlock = async (addr, words) => {
      trace.push(["wb", addr, words.length]);
      for (let i = 0; i < words.length; i++) mem.set(addr + i * 4, words[i] >>> 0);
    };
  }
  return self;
}

const idx = (trace, pred) => trace.findIndex(pred);

// ---------------------------------------------------------------- halt() ----
{
  const cm = makeCortexM();
  const t = new DapjsTransport(cm);
  await t.halt();
  const tr = cm.trace;

  const w3 = idx(tr, (e) => e[0] === "ww" && e[1] === APB3FZ1);
  const w4 = idx(tr, (e) => e[0] === "ww" && e[1] === APB4FZ1);
  const wh = idx(tr, (e) => e[0] === "ww" && e[1] === DHCSR);

  check(w3 !== -1, "halt(): writes DBGMCU.APB3FZ1 (WWDG1 freeze)");
  check(w3 !== -1 && (tr[w3][2] & WWDG1) !== 0, "halt(): APB3FZ1 write sets DBG_WWDG1 (bit 6)");
  check(w4 !== -1, "halt(): writes DBGMCU.APB4FZ1 (IWDG1 freeze)");
  check(w4 !== -1 && (tr[w4][2] & IWDG1) !== 0, "halt(): APB4FZ1 write sets DBG_IWDG1 (bit 18)");
  check(wh !== -1, "halt(): writes DHCSR");
  check(w3 !== -1 && wh !== -1 && w3 < wh, "halt(): WWDG1 frozen BEFORE the core is halted");
  check(w4 !== -1 && wh !== -1 && w4 < wh, "halt(): IWDG1 frozen BEFORE the core is halted");
  check(tr[wh][2] >>> 0 === (0xa05f0000 | 1 | 2) >>> 0, "halt(): DHCSR = DBGKEY|C_DEBUGEN|C_HALT");
  check(
    idx(tr, (e) => e[0] === "rw" && e[1] === DHCSR) > wh,
    "halt(): polls DHCSR for S_HALT after requesting the halt",
  );
}

// halt() must still freeze both when one bit is ALREADY set (no early-out on the other).
{
  const cm = makeCortexM();
  cm.mem.set(APB3FZ1, WWDG1); // WWDG1 already frozen
  const t = new DapjsTransport(cm);
  await t.halt();
  check(
    idx(cm.trace, (e) => e[0] === "ww" && e[1] === APB4FZ1 && (e[2] & IWDG1) !== 0) !== -1,
    "halt(): freezes IWDG1 even when WWDG1 was already frozen",
  );
}

// halt() must fail loudly if the core never reports S_HALT.
{
  const cm = makeCortexM();
  cm.readMem32 = async (addr) => (addr === DHCSR ? 0 : 0); // never halts
  let threw = false;
  try {
    await new DapjsTransport(cm).halt();
  } catch (e) {
    threw = /did not halt/.test(String(e));
  }
  check(threw, "halt(): throws when S_HALT never sets");
}

// -------------------------------------------------------------- resume() ----
{
  const cm = makeCortexM();
  cm.mem.set(APB3FZ1, WWDG1 | 0x1234);
  cm.mem.set(APB4FZ1, IWDG1 | 0x5678);
  const t = new DapjsTransport(cm);
  await t.resume();
  const tr = cm.trace;
  const wh = idx(tr, (e) => e[0] === "ww" && e[1] === DHCSR);
  const w3 = idx(tr, (e) => e[0] === "ww" && e[1] === APB3FZ1);
  const w4 = idx(tr, (e) => e[0] === "ww" && e[1] === APB4FZ1);
  check(tr[wh][2] >>> 0 === (0xa05f0000 | 1) >>> 0, "resume(): DHCSR = DBGKEY|C_DEBUGEN (C_HALT clear)");
  check(w3 !== -1 && (tr[w3][2] & WWDG1) === 0, "resume(): clears DBG_WWDG1");
  check(w3 !== -1 && (tr[w3][2] & 0x1234) === 0x1234, "resume(): preserves other APB3FZ1 bits");
  check(w4 !== -1 && (tr[w4][2] & IWDG1) === 0, "resume(): clears DBG_IWDG1");
  check(w4 !== -1 && (tr[w4][2] & 0x5678) === 0x5678, "resume(): preserves other APB4FZ1 bits");
  check(wh < w3 && wh < w4, "resume(): unfreezes watchdogs AFTER the core is running");
}

// --------------------------------------------------------------- reset() ----
{
  const cm = makeCortexM();
  const t = new DapjsTransport(cm);
  await t.reset();
  const tr = cm.trace;
  const wDemcr = tr.filter((e) => e[0] === "ww" && e[1] === DEMCR);
  const iAircr = idx(tr, (e) => e[0] === "ww" && e[1] === AIRCR);
  const iDemcr0 = idx(tr, (e) => e[0] === "ww" && e[1] === DEMCR && e[2] === 1);
  check(idx(tr, (e) => e[0] === "ww" && e[1] === APB3FZ1) !== -1, "reset(): halts first (freezes WWDG1)");
  check(wDemcr.length === 2 && wDemcr[0][2] === 1, "reset(): sets DEMCR.VC_CORERESET before the reset request");
  check(iAircr !== -1 && tr[iAircr][2] >>> 0 === (0x05fa0000 | 4) >>> 0, "reset(): AIRCR = VECTKEY|SYSRESETREQ");
  check(iDemcr0 < iAircr, "reset(): VC_CORERESET armed before SYSRESETREQ");
  check(wDemcr[1][2] === 0, "reset(): restores DEMCR to 0 afterwards");
}

// reset() must throw AND still restore DEMCR when the core never re-halts.
{
  const cm = makeCortexM({ resetRehalts: false });
  let threw = false;
  try {
    await new DapjsTransport(cm).reset();
  } catch (e) {
    threw = /did not re-halt/.test(String(e));
  }
  check(threw, "reset(): throws when the core never re-halts");
  const last = cm.trace.filter((e) => e[0] === "ww" && e[1] === DEMCR).pop();
  check(last && last[2] === 0, "reset(): restores DEMCR to 0 even on the failure path");
}

// ------------------------------------------------- register name mapping ----
{
  const cm = makeCortexM();
  const t = new DapjsTransport(cm);
  cm.regs.set(13, 0x20001000);
  cm.regs.set(15, 0x08000101);
  check((await t.readRegister("sp")) === 0x20001000, "readRegister('sp') → DCRSR 13");
  check((await t.readRegister("PC")) === 0x08000101, "readRegister is case-insensitive, pc → 15");
  await t.writeRegister("msp", 0xdeadbeef);
  check(cm.regs.get(17) === 0xdeadbeef, "writeRegister('msp') → DCRSR 17");
  await t.writeRegister("r14", 0xffffffff);
  check(cm.regs.get(14) === 0xffffffff, "writeRegister('r14') → DCRSR 14 (unsigned)");
  let threw = false;
  try {
    await t.readRegister("nope");
  } catch (e) {
    threw = /unknown register/.test(String(e));
  }
  check(threw, "readRegister(): unknown name throws");
}

// ------------------------------------------- chunking + word alignment ------
{
  const cm = makeCortexM();
  const t = new DapjsTransport(cm);
  for (let a = 0; a < 4096; a += 4) cm.mem.set(0x24000000 + a, a);

  const seen = [];
  const got = await t.readMemory(0x24000000, 4096, (d, tot) => seen.push([d, tot]));
  const blocks = cm.trace.filter((e) => e[0] === "rb");
  check(blocks.length === 4, `readMemory(4096) splits into 4x1KiB reads (got ${blocks.length})`);
  check(blocks.every((b) => b[2] === 256), "readMemory(): each chunk is 256 words (1 KiB)");
  check(
    blocks.map((b) => b[1]).join() === [0x24000000, 0x24000400, 0x24000800, 0x24000c00].join(),
    "readMemory(): chunk addresses advance by CHUNK",
  );
  const dv = new DataView(got.buffer, got.byteOffset, got.byteLength);
  check(dv.getUint32(0, true) === 0 && dv.getUint32(4092, true) === 4092, "readMemory(): assembles LE words in order");
  check(
    seen.length === 4 && seen[0][0] === 1024 && seen[3][0] === 4096 && seen[3][1] === 4096,
    "readMemory(): progress reports bytes-done/total per chunk",
  );

  let threw = 0;
  try {
    await t.readMemory(0x24000002, 4);
  } catch {
    threw++;
  }
  try {
    await t.readMemory(0x24000000, 6);
  } catch {
    threw++;
  }
  check(threw === 2, "readMemory(): rejects unaligned addr and unaligned len");
}

{
  const cm = makeCortexM();
  const t = new DapjsTransport(cm);
  const data = new Uint8Array(2048);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
  await t.writeMemory(0x24010000, data);
  const wb = cm.trace.filter((e) => e[0] === "wb");
  check(wb.length === 2 && wb[0][2] === 256 && wb[1][2] === 256, "writeMemory(2048) splits into 2x1KiB writes");
  const back = await t.readMemory(0x24010000, 2048);
  check(back.every((b, i) => b === data[i]), "writeMemory/readMemory round-trip is byte-exact (LE codec)");
}

// Fallback path: a CortexM with no readBlock/writeBlock must still work word-by-word.
{
  const cm = makeCortexM({ block: false });
  const t = new DapjsTransport(cm);
  const data = new Uint8Array([1, 2, 3, 4, 0xff, 0xee, 0xdd, 0xcc]);
  await t.writeMemory(0x30000000, data);
  check(cm.mem.get(0x30000000) === 0x04030201, "no-writeBlock fallback: word 0 written little-endian");
  check(cm.mem.get(0x30000004) === 0xccddeeff, "no-writeBlock fallback: word 1 written little-endian");
  const back = await t.readMemory(0x30000000, 8);
  check(back.every((b, i) => b === data[i]), "no-readBlock fallback: round-trips byte-exact");
}

// ------------------------------------------------- WebStlinkTransport -------
{
  const trace = [];
  const mem = new Map();
  let halted = false;
  const stlink = {
    async get_debugreg32(addr) {
      trace.push(["rw", addr]);
      if (addr === DHCSR) return halted ? S_HALT : 0;
      return (mem.get(addr) ?? 0) >>> 0;
    },
    async set_debugreg32(addr, v) {
      trace.push(["ww", addr, v >>> 0]);
      if (addr === DHCSR) halted = (v & 2) !== 0;
      mem.set(addr, v >>> 0);
    },
    async get_mem32(addr, size) {
      trace.push(["rm", addr, size]);
      const b = new Uint8Array(size);
      b.fill(0xa5);
      return new DataView(b.buffer);
    },
    async set_mem32(addr, data) {
      trace.push(["wm", addr, data.length, data]);
    },
    async get_reg(n) {
      trace.push(["rr", n]);
      return 42;
    },
    async set_reg(n, v) {
      trace.push(["wr", n, v]);
    },
  };
  const t = new WebStlinkTransport(stlink);
  await t.halt();
  const w3 = idx(trace, (e) => e[0] === "ww" && e[1] === APB3FZ1);
  const w4 = idx(trace, (e) => e[0] === "ww" && e[1] === APB4FZ1);
  const wh = idx(trace, (e) => e[0] === "ww" && e[1] === DHCSR);
  check(w3 !== -1 && (trace[w3][2] & WWDG1) !== 0 && w3 < wh, "stlink halt(): freezes WWDG1 before halting");
  check(w4 !== -1 && (trace[w4][2] & IWDG1) !== 0 && w4 < wh, "stlink halt(): freezes IWDG1 before halting");

  // A subarray must not leak neighbouring bytes into set_mem32.
  const big = new Uint8Array(16);
  for (let i = 0; i < 16; i++) big[i] = i;
  await t.writeMemory(0x24000000, big.subarray(4, 12));
  const wm = trace.filter((e) => e[0] === "wm").pop();
  check(wm[2] === 8 && Array.from(wm[3]).join() === "4,5,6,7,8,9,10,11", "stlink writeMemory: passes the right 8 bytes of a subarray");
  // Must be a TIGHT copy: a subarray view would let set_mem32 see the neighbours.
  check(
    wm[3].byteOffset === 0 && wm[3].buffer.byteLength === 8 && wm[3] !== big,
    "stlink writeMemory: hands set_mem32 a tight copy, not a view into a larger buffer",
  );

  const r = await t.readMemory(0x24000000, 8);
  check(r.length === 8 && r.every((b) => b === 0xa5), "stlink readMemory: returns the bytes get_mem32 delivered");
  check((await t.readRegister("lr")) === 42, "stlink readRegister maps names via the shared table");
}

console.log(`swd-transport: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
