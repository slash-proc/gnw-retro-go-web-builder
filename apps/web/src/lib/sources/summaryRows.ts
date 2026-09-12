/**
 * The COMPOSITION rule for the Library review-and-install summary — which rows the drawer
 * shows, in what order, and (for BIOS) whether there is anything to say at all.
 *
 * This lives here, not inline in `views/RomManagementTab.svelte`'s `summaryItems`, because it
 * is the last thing a user reads before a destructive write and it had grown a pile of
 * accreted rules that nothing could pin. The row ORDER is fixed by the `LibrarySummary.dc.html`
 * artboard; "Total projected size" is an aggregate and must therefore be last; the Cores
 * row is unconditional (both media install cores now — it is no longer an opt-in, so it may
 * not be gated on `syncCores`); the BIOS row appears only when a source actually declares a
 * BIOS. Flash and SD build their lists in two separate branches, and the whole point of this
 * module is that they cannot drift apart in order or in membership.
 *
 * It sits in `sources/` beside `metaLine.ts`, `metaFacts.ts`, `errorText.ts` and
 * `fileRows.ts` — the same kind of extracted, guardable composition rule, guarded by the same
 * `sources/test/validate.mjs` harness, over the same library/install domain those modules
 * already cover (`biosState`, `installArtifacts`, `prepareState` all live here too).
 *
 * Pure and rune-free ON PURPOSE, like its neighbours: no `$state`, no store import, no
 * `locale`, and deliberately no import of `ui/ChangeSummary.svelte`'s `ChangeItem` — the row
 * payload is a bare type parameter. The component resolves the stores, builds each fully
 * localised row object, and hands them in; this module only decides which ones ship and in
 * what order. Every user-visible string stays in the component.
 */

/** The rows the summary can contain, named. */
export type SummaryRowKey = "games" | "homebrew" | "cores" | "bios" | "covers" | "cheats" | "total";

/**
 * The artboard's order, and the ONLY order. `total` is last because it is the aggregate the
 * rows above add up to; a row after it would be read as part of the sum.
 */
export const SUMMARY_ROW_ORDER: readonly SummaryRowKey[] = [
  "games",
  "homebrew",
  "cores",
  "bios",
  "covers",
  "cheats",
  "total",
] as const;

/**
 * What the composition is allowed to depend on.
 *
 * `media` and `syncCores` are accepted and then deliberately NOT branched on: the order is
 * media-independent by design (Flash and SD must summarise the same categories in the same
 * sequence), and Cores is unconditional regardless of the cores checkbox. They are inputs
 * rather than absent so that any future attempt to make either matter has exactly one place
 * to happen, in front of a test.
 */
export interface SummaryFlags {
  media: "flash" | "sd";
  syncCores: boolean;
  /** A source declares a BIOS slot at all (`biosState.any`). */
  hasBios: boolean;
}

/** One already-built, already-localised row per key. `bios` may be absent. */
export interface SummaryRowSet<T> {
  games: T;
  homebrew: T;
  cores: T;
  bios: T | undefined;
  covers: T;
  cheats: T;
  total: T;
}

/**
 * Which rows this summary shows, in order.
 *
 * BIOS is the only optional one, and it is optional for one reason: with no declared slot a
 * BIOS line would be reporting on something nobody asked for.
 */
export function summaryRowKeys(flags: SummaryFlags): SummaryRowKey[] {
  return SUMMARY_ROW_ORDER.filter((k) => k !== "bios" || flags.hasBios);
}

/**
 * The rows themselves, in order. A key whose row was not supplied is dropped rather than
 * emitted as a hole — so a caller that omits `bios` while claiming `hasBios` shows no BIOS
 * row instead of an empty one.
 */
export function composeSummaryRows<T>(flags: SummaryFlags, rows: SummaryRowSet<T>): T[] {
  const out: T[] = [];
  for (const key of summaryRowKeys(flags)) {
    const row = rows[key];
    if (row !== undefined) out.push(row);
  }
  return out;
}

/** What the BIOS row is decided from — the resolved `biosState` numbers, nothing else. */
export interface BiosSummaryInputs {
  /** `biosState.any` — some active source declares a BIOS slot. */
  any: boolean;
  /** Slots present and not blocked: the "After" count. */
  satisfied: number;
  /** Slots still missing a usable file. */
  outstanding: number;
  /** Slots whose file is not on the target medium yet — what THIS install would write. */
  pendingWrites: number;
}

/** The BIOS row's decided content, minus its strings. */
export interface BiosSummaryDecision {
  /** The count the row states. */
  satisfied: number;
  /** Something is missing: the row warns and carries the "needs a file" note. */
  short: boolean;
  /**
   * The row's "+N" change. It is `pendingWrites` — the writes this install performs — and
   * NOT `satisfied` (an after-state) or `outstanding` (files we do not have and so cannot
   * write). Nothing is ever removed, hence the fixed 0.
   */
  added: number;
  removed: number;
}

/**
 * The BIOS row, or `undefined` when there is nothing to say. Separate from the ordering rule
 * above because "should this row exist" and "what does it claim" are two different mistakes.
 */
export function biosSummaryDecision(i: BiosSummaryInputs): BiosSummaryDecision | undefined {
  if (!i.any) return undefined;
  return { satisfied: i.satisfied, short: i.outstanding > 0, added: i.pendingWrites, removed: 0 };
}
