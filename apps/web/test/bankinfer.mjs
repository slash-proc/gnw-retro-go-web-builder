#!/usr/bin/env node
/**
 * WHICH BANK an install preselects, given what the scan found in bank 1.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/bankinfer.mjs'
 *
 * The rule, in order:
 *   1. Retro-Go is already somewhere -> follow it. Reinstalling must not move it.
 *   2. Bank 1 holds official firmware, STOCK OR PATCHED -> bank 2.
 *   3. Bank 1 holds nothing recognisable -> bank 1, a Retro-Go-only install.
 *
 * Rule 2 used to read "stock OFW" only, and a PATCHED OFW is the dual-boot case: that patch
 * exists so bank 1 can hand off to Retro-Go in bank 2. So after uninstalling Retro-Go, a
 * dual-boot device preselected bank 1 and offered to flash over the firmware the patch boots
 * from. Reported from the device.
 *
 * `RomSection.svelte` is a Svelte component behind a device connection, so the rule is
 * re-stated here and pinned against the component's source: the table below is the behaviour,
 * and the final check proves the component still computes it this way. A rule restated in a
 * test can drift from the code, which is what the source assertions are for.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** The rule under test, in the same order the component evaluates it. */
function inferBank({ retroGoBankIndex, bank1Ofw }) {
  if (retroGoBankIndex === 1 || retroGoBankIndex === 2) return retroGoBankIndex;
  if (bank1Ofw) return 2;
  return 1;
}

const cases = [
  { name: "retro-go in bank 2 -> follow it", in: { retroGoBankIndex: 2, bank1Ofw: { patched: true } }, want: 2 },
  { name: "retro-go in bank 1 -> follow it", in: { retroGoBankIndex: 1, bank1Ofw: undefined }, want: 1 },
  { name: "stock OFW in bank 1 -> bank 2", in: { retroGoBankIndex: undefined, bank1Ofw: { patched: false } }, want: 2 },
  // THE REPORTED BUG. Uninstalling Retro-Go leaves a patched (dual-boot) OFW in bank 1 and no
  // Retro-Go anywhere. Preselecting bank 1 would flash over the firmware that boots the device.
  { name: "patched dual-boot OFW in bank 1, no retro-go -> bank 2", in: { retroGoBankIndex: undefined, bank1Ofw: { patched: true } }, want: 2 },
  { name: "bank 1 empty -> bank 1", in: { retroGoBankIndex: undefined, bank1Ofw: undefined }, want: 1 },
];

for (const c of cases) {
  check(c.name, () => {
    const got = inferBank(c.in);
    assert(got === c.want, `inferred bank ${got}, want ${c.want}`);
  });
}

// The component must still compute it this way. Source-level, because the inference lives in a
// `$derived` inside a Svelte component that needs a live device to run.
const src = readFileSync(join(here, "../src/lib/advanced/RomSection.svelte"), "utf8");
check("the component infers from ANY bank-1 OFW, not just an unpatched one", () => {
  const m = src.match(/const inferredBank = \$derived\.by\(\(\): 1 \| 2 => \{[\s\S]*?\n  \}\);/);
  assert(m, "inferredBank is gone or no longer a $derived.by");
  const body = m[0];
  assert(/if \(bank1AnyOfw\) return 2;/.test(body),
    "the bank-2 rule does not test bank1AnyOfw, so a patched dual-boot OFW falls through to bank 1");
  assert(!/if \(bank1StockOfw\) return 2;/.test(body),
    "the bank-2 rule still tests bank1StockOfw, which excludes the dual-boot case");
});

check("bank1AnyOfw really is any OFW, patched included", () => {
  const m = src.match(/const bank1AnyOfw = \$derived\(([^)]*)\)/);
  assert(m, "bank1AnyOfw is gone");
  assert(!/patched/.test(m[1]), `bank1AnyOfw filters on patched: ${m[1]}`);
});

console.log(`\nbankinfer: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
