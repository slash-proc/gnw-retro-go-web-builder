/**
 * Automatic unlocking: the ORDER, and the places that must ask for it.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/unlockgate.mjs'
 *
 * The owner: "the device should be unlocked if they're using this tool to change anything on
 * the device. It should just automatically happen. We don't care about locking because there's
 * no benefit to it."
 *
 * WHY THIS SUITE IS MOSTLY ABOUT ORDERING. Clearing RDP mass-erases both flashes, and a unit's
 * stock firmware carries per-unit data that cannot be re-downloaded. So `unlock()` running one
 * step too early is not a cosmetic bug, it is the user's original firmware gone. Section 1
 * drives the real `engine/unlockGate.ts` with a recording harness and asserts the SEQUENCE:
 * the backup question is answered before `unlock` is reachable, a declined prompt never
 * reaches it at all, and a device with a backup is never asked.
 *
 * Section 2 is the register sequence against `references/gnwmanager/gnwmanager/cli/_unlock.py`,
 * driven through a fake transport that records every word written. Section 3 pins the two
 * places that must NOT auto-unlock (they are backups; unlocking would erase what they are
 * saving), and section 4 that each write flow does.
 *
 * WHAT THIS CANNOT PROVE. Nothing here touches hardware -- no device is read or written by this
 * suite, and the four option-byte writes are checked against the reference's constants, not
 * against a Game & Watch. Whether the device actually comes back unlocked is a human test.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { gnwResolveFor, gnwImport } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gwrg-unlockgate-"));
const failures = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
const eq = (a, b, msg) => {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const ok = (c, msg) => {
  if (!c) throw new Error(msg || "assertion failed");
};
const read = (rel) => readFileSync(resolve(here, "..", rel), "utf8");
/** Blank out `//` line comments, keeping offsets so index comparisons still mean something. */
const strip = (src) => src.replace(/^(\s*)\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));

// --- Build the gate (pure; no runes, no store) -------------------------------------------------

await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/unlockGate.ts")],
  outfile: join(out, "gate.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
const { ensureUnlocked } = await import(pathToFileURL(join(out, "gate.js")).href);

/** Drive the real gate, recording every call in order. */
function harness({ locked, backupTaken, decline = false, unlockThrows = null }) {
  const calls = [];
  const deps = {
    locked,
    backupTaken,
    confirmDestructive: async () => {
      calls.push("confirm");
      if (decline) throw new Error("declined");
    },
    unlock: async () => {
      calls.push("unlock");
      if (unlockThrows) throw unlockThrows;
    },
    afterUnlock: async () => { calls.push("rescan"); },
    note: (n) => calls.push(`note:${n.kind}`),
  };
  return { calls, run: () => ensureUnlocked(deps) };
}

// --- 1. The ordering ---------------------------------------------------------------------------

await check("a device with a backup unlocks with no prompt", async () => {
  const h = harness({ locked: true, backupTaken: true });
  eq(await h.run(), "unlocked");
  ok(!h.calls.includes("confirm"), `a backed-up device must not be asked: ${h.calls.join(",")}`);
  eq(h.calls.join(","), "note:unlocking,unlock,rescan,note:unlocked", "call order");
});

await check("with no backup, the prompt comes BEFORE unlock", async () => {
  const h = harness({ locked: true, backupTaken: false });
  eq(await h.run(), "unlocked");
  const iC = h.calls.indexOf("confirm");
  const iU = h.calls.indexOf("unlock");
  ok(iC !== -1, "the destructive prompt was never shown");
  ok(iU !== -1, "unlock was never called");
  ok(iC < iU, `the prompt must precede unlock, got ${h.calls.join(",")}`);
});

await check("a declined prompt never reaches unlock", async () => {
  const h = harness({ locked: true, backupTaken: false, decline: true });
  let threw = null;
  try { await h.run(); } catch (e) { threw = e; }
  ok(threw, "a declined prompt must reject, not resolve");
  ok(!h.calls.includes("unlock"), `declining must not unlock: ${h.calls.join(",")}`);
  ok(!h.calls.includes("rescan"), `declining must not rescan: ${h.calls.join(",")}`);
});

await check("an unlocked device is never touched", async () => {
  const h = harness({ locked: false, backupTaken: false });
  eq(await h.run(), "already-unlocked");
  ok(!h.calls.includes("unlock"), "an unlocked device must not be unlocked again");
  ok(!h.calls.includes("confirm"), "an unlocked device must not be asked anything");
});

await check("an unscanned device is not guessed either way", async () => {
  const h = harness({ locked: null, backupTaken: false });
  eq(await h.run(), "unknown-state");
  ok(!h.calls.includes("unlock"), "a null lock state must never mass-erase");
  ok(!h.calls.includes("confirm"), "a null lock state must not ask");
});

await check("a hardware failure propagates and does not claim success", async () => {
  const boom = new Error("SWD write failed");
  const h = harness({ locked: true, backupTaken: true, unlockThrows: boom });
  let threw = null;
  try { await h.run(); } catch (e) { threw = e; }
  eq(threw, boom, "the transport's error must reach the caller");
  ok(!h.calls.includes("note:unlocked"), "a failed unlock must not log success");
});

// --- 2. The register sequence vs the Python reference -------------------------------------------

const { GnwFlasher } = await gnwImport(import.meta.url, "gnw-flasher");

/** Records every transport op. Word reads return 0xFFFFFFFF -- the erased-option-byte value,
 *  and the worst case for the read-modify-writes, since every bit the port must CLEAR is set. */
function fakeTransport() {
  const ops = [];
  return {
    ops,
    halt: async () => { ops.push(["halt"]); },
    resume: async () => { ops.push(["resume"]); },
    reset: async () => { ops.push(["reset"]); },
    readWord: async (a) => { ops.push(["readWord", a >>> 0]); return 0xffffffff; },
    writeWord: async (a, v) => { ops.push(["writeWord", a >>> 0, v >>> 0]); },
    readMemory: async () => new Uint8Array(0),
    writeMemory: async () => {},
    readRegister: async () => 0,
    writeRegister: async () => {},
    connect: async () => {},
  };
}

await check("unlock() writes the reference's key sequence, then resets", async () => {
  const t = fakeTransport();
  await new GnwFlasher(t).unlock();
  const writes = t.ops.filter((o) => o[0] === "writeWord").map((o) => [o[1], o[2]]);
  // _unlock.py: OPTKEYR <- 0x08192A3B, OPTKEYR <- 0x4C5D6E7F, RDP <- 0xAA, OPTCR <- OPTSTART.
  eq(writes.length, 4, `four option-byte writes, got ${JSON.stringify(writes)}`);
  eq(writes[0][0], 0x52002008, "first write targets FLASH_OPTKEYR");
  eq(writes[0][1], 0x08192a3b, "OPTKEY1");
  eq(writes[1][0], 0x52002008, "second write targets FLASH_OPTKEYR");
  eq(writes[1][1], 0x4c5d6e7f, "OPTKEY2");
  eq(writes[2][0], 0x52002020, "third write targets FLASH_OPTSR_PRG");
  eq(writes[3][0], 0x52002018, "fourth write targets FLASH_OPTCR");
});

await check("the RDP byte is replaced, not OR-ed, and the other three are untouched", async () => {
  const t = fakeTransport();
  await new GnwFlasher(t).unlock();
  const w = t.ops.filter((o) => o[0] === "writeWord")[2];
  // The reference writes ONE byte, 0xAA, at 0x52002021 = byte 1 of this word.
  eq((w[2] >>> 8) & 0xff, 0xaa, "RDP byte must be exactly 0xAA (level 0)");
  eq(w[2] & 0xff, 0xff, "byte 0 must be left as read");
  eq((w[2] >>> 16) & 0xffff, 0xffff, "bytes 2-3 must be left as read");
});

await check("OPTCR byte 0 is replaced by 0x02, so MER cannot survive", async () => {
  const t = fakeTransport();
  await new GnwFlasher(t).unlock();
  const w = t.ops.filter((o) => o[0] === "writeWord")[3];
  // Byte 0 must be exactly 0x02: OPTSTART set, OPTLOCK clear, and MER (bit 2) CLEAR. Read-back
  // was all-ones, so an OR would have left MER set and started a mass erase instead.
  eq(w[2] & 0xff, 0x02, "OPTCR byte 0 must be exactly 0x02");
  eq((w[2] >>> 8) & 0xffffff, 0xffffff, "bytes 1-3 must be left as read");
});

await check("unlock halts first and resets last", async () => {
  const t = fakeTransport();
  await new GnwFlasher(t).unlock();
  const kinds = t.ops.map((o) => o[0]);
  eq(kinds[0], "halt", `the reference halts before writing: ${kinds.join(",")}`);
  eq(kinds[kinds.length - 1], "reset", `the reference resets after writing: ${kinds.join(",")}`);
});

await check("lock() is still deliberately unimplemented", async () => {
  let threw = null;
  try { await new GnwFlasher(fakeTransport()).lock(); } catch (e) { threw = e; }
  ok(threw && /not implemented/.test(threw.message), "lock() must stay a stub -- see its comment");
});

// --- 3. The two flows that must NOT auto-unlock ------------------------------------------------
// Both are backups. Unlocking mass-erases, so unlocking on the way IN would destroy the exact
// image the flow exists to save. This is the mistake the gate cannot catch for them.

await check("the OFW backup refuses a locked device instead of unlocking it", () => {
  const src = read("src/lib/advanced/OfficialFirmwareSection.svelte");
  // Comments stripped: the code there explains WHY it does not call ensureUnlocked, and a
  // guard that matched its own rationale would pass on a body that had started calling it.
  const body = strip(src.slice(src.indexOf("async function doBackup"), src.indexOf("async function run")));
  ok(!/ensureUnlocked/.test(body), "doBackup must never unlock: it would erase what it is saving");
  ok(/device\.locked/.test(body) && /errDeviceLocked/.test(body),
    "doBackup must refuse a locked device with the locked error");
});

await check("the guided backup unlocks only after the dump, never before", () => {
  const src = strip(read("src/lib/views/Wizard.svelte"));
  const body = src.slice(src.indexOf("async function runStep1"), src.indexOf("async function runStep2"));
  const iDump = body.indexOf("dumpBackup(");
  const iUnlock = body.indexOf("ensureUnlocked");
  ok(iDump !== -1, "runStep1 no longer dumps -- re-read this check");
  ok(iUnlock !== -1, "runStep1 must unlock before it writes");
  ok(iDump < iUnlock,
    "runStep1 must dump the stock firmware BEFORE unlocking; unlocking first erases it");
});

// --- 4. Every write flow asks --------------------------------------------------------------------
// Enumerated deliberately: a new write flow that forgets this call fails against a device the
// user never unlocked, and the failure looks like a flash bug rather than a missing gate.

const WRITE_FLOWS = [
  ["src/lib/advanced/FlashSection.svelte", "flashImage("],
  ["src/lib/advanced/EraseSection.svelte", "flashImage("],
  ["src/lib/advanced/RomSection.svelte", "flashInstallToDevice("],
  ["src/lib/advanced/OfficialFirmwareSection.svelte", "patchAndFlash("],
];
for (const [rel, writeCall] of WRITE_FLOWS) {
  await check(`${rel.split("/").pop()} unlocks before it writes`, () => {
    const src = strip(read(rel));
    const iUnlock = src.indexOf("device.ensureUnlocked()");
    const iWrite = src.indexOf(writeCall);
    ok(iUnlock !== -1, `${rel} never calls device.ensureUnlocked()`);
    ok(iWrite !== -1, `${rel} no longer calls ${writeCall} -- re-read this check`);
    ok(iUnlock < iWrite, `${rel} calls ${writeCall} before unlocking`);
  });
}

await check("Wizard's two write flows each unlock", () => {
  const src = strip(read("src/lib/views/Wizard.svelte"));
  eq((src.match(/device\.ensureUnlocked\(\)/g) || []).length, 4,
    "runStep1, runStep2's flash, bank2 cleanup, and restoreStock each need one");
});

// --- 5. The opt-in is gone -----------------------------------------------------------------------

await check("no unlock opt-in survives anywhere", () => {
  for (const rel of ["src/lib/advanced/OfficialFirmwareSection.svelte"]) {
    ok(!/unlockOptIn/.test(read(rel)), `${rel} still carries the unlockOptIn checkbox`);
  }
  const en = read("src/lib/i18n/strings/firmwareSetup.ts");
  ok(!/unlockDeviceLabel|unlockDeviceHint|optInToUnlock/.test(en),
    "the checkbox's strings must go with the checkbox");
});

rmSync(out, { recursive: true, force: true });

if (failures.length) {
  console.error(`unlockgate: ${failures.length} FAILED of ${passed + failures.length}`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`unlockgate: ${passed} checks passed`);
