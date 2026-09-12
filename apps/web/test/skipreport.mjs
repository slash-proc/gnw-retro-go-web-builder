#!/usr/bin/env node
/**
 * Which suites in this run could NOT actually run, said once, at the end, where it is read.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/skipreport.mjs'
 *
 * WHY. A skippable suite prints its SKIPPED line where it runs -- roughly a third of the way
 * down several hundred lines of output -- and `npm run check` then goes on to print green for
 * everything after it and exit 0. `gba-e2e.mjs`, the one suite written to catch a split core
 * losing its XIP half, printed SKIPPED on every run for weeks and was reported as green each
 * time, including on the day a split core lost its XIP half.
 *
 * This does not fail the run and must not: the owner's BIOS and ROM cannot be committed, and a
 * fresh checkout has to pass. It changes only whether a skip is VISIBLE, by re-testing the same
 * preconditions the skippable suites test and printing a banner at the END of the chain, after
 * the last suite, where the eye already is.
 *
 * A NEW SKIPPABLE SUITE BELONGS IN `GATES` BELOW. That is the only maintenance this needs, and
 * the alternative -- teaching every suite to report through a shared channel -- would be a
 * bigger change to more files for the same one line of output.
 */
import { existsSync } from "node:fs";

/** The skippable suites, and the precondition each one needs. Keep in step with their gates. */
const GATES = [
  {
    suite: "gba-e2e",
    // `test/gba-e2e.mjs` and `test/simflash.mjs`, same rule in both.
    ok: () => (process.env.GNW_GBA_ASSETS || "") !== "" || existsSync("/tmp/gba-assets"),
    needs: "the owner's gba_bios.bin, gba.bin, gba.xip and a .gba ROM",
    how: "put them in /tmp/gba-assets, or set GNW_GBA_ASSETS=<dir>",
    why: "an end-to-end GBA flash install is not being proved against the real files",
  },
  {
    suite: "simflash",
    ok: () => (process.env.GNW_GBA_ASSETS || "") !== "" || existsSync("/tmp/gba-assets"),
    needs: "the same GBA assets",
    how: "put them in /tmp/gba-assets, or set GNW_GBA_ASSETS=<dir>",
    why: "nothing is flashing a bare install into a simulated chip and reading it back",
  },
];

const skipped = GATES.filter((g) => !g.ok());
if (skipped.length === 0) {
  console.log(`\nskipreport: every skippable suite ran (${GATES.length} checked).`);
  process.exit(0);
}

const bar = "!".repeat(78);
console.log(`\n${bar}`);
console.log(`!! ${skipped.length} SUITE(S) DID NOT RUN. This run is GREEN but INCOMPLETE.`);
for (const g of skipped) {
  console.log(`!!`);
  console.log(`!!   ${g.suite} -- needs ${g.needs}`);
  console.log(`!!     to run it: ${g.how}`);
  console.log(`!!     unproved:  ${g.why}`);
}
console.log(bar);
// Deliberately 0. See the header.
process.exit(0);
