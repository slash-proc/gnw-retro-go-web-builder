/**
 * What order the Library's list draws its rows in: the key, the direction, and the tiebreak.
 *
 * PURE, AND IN ITS OWN MODULE, for the reason `lib/libraryFilter.ts` states about the scopes:
 * the rules are small, each one is a decision, and rendering the tab is the only other way to
 * reach them -- which nothing in this repo can do, since the dev container has no headless
 * browser. It takes the same `RowAccess` accessors that module does, widened with the two the
 * scopes never needed, so a row stays a plain object the component assembles rather than a type
 * this module has to know.
 *
 * THE FOURTH KEY IS `action`, AND THE NAME IS NOT AN INVENTION. The owner asked for a good
 * category covering prepare, install and uninstall, and the rows already have one: the chip at
 * the end of every row is built by `getActionState()`, rendered through `actionLabelText()`, and
 * its seven states are the `roms.selectGames.action*` strings. His three examples are literally
 * three of those seven. So this sorts by what that column already is.
 */

/** The row's action chip, as `getActionState()`'s internal state-kind key. */
export type ActionLabel =
  | "missing rom"
  | "prepare"
  | "extracting..."
  | "not installed"
  | "install"
  | "installed"
  | "uninstall";

/**
 * The order the action key sorts in: the row's progress, not the alphabet.
 *
 * Alphabetical would interleave the three states that mean "nothing can happen yet" with the
 * two that mean "this is on the device", which is the opposite of what someone sorting by this
 * column wants to see. Ascending runs from the rows that need the most work to the rows already
 * installed, so the top of the list is what the user still has to act on.
 *
 * `uninstall` sits last rather than beside `install`: both are pending changes, but a row marked
 * for removal is still ON the device, and grouping it with `installed` keeps the on-device rows
 * together. A row marked to be added is not on the device and belongs with the rows that are not.
 *
 * These strings are `getActionState()`'s keys, which its own comment says must never change --
 * only what `actionLabelText()` returns for each. An unknown label sorts after every known one
 * rather than throwing, so a state added there and forgotten here degrades to "last" instead of
 * breaking the list.
 */
export const ACTION_ORDER: readonly ActionLabel[] = [
  "missing rom",
  "prepare",
  "extracting...",
  "not installed",
  "install",
  "installed",
  "uninstall",
];

export function actionRank(label: string): number {
  const i = ACTION_ORDER.indexOf(label as ActionLabel);
  return i === -1 ? ACTION_ORDER.length : i;
}

/** The four keys the list can be ordered by. */
export type LibrarySortKey = "system" | "name" | "size" | "action";

export const LIBRARY_SORT_KEYS: readonly LibrarySortKey[] = ["system", "name", "size", "action"];

export type SortDirection = "asc" | "desc";

/** How a row answers the two questions the scopes never asked. */
export interface SortAccess<T> {
  /** The row's console folder, or `"homebrew"`. */
  systemOf: (row: T) => string;
  /** The name the LIST draws, which is what the name key orders by. */
  nameOf: (row: T) => string;
  /** The row's own id. The last tiebreak, so the order cannot change between renders. */
  rowIdOf: (row: T) => string;
  /** Folder bytes, or 0 when this row has no size yet. See `hasSize`. */
  sizeOf: (row: T) => number;
  /**
   * The row's action chip. Called ONLY when sorting by `action`, which is what keeps the list's
   * `$derived` from subscribing to everything `getActionState()` reads on the other three keys.
   */
  actionOf: (row: T) => string;
}

/**
 * Does this row have a size at all?
 *
 * A row that has not been prepared has no size, and the list already draws that as an em dash
 * rather than as `0 B` -- `g.size > 0 ? formatSize(g.size) : "—"`. A converter's output size is
 * not knowable before it runs (CLAUDE.md states the rule, and the size path sums real bytes from
 * provenance rather than a declared list), so the absence is a fact about the row, not a small
 * number.
 */
export function hasSize(bytes: number): boolean {
  return bytes > 0;
}

/**
 * Rows with no size sort LAST in both directions, never at a numeric end.
 *
 * Treating "not prepared yet" as zero bytes would bury those rows under ascending and crown them
 * under descending, and in both cases they would read as a real measurement the list is not
 * making. Pinning them instead keeps the sized rows the thing being ordered, and is the same move
 * `sdStorage.sortedCategories` makes for the catch-all bucket: a member that is not a peer is
 * pinned rather than ranked.
 */
function compareSize(a: number, b: number, dir: SortDirection): number {
  const ha = hasSize(a);
  const hb = hasSize(b);
  if (!ha && !hb) return 0;
  if (!ha) return 1;
  if (!hb) return -1;
  return dir === "asc" ? a - b : b - a;
}

/**
 * Text in the ACTIVE locale, not in code-unit order.
 *
 * `<` and a bare `localeCompare()` both get this wrong for the fourteen non-English locales: `<`
 * compares UTF-16 code units, which puts every accented or non-Latin string after every ASCII
 * one. The SD bucket work found `Bildschirmfotos` sorting before `BIOS` in German, which no
 * code-unit order produces. `numeric` so `Sonic 10` follows `Sonic 2` rather than preceding it,
 * and `sensitivity: "base"` so case and accents do not split names that read as one run.
 */
function compareText(a: string, b: string, locale: string | undefined): number {
  return a.localeCompare(b, locale, { numeric: true, sensitivity: "base" });
}

export interface LibrarySort {
  key: LibrarySortKey;
  direction: SortDirection;
  /** The active locale. Passed in, so this module stays free of the i18n store. */
  locale?: string;
}

/**
 * The primary comparison for one key, before any tiebreak.
 *
 * `size` owns its own direction because its unsized rows must not flip to the front when the
 * user reverses the order; every other key is compared ascending here and negated by the caller.
 */
function comparePrimary<T>(a: T, b: T, acc: SortAccess<T>, s: LibrarySort): number {
  switch (s.key) {
    case "system":
      return compareText(acc.systemOf(a), acc.systemOf(b), s.locale);
    case "name":
      return compareText(acc.nameOf(a), acc.nameOf(b), s.locale);
    case "size":
      return compareSize(acc.sizeOf(a), acc.sizeOf(b), s.direction);
    case "action":
      return actionRank(acc.actionOf(a)) - actionRank(acc.actionOf(b));
  }
}

/**
 * Order the rows. Does not mutate its input.
 *
 * THE TIEBREAK IS THE NAME, THEN THE ROW ID, and both matter. Sorting by system puts every Game
 * Boy row in one bucket, and without a second key that bucket keeps whatever order the scan
 * happened to produce -- stable between renders but meaningless to read, which is the same
 * complaint `UsedBySelect`'s comment records about its own list. The row id last is what makes
 * the order total: two rows can share a system, a size, an action AND a name (the same filename
 * under two sources), and a comparator that returns 0 for them lets a re-render swap their
 * places.
 *
 * The tiebreak is NOT negated by `desc`. Reversing the direction reverses the key the user
 * picked; reversing the tiebreak as well would shuffle the rows inside each bucket for no reason
 * the user asked for, so a bucket reads the same way whichever direction its bucket is in.
 */
export function sortLibraryRows<T>(
  rows: readonly T[],
  acc: SortAccess<T>,
  s: LibrarySort,
): T[] {
  const flip = s.direction === "desc" && s.key !== "size" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const primary = comparePrimary(a, b, acc, s) * flip;
    if (primary !== 0) return primary;
    if (s.key !== "name") {
      const byName = compareText(acc.nameOf(a), acc.nameOf(b), s.locale);
      if (byName !== 0) return byName;
    }
    return acc.rowIdOf(a).localeCompare(acc.rowIdOf(b));
  });
}
