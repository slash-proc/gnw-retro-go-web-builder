/**
 * Which PREPARED bytes the current selection actually installs.
 *
 * THE BUG THIS EXISTS FOR. `prepareState.assets` was merged into the install map wholesale, at
 * all three places that build one (the FrogFS preview, `doSdSync`, `runInstall`):
 *
 *     for (const [k, v] of extractedAssets.entries()) combinedRoms.set(k, v);
 *
 * Nothing there consults the selection, so a converted output stayed in the image after its
 * game or title was deselected. The owner, with OpenLara prepared: preparing added 42.92 MB to
 * the net change and deselecting dropped it only to 42.79 MB -- the 0.13 MB that left is
 * `OpenLara.bin`, which the packer drops on its own because it is reached through
 * `selectedHomebrew`. The converted `.PKD` levels have no such gate and stayed. Doom is the
 * same defect with no visible movement at all: its `.whd` games reach the image ONLY through
 * this merge, so toggling one changed nothing. Clearing the cache "fixed" both because that is
 * the only thing that emptied `assets`.
 *
 * ONE CAUSE, TWO SYMPTOMS. The difference is only which other gate happened to exist.
 *
 * WHY ARTIFACTS ARE KEPT UNCONDITIONALLY. `assetSource` separates a target's own shipped
 * binaries (`artifact`) from a converter's output (`converted`). An artifact is already
 * governed by the packer -- `selectedHomebrew` and `installAllCores` decide whether a target's
 * files ship -- and a core's engine binary must ship whenever any of its games do, which is a
 * rule this module cannot see. So only `converted` bytes are filtered here. That is also
 * exactly the residue the owner reported, which is the other reason to cut it here: the
 * narrowest filter that fixes the defect cannot break shipping.
 *
 * TWO WAYS A CONVERTED ASSET IS WANTED, because there are two kinds of thing that produce one:
 *
 *   1. A GAME ROW. A core's converter turns one input into one installable game (Doom's
 *      `.wad` -> `.whd`). Selection is per game, so the row is the unit: a row keeps its output
 *      when the row is selected. The row's key stays the INPUT's key (`gameRows.ts`), so the
 *      output's placement key has to be rebuilt from `system` + `outputName` -- the same
 *      `${system}/${filename}` shape `prepareState.preparedSize` reads.
 *   2. A HOMEBREW TITLE. OpenLara's `.PKD` levels are not games and never appear as rows; they
 *      belong to the title. Provenance (`produced`) is the only thing that knows which title
 *      wrote a given key, which is why it is recorded rather than derived.
 *
 * An asset whose source was never recorded is KEPT. `run()` and `restore()` both set
 * `assetSource` in the same block that sets `assets`, so this should not arise; if it ever
 * does, a too-large image is a wrong number and a missing file is a broken install, and the
 * cheaper mistake is the number. `test/titlesize.mjs` pins that both paths record a source, so
 * this fallback cannot quietly become the normal case.
 */

/** The half of a game row this decision needs. `outputName` is absent until a row has one. */
export interface AssetRow {
  key: string;
  system: string;
  outputName?: string;
  /** Present when a real entry exists for the output -- see `selectionKeyFor`. Selection lives
   *  on that key, so asking for `key` here would miss every paired, installed row. */
  outputKey?: string;
}

export interface AssetSelection {
  /** Every prepared asset, keyed by its placement path. */
  assets: ReadonlyMap<string, Uint8Array>;
  /** `prepareState.assetSourceOf` -- `undefined` when nothing was recorded. */
  sourceOf: (key: string) => "artifact" | "converted" | undefined;
  /** `prepareState.producedKeys` -- the placement keys one title wrote. */
  producedBy: (titleKey: string) => readonly string[];
  /** Every game row, selected or not. */
  rows: readonly AssetRow[];
  /** Row keys currently selected for install. */
  selectedRowKeys: ReadonlySet<string>;
  /** Homebrew title keys currently selected for install. */
  selectedTitleKeys: ReadonlySet<string>;
  /**
   * Placement keys that are GAMES the project ships (`systems[].games[]`), not core binaries.
   *
   * They arrive as `artifact` like a core's own files, and the rule below keeps artifacts
   * unconditionally because the packer governs those elsewhere. Nothing governs a shipped
   * game: it is a ROM, it gets a Library row, and a row the user cleared must not install
   * anyway. So these are gated on their row exactly as a converted output is -- the key IS the
   * row key, since a shipped game has no input and `gameRows.ts` keys such a row by its
   * installable file.
   */
  shippedGameKeys?: ReadonlySet<string>;
}

/** The placement key a row's converted output occupies. */
export function outputKeyFor(row: AssetRow): string | undefined {
  return row.outputName ? `${row.system}/${row.outputName}` : undefined;
}

/**
 * The prepared assets an install should write, given what is selected.
 *
 * Returns a new map; the input is never mutated. Callers merge this into their install map in
 * place of the whole of `prepareState.assets`.
 */
export function selectedPreparedAssets(sel: AssetSelection): Map<string, Uint8Array> {
  const wanted = new Set<string>();

  for (const row of sel.rows) {
    // `selectionKeyFor`, restated rather than imported: this module is pure and importless so a
    // node suite can drive it, and `gameRows.ts` is the same rule's home. The output key when a
    // file entry exists for it, else the row's own -- which is the converted-in-store case,
    // where the input IS the only handle and `outputKeyFor` below rebuilds the placement.
    if (!sel.selectedRowKeys.has(row.outputKey ?? row.key)) continue;
    const key = outputKeyFor(row);
    if (key !== undefined) wanted.add(key);
  }
  for (const titleKey of sel.selectedTitleKeys) {
    for (const key of sel.producedBy(titleKey)) wanted.add(key);
  }

  const shipped = sel.shippedGameKeys ?? new Set<string>();
  const out = new Map<string, Uint8Array>();
  for (const [key, data] of sel.assets) {
    // A shipped game is an artifact by provenance and a ROM by behaviour. Its row decides.
    if (shipped.has(key) && !sel.selectedRowKeys.has(key)) continue;
    if (sel.sourceOf(key) === "converted" && !wanted.has(key)) continue;
    out.set(key, data);
  }
  return out;
}
