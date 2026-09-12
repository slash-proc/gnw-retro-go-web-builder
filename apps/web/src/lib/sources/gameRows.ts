/**
 * ONE LIBRARY ROW PER GAME — not per file.
 *
 * A core may declare that its games arrive in a format the device cannot read. Doom is the
 * case this exists for: the user drops `DOOM.WAD` in `roms/doom/`, the converter turns it into
 * `The Ultimate Doom.whd`, and only the `.whd` is ever copied to the card. Those are two files
 * on disk and ONE game in the Library — before the conversion and after it.
 *
 * WHY A DEDICATED MODULE. The pairing is a rule with several edges (which file names the row,
 * what happens when only one half exists, what the row is called on two different surfaces),
 * and it has to be drivable from a node test with plain objects. `romSelection.svelte.ts` is
 * full of runes and stores; this is not.
 *
 * ---------------------------------------------------------------------------------------
 * HOW THE PAIR IS FOUND, AND WHY IT COSTS NO HASH
 *
 * The output's NAME is knowable before the conversion runs:
 *
 *   - a `.wad` that matched a published `variants[]` entry takes that variant's declared
 *     `filename` verbatim — `87651324… -> "The Ultimate Doom.whd"`;
 *   - a `.wad` that matched none is accepted anyway under `strict: false` and derives
 *     `<stem><outputExtension>` — `freedoom2.wad -> freedoom2.whd` (spec/03).
 *
 * So pairing is a NAME lookup in the same console folder, not a digest comparison. The only
 * hashing anywhere near this is the variant match itself, which `sources/inputDiscovery.ts`
 * already performs under its own cost rule (extension -> published `bytes` -> hash, and a
 * library with no candidate files hashes nothing). This module hashes NOTHING and adds no
 * candidates to that rule: it reads the answer discovery already produced.
 *
 * The lookup is CASE-FOLDED. FAT and exFAT cannot tell `Doom.whd` from `DOOM.whd`
 * (gwrg-dist-spec 930517c), so neither may we — a converted output sitting under a different
 * capitalisation is the same file to the card, and pairing on the exact string would show the
 * user two rows for one game.
 *
 * ---------------------------------------------------------------------------------------
 * IDENTITY: THE INPUT, ALWAYS
 *
 * A paired row is keyed and named by its INPUT (`DOOM.WAD`), never by its output. Two reasons,
 * and the first is the one that matters:
 *
 *   1. The row must not rename itself when the user presses Prepare. A row that reads `DOOM`
 *      before and `The Ultimate Doom` after has silently become a different row — selection
 *      state hangs off `key`, and the provenance line underneath the carousel title stops
 *      being provenance the moment it stops naming the file the entry came from.
 *   2. The input is what the user actually put there. It is the thing they can find in a file
 *      manager, and the thing they would delete to make the row go away.
 *
 * A row with NO input (an ordinary ROM, or a `.whd` whose `.wad` the user has since removed) is
 * keyed and named by the installable file, because that is the only file it has.
 *
 * ---------------------------------------------------------------------------------------
 * WHERE A PREPARED OUTPUT ACTUALLY LIVES
 *
 * NOT next to its input. We cannot write to the user's folder — the File System Access handle
 * is read-only for our purposes and the output is ours, not theirs — so a converted `.whd`
 * lands in `prepareState.assets` (and, across a reload, in `convertedCache`), keyed by its
 * placement: `doom/The Ultimate Doom.whd`. The library scan never sees it.
 *
 * So "prepared" is TWO questions, not one: is the output a file the scan found, OR an asset the
 * app is holding? Asking only the first is what left the row on Prepare forever however many
 * times the conversion succeeded — the row went looking for its output among scanned files,
 * found nothing, and re-rendered as unprepared. `preparedSizeFor` below answers the second.
 *
 * ---------------------------------------------------------------------------------------
 * TWO NAMING SURFACES, DELIBERATELY DIFFERENT
 *
 *   list    -> `listName`, the original filename with its extension stripped: `DOOM`.
 *              Close to what is on disk, so it matches what the user sees in their file
 *              manager and can be scanned down a column.
 *   carousel-> `prettyName` big (`The Ultimate Doom`, from the matched variant's declared
 *              filename minus its extension) with `originFilename` (`DOOM.WAD`) underneath.
 *
 * With no variant match both degrade to the same extensionless filename, so `freedoom2` reads
 * consistently on both surfaces rather than inventing a title nobody published.
 */

import type { FileRole } from "./coreRegistry.js";

/** What one scanned file is, before any pairing. The shape `romSelection` already has. */
export interface RomEntry {
  key: string;
  system: string;
  /** The filename, with extension. */
  name: string;
  size: number;
  inFolder: boolean;
  installed: boolean;
  role: FileRole;
}

/**
 * What discovery worked out about an ingestable file, keyed by its library key.
 *
 * `sources/inputDiscovery.ts` already computes this while filling the converter's input slot;
 * `discoveryWire.svelte.ts` records it here rather than throwing it away. An entry is absent
 * when discovery has not run, or ran and matched no variant — both mean "derive the name".
 */
export interface VariantHint {
  /** The matched variant's declared `filename`, e.g. `"The Ultimate Doom.whd"`. */
  variantFilename?: string;
}

/** A single Library entry: one game, however many files back it. */
export interface GameRow {
  /** Stable identity — the input's key when there is one, else the installable's. */
  key: string;
  system: string;
  /** List surface: original filename, extension stripped. */
  listName: string;
  /** Carousel headline: the published name when one is known, else `listName`. */
  prettyName: string;
  /** Carousel provenance: the original filename WITH its extension. Never a path. */
  originFilename: string;
  /** Folder bytes of the file this row is backed by (the output once prepared). */
  size: number;
  inFolder: boolean;
  installed: boolean;
  /**
   * True when this row still needs converting before anything can be installed. Such a row
   * offers Prepare and NO install control — there is nothing to exclude from the install set
   * because the control does not exist yet.
   */
  needsPrepare: boolean;
  /** The library key of the ingestable input, when this row has one. */
  inputKey?: string;
  /** The library key of the installable file, when it exists. */
  outputKey?: string;
  /** The output filename this row produces or produced, when it converts. */
  outputName?: string;
}

/**
 * WHICH FILE A ROW'S SELECTION ACTS ON.
 *
 * A row's IDENTITY is its input (see the header): the row must not rename itself when the user
 * presses Prepare. Its SELECTION is a different question, and it has a different answer: the
 * file that gets copied to the card, and later removed from it, is the OUTPUT.
 *
 * They were the same key, and that was the bug. `romSelection` keeps selection over the flat
 * per-FILE list, where the `.whd` carries `installed` and the `.wad` never will. Reading the
 * row's own key asked the WAD whether it was installed -- always no -- so a prepared, installed
 * Doom row drew as "uninstall" before the user touched anything, and toggling it wrote an
 * override for the WAD while the WHD stayed selected by its installed default. `removals` saw
 * nothing to remove, the Sync Library button stayed disabled, and the `.whd` was never deleted.
 *
 * `outputKey` is present exactly when a real entry exists for the output -- a scanned file or
 * one the device reports. When it is absent the output exists only in `prepareState.assets`,
 * there is no file entry to select, and the input's key is the only handle there is; that path
 * reaches the output through `outputName` instead (`sources/selectedAssets.ts`).
 */
export function selectionKeyFor(row: Pick<GameRow, "key"> & { outputKey?: string }): string {
  return row.outputKey ?? row.key;
}

/** `"DOOM.WAD"` -> `"DOOM"`. Leaves a dotless name alone. */
export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * What the converter will call this input's output.
 *
 * A matched variant publishes the name; everything else derives `<stem><outputExtension>`.
 * Returns undefined when the system declares no output extension AND no variant matched —
 * there is then no name to pair on, and the row simply stays unprepared.
 */
export function outputNameFor(
  inputFilename: string,
  hint: VariantHint | undefined,
  outputExtension: string | undefined,
): string | undefined {
  if (hint?.variantFilename) return hint.variantFilename;
  if (!outputExtension) return undefined;
  return `${stripExtension(inputFilename)}${outputExtension}`;
}

/** Case-folded with `toLowerCase`, NOT `toLocaleLowerCase` — see `sources/outputNames.ts`. */
const fold = (s: string): string => s.toLowerCase();

/**
 * Collapse scanned files into one row per game.
 *
 * `outputExtensionFor` answers per system id (the registry's `outputExtension`); `hintFor`
 * answers per library key (what discovery matched); `preparedSizeFor` answers "is this output
 * already prepared, and how big is it" out of the app's own asset store — the half of
 * "prepared" that the library scan cannot see (see the header). All three are injected so a
 * node test drives the real rule without a store.
 */
export function buildGameRows(
  entries: readonly RomEntry[],
  outputExtensionFor: (system: string) => string | undefined,
  hintFor: (key: string) => VariantHint | undefined,
  preparedSizeFor: (system: string, outputName: string) => number | undefined = () => undefined,
): GameRow[] {
  // Installable files, indexed per system by folded filename, so an input can find its output.
  const installableByName = new Map<string, RomEntry>();
  for (const e of entries) {
    if (e.role !== "installable") continue;
    installableByName.set(`${fold(e.system)}/${fold(e.name)}`, e);
  }

  const rows: GameRow[] = [];
  /** Installables absorbed by an input's row, so they do not also stand alone. */
  const absorbed = new Set<string>();

  // Inputs first: an input OWNS its output's row, so it must claim it before the output is
  // considered on its own. Order within this pass follows `entries` and is stable.
  for (const e of entries) {
    if (e.role !== "ingestable") continue;
    const outputName = outputNameFor(e.name, hintFor(e.key), outputExtensionFor(e.system));
    const output = outputName ? installableByName.get(`${fold(e.system)}/${fold(outputName)}`) : undefined;
    if (output) absorbed.add(output.key);

    // The other half of "prepared": the conversion ran and its bytes are in the app's asset
    // store, where the scan cannot see them. Only asked when no scanned file already answered,
    // so a real file on disk always wins and this costs nothing on the ordinary path.
    const preparedSize = output === undefined && outputName ? preparedSizeFor(e.system, outputName) : undefined;

    const hint = hintFor(e.key);
    const listName = stripExtension(e.name);
    rows.push({
      key: e.key,
      system: e.system,
      listName,
      // The published name wins; without one the two surfaces read the same, which is honest.
      prettyName: hint?.variantFilename ? stripExtension(hint.variantFilename) : listName,
      originFilename: e.name,
      // Once prepared the row's weight is its OUTPUT — that is the file that will be copied,
      // and the size the install budget has to account for. A prepared-in-store output knows
      // its own byte length, so the budget is right before the file ever reaches a folder.
      size: output ? output.size : (preparedSize ?? e.size),
      inFolder: e.inFolder || (output?.inFolder ?? false),
      installed: output?.installed ?? false,
      needsPrepare: output === undefined && preparedSize === undefined,
      inputKey: e.key,
      ...(output ? { outputKey: output.key } : {}),
      ...(outputName ? { outputName } : {}),
    });
  }

  // Everything installable that no input claimed: an ordinary ROM, or a converted output whose
  // input the user has since removed. Either way it is a game in its own right — it is on the
  // card or ready to go there, and hiding it would make it unmanageable.
  for (const e of entries) {
    if (e.role !== "installable" || absorbed.has(e.key)) continue;
    const listName = stripExtension(e.name);
    rows.push({
      key: e.key,
      system: e.system,
      listName,
      prettyName: listName,
      originFilename: e.name,
      size: e.size,
      inFolder: e.inFolder,
      installed: e.installed,
      needsPrepare: false,
      outputKey: e.key,
    });
  }

  return rows.sort((a, b) => {
    const normalize = (k: string) => k.toLowerCase().replace(/(^|\/)the\s+/g, "$1");
    const an = normalize(`${a.system}/${a.listName}`);
    const bn = normalize(`${b.system}/${b.listName}`);
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}
