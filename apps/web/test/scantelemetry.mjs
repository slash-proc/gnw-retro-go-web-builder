#!/usr/bin/env node
/**
 * Every scan says who asked for it, how long it took and what it read.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/scantelemetry.mjs'
 *
 * `runScan` coalesces CONCURRENT callers -- one in-flight promise is shared -- but nothing stops
 * back-to-back ones, and there are a dozen call sites. Three triggers firing in sequence run
 * three complete walks of the chip, which a user experiences as one very slow scan and which no
 * log distinguished from one. The owner asked whether it was really scanning once; nothing in
 * the app could answer.
 *
 * So: a sequence number and a reason per scan, a line when one starts within 5 s of the last
 * finishing, and reads and bytes counted where every scan read passes through. Diagnostic text
 * through `dbg`, like the flasher's device lines, so no string table entry is needed.
 *
 * This is a WIRING check: the scan needs a device. What it CAN prove is that no call site is
 * anonymous, which is the part that rots -- a new trigger added without a reason is exactly the
 * one you would then be unable to attribute.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Every .ts/.svelte file under src/. */
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

const store = readFileSync(join(here, "../src/lib/device.svelte.ts"), "utf8");

check("runScan takes a reason, and defaults rather than throwing", () => {
  assert(/async runScan\(reason = "unknown"(,|\))/.test(store),
    "runScan does not take a defaulted reason");
});

check("a scan reports its sequence, duration, reads and bytes", () => {
  for (const bit of ["_scanSeq", "_scanReads", "_scanBytes", "ms, `"]) {
    assert(store.includes(bit), `the scan summary is missing ${bit}`);
  }
});

check("a scan starting right after one ended is called out", () => {
  assert(/sinceLast < 5000/.test(store), "back-to-back scans are not reported");
  assert(/joined the scan already running/.test(store), "a coalesced caller is not reported");
});

check("reads are counted where they are issued, not estimated", () => {
  // Both scan readers go through the counter. A count derived from probe arithmetic would be a
  // restatement of the algorithm rather than a measurement of it.
  assert(/const counted = /.test(store), "the read counter is gone");
  // Both scan readers: the bank read and the extflash walk. The games-list read is deliberately
  // NOT counted -- it runs after the walk, and its cost is the FrogFS metadata region rather
  // than the scan's probing, so folding it in would blur the number being measured.
  const wrapped = store.match(/counted\(/g) ?? [];
  assert(wrapped.length === 2,
    `expected the counter at both scan readers, saw ${wrapped.length} use(s)`);
});

check("NO CALL SITE IS ANONYMOUS", () => {
  const bare = [];
  for (const f of sources(join(here, "../src"))) {
    const src = readFileSync(f, "utf8");
    for (const line of src.split("\n")) {
      // Comments talk ABOUT runScan() constantly; only real calls matter.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (/\brunScan\(\s*\)/.test(code) && !/async runScan/.test(code)) {
        bare.push(`${f.replace(join(here, "../"), "")}: ${code.trim()}`);
      }
    }
  }
  assert(bare.length === 0, `runScan() called with no reason:\n    ${bare.join("\n    ")}`);
});

check("THE SCAN CLAIMS THE LIP, and claims it before the first read", () => {
  // This is the check that would have caught the silent no-op: an earlier attempt wired the lip
  // into a helper that a revert had already deleted, so the edit applied to nothing and the scan
  // never claimed the lip at all. The claim has to happen at the TOP of the scan, because the
  // UID and bank reads come first and every unclaimed read is drawn as its own 0-to-100 sweep.
  const body = store.slice(store.indexOf("private async _doScan"));
  const claim = body.indexOf('lipProgress.operationProgress("scan", 0)');
  const firstRead = body.indexOf("_readDeviceUid");
  assert(claim >= 0, "the scan never claims the lip, so every read sweeps it individually");
  assert(firstRead >= 0 && claim < firstRead,
    "the lip is claimed after the first read has already been issued");
  assert(/lipProgress\.operationProgress\("scan", null\)/.test(body),
    "the scan never releases the lip");
  // And the walk's own progress must drive it, or the lip sits at 0 for the whole scan.
  assert(/lipProgress\.operationProgress\("scan", this\.scanProgress\)/.test(body),
    "the partition walk's progress does not drive the lip");
});

check("every phase of the scan moves the bar, not just the partition walk", () => {
  // "The first scan is not shown" was this: the lip claimed at 0 with nothing moving it until
  // the walk began, so the UID and bank reads passed with the bar invisible. Each phase reports,
  // and the weights sum to 1 or the bar cannot arrive.
  const body = store.slice(store.indexOf("private async _doScan"));
  for (const name of ["uid", "banks", "partitions", "games"]) {
    assert(new RegExp(`phase\\("${name}"`).test(body), `the ${name} phase never reports`);
  }
  const m = body.match(/const W = \{ uid: ([\d.]+), banks: ([\d.]+), partitions: ([\d.]+), games: ([\d.]+) \}/);
  assert(m, "the scan weights are gone or reshaped");
  const sum = m.slice(1, 5).reduce((n, x) => n + Number(x), 0);
  assert(Math.abs(sum - 1) < 1e-9, `the weights sum to ${sum}, so the bar cannot arrive at 1`);
  // And it must arrive even when a phase throws: a bar stuck at 0.84 reads as a hang.
  assert(/phase\("games", 1\);\n\s*this\.scanning = false;/.test(body),
    "the scan does not finish the bar in its finally");
});

check("the bank scan reports while it reads, not only between reads", () => {
  // An unrecognised bank is downloaded IN FULL to search it (intflashscan.ts), so the longest
  // single read of the whole scan sits inside this phase. Reporting only between reads left the
  // bar parked at 4% for that read, which is what "jumps to 5-10% and stays there" was.
  const body = store.slice(store.indexOf("private async _doScan"));
  assert(/transport\.readMemory\(addr, len, \(done\) =>/.test(body),
    "the bank read ignores the transport's own progress, so the bar cannot move during it");
  assert(/phase\("banks", \(bankBytes \+ done\) \/ bankBudget\)/.test(body),
    "the in-flight bytes do not drive the banks phase");
});

check("ANTI-VACUITY: an untagged call site is caught", () => {
  // The check above passes trivially if it cannot see a bare call. Prove it can.
  const fake = 'void device.runScan();';
  assert(/\brunScan\(\s*\)/.test(fake) , "the pattern does not match a bare call");
  const tagged = 'void device.runScan("status pane");';
  assert(!/\brunScan\(\s*\)/.test(tagged), "the pattern also matches a tagged call, so it proves nothing");
});

// --- The automatic-scan gate ------------------------------------------------------------------
//
// The owner clicked Sync Library and got an install parked at 0% with a scan frozen part-way
// through the extflash walk. A mid-flash stub reboot re-enumerates the probe by design, that
// fires `connect()`, and `connect()` fired a full rescan straight into the running install.
// Source-text checks, same as the rest of this suite: the wiring is what rots.

check("the automatic scan triggers pass auto, so they wait for a write to finish", () => {
  for (const trigger of ['runScan("connect"', 'runScan("liveness poll"']) {
    const at = store.indexOf(trigger);
    assert(at >= 0, `${trigger} is no longer a call site -- re-derive this list`);
    const call = store.slice(at, store.indexOf(")", store.indexOf("}", at)) + 1);
    assert(/auto:\s*true/.test(call), `${trigger}) does not pass auto: true`);
  }
});

check("a DELIBERATE scan is never gated, or the post-install rescan would deadlock", () => {
  // `runInstall` awaits runScan("after ROM install") from inside the install, where
  // deviceSafety is "writing" by construction. Gating on the flag alone would have it wait for
  // the very operation that is waiting for it.
  assert(/if \(opts\.auto && !\(await this\._awaitLinkIdle\(reason\)\)\) return;/.test(store),
    "the gate is not conditioned on opts.auto");
  const rm = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  const post = rm.match(/runScan\("after ROM install"[^)]*\)/);
  assert(post, "the post-install rescan is gone -- if it moved, re-point this check");
  assert(!/auto/.test(post[0]), "the post-install rescan must NOT be marked auto");
});

check("the scan log says when it overlapped a device write", () => {
  assert(/OVERLAPPED A DEVICE WRITE/.test(store),
    "nothing in the scan telemetry reports an overlap with a write");
  // The CONDITION, not just the assignment: an earlier version of this check matched the
  // assignment text alone and passed happily against `if (false) this._scanSawWrite = true`.
  assert(/if \(deviceSafety\.state === "writing"\) this\._scanSawWrite = true;/.test(store),
    "the overlap witness is not set from the live write state, so the line above cannot be trusted");
  assert(/this\._scanSawWrite = deviceSafety\.state === "writing";/.test(store),
    "the witness is never seeded, so a write already running when the scan starts is missed");
});

console.log(`\nscantelemetry: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
