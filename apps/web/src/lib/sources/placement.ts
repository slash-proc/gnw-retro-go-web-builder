/**
 * WHERE A CONVERTED FILE GOES — spec/03-manifest.md ("A converter's output is placed by what
 * it is, not by where the project lives") and spec/05-host.md ("place each by the rule for the
 * project's kind").
 *
 * `homebrewConvert.ts` answers "what is this file called" and `outputNames.ts` answers "may it
 * be written". Neither can answer "written WHERE", and that is a separate question with a
 * separate rule:
 *
 * | the project is  | its converter's output installs to |
 * |-----------------|------------------------------------|
 * | `kind: homebrew`| beside the binary — the rest of the install set |
 * | `kind: homebrew` + `dataDir` | `<paths.homebrew>/<dataDir>/` |
 * | `kind: core`    | `<paths.roms>/<system id>/`        |
 *
 * A homebrew's assets sit beside its binary because that is what loads them at run time; a
 * core's converted output is a GAME, and a `.whd` produced from a WAD is a Doom ROM whether or
 * not it arrived converted — so it belongs in the same folder as one the user supplied
 * ready-made, and the launcher lists both without knowing which was which.
 *
 * ## `dataDir` and `subdir` — the one thing a manifest DOES declare here
 *
 * gwrg-dist-spec `61d3726` added both, because one homebrew genuinely cannot be placed by rule:
 * OpenLara opens `/homebrews/openlara/TITLE.PKD`, and that folder name is compiled into its
 * binary. Nothing can derive it, so the manifest states it.
 *
 * They compose in one direction only, and each is ignored rather than refused when it cannot
 * apply — the published checker refuses these combinations before release, and a host that
 * turned an authoring mistake into a dead source would be the worse failure:
 *
 *   - `dataDir` moves the DATA and never the executable, so `artifactDir` is untouched by it.
 *     That asymmetry is the point: the binary stays where the launcher looks for it.
 *   - `subdir` is per OUTPUT and relative to `dataDir` (`/homebrews/openlara/fmv/`), so it is
 *     meaningless without one and is dropped when `dataDir` is absent. Placing a file one level
 *     below the binary instead would put it where nothing looks.
 *   - A core has neither. `parseManifest` already drops `dataDir` for a core; `subdir` is
 *     ignored here for the same reason, since a core's output is a game and games do not nest.
 *
 * A core declaring ONE system says nothing more: the system is implied. A core with SEVERAL
 * must say which one a tool's output belongs to, in `uses[].system` — the same reason
 * `biosDir` exists (say the thing that cannot be worked out, and nothing else). A manifest
 * that fails that is `malformed`, not guessed at.
 *
 * ## The trailing slash, and why every directory here is spelled one way
 *
 * `planNames()` groups by directory, so `roms/doom/` and `roms/doom` reading as two
 * directories would defeat the grouping outright — two files that are one file on the card
 * would pass the collision check. Two defences, because one of them is a convention and
 * conventions are forgotten: every directory this module returns is normalised (no trailing
 * slash), and `foldDir` normalises whatever it is given anyway.
 *
 * ## The shape of the string
 *
 * These are DEVICE directories, which is what a collision plan is about — the card is where
 * two files become one. They are NOT literals: the firmware declares where each role lives in
 * `manifest.json.paths`, so every directory here comes from the RESOLVED install paths
 * (`engine/devicePaths.ts` -> `packages/fs-builders/src/installPaths.ts`), which is also what
 * `flashImage.ts`'s `userDest()` writes against. The homebrew role in the live manifest is
 * `/homebrews`, NOT `roms/homebrew` — the pre-manifest literal survives only as
 * `DEFAULT_INSTALL_PATHS`' fallback, for a device we have never seen a manifest for.
 *
 * The in-memory prepared-asset map is keyed one level up and by ROLE, not by directory
 * (`homebrew/<filename>` — the shape `prepareState.svelte.ts` builds and `userDest()` turns
 * back into `<paths.homebrew>/<filename>`), so `assetPrefix()` converts a device directory to
 * that key space rather than having two spellings of the same fact drift apart.
 *
 * `use.system` becomes a PATH SEGMENT, and `client.ts` casts `targets[].uses` through
 * unvalidated. So it is checked here, against the schema's own pattern AND against the
 * systems the target actually declares — a host does not get to trust the party it is
 * validating.
 */
import type { InstallPaths } from "@gnw/fs-builders";
import { deviceInstallPaths } from "../engine/devicePaths.js";
import { isSubpath } from "./subpath.js";
import { SourceError, isCoreKind, type Target } from "./types.js";

/** `^[a-z0-9][a-z0-9-]*$` — the schema's pattern for a system id, verbatim. */
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The prepared-asset map's key prefix for homebrew. This is a ROLE NAME, not a directory:
 * `userDest()` matches on it verbatim and expands it to whatever `paths.homebrew` is. It does
 * NOT track the manifest, and must not — renaming the device directory must not restate every
 * in-memory key.
 */
export const HOMEBREW_KEY_PREFIX = "homebrew";

/**
 * Beside the binary: everything a homebrew target installs lives here. The firmware's declared
 * `paths.homebrew` (`/homebrews` in the live manifest), never a literal.
 */
export function homebrewDir(paths: InstallPaths = deviceInstallPaths()): string {
  return normalizeDir(paths.homebrew);
}

/**
 * A core's own binaries — `paths.cores`. NOT where its converted output goes; that is the
 * whole point of this module.
 */
export function coresDir(paths: InstallPaths = deviceInstallPaths()): string {
  return normalizeDir(paths.cores);
}

/** One `targets[].uses[]` entry, with the `system` spec/03 added for multi-system cores. */
export interface ToolUse {
  tool: string;
  outputs: string[];
  required: boolean;
  /** Which system a converted output belongs to. Required only when the core declares several. */
  system?: string;
}

/**
 * One spelling for a directory: no trailing slash, so `roms/doom/` and `roms/doom` are the
 * same key wherever they are compared.
 */
export function normalizeDir(dir: string): string {
  return dir.replace(/\/+$/, "");
}

/** The `uses[]` entry for a tool, if the target has one. */
export function useForTool(target: Pick<Target, "uses">, toolId: string): ToolUse | undefined {
  return (target.uses as ToolUse[] | undefined)?.find((u) => u.tool === toolId);
}

/**
 * Where this target's CONVERTER output installs. Throws `SourceError("malformed")` for a core
 * that does not say (or misnames) which system a multi-system output belongs to — the checker
 * refuses that before release, and a host that assumed the publisher ran the checker would be
 * trusting the party it is validating.
 */
export function converterOutputDir(
  target: Pick<Target, "kind" | "systems" | "dataDir">,
  use?: ToolUse,
  paths: InstallPaths = deviceInstallPaths(),
): string {
  // A core's output is a game under its own system; only homebrew installs beside its
  // binary. Ask `isCoreKind` — comparing sent every `kind: "core"` core down the homebrew
  // branch, filing its games in the homebrew directory.
  if (!isCoreKind(target.kind)) {
    const base = homebrewDir(paths);
    // Re-checked rather than trusted: `parseManifest` validates `dataDir`, but this module is
    // reached with hand-built targets too, and the value becomes path SEGMENTS on the card.
    // Ignored rather than refused when it is unusable — see the header.
    return isSubpath(target.dataDir) ? `${base}/${normalizeDir(target.dataDir)}` : base;
  }

  const ids = (target.systems ?? [])
    .map((s) => s.id)
    .filter((id): id is string => typeof id === "string" && SEGMENT.test(id));

  const declared = use?.system;
  if (declared !== undefined) {
    // Untrusted text that becomes a path segment, and it must name a system this target has:
    // the published checker refuses both cases, and so does this.
    if (typeof declared !== "string" || !SEGMENT.test(declared) || !ids.includes(declared)) {
      throw new SourceError("malformed");
    }
    return `${normalizeDir(paths.roms)}/${declared}`;
  }

  // One system is implied. Several, and the manifest had to say which.
  if (ids.length === 1) return `${normalizeDir(paths.roms)}/${ids[0]}`;
  throw new SourceError("malformed");
}

/**
 * How much deeper THIS output nests, relative to `converterOutputDir`. `""` for every output
 * that sits directly in it, which is all of them today — no published project uses `subdir`.
 *
 * Separate from `converterOutputDir` because the two answer different questions: that one is
 * per TARGET (and is what the prepared-asset key is built from), this one is per OUTPUT. A
 * tool may put its levels in `/homebrews/openlara/` and its cutscenes in
 * `/homebrews/openlara/fmv/`, so a single directory for the whole tool cannot express it.
 *
 * Returns `""` — never throws — in the three cases the header explains: a core, a homebrew
 * with no `dataDir` for it to be relative to, and a value that is not a usable subpath.
 */
export function outputSubdir(
  target: Pick<Target, "kind" | "dataDir">,
  subdir: string | undefined,
): string {
  if (isCoreKind(target.kind)) return "";
  if (!isSubpath(target.dataDir)) return "";
  return isSubpath(subdir) ? normalizeDir(subdir) : "";
}

/**
 * Where this target's ARTIFACTS install — the publisher-declared half of the install set, and
 * the other party in a name collision. For a homebrew it is the same directory the converted
 * output lands in (which is exactly why those two can collide); for a core it is not, which is
 * why a core's artifacts and its converted games cannot.
 */
export function artifactDir(
  target: Pick<Target, "kind">,
  paths: InstallPaths = deviceInstallPaths(),
): string {
  return isCoreKind(target.kind) ? coresDir(paths) : homebrewDir(paths);
}

/**
 * A device directory -> the prepared-asset map's key prefix, which `userDest()` expands again.
 *
 * The homebrew directory maps to the ROLE name (`homebrew`) whatever the manifest calls it —
 * `/homebrews` and the pre-manifest `roms/homebrew` both key `homebrew/<file>`, because that is
 * the one string `userDest()` matches on. A ROMs directory drops that prefix (`roms/nes` ->
 * `nes`), since `userDest()` puts it back. Anything else (a core's own directory) is already in
 * that key space and passes through.
 *
 * A `dataDir` nests BELOW the homebrew directory, so the role swap is a prefix replacement and
 * not an equality test: `homebrews/openlara` keys `homebrew/openlara`, which `userDest()` then
 * expands back by taking everything after the role name. Testing equality alone left the whole
 * path intact, and `userDest()` reads an unrecognised first segment as a ROMs system — so
 * OpenLara's levels would have gone to `roms/homebrews/openlara/`.
 *
 * The homebrew test runs FIRST because the pre-manifest fallback nests it under the ROMs
 * directory (`roms/homebrew`), where the ROMs branch would otherwise claim it.
 */
export function assetPrefix(dir: string, paths: InstallPaths = deviceInstallPaths()): string {
  const norm = normalizeDir(dir);
  const hb = homebrewDir(paths);
  if (norm === hb) return HOMEBREW_KEY_PREFIX;
  if (norm.startsWith(`${hb}/`)) return `${HOMEBREW_KEY_PREFIX}/${norm.slice(hb.length + 1)}`;
  const romsPrefix = `${normalizeDir(paths.roms)}/`;
  return norm.startsWith(romsPrefix) ? norm.slice(romsPrefix.length) : norm;
}
