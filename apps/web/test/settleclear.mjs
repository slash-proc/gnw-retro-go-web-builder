#!/usr/bin/env node
/**
 * "Finishing up. Do not disconnect" goes away as soon as the device says it is there.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/settleclear.mjs'
 *
 * `release()` drops to "settling", and the ONLY thing that clears it is `markQuiet()` -- a
 * device-attested "the write path is quiet and the target is alive". That is deliberate:
 * disconnect safety is a device fact, not a UI one.
 *
 * The defect was where that attestation could come from. It came from `pollTick` alone, and
 * `pollTick` returns early while `transport.busy()`, so it cannot attest anything until the link
 * goes idle. Anything that grabbed the link straight after a write therefore held the warning up
 * for its whole duration -- and entering Recovery Mode now rescans every time, so the banner sat
 * through a full walk of the chip. Every install ends with a rescan too.
 *
 * Two more attestations now exist, both completed device exchanges with no write in flight: the
 * `readInfo` at the end of a stub boot, and the end of a scan. This pins that they are wired,
 * and -- the part that actually matters -- that neither can clear the warning while a hold is
 * still outstanding.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const store = readFileSync(join(here, "../src/lib/device.svelte.ts"), "utf8");
const prog = readFileSync(join(here, "../src/lib/installProgress.svelte.ts"), "utf8");

// --- the rule itself, lifted from installProgress.svelte.ts -------------------------------
// Restating it would test the restatement; the guarantee under test is the real one.
function realSafety() {
  const m = prog.match(/markQuiet\(\): void \{\s*([\s\S]*?)\n  \}\n\n  \/\*\*/);
  ok(m, "no markQuiet() in installProgress.svelte.ts");
  const body = m[1];
  ok(/holds/.test(body) && /settling/.test(body), `markQuiet() is not the rule under test: ${body}`);
  const safety = { holds: 0, state: "safe" };
  safety.markQuiet = new Function("dbg", body).bind(safety, () => {});
  return safety;
}

check("a hold outstanding means the warning stays up", () => {
  const s = realSafety();
  s.holds = 1;
  s.state = "writing";
  s.markQuiet();
  eq(s.state, "writing", "markQuiet must not clear a warning a live operation is holding");
});

check("settling with no hold clears", () => {
  const s = realSafety();
  s.holds = 0;
  s.state = "settling";
  s.markQuiet();
  eq(s.state, "safe", "an attested quiet link clears the post-write warning");
});

check("a nested boot inside an install cannot clear it", () => {
  // An install holds; `ensureStub` inside it attests. The warning must survive.
  const s = realSafety();
  s.holds = 2;
  s.state = "writing";
  s.markQuiet();
  eq(s.state, "writing", "a nested attestation must not pull the warning down mid-flash");
});

// --- the wiring ---------------------------------------------------------------------------
check("a completed stub boot attests", () => {
  const inner = store.indexOf("private async _ensureStubInner");
  const at = store.indexOf("this._banksScannedAt = 0;", inner);
  ok(at >= 0, "the stub boot no longer drops bank freshness; this check is looking in the wrong place");
  const after = store.slice(at, at + 1200);
  ok(/deviceSafety\.markQuiet\(\)/.test(after),
    "nothing attests liveness after the boot's readInfo, so the warning waits for an idle link");
});

check("a completed scan attests", () => {
  const at = store.indexOf("this._lastScanEndedAt = Date.now();");
  ok(at >= 0, "the scan no longer records when it ended; this check is looking in the wrong place");
  const after = store.slice(at, at + 900);
  ok(/deviceSafety\.markQuiet\(\)/.test(after),
    "nothing attests liveness when a scan finishes, so a post-install rescan holds the warning up");
});

check("the poll is still an attestation too", () => {
  // The original one, located by the ping it follows rather than by counting call sites -- a
  // count would fail for whichever attestation was removed and blame this one. Removing THIS
  // leaves the warning depending on a boot or a scan happening at all, and an operation that
  // does neither would never clear it.
  const at = store.indexOf("pingTarget(this.transport)");
  ok(at >= 0, "pollTick no longer pings; this check is looking in the wrong place");
  ok(/deviceSafety\.markQuiet\(\)/.test(store.slice(at, at + 1400)),
    "the liveness poll no longer attests; a plain write with no rescan would never clear");
});

check("the early-out that caused this is still there, and still the reason", () => {
  // ARMED: if pollTick stops skipping a busy link, the extra attestations are belt-and-braces
  // rather than load-bearing, and this file's reasoning is stale.
  ok(/if \(this\.transport\.busy\(\)\)\s*\{[\s\S]*?return;/.test(store),
    "pollTick no longer skips a busy link -- re-read whether the added attestations are still needed");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`settle clear: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
