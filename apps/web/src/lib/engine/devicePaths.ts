/**
 * The install locations THIS app assumes for a device/card it did not just write.
 *
 * `packages/fs-builders/src/installPaths.ts` is the authority: the firmware's own
 * `manifest.json.paths` says where each role lives (`/homebrews`, `/roms`, `/bios`, …), and
 * `flashImage.ts`'s `userDest()` writes there. The WRITE side always has the manifest in
 * hand (it comes off the bundle being installed). Two sites do NOT:
 *
 *  - the on-device FrogFS read (`frogfsDevice.ts`, run from `device.scan()`), which happens
 *    long before any bundle is fetched, and
 *  - the SD-card write path (`RomManagementTab.svelte`'s `toSdPath`), which only fetches a
 *    bundle when the user opted into re-syncing cores.
 *
 * So the resolved paths are LEARNED from the manifest whenever one passes through
 * (`rememberInstallPaths`) and remembered across reloads. With nothing learned yet the
 * fallback is `DEFAULT_INSTALL_PATHS` — the literals this code used before the manifest
 * existed — never a fresh literal spelled out here.
 */
import { scoped } from "../storageScope.js";
import {
  resolveInstallPaths,
  DEFAULT_INSTALL_PATHS,
  under,
  type InstallPaths,
} from "@gnw/fs-builders";

/** Where the learned `paths` object is remembered between page loads. */
const STORAGE_KEY = scoped("gnw.install-paths");

let learned: InstallPaths | null = null;
let loadedFromStorage = false;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // a browser with site data blocked throws on the accessor itself
  }
};

/**
 * The install paths to assume right now: the last manifest seen (this session or a previous
 * one), else the pre-manifest defaults.
 */
export function deviceInstallPaths(): InstallPaths {
  if (learned) return learned;
  if (!loadedFromStorage) {
    loadedFromStorage = true;
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        learned = resolveInstallPaths(JSON.parse(raw) as Record<string, unknown>);
        return learned;
      } catch {
        /* unparseable or malformed — fall through to the defaults */
      }
    }
  }
  return DEFAULT_INSTALL_PATHS;
}

/**
 * Record the `paths` object off a firmware manifest as the locations installed content is at.
 * Called wherever a bundle is fetched. A malformed value is refused by `resolveInstallPaths`
 * (InstallPathError) — that throw is deliberate and is NOT caught here.
 */
export function rememberInstallPaths(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): InstallPaths {
  const paths = resolveInstallPaths(raw);
  learned = paths;
  loadedFromStorage = true;
  try {
    if (raw) storage()?.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {
    /* storage full / blocked — the in-memory value is still good for this session */
  }
  return paths;
}

/** Test seam: drop everything learned (in memory and in storage). */
export function forgetInstallPaths(): void {
  learned = null;
  loadedFromStorage = true;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Every directory a homebrew binary may be sitting in on a device we are READING.
 *
 * The manifest's directory first, then the pre-manifest default — a device installed before
 * the `paths` cutover still has its homebrew under `roms/homebrew`, and a read must recognise
 * both or that content goes invisible (and then gets dropped by the next repack).
 */
export function homebrewDirs(paths: InstallPaths = deviceInstallPaths()): string[] {
  return paths.homebrew === DEFAULT_INSTALL_PATHS.homebrew
    ? [paths.homebrew]
    : [paths.homebrew, DEFAULT_INSTALL_PATHS.homebrew];
}

/** The content categories `romSelection.svelte.ts`'s `classifyContentPath` produces. */
export type SdContentCategory = "game" | "bios" | "cover" | "cheat" | "homebrew";

/**
 * Map one `userRoms` key to its path on the SD card.
 *
 * Same rules as `flashImage.ts`'s `userDest()`, minus the `<sys>_bios` hoist (SD keys never
 * carry that shape — they are already classified): `cover`/`bios`/`cheat` keys arrive fully
 * rooted in the firmware's own trees and pass through untouched; a `homebrew/<file>` key goes
 * to the manifest's homebrew directory (`/homebrews` in the live manifest, NOT
 * `roms/homebrew`); everything else is a ROM under the manifest's roms directory.
 */
/**
 * `scanRomDirectory` (romScan.ts) strips ONE leading `roms/` from every key it returns, so its
 * key space is a hybrid: content under the roms directory is relative to that directory, and
 * everything else is relative to the storage root. A directory compared against those keys has
 * to carry the same strip.
 *
 * The literal mirrors the scan's own, deliberately. It is the scan that produced these keys, so
 * this must match what the scan DID, not what a manifest says it should have done; if that strip
 * ever becomes manifest-driven, both sites move together.
 */
const asScanKey = (dir: string): string => (dir.startsWith("roms/") ? dir.slice(5) : dir);

/**
 * Every directory prefix `romScan.ts`'s `walk()` may meet for homebrew.
 *
 * `walk` runs BEFORE the `roms/` strip and against a folder the user picked, which may be the
 * storage root or the roms directory itself — so `roms/homebrew` and `homebrew` are both
 * legitimate prefixes for the same content, which is why the literal it replaced listed two.
 * Both forms of every homebrew directory, deduped.
 */
export function homebrewScanPrefixes(paths: InstallPaths = deviceInstallPaths()): string[] {
  const out = new Set<string>();
  for (const dir of homebrewDirs(paths)) {
    out.add(dir);
    out.add(asScanKey(dir));
  }
  return [...out];
}

/**
 * Firmware directories that sit at the STORAGE ROOT and hold no games.
 *
 * WHY THIS IS A LIST OF DIRECTORIES AND NOT A LIST OF CONSOLES, which is the shape it looks
 * like it should have. The rule the owner stated is an allow-list: "we only look at
 * /roms/<console>/ and /homebrews/". That rule cannot be applied to a key at this point in the
 * pipeline, because `scanRomDirectory` has already stripped one leading `roms/` from every key
 * it returns (see `asScanKey`). After that strip a real game and a firmware asset are the same
 * SHAPE — `roms/gb/tetris.gb` arrives as `gb/tetris.gb`, and `cores/gba.bin` arrives as
 * `cores/gba.bin` — so nothing in the key itself says which side of `roms/` it came from. The
 * roms prefix is the evidence the allow-list needs and the scan has already consumed it.
 *
 * So the test is necessarily "is this first segment one of the firmware's own root directories".
 * It is kept honest by being derived rather than typed: every role the manifest declares except
 * `roms`, plus `extra` (roles a LATER firmware names that this codebase has no use for, carried
 * through by `resolveInstallPaths` precisely so they are not lost), plus the directories the
 * firmware creates with no manifest role at all.
 *
 * Those last ones are literals because there is nothing to derive them from, and each is cited:
 * `fonts` AND `font` are separate prefixes in the firmware's own `is_frogfs_path()`
 * (`references/game-and-watch-retro-go-sd/Core/Src/syscalls.c`), `lang` is the literal
 * `flashImage.ts` already hardcodes for the same reason, and `screenshots` is
 * `ODROID_BASE_PATH_SCREENSHOTS` (`components/odroid/config.h`), written by the firmware at
 * runtime rather than by any install.
 *
 * The previous shape named three directories to EXCLUDE and treated every other top segment as
 * a console, so `cores/`, `fonts/`, `lang/`, `data/` and `screenshots/` all became systems and a
 * core binary was listed to the user as a game with a "cores" chip.
 */
export function nonGameDirs(paths: InstallPaths = deviceInstallPaths()): string[] {
  const out = new Set<string>();
  for (const dir of [paths.cores, paths.bios, paths.covers, paths.cheats, paths.data]) {
    if (dir) out.add(asScanKey(dir));
  }
  for (const dir of Object.values(paths.extra)) if (dir) out.add(asScanKey(dir));
  for (const dir of ["fonts", "font", "lang", "screenshots"]) out.add(dir);
  out.delete(asScanKey(paths.roms)); // never exclude the games directory itself
  return [...out];
}

/**
 * Classify one `userRoms` key from an SD scan as an installed game, or null for a non-game
 * asset. The inverse of `sdDestPath`, and the SD counterpart of `frogfsDevice.ts`'s `toGame`.
 *
 * The two READ sites have to agree: a title that reads as installed on Flash and missing on SD
 * is exactly the bug this replaced. The SD scan used to take the key's top segment as the
 * system verbatim, so a homebrew binary at the manifest's `/homebrews` arrived as system
 * `"homebrews"` while every consumer filters for `"homebrew"` — scanned, listed, then dropped
 * from every completeness check.
 *
 * Homebrew is tested FIRST for the same reason `toGame` does it: the pre-manifest default
 * (`roms/homebrew`) sits inside the roms directory, so a roms-first test would classify it by
 * accident of the layout and would miss the live manifest's directory entirely.
 */
export function classifySdScanKey(
  key: string,
  paths: InstallPaths = deviceInstallPaths(),
): { system: string; name: string; path: string } | null {
  for (const dir of homebrewDirs(paths)) {
    const prefix = `${asScanKey(dir)}/`;
    if (key.startsWith(prefix)) {
      const name = key.slice(prefix.length);
      return name ? { system: "homebrew", name, path: under(dir, name) } : null;
    }
  }
  // Not games: the firmware's own root directories. See `nonGameDirs` for why this cannot be
  // expressed as the allow-list it ought to be.
  for (const dir of nonGameDirs(paths)) {
    if (key.startsWith(`${dir}/`)) return null;
  }
  const slash = key.indexOf("/");
  // A loose file with no directory belongs to no console. After the strip that covers both
  // `roms/foo.gb` (the roms directory holds consoles, not games: the firmware reads
  // `/roms/<system>/`) and a file at the storage root.
  if (slash <= 0) return null;
  const system = key.slice(0, slash);
  const name = key.slice(slash + 1); // may contain subdirs; kept as-is, like toGame
  if (!system || !name) return null;
  return { system, name, path: under(paths.roms, key) };
}

/**
 * Scan keys that are a LEGACY homebrew copy of something the manifest's directory already holds.
 *
 * THE RULE, and it is a rule rather than a patch for one case: when both homebrew directories
 * hold the same relative path, the MANIFEST'S directory wins for display and the legacy copy is
 * not listed. One title, one row. That covers a stale legacy file whose modern counterpart
 * differs (which the migration deliberately refuses to move, so showing it would offer the user
 * a row nothing will ever act on) and an identical pair left by an interrupted migration,
 * without either being special-cased.
 *
 * `homebrewDirs()` still returns BOTH directories and that is still right: a read must recognise
 * either or the content goes invisible. This does not un-recognise anything. What it drops is
 * the SECOND listing of a title that is already listed.
 *
 * NOTHING DOWNSTREAM CAN READ THIS AS A DELETION, which is the hazard worth checking rather than
 * assuming. Every consumer of the homebrew half of `installedGames` matches on `name`:
 * `romSelection.svelte.ts:294` and `:396` (which skips homebrew as a non-game system outright),
 * `RomManagementTab`'s `deviceHomebrew`, `hbRemovals` and `deviceHomebrewNames`, and
 * `deletedUnknownHomebrew`, which is keyed by filename. A shadowed key is only ever dropped when
 * the same NAME is present via the modern directory, so every one of those sees no change.
 * `freshTarget` (`installedGames.length === 0`) cannot flip either: shadowing removes an entry
 * only when its counterpart remains, so it can never empty the list.
 *
 * Keys arrive in `scanRomDirectory`'s space, with one leading `roms/` already stripped, so both
 * directories are compared through `asScanKey` -- the same strip `classifySdScanKey` makes.
 */
export function shadowedLegacyHomebrewKeys(
  keys: Iterable<string>,
  paths: InstallPaths = deviceInstallPaths(),
): Set<string> {
  const modern = asScanKey(paths.homebrew);
  const legacy = asScanKey(DEFAULT_INSTALL_PATHS.homebrew);
  const out = new Set<string>();
  // The manifest declares the legacy directory, so there is no second directory and nothing can
  // shadow anything. Returning early also stops `modern === legacy` matching a key against
  // itself and dropping every homebrew file on the card.
  if (modern === legacy) return out;

  const all = [...keys];
  const held = new Set<string>();
  for (const key of all) {
    if (key.startsWith(`${modern}/`)) held.add(key.slice(modern.length + 1));
  }
  if (held.size === 0) return out;
  for (const key of all) {
    if (!key.startsWith(`${legacy}/`)) continue;
    if (held.has(key.slice(legacy.length + 1))) out.add(key);
  }
  return out;
}

export function sdDestPath(
  key: string,
  category: SdContentCategory,
  paths: InstallPaths = deviceInstallPaths(),
): string {
  if (category === "cover" || category === "bios" || category === "cheat") return key;
  if (category === "homebrew") {
    const slash = key.indexOf("/");
    return under(paths.homebrew, slash > 0 ? key.slice(slash + 1) : key);
  }
  // A key already rooted at the firmware's CORES directory is where it belongs -- pass it
  // through, the same way `flashImage.ts`'s `userDest` passes through a key already rooted at
  // roms/covers/bios/cheats. `placement.ts`'s `assetPrefix` leaves a core's directory untouched
  // (only the homebrew ROLE is swapped), so `cores/doom.bin` arrives here fully placed and the
  // ROMs fallback below was prefixing it: `roms/cores/doom.bin` on the owner's card, where the
  // firmware never looks, so the core synced and the console still could not run.
  //
  // CORRECTION. This comment used to claim "Flash never hit this: cores go to the LittleFS
  // partition there and never reach a key mapper." That was wrong on both halves, and the
  // owner's FrogFS file browser showed `roms/cores/doom.bin` on flash too. `cores/* ->
  // LittleFS` (`flashImage.ts`'s header) routes the BUNDLE map; a core from a SOURCE arrives
  // in `userRoms` and goes through `userDest` with the rest of the user content, which had
  // neither the pass-through nor the LittleFS split. Both are fixed there now. Whoever edits
  // one mapper edits the other: `flashImage.mjs` pins that they agree on a core.
  if (key.startsWith(`${paths.cores}/`)) return key;
  return under(paths.roms, key);
}
