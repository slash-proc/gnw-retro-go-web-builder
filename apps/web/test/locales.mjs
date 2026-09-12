/**
 * The non-English locales present on disk, derived once for every suite that needs them.
 *
 * WHY THIS EXISTS. Seven suites each kept their own hand-written copy of this list, and
 * `firstrun.mjs` kept two (an array, and a regex telling an English area file from a sibling).
 * Landing a locale meant editing all of them, and the failure mode is not a clear one: a suite
 * that has not been told about a locale simply stops checking it, silently, while still printing
 * a pass line. Seven translation agents landing at once turned that into a seven-way conflict on
 * the same lines.
 *
 * DERIVED, NOT LISTED, and that is not a weakening of the guards. What each suite actually wants
 * to ask is "for every locale that EXISTS, does it satisfy this rule" -- disk is the authority on
 * which locales exist, and a hand-kept list can only ever be a stale copy of it. A half-landed
 * locale is caught harder this way: `firstrun.mjs` demands all nine areas for every suffix it
 * finds, so a locale with eight fails loudly rather than going unnoticed.
 *
 * The suffix is a language subtag with an optional script or region subtag, so `zh-Hans` counts.
 * A list that enumerated two-letter codes was silently blind to it.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STRINGS = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/i18n/strings");

/** `de`, `zh-Hans`, ... -- every non-English locale with at least one string table. Sorted. */
export const LOCALES = [...new Set(
  readdirSync(STRINGS)
    .map((f) => f.match(/\.([a-z]{2}(?:-[A-Za-z]{2,4})?)\.ts$/))
    .filter((m) => m !== null)
    .map((m) => m[1]),
)].sort();

/**
 * REFUSE TO RUN RATHER THAN PASS EMPTY.
 *
 * Seven suites loop over this list, and every one of them PASSES VACUOUSLY when it is empty: a
 * wrong path, a renamed directory or a broken regex would turn five locale suites green while
 * checking nothing at all. Verified, not assumed -- emptying this list makes firstrun, statuspane,
 * nodevice, overviewrail and locked-copy all pass.
 *
 * This repo's doc guards already exit non-zero rather than print a green line when they cannot
 * actually run. Same rule here. German has existed since the second locale landed, so an empty
 * result is always a bug in this file, never a fact about the checkout.
 */
if (LOCALES.length === 0) {
  throw new Error(
    `no locale string tables found under ${STRINGS} -- every locale suite would pass without checking anything`,
  );
}

/** The same list as filename suffixes, with `""` for English first: `""`, `".de"`, ... */
export const LOCALE_SUFFIXES = ["", ...LOCALES.map((l) => `.${l}`)];

/** True for a sibling table (`landing.de.ts`), false for an English area file (`landing.ts`). */
export function isLocaleFile(filename) {
  return /\.([a-z]{2}(?:-[A-Za-z]{2,4})?)\.ts$/.test(filename);
}

/**
 * Length in LATIN-EQUIVALENT characters.
 *
 * Two suites assert that a sentence is long enough to actually carry a fact -- `firstrun`'s
 * `lockedHow` (what unlocking costs) and `locked-copy`'s `unlockModalBody` (that the original
 * firmware is gone). Both measure LENGTH on purpose, because pattern-matching the claim in
 * every language is worse. But a raw `.length` is an English-shaped proxy: a Han ideograph is a
 * whole morpheme where a Latin character is a letter, so a faithful Chinese rendering of the
 * same facts measures about a third of the English and failed a threshold the English clears
 * comfortably. Weighting an ideograph at 3 compares information rather than code units.
 *
 * Kana and Hangul deliberately stay at 1. They are closer to letters than to words, and ja/ko
 * already clear both thresholds unweighted, so raising them would only loosen the check where
 * it currently bites. This weighting can therefore only admit a CJK string that says as much as
 * the English; it cannot excuse a short one in any locale. Verified: a Chinese stub that says
 * a device unlocks but not what it costs still fails both suites.
 */
const HAN = /\p{Script=Han}/u;
export function latinEquivalentLength(text) {
  let n = 0;
  for (const ch of text) n += HAN.test(ch) ? 3 : 1;
  return n;
}
