/**
 * Which library rows the list shows: the console scope, the favourites scope, and the search.
 *
 * PURE, AND IN ITS OWN MODULE so it can be driven by a node suite. It was three conditions
 * inlined in `RomManagementTab.svelte`'s `visibleGames`, where the only way to check them was to
 * render the tab, which nothing in this repo can do -- there is no headless browser in the dev
 * container. The rules below are small but each one is a decision, and a decision nothing can
 * exercise is a decision that drifts.
 *
 * The caller supplies the accessors rather than a row type: a row here is a plain object the
 * component assembles from two different sources (`romSelection.rows` and `homebrew.titles`),
 * and teaching this module that shape would tie it to the component it exists to be tested
 * apart from.
 */

/** How a row answers the three scopes. */
export interface RowAccess<T> {
  /** The row's console folder, or `"homebrew"`. */
  systemOf: (row: T) => string;
  /** The name the LIST draws, which is what a search matches. */
  nameOf: (row: T) => string;
  /**
   * The row's own id, which is what a star is recorded against.
   *
   * NOT A DEVICE PATH, and that distinction is the bug this replaced. The star writes
   * `favorites.toggle(row.key)` and the store keys on row id, but this asked through
   * `favoritePathOf` and looked the DEVICE path up in that same store -- never a match, so a
   * starred game never appeared under `Favorites`. A device path is the write-time half and
   * belongs at the write, not here: a row can be starred before it has one at all.
   */
  rowIdOf: (row: T) => string;
  /** Whether that row id is starred. */
  isFavorite: (rowId: string) => boolean;
}

export interface LibraryFilter {
  /** `"all"` | `"favorites"` | a system folder | `"homebrew"`. */
  consoleFilter: string;
  /** Free text. Empty means no search. */
  searchQuery: string;
}

/**
 * Does this row pass the console scope?
 *
 * `all` and `favorites` are both library-wide, which is the whole reason `favorites` sits beside
 * `All` rather than among the consoles: neither narrows to a console, so neither may filter on
 * one. Getting this wrong makes `Favorites` show only the starred games of whichever console
 * happened to be selected before it.
 */
export function passesConsole<T>(row: T, a: RowAccess<T>, consoleFilter: string): boolean {
  if (consoleFilter === "all" || consoleFilter === "favorites") return true;
  return a.systemOf(row) === consoleFilter;
}

/**
 * Is this row starred?
 *
 * Every row can be, so there is no null case to guard: whether the firmware could address the
 * file is a question for write time, not for the filter.
 */
export function isStarred<T>(row: T, a: RowAccess<T>): boolean {
  return a.isFavorite(a.rowIdOf(row));
}

/**
 * Does this row match the search?
 *
 * Case-insensitive substring over the LIST name, which is the text the row actually draws. Not
 * trimmed: a space the user typed is a narrowing they meant, and silently dropping it would make
 * "mario " and "mario" behave differently from how they look.
 *
 * An empty query matches everything, so a cleared box restores the list rather than emptying it.
 */
export function matchesSearch<T>(row: T, a: RowAccess<T>, searchQuery: string): boolean {
  if (searchQuery === "") return true;
  return a.nameOf(row).toLowerCase().includes(searchQuery.toLowerCase());
}

/** All three scopes, in the order the list applies them. */
export function filterLibraryRows<T>(rows: readonly T[], a: RowAccess<T>, f: LibraryFilter): T[] {
  return rows.filter(
    (row) =>
      passesConsole(row, a, f.consoleFilter) &&
      (f.consoleFilter !== "favorites" || isStarred(row, a)) &&
      matchesSearch(row, a, f.searchQuery),
  );
}

/**
 * How many rows of the WHOLE library are starred, for the `Favorites` chip.
 *
 * Deliberately takes every row rather than the visible ones. The chip sits beside `All`, which
 * counts the library, so this must too: a count that dropped as you typed in the search box, or
 * as you picked a console, would be describing the list instead of the library, and the number
 * beside `All` would no longer be comparable to the number beside `Favorites`.
 */
export function countFavorites<T>(rows: readonly T[], a: RowAccess<T>): number {
  let n = 0;
  for (const row of rows) if (isStarred(row, a)) n++;
  return n;
}
