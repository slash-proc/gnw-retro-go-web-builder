/**
 * Which platform's cover art a game row belongs to.
 *
 * THE BUG THIS EXISTS FOR. Scraping a cover for Doom reported:
 *
 *     [?] Unknown system for doom.wad (folder 'doom') - skipped.
 *
 * `doom/` is the Doom CORE's ingest folder, not a console's. ScreenScraper has no `doom`
 * platform and DOOM the game lives under PC Dos (135), so deriving the platform from the folder
 * name could only ever fail there. The owner's ruling on adding `doom: 135` to the ScreenScraper
 * map: "don't hard code it. we need to derive it. the manifest should say dos".
 *
 * WHAT IT DERIVES FROM: the manifest's TOP-LEVEL `originalSystem` (`Manifest.originalSystem`,
 * `sources/types.ts`), a single plain segment already pattern-checked by `client.ts` to
 * `^[a-z0-9][a-z0-9-]*$`. `homebrewTitles.svelte.ts` copies it onto every entry, and a core WITH
 * a converter is an entry, so Doom is already in `homebrew.titles` and will carry the value the
 * day its manifest publishes one. Nothing else in the client needs changing.
 *
 * That value is then resolved through ScreenScraper's own published shortcodes
 * (`screenscraper/systemMap.js` over the committed snapshot), so `originalSystem: "dos"` reaches
 * systemeid 135 with NO entry in any local table. That composition is the whole point: the
 * manifest names a platform in the world's vocabulary, and ScreenScraper publishes that
 * vocabulary.
 *
 * WHY IT IS THE LAST RESORT, NOT THE FIRST. A folder that already names a real console resolves
 * on its own and must keep doing so: `gb`, `snes` and `gba` need no manifest field, and a core
 * that happens to publish a converter for a real console must not redirect that console's ROMs
 * at its own provenance. So the manifest is consulted only where the folder itself resolves to
 * nothing, which is exactly the case that fails today. Everything that works keeps working.
 *
 * ABSENT IS THE NORMAL CASE TODAY and stays honest. The published Doom manifest does not carry
 * the field yet. Until it does the caller reports it plainly; there is no guess from `longName`,
 * no hardcoded id, and no silent fall back to a name search.
 */

/** The half of a registered system this decision needs. */
export interface FolderOwnerSystem {
  /** `roms/<folder>/`, lowercased. */
  folder: string;
  /** `owner/repo#targetId`, the same key shape `HomebrewTitle.key` uses. */
  targetKey: string;
}

/** The half of a title this decision needs. */
export interface FolderOwnerTitle {
  key: string;
  /** The manifest's top-level value, absent when it does not say. */
  originalSystem?: string;
  /** The manifest's top-level `originalName`: the work's own title, used AS GIVEN. */
  originalName?: string;
}

/**
 * What to scrape a game row against.
 *
 *  - `folder`    the folder names a console; use it, unchanged behaviour.
 *  - `manifest`  a core owns this folder and its manifest says where the work came from.
 *  - `unstated`  a core owns this folder and its manifest does NOT say. A name-based guess on a
 *                converter's output is a guess we are not willing to make, so the caller reports
 *                it. `titleKey` names who to ask to publish the field.
 *  - `unknown`   nothing owns it and the folder names no console. The scraper's own "Unknown
 *                system" line, naming the folder, is the honest answer.
 */
export type CoverSystem =
  | { kind: "folder"; system: string }
  | { kind: "manifest"; system: string; titleKey: string; name?: string }
  | { kind: "unstated"; titleKey: string }
  | { kind: "unknown" };

/**
 * Resolve the platform for a game row.
 *
 * `folderResolves` is injected rather than imported so this stays pure and node-testable: the
 * real one is `screenscraper/systemMap.js`'s `isKnownSystemFolder`. Several suites bundle
 * `sources/` under `platform: "neutral"`, and importing the scraper here would drag that graph
 * in -- the same hazard `romScan.ts` records about `engine/devicePaths.ts`.
 */
export function coverSystemFor(
  gameKey: string,
  systems: readonly FolderOwnerSystem[],
  titles: readonly FolderOwnerTitle[],
  folderResolves: (folder: string) => boolean,
): CoverSystem {
  const slash = gameKey.indexOf("/");
  if (slash <= 0) return { kind: "unknown" };
  const folder = gameKey.slice(0, slash).toLowerCase();

  // A real console folder answers for itself. Checked FIRST so a core publishing a converter for
  // an existing console cannot pull that console's ROMs onto its own provenance.
  if (folderResolves(folder)) return { kind: "folder", system: folder };

  // Owned by a core target? Matched by FOLDER, never by name: the folder is what the scan key
  // actually carries, and two projects may share a title.
  const owner = systems.find((s) => s.folder === folder);
  if (!owner) return { kind: "unknown" };
  const title = titles.find((t) => t.key === owner.targetKey);
  if (!title) return { kind: "unknown" };

  const stated = title.originalSystem?.trim();
  if (!stated) return { kind: "unstated", titleKey: title.key };
  // The name rides along when stated. The two are INDEPENDENT: a manifest may name the platform
  // without naming the work, and that is still a usable answer -- the filename is then the
  // lookup, as it is for every ordinary ROM.
  const name = title.originalName?.trim();
  return {
    kind: "manifest",
    system: stated.toLowerCase(),
    titleKey: title.key,
    ...(name ? { name } : {}),
  };
}
