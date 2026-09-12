/**
 * Which title an on-device homebrew file belongs to.
 *
 * Its own module, with no imports, because the decision has to be drivable by a node suite:
 * `homebrewTitles.svelte.ts` is a rune store that reaches the sources store, the converter and
 * the input prompt, so a test of the rule there would be a test of the fakes around it.
 * `homebrew.owning()` delegates here.
 *
 * TWO WAYS A FILE IS OWNED, because there are two kinds of file:
 *
 *   1. A DECLARED name. `deviceFiles` is the target's artifacts plus its FIXED output names.
 *   2. A DERIVED output. Named after the input the user supplied, so `deviceFiles` can never
 *      list it (`derivedOutputs` is the count of what is missing). It is attributed by the
 *      directory instead: `dataDir` (gwrg-dist-spec `61d3726`) is the subdirectory of the
 *      homebrew directory a title's data lives in, so everything under `openlara/` is
 *      OpenLara's.
 *
 * WHY: without (2), each of OpenLara's 21 `.PKD` levels read as an unowned file and the Library
 * drew every one as a homebrew title of its own. Hiding them from the scan instead would have
 * been worse -- the install flows iterate the same list to PRESERVE on-device homebrew, so the
 * next install would have wiped the levels.
 *
 * The declared match runs FIRST, so a title that legitimately declares a nested path wins on its
 * own name rather than on whoever owns the directory.
 */
export interface OwnableTitle {
  deviceFiles: readonly string[];
  /** The title's data subdirectory, absent when its files sit directly in the homebrew dir. */
  dataDir?: string;
}

/**
 * CASE-FOLDED, because the card cannot tell `Minesweeper.bin` from `MINESWEEPER.BIN`.
 *
 * The same rule `gameRows.ts` folds for (gwrg-dist-spec 930517c): FAT and exFAT hold one file
 * per name regardless of case, so a device file whose capitalisation differs from the name its
 * title declares is the SAME FILE. Matching exactly made it unowned, and an unowned file is
 * retained unconditionally by the install (`runInstall`'s retain step keeps anything
 * `owning()` cannot place), so deselecting such a title could never remove it.
 *
 * `toLowerCase`, not `toLocaleLowerCase` -- see `sources/outputNames.ts` for why the locale
 * variant is wrong for filenames.
 */
const fold = (s: string): string => s.toLowerCase();

export function owningTitle<T extends OwnableTitle>(
  titles: readonly T[],
  deviceFile: string,
): T | undefined {
  const file = fold(deviceFile);
  const declared = titles.find((t) => t.deviceFiles.some((f) => fold(f) === file));
  if (declared) return declared;
  const slash = deviceFile.indexOf("/");
  if (slash <= 0) return undefined;
  const dir = fold(deviceFile.slice(0, slash));
  return titles.find((t) => t.dataDir !== undefined && fold(t.dataDir) === dir);
}
