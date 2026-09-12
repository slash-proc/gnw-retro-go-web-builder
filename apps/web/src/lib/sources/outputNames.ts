/**
 * MAY THIS NAME BE WRITTEN? — the host-side safety invariants of spec/05-host.md
 * ("Resolve names yourself, and force the declared extension").
 *
 * `homebrewConvert.ts`'s `resolveOutputName` answers "what is this file called". This module
 * answers the next question, and it is the whole point of the design: a converted file's name
 * is partly USER text (a stem off a file the user brought), and it is about to enter a
 * directory that already holds publisher-declared files. Two rules keep that safe, and both
 * are the host's job because the host is the only party that owns the filesystem:
 *
 *   - **A publisher-declared name wins.** A derived name colliding with an `artifacts[]`
 *     entry, a fixed (`filename`) output, or another derived name is REFUSED and shown to the
 *     user — never silently written, and never renamed around. Renaming around it would be
 *     the same failure with a friendlier face: the user asked for a file and would get one
 *     under a name they did not choose.
 *   - **The comparison is CASE-FOLDED and PER DESTINATION DIRECTORY.** The card is FAT or
 *     exFAT, which case-folds: `Doom.whd` and `DOOM.whd` are one file there and two in any
 *     ordinary `Map` or `Set`, so an unfolded check passes in the tool and then overwrites on
 *     the card — exactly the failure the rule exists to prevent. And it is per directory
 *     because placement split: a core's converted outputs land in `roms/<system id>/` and its
 *     artifacts in the core directory, so those two cannot collide with each other.
 *
 * Refusals are VALUES here, not throws: the caller has a set of files and needs to show the
 * user every one that cannot be written, not the first. `firstCollisionError` is the throwing
 * shape for callers that only need to stop.
 *
 * NOT here, on purpose: the `runPerFile` loop, accumulation across runs, and placement itself
 * (which directory a file lands in). This module is handed destinations; it does not compute
 * them. `maxCount` — the other invariant of this step — lives in `inputGate.ts`, because
 * "checked BEFORE running" means checked where the run is decided.
 */
import { ConverterError } from "./converterTypes.js";

/**
 * Where a name comes from, and therefore who wins a collision.
 *
 * `artifact` and `fixed` are both PUBLISHER-declared and rank equally: an `artifacts[]` entry
 * and an output's `filename` are each a name the manifest states outright. `derived` is the
 * one that can carry user text, and it is the one that loses.
 */
export type NameOrigin = "artifact" | "fixed" | "derived";

/** One file the installer intends to write. */
export interface PlannedName {
  /**
   * The destination DIRECTORY, as the caller spells it. Compared verbatim (folded), so a
   * caller must be consistent: `roms/doom/` and `roms/doom` would read as two directories.
   * Placement is the next step's job; this module only groups by what it is told.
   */
  dir: string;
  /** The name on the card, in its ORIGINAL spelling — that is what the user is shown. */
  name: string;
  origin: NameOrigin;
  /** Free-form provenance for the UI ("DOOM2.WAD"). Untrusted text; render as text. */
  from?: string;
}

/** A name that may not be written, and what already holds the spot. */
export interface NameCollision {
  dir: string;
  /** The entry that keeps the name. */
  kept: PlannedName;
  /** The entry that is refused. */
  refused: PlannedName;
  /** The folded key the two share. Diagnostic; never shown as a filename. */
  folded: string;
  /** True when the two differ ONLY in case — the FAT trap, worth saying out loud. */
  caseOnly: boolean;
  /**
   * True when both entries name the SAME source file, and the message would otherwise repeat
   * one string four times and say nothing.
   *
   * This is the duplicate-library case, and it is the one a user cannot diagnose unaided.
   * `libraryScan.ts` keeps two files that share a path and differ in bytes ("identical content
   * is ignored, different content is shown twice"), and `libraryCandidates` hands both to
   * discovery through `basePath()` — so a `runPerFile` tool is offered one filename twice,
   * runs twice, and derives one name twice. Every string in the refusal is then identical and
   * the user is told two files collide while being shown, apparently, one file.
   *
   * It is NOT the same as `caseOnly`: those are two spellings of one name, these are two
   * different files under one spelling. Both are worth saying, and a collision can be neither.
   */
  sameSource: boolean;
}

export interface NamePlan {
  /** The entries that may be written, in the order a declared-first pass settled them. */
  accepted: PlannedName[];
  /** Every refusal. Non-empty means do not install; show all of them. */
  collisions: NameCollision[];
}

/**
 * The card's comparison, not JavaScript's.
 *
 * `toLowerCase()`, deliberately NOT `toLocaleLowerCase()`: the latter is locale-sensitive and
 * under a Turkish locale folds a dotless/dotted I differently, so the same two filenames would
 * collide or not depending on the user's browser language. A filesystem's folding does not
 * move with the user's locale and neither does this.
 */
export function foldName(name: string): string {
  return name.toLowerCase();
}

/**
 * Same, for a directory — and it NORMALISES the trailing slash first.
 *
 * `roms/doom/` and `roms/doom` name one directory on the card, so a plan that spelled the two
 * differently would group into two buckets and let two files that are one file through the
 * collision check. `placement.ts` returns one spelling for exactly this reason; folding the
 * other spelling onto it as well means a hand-built caller cannot reintroduce the hole.
 */
export function foldDir(dir: string): string {
  return dir.replace(/\/+$/, "").toLowerCase();
}

/** Publisher-declared names are settled first, so a derived one can never take a spot from one. */
const ORIGIN_RANK: Record<NameOrigin, number> = { artifact: 0, fixed: 1, derived: 2 };

/**
 * Settle a whole install set: who gets each name, and who is refused.
 *
 * The pass is stable within a rank, so among two derived names the FIRST offered keeps the
 * name and the second is refused — deterministic, and the same order the user picked files in.
 * Between ranks, a declared name always wins however late it was offered, which is the rule
 * spec/05 states.
 *
 * Two DECLARED names that fold together are refused as well. That is a broken manifest rather
 * than a user's mistake (the published checker refuses one before it is ever released), but a
 * host that assumed the publisher ran the checker would be trusting the party it is
 * validating, and the consequence on the card is identical: one file where two were meant.
 */
export function planNames(planned: PlannedName[]): NamePlan {
  const order = planned.map((p, i) => ({ p, i }));
  order.sort((a, b) => ORIGIN_RANK[a.p.origin] - ORIGIN_RANK[b.p.origin] || a.i - b.i);

  const holders = new Map<string, PlannedName>();
  const accepted: PlannedName[] = [];
  const collisions: NameCollision[] = [];

  for (const { p } of order) {
    const folded = foldName(p.name);
    const key = `${foldDir(p.dir)}\u0000${folded}`;
    const kept = holders.get(key);
    if (kept !== undefined) {
      collisions.push({
        dir: p.dir,
        kept,
        refused: p,
        folded,
        caseOnly: kept.name !== p.name,
        // Both undefined is not "the same source": it is no source stated, which says nothing.
        sameSource: kept.from !== undefined && kept.from === p.from,
      });
      continue;
    }
    holders.set(key, p);
    accepted.push(p);
  }
  return { accepted, collisions };
}

/**
 * One line of untrusted detail for a collision, for a `ConverterError`'s `detail` — the two
 * ORIGINAL spellings, because "Doom.whd and DOOM.whd" is the only rendering of this that a
 * user can act on. Never the folded key: nothing is called that.
 *
 * THE SOURCE IS NAMED TOO, and dropping it was a real failure rather than a terseness. The
 * owner's OpenLara report read, in full:
 *
 *     homebrews/openlara: "LEVEL3A.PKD" (derived) collides with "LEVEL3A.PKD" (derived)
 *
 * — four strings, two of them identical, naming nothing he could act on. `PlannedName.from`
 * was populated at the call site the whole time (`homebrewConvert.ts` sets it to the pivot's
 * filename) and this function never read it. An output name is the thing the user did NOT
 * choose; the input is the thing they did, and it is the only end of this they can change.
 *
 * When both sources are the same string, saying so IS the finding — see `sameSource`. Two
 * files that differ in bytes and share a name are one library entry as far as the user can
 * see, so a message that merely repeated the name would send them looking for a second file
 * they would never find under a different name.
 */
export function describeCollision(c: NameCollision): string {
  const side = (p: PlannedName): string =>
    `"${p.name}" (${p.origin}${p.from === undefined ? "" : ` from "${p.from}"`})`;
  const head = `${c.dir}: ${side(c.refused)} collides with ${side(c.kept)}`;
  // Said once, not twice: with one source both sides would read identically and the repetition
  // would be the whole message. What the user needs here is that there are TWO files.
  if (c.sameSource) {
    return `${c.dir}: two files named "${c.kept.from}", with different content, both become "${c.kept.name}" (${c.kept.origin})`;
  }
  return head;
}

/**
 * The throwing shape, for a caller that only needs to stop. Returns nothing when the plan is
 * clean; the VALUE shape (`planNames`) is what a UI showing every refusal should use.
 */
export function firstCollisionError(plan: NamePlan): ConverterError | undefined {
  const first = plan.collisions[0];
  return first === undefined ? undefined : new ConverterError("name-collision", describeCollision(first));
}
