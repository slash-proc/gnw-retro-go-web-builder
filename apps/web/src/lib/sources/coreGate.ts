/**
 * WHICH CORES AN INSTALL WRITES, and why the answer differs by medium.
 *
 * The owner's rule, in his words:
 *
 *   "On flash: when a ROM is selected, its core must be installed too. If all ROMs of a core
 *    have been selected for removal, remove the core as well."
 *   "On SD, we assume the user might install a ROM by hand at a given moment. On Flash that
 *    just isn't the case."
 *
 * So the difference is the MEDIUM, not a policy preference: content can arrive on a card
 * behind our back, so every core has to be there already; nothing arrives on flash that this
 * app did not write, so the selection is the whole truth about what the device needs.
 *
 * `biosState`'s `filterInstall`/`omittedFilenames` pair is the same shape for the same reason,
 * and says so at its own call site: "filterInstall is a no-op on SD by design: an active
 * source's BIOS is written whether or not the user has games for it, because ROMs reach a card
 * outside this app." This module is that idiom applied to cores. Both media call it, SD gets an
 * empty set, and the two paths cannot drift apart because there is only one function.
 *
 * WHY THIS IS NOT IN `selectedAssets.ts`. That module gates CONVERTED bytes on the row
 * selection and keeps every artifact, and its header explains the asymmetry: an artifact "is
 * already governed by the packer ... and a core's engine binary must ship whenever any of its
 * games do, which is a rule this module cannot see". This is that rule. It needs the core
 * registry (which system belongs to which core) and the medium, neither of which belongs in a
 * function about converter provenance.
 *
 * PURE AND SVELTE-FREE, so `test/coregate.mjs` drives it with plain objects, the same reason
 * `coreRegistry.ts` is.
 */

/** The medium an install writes to. `biosState`'s `BiosMedium`, restated to avoid the import. */
export type CoreMedium = "flash" | "sd";

/** The half of a prepared title this decision needs. */
export interface GateTitle {
  /** `owner/repo#targetId` — `HomebrewTitle.key`, and `RegisteredSystem.targetKey`. */
  key: string;
  /** TRUE FOR A CORE, FALSE FOR HOMEBREW. Homebrew is never gated here: it is content in its
   *  own right, governed by `selectedHomebrew` in the packer. */
  isCore: boolean;
}

export interface CoreGateInputs {
  titles: readonly GateTitle[];
  /**
   * The `roms/<folder>` directories one core target declares, lowercased.
   *
   * ONE TARGET, MANY SYSTEMS is the case that makes this a set membership test rather than a
   * lookup: upstream's `sd_cores_pack.py` maps `gg`, `sms`, `sg` and `col` all onto `sms.bin`,
   * and `gb` and `gbc` both onto `tgb.bin`. A core stays while ANY of its systems still has a
   * selected ROM, so deselecting every Game Boy game must not take the core out from under the
   * Game Boy Color games that share it.
   */
  systemsOf: (targetKey: string) => readonly string[];
  /** Systems (`roms/<folder>`, lowercased) with at least one ROM selected for install. */
  selectedSystems: ReadonlySet<string>;
  /** `prepareState.producedKeys` — the placement keys one title wrote. */
  producedBy: (titleKey: string) => readonly string[];
  /** `prepareState.assetSourceOf` — `undefined` when nothing was recorded. */
  sourceOf: (key: string) => "artifact" | "converted" | undefined;
  medium: CoreMedium;
  /**
   * TRUE WHEN THE USER HAS NOT TOUCHED THE GAME SELECTION AT ALL, in which case no core is
   * unused and this gate does nothing.
   *
   * `selectedSystems` being empty means two completely different things and the set cannot
   * tell them apart. A user who unticked all 196 rows asked for a clean device, and the rule
   * above is exactly what he asked for: his cores go with his games. A user who opened the
   * Library and did nothing asked for nothing, and running the rule over his untouched state
   * read the absence of intent as an instruction to strip every core -- an untouched tab
   * projected `-0.18 MB net change` because the device's `cores/gba.xip` was about to be
   * dropped for want of a GBA ROM that had never been there.
   *
   * The owner's rule is a rule about a DESELECTION ("if all ROMs of a core have been selected
   * for removal"), so the gate needs the one fact `selectedSystems` cannot carry: whether a
   * removal was ever requested. `romSelection.selectionTouched` is that fact, and it is real
   * state rather than a heuristic -- `overrides` is written by `toggle`, `selectAllMissing`
   * and `setSystem` and by nothing else, so it is non-empty exactly when the user acted.
   *
   * OPTIONAL, AND ABSENT MEANS TOUCHED, so that a caller which never had this concept keeps
   * the behaviour it had. There is one production caller (`views/RomManagementTab.svelte`) and
   * it passes the flag.
   */
  selectionUntouched?: boolean;
}

/** One core this install has no games for, and the files that would have shipped for it. */
export interface UnusedCore {
  targetKey: string;
  /** The systems it declares, for the log line. */
  systems: readonly string[];
  /** Its own shipped binaries, by placement key. */
  keys: readonly string[];
}

/**
 * The cores a flash install has no selected ROM for, with the artifact keys they own.
 *
 * ALWAYS EMPTY ON SD. Returned as a list rather than a bare key set because the caller has to
 * report what it is leaving out, and a key on its own cannot say which core it belonged to.
 *
 * ONLY `artifact` KEYS ARE LISTED. A core with a converter also produced game bytes
 * (Doom's `.whd`), and those are governed by the row selection in `selectedPreparedAssets`.
 * Gating them a second time here would be harmless today and wrong the moment the two rules
 * disagree, so the cut is exactly the core's own shipped binaries. `assetSourceOf` is what
 * separates them, the same field `preparedOutputsFor` uses for the same split.
 *
 * A COMPANION TRAVELS WITH ITS CORE by construction: `producedBy` returns every key the target
 * wrote, so `gba.bin` and `gba.xip` are one unit, as are `a2600.bin` and `a2600_defprops.bin`.
 * Nothing here enumerates filenames, which is what keeps a split core from shipping in half.
 */
export function unusedCores(inp: CoreGateInputs): UnusedCore[] {
  if (inp.medium === "sd") return [];
  // No selection was ever made, so nothing was deselected and no core is unused. See
  // `selectionUntouched` for why an empty `selectedSystems` cannot answer this on its own.
  if (inp.selectionUntouched) return [];
  const out: UnusedCore[] = [];
  for (const title of inp.titles) {
    if (!title.isCore) continue;
    const systems = inp.systemsOf(title.key);
    if (systems.some((s) => inp.selectedSystems.has(s.toLowerCase()))) continue;
    const keys = inp.producedBy(title.key).filter((k) => inp.sourceOf(k) === "artifact");
    if (keys.length === 0) continue;
    out.push({ targetKey: title.key, systems, keys });
  }
  return out;
}

/** Every key `unusedCores` would omit, flattened. */
export function unusedCoreKeys(inp: CoreGateInputs): Set<string> {
  const out = new Set<string>();
  for (const core of unusedCores(inp)) for (const k of core.keys) out.add(k);
  return out;
}

/**
 * Strip the cores this medium should not write from a prepared-asset map, on the way into an
 * install. Mirrors `biosState.filterInstall`, including being a no-op when the set is empty.
 */
export function applyCorePolicy<T>(
  assets: ReadonlyMap<string, T>,
  omitted: ReadonlySet<string>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [key, data] of assets) {
    if (omitted.has(key)) continue;
    out.set(key, data);
  }
  return out;
}

/**
 * The keys of an unused core that this install cannot actually take off the device.
 *
 * A ROM install rebuilds FrogFS from the selection, so a MAPPED artifact (`gba.xip`) is removed
 * simply by not being packed. The LittleFS partition is not rebuilt, because it also holds the
 * user's saves, and there is no delete path into it: `writeFilesToDeviceLfs` only writes, and
 * the vendored littlefs WASM exports no `lfs_remove` at all (`_lfs_w_*` is create/mkdir/write/
 * read/listdir/mount/unmount and nothing else). So a core's RAM half stays where it is.
 *
 * That asymmetry is the thing worth reporting: deselecting the last GBA ROM removes `gba.xip`
 * and strands `gba.bin`, which is a half-core rather than a clean removal. The caller says so
 * in the audit log rather than implying the removal happened.
 */
export function strandedCoreKeys(cores: readonly UnusedCore[], mappedKeys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const core of cores) for (const k of core.keys) if (!mappedKeys.has(k)) out.push(k);
  return out;
}
