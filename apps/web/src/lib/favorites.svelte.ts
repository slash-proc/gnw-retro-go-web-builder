/**
 * Favorites, stored the way the firmware stores them.
 *
 * THIS IS NOT OUR FORMAT. Retro-Go v2.0.0-rc2 owns `/data/favorites.txt` and reads and rewrites
 * it at runtime (`Core/Src/retro-go/rg_favorites.c`, contract in `Core/Inc/retro-go/favorites.h`).
 * We write the same file so a star set here is the same star the launcher's tab shows, and so a
 * star set on the device survives a sync from here. Inventing a parallel store would have given
 * the user two lists that disagree.
 *
 * The format, read out of the firmware rather than assumed:
 *
 *   - One absolute device path per line, `\n` terminated, including the last line
 *     (`rg_favorites_add`: `fprintf(f, "%s\n", path)`).
 *   - The reader strips trailing CR and LF (`read_favorite_line`'s `strcspn(buf, "\r\n")`), so a
 *     CRLF file parses; we write LF because the firmware does.
 *   - Add appends and is a no-op when already present, so the file is a SET in insertion order.
 *     Order carries no meaning: the tab sorts alphabetically by name before drawing
 *     (`favorites_name_cmp`).
 *   - Remove rewrites the file without the entry, and drops blank lines while it is there.
 *   - Matching is `strcmp`: exact, case-sensitive, no normalisation. `/roms/nes/x.nes` and
 *     `/roms/NES/x.nes` are two different favorites to the firmware, so they are here too.
 *
 * A path the firmware cannot resolve is NOT an error to it: `favorites_fill_files` skips a line
 * whose system is unknown or whose file is gone, and deliberately KEEPS it in the file, "so an SD
 * hiccup can't silently destroy the list". We inherit that: `merge` never drops a line it does
 * not understand.
 */
import { scoped } from "./storageScope.js";

/** `ODROID_BASE_PATH_CONFIG "/favorites.txt"` with `RG_STORAGE_ROOT` empty (`config.h:54-60`). */
export const FAVORITES_DEVICE_PATH = "data/favorites.txt";

/**
 * Host-side stars, keyed by ROW IDENTITY, not by device path.
 *
 * THE MODEL, and it is two sets rather than one. The owner: "anything should be able to be a
 * favorite. my goal is to have anything that's favorited and installed also show up in the
 * on-device favorites list."
 *
 * So favouriting is a LOCAL act on a row, and writing `/data/favorites.txt` is a SEPARATE,
 * DERIVED act over the intersection of favourited and installed. A row can be starred before it
 * has a device path at all -- a converter title nobody has prepared, a game not yet installed --
 * and it starts appearing in the file the moment it lands, with no second action from the user.
 *
 * Keying by device path is what made that impossible, because a row with no installed file has
 * no path to key by. That was also why the star was hidden on rows the firmware could not
 * address, which is the affordance the owner noticed missing.
 */
const FAVORITES_KEY = scoped("gnw.favorites.v2");

/** The device-path-keyed store this replaced. Read once, migrated, never written again. */
const LEGACY_FAVORITES_KEY = scoped("gnw.favorites.v1");

/**
 * The row identity an old device path came from, or null when it cannot be recovered.
 *
 * A ROM row's id is `<system>/<file>` and `sdDestPath` prefixes the firmware's roms directory,
 * so stripping `/roms/` inverts it exactly. A homebrew's id is its MANIFEST key, which the
 * filename under `/homebrews/` does not carry and nothing here can reconstruct -- those are kept
 * verbatim as legacy paths instead of being dropped, and still written to the file. Losing a
 * user's marks to a refactor is not a trade worth making for a tidier store.
 *
 * `/roms/homebrew/` is deliberately NOT mapped: the firmware refuses that prefix outright, and
 * `homebrew/<file>` is not the shape a homebrew row id has either, so mapping it would invent a
 * row that never matches anything.
 */
export function rowIdForLegacyPath(devicePath: string): string | null {
  if (!devicePath.startsWith(ROMS_PREFIX)) return null;
  if (devicePath.startsWith(LEGACY_HOMEBREW_PREFIX)) return null;
  const rest = devicePath.slice(ROMS_PREFIX.length);
  return rest.includes("/") ? rest : null;
}

/**
 * Prefixes `rg_favorites.c`'s `system_for_path` resolves, in its own order.
 *
 * `/homebrews/<file>` maps to the `homebrew` system; `/roms/<system>/<file>` maps by directory.
 * `/roms/homebrew/...` is explicitly refused there ("Legacy /roms/homebrew/ - homebrews live at
 * /homebrews/ only"), so a favorite written under it would be invisible on the device forever.
 */
const ROMS_PREFIX = "/roms/";
const HOMEBREWS_PREFIX = "/homebrews/";
const LEGACY_HOMEBREW_PREFIX = "/roms/homebrew/";

/**
 * Can the firmware resolve this path to a system?
 *
 * Mirrors `system_for_path` exactly, minus the registered-system lookup, which depends on what is
 * installed and is therefore not ours to judge: the firmware hides an unresolvable line rather
 * than failing on it, so a system we do not recognise is not a reason to refuse the write. What
 * we DO refuse is a shape the firmware can never resolve, whatever is installed.
 */
export function isFavoritable(devicePath: string): boolean {
  if (!devicePath.startsWith("/")) return false;
  if (devicePath.startsWith(LEGACY_HOMEBREW_PREFIX)) return false;
  if (devicePath.startsWith(HOMEBREWS_PREFIX)) return devicePath.length > HOMEBREWS_PREFIX.length;
  if (!devicePath.startsWith(ROMS_PREFIX)) return false;
  // `/roms/<dirname>/<file>`: a non-empty dirname and something after the slash.
  const rest = devicePath.slice(ROMS_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash > 0 && slash < rest.length - 1;
}

/**
 * A device path as the firmware spells it, from the destination key our installers already build.
 *
 * `sdDestPath`/`userDest` produce relative keys (`roms/nes/x.nes`, `homebrews/OpenLara.bin`); the
 * favorites file holds absolute ones. This is the only place that conversion happens.
 */
export function toDevicePath(destKey: string): string {
  return destKey.startsWith("/") ? destKey : `/${destKey}`;
}

/** Parse the file. Blank lines are dropped, exactly as the firmware's rewrite drops them. */
export function parseFavorites(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[\r\n]+$/, "");
    if (line !== "") out.push(line);
  }
  return out;
}

/** Serialise. Every line is `\n` terminated, including the last, as `rg_favorites_add` writes. */
export function serializeFavorites(paths: readonly string[]): string {
  return paths.length === 0 ? "" : `${paths.join("\n")}\n`;
}

/**
 * Fold our stars into whatever the card already holds.
 *
 * NOT a replace. The device writes this file too, so the user's on-device stars are real data we
 * did not author. `starred` are added if absent (append, keeping existing order, like
 * `rg_favorites_add`); `unstarred` are removed. Every other existing line survives untouched,
 * including one we cannot resolve.
 */
export function mergeFavorites(
  existing: readonly string[],
  starred: Iterable<string>,
  unstarred: Iterable<string>,
): string[] {
  const drop = new Set(unstarred);
  const out = existing.filter((p) => !drop.has(p));
  const have = new Set(out);
  for (const p of starred) {
    if (drop.has(p) || have.has(p)) continue;
    out.push(p);
    have.add(p);
  }
  return out;
}

/**
 * Read the persisted blob, with the one-time migration from the device-path-keyed store.
 *
 * A PURE FUNCTION, deliberately, and that is the fix rather than a detail. See the class below.
 */
function readStored(storage: Storage | null): {
  starred: Set<string>;
  unstarred: Set<string>;
  legacy: Set<string>;
} {
  const empty = () => ({ starred: new Set<string>(), unstarred: new Set<string>(), legacy: new Set<string>() });
  const asSet = (v: unknown): Set<string> =>
    new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  const raw = storage?.getItem(FAVORITES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { starred?: unknown; unstarred?: unknown; legacy?: unknown };
      return {
        starred: asSet(parsed.starred),
        unstarred: asSet(parsed.unstarred),
        legacy: asSet(parsed.legacy),
      };
    } catch {
      /* unparseable: fall through to the migration rather than throwing on a convenience */
    }
  }

  // MIGRATION, and it runs exactly once: the moment anything is written, the v2 key exists and
  // the branch above wins forever after. A path that maps becomes a row id; one that does not
  // is kept verbatim so the user's mark survives even though no row will ever match it.
  const old = storage?.getItem(LEGACY_FAVORITES_KEY);
  if (!old) return empty();
  try {
    const parsed = JSON.parse(old) as { starred?: unknown; unstarred?: unknown };
    const out = empty();
    for (const path of asSet(parsed.starred)) {
      const id = rowIdForLegacyPath(path);
      if (id === null) out.legacy.add(path);
      else out.starred.add(id);
    }
    for (const path of asSet(parsed.unstarred)) {
      const id = rowIdForLegacyPath(path);
      if (id !== null) out.unstarred.add(id);
    }
    return out;
  } catch {
    return empty(); // unparseable legacy blob: nothing to carry across
  }
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // a browser with site data blocked; favorites are a convenience, not a gate
  }
}

class Favorites {
  /** ROW IDS the user has starred here. Reassigned on every mutation: a `Set` inside `$state`
   *  is not deeply reactive in Svelte 5. */
  starred = $state(new Set<string>());

  /** ROW IDS explicitly unstarred here, so a sync can remove one the device already holds.
   *  Without this, unstarring could only ever be a local no-op. */
  unstarred = $state(new Set<string>());

  /**
   * Device paths carried over from the device-path-keyed store that no row id could be
   * recovered from (a `/homebrews/` entry, whose manifest key the filename does not carry).
   *
   * Written to the file as-is, and never matched against a row. They are somebody's real marks;
   * dropping them to make the store uniform would be losing data to tidy up.
   */
  legacy = $state(new Set<string>());

  /**
   * THE RESTORE HAPPENS HERE, IN THE CONSTRUCTOR, AND IT MUST STAY HERE.
   *
   * It used to be a lazy `load()` that every reader called first, and that silently lost every
   * star on reload. **Assigning `$state` inside a `$derived` throws `state_unsafe_mutation` in
   * Svelte 5**, and the first reader of this store is a derived, not the template:
   * `RomManagementTab.svelte`'s `visibleGames` and `favoritesCount` both call `has()` through
   * `rowAccess.isFavorite`. So on every page load the sequence was:
   *
   *   1. a derived calls `has()` -> `load()` sets its `loaded` flag true,
   *   2. the very next line assigns `this.starred` and THROWS,
   *   3. the derived recomputes, `load()` early-returns on the flag it already set,
   *      and the sets stay EMPTY for the life of the page.
   *
   * The page kept working, so nothing looked broken; the stars were simply all gone. Worse,
   * step 3 left a mutator writing without having read: the next `toggle()` started from the
   * empty set and `persist()` wrote that over the user's real list, so one click after a reload
   * destroyed every other star on disk.
   *
   * A constructor is not a reactive context, so the assignment is legal and happens exactly
   * once, before any reader exists. Do not reintroduce a lazy load, and do not move this read
   * into a getter: the hazard is the reactive context, not the timing.
   */
  constructor() {
    const stored = readStored(storageOrNull());
    this.starred = stored.starred;
    this.unstarred = stored.unstarred;
    this.legacy = stored.legacy;
  }

  private storage(): Storage | null {
    return storageOrNull();
  }

  private persist(): void {
    this.storage()?.setItem(
      FAVORITES_KEY,
      JSON.stringify({
        starred: [...this.starred],
        unstarred: [...this.unstarred],
        legacy: [...this.legacy],
      }),
    );
  }

  /** True when this ROW is starred. */
  has(rowId: string): boolean {
    return this.starred.has(rowId);
  }

  /**
   * Star or unstar a ROW. Returns the new state.
   *
   * NO GATE. Every row can be starred, whatever the firmware could or could not address today:
   * the star records intent, and intent does not depend on whether the file exists yet. What is
   * WRITTEN is filtered instead, at the one place that knows -- see `fileFor`.
   */
  toggle(rowId: string): boolean {
    const next = !this.starred.has(rowId);
    const s = new Set(this.starred);
    const u = new Set(this.unstarred);
    if (next) {
      s.add(rowId);
      u.delete(rowId);
    } else {
      s.delete(rowId);
      u.add(rowId);
    }
    this.starred = s;
    this.unstarred = u;
    this.persist();
    return next;
  }

  /** True when a sync has anything to write. */
  get dirty(): boolean {
    return this.starred.size > 0 || this.unstarred.size > 0 || this.legacy.size > 0;
  }

  /**
   * The file's new contents, given what the device already had and how rows resolve to paths.
   *
   * THE INTERSECTION IS TAKEN HERE. `resolve` answers with a device path for a row that will be
   * on the device after this sync, and null for one that will not; a starred row that resolves
   * to null is simply absent from the file and stays remembered locally. Unstarred rows are
   * resolved too, because removing a star has to name the path the device already holds.
   *
   * Legacy paths ride along unresolved -- they are already device paths.
   */
  fileFor(existingText: string, resolve: (rowId: string) => string | null): string {
    const starredPaths: string[] = [...this.legacy];
    for (const id of this.starred) {
      const p = resolve(id);
      if (p !== null && isFavoritable(p)) starredPaths.push(p);
    }
    const unstarredPaths: string[] = [];
    for (const id of this.unstarred) {
      const p = resolve(id);
      if (p !== null) unstarredPaths.push(p);
    }
    return serializeFavorites(
      mergeFavorites(parseFavorites(existingText), starredPaths, unstarredPaths),
    );
  }
}

export const favorites = new Favorites();
